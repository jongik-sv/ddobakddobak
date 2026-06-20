# LLM 프롬프트 압축 + 챗 답변 압축 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `backend/app/services/llm_prompts.rb`의 15개 시스템 프롬프트 텍스트를 의미·동작 보존하며 압축(입력토큰↓)하고, AI 챗 답변을 체언종결로 간결화(출력토큰↓)한다.

**Architecture:** 단일 파일(`llm_prompts.rb`) + 그 스펙(`spec/services/llm_prompts_spec.rb`)만 변경. 프롬프트 **로직(선택·분기)은 안 건드림 — 텍스트만**. 압축의 정확성 계약은 "앵커(파싱 마커·`[필수]`/`⚠️`·코드펜스 예시·스펙 검사어) 보존"으로 정의하고, 가드 스펙으로 묶는다. 가드 스펙은 baseline에서 green → 압축 후에도 green 유지 = 회귀 없음. 챗 브레비티 문구만 red→green TDD.

**Tech Stack:** Ruby/Rails, RSpec. LLM 백엔드는 claude CLI / gemini CLI(agy) (프롬프트 텍스트와 무관).

## Global Constraints

- 변경 파일은 `backend/app/services/llm_prompts.rb` + `backend/spec/services/llm_prompts_spec.rb` **2개뿐**. 다른 파일 수정 금지.
- baseline 원본 스냅샷: `/tmp/llm_prompts.baseline.rb` (repo 밖, A/B용). 절대 repo에 커밋하지 말 것.
- 작업 브랜치: `feat/prompt-compression` (이미 생성됨).
- **절대 보존(preserve-list) — 압축 중 한 글자도 바꾸지 말 것**:
  - 마커 토큰: `⟦t:<ms>/s:<화자>⟧`, `⟦m:<회의ID>/t:<ms>/s:<화자>⟧`, 센티넬 `<<<FOLLOWUPS>>>`
  - 강조: `⚠️`, `[필수]`, `[최우선]` 및 그 우선순위 의미
  - 코드펜스 ` ``` ` 내부 전부: JSON 스키마 블록, mermaid 예시 블록(`✅/❌` 포함), 표 포맷 예시
  - 유니코드 기호 목록(`² ³ ⁴ ⁿ ⁻¹ ₀ ₁ ₂ ± × ÷ ≤ ≥ ≠ ≈ ° ‰ μ Ω π α β γ → ← ∞ ½ ⅓ ¼ ⅔ ¾`)과 `g/m²`·`CO₂` 예시
  - 스펙 검사어: `화자값`, `충실하게`, `분량 제한 없이`(VERBOSITY_STYLES 부재 검사용 — 건드리지 말 것)
  - Ruby 문법: `<<~`, `.freeze`, `#{...}` 보간, HEREDOC 구분자
  - `VERBOSITY_LABELS` / `VERBOSITY_STYLES` / `VERBOSITY_CHAR_LIMITS` (데이터, 압축 대상 아님 — 손대지 말 것)
- **mermaid `✅/❌` 예시쌍은 보수적으로 그대로 둔다**(렌더 크래시 가드). 주변 산문만 압축.
- 압축 규칙: 조사·어미 컷(`~하세요`→명사형, `~합니다`→체언), 정중체·filler·중복 불릿 제거. 예: `사용자의 피드백을 정확하게 반영하여 회의록을 수정하세요` → `사용자 피드백 정확히 반영, 회의록 수정`.

---

### Task 1: 앵커 가드 스펙 (안전망 먼저)

압축 전에, 각 프롬프트의 보존 대상 앵커가 존재함을 검사하는 스펙을 추가/확장한다. baseline에서 전부 PASS여야 한다(앵커는 지금 다 존재). 이후 압축 태스크들이 이 스펙을 green으로 유지하면 = 계약 보존.

**Files:**
- Modify: `backend/spec/services/llm_prompts_spec.rb`

**Interfaces:**
- Produces: 가드 스펙 `describe "프롬프트 앵커 보존"` — 압축 태스크(2~6)가 green 유지해야 하는 회귀 게이트.

- [ ] **Step 1: 앵커 가드 스펙 추가**

`backend/spec/services/llm_prompts_spec.rb`에 아래 describe 블록을 추가(기존 검사는 유지):

