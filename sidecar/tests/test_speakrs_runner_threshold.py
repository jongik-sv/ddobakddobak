import json
from unittest.mock import patch, MagicMock
from app.diarization import speakrs_runner


def _fake_proc(stdout: dict):
    p = MagicMock()
    p.returncode = 0
    p.stdout = json.dumps(stdout).encode("utf-8")
    p.stderr = b""
    return p


@patch("app.diarization.speakrs_runner.subprocess.run")
def test_run_speakrs_passes_threshold_flag(mock_run):
    mock_run.return_value = _fake_proc({"speakers": ["화자 1"], "turns": []})
    speakrs_runner.run_speakrs(b"\x00\x00" * 16000, ahc_threshold=0.4)
    args = mock_run.call_args[0][0]
    assert "--ahc-threshold" in args
    assert args[args.index("--ahc-threshold") + 1] == "0.4"


@patch("app.diarization.speakrs_runner.subprocess.run")
def test_run_speakrs_omits_flag_when_none(mock_run):
    mock_run.return_value = _fake_proc({"speakers": [], "turns": []})
    speakrs_runner.run_speakrs(b"\x00\x00" * 16000, ahc_threshold=None)
    args = mock_run.call_args[0][0]
    assert "--ahc-threshold" not in args
