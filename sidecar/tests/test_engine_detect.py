from app.main import _detect_available_engines


def test_detect_returns_list_of_str():
    engines = _detect_available_engines()
    assert isinstance(engines, list)
    assert all(isinstance(e, str) for e in engines)
