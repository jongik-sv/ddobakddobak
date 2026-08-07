module LlmPrompts
  # 회의 챗(단일 회의/폴더)·회의록 생성이 공유하는 Mermaid 다이어그램 지시.
  module MermaidPrompts
    # 렌더 파싱 실패를 막는 검증된 mermaid 구문 규칙 4가지(라벨 큰따옴표·<br/>·라벨 내 따옴표
    # 중첩 금지·mindmap leaf id). 이전엔 DIAGRAM_INSTRUCTION·APPEND_NOTES(6번)·FEEDBACK_NOTES(7~9번)
    # 세 곳에 각기 다른 길이로 중복 서술됐다. REFINE(DIAGRAM_INSTRUCTION 경유)·FEEDBACK 은 이 상수를
    # interpolate 하도록 통합했다. APPEND_NOTES(6번)는 원래도 4규칙 전부를 이미 한 문장으로 압축해둔
    # 상태였고, 매 실시간 틱마다 호출되는 latency-critical 경로라 이 상수(규칙별 (O)/(X) 예시를 갖춰
    # 원문보다 커짐)로 교체하면 오히려 프롬프트가 늘어나므로 원문 그대로 유지했다(의도적 예외).
    # (CHAT_DIAGRAM_INSTRUCTION 은 spec(llm_prompts_spec.rb, mindmap ✅/❌ 예시 축약 금지)이 원문 유지를
    # 강제하므로 이 상수를 쓰지 않고 독립 유지.)
    MERMAID_SYNTAX_RULES = <<~TEXT.freeze
      [필수] 노드 라벨 큰따옴표(예외 없음): A["라벨"] (O) / A[라벨] (X). 줄바꿈 <br/>(\\n 금지): A["1행<br/>2행"]. 라벨 안쪽 " 중첩 금지(강조는 괄호/홑따옴표): D["MO(현재 방식)"] (O) / D["MO("현재 방식")"] (X). mindmap 전 노드(잎 포함) id["라벨"] 필수: Man1["취업공수"] (O) / "취업공수" (X, 파싱 실패).
    TEXT

    # REFINE_NOTES_SYSTEM_PROMPT 전용 다이어그램 지시. 용도 안내(적합/부적합/형식/지원)는 원문 유지,
    # 구문 규칙은 위 MERMAID_SYNTAX_RULES 를 interpolate(중복 제거).
    DIAGRAM_INSTRUCTION = <<~TEXT.freeze
      9. **다이어그램 활용**: 시각적으로 효과적인 부분에 Mermaid 다이어그램 사용.
         - 적합: 프로세스/워크플로우·타임라인·의사결정·시스템 구조·의존관계·비율/통계
         - 부적합: 단순 목록·짧은 정보·표로 충분한 내용
         - 형식: ```mermaid ... ``` 코드블록. 회의록 당 최대 2개, 충분히 복잡할 때만
         - 지원: flowchart·sequenceDiagram·gantt·pie·mindmap. 노드/라벨 한국어
         - #{MERMAID_SYNTAX_RULES.chomp}
    TEXT

    # AI 챗(단일 회의/폴더·프로젝트) 전용 다이어그램 지시. 파싱 안전 규칙([필수] 항목, 특히 mindmap
    # ✅/❌ 예시 쌍)은 spec(llm_prompts_spec.rb)이 원문 그대로 보존을 강제하므로 MERMAID_SYNTAX_RULES로
    # 옮기지 않고 독립 유지(축약 금지). 챗은 절제 지침(불릿·표보다 명백히 유리할 때만 사용, 답변당
    # 최대 1개)을 별도로 둔다 — 회의록(최대 2개)과 기준이 다르다.
    CHAT_DIAGRAM_INSTRUCTION = <<~TEXT.freeze
      ## 다이어그램 활용
      다이어그램은 불릿·표보다 명백히 유리할 때만 사용 — 답변당 최대 1개.
      - 적합: 프로세스/흐름·타임라인·의사결정·시스템 구조·의존관계를 글보다 명확히 보여줄 때
      - 부적합: 짧은 정보·단순 목록·표로 충분한 내용. 애매하면 다이어그램 대신 불릿·표 사용
      - 형식: ```mermaid ... ``` 코드블록. 지원: flowchart·sequenceDiagram·gantt·pie·mindmap. 노드/라벨 한국어
      - ⚠️ **[필수] 노드 라벨에 반드시 따옴표 사용**: 예외 없이 모든 노드 라벨을 큰따옴표로 감쌀 것.
        - 따옴표 없는 노드는 파싱 에러. 절대 금지.
        - ✅ 올바른 예: A["개근중량 입력"] --> B{"공정 구분"} --> C["도금 부착량 (g/m²) × 길이"]
        - ❌ 잘못된 예: A[개근중량 입력] --> B{공정 구분} --> C[도금 부착량 × 길이]
        - 다이아몬드 노드도 마찬가지: B{"조건 분기"} (O) / B{조건 분기} (X)
      - ⚠️ **[필수] 노드 라벨 내 줄바꿈은 \\n 대신 <br/> 사용.**
        - Mermaid에서 \\n은 줄바꿈으로 인식되지 않아 렌더링 오류를 유발.
        - ✅ 올바른 예: A["첫째 줄<br/>둘째 줄"]
        - ❌ 잘못된 예: A["첫째 줄\\n둘째 줄"] (실제 줄바꿈 또는 문자열 \\n 모두 금지)
      - ⚠️ **[필수] 노드 라벨 안쪽에 큰따옴표 중첩 금지.** 라벨은 이미 큰따옴표로 감싸므로 안쪽에 또 " 를 쓰면 문자열이 조기 종료돼 파싱 에러(빈 화면). 강조는 괄호나 홑따옴표 사용.
        - ✅ 올바른 예: D["MO 생성(현재 방식)"] / E["'개선안' 방식"]
        - ❌ 잘못된 예: D["MO 생성("현재 방식")"] (안쪽 " 가 라벨을 조기 종료시켜 파싱 실패)
      - ⚠️ **[필수] mindmap은 모든 노드를 `id["라벨"]` 형식으로 작성 — 잎(leaf) 노드도 id 필수.**
        - id 없이 따옴표만 쓴 `"라벨"`은 mindmap 파서가 거부해 다이어그램이 빈 화면으로 렌더.
        - ✅ 올바른 예:
          mindmap
            root["4M 체계"]
              Man["Man (사람)"]
                Man1["취업공수<br/>(출근일 × 근무시간)"]
                Man2["작업표준 준수율"]
        - ❌ 잘못된 예 (잎이 id 없는 bare 따옴표 → 파싱 실패):
          mindmap
            root["4M 체계"]
              Man["Man (사람)"]
                "취업공수<br/>(출근일 × 근무시간)"
    TEXT
  end
end
