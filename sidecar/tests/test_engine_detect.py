import sys
import types

from app import engines
from app.engines import _detect_available_engines


def test_detect_returns_list_of_str():
    engines_list = _detect_available_engines()
    assert isinstance(engines_list, list)
    assert all(isinstance(e, str) for e in engines_list)


# ── CUDA + vLLM 가용 여부에 따른 qwen3_asr_vllm 노출 ─────────────────────
# 셀렉터 노출 순서는 auto_select_engine/available_file_engines와 일관되게
# vllm이 transformers보다 앞에 와야 한다(engines.py 노출 순서 통일 참고).

def test_detect_cuda_with_vllm_exposes_vllm_before_transformers(monkeypatch):
    monkeypatch.setattr(engines, "_has_module", lambda name: name == "vllm")

    fake_torch = types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda: True))
    fake_qwen_asr = types.SimpleNamespace()
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setitem(sys.modules, "qwen_asr", fake_qwen_asr)

    result = engines._detect_available_engines()

    assert "qwen3_asr_vllm" in result
    assert "qwen3_asr_transformers" in result
    assert result.index("qwen3_asr_vllm") < result.index("qwen3_asr_transformers")


def test_detect_cuda_without_vllm_excludes_vllm(monkeypatch):
    monkeypatch.setattr(engines, "_has_module", lambda name: False)

    fake_torch = types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda: True))
    fake_qwen_asr = types.SimpleNamespace()
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setitem(sys.modules, "qwen_asr", fake_qwen_asr)

    result = engines._detect_available_engines()

    assert "qwen3_asr_vllm" not in result
    assert "qwen3_asr_transformers" in result
