"""pick_device 단위 테스트 — torch 가용성에 따른 디바이스 선택."""
from unittest.mock import patch

from app.diarization.device import pick_device


def test_pick_device_prefers_mps_when_available():
    with patch("torch.backends.mps.is_available", return_value=True):
        assert str(pick_device()) == "mps"


def test_pick_device_falls_back_to_cpu():
    with patch("torch.backends.mps.is_available", return_value=False):
        assert str(pick_device()) == "cpu"


def test_pick_device_env_override_forces_cpu(monkeypatch):
    monkeypatch.setenv("DIARIZATION_DEVICE", "cpu")
    with patch("torch.backends.mps.is_available", return_value=True):
        assert str(pick_device()) == "cpu"