```ruby
RSpec.describe LlmPrompts do
  describe "프롬프트 앵커 보존 (압축 회귀 가드)" do
    it "REFINE_NOTES: 최우선/⚠️/mermaid 따옴표·br·mindmap id·유니코드 보존" do
      p = LlmPrompts::REFINE_NOTES_SYSTEM_PROMPT
      expect(p).to include("[최우선]")
      expect(p).to include("⚠️")
      expect(p).to include('A["')          # mermaid 노드 따옴표 규칙
      expect(p).to include("<br/>")        # 줄바꿈 규칙
      expect(p).to include('id["라벨"]')   # mindmap 잎 id 규칙
      expect(p).to include("g/m²")         # 유니코드 단위 예시
    end

    it "APPEND_NOTES: 새 블록/빈 문자열/mermaid 따옴표 보존" do
      p = LlmPrompts::APPEND_NOTES_SYSTEM_PROMPT
      expect(p).to include("빈 문자열")
      expect(p).to include('A["')
    end

    it "FEEDBACK_NOTES: [필수] mermaid 3규칙 보존" do
      p = LlmPrompts::FEEDBACK_NOTES_SYSTEM_PROMPT
      expect(p).to include("[필수]")
      expect(p).to include('A["라벨"]')
      expect(p).to include("<br/>")
      expect(p).to include('id["라벨"]')
    end

    it "CITATION_MARKER: 마커 토큰/화자값/최우선 보존" do
      p = LlmPrompts::CITATION_MARKER_INSTRUCTION
      expect(p).to include("⟦t:<ms>/s:<화자>⟧")
      expect(p).to include("화자값")
      expect(p).to include("[최우선]")
    end

    it "FOLDER_CHAT_CITATION: 회의ID 포함 마커 토큰 보존" do
      expect(LlmPrompts::FOLDER_CHAT_CITATION_INSTRUCTION).to include("⟦m:<회의ID>/t:<ms>/s:<화자>⟧")
    end

    it "MEETING_CHAT: 마커/화자값/FOLLOWUPS 센티넬 보존" do
      p = LlmPrompts::MEETING_CHAT_SYSTEM_PROMPT
      expect(p).to include("⟦t:<ms>/s:<화자>⟧")
      expect(p).to include("화자값")
      expect(p).to include("<<<FOLLOWUPS>>>")
    end

    it "FOLDER_CHAT: FOLLOWUPS 센티넬 + 인용 보간 보존" do
      p = LlmPrompts::FOLDER_CHAT_SYSTEM_PROMPT
      expect(p).to include("<<<FOLLOWUPS>>>")
      expect(p).to include("⟦m:<회의ID>/t:<ms>/s:<화자>⟧")  # CITATION 보간 결과
    end

    it "EXPANSION: JSON 키/코드펜스 금지 지시 보존" do
      p = LlmPrompts::FOLDER_CHAT_EXPANSION_PROMPT
      expect(p).to include('"keywords"')
      expect(p).to include('"expansions"')
    end

    it "SUMMARIZE/ACTION_ITEMS: JSON 스키마 키 보존" do
      expect(LlmPrompts::SUMMARIZE_SYSTEM_PROMPT).to include('"key_points"')
      expect(LlmPrompts::SUMMARIZE_SYSTEM_PROMPT).to include('"action_items"')
      expect(LlmPrompts::ACTION_ITEMS_SYSTEM_PROMPT).to include('"action_items"')
    end

    it "DEFAULT_SECTION_STRUCTURE: 섹션 제목 5개 보존" do
      p = LlmPrompts::DEFAULT_SECTION_STRUCTURE
      ["## 1. 핵심 요약", "## 2. 논의 사항", "## 3. 결정사항", "## 4. Action Items", "## 5. 기타 논의"].each do |h|
        expect(p).to include(h)
      end
    end

    it "seeded_merge_instruction: 최우선 + 절취선 보간 보존" do
      dummy = Class.new { include LlmPrompts }.new
      out = dummy.seeded_merge_instruction
      expect(out).to include("[최우선]")
      expect(out).to include(Meeting::PREVIOUS_MEETING_CUT_LINE)
    end
  end
end
```

- [ ] **Step 2: 가드 스펙이 baseline에서 PASS 확인**

Run: `cd backend && bundle exec rspec spec/services/llm_prompts_spec.rb`
Expected: PASS (압축 전이므로 모든 앵커 존재 → green). 만약 어떤 it이 FAIL이면 그 앵커 문자열을 실제 파일과 대조해 스펙을 정정(파일이 정답).

- [ ] **Step 3: Commit**

```bash
git add backend/spec/services/llm_prompts_spec.rb
git commit -m "test(prompts): 압축 회귀 가드 — 앵커 보존 스펙"
```

---

### Task 2: 저위험 단순 프롬프트 압축

