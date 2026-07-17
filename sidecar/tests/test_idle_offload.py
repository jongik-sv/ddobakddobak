"""IdleOffloadController — GPU 유휴 오프로드 상태 머신 유닛 테스트.

fake clock(FakeClock)과 콜백 카운터만 사용해 torch/CUDA 없이 TTL 판정·락 경합·
2단계 전이·0=off 케이스를 검증한다. 실제 어댑터 배선(Qwen3/faster_whisper)은
test_qwen3_transformers_adapter_idle.py / test_faster_whisper_adapter_idle.py에서 다룬다.
"""
import asyncio

import pytest

from app.stt.idle_offload import IdleOffloadController, ResidentState, resolve_idle_thresholds


class FakeClock:
    """수동으로 시간을 흘려보낼 수 있는 가짜 시계."""

    def __init__(self, t: float = 0.0):
        self.t = t

    def __call__(self) -> float:
        return self.t

    def advance(self, sec: float) -> None:
        self.t += sec


def _make_two_stage_controller(clock: FakeClock):
    """Qwen3 스타일: GPU -> CPU(1단계) -> UNLOADED(2단계)."""
    calls = {"stage1": 0, "stage2": 0, "reload_cpu": 0, "reload_unloaded": 0}

    async def stage1():
        calls["stage1"] += 1

    async def stage2():
        calls["stage2"] += 1

    async def reload_cpu():
        calls["reload_cpu"] += 1

    async def reload_unloaded():
        calls["reload_unloaded"] += 1

    ctrl = IdleOffloadController(
        name="test-two-stage",
        stage1_offload=stage1,
        stage1_target=ResidentState.CPU,
        reload_from_cpu=reload_cpu,
        stage2_offload=stage2,
        reload_from_unloaded=reload_unloaded,
        clock=clock,
    )
    ctrl.mark_loaded()
    return ctrl, calls


# ── TTL 판정 (1단계) ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_stage1_not_triggered_before_ttl():
    clock = FakeClock()
    ctrl, calls = _make_two_stage_controller(clock)
    clock.advance(599)
    await ctrl.maybe_offload(600, 3600)
    assert ctrl.state == ResidentState.GPU
    assert calls["stage1"] == 0


@pytest.mark.asyncio
async def test_stage1_triggered_at_ttl_boundary():
    clock = FakeClock()
    ctrl, calls = _make_two_stage_controller(clock)
    clock.advance(600)
    await ctrl.maybe_offload(600, 3600)
    assert ctrl.state == ResidentState.CPU
    assert calls["stage1"] == 1


@pytest.mark.asyncio
async def test_stage1_is_idempotent_on_repeated_checks():
    """이미 CPU 상태면 재점검해도 1단계 콜백이 다시 불리지 않는다."""
    clock = FakeClock()
    ctrl, calls = _make_two_stage_controller(clock)
    clock.advance(600)
    await ctrl.maybe_offload(600, 3600)
    await ctrl.maybe_offload(600, 3600)
    assert calls["stage1"] == 1


# ── 0 = 비활성 ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_idle_unload_sec_zero_disables_all_offload():
    clock = FakeClock()
    ctrl, calls = _make_two_stage_controller(clock)
    clock.advance(100_000)
    await ctrl.maybe_offload(0, 3600)
    assert ctrl.state == ResidentState.GPU
    assert calls["stage1"] == 0


@pytest.mark.asyncio
async def test_idle_full_unload_sec_zero_disables_stage2_only():
    clock = FakeClock()
    ctrl, calls = _make_two_stage_controller(clock)
    clock.advance(600)
    await ctrl.maybe_offload(600, 0)
    assert ctrl.state == ResidentState.CPU  # 1단계는 정상 동작
    clock.advance(100_000)
    await ctrl.maybe_offload(600, 0)
    assert ctrl.state == ResidentState.CPU  # 2단계는 영구 비활성
    assert calls["stage2"] == 0


