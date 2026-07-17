"""GPU 유휴 오프로드 공용 상태 머신.

STT 어댑터가 GPU 메모리를 오래 점유하지 않도록, 유휴 시간(TTL) 기반으로
모델을 GPU에서 내리는 2단계 정책을 구현한다.

상태 전이:
    GPU --(idle_unload_sec 경과)--> CPU 또는 UNLOADED (1단계, 어댑터별)
    CPU --(idle_full_unload_sec 경과, 1단계가 CPU를 거치는 어댑터만)--> UNLOADED (2단계)

실제 모델 이동(torch .to('cpu'), del, 재로드 등)은 어댑터가 주입하는 콜백에 위임한다.
이 모듈은 상태·락·TTL 판정만 담당해 torch/CUDA 없이도 유닛 테스트가 가능하다.

동시성: 추론 경로(`async with controller:`)와 오프로드 점검(`maybe_offload()`)은
같은 `asyncio.Lock`을 공유한다 — 추론 중에는 오프로드가 대기하고, 오프로드 중
추론 요청이 오면 오프로드(또는 복귀)가 끝날 때까지 대기 후 진행한다.
"""
from __future__ import annotations

import asyncio
import logging
import time
from enum import Enum
from typing import Awaitable, Callable

logger = logging.getLogger(__name__)

_AsyncCallback = Callable[[], Awaitable[None]]


class ResidentState(str, Enum):
    """모델의 물리적 상주 위치."""

    GPU = "gpu"
    CPU = "cpu"
    UNLOADED = "unloaded"


def resolve_idle_thresholds(idle_unload_sec: float, idle_full_unload_sec: float) -> tuple[float, float]:
    """설정값 유효성 검증.

    idle_full_unload_sec(2단계)이 idle_unload_sec(1단계) 이하로 설정된 이상값이면
    경고 로그를 남기고 2단계를 비활성화(0)한 값을 반환한다. 1단계가 비활성(0)이면
    2단계 판단 자체가 무의미하므로 그대로 둔다(어차피 CPU 상태에 도달하지 못함).
    """
    if idle_unload_sec > 0 and idle_full_unload_sec > 0 and idle_full_unload_sec <= idle_unload_sec:
        logger.warning(
            "[idle-offload] idle_full_unload_sec(%.0fs)가 idle_unload_sec(%.0fs) 이하로 설정됨 — "
            "이상 설정으로 판단해 2단계(완전 해제)를 비활성화합니다.",
            idle_full_unload_sec, idle_unload_sec,
        )
        return idle_unload_sec, 0
    return idle_unload_sec, idle_full_unload_sec


