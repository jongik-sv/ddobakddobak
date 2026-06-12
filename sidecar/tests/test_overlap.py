from app.diarization.overlap import find_speaker_by_overlap, assign_speaker_summed


def test_find_speaker_picks_max_overlap():
    diar = {(0, 1000): "화자 1", (900, 3000): "화자 2"}
    # 950~2000: 화자2와 더 많이 겹침
    assert find_speaker_by_overlap(950, 2000, diar) == "화자 2"


def test_find_speaker_none_when_no_overlap():
    diar = {(0, 1000): "화자 1"}
    assert find_speaker_by_overlap(2000, 3000, diar) is None


def test_summed_overlap_beats_single_longest_turn():
    # 화자1: 0-400 + 600-1000 (합산 800ms) vs 화자2: 400-600 (200ms)
    # 기존 find_speaker_by_overlap는 "최장 단일 턴"만 봐서 이런 케이스에 약함
    turns = [(0, 400, "화자 1"), (400, 600, "화자 2"), (600, 1000, "화자 1")]
    assert assign_speaker_summed(0, 1000, turns) == "화자 1"


def test_no_overlap_falls_back_to_nearest_turn():
    turns = [(0, 500, "화자 1"), (5000, 6000, "화자 2")]
    # 세그먼트 4000-4500: 겹침 0, 화자2 턴(5000)이 화자1 턴 끝(500)보다 가까움
    assert assign_speaker_summed(4000, 4500, turns) == "화자 2"


def test_empty_turns_returns_none():
    assert assign_speaker_summed(0, 1000, []) is None


def test_duplicate_intervals_do_not_collide():
    # dict 키 충돌 없는 list[tuple] 입력 — 같은 (start,end)에 두 화자 가능(겹침 발화)
    turns = [(0, 1000, "화자 1"), (0, 1000, "화자 2"), (0, 300, "화자 2")]
    # 화자2 합산 1300 > 화자1 1000 → 화자 2
    assert assign_speaker_summed(0, 1000, turns) == "화자 2"