@pytest.mark.asyncio
async def test_no_offload_wired_means_always_gpu_resident():
    """CPU 엔진(whisper_cpp 등) 패턴: 콜백 미배선이면 유휴가 아무리 길어도 상태 불변."""
    clock = FakeClock()
    ctrl = IdleOffloadController(name="cpu-engine", clock=clock)
    ctrl.mark_loaded()
    clock.advance(1_000_000)
    await ctrl.maybe_offload(600, 3600)
    assert ctrl.state == ResidentState.GPU
    assert ctrl.gpu_resident is True


# ── 2단계 전이 (추론 -> 10분 유휴 -> 1단계 -> 60분 총유휴 -> 2단계 -> 재추론) ──

@pytest.mark.asyncio
async def test_two_stage_full_lifecycle():
    clock = FakeClock()
    ctrl, calls = _make_two_stage_controller(clock)

    # 1) 추론 1회 → last_used 갱신
    async with ctrl:
        pass
    assert ctrl.state == ResidentState.GPU

    # 2) 10분(600s) 유휴 → 1단계(GPU -> CPU)
    clock.advance(600)
    await ctrl.maybe_offload(600, 3600)
    assert ctrl.state == ResidentState.CPU
    assert calls["stage1"] == 1
    assert calls["stage2"] == 0

    # 3) 마지막 추론 시각 기준 총 60분(3600s) 유휴 → 2단계(CPU -> UNLOADED)
    #    (오프로드 시각이 아니라 last_used 기준임을 검증: 600 + 3000 = 3600)
    clock.advance(3000)
    await ctrl.maybe_offload(600, 3600)
    assert ctrl.state == ResidentState.UNLOADED
    assert calls["stage2"] == 1

    # 4) 재추론 → 디스크 풀 재로드(느린 경로)를 거쳐 GPU 복귀
    async with ctrl:
        pass
    assert ctrl.state == ResidentState.GPU
    assert calls["reload_unloaded"] == 1
    assert calls["reload_cpu"] == 0


@pytest.mark.asyncio
async def test_stage1_offload_resets_after_reload_from_cpu():
    """1단계에서 복귀한 뒤 다시 유휴가 쌓이면 다시 1단계가 발동해야 한다."""
    clock = FakeClock()
    ctrl, calls = _make_two_stage_controller(clock)

    clock.advance(600)
    await ctrl.maybe_offload(600, 3600)
    assert ctrl.state == ResidentState.CPU

    async with ctrl:  # CPU -> GPU 복귀 (빠른 경로)
        pass
    assert ctrl.state == ResidentState.GPU
    assert calls["reload_cpu"] == 1

    clock.advance(600)
    await ctrl.maybe_offload(600, 3600)
    assert ctrl.state == ResidentState.CPU
    assert calls["stage1"] == 2


@pytest.mark.asyncio
async def test_single_stage_straight_to_unloaded_faster_whisper_style():
    """faster_whisper 패턴: CPU 중간 상태 없이 1단계에서 곧장 UNLOADED로."""
    clock = FakeClock()
    calls = {"stage1": 0, "reload": 0}

    async def stage1():
        calls["stage1"] += 1

    async def reload():
        calls["reload"] += 1

    ctrl = IdleOffloadController(
        name="faster_whisper",
        stage1_offload=stage1,
        stage1_target=ResidentState.UNLOADED,
        reload_from_unloaded=reload,
        clock=clock,
    )
    ctrl.mark_loaded()

    clock.advance(600)
    await ctrl.maybe_offload(600, 3600)
    assert ctrl.state == ResidentState.UNLOADED
    assert calls["stage1"] == 1

    # stage2_offload가 없으므로 아무리 유휴가 지속돼도 2단계 개념 자체가 없음(이미 최소 상태)
    clock.advance(1_000_000)
    await ctrl.maybe_offload(600, 3600)
    assert ctrl.state == ResidentState.UNLOADED

    async with ctrl:
        pass
    assert calls["reload"] == 1
    assert ctrl.state == ResidentState.GPU


# ── 락 경합: 추론 중 오프로드 금지 / 오프로드 중 추론은 복귀까지 대기 ──────