mermaid/마커 복잡도 없는 프롬프트부터. JSON 스키마 블록은 보존(코드펜스 취급).

**Files:**
- Modify: `backend/app/services/llm_prompts.rb` (`SUMMARIZE_SYSTEM_PROMPT`, `ACTION_ITEMS_SYSTEM_PROMPT`, `COMPRESS_AGENDA_SYSTEM_PROMPT`, `FOLDER_CHAT_EXPANSION_PROMPT`, `CHRONOLOGICAL_NOTES_INSTRUCTION`, `seeded_merge_instruction`)

**Interfaces:**
- Consumes: Task 1 가드 스펙.
- Produces: 압축된 6개 프롬프트. JSON 키·섹션 의미 불변.

- [ ] **Step 1: 6개 프롬프트의 산문만 압축**

규칙대로 조사·어미·정중체 컷. JSON 스키마 블록(`{ "key_points": ... }`)·`"keywords"`/`"expansions"` 키·예시 JSON은 그대로. 예(COMPRESS_AGENDA 규칙):

```
# before
1. 안건 항목·목표·결정 대상·참고 수치·고유명사(사람/조직/제품/날짜)는 보존하세요.
2. 장식 문구, 인사말, 반복, 불필요한 배경 설명은 제거하세요.
# after
1. 안건 항목·목표·결정 대상·참고 수치·고유명사(사람/조직/제품/날짜) 보존.
2. 장식 문구·인사말·반복·불필요 배경 설명 제거.
```

EXPANSION 예시 JSON(`{"keywords":[...],"expansions":[...]}`)과 `예: "시리얼 통신" → "RS232",...`는 보존.

- [ ] **Step 2: 가드 스펙 green 유지 확인**

Run: `cd backend && bundle exec rspec spec/services/llm_prompts_spec.rb`
Expected: PASS (EXPANSION/SUMMARIZE/ACTION_ITEMS/SECTION 앵커 보존).

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/llm_prompts.rb
git commit -m "perf(prompts): 단순 프롬프트 6종 산문 압축(의미 보존)"
```

---

### Task 3: REFINE_NOTES + DEFAULT_SECTION_STRUCTURE 압축 (최대 프롬프트)

3,439자. mermaid 예시쌍·유니코드 목록·표 예시·`[최우선]`/`⚠️` 보존. 규칙 1~9의 **설명 산문만** 압축.

**Files:**
- Modify: `backend/app/services/llm_prompts.rb` (`REFINE_NOTES_SYSTEM_PROMPT`, `DEFAULT_SECTION_STRUCTURE`)

**Interfaces:**
- Consumes: Task 1 가드 스펙.
- Produces: 압축된 REFINE_NOTES. mermaid 규칙·표 예시·유니코드·우선순위 마커 전부 불변.

- [ ] **Step 1: 규칙 산문 압축, 코드펜스/예시/마커 보존**

예(규칙 6 간결한 문체):

```
# before
6. **간결한 문체**: 어미를 최대한 간결하게 작성하세요.
   - "~했습니다", "~하였습니다" 대신 "~함", "~완료", "~예정" 등 명사형/체언 종결 사용
   - "~하기로 했습니다" → "~하기로 함", "~진행할 예정입니다" → "~진행 예정"
   - 불필요한 조사와 서술어를 줄이고 핵심만 남기세요
# after
6. **간결한 문체**: 명사형/체언 종결.
   - "~했습니다"→"~함/완료/예정". "~하기로 했습니다"→"~하기로 함"
   - 불필요 조사·서술어 제거, 핵심만
```

보존 불변: 0번 H1 규칙의 `# {회의 제목}`, 3번 표 예시 블록 전체, 8번 유니코드 목록+`g/m²`/`CO₂`, 9번 mermaid `✅/❌` 4블록 전체, `[최우선]`/`⚠️`. `DEFAULT_SECTION_STRUCTURE`는 REFINE 2번과 동일 구조이므로 같은 방식으로 섹션 제목만 보존하며 괄호 설명 산문 압축.

- [ ] **Step 2: 가드 스펙 green 확인**

