"""KURE-v1 임베딩 인코더 (folder-chat 의미검색용).

런타임=PyTorch + transformers.AutoModel. 풀링=CLS 토큰 + L2 정규화(BGE-M3/KURE 계열).
sentence-transformers 미사용(transformers<5 다운그레이드 방지).
"""
from __future__ import annotations

import logging

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
        self.device: str | None = None     # load() 시 확정
        self.dim: int | None = None
        self._tok = None
        self._model = None

    def _load_raw(self):
        """(tokenizer, model) 반환. transformers AutoModel/AutoTokenizer 사용."""
        from transformers import AutoModel, AutoTokenizer
        tok = AutoTokenizer.from_pretrained(self.model_name)
        model = AutoModel.from_pretrained(self.model_name)
        return tok, model

    def load(self) -> None:
        if self._model is not None:
            return
        self.device = _resolve_device(self._requested_device)
        logger.info("[embed] KURE 로드 시작 model=%s device=%s", self.model_name, self.device)
        tok, model = self._load_raw()
        self._tok = tok
        self._model = model.to(self.device).eval()
        self.dim = int(self._model.config.hidden_size)
        logger.info("[embed] KURE 로드 완료 dim=%s", self.dim)

    def encode(self, texts: list[str]) -> list[list[float]]:
        import torch
        self.load()
        enc = self._tok(texts, padding=True, truncation=True, max_length=512, return_tensors="pt")
        enc = {k: v.to(self.device) for k, v in enc.items()} if hasattr(enc, "items") else enc.to(self.device)
        with torch.no_grad():
            out = self._model(**enc)
        vecs = pool_cls_normalize(out.last_hidden_state)
        if self.dim is None:
            self.dim = int(vecs.shape[1])
        return vecs.cpu().tolist()
