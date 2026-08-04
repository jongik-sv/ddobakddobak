require "rails_helper"

RSpec.describe TranscriptRedactionPlan do
  # 전역 상수 오염 금지 — RSpec 예제 그룹 안의 `Row = Struct.new(...)` 은 Object 에 상수를 만들어
  # 전체 스위트에서 다른 스펙의 Row 와 충돌한다. let 으로 가둔다.
  let(:row_class) { Struct.new(:id, :sequence_number, :started_at_ms, :ended_at_ms) }

  # 1: [0, 40000]  2: [41250, 68900]  3: [70000, 90000]  4: [121000, 134500]  5: [140000, 160000]
  let(:rows) do
    [
      row_class.new(1, 1, 0, 40_000),
      row_class.new(2, 2, 41_250, 68_900),
      row_class.new(3, 3, 70_000, 90_000),
      row_class.new(4, 4, 121_000, 134_500),
      row_class.new(5, 5, 140_000, 160_000)
    ]
  end
  let(:duration_ms) { 180_000 }

  def plan_for(ids)
    described_class.new(rows: rows, selected_ids: ids, audio_duration_ms: duration_ms)
  end

  # 앞뒤 이웃이 선택 런과 오디오 overlap(500ms 설계 상수) 하는 픽스처. 실제로 존재하는 형태다.
  let(:overlapping_plan) do
    described_class.new(
      rows: [
        row_class.new(1, 1, 0, 42_000),      # 다음 행 시작(41250)보다 늦게 끝난다 = 겹침
        row_class.new(2, 2, 41_250, 68_900),
        row_class.new(3, 3, 68_500, 90_000)  # 이전 행 끝(68900)보다 일찍 시작한다 = 겹침
      ],
      selected_ids: [ 2 ], audio_duration_ms: duration_ms
    )
  end

  describe "경계 클램프" do
    it "이웃과 gap이 있으면 행 ms가 아니라 gap 중간점을 쓴다" do
      r = plan_for([ 2 ]).ranges
      expect(r.length).to eq(1)
      expect(r.first.start_ms).to eq((40_000 + 41_250) / 2)   # 40625
      expect(r.first.end_ms).to eq((68_900 + 70_000) / 2)     # 69450
    end

    it "이전 행이 없으면 0부터, 다음 행이 없으면 오디오 끝까지" do
      first = plan_for([ 1 ]).ranges.first
      expect(first.start_ms).to eq(0)
      last = plan_for([ 5 ]).ranges.first
      expect(last.end_ms).to eq(duration_ms)
    end

    it "이웃과 겹치면(overlap) 클램프하지 않고 행 ms를 그대로 쓴다" do
      r = overlapping_plan.ranges.first
      expect(r.start_ms).to eq(41_250)
      expect(r.end_ms).to eq(68_900)
    end

    it "겹치는 이웃 때문에 완전성 검사가 깨지지 않는다 (영구 409 방지)" do
      # ⭐ 이 단언이 없어서 사각이 생겼던 자리다. 클램프를 포기하면 cut_start == run_start 라
      # prev.ended_at_ms > cut_start 가 정의상 참 → 면제가 없으면 complete? 가 영원히 false 다.
      expect(overlapping_plan.unselected_overlapping_ids).to be_empty
      expect(overlapping_plan).to be_complete
    end

    it "면제는 그 경계에만 적용된다 — 다른 구간에서는 같은 행이 여전히 잡힌다" do
      # 면제를 플랜 전역 합집합으로 바꾸면 red 가 되는 **판별력 있는** 픽스처다(실측 확인:
      # per-range → [3] / complete? false, global-union → [] / complete? true).
      # 핵심은 3이 A 에서만 면제된다는 것이다: 3은 A 의 겹치는 next 이웃이라 A 에서 면제되지만,
      # B 의 이웃은 4라서 B 의 면제 목록은 비어 있다. 그런데 3은 B 와도 겹친다.
      # 전역 합집합이면 3이 B 에서도 면제되어 진짜 잔존을 놓친다.
      rows_x = [
        row_class.new(1, 1, 0, 500),
        row_class.new(2, 2, 1_000, 5_000),      # 선택 → A
        row_class.new(3, 3, 4_000, 30_000),     # A 의 겹치는 next(면제) + B 와도 겹침
        row_class.new(4, 4, 10_000, 12_000),    # B 의 prev
        row_class.new(5, 5, 20_000, 25_000),    # 선택 → B
        row_class.new(6, 6, 40_000, 45_000)
      ]
      plan = described_class.new(rows: rows_x, selected_ids: [ 2, 5 ], audio_duration_ms: 100_000)
      expect(plan.range_bounds).to eq([ [ 750, 5_000 ], [ 16_000, 32_500 ] ])
      expect(plan.ranges.first.exempt_ids).to eq([ 3 ])
      expect(plan.ranges.last.exempt_ids).to be_empty
      expect(plan.unselected_overlapping_ids).to eq([ 3 ])
      expect(plan).not_to be_complete
    end

    it "면제되지 않은 행이 구간과 겹치면 그대로 잡는다 (면제가 과잉적용되지 않음)" do
      intruder = rows + [ row_class.new(99, 6, 50_000, 52_000) ]
      plan = described_class.new(rows: intruder.sort_by(&:sequence_number),
                                 selected_ids: [ 2 ], audio_duration_ms: duration_ms)
      expect(plan.unselected_overlapping_ids).to include(99)
    end
  end

  describe "런 묶기와 병합" do
    it "비연속 선택은 구간 2개가 된다" do
      expect(plan_for([ 2, 4 ]).ranges.length).to eq(2)
    end

    it "연속 선택은 구간 1개로 묶인다" do
      r = plan_for([ 2, 3 ]).ranges
      expect(r.length).to eq(1)
      expect(r.first.start_ms).to eq(40_625)
      expect(r.first.end_ms).to eq((90_000 + 121_000) / 2)   # 105500
    end

    it "맞닿는 구간은 하나로 병합된다" do
      # 1과 3을 고르면 구간은 [0, 40625]와 [69450, 105500] — 병합되지 않는다.
      # 1,2,3을 고르면 하나의 런이므로 [0, 105500] 하나다.
      r = plan_for([ 1, 2, 3 ]).ranges
      expect(r.length).to eq(1)
      expect(r.first.start_ms).to eq(0)
      expect(r.first.end_ms).to eq(105_500)
    end
  end

  describe "#total_cut_ms / #delta_for — 다중 구간 누적" do
    it "마지막 구간 뒤 시점의 delta는 두 구간 길이의 합이다" do
      plan = plan_for([ 2, 4 ])
      len1 = 69_450 - 40_625
      len2 = (134_500 + 140_000) / 2 - (90_000 + 121_000) / 2
      expect(plan.total_cut_ms).to eq(len1 + len2)
      expect(plan.delta_for(150_000)).to eq(len1 + len2)
    end

    it "구간 사이 시점은 앞 구간 길이만 당긴다" do
      plan = plan_for([ 2, 4 ])
      expect(plan.delta_for(70_000)).to eq(69_450 - 40_625)
    end

    it "첫 구간 이전 시점은 0이다" do
      expect(plan_for([ 2, 4 ]).delta_for(10_000)).to eq(0)
    end
  end

  describe "#unselected_overlapping_ids / #complete?" do
    it "선택 밖 행이 경계에 걸치지 않으면 완전하다" do
      expect(plan_for([ 2 ])).to be_complete
    end

    it "구간 안으로 새로 삽입된 행이 선택 밖이면 잡아낸다" do
      with_inserted = rows + [ row_class.new(99, 2, 50_000, 52_000) ]
      plan = described_class.new(rows: with_inserted.sort_by(&:started_at_ms),
                                 selected_ids: [ 2 ], audio_duration_ms: duration_ms)
      expect(plan.unselected_overlapping_ids).to include(99)
      expect(plan).not_to be_complete
    end
  end

  describe "#uncovered_selected_ids — 선택 행이 절단 구간 밖에 놓이는 것(fail-closed)" do
    # sequence_number 는 시간 순도 아니고 유일하지도 않다: transcription_job.rb:70 이 한 청크의
    # 모든 segment 에 같은 chunk index 를 박고, mic(useAudioRecorder.ts:315)·
    # system(useLiveRecording.ts:240) 스트림이 독립 카운터를 쓴다. 그래서 런의 시간 범위를
    # run.first/run.last 로 잡으면 구간이 선택 행보다 짧아져 **오디오는 엉뚱한 데를 자르고
    # 기밀 전사는 남는다**. remaining_rows 만 보는 unselected_overlapping_ids 는 이걸 못 잡는다.
    let(:disordered) do
      [
        row_class.new(1, 1, 0, 40_000),
        row_class.new(2, 2, 41_250, 68_900),
        row_class.new(99, 2, 50_000, 52_000),  # seq 중복 + 시간상 2 안에 들어감
        row_class.new(3, 3, 70_000, 90_000)
      ]
    end

    it "런의 경계는 sequence 순서가 아니라 실제 시간 min/max 로 잡는다" do
      # run.first.started_at_ms / run.last.ended_at_ms 로 되돌리면 run_end 가 52000 이 되어
      # 구간이 [40625, 61000] 으로 짧아지고 row2 의 [61000, 68900] 오디오가 살아남는다.
      plan = described_class.new(rows: disordered, selected_ids: [ 2, 99 ], audio_duration_ms: duration_ms)
      expect(plan.range_bounds).to eq([ [ 40_625, 69_450 ] ])
      expect(plan.uncovered_selected_ids).to be_empty
      expect(plan).to be_complete
    end

    it "선택 행이 구간에 완전히 들어가지 않으면 계획을 무효로 판정한다" do
      # 시간상 서로 얽힌 두 선택 행 사이에 선택되지 않은 행이 sequence 로 끼어들어 런이 쪼개지고,
      # 각 런의 구간이 상대 런의 행을 덮지 못하는 형태를 직접 구성한다.
      plan = described_class.new(rows: disordered, selected_ids: [ 2, 99 ], audio_duration_ms: duration_ms)
      # 구간을 강제로 좁혀(= 계산 버그가 났다고 가정) 불변식이 실제로 잡는지 확인한다.
      plan.ranges.first.end_ms = 61_000
      expect(plan.uncovered_selected_ids).to eq([ 2 ])
      expect(plan).not_to be_complete
    end
  end

  describe "#shift_deltas_for — 면제 이웃의 ms 시프트" do
    # 면제된 이웃은 **유일하게 절단 경계를 실제로 가로지르는 남은 행**이다. delta_for 의 술어는
    # `r.end_ms <= ms` 라, 면제된 next 이웃은 cut_end 가 자기 시작보다 뒤여서 delta 0 을 받는 반면
    # 그 뒤 행들은 구간 길이 전체만큼 당겨진다 → 이웃이 뒤 행보다 뒤에 놓이는 타임라인 붕괴.
    let(:neighbor_plan) do
      described_class.new(
        rows: [
          row_class.new(1, 1, 0, 42_000),       # 겹치는 prev → 면제, 왼쪽으로 삐져나옴
          row_class.new(2, 2, 41_250, 68_900),  # 선택
          row_class.new(3, 3, 68_500, 90_000),  # 겹치는 next → 면제, 오른쪽으로 삐져나옴
          row_class.new(4, 4, 95_000, 100_000)  # 평범한 뒤 행
        ],
        selected_ids: [ 2 ], audio_duration_ms: duration_ms
      )
    end

    def shifted(plan, id)
      row = plan.remaining_rows.find { |r| r.id == id }
      started_delta, ended_delta = plan.shift_deltas_for(row)
      [ row.started_at_ms - started_delta, row.ended_at_ms - ended_delta ]
    end

    it "면제 이웃을 절단 경계로 클램프한 뒤 시프트해 타임라인이 이어진다" do
      cut_start = 41_250
      cut_len = 68_900 - 41_250
      # prev 이웃: 구간에 잠긴 꼬리를 잘라내고 cut_start 에서 끝난다.
      expect(shifted(neighbor_plan, 1)).to eq([ 0, cut_start ])
      # next 이웃: 구간에 잠긴 머리를 잘라내고 cut_start 에서 시작한다(= prev 이웃의 끝과 맞닿는다).
      expect(shifted(neighbor_plan, 3)).to eq([ cut_start, 90_000 - cut_len ])
      # 뒤 행은 구간 길이만큼 당겨진다 — 이웃과 같은 기준.
      expect(shifted(neighbor_plan, 4)).to eq([ 95_000 - cut_len, 100_000 - cut_len ])
    end

    it "면제 이웃과 그 다음 행의 순서가 뒤집히지 않는다" do
      # 고치기 전에는 row3 이 [68500, 90000] 에 남고 row4 가 [67350, 72350] 으로 당겨져
      # row3 이 row4 보다 **뒤**에 놓였다.
      n3 = shifted(neighbor_plan, 3)
      n4 = shifted(neighbor_plan, 4)
      expect(n3.first).to be <= n3.last          # 자기 경계부터 뒤집히지 않는다
      expect(n3.last).to be <= n4.first
      expect(shifted(neighbor_plan, 1).last).to be <= n3.first
    end

    it "구간과 무관한 행은 started/ended 에 같은 delta 를 쓴다" do
      row = neighbor_plan.remaining_rows.find { |r| r.id == 4 }
      expect(neighbor_plan.shift_deltas_for(row).uniq.length).to eq(1)
    end
  end

  describe "audio_duration_ms 가 실제 타임라인과 어긋날 때" do
    it "오디오 길이가 0이어도(온디바이스 STT = 서버 오디오 없음) 역전 구간을 만들지 않는다" do
      # measure_audio_duration_ms(meeting.rb:117-125)는 audio_file_path 가 nil·파일 부재·ffprobe
      # 실패 시 0 을 반환한다. 온디바이스 STT 회의는 **정상 케이스**라 422 로 막으면 안 된다.
      # 그대로 두면 cut_start > cut_end 역전이 생겨 length_ms 가 음수가 되고, delta_for 의
      # `r.end_ms <= ms` 가 모든 행에 참이 되어 절단과 무관한 앞쪽 행까지 음수 delta 로 밀린다.
      plan = described_class.new(rows: rows, selected_ids: [ 5 ], audio_duration_ms: 0)
      expect(plan.ranges.first.start_ms).to eq(137_250)
      expect(plan.ranges.first.end_ms).to eq(160_000)  # 마지막 행의 끝 = 타임라인 끝
      expect(plan.ranges.first.length_ms).to be_positive
      expect(plan.delta_for(10_000)).to eq(0)          # 앞쪽 행은 밀리지 않는다
      expect(plan.kept_segments).to eq([])             # 자를 오디오가 없다
      expect(plan.total_cut_ms).to eq(0)
    end

    it "전사 ms가 실측 오디오 길이를 넘으면 경계를 오디오 길이로 클램프한다" do
      # audio_duration_ms 는 ffprobe 실측이고 전사 ms 는 클라이언트 오프셋 파생이라
      # max(ended_at_ms) > audio_duration_ms 가 가능하다. 클램프하지 않으면 kept_segments 는
      # e > s 필터로 꼬리 쌍을 버리는데 total_cut_ms 는 초과분을 그대로 더해,
      # cut_to_temp 의 길이 검증(expected = src_duration_ms - total_cut_ms)이 어긋나 실패한다.
      short = 120_000
      plan = described_class.new(rows: rows, selected_ids: [ 4 ], audio_duration_ms: short)
      kept_total = plan.kept_segments.sum { |s, e| e - s }
      expect(plan.kept_segments).to eq([ [ 0, 105_500 ] ])
      expect(plan.total_cut_ms).to eq(short - kept_total)
    end

    it "역전 구간은 조용히 통과시키지 않고 즉시 raise 한다" do
      # min/max 런 경계가 들어간 뒤로는 구성상 도달 불가다(cut_start <= run_start <= run_end <= cut_end).
      # 그래도 두는 이유: 도달 불가한 가드가 울리면 진짜 불변식이 깨진 것이므로 조용히 409 를
      # 내는 것보다 크게 실패해야 한다("동시 변경" 메시지는 데이터 손상에 대한 거짓말이다).
      corrupt = [
        row_class.new(1, 1, 0, 1_000),
        row_class.new(2, 2, 5_000, 2_000)   # ended < started (손상)
      ]
      expect {
        described_class.new(rows: corrupt, selected_ids: [ 2 ], audio_duration_ms: 0)
      }.to raise_error(described_class::InvalidRangeError, /역전/)
    end
  end

  describe "CutRange · 행 분류 접근자" do
    it "#range_bounds 는 [start, end] 쌍만 준다 (Task 6 의 트랜잭션 내 재검증 비교 키)" do
      expect(plan_for([ 2, 4 ]).range_bounds).to eq([ [ 40_625, 69_450 ], [ 105_500, 137_250 ] ])
    end

    it "#bounds 는 면제 목록을 뺀 값이라 면제 차이만으로 '경계가 달라졌다'고 오판하지 않는다" do
      a = described_class::CutRange.new(100, 200, [ 7 ])
      b = described_class::CutRange.new(100, 200, [])
      expect(a.bounds).to eq(b.bounds)   # 경계는 같다 → ffmpeg 산출물 재사용 가능
      expect(a).not_to eq(b)             # Struct#== 를 그대로 쓰면 다르다고 본다
    end

    it "#length_ms 는 경계 차이다" do
      expect(described_class::CutRange.new(100, 350, []).length_ms).to eq(250)
      expect(plan_for([ 2 ]).ranges.first.length_ms).to eq(69_450 - 40_625)
    end

    it "#cover? 는 반열림 구간 [start, end) 이다" do
      range = described_class::CutRange.new(100, 200, [])
      expect(range.cover?(100)).to be(true)
      expect(range.cover?(199)).to be(true)
      expect(range.cover?(200)).to be(false)   # 끝은 포함하지 않는다 — delta 규칙과 맞춘다
      expect(range.cover?(99)).to be(false)
    end

    it "#selected_rows / #remaining_rows 는 정렬 순서로 행을 가른다" do
      plan = described_class.new(rows: rows, selected_ids: [ 4, 2 ], audio_duration_ms: duration_ms)
      expect(plan.selected_rows.map(&:id)).to eq([ 2, 4 ])
      expect(plan.remaining_rows.map(&:id)).to eq([ 1, 3, 5 ])
    end

    it "존재하지 않는 id 는 조용히 무시한다" do
      plan = described_class.new(rows: rows, selected_ids: [ 2, 999 ], audio_duration_ms: duration_ms)
      expect(plan.selected_rows.map(&:id)).to eq([ 2 ])
      expect(plan.remaining_rows.map(&:id)).to eq([ 1, 3, 4, 5 ])
    end
  end

  describe "#audio_shortfall_ms / #unsafe_partial_cut?" do
    # ⭐ A1. 오디오가 전사 타임라인보다 짧으면 "타임라인 ms = 오디오 ms" 선형 매핑이 깨진다.
    # kept_segments 가 경계를 [0, audio_duration_ms] 로 **클립**하므로 구간이 오디오 밖으로
    # 나가면 오디오에서는 아무것도 잘리지 않는데, 그 오디오에 기밀 발화가 들어 있을 수 있다
    # (merge_audio_files 실패로 최신 세그먼트만 저장 / 온디바이스 STT / 잘린 업로드).
    let(:short_audio_plan) do
      described_class.new(rows: rows, selected_ids: [ 5 ], audio_duration_ms: 3_000)
    end

    it "오디오가 타임라인보다 짧으면 부족분을 보고한다" do
      expect(short_audio_plan.audio_shortfall_ms).to eq(160_000 - 3_000)
    end

    it "40분 타임라인 / 3초 오디오에서 뒤쪽 행을 고르면 오디오가 한 조각도 안 잘린다" do
      # 반증의 핵심: 이 상태를 정상이라고 선언하면 기밀 오디오가 그대로 남는다.
      expect(short_audio_plan.total_cut_ms).to eq(0)
      expect(short_audio_plan.kept_segments).to eq([ [ 0, 3_000 ] ])
      expect(short_audio_plan.unsafe_partial_cut?).to be(true)
    end

    it "오디오가 타임라인을 덮으면 안전하다" do
      expect(plan_for([ 2 ]).audio_shortfall_ms).to eq(0)
      expect(plan_for([ 2 ]).unsafe_partial_cut?).to be(false)
    end

    it "1초 이내 드리프트는 정상으로 본다 (전사 ms 는 클라이언트 오프셋 파생이라 조금 넘칠 수 있다)" do
      plan = described_class.new(rows: rows, selected_ids: [ 2 ], audio_duration_ms: 159_500)
      expect(plan.audio_shortfall_ms).to eq(500)
      expect(plan.unsafe_partial_cut?).to be(false)
    end

    it "전사 전체 선택은 오디오를 통째로 파기하므로 짧은 오디오에서도 안전하다" do
      # 남는 오디오가 없으면 매핑을 몰라도 기밀이 남지 않는다 — 이게 사용자에게 안내하는 탈출구다.
      plan = described_class.new(rows: rows, selected_ids: [ 1, 2, 3, 4, 5 ], audio_duration_ms: 3_000)
      expect(plan.kept_segments).to eq([])
      expect(plan.unsafe_partial_cut?).to be(false)
    end

    it "서버 오디오가 아예 없으면(0) 부족분을 따지지 않는다 (온디바이스 STT 정상 케이스)" do
      # audio_duration_ms == 0 은 '오디오 없음'이고 전사만 파기하는 정상 경로다. 여기에 422 를
      # 쓰지 않기로 한 이전 라운드의 결정과 충돌하지 않게, 0 은 부족분 판정에서 제외한다.
      plan = described_class.new(rows: rows, selected_ids: [ 2 ], audio_duration_ms: 0)
      expect(plan.audio_shortfall_ms).to eq(0)
      expect(plan.unsafe_partial_cut?).to be(false)
    end
  end

  describe "#unselected_contained_ids" do
    # ⭐ A6. 절단 구간 **안에 완전히 들어간** 미선택 행은 동시 변경이 아니라 정적인 데이터 배치라
    # 새로고침으로 해소되지 않는다. 가장자리만 걸친 행과 구분해 안내 문구를 나눈다.
    it "구간 안에 통째로 들어간 미선택 행만 고른다" do
      contained = row_class.new(6, 6, 41_500, 42_000) # run [41250,68900] 안
      plan = described_class.new(
        rows: rows + [ contained ], selected_ids: [ 2 ], audio_duration_ms: duration_ms
      )
      expect(plan.unselected_overlapping_ids).to include(6)
      expect(plan.unselected_contained_ids).to eq([ 6 ])
    end

    it "가장자리만 걸친 행은 contained 가 아니다" do
      # 이웃과 오디오 overlap 이 있으면 클램프를 포기하므로(면제) 그 이웃은 애초에 잡히지 않는다.
      # 면제 대상이 아니면서 경계를 가로지르는 행만 여기 해당한다.
      crosser = row_class.new(6, 6, 39_000, 42_000) # 구간 시작(40625)을 가로지른다
      plan = described_class.new(
        rows: rows + [ crosser ], selected_ids: [ 2 ], audio_duration_ms: duration_ms
      )
      expect(plan.unselected_overlapping_ids).to include(6)
      expect(plan.unselected_contained_ids).to eq([])
    end
  end

  describe "#kept_segments" do
    it "구간의 여집합을 [start, end] 배열로 준다" do
      expect(plan_for([ 2 ]).kept_segments).to eq([ [ 0, 40_625 ], [ 69_450, 180_000 ] ])
    end

    it "0에서 시작하는 구간은 길이 0 선두 세그먼트를 만들지 않는다" do
      expect(plan_for([ 1 ]).kept_segments).to eq([ [ 40_625, 180_000 ] ])
    end

    it "전체를 고르면 남길 세그먼트가 없다" do
      expect(plan_for([ 1, 2, 3, 4, 5 ]).kept_segments).to eq([])
    end
  end
end
