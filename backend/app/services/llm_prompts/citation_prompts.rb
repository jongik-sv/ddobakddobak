module LlmPrompts
  # 발화 근거(인용) 마커 지시: 단일 회의(CITATION_MARKER_INSTRUCTION) / 폴더·프로젝트 챗
  # (FOLDER_CHAT_CITATION_INSTRUCTION, 회의ID 포함) / 세 프롬프트(+ChatPrompts::MEETING_CHAT_
  # SYSTEM_PROMPT)가 공유하는 하드닝 공통분모(CITATION_MARKER_HARDENING).
  module CitationPrompts
    # 인용 마커 신규 생성 하드닝 공통 규칙 — CITATION_MARKER_INSTRUCTION·FOLDER_CHAT_CITATION_
    # INSTRUCTION·ChatPrompts::MEETING_CHAT_SYSTEM_PROMPT 세 곳이 보간해 공유한다.
    # 실서버 조사 결과 회의 챗 프롬프트가 이 상수 대신 자기 인라인 축약본을 쓰고 폴더 챗도 또 다른
    # 사본을 써서, 정작 위반 사고(밀리초 접미사 175000ms 등)를 막는 규칙이 세 곳 중 한 곳에만
    # 있었다 — 하나로 합쳐 어디서 위반돼도 같은 규칙이 걸리게 한다. 세 프롬프트가 문맥까지 같지는
    # 않으므로(예: 요약 전용 "기존 마커 보존", 폴더 챗 전용 "회의ID만 있는 반쪽 마커 금지") 그런
    # 문맥 종속 규칙은 여기 넣지 않고 각 상수에 남긴다.
    CITATION_MARKER_HARDENING = <<~HARDENING.freeze
      - 시간값은 숫자만 쓴다. 'ms'·'s' 등 단위 접미사를 붙이지 않는다.
      - 시간값에 본문 단어·기호를 섞지 않는다.
      - 구분자(| 또는 /)와 's:' 라벨을 생략하지 않는다.
      - 값이 불확실하면 마커 자체를 쓰지 않는다 — 추측한 마커보다 마커 없음이 낫다.
    HARDENING

    CITATION_MARKER_INSTRUCTION = <<~MARKER.freeze
      ## 발화 근거 마커
      - 각 문장/항목 끝 발화 마커 표기: ⟦t:<ms>/s:<화자>⟧ (예: 결정은 보류됐다. ⟦t:125000/s:화자 1⟧)
      - ms·화자는 입력 자막 [MM:SS|<ms>ms <화자>] 실제 값만.
      #{CITATION_MARKER_HARDENING.chomp}
      - s에는 대괄호 [..ms <화자>] 안의 화자값(예: '화자 1')만. 콜론 앞 이름(예: '이석희 부장:')은 s에 넣지 않는다.
      - 본문(불릿·소제목·표 등)에는 화자 이름이나 '누가 말했다'식 발화자 귀속을 쓰지 않는다. 내용·결정·액션만 서술. 화자값(예: '화자 1')은 오직 마커 ⟦..s:..⟧ 안에서만 쓰고 본문에는 노출하지 않는다.
      - 여러 발언/화자 근거 시 발언마다 별도 마커 연달아. 한 마커 s에는 화자 한 명만.
      - [최우선] 기존 회의록에 이미 있는 ⟦t:..⟧·⟦m:..⟧ 마커는 그대로 보존한다(수정·삭제·이동 금지). 새 문장에만 새 마커. 옮길 때도 '~' 범위로 병합하거나 구분자·형식을 바꾸지 않는다.
      - 마커는 문장 끝·표 셀 안에만. 코드블록·mermaid 라벨 안 금지.
    MARKER

    # 폴더/프로젝트 챗 인용 마커: 회의가 여러 개라 meeting_id를 마커에 포함한다(단일 회의 마커의 확장).
    FOLDER_CHAT_CITATION_INSTRUCTION = <<~MARKER.freeze
      ## 발화 근거 마커 (회의ID 포함)
      - 각 문장/항목 끝 발췌 마커 표기: ⟦m:<회의ID>/t:<ms>/s:<화자>⟧
        (예: 예산은 5천으로 확정됐다. ⟦m:142/t:125000/s:화자 1⟧)
      - m·ms·화자는 입력 "관련 회의 발췌"의 [회의:<id> ...][MM:SS|<ms>ms 화자] 실제 값만.
      #{CITATION_MARKER_HARDENING.chomp}
      - 회의ID만 있고 시간·화자가 빠진 마커(예: ⟦m:142⟧)는 만들지 않는다 — 셋 다 확인될 때만 마커를 쓴다.
      - s에는 대괄호 안의 화자값(예: '화자 1')만. 콜론 앞 이름은 s에 넣지 않는다.
      - 여러 발췌 근거 시 발췌마다 별도 마커 연달아.
      - 마커는 문장 끝·표 셀 안에만. 코드블록 안 금지.
    MARKER
  end
end
