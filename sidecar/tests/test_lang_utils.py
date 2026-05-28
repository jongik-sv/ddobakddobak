from app.stt import lang_utils as lu


def test_qwen_force_lang_single_maps_iso_to_fullname():
    assert lu.qwen_force_lang(["ko"], "single") == "Korean"
    assert lu.qwen_force_lang(["en"], "single") == "English"


def test_qwen_force_lang_unknown_iso_falls_back_to_korean():
    assert lu.qwen_force_lang(["xx"], "single") == "Korean"


def test_qwen_force_lang_multi_returns_none():
    assert lu.qwen_force_lang(["ko", "en"], "multi") is None


def test_qwen_force_lang_empty_returns_none():
    assert lu.qwen_force_lang([], "single") is None
    assert lu.qwen_force_lang(None, "single") is None


def test_iso_force_lang_single_returns_iso():
    assert lu.iso_force_lang(["ko"], "single") == "ko"


def test_iso_force_lang_multi_returns_none():
    assert lu.iso_force_lang(["ko", "en"], "multi") is None


def test_normalize_to_iso_from_fullname():
    assert lu.normalize_to_iso("Korean") == "ko"
    assert lu.normalize_to_iso("Chinese") == "zh"


def test_normalize_to_iso_passthrough_iso():
    assert lu.normalize_to_iso("ko") == "ko"


def test_normalize_to_iso_unknown_lowercased():
    assert lu.normalize_to_iso("auto") == "auto"


def test_filter_segments_drops_unlisted_language():
    class Seg:
        def __init__(self, text, language):
            self.text = text
            self.language = language

    segs = [Seg("안녕", "Korean"), Seg("nihao", "Chinese"), Seg("hi", "en")]
    kept = lu.filter_segments(segs, ["ko", "en"])
    assert [s.text for s in kept] == ["안녕", "hi"]


def test_filter_segments_empty_allowed_keeps_all():
    class Seg:
        def __init__(self, language):
            self.language = language

    segs = [Seg("Chinese"), Seg("Korean")]
    assert lu.filter_segments(segs, []) == segs
    assert lu.filter_segments(segs, None) == segs