Run: `cd backend && bundle exec rspec spec/services/llm_prompts_spec.rb -e "REFINE_NOTES" -e "DEFAULT_SECTION"`
Expected: PASS (`[최우선]`,`⚠️`,`A["`,`<br/>`,`id["라벨"]`,`g/m²`, 섹션 제목 5개 보존).

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/llm_prompts.rb
git commit -m "perf(prompts): REFINE_NOTES 산문 압축(mermaid·표·유니코드 예시 보존)"
```

---

### Task 4: APPEND_NOTES + FEEDBACK_NOTES 압축

둘 다 mermaid 규칙이 인라인. `[필수]` 마커·mermaid 따옴표/`<br/>`/mindmap id 예시 보존.

**Files:**
- Modify: `backend/app/services/llm_prompts.rb` (`APPEND_NOTES_SYSTEM_PROMPT`, `FEEDBACK_NOTES_SYSTEM_PROMPT`)

**Interfaces:**
- Consumes: Task 1 가드 스펙.

- [ ] **Step 1: 규칙 산문 압축, mermaid 규칙 예시 보존**

FEEDBACK 7~9번(`[필수]` mermaid 규칙)의 `A["라벨"] (O) / A[라벨] (X)` 같은 예시는 그대로. 설명만 압축. APPEND 5번 체언 종결 지시·6번 mermaid 한 줄 규칙도 예시 토큰(`A["라벨"]`, `<br/>`, `id["라벨"]`) 보존.

- [ ] **Step 2: 가드 스펙 green 확인**

Run: `cd backend && bundle exec rspec spec/services/llm_prompts_spec.rb -e "APPEND_NOTES" -e "FEEDBACK_NOTES"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/llm_prompts.rb
git commit -m "perf(prompts): APPEND/FEEDBACK 산문 압축([필수] mermaid 규칙 보존)"
```

---

### Task 5: 인용 마커 지시 압축 (CITATION_MARKER + FOLDER_CHAT_CITATION)

마커 토큰·`화자값`·`[최우선]` 보존. 설명 산문만.

**Files:**
- Modify: `backend/app/services/llm_prompts.rb` (`CITATION_MARKER_INSTRUCTION`, `FOLDER_CHAT_CITATION_INSTRUCTION`)

**Interfaces:**
- Consumes: Task 1 가드 스펙. FOLDER_CHAT_SYSTEM_PROMPT가 FOLDER_CHAT_CITATION을 `#{}` 보간하므로 토큰 보존 필수.

- [ ] **Step 1: 마커 규칙 산문 압축, 토큰 보존**

`⟦t:<ms>/s:<화자>⟧`, `⟦m:<회의ID>/t:<ms>/s:<화자>⟧`, `화자값`, `[최우선]`, `[MM:SS|<ms>ms <화자>]` 포맷 토큰은 불변. 예:

```
# before
- ms·화자는 입력 자막의 [MM:SS|<ms>ms <화자>] 에 실제로 있는 값만 사용한다. 불명확하면 마커를 생략한다.
# after
- ms·화자는 입력 자막 [MM:SS|<ms>ms <화자>] 에 실제 있는 값만. 불명확하면 마커 생략.
```

- [ ] **Step 2: 가드 스펙 green 확인**

Run: `cd backend && bundle exec rspec spec/services/llm_prompts_spec.rb -e "CITATION" -e "FOLDER_CHAT"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/llm_prompts.rb
git commit -m "perf(prompts): 인용 마커 지시 산문 압축(마커 토큰 보존)"
```

---

### Task 6: 챗 답변 압축 (목표 B) — MEETING_CHAT + FOLDER_CHAT

챗 프롬프트 산문 압축 + **브레비티 문구 강화**(red→green). 회의록 요약 출력은 안 건드림.

**Files:**
- Modify: `backend/app/services/llm_prompts.rb` (`MEETING_CHAT_SYSTEM_PROMPT`, `FOLDER_CHAT_SYSTEM_PROMPT`)
- Test: `backend/spec/services/llm_prompts_spec.rb`

**Interfaces:**
- Consumes: Task 1 가드 스펙(마커·FOLLOWUPS).
- Produces: 두 챗 프롬프트에 체언종결 브레비티 지시 포함.

- [ ] **Step 1: 브레비티 문구 검사 스펙 추가 (먼저 FAIL)**

`llm_prompts_spec.rb`에 추가:

```ruby
describe "챗 답변 압축 (목표 B)" do
  it "MEETING_CHAT: 체언종결 브레비티 지시 포함" do
    expect(LlmPrompts::MEETING_CHAT_SYSTEM_PROMPT).to include("명사형/체언 종결")
    expect(LlmPrompts::MEETING_CHAT_SYSTEM_PROMPT).to include("서론·맺음말")
  end
  it "FOLDER_CHAT: 체언종결 브레비티 지시 포함" do
    expect(LlmPrompts::FOLDER_CHAT_SYSTEM_PROMPT).to include("명사형/체언 종결")
    expect(LlmPrompts::FOLDER_CHAT_SYSTEM_PROMPT).to include("서론·맺음말")
  end
end
```

