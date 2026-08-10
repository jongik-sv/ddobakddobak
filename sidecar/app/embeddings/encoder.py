"""KURE-v1 임베딩 인코더 (folder-chat 의미검색용).

런타임=PyTorch + transformers.AutoModel. 풀링=CLS 토큰 + L2 정규화(BGE-M3/KURE 계열).
sentence-transformers 미사용(transformers<5 다운그레이드 방지).

유휴 오프로드: STT 어댑터와 같은 IdleOffloadController를 재사용해 유휴 TTL 초과 시
GPU -> CPU -> 완전 해제(RAM 반납) 2단계로 내린다. lazy load 모델이므로 컨트롤러를
UNLOADED 상태로 시작한다.
"""
from __future__ import annotations

import asyncio
import logging

from app.stt.idle_offload import IdleOffloadController, ResidentState

logger = logging.getLogger(__name__)


def pool_cls_normalize(last_hidden_state):
    """CLS 토큰(0번) 추출 후 L2 정규화. (batch, seq, hidden) -> (batch, hidden).

    torch는 함수 내부에서 lazy import — 모듈 import만으로 torch가 로드되지 않게(idle 풋프린트).
    """
    import torch.nn.functional as F
    cls = last_hidden_state[:, 0]
    return F.normalize(cls, p=2, dim=1)


def _resolve_device(device: str) -> str:
    if device and device != "auto":
        return device
    import torch
    return "cuda" if torch.cuda.is_available() else "cpu"


