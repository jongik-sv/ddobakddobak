# 연결 회의(previous_meeting) 문서의 "상단 고정 이전 요약 / 하단 현재 회의록" 절취선 분할·재조립.
# Meeting#seed_summary_from_previous!(블록 생성)과 MeetingSummarizationJob(요약 틱 보호)이 공유하는
# 단일 소스 — 양쪽이 각자 절취선을 찾아 자르면 표현식이 갈라질 위험이 있어 여기 한 곳으로 모은다.
# 절취선 상수(Meeting::PREVIOUS_MEETING_CUT_LINE)는 재정의하지 않고 그대로 참조한다(문자열 불변 요구사항).
module PreviousMeetingNotes
  # 상단 섹션 헤더. seed 가 최초 연결 시 1회만 붙이고, 연쇄 승계(#append_block) 때는 기존 것을 재사용한다.
  HEADER = "## 이전 회의 요약".freeze

  module_function

  # 절취선 기준으로 문서를 [상단(이전 요약 블록들, 없으면 nil), 하단(현재 회의록 본문)] 로 분할.
  # 절취선이 없으면(비연결·구 데이터·사용자가 절취선을 지운 경우) 문서 전체를 하단으로 취급 — 상단 nil.
  #
  # 절취선을 찾았더라도 그 앞에 HEADER(#{HEADER})가 없으면 이 절취선을 상단 경계로 인정하지
  # 않고 문서 전체를 하단으로 취급한다 — 구 seeded_merge 시절 문서는 LLM 지시로 절취선을
  # "논의 사항" 섹션 한가운데 인라인으로 삽입했다(상단 고정 구조 도입 이전). 이런 구 문서에서
  # 첫 절취선만 보고 자르면 회의 자신의 제목·핵심 요약까지 "상단"으로 오인 동결되고 하단에
  # 문서가 두 벌 남는다(실측: 회의 138 형태). HEADER 포함 여부는 include? 로 판정한다 —
  # start_with? 이면 사용자가 문서 앞에 제목 한 줄만 붙여도 보호가 풀리고, 구 문서엔 이 HEADER
  # 문자열 자체가 존재할 수 없어(상단 고정 구조 도입 후에만 쓰인 문구) include? 로도 안전하다.
  def split(text)
    text = text.to_s
    idx = text.index(Meeting::PREVIOUS_MEETING_CUT_LINE)
    return [ nil, text ] unless idx

    top = text[0...idx].to_s.rstrip
    return [ nil, text ] unless top.include?(HEADER)

    bottom = text[(idx + Meeting::PREVIOUS_MEETING_CUT_LINE.length)..].to_s.lstrip
    [ top.presence, bottom ]
  end

  # 상단(top) + 절취선 + 하단(bottom) 재조립. top 이 없으면(비연결) 절취선 없이 bottom 그대로 반환 —
  # 원래 절취선이 없던 문서에 새로 끼워 넣지 않는다(회귀 없음, split 의 역연산과 정확히 대응).
  def join(top, bottom)
    return bottom.to_s if top.blank?
    "#{top}\n\n#{Meeting::PREVIOUS_MEETING_CUT_LINE}\n\n#{bottom}".rstrip
  end

  # 이전 요약 섹션(top)에 새 회의 블록 하나를 추가한 새 top 을 반환.
  # existing_top 이 있으면(이미 HEADER 보유 — 연쇄 승계) 그 뒤에 이어붙이고,
  # 없으면(최초 연결) HEADER 부터 새로 생성한다 — 중복 헤더 생성 방지.
  def append_block(existing_top, title, block_body)
    heading = "### #{title.to_s.strip}"
    body = block_body.to_s.strip
    block = body.present? ? "#{heading}\n\n#{body}" : heading
    existing_top.presence ? "#{existing_top}\n\n#{block}" : "#{HEADER}\n\n#{block}"
  end

  # top(HEADER+블록들) 앞에 문서 제목(H1)을 배치. 연결 회의는 자기 제목이 "이전 회의 요약"보다
  # 먼저 나와야 한다(사용자 실사용 피드백). top 의 첫 줄(H1)은 항상 코드가 직접 관리하는 영역
  # (LLM·사용자 편집이 닿지 않는 pinned 영역)이므로, MeetingSummarizationJob 이 재조립할 때마다
  # (매 틱, realtime·final 공통) #strip_leading_h1 로 걷어낸 뒤 여기로 현재 title 을 다시
  # 얹어 최신 회의명을 반영한다 — seed 시점 제목으로 동결되지 않는다(회의명 변경 반영).
  # Meeting#seed_summary_from_previous! 도 동일 패턴(strip 후 with_title)으로 연쇄 연결 시
  # 이전 회의의 제목만 걷어내고 새 제목을 얹는다 — 두 H1 이 공존하지 않는다.
  def with_title(title, top)
    t = title.to_s.strip
    return top.to_s if t.blank?
    heading = "# #{t}"
    top.to_s.present? ? "#{heading}\n\n#{top}" : heading
  end

  # text 가 H1(# ...)로 시작하면 그 줄과 뒤따르는 빈 줄(들)을 무조건 제거한 텍스트를 반환. H1 로
  # 시작하지 않으면 원문 그대로.
  #
  # ⚠️ pinned top 처럼 "첫 줄이 H1 이면 그건 항상 우리가 직접 쓴 제목 마커"라고 보장할 수 있는
  # 코드 관리 영역에만 써야 한다(무조건 삭제이므로) — 사용자가 직접 편집할 수 있는 회의 본문
  # (body)에는 쓰면 안 된다. 본문의 중복 제목 제거는 #strip_matching_h1(제목 일치 시에만
  # 제거)을 대신 쓴다. 용도:
  #  1) Meeting#seed_summary_from_previous! 연쇄 연결 시 — 이전 회의의 top 에 실려 있는
  #     "이전 회의 자신의 제목" H1 을 걷어낸다(그 회의는 이제 하나의 "### <제목>" 블록일 뿐).
  #  2) MeetingSummarizationJob 재조립 직전 — pinned top 의 (구)제목을 걷어내고 #with_title 로
  #     현재 title 을 다시 얹는 "제목 갱신" 패턴의 앞단.
  #
  # ⚠️ "## "(H2 이상)는 "# "로 시작하지 않으므로 매치되지 않는다(start_with? 문자 단위 비교).
  def strip_leading_h1(text)
    text = text.to_s
    return text unless text.lstrip.start_with?("# ")

    lines = text.lstrip.lines
    lines.shift
    lines.join.lstrip
  end

  # text 가 H1(# ...)로 시작하고 그 제목 텍스트가 title 과 일치(양쪽 trim 비교)할 때만 그
  # 줄(+뒤따르는 빈 줄)을 제거한다. 일치하지 않으면(사용자가 회의 본문에 직접 쓴 커스텀 H1)
  # 손대지 않는다 — #strip_leading_h1(무조건 삭제)과 달리 회의 본문(body)처럼 사용자 편집이
  # 닿을 수 있는 영역에서 "LLM 이 재생성한 중복 제목"만 정밀 타격할 때 쓴다.
  #
  # MeetingSummarizationJob 재조립 직전: pinned top 이 있는 연결 회의는 refine_notes 가
  # REFINE_NOTES_SYSTEM_PROMPT 규칙 0("본문 맨 첫 줄에 # {제목}")에 따라 매 틱 본문에 제목을
  # 다시 쓴다 — 그 텍스트가 이 회의의 현재 title 과 정확히 같을 때만 중복으로 간주해 제거한다.
  # (append 모드 결과는 애초에 H1 로 시작하지 않아 no-op.)
  def strip_matching_h1(text, title)
    text = text.to_s
    return text unless text.lstrip.start_with?("# ")

    lines = text.lstrip.lines
    first_title = lines.first.to_s.delete_prefix("#").strip
    return text unless first_title == title.to_s.strip

    lines.shift
    lines.join.lstrip
  end
end
