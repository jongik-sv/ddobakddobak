# 기밀 구간 절단의 순수 계산부. 파일·DB I/O 없음.
# 선택된 전사 행 id → sequence_number 연속 런 → 이웃 gap 중간점으로 클램프된 절단 경계 →
# 병합 → 누적 delta / 겹침 완전성 / 남길 오디오 세그먼트.
# 설계: docs/superpowers/specs/2026-07-31-transcript-redact-range-design.md
class TranscriptRedactionPlan
  # 절단 구간이 역전(end < start)됐다는 것은 경계 계산 불변식이 깨졌다는 뜻이다. 409("다른 곳에서
  # 전사가 변경되었습니다")로 내보내면 데이터 손상에 대해 거짓말을 하는 셈이고 사용자는 새로고침만
  # 반복한다. 파괴적·복구 불가 연산이므로 크게 실패시킨다.
  class InvalidRangeError < StandardError; end

  # exempt_ids: 이 경계에서 **클램프를 포기한** 이웃 행 id (0~2개). 이웃과 오디오 overlap 이
  # 있으면 클램프하지 않고 행 ms 를 그대로 쓰는데(설계 §절단 경계 계산), 그러면 그 이웃은
  # 정의상 항상 경계와 겹쳐 완전성 검사가 영구히 false 가 된다 — 사용자는 새로고침해도 못 고치는
  # 409 에 갇힌다. 그 이웃만 **이 경계에 한해** 면제한다.
  # 면제를 플랜 전역 집합으로 두면 안 된다: run A 의 이웃으로 면제된 행이 병합된 다른 구간
  # 안에 통째로 들어가 있을 때 그 구간에서도 면제되어 진짜 잔존을 놓친다. 구간별로 들고 다니고
  # merge 시에만 합집합을 취한다.
  CutRange = Struct.new(:start_ms, :end_ms, :exempt_ids) do
    def length_ms
      end_ms - start_ms
    end

    def cover?(ms)
      ms >= start_ms && ms < end_ms
    end

    def exempt?(row_id)
      Array(exempt_ids).include?(row_id)
    end

    # ffmpeg 산출물 재사용 가부 판정용 비교 키. exempt_ids 는 경계값이 아니므로 제외한다
    # (Struct#== 를 그대로 쓰면 면제 목록 차이만으로 "경계가 달라졌다"고 오판한다).
    def bounds
      [ start_ms, end_ms ]
    end
  end

  # 전사 타임라인이 실측 오디오보다 이만큼 넘치는 것까지는 정상으로 본다. 전사 ms 는 클라이언트
  # 오프셋 파생이고 ffprobe 길이는 컨테이너 실측이라 끝단이 수백 ms 어긋나는 것은 흔하다.
  AUDIO_SHORTFALL_TOLERANCE_MS = 1_000

  attr_reader :ranges, :timeline_end_ms

  # rows: 이 회의의 전사 행 전부(부분집합이면 이웃 클램프가 틀어진다)
  def initialize(rows:, selected_ids:, audio_duration_ms:)
    # 전순서(total order) 로 정렬한다. `sort_by(&:sequence_number)` 만으로는 안 된다 —
    # Ruby 의 sort_by 는 **안정 정렬이 아니고**, sequence_number 는 유일하지 않다:
    # transcription_job.rb:70 이 한 청크의 모든 segment 에 같은 chunk index 를 박고,
    # mic(useAudioRecorder.ts:315)·system(useLiveRecording.ts:240) 스트림이 독립 카운터를 쓴다.
    # 동점이면 이웃 선정·런 묶기가 실행마다 달라져 절단 경계가 비결정적이 된다.
    @rows = rows.sort_by { |r| [ r.sequence_number, r.started_at_ms, r.id ] }
    @selected_ids = Array(selected_ids).map(&:to_i).uniq
    @audio_duration_ms = [ audio_duration_ms.to_i, 0 ].max
    # 타임라인 끝 ≠ 오디오 끝. audio_duration_ms 는 ffprobe 실측이고 전사 ms 는 클라이언트 오프셋
    # 파생이라 둘은 어긋날 수 있다. 특히 measure_audio_duration_ms(meeting.rb:117-125)는
    # 파일 부재·ffprobe 실패 시 **0** 을 돌려주는데, 온디바이스 STT 회의는 서버 오디오가 없는
    # 정상 케이스다. 여기서 0 을 그대로 절단 끝으로 쓰면 역전 구간이 생긴다 → 둘 중 큰 값을 쓴다.
    # (오디오 쪽 클램프는 kept_segments/total_cut_ms 가 따로 한다 — 아래.)
    @timeline_end_ms = (@rows.map(&:ended_at_ms) + [ @audio_duration_ms, 0 ]).max
    @ranges = merge(runs.map { |run| clamp(run) })
  end

  def selected_rows
    @selected_rows ||= @rows.select { |r| @selected_ids.include?(r.id) }
  end

  def remaining_rows
    @remaining_rows ||= @rows.reject { |r| @selected_ids.include?(r.id) }
  end

  # 잘려나가는 **오디오** 길이. 정의상 항상 `audio_duration_ms - Σkept_segments` 다.
  # 구간 길이를 그냥 더하면 안 된다 — 경계가 EOF 를 넘을 때 kept_segments 는 꼬리 쌍을 버리는데
  # 여기서는 초과분을 더해, cut_to_temp 의 길이 검증(expected = src_duration_ms - total_cut_ms)이
  # 실측과 어긋나 절단이 실패한다. 오디오가 없으면(duration 0) 자를 것도 없으므로 0 이다.
  def total_cut_ms
    @audio_duration_ms - kept_segments.sum { |s, e| e - s }
  end

  # delta(t) = Σ (end - start), 단 end <= t 인 구간만. **시점 하나**의 시프트량이다.
  # ⚠️ 행에 그대로 쓰지 말 것 — 행 단위 시프트는 shift_deltas_for(row) 를 쓴다.
  # 완전성 검사를 통과한 행은 대부분 구간을 가로지르지 않아 started/ended 의 delta 가 같지만,
  # **면제된 이웃**은 예외다(클램프를 포기해 경계를 실제로 가로지른다). 여기에 started_at_ms 만
  # 넣으면 그 이웃이 delta 0 을 받아 뒤 행보다 뒤에 놓인다.
  def delta_for(ms)
    @ranges.select { |r| r.end_ms <= ms }.sum(&:length_ms)
  end

  # 남은 행 하나의 [started_delta, ended_delta]. 대부분의 행은 두 값이 같지만(완전성 검사를
  # 통과한 행은 구간을 가로지르지 않는다) **면제된 이웃만은 다르다** — 그 행이야말로 클램프를
  # 포기해서 경계를 실제로 가로지르게 된 유일한 행이다.
  # delta_for 만 쓰면 면제된 next 이웃은 cut_end 가 자기 시작보다 뒤라 delta 0 을 받는 반면 그
  # 뒤 행들은 구간 길이만큼 당겨져, 이웃이 뒤 행보다 뒤에 놓이는 타임라인 붕괴가 난다.
  # 값을 쌍으로 돌려주는 이유: 컨트롤러가 이 쌍으로 group_by 해 bulk update 를 유지할 수 있다
  # (행마다 UPDATE 를 날리면 SQLite write lock 을 오래 쥔다 — 이 저장소에 lock storm 이력 있음).
  def shift_deltas_for(row)
    started, ended = clamped_bounds_for(row)
    [ row.started_at_ms - (started - delta_for(started)),
      row.ended_at_ms - (ended - delta_for(ended)) ]
  end

  # 절단 경계와 겹치는데 선택되지 않은 행 id. 비어 있지 않으면 409.
  # 그 경계에서 클램프를 포기한 이웃(exempt_ids)은 제외한다 — 안 그러면 overlap 이 있는 회의는
  # 영구히 절단 불가가 된다. 면제는 구간별이라 다른 구간 안에 들어간 같은 행은 여전히 잡힌다.
  def unselected_overlapping_ids
    remaining_rows.select { |row|
      @ranges.any? { |r| overlap?(row, r) && !exempt_here?(row, r) }
    }.map(&:id)
  end

  # 경계 목록의 값 비교용(면제 목록 제외). 컨트롤러가 트랜잭션 안에서 재계산한 플랜과 대조해
  # ffmpeg 산출물을 그대로 써도 되는지 판정한다.
  def range_bounds
    @ranges.map(&:bounds)
  end

  # ⭐ fail-closed 불변식. 선택된 행이 계산된 절단 구간 **안에 완전히** 들어갔는지 확인한다.
  # 왜 필요한가: 절단 경계는 런의 시간 범위에서 나오는데 런은 sequence_number 로 묶인다.
  # 그 값은 시간 순도 아니고 유일하지도 않아(위 정렬 주석) 계산이 어긋나면 선택 행이 구간 밖에
  # 놓일 수 있다 — 오디오는 엉뚱한 데를 자르고 기밀 전사는 살아남는다.
  # unselected_overlapping_ids 는 remaining_rows 만 보므로 이 실패를 원리적으로 못 잡는다.
  # min/max 런 경계가 들어간 지금은 구성상 도달 불가에 가깝지만, 파괴적·복구 불가 연산이라
  # 계산이 깨졌을 때 조용히 진행하는 것보다 거부하는 쪽이 옳다.
  def uncovered_selected_ids
    selected_rows.reject { |row|
      @ranges.any? { |r| r.start_ms <= row.started_at_ms && r.end_ms >= row.ended_at_ms }
    }.map(&:id)
  end

  # ⭐ 미선택 겹침 중 구간 **안에 완전히 들어간** 행. unselected_overlapping_ids 의 부분집합이다.
  # 원인이 다르다: 가장자리 겹침은 경계 계산·동시 split 처럼 재조회로 상황이 달라질 수 있지만,
  # 완전 포함은 **정적인 데이터 배치**라 새로고침을 백 번 해도 같은 결과가 나온다. 해법은 하나뿐
  # ("그 행도 함께 선택한다") 이므로 호출부가 문구를 갈라 그 행 id 를 알려줘야 한다.
  def unselected_contained_ids
    remaining_rows.select { |row|
      @ranges.any? { |r|
        overlap?(row, r) && !exempt_here?(row, r) &&
          row.started_at_ms >= r.start_ms && row.ended_at_ms <= r.end_ms
      }
    }.map(&:id)
  end

  # ⭐ fail-closed 불변식 (A1). 실측 오디오가 전사 타임라인보다 **짧은** 상태.
  # 이 클래스는 "타임라인 ms == 오디오 ms" 선형 매핑을 전제로 경계를 계산하는데, 그 전제가
  # 깨지는 실제 경로가 있다: merge_audio_files 실패 분기(최신 세그먼트만 저장)·온디바이스 STT·
  # 잘린 업로드. 그때 오디오 파일의 0ms 는 회의 시작이 아니라 **어딘가 중간**이다.
  #
  # audio_duration_ms == 0 은 여기서 제외한다. 그건 "짧은 오디오"가 아니라 "서버 오디오 없음"
  # (온디바이스 STT 회의의 정상 상태)이고, 전사만 파기하는 기존 경로가 그대로 처리한다 —
  # 이전 라운드가 이 케이스에 422 를 쓰지 않기로 한 결정과 충돌하지 않게 0 은 부족분 0 으로 둔다.
  # (오디오 파일이 디스크에 있는데 길이만 0 인 위험 케이스는 컨트롤러가 audio_paths 로 따로 막는다.)
  def audio_shortfall_ms
    return 0 if @audio_duration_ms.zero?

    [ @timeline_end_ms - @audio_duration_ms, 0 ].max
  end

  # 매핑을 신뢰할 수 없는데 **오디오가 일부 남는** 절단인가. 남는 게 있으면 그 안에 기밀 발화가
  # 살아 있을 수 있다(kept_segments 가 경계를 오디오 길이로 클립하므로 조용히 통과한다).
  # 반대로 남는 세그먼트가 하나도 없으면(전사 전체 선택 → 오디오 통째 파기) 매핑을 몰라도
  # 기밀이 남지 않는다 — 그래서 그 경로는 막지 않는다. 사용자에게 안내하는 탈출구가 이것이다.
  def unsafe_partial_cut?
    audio_shortfall_ms > AUDIO_SHORTFALL_TOLERANCE_MS && kept_segments.any?
  end

  # 컨트롤러는 이것만 보면 된다 — 두 불변식 중 하나라도 깨지면 절단을 진행하지 않는다.
  # 원인 구분이 필요하면 unselected_overlapping_ids(동시 변경 → 409) 와
  # uncovered_selected_ids(계산 불변식 위반 → 422) 를 각각 조회한다.
  def complete?
    unselected_overlapping_ids.empty? && uncovered_selected_ids.empty?
  end

  # 남길 오디오 세그먼트 [start_ms, end_ms]. 길이 0 이하는 버린다 —
  # 그대로 두면 asplit=N 의 N 이 어긋나고 빈 atrim 세그먼트가 생긴다.
  def kept_segments
    bounds = [ 0 ]
    # 구간은 타임라인 공간(@timeline_end_ms)이지만 여기는 **실제 오디오** 공간이다.
    # 전사 ms 가 실측 길이를 넘으면 경계도 넘으므로 오디오 길이로 클램프한다. 클램프해도
    # 단조 비감소라 아래 each_slice(2) 짝짓기는 그대로 성립한다(길이 0 쌍은 뒤에서 버려진다).
    @ranges.each { |r| bounds << clip_to_audio(r.start_ms) << clip_to_audio(r.end_ms) }
    bounds << @audio_duration_ms
    bounds.each_slice(2).map { |s, e| [ s, e ] }.select { |s, e| e > s }
  end

  private

  def row_index
    @row_index ||= @rows.each_with_index.to_h { |r, i| [ r.id, i ] }
  end

  def clip_to_audio(ms)
    ms.clamp(0, @audio_duration_ms)
  end

  # 모든 CutRange 생성 지점의 단일 통로. 역전 구간을 여기서 막지 않으면 length_ms 가 음수가 되고
  # overlap? 이 정의상 false 라 완전성 검사를 **조용히** 통과한다(= 오디오만 엉뚱하게 잘린다).
  # 길이 0 은 허용한다 — 경계가 겹치는 이웃 사이에 낀 길이 0 전사 행에서 정상적으로 나올 수 있고,
  # 자를 오디오가 없을 뿐 위험하지 않다(선택 행은 여전히 uncovered 검사가 덮는다).
  def build_range(start_ms, end_ms, exempt_ids)
    if end_ms < start_ms
      raise InvalidRangeError,
            "절단 구간이 역전되었습니다(start=#{start_ms}, end=#{end_ms}) — 경계 계산 불변식 위반"
    end

    CutRange.new(start_ms, end_ms, exempt_ids)
  end

  def overlap?(row, range)
    row.started_at_ms < range.end_ms && row.ended_at_ms > range.start_ms
  end

  # 면제 이웃의 "구간에 잠긴 쪽"을 절단 경계까지 밀어낸 경계. 나머지 행은 원래 값 그대로다.
  # find 가 안전한 근거: 완전성 검사를 통과한 플랜에서 면제가 살아 있는 행은 반드시 그 구간
  # **밖으로 삐져나와 있다**. 병합으로 구간이 넓어져 안쪽에 갇힌 행은 exempt_here? 가 false 가
  # 되어 unselected_overlapping_ids 에 잡히고 플랜 자체가 거부되기 때문이다(위 exempt_here? 주석).
  def clamped_bounds_for(row)
    range = @ranges.find { |r| overlap?(row, r) && exempt_here?(row, r) }
    return [ row.started_at_ms, row.ended_at_ms ] unless range

    sticks_left  = row.started_at_ms < range.start_ms
    sticks_right = row.ended_at_ms > range.end_ms
    if sticks_left && sticks_right
      # 구간을 통째로 삼킨 행 — 가운데만 파기되어 단일 delta 로 표현할 수 없다.
      # 지금은 클램프하지 않고 그대로 둔다(기존 동작 유지). 후속 과제.
      [ row.started_at_ms, row.ended_at_ms ]
    elsif sticks_left
      [ row.started_at_ms, [ row.ended_at_ms, range.start_ms ].min ]
    else
      [ [ row.started_at_ms, range.end_ms ].max, row.ended_at_ms ]
    end
  end

  # 면제는 "클램프를 포기해서 생긴 **가장자리** 겹침"에만 유효하다. id 목록에 들어 있다는 사실만으로
  # 면제하면, 구간 **안에 통째로 들어간** 행까지 통과한다 — 그 행은 이웃이 아니라 침입자이고
  # (구간 안으로 새로 삽입된 행·이어녹음으로 붙은 행), 오디오는 파기되는데 전사 텍스트만 살아남는
  # "절반만 잘림"이 된다. ms 시프트도 못 받아 타임라인까지 어긋난다.
  # 그래서 id 매칭이 아니라 **경계 조건**으로 판정한다: 구간 밖으로 삐져나온 행만 면제한다.
  # range 는 병합 후의 구간이므로, 병합으로 구간이 넓어져 이제 완전히 포함된 이웃도 여기서 잡힌다.
  def exempt_here?(row, range)
    range.exempt?(row.id) &&
      (row.started_at_ms < range.start_ms || row.ended_at_ms > range.end_ms)
  end

  # 선택 행을 sequence_number 연속 런으로 자른다(비연속 선택 = 구간 여러 개).
  def runs
    picked = selected_rows
    return [] if picked.empty?

    picked.slice_when { |a, b| row_index[b.id] != row_index[a.id] + 1 }.to_a
  end

  # 런 하나의 절단 경계. 행 ms 를 그대로 쓰면 인접 발언을 깎는다(오디오 overlap 500ms).
  # 클램프를 포기한 이웃은 exempt_ids 로 이 경계에 한해 완전성 검사에서 면제한다(위 CutRange 주석).
  def clamp(run)
    prev_row = row_index[run.first.id].positive? ? @rows[row_index[run.first.id] - 1] : nil
    next_row = @rows[row_index[run.last.id] + 1]
    # run.first / run.last 를 쓰면 안 된다 — 그건 sequence_number 순서인데 그 값은 **시간 순이
    # 아니고 유일하지도 않다**(위 정렬 주석). 런 안에서 순서가 뒤집히면 절단 경계가 선택 행보다
    # 짧아져 기밀 오디오가 살아남는다. 실제 시간 범위인 min/max 를 쓴다.
    run_start = run.map(&:started_at_ms).min
    run_end   = run.map(&:ended_at_ms).max
    exempt = []

    cut_start =
      if prev_row.nil?
        0
      elsif prev_row.ended_at_ms < run_start
        (prev_row.ended_at_ms + run_start) / 2 # gap 중간점
      else
        exempt << prev_row.id                  # 겹침이면 클램프하지 않는다 → 이 경계에서만 면제
        run_start
      end

    cut_end =
      if next_row.nil?
        @timeline_end_ms
      elsif run_end < next_row.started_at_ms
        (run_end + next_row.started_at_ms) / 2
      else
        exempt << next_row.id
        run_end
      end

    build_range(cut_start, cut_end, exempt)
  end

  def merge(list)
    list.sort_by(&:start_ms).each_with_object([]) do |r, acc|
      last = acc.last
      if last && r.start_ms <= last.end_ms
        last.end_ms = [ last.end_ms, r.end_ms ].max
        last.exempt_ids = (last.exempt_ids | r.exempt_ids) # 병합된 구간은 면제도 합집합
      else
        acc << build_range(r.start_ms, r.end_ms, r.exempt_ids.dup)
      end
    end
  end
end