class KureEncoder:
    """KURE-v1 임베딩 인코더. 첫 encode 호출 시 모델·torch를 lazy load한다."""

    def __init__(self, model_name: str, version: str, device: str = "auto"):
        self.model_name = model_name
        self.model_version = version
        self._requested_device = device
        # 디바이스는 오프로드 콜백 구성을 결정하므로 생성 시점에 확정한다.
        # _resolve_device는 torch.cuda.is_available()만 호출하고 모델을 로드하지 않는다.
        self.device: str = _resolve_device(device)
        self.dim: int | None = None
        self._tok = None
        self._model = None

        if str(self.device).startswith("cuda"):
            # GPU: 1단계 CPU 이동(가중치 유지) -> 2단계 완전 해제
            self._idle = IdleOffloadController(
                name=f"embed({model_name})",
                stage1_offload=self._offload_to_cpu,
                stage1_target=ResidentState.CPU,
                reload_from_cpu=self._reload_from_cpu,
                stage2_offload=self._offload_full,
                reload_from_unloaded=self._reload_full,
                initial_state=ResidentState.UNLOADED,
            )
        else:
            # CPU 상주 모델은 gpu->cpu 전이가 무의미 — 1단계에서 곧바로 완전 해제
            self._idle = IdleOffloadController(
                name=f"embed({model_name})",
                stage1_offload=self._offload_full,
                stage1_target=ResidentState.UNLOADED,
                reload_from_unloaded=self._reload_full,
                initial_state=ResidentState.UNLOADED,
            )

    def _load_raw(self):
        """(tokenizer, model) 반환. transformers AutoModel/AutoTokenizer 사용."""
        from transformers import AutoModel, AutoTokenizer
        tok = AutoTokenizer.from_pretrained(self.model_name)
        model = AutoModel.from_pretrained(self.model_name)
        return tok, model

    def load(self) -> None:
        if self._model is not None:
            return
        logger.info("[embed] KURE 로드 시작 model=%s device=%s", self.model_name, self.device)
        tok, model = self._load_raw()
        self._tok = tok
        self._model = model.to(self.device).eval()
        self.dim = int(self._model.config.hidden_size)
        self._idle.mark_loaded()
        logger.info("[embed] KURE 로드 완료 dim=%s", self.dim)

    # ── 유휴 오프로드 콜백 ────────────────────────────────────────────
    async def _offload_to_cpu(self) -> None:
        """1단계: GPU -> CPU (가중치 유지)."""
        loop = asyncio.get_running_loop()

        def _off():
            import torch
            self._model.to("cpu")
            torch.cuda.empty_cache()

        await loop.run_in_executor(None, _off)

    async def _reload_from_cpu(self) -> None:
        """1단계 복귀: CPU -> GPU (디스크 접근 없이 빠름)."""
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, lambda: self._model.to(self.device))

    async def _offload_full(self) -> None:
        """2단계: 모델·토크나이저 완전 해제 (RAM 반납).

        dim과 device는 유지한다 — 같은 모델을 재로드하면 동일한 값이고,
        언로드 상태에서도 /embed의 빈 texts 조기 반환이 dim을 참조한다.
        """
        loop = asyncio.get_running_loop()

        def _unload():
            import gc
            self._model = None
            self._tok = None
            gc.collect()

        await loop.run_in_executor(None, _unload)

    async def _reload_full(self) -> None:
        """2단계 복귀: 디스크/HF 캐시에서 재로드 (느림, 수 초)."""
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self.load)

    # ── 상태 조회 / 루프 진입점 ──────────────────────────────────────
    @property
    def gpu_resident(self) -> bool:
        # self._idle.gpu_resident를 그대로 반환하면 EMBED_DEVICE=cpu일 때도 True가
        # 나올 수 있다(mark_loaded()가 무조건 GPU로 세팅). resident_state의 CPU 보정
        # 로직을 재사용해 실제 디바이스를 반영한다.
        return self.resident_state == ResidentState.GPU.value

    @property
    def resident_state(self) -> str:
        """모델의 실제 상주 위치("gpu" / "cpu" / "unloaded").

        IdleOffloadController.mark_loaded()는 원래 GPU 전용 STT 어댑터를 가정해
        만들어져 있어, 로드가 끝나면 디바이스와 무관하게 무조건 ResidentState.GPU로
        세팅한다(app/stt/idle_offload.py는 STT 어댑터 2개와 공유하므로 여기서 수정하지
        않는다). 그 결과 EMBED_DEVICE=cpu로 로드된 인코더도 컨트롤러 상태만 보면
        "gpu"로 거짓 보고된다. 언로드 상태가 아니고 디바이스가 cuda가 아니면
        "cpu"로 보정해 반환한다. UNLOADED는 디바이스와 무관하게 그대로 유지한다.
        """
        state = self._idle.state
        if state != ResidentState.UNLOADED and not str(self.device).startswith("cuda"):
            return ResidentState.CPU.value
        return state.value

    async def maybe_offload(self, idle_unload_sec: float, idle_full_unload_sec: float) -> None:
        await self._idle.maybe_offload(idle_unload_sec, idle_full_unload_sec)

    # ── 추론 ─────────────────────────────────────────────────────────
    def _encode_sync(self, texts: list[str]) -> list[list[float]]:
        """실제 추론. 호출 시점에 모델이 로드돼 있다고 가정한다."""
        import torch
        enc = self._tok(texts, padding=True, truncation=True, max_length=512, return_tensors="pt")
        enc = {k: v.to(self.device) for k, v in enc.items()}
        with torch.no_grad():
            out = self._model(**enc)
        vecs = pool_cls_normalize(out.last_hidden_state)
        if self.dim is None:
            self.dim = int(vecs.shape[1])
        return vecs.cpu().tolist()

    def encode(self, texts: list[str]) -> list[list[float]]:
        """동기 진입점 (테스트·직접 호출 호환). 유휴 상태 추적을 하지 않는다.

        경고: 이 메서드는 IdleOffloadController의 락을 우회한다.
        1) 오프로드가 활성화된 상태에서 encode()를 동시 호출하면, executor 스레드에서
           _offload_to_cpu/_reload_from_cpu/_offload_full이 self._model을 이동·해제하는
           도중 encode()가 같은 모델 객체로 추론을 시도하는 데이터 레이스가 발생할 수 있다.
        2) touch()를 호출하지 않으므로 last_used가 갱신되지 않는다 — 이 경로만 반복
           호출되면 실제로는 사용 중인데도 유휴 오프로드 루프가 "유휴"로 오판해
           모델을 회수할 수 있다.
        프로덕션 경로(/embed 라우터)는 encode_async를 사용하므로 위 문제가 없다.
        새 코드에서는 반드시 encode()가 아니라 encode_async()를 사용해야 한다.
        """
        self.load()
        return self._encode_sync(texts)

    async def encode_async(self, texts: list[str]) -> list[list[float]]:
        """async 진입점 — 필요 시 GPU 복귀, 동시 호출 직렬화, last_used 갱신.

        추론은 executor에 넘겨 이벤트 루프를 막지 않는다 (백필 잡이 도는 동안
        실시간 전사 요청이 대기하던 문제 해소).
        """
        async with self._idle:
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(None, self._encode_sync, texts)