class IdleOffloadController:
    """어댑터 1개의 유휴 오프로드 상태·락·TTL 판정을 담당한다.

    사용법(어댑터 쪽):
        self._idle = IdleOffloadController(
            name="qwen3_transformers",
            stage1_offload=self._offload_to_cpu,      # GPU -> CPU
            stage1_target=ResidentState.CPU,
            reload_from_cpu=self._reload_from_cpu,     # CPU -> GPU (빠름)
            stage2_offload=self._offload_full,         # CPU -> UNLOADED
            reload_from_unloaded=self._reload_full,    # UNLOADED -> GPU (느림, 디스크 재로드)
        )
        ...
        async def transcribe(self, ...):
            async with self._idle:   # 필요 시 자동 복귀 + last_used 갱신
                ... 실제 추론 ...

    background 루프 쪽:
        await adapter.maybe_offload(idle_unload_sec, idle_full_unload_sec)
    """

    def __init__(
        self,
        name: str,
        *,
        stage1_offload: _AsyncCallback | None = None,
        stage1_target: ResidentState = ResidentState.CPU,
        reload_from_cpu: _AsyncCallback | None = None,
        stage2_offload: _AsyncCallback | None = None,
        reload_from_unloaded: _AsyncCallback | None = None,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.name = name
        self._stage1_offload = stage1_offload
        self._stage1_target = stage1_target
        self._reload_from_cpu = reload_from_cpu
        self._stage2_offload = stage2_offload
        self._reload_from_unloaded = reload_from_unloaded
        self._clock = clock

        # 어댑터는 생성 시점엔 아직 load_model()을 안 거쳤을 수도 있지만, 기존 테스트들이
        # load_model() 없이 _model/_is_loaded를 직접 세팅하는 패턴을 쓰므로 기본값은 GPU로 둔다
        # (실질적 부작용 없음 — offload는 어차피 마지막 사용 후 TTL이 지나야 발동).
        self.state: ResidentState = ResidentState.GPU
        self.last_used: float = clock()
        self.lock = asyncio.Lock()

    def mark_loaded(self) -> None:
        """load_model() 완료 시 호출 — GPU 상주로 초기화."""
        self.state = ResidentState.GPU
        self.last_used = self._clock()

    def touch(self) -> None:
        """last_used 갱신 (추론 호출마다)."""
        self.last_used = self._clock()

    def idle_sec(self) -> float:
        return self._clock() - self.last_used

    @property
    def gpu_resident(self) -> bool:
        return self.state == ResidentState.GPU

    # ── 추론 경로: 락 획득 + 필요 시 자동 복귀 ──────────────────────────
    async def __aenter__(self) -> "IdleOffloadController":
        await self.lock.acquire()
        try:
            if self.state == ResidentState.CPU and self._reload_from_cpu is not None:
                await self._do_reload(self._reload_from_cpu, "cpu")
            elif self.state == ResidentState.UNLOADED and self._reload_from_unloaded is not None:
                await self._do_reload(self._reload_from_unloaded, "unloaded")
        except Exception:
            self.lock.release()
            raise
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        self.touch()
        self.lock.release()
        return False

    async def _do_reload(self, fn: _AsyncCallback, from_label: str) -> None:
        t0 = self._clock()
        logger.info("[idle-offload] %s: 추론 요청 도착 — GPU 복귀 시작 (%s -> gpu)", self.name, from_label)
        await fn()
        self.state = ResidentState.GPU
        logger.info(
            "[idle-offload] %s: GPU 복귀 완료 (%.2fs, %s -> gpu)",
            self.name, self._clock() - t0, from_label,
        )

    # ── 백그라운드 점검 경로 ─────────────────────────────────────────
    async def maybe_offload(self, idle_unload_sec: float, idle_full_unload_sec: float) -> None:
        """유휴 TTL 초과 시 오프로드 실행. 추론 중이면(락 보유 중) 끝날 때까지 대기 후 판정."""
        if idle_unload_sec <= 0:
            return  # 전체 비활성

        async with self.lock:
            idle = self.idle_sec()

            if self.state == ResidentState.GPU:
                if self._stage1_offload is None or idle < idle_unload_sec:
                    return
                t0 = self._clock()
                logger.info(
                    "[idle-offload] %s: 유휴 %.0fs(>= %.0fs) — 1단계 오프로드 시작 (gpu -> %s)",
                    self.name, idle, idle_unload_sec, self._stage1_target.value,
                )
                await self._stage1_offload()
                self.state = self._stage1_target
                logger.info(
                    "[idle-offload] %s: 1단계 오프로드 완료 (%.2fs, state=%s)",
                    self.name, self._clock() - t0, self.state.value,
                )
                return

            if self.state == ResidentState.CPU:
                if self._stage2_offload is None or idle_full_unload_sec <= 0 or idle < idle_full_unload_sec:
                    return
                t0 = self._clock()
                logger.info(
                    "[idle-offload] %s: 유휴 %.0fs(>= %.0fs) — 2단계 완전 해제 시작 (cpu -> unloaded)",
                    self.name, idle, idle_full_unload_sec,
                )
                await self._stage2_offload()
                self.state = ResidentState.UNLOADED
                logger.info(
                    "[idle-offload] %s: 2단계 완전 해제 완료 (%.2fs)",
                    self.name, self._clock() - t0,
                )
                return

            # UNLOADED: 이미 최소 상태 — 할 일 없음
