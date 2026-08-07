module LlmPrompts
  # 회의록 압축율(verbosity) 5단계 설정: 라벨·문체·글자수 캡.
  module CompressionConfig
    # 압축율 5단계 — refine_notes/append_notes 의 system 프롬프트 뒤에 append.
    # 실측(2026-06-11): claude_cli 는 max_tokens 를 무시하고 지연은 출력 생성 bound(haiku ~95자/s)
    # → 프롬프트의 "약 N자 이내" 글자수 캡이 출력량·속도를 제어하는 유일한 레버.
    VERBOSITY_LABELS = {
      "very_concise"  => "아주 간결",
      "concise"       => "간결",
      "standard"      => "보통",
      "detailed"      => "상세",
      "very_detailed" => "아주 상세"
    }.freeze

    # 문체 지시. standard 는 문체 지시 없음(현행 보존, spec 이 nil 을 고정 — 변경 금지).
    # very_detailed 도 유한 캡(final 20,000/realtime 10,000)을 가지므로(아래 VERBOSITY_CHAR_LIMITS),
    # 문체 문구에서 "분량 제한 없이" 표현은 제거한다 — apply_verbosity 가 append 하는 "약 N자 이내" 캡과 모순되기 때문.
    #
    # 압축은 서술 문장을 줄이는 것이지 표·mermaid 다이어그램 등 시각 요소를 없애는 게 아니다 —
    # 오히려 압축율이 높을수록 서술 대신 표로 정보를 치환하는 편이 정보 밀도가 높다. 그래서 모든
    # 단계(very_concise 포함)에서 "표/다이어그램 유지·활용"을 명시하고, 삭제 방향 지시는 두지 않는다.
    VERBOSITY_STYLES = {
      "very_concise"  => "핵심 결정·액션아이템 위주 한 문장 기록, 부연·배경 생략. 단 비교·목록·현황은 서술 대신 표로 압축하고, 기존 표·mermaid 다이어그램은 삭제하지 말 것.",
      "concise"       => "각 항목을 1문장으로 기록, 부연 설명은 생략. 비교·목록·현황은 표로 정리하고, 기존 표·mermaid 다이어그램은 유지.",
      "standard"      => nil,
      "detailed"      => "논의의 맥락과 근거를 충실히 기록. 표·mermaid 다이어그램을 적극 활용. 긴 복합문 금지 — 짧은 문장과 하위 불릿으로 구조화.",
      "very_detailed" => "발언 흐름·근거·반론까지 모두 기록. 표·mermaid 를 적극 활용하고 가능한 한 충실하게 작성. 상세함은 문장 길이가 아닌 항목 수로 — 문장당 정보 1개로 짧게 끊고, 세부는 하위 불릿, 절차는 번호 목록으로."
    }.freeze

    # 회의록 전체 글자수 캡(약). realtime 틱은 작게(지연 직결), final/파일전사는 여유.
    # nil = 캡 없음(현재 모든 항목에 유한 캡 부여). ~95자/s 기준: realtime standard 4,000자 ≈ 42초.
    # very_detailed 도 유한 캡: 무한(nil)이면 큰 회의에서 claude CLI 360초 타임아웃 → 요약 미저장.
    VERBOSITY_CHAR_LIMITS = {
      realtime: {
        "very_concise"  => 1_000,
        "concise"       => 2_000,
        "standard"      => 4_000,
        "detailed"      => 8_000,
        "very_detailed" => 10_000
      }.freeze,
      final: {
        "very_concise"  => 2_000,
        "concise"       => 4_000,
        "standard"      => 10_000,
        "detailed"      => 15_000,
        "very_detailed" => 20_000
      }.freeze
    }.freeze
  end
end