- [ ] **Step 2: 스펙 FAIL 확인**

Run: `cd backend && bundle exec rspec spec/services/llm_prompts_spec.rb -e "챗 답변 압축"`
Expected: FAIL (`expected ... to include "명사형/체언 종결"`).

- [ ] **Step 3: 두 프롬프트의 브레비티 줄 교체**

`MEETING_CHAT`(현 :292)·`FOLDER_CHAT`(현 :332)의 `- 답변은 한국어로 간결하게. 필요하면 Markdown(불릿·표)을 사용하세요.` 를:

```
    - 답변은 한국어로 간결하게. 명사형/체언 종결(~함·~예정) 사용, 서론·맺음말·군더더기 생략, 핵심부터. 필요하면 Markdown(불릿·표) 사용.
```

동시에 두 프롬프트의 나머지 규칙 산문도 압축(마커 규칙 토큰·`<<<FOLLOWUPS>>>`·`화자값`·`(회의 밖 일반 정보)` 등 보존).

- [ ] **Step 4: 전체 스펙 PASS 확인**

Run: `cd backend && bundle exec rspec spec/services/llm_prompts_spec.rb`
Expected: PASS (브레비티 green + 앵커 green).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/llm_prompts.rb backend/spec/services/llm_prompts_spec.rb
git commit -m "feat(prompts): 챗 답변 체언종결 압축 + 챗 프롬프트 산문 압축"
```

---

### Task 7: 검증 — 풀 rspec + 글자수 리포트 + 실전 A/B

**Files:**
- (변경 없음 — 검증·측정만)

**Interfaces:**
- Consumes: Task 1~6 결과 + `/tmp/llm_prompts.baseline.rb`.

- [ ] **Step 1: 풀 rspec**

Run: `cd backend && bundle exec rspec`
Expected: 회귀 0. (사전 존재 실패가 있으면 baseline과 동일한지만 확인 — 신규 실패 0이어야 함.)

- [ ] **Step 2: 글자수 절감 리포트**

Run:
```bash
echo "baseline: $(wc -m < /tmp/llm_prompts.baseline.rb)"
echo "compressed: $(wc -m < backend/app/services/llm_prompts.rb)"
```
상수별 절감을 보려면 `git diff --stat feat/chat-streaming-model -- backend/app/services/llm_prompts.rb` 사용. 결과를 커밋 메시지/PR 본문에 기록.

- [ ] **Step 3: 실전 A/B 재생성**

mermaid·인용 마커가 들어간 큰 회의 1개 선정(예: 회의 129류, 전사 300+세그). 절차:
1. 신 프롬프트(현 브랜치)로 해당 회의 final 재생성 → 회의록 저장.
2. 결과 육안 점검: (a) mermaid 블록이 렌더되는가(파싱 에러 없는가), (b) `⟦t:..⟧` 마커가 붙는가, (c) 섹션 구조(1~5) 유지되는가, (d) 표 정상.
3. 구 프롬프트 대조가 필요하면 `/tmp/llm_prompts.baseline.rb`를 임시로 복사해 같은 회의 재생성 후 비교(비교 끝나면 신 버전 복구).
4. 회귀 발견 시: 해당 프롬프트만 baseline에서 해당 규칙/예시를 복원하고 Task 재실행.

- [ ] **Step 4: 검증 결과 기록**

A/B 결과(렌더 OK/마커 OK/구조 OK, 글자수 절감)를 요약해 사용자에게 보고. 회귀 없으면 머지 후보로 표시(커밋·머지는 사용자 명시 요청 시에만).

---

## Self-Review

- **Spec coverage:** 목표 A(15개 압축)=Task 2~6, 목표 B(챗 답변)=Task 6, 검증(스펙+1회 A/B)=Task 1·7. preserve-list=Global Constraints + 각 Task green 게이트. ✅
- **Placeholder scan:** 압축 결과 텍스트는 규칙 기반이라 "정답 1개"가 없음 → 계약은 앵커 가드 스펙으로 고정, 각 Task에 before/after 워크드 예시 제시. TODO/TBD 없음. ✅
- **Type consistency:** 가드 스펙 앵커 문자열은 실제 파일(:60~342)에서 추출. 상수명 일치 확인. ✅
- **주의:** baseline 비교 기준 브랜치는 `feat/chat-streaming-model`(분기 원점). `git diff --stat feat/chat-streaming-model` 사용.
