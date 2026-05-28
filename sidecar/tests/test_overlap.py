from app.diarization.overlap import find_speaker_by_overlap


def test_find_speaker_picks_max_overlap():
    diar = {(0, 1000): "화자 1", (900, 3000): "화자 2"}
    # 950~2000: 화자2와 더 많이 겹침
    assert find_speaker_by_overlap(950, 2000, diar) == "화자 2"


def test_find_speaker_none_when_no_overlap():
    diar = {(0, 1000): "화자 1"}
    assert find_speaker_by_overlap(2000, 3000, diar) is None