@pytest.mark.asyncio
async def test_maybe_offload_waits_for_inflight_inference_then_skips():
    """추론 진행 중엔 오프로드가 락을 기다리고, 추론이 last_used를 갱신했으므로
    락 획득 후 재판정 시 더 이상 TTL을 넘지 않아 오프로드하지 않는다."""
    clock = FakeClock()
    ctrl, calls = _make_two_stage_controller(clock)
    order: list[str] = []

    async def slow_infer():
        async with ctrl:
            order.append("infer-start")
            await asyncio.sleep(0.05)
            order.append("infer-end")

    clock.advance(600)  # 추론 시작 시점엔 이미 TTL 초과 상태
    infer_task = asyncio.create_task(slow_infer())
    await asyncio.sleep(0.01)  # infer가 먼저 락을 잡도록 양보

    await ctrl.maybe_offload(600, 3600)  # infer가 끝날 때까지 대기해야 함
    await infer_task

    assert order == ["infer-start", "infer-end"]
    assert ctrl.state == ResidentState.GPU  # touch()로 유휴가 리셋돼 오프로드 안 됨
    assert calls["stage1"] == 0


@pytest.mark.asyncio
async def test_inference_waits_for_inflight_offload_then_auto_reloads():
    """오프로드가 진행 중일 때 추론 요청이 오면, 오프로드가 끝날 때까지 대기한 뒤
    (필요 시) 자동으로 GPU 복귀 콜백을 거쳐 진행된다."""
    clock = FakeClock()
    calls = {"stage1": 0, "reload_cpu": 0}
    stage1_started = asyncio.Event()
    release_stage1 = asyncio.Event()

    async def slow_stage1():
        calls["stage1"] += 1
        stage1_started.set()
        await release_stage1.wait()

    async def reload_cpu():
        calls["reload_cpu"] += 1

    ctrl = IdleOffloadController(
        name="test-contention",
        stage1_offload=slow_stage1,
        stage1_target=ResidentState.CPU,
        reload_from_cpu=reload_cpu,
        clock=clock,
    )
    ctrl.mark_loaded()
    clock.advance(600)

    offload_task = asyncio.create_task(ctrl.maybe_offload(600, 3600))
    await stage1_started.wait()
    assert ctrl.state == ResidentState.GPU  # 오프로드 콜백이 아직 진행 중 → 상태 미전이

    infer_entered = asyncio.Event()

    async def infer():
        async with ctrl:
            infer_entered.set()

    infer_task = asyncio.create_task(infer())
    await asyncio.sleep(0.01)
    assert not infer_entered.is_set()  # 오프로드가 락을 쥐고 있어 추론이 대기 중

    release_stage1.set()
    await offload_task
    await infer_task

    assert calls["reload_cpu"] == 1  # 오프로드 완료(CPU) 직후 추론이 자동 복귀시킴
    assert ctrl.state == ResidentState.GPU


# ── 설정 검증: idle_full_unload_sec <= idle_unload_sec 이상 설정 ─────────

def test_resolve_idle_thresholds_valid_passthrough():
    assert resolve_idle_thresholds(600, 3600) == (600, 3600)


def test_resolve_idle_thresholds_full_equal_unload_disables_stage2():
    assert resolve_idle_thresholds(600, 600) == (600, 0)


def test_resolve_idle_thresholds_full_less_than_unload_disables_stage2():
    assert resolve_idle_thresholds(600, 300) == (600, 0)


def test_resolve_idle_thresholds_explicit_zero_full_passthrough():
    assert resolve_idle_thresholds(600, 0) == (600, 0)


def test_resolve_idle_thresholds_stage1_disabled_passthrough():
    # 1단계 자체가 꺼져 있으면 2단계 판정은 도달 불가 상태이므로 값 그대로 반환
    assert resolve_idle_thresholds(0, 3600) == (0, 3600)


def test_resolve_idle_thresholds_warns_on_invalid_config(caplog):
    with caplog.at_level("WARNING"):
        resolve_idle_thresholds(600, 600)
    assert any("idle_full_unload_sec" in rec.message for rec in caplog.records)
