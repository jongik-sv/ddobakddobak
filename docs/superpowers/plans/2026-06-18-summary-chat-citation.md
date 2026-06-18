# 요약·AI Chat 인라인 발화 근거(시각·화자) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 요약(AI 회의록)·AI Chat 답변의 각 문장 끝에 발화 시각·화자 근거 배지(⏱, 색=화자)를 달고, 클릭하면 오디오가 그 시각으로 점프하게 한다.

**Architecture:** LLM이 `notes_markdown`/챗 답변 `content`에 인라인 마커 토큰 `⟦t:ms|s:화자⟧`를 출력 → 프론트가 토큰을 클릭 가능한 타이머 배지로 치환 → 기존 `onSeek(ms)` 점프 체인 재사용. 챗(react-markdown)이 쉬워 먼저, 요약(BlockNote 인라인)이 어려워 뒤에. 공용 인프라(파싱 유틸·배지)는 양쪽 공유.

**Tech Stack:** Rails(backend), Python/FastAPI(sidecar LLM), React+TS(frontend), BlockNote 에디터, react-markdown, SQLite FTS5.

## Global Constraints

- 마커 토큰 포맷(verbatim): `⟦t:<started_at_ms>|s:<speaker_label>⟧` — 예 `⟦t:125000|s:화자 1⟧`. 괄호 = U+27E6/U+27E7.
- `s:` 값은 **반드시 `화자 N` 형식**(speaker_N 등 변형 금지) — 색 매핑 일치 조건.
- 점프 단위 = **ms**. `onSeek(ms: number)` 기존 체인 재사용(`MeetingPage.handleSeek`→`AudioPlayer.seekTo`→`audio.currentTime = ms/1000`).
- 화자→색: 신규 매핑 금지. `frontend/src/components/meeting/SpeakerLabel.tsx`의 export `speakerColor(speakerLabel)`/`speakerBorderColor(speakerLabel)` 재사용(10색 순환, 11명+ 중복 허용 — A안).
- 시각 포맷: `frontend/src/lib/audioUtils.ts`의 `formatTime(ms): string` 재사용(MM:SS / H:MM:SS).
- 요약 범위: **realtime + final 둘 다** 마커. 증분 재생성 시 **이전 마커 보존**(수정·삭제·재배치 금지), 새 문장에만 신규.
- 기능 변경 0: 기존 요약·챗 동작 회귀 green 유지. 데이터손실 가드(AiSummaryPanel Defense 1·2) 불변.
- TDD, 빈번 커밋. 커밋은 사용자 승인 후(이 저장소 규칙).

---

## File Structure

**신규**
- `frontend/src/lib/citationMarkers.ts` — 마커 토큰 파싱/직렬화/strip/링크변환 공용 유틸(요약·챗 공유)
- `frontend/src/lib/citationMarkers.test.ts` — 위 유틸 단위 테스트
- `frontend/src/components/meeting/TimestampBadge.tsx` — ⏱+시각 클릭 배지(색=화자)
- `frontend/src/components/meeting/TimestampBadge.test.tsx`
- `frontend/src/components/meeting/citationInline.tsx` — BlockNote 커스텀 인라인 content spec + 토큰↔인라인 변환(Phase 4, spike 채택안)

**수정**
- sidecar: `app/llm/summarizer.py`(`_format_transcripts`), `app/llm/prompts.py`(REFINE 프롬프트 + `_MARKER_INSTRUCTION`)
- backend: `app/services/llm_service.rb`(`format_transcripts`, `refine_notes` 프롬프트 조립), `app/services/llm_prompts.rb`(`REFINE_NOTES_SYSTEM_PROMPT` 또는 신규 `CITATION_MARKER_INSTRUCTION`, `MEETING_CHAT_SYSTEM_PROMPT`), `app/services/meeting_chat_context.rb`(`transcript_block`, `summary_text`), `app/models/concerns/fts_indexable.rb`(값 변환 훅), `app/models/summary.rb`(strip override)
- frontend: `components/meeting/ChatMarkdown.tsx`, `components/meeting/AiChatPanel.tsx`, `components/meeting/RightTabsPanel.tsx`, `pages/MeetingPage.tsx`, `components/meeting/AiSummaryPanel.tsx`, `components/meeting/mermaidBlock.tsx`(editorSchema에 인라인 spec 추가)

---

## Phase 0 — Spike (위험 선검증, 코드 산출 아님)

### Task 0: BlockNote 인라인 마커 라운드트립 + realtime 보존 실측

**목적:** Phase 4 구현 방식 확정. 두 미검증 리스크를 실험으로 가른다.

- [ ] **Step 1: BlockNote 인라인 라운드트립 실험**

임시 브랜치/스크래치에서 `createReactInlineContentSpec`로 최소 인라인 배지 스펙을 만들고, `editorSchema`에 `inlineContentSpecs`로 등록한 뒤 다음을 확인:
1. `⟦t:125000|s:화자 1⟧`가 포함된 마크다운을 `tryParseMarkdownToBlocks` → 토큰을 인라인 스펙으로 변환 → 에디터 표시.
2. `blocksToMarkdownLossy`(또는 saveNow 그룹 직렬화)가 인라인 스펙을 **다시 `⟦t:125000|s:화자 1⟧` 텍스트로 환원**하는지.
3. 환원 실패 시(인라인 커스텀이 lossy 직렬화에서 떨어지면) → **대안 채택**: 요약 메인 패널 BlockNote에서는 마커를 **평문 보존**(편집 중 토큰 노출 허용)하고, 배지 렌더는 별도 읽기 뷰(`AiSummaryFullViewModal`)에서만 react-markdown 경로로.

- [ ] **Step 2: realtime 마커 보존 실측**

로컬 sidecar/backend로 실제 회의 1건을 realtime 증분 3회 이상 돌려, 직전 `current_notes_markdown`의 `⟦t:..⟧` 마커가 다음 증분 후에도 유지되는 비율을 눈으로 확인. 누락 빈번하면 Phase 2 프롬프트의 보존 지시를 강화하거나, 직렬화 정규화·dedup 강도를 올린다.

- [ ] **Step 3: 결정 기록**

`docs/superpowers/plans/2026-06-18-summary-chat-citation.md` 하단 "Spike 결과" 절에 (a) Phase 4 인라인 방식(스펙 vs 읽기뷰 분리), (b) realtime 보존 보강 필요 여부를 1–2줄로 적는다. 실험 코드는 폐기(커밋 안 함).

---

## Phase 1 — 공용 프론트 인프라

### Task 1: 마커 파싱 유틸 `citationMarkers.ts`

**Files:**
- Create: `frontend/src/lib/citationMarkers.ts`
- Test: `frontend/src/lib/citationMarkers.test.ts`

**Interfaces:**
- Produces:
  - `parseCitationMarkers(text: string): Array<{ ms: number; speaker: string; index: number; raw: string }>` — 텍스트 내 모든 마커.
  - `stripCitationMarkers(text: string): string` — 마커 전부 제거(공백 정리 포함).
  - `dedupeMarkers(markers: {ms:number;speaker:string}[]): {ms:number;speaker:string}[]` — 동일 `(ms,speaker)` 중복 제거.
  - `CITATION_RE: RegExp` — `/⟦t:(\d+)\|s:([^⟧]+)⟧/g`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/lib/citationMarkers.test.ts
import { describe, it, expect } from 'vitest'
import { parseCitationMarkers, stripCitationMarkers, dedupeMarkers } from './citationMarkers'

describe('citationMarkers', () => {
  it('parses ms and speaker from a marker', () => {
    const r = parseCitationMarkers('결정 보류. ⟦t:125000|s:화자 1⟧')
    expect(r).toEqual([{ ms: 125000, speaker: '화자 1', index: 0, raw: '⟦t:125000|s:화자 1⟧' }])
  })
  it('parses multiple consecutive markers', () => {
    const r = parseCitationMarkers('합의. ⟦t:1000|s:화자 1⟧⟦t:2000|s:화자 2⟧')
    expect(r.map((m) => m.ms)).toEqual([1000, 2000])
  })
  it('strips markers and trims dangling space', () => {
    expect(stripCitationMarkers('결정 보류. ⟦t:125000|s:화자 1⟧')).toBe('결정 보류.')
  })
  it('dedupes identical ms+speaker', () => {
    const r = dedupeMarkers([{ ms: 1, speaker: '화자 1' }, { ms: 1, speaker: '화자 1' }, { ms: 2, speaker: '화자 1' }])
    expect(r).toEqual([{ ms: 1, speaker: '화자 1' }, { ms: 2, speaker: '화자 1' }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/citationMarkers.test.ts`
Expected: FAIL ("Cannot find module './citationMarkers'").

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/lib/citationMarkers.ts
/** 인라인 발화 근거 마커 ⟦t:<ms>|s:<speaker>⟧ 파싱·직렬화 공용 유틸 (요약·챗 공유). */

export const CITATION_RE = /⟦t:(\d+)\|s:([^⟧]+)⟧/g

export interface CitationMarker {
  ms: number
  speaker: string
  index: number
  raw: string
}

export function parseCitationMarkers(text: string): CitationMarker[] {
  const out: CitationMarker[] = []
  let m: RegExpExecArray | null
  const re = new RegExp(CITATION_RE.source, 'g')
  let i = 0
  while ((m = re.exec(text)) !== null) {
    out.push({ ms: Number(m[1]), speaker: m[2], index: i++, raw: m[0] })
  }
  return out
}

export function stripCitationMarkers(text: string): string {
  return text.replace(new RegExp(CITATION_RE.source, 'g'), '').replace(/[ \t]+(?=\n|$)/g, '')
}

export function dedupeMarkers(markers: { ms: number; speaker: string }[]): { ms: number; speaker: string }[] {
  const seen = new Set<string>()
  const out: { ms: number; speaker: string }[] = []
  for (const m of markers) {
    const k = `${m.ms}|${m.speaker}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ ms: m.ms, speaker: m.speaker })
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/citationMarkers.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/citationMarkers.ts frontend/src/lib/citationMarkers.test.ts
git commit -m "feat(citation): 인라인 발화근거 마커 파싱 공용 유틸"
```

---

### Task 2: 타이머 배지 컴포넌트 `TimestampBadge`

**Files:**
- Create: `frontend/src/components/meeting/TimestampBadge.tsx`
- Test: `frontend/src/components/meeting/TimestampBadge.test.tsx`

**Interfaces:**
- Consumes: `formatTime` (audioUtils), `speakerColor` (SpeakerLabel).
- Produces: `TimestampBadge({ ms, speaker, speakerName?, onSeek, isAudioReady? })` — 클릭 시 `onSeek(ms)`. `isAudioReady===false`면 비활성(클릭 무시, 흐리게).

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/meeting/TimestampBadge.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TimestampBadge } from './TimestampBadge'

describe('TimestampBadge', () => {
  it('shows MM:SS and calls onSeek(ms) on click', () => {
    const onSeek = vi.fn()
    render(<TimestampBadge ms={125000} speaker="화자 1" onSeek={onSeek} />)
    expect(screen.getByText('02:05')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button'))
    expect(onSeek).toHaveBeenCalledWith(125000)
  })
  it('does not call onSeek when audio not ready', () => {
    const onSeek = vi.fn()
    render(<TimestampBadge ms={1000} speaker="화자 1" onSeek={onSeek} isAudioReady={false} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onSeek).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/meeting/TimestampBadge.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

```tsx
// frontend/src/components/meeting/TimestampBadge.tsx
import { Clock } from 'lucide-react'
import { formatTime } from '../../lib/audioUtils'
import { speakerColor } from './SpeakerLabel'

interface Props {
  ms: number
  speaker: string            // speaker_label, 예 "화자 1"
  speakerName?: string | null // 표시용 사람 이름(있으면 tooltip)
  onSeek: (ms: number) => void
  isAudioReady?: boolean
}

export function TimestampBadge({ ms, speaker, speakerName, onSeek, isAudioReady = true }: Props) {
  const color = speakerColor(speaker) // 'bg-…-100 text-…-800'
  const title = `${speakerName || speaker} · ${formatTime(ms)}`
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={!isAudioReady}
      onClick={() => { if (isAudioReady) onSeek(ms) }}
      className={`inline-flex items-center gap-0.5 align-baseline mx-0.5 px-1 py-0 rounded text-[10px] font-medium ${color} ${isAudioReady ? 'cursor-pointer hover:brightness-95' : 'opacity-40 cursor-default'}`}
    >
      <Clock className="w-2.5 h-2.5" />
      {formatTime(ms)}
    </button>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/meeting/TimestampBadge.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/meeting/TimestampBadge.tsx frontend/src/components/meeting/TimestampBadge.test.tsx
git commit -m "feat(citation): 타이머 배지 컴포넌트(색=화자, onSeek 점프)"
```

---

## Phase 2 — 백엔드 (마커 생성)

### Task 3: 트랜스크립트 입력에 시각 노출 (`format_transcripts`)

마커 생성을 위해 LLM 입력에 `started_at_ms` 원값을 노출한다. sidecar·backend 두 포매터를 같은 형식으로.

**Files:**
- Modify: `sidecar/app/llm/summarizer.py:74-83` (`_format_transcripts`)
- Modify: `backend/app/services/llm_service.rb:419-426` (`format_transcripts`)
- Test: `sidecar/tests/test_summarizer_format.py`(신규 또는 기존 위치), `backend/spec/services/llm_service_spec.rb`

형식: `[MM:SS|<ms>ms 화자] 내용` — 예 `[02:05|125000ms 화자 1] 결정 보류`.

- [ ] **Step 1 (sidecar): Write failing test**

```python
# sidecar/tests/test_summarizer_format.py
from app.llm.summarizer import Summarizer  # 실제 클래스/생성 경로에 맞춰 조정

def test_format_transcripts_exposes_ms():
    s = Summarizer.__new__(Summarizer)  # __init__ 의존 회피용; 실제 픽스처 있으면 사용
    out = s._format_transcripts([{ "speaker": "화자 1", "text": "결정 보류", "started_at_ms": 125000 }])
    assert out == "[02:05|125000ms 화자 1] 결정 보류"
```

- [ ] **Step 2: Run, verify fail**

Run: `cd sidecar && python -m pytest tests/test_summarizer_format.py -q`
Expected: FAIL (현재 `화자 1: 결정 보류`).

- [ ] **Step 3: Implement (sidecar)**

```python
# sidecar/app/llm/summarizer.py  _format_transcripts 교체
def _format_transcripts(self, transcripts: list[dict]) -> str:
    """트랜스크립트 목록을 프롬프트용 텍스트로 포맷한다(발화 시각 포함)."""
    if not transcripts:
        return ""
    lines = []
    for item in transcripts:
        speaker = item.get("speaker", "알 수 없음")
        text = item.get("text", "")
        ms = int(item.get("started_at_ms", 0) or 0)
        clock = f"{ms // 60000:02d}:{(ms // 1000) % 60:02d}"
        lines.append(f"[{clock}|{ms}ms {speaker}] {text}")
    return "\n".join(lines)
```

- [ ] **Step 4: Run, verify pass**

Run: `cd sidecar && python -m pytest tests/test_summarizer_format.py -q`
Expected: PASS.

- [ ] **Step 5 (backend): Write failing test**

```ruby
# backend/spec/services/llm_service_spec.rb (해당 describe에 추가)
it "format_transcripts에 시각(ms)을 노출한다" do
  svc = LlmService.allocate
  out = svc.send(:format_transcripts, [{ "speaker" => "화자 1", "text" => "결정 보류", "started_at_ms" => 125000 }])
  expect(out).to eq("[02:05|125000ms 화자 1] 결정 보류")
end
```

- [ ] **Step 6: Run, verify fail**

Run: `cd backend && bundle exec rspec spec/services/llm_service_spec.rb -e "시각(ms)을 노출"`
Expected: FAIL.

- [ ] **Step 7: Implement (backend)**

```ruby
# backend/app/services/llm_service.rb  format_transcripts 교체
def format_transcripts(transcripts)
  return "" if transcripts.blank?
  transcripts.map { |t|
    speaker = t["speaker"] || t[:speaker] || "알 수 없음"
    text = t["text"] || t[:text] || ""
    ms = (t["started_at_ms"] || t[:started_at_ms] || 0).to_i
    clock = format("%02d:%02d", ms / 60000, (ms / 1000) % 60)
    "[#{clock}|#{ms}ms #{speaker}] #{text}"
  }.join("\n")
end
```

주의: `format_transcripts`의 입력은 `Transcript.to_sidecar_payload`(transcript.rb:15-19)가 만든 해시 배열이며 이미 `started_at_ms`를 포함한다(payload 변경 불필요).

- [ ] **Step 8: Run, verify pass + 회귀**

Run: `cd backend && bundle exec rspec spec/services/llm_service_spec.rb`
Expected: PASS(신규 + 기존 회귀).

- [ ] **Step 9: Commit**

```bash
git add sidecar/app/llm/summarizer.py sidecar/tests/test_summarizer_format.py backend/app/services/llm_service.rb backend/spec/services/llm_service_spec.rb
git commit -m "feat(citation): 요약 트랜스크립트 입력에 발화 시각(ms) 노출"
```

---

### Task 4: 요약 마커 지침 (refine 프롬프트, realtime+final 공통 + 보존규칙)

**Files:**
- Modify: `sidecar/app/llm/prompts.py` (`_REFINE_NOTES_SYSTEM_PROMPT`에 `_MARKER_INSTRUCTION` append)
- Modify: `backend/app/services/llm_prompts.rb` (`CITATION_MARKER_INSTRUCTION` 상수 신설), `backend/app/services/llm_service.rb` (`refine_notes`에서 append)
- Test: `backend/spec/services/llm_service_spec.rb` (프롬프트에 마커 지침 포함 확인)

지침 본문(양 언어 공통 의미):
```
## 발화 근거 마커
- 각 문장/항목 끝에 그 내용의 근거가 된 발화의 마커를 붙인다: ⟦t:<ms>|s:<화자>⟧ (예: 결정은 보류됐다. ⟦t:125000|s:화자 1⟧)
- ms·화자는 입력 자막의 [..|<ms>ms <화자>]에 실제로 있는 값만 사용한다. 불명확하면 마커를 생략한다.
- 화자는 반드시 '화자 N' 형식 그대로 쓴다.
- 여러 발화가 근거면 가장 이른 시각 1개를 기본, 필요하면 마커를 연달아 붙인다.
- [최우선] 기존 회의록에 이미 있는 ⟦t:..⟧ 마커는 그대로 보존한다(수정·삭제·이동 금지). 새 문장에만 새 마커를 단다.
- 마커는 문장 끝(마침표/개행 직후)에만. 표 셀·코드블록·mermaid 라벨 안에는 넣지 않는다.
```

- [ ] **Step 1 (backend): Write failing test**

```ruby
# backend/spec/services/llm_service_spec.rb
it "refine_notes 시스템 프롬프트에 마커 지침이 포함된다" do
  svc = LlmService.new  # 기존 생성 패턴에 맞춰 조정
  captured = nil
  allow(svc).to receive(:call_llm_raw) { |sys, _u, **| captured = sys; "결과" }
  svc.refine_notes("", [{ "speaker" => "화자 1", "text" => "안녕", "started_at_ms" => 0 }], verbosity_context: :realtime)
  expect(captured).to include("⟦t:<ms>|s:<화자>⟧")
  expect(captured).to include("기존 회의록에 이미 있는")
end
```

- [ ] **Step 2: Run, verify fail**

Run: `cd backend && bundle exec rspec spec/services/llm_service_spec.rb -e "마커 지침이 포함"`
Expected: FAIL.

- [ ] **Step 3: Implement (backend)**

`llm_prompts.rb`에 상수 추가:

```ruby
# backend/app/services/llm_prompts.rb
CITATION_MARKER_INSTRUCTION = <<~MARKER
  ## 발화 근거 마커
  - 각 문장/항목 끝에 근거가 된 발화의 마커를 붙인다: ⟦t:<ms>|s:<화자>⟧ (예: 결정은 보류됐다. ⟦t:125000|s:화자 1⟧)
  - ms·화자는 입력 자막의 [..|<ms>ms <화자>] 에 실제로 있는 값만 사용한다. 불명확하면 마커를 생략한다.
  - 화자는 반드시 '화자 N' 형식 그대로 쓴다.
  - 여러 발화가 근거면 가장 이른 시각 1개를 기본, 필요하면 마커를 연달아 붙인다.
  - [최우선] 기존 회의록에 이미 있는 ⟦t:..⟧ 마커는 그대로 보존한다(수정·삭제·이동 금지). 새 문장에만 새 마커를 단다.
  - 마커는 문장 끝(마침표/개행 직후)에만. 표 셀·코드블록·mermaid 라벨 안에는 넣지 않는다.
MARKER
```

`llm_service.rb` `refine_notes`에서 verbosity 적용 뒤(맨 끝 부근, `seeded_merge_instruction` 부착부 근처)에 항상 append — realtime/final 공통:

```ruby
# backend/app/services/llm_service.rb  refine_notes 내, apply_verbosity 직후에 추가
system_prompt = apply_verbosity(system_prompt, verbosity, context: verbosity_context)
system_prompt = system_prompt + "\n\n" + LlmPrompts::CITATION_MARKER_INSTRUCTION
system_prompt = system_prompt + seeded_merge_instruction if seeded_merge
```

- [ ] **Step 4: Run, verify pass**

Run: `cd backend && bundle exec rspec spec/services/llm_service_spec.rb -e "마커 지침이 포함"`
Expected: PASS.

- [ ] **Step 5: Implement (sidecar) — 동일 지침 append**

```python
# sidecar/app/llm/prompts.py  파일 하단에 추가
_MARKER_INSTRUCTION = """

## 발화 근거 마커
- 각 문장/항목 끝에 근거가 된 발화의 마커를 붙인다: ⟦t:<ms>|s:<화자>⟧ (예: 결정은 보류됐다. ⟦t:125000|s:화자 1⟧)
- ms·화자는 입력 자막의 [..|<ms>ms <화자>] 에 실제로 있는 값만 사용한다. 불명확하면 생략한다.
- 화자는 반드시 '화자 N' 형식 그대로 쓴다.
- 여러 발화가 근거면 가장 이른 시각 1개 기본, 필요하면 연달아 붙인다.
- [최우선] 기존 회의록의 ⟦t:..⟧ 마커는 그대로 보존한다(수정·삭제·이동 금지). 새 문장에만 새 마커를 단다.
- 마커는 문장 끝에만. 표 셀·코드블록·mermaid 라벨 안에는 넣지 않는다.
"""

_REFINE_NOTES_SYSTEM_PROMPT = _REFINE_NOTES_SYSTEM_PROMPT + _MARKER_INSTRUCTION
```

(`_build_refine_prompt_from_text` 경로도 쓰면 그 분기에서도 `_MARKER_INSTRUCTION`을 append 하도록 `summarizer.refine_notes`의 `sections_prompt` 분기를 확인해 동일 append.)

- [ ] **Step 6: sidecar 프롬프트 회귀**

Run: `cd sidecar && python -m pytest -q`
Expected: PASS(기존 테스트 무손상).

- [ ] **Step 7: Commit**

```bash
git add sidecar/app/llm/prompts.py backend/app/services/llm_prompts.rb backend/app/services/llm_service.rb backend/spec/services/llm_service_spec.rb
git commit -m "feat(citation): 요약 refine 프롬프트에 발화근거 마커 지침(보존규칙 포함)"
```

---

### Task 5: 챗 컨텍스트에 ms 노출 + 요약 마커 strip (`meeting_chat_context.rb`)

**Files:**
- Modify: `backend/app/services/meeting_chat_context.rb` (`transcript_block:58-69`, `summary_text:46-56`)
- Test: `backend/spec/services/meeting_chat_context_spec.rb`

- [ ] **Step 1: Write failing test**

```ruby
# backend/spec/services/meeting_chat_context_spec.rb (해당 describe에 추가)
it "transcript_block 라인에 ms 원값을 노출한다" do
  ctx = MeetingChatContext.new(meeting, user, "질문")
  line = ctx.send(:transcript_block, 100_000)
  expect(line).to include("|0ms 화자 1]").or include("ms ")  # 형식: [MM:SS|<ms>ms 화자]
end

it "summary_text는 마커를 제거한다" do
  meeting.summaries.create!(summary_type: "final", generated_at: Time.current,
    notes_markdown: "결정 보류. ⟦t:125000|s:화자 1⟧")
  ctx = MeetingChatContext.new(meeting.reload, user, "질문")
  expect(ctx.send(:summary_text)).not_to include("⟦t:")
end
```
(픽스처 `meeting`/`user`/transcript는 기존 spec 헬퍼에 맞춰 구성.)

- [ ] **Step 2: Run, verify fail**

Run: `cd backend && bundle exec rspec spec/services/meeting_chat_context_spec.rb`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ruby
# transcript_block 의 라인 생성부(60) 교체
lines = @meeting.transcripts.order(:sequence_number).map do |t|
  ms = t.started_at_ms.to_i
  "[#{ms_to_clock(ms)}|#{ms}ms #{t.speaker_name.presence || t.speaker_label}] #{t.content}"
end
```

`summary_text`(50)에서 마커 제거 — backend 공용 strip 헬퍼 사용(없으면 인라인 gsub):

```ruby
# summary_text 내, text 할당 직후
text = s&.notes_markdown.to_s.gsub(/⟦t:\d+\|s:[^⟧]+⟧/, "")
```

- [ ] **Step 4: Run, verify pass + 회귀**

Run: `cd backend && bundle exec rspec spec/services/meeting_chat_context_spec.rb`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/meeting_chat_context.rb backend/spec/services/meeting_chat_context_spec.rb
git commit -m "feat(citation): 챗 컨텍스트 ms 노출 + 요약 마커 strip"
```

---

### Task 6: 챗 시스템 프롬프트 마커 지침 (`MEETING_CHAT_SYSTEM_PROMPT`)

**Files:**
- Modify: `backend/app/services/llm_prompts.rb:254-278` (`MEETING_CHAT_SYSTEM_PROMPT`)
- Test: `backend/spec/services/llm_prompts_spec.rb`(신규 또는 기존)

- [ ] **Step 1: Write failing test**

```ruby
# backend/spec/services/llm_prompts_spec.rb
it "챗 프롬프트에 마커 형식 지침이 있다" do
  expect(LlmPrompts::MEETING_CHAT_SYSTEM_PROMPT).to include("⟦t:")
  expect(LlmPrompts::MEETING_CHAT_SYSTEM_PROMPT).to include("화자 N")
end
```

- [ ] **Step 2: Run, verify fail**

Run: `cd backend && bundle exec rspec spec/services/llm_prompts_spec.rb`
Expected: FAIL.

- [ ] **Step 3: Implement**

`MEETING_CHAT_SYSTEM_PROMPT`의 기존 인용 지시(라인 267 `[12:34] 김부장: …`)를 마커 형식으로 교체. 본문에 다음 블록을 포함:

```
근거가 되는 발언이 있으면 그 문장 끝에 마커를 붙이세요: ⟦t:<ms>|s:<화자>⟧
(예: 일정은 3월로 확정됐습니다. ⟦t:125000|s:화자 1⟧)
- ms·화자는 입력 전사 [MM:SS|<ms>ms 화자]에 실제 있는 값만 사용하고, 화자는 '화자 N' 형식 그대로 씁니다. 불명확하면 마커를 생략합니다.
- 마커는 문장 끝에만 붙이고 표/코드블록 안에는 넣지 않습니다.
```

`<<<FOLLOWUPS>>>` 센티넬 지시는 그대로 유지(마커는 본문, 센티넬은 말미 → `split_followups` 무영향).

- [ ] **Step 4: Run, verify pass**

Run: `cd backend && bundle exec rspec spec/services/llm_prompts_spec.rb`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/llm_prompts.rb backend/spec/services/llm_prompts_spec.rb
git commit -m "feat(citation): AI 챗 시스템 프롬프트에 발화근거 마커 지침"
```

---

### Task 7: FTS 인덱싱에서 마커 strip (`FtsIndexable` + `Summary`)

**Files:**
- Modify: `backend/app/models/concerns/fts_indexable.rb` (`fts_upsert`의 값 생성에 변환 훅)
- Modify: `backend/app/models/summary.rb` (notes_markdown 인덱싱 값에서 마커 제거)
- Test: `backend/spec/models/summary_spec.rb`

- [ ] **Step 1: Write failing test**

```ruby
# backend/spec/models/summary_spec.rb
it "FTS 인덱싱 값에서 마커를 제거한다" do
  Summary.ensure_fts_tables!
  s = meeting.summaries.create!(summary_type: "final", generated_at: Time.current,
    notes_markdown: "결정 보류 ⟦t:125000|s:화자 1⟧")
  row = ActiveRecord::Base.connection.execute(
    "SELECT notes_markdown FROM summaries_fts WHERE source_id = #{s.id}"
  ).first
  expect(row["notes_markdown"]).not_to include("⟦t:")
end
```

- [ ] **Step 2: Run, verify fail**

Run: `cd backend && bundle exec rspec spec/models/summary_spec.rb -e "마커를 제거"`
Expected: FAIL.

- [ ] **Step 3: Implement — 값 변환 훅**

`fts_indexable.rb` `fts_upsert`의 `vals` 생성을 훅 경유로:

```ruby
# fts_indexable.rb  fts_upsert 내 vals 라인 교체
cols = fts_columns.map(&:to_s)
vals = cols.map { |c| fts_value_for(c) }
```

그리고 concern에 기본 훅 추가(private):

```ruby
# fts_indexable.rb  private 영역
def fts_value_for(col)
  send(col)
end
```

`summary.rb`에서 override:

```ruby
# backend/app/models/summary.rb  (클래스 본문에 추가)
private

def fts_value_for(col)
  v = super
  col.to_s == "notes_markdown" ? v.to_s.gsub(/⟦t:\d+\|s:[^⟧]+⟧/, "") : v
end
```

(`transcripts_fts`는 override 없으므로 기본 `send(col)` 유지 — 무영향.)

- [ ] **Step 4: Run, verify pass + 회귀**

Run: `cd backend && bundle exec rspec spec/models/summary_spec.rb`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/concerns/fts_indexable.rb backend/app/models/summary.rb backend/spec/models/summary_spec.rb
git commit -m "feat(citation): FTS 인덱싱에서 발화근거 마커 strip"
```

---

## Phase 3 — AI Chat 프론트 적용 (쉬운 경로 먼저)

### Task 8: ChatMarkdown 마커→배지 렌더 + onSeek

**Files:**
- Modify: `frontend/src/components/meeting/ChatMarkdown.tsx`
- Test: `frontend/src/components/meeting/ChatMarkdown.test.tsx`(신규)

**전략:** react-markdown은 raw HTML을 렌더하지 않으므로, 렌더 전 `content`의 마커를 표준 마크다운 링크로 치환하고 `components.a`에서 가로채 `TimestampBadge`로 렌더한다.

**Interfaces:**
- Consumes: `parseCitationMarkers`/`CITATION_RE`(citationMarkers), `formatTime`, `TimestampBadge`.
- `ChatMarkdown({ content, onSeek? })` — onSeek 있으면 배지 활성.
- 치환 규칙: `⟦t:125000|s:화자 1⟧` → `[⏱](ddobak-seek:125000:화자%201)` (speaker는 `encodeURIComponent`).

- [ ] **Step 1: Write failing test**

```tsx
// frontend/src/components/meeting/ChatMarkdown.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChatMarkdown } from './ChatMarkdown'

describe('ChatMarkdown citation', () => {
  it('renders marker as a clickable badge that seeks', () => {
    const onSeek = vi.fn()
    render(<ChatMarkdown content={'일정 확정. ⟦t:125000|s:화자 1⟧'} onSeek={onSeek} />)
    const badge = screen.getByText('02:05')
    fireEvent.click(badge.closest('button')!)
    expect(onSeek).toHaveBeenCalledWith(125000)
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `cd frontend && npx vitest run src/components/meeting/ChatMarkdown.test.tsx`
Expected: FAIL(마커가 평문 노출).

- [ ] **Step 3: Implement**

```tsx
// ChatMarkdown.tsx 상단 import 추가
import { CITATION_RE } from '../../lib/citationMarkers'
import { TimestampBadge } from './TimestampBadge'

// 마커 → 마크다운 링크 치환
function markersToSeekLinks(text: string): string {
  return text.replace(new RegExp(CITATION_RE.source, 'g'), (_m, ms, sp) =>
    `[⏱](ddobak-seek:${ms}:${encodeURIComponent(sp)})`)
}

// MAP.a 교체: ddobak-seek scheme이면 배지
//   a: ({ children, href }) => { ... 아래 ... }
```

`MAP`의 `a` 핸들러를 다음으로 교체(클로저에서 `onSeek` 접근 위해 `MAP`을 `ChatMarkdown` 내부 함수로 옮기거나 `useMemo`로 생성):

```tsx
export function ChatMarkdown({ content, onSeek }: { content: string; onSeek?: (ms: number) => void }) {
  const components: Components = {
    ...MAP,
    a: ({ children, href }) => {
      if (href && href.startsWith('ddobak-seek:')) {
        const [, ms, sp] = href.split(':')
        return (
          <TimestampBadge
            ms={Number(ms)}
            speaker={decodeURIComponent(sp || '')}
            onSeek={onSeek ?? (() => {})}
            isAudioReady={!!onSeek}
          />
        )
      }
      return (
        <a href={href} className="text-blue-600 underline" target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      )
    },
  }
  return (
    <div className="text-sm leading-relaxed break-words space-y-1">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markersToSeekLinks(content)}
      </ReactMarkdown>
    </div>
  )
}
```

(기존 모듈 상수 `MAP`에서 `a`는 남겨도 무방 — 위 spread 후 덮어씀.)

- [ ] **Step 4: Run, verify pass**

Run: `cd frontend && npx vitest run src/components/meeting/ChatMarkdown.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/meeting/ChatMarkdown.tsx frontend/src/components/meeting/ChatMarkdown.test.tsx
git commit -m "feat(citation): 챗 답변 마커를 클릭 배지로 렌더"
```

---

### Task 9: 챗 onSeek 배선 (AiChatPanel → RightTabsPanel → MeetingPage + 모바일)

**Files:**
- Modify: `frontend/src/components/meeting/AiChatPanel.tsx`, `frontend/src/components/meeting/RightTabsPanel.tsx`, `frontend/src/pages/MeetingPage.tsx`
- Test: `frontend/src/components/meeting/AiChatPanel.test.tsx`(신규)

**Interfaces:**
- `AiChatPanel({ meetingId, onSeek? })` → `ChatMarkdown content onSeek`로 전달.
- `RightTabsPanel({ meetingId, memo, corrections?, onSeek? })` → `AiChatPanel onSeek`.
- `MeetingPage`: 데스크톱 `RightTabsPanel`(505-519)·모바일 `buildMeetingDetailTabs`(324-345) 챗 탭에 `onSeek={handleSeek}`.

- [ ] **Step 1: Write failing test**

```tsx
// frontend/src/components/meeting/AiChatPanel.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AiChatPanel } from './AiChatPanel'
// chatStore를 mock: assistant complete 메시지 1개에 마커 포함 content
vi.mock('../../stores/chatStore', () => ({
  useChatStore: (sel?: any) => {
    const state = {
      messages: [{ id: 1, role: 'assistant', status: 'complete', content: '확정. ⟦t:60000|s:화자 1⟧', suggestions: [] }],
      load: vi.fn(), send: vi.fn(),
    }
    return sel ? sel(state) : state
  },
}))
vi.mock('../../channels/chat', () => ({ subscribeChat: () => () => {} }))

describe('AiChatPanel onSeek', () => {
  it('passes onSeek to badge', () => {
    const onSeek = vi.fn()
    render(<AiChatPanel meetingId={1} onSeek={onSeek} />)
    fireEvent.click(screen.getByText('01:00').closest('button')!)
    expect(onSeek).toHaveBeenCalledWith(60000)
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `cd frontend && npx vitest run src/components/meeting/AiChatPanel.test.tsx`
Expected: FAIL(onSeek prop 미지원).

- [ ] **Step 3: Implement — props 추가**

```tsx
// AiChatPanel.tsx
export function AiChatPanel({ meetingId, onSeek }: { meetingId: number; onSeek?: (ms: number) => void }) {
  // ...
  // 62행 ChatMarkdown 호출 교체:
  //   <ChatMarkdown content={m.content} onSeek={onSeek} />
}
```

```tsx
// RightTabsPanel.tsx
export function RightTabsPanel({
  meetingId, memo, corrections, onSeek,
}: {
  meetingId: number
  memo: ReactNode
  corrections?: ReactNode
  onSeek?: (ms: number) => void
}) {
  // ...
  // 42행 교체: <AiChatPanel meetingId={meetingId} onSeek={onSeek} />
}
```

```tsx
// MeetingPage.tsx
// 데스크톱 RightTabsPanel 렌더(505-519)에 prop 추가:
//   <RightTabsPanel ... onSeek={handleSeek} />
// 모바일 buildMeetingDetailTabs(324-345) 챗 탭에서 AiChatPanel 생성 시:
//   <AiChatPanel meetingId={meetingId} onSeek={handleSeek} />
```

(`buildMeetingDetailTabs`가 별도 모듈(meetingDetailTabs.tsx)이면 그 함수 시그니처에 `onSeek`를 받아 챗 탭에 전달 — onSeek는 이미 그 빌더에 들어오는 것으로 조사됨. AiChatPanel 호출 지점에 onSeek 추가.)

- [ ] **Step 4: Run, verify pass + 빌드**

Run: `cd frontend && npx vitest run src/components/meeting/AiChatPanel.test.tsx && npx tsc --noEmit`
Expected: PASS + 타입 통과.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/meeting/AiChatPanel.tsx frontend/src/components/meeting/RightTabsPanel.tsx frontend/src/pages/MeetingPage.tsx frontend/src/components/meeting/AiChatPanel.test.tsx
git commit -m "feat(citation): 챗 배지 점프 onSeek 배선(데스크톱+모바일)"
```

---

## Phase 4 — 요약 BlockNote 적용 (spike 결과 의존)

> Phase 0 Spike에서 (A) 인라인 content spec 라운드트립이 가능하면 Task 10A·11, (B) 불가하면 읽기뷰(react-markdown) 분리 Task 10B로 간다. 아래는 (A) 기준. (B) 선택 시 Task 8의 ChatMarkdown 경로를 `AiSummaryFullViewModal` 읽기 렌더에 재사용하고, 메인 BlockNote 패널은 마커 평문 보존(편집 중 노출 허용)만 한다.

### Task 10A: BlockNote 인라인 마커 spec + 토큰↔인라인 변환

**Files:**
- Create: `frontend/src/components/meeting/citationInline.tsx`
- Modify: `frontend/src/components/meeting/mermaidBlock.tsx` (`editorSchema`에 `inlineContentSpecs` 추가)
- Test: `frontend/src/components/meeting/citationInline.test.ts`

**Interfaces:**
- Produces:
  - `CitationInline` — `createReactInlineContentSpec`로 정의한 `type:'citation'` 인라인(props: `ms:number`, `speaker:string`), 렌더는 `TimestampBadge`.
  - `markersToInline(blocks): blocks` — 파싱 후 블록 트리의 텍스트 인라인에서 `⟦t:..⟧`를 `citation` 인라인으로 split.
  - `inlineToMarkers(blocks): blocks` — 저장 전 `citation` 인라인을 다시 `⟦t:..⟧` 텍스트로 환원.

- [ ] **Step 1: Write failing test (round-trip)**

```ts
// citationInline.test.ts — 순수 변환 함수 라운드트립(렌더 제외)
import { describe, it, expect } from 'vitest'
import { markersToInline, inlineToMarkers } from './citationInline'

const block = (text: string) => ([{ id: 'b1', type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] }] as any)

describe('citation inline round-trip', () => {
  it('splits a marker into a citation inline and back', () => {
    const withInline = markersToInline(block('확정 ⟦t:60000|s:화자 1⟧'))
    const para = withInline[0]
    expect(para.content.some((c: any) => c.type === 'citation' && c.props.ms === 60000)).toBe(true)
    const back = inlineToMarkers(withInline)
    const joined = back[0].content.map((c: any) => c.type === 'citation' ? `⟦t:${c.props.ms}|s:${c.props.speaker}⟧` : c.text).join('')
    expect(joined).toBe('확정 ⟦t:60000|s:화자 1⟧')
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `cd frontend && npx vitest run src/components/meeting/citationInline.test.ts`
Expected: FAIL(module 없음).

- [ ] **Step 3: Implement `citationInline.tsx`**

```tsx
// frontend/src/components/meeting/citationInline.tsx
import { createReactInlineContentSpec } from '@blocknote/react'
import type { Block, BlockSchema, InlineContentSchema, StyleSchema } from '@blocknote/core'
import { CITATION_RE } from '../../lib/citationMarkers'
import { TimestampBadge } from './TimestampBadge'

export const CitationInline = createReactInlineContentSpec(
  { type: 'citation' as const, propSchema: { ms: { default: 0 }, speaker: { default: '' } }, content: 'none' },
  {
    render: ({ inlineContent }) => (
      <TimestampBadge
        ms={inlineContent.props.ms as number}
        speaker={inlineContent.props.speaker as string}
        onSeek={(window as any).__ddobakSeek ?? (() => {})}
      />
    ),
  },
)

type AnyBlock = Block<BlockSchema, InlineContentSchema, StyleSchema>

export function markersToInline(blocks: AnyBlock[]): AnyBlock[] {
  return blocks.map((b) => {
    const content = Array.isArray((b as any).content) ? (b as any).content : null
    let next = b
    if (content) {
      const rebuilt: any[] = []
      for (const node of content) {
        if (node?.type === 'text' && typeof node.text === 'string' && node.text.includes('⟦t:')) {
          let last = 0
          const re = new RegExp(CITATION_RE.source, 'g')
          let m: RegExpExecArray | null
          while ((m = re.exec(node.text)) !== null) {
            if (m.index > last) rebuilt.push({ type: 'text', text: node.text.slice(last, m.index), styles: node.styles ?? {} })
            rebuilt.push({ type: 'citation', props: { ms: Number(m[1]), speaker: m[2] } })
            last = m.index + m[0].length
          }
          if (last < node.text.length) rebuilt.push({ type: 'text', text: node.text.slice(last), styles: node.styles ?? {} })
        } else {
          rebuilt.push(node)
        }
      }
      next = { ...(b as any), content: rebuilt } as AnyBlock
    }
    if ((next as any).children?.length) next = { ...(next as any), children: markersToInline((next as any).children) }
    return next
  })
}

export function inlineToMarkers(blocks: AnyBlock[]): AnyBlock[] {
  return blocks.map((b) => {
    const content = Array.isArray((b as any).content) ? (b as any).content : null
    let next = b
    if (content) {
      const rebuilt = content.map((node: any) =>
        node?.type === 'citation'
          ? { type: 'text', text: `⟦t:${node.props.ms}|s:${node.props.speaker}⟧`, styles: {} }
          : node,
      )
      next = { ...(b as any), content: rebuilt } as AnyBlock
    }
    if ((next as any).children?.length) next = { ...(next as any), children: inlineToMarkers((next as any).children) }
    return next
  })
}
```

`mermaidBlock.tsx`의 `editorSchema`에 인라인 spec 등록:

```tsx
// mermaidBlock.tsx editorSchema 교체
import { CitationInline } from './citationInline'  // 순환 import 주의: TimestampBadge는 citationInline에서만 참조
export const editorSchema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, mermaid: MermaidBlock() },
  inlineContentSpecs: { ...defaultInlineContentSpecs, citation: CitationInline },
})
```
(`defaultInlineContentSpecs`를 `@blocknote/core`에서 import 추가.)

- [ ] **Step 4: Run, verify pass**

Run: `cd frontend && npx vitest run src/components/meeting/citationInline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/meeting/citationInline.tsx frontend/src/components/meeting/citationInline.test.ts frontend/src/components/meeting/mermaidBlock.tsx
git commit -m "feat(citation): BlockNote 인라인 마커 spec + 토큰 변환"
```

---

### Task 11: AiSummaryPanel 로드/저장 변환 + onSeek 배선

**Files:**
- Modify: `frontend/src/components/meeting/AiSummaryPanel.tsx`, `frontend/src/pages/MeetingPage.tsx`
- Test: 수동 + 기존 AiSummaryPanel 테스트 회귀

- [ ] **Step 1: 로드 시 마커→인라인**

`updateBlocks`(80-98)에서 `codeBlocksToMermaid` 다음에 `markersToInline` 적용:

```tsx
// AiSummaryPanel.tsx import 추가
import { markersToInline, inlineToMarkers } from './citationInline'
// 85행 교체
const converted = markersToInline(codeBlocksToMermaid(blocks as any[]))
```

- [ ] **Step 2: 저장 시 인라인→마커**

`saveNow`(102-154)에서 비-mermaid 블록 그룹을 `blocksToMarkdownLossy` 하기 전에 `inlineToMarkers` 적용:

```tsx
// saveNow 내 g.kind === 'blocks' 분기(125-129) 교체
const md = await editor.blocksToMarkdownLossy(inlineToMarkers(g.blocks as any) as any)
```

(주의: Defense 1·2 가드 로직(`isSuspiciousEmptySave`, `prevMarkdownRef`)은 그대로. 변환은 직렬화 입력에만 적용해 가드 판정에 영향 없음.)

- [ ] **Step 3: onSeek 주입**

배지 렌더가 `onSeek`에 닿도록 — BlockNote 인라인 render는 props 주입이 까다로우므로, AiSummaryPanel 마운트 시 `window.__ddobakSeek = onSeek` 형태로 전역 핸들 설정(citationInline render가 참조). `MeetingPage`의 `AiSummaryPanel` 렌더(509-516)에 `onSeek={handleSeek}` prop 추가, AiSummaryPanel에서 `useEffect`로 등록·해제:

```tsx
// AiSummaryPanelProps에 onSeek 추가, 본문에:
useEffect(() => {
  ;(window as any).__ddobakSeek = onSeek
  return () => { if ((window as any).__ddobakSeek === onSeek) delete (window as any).__ddobakSeek }
}, [onSeek])
```
(전역 핸들이 꺼려지면 BlockNote `editor`의 dictionary/context 주입 방식으로 대체 — spike에서 확인.)

- [ ] **Step 4: 빌드 + 회귀**

Run: `cd frontend && npx tsc --noEmit && npx vitest run src/components/meeting/AiSummaryPanel.test.tsx`
Expected: 타입 통과 + 기존 회귀 PASS.

- [ ] **Step 5: 수동 검증**

dev 서버 기동, 실제 회의 final 재요약 → 본문 문장 끝 배지 표시 → 클릭 시 오디오 점프 → 요약 편집·저장 후 재로드 시 배지 유지(라운드트립).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/meeting/AiSummaryPanel.tsx frontend/src/pages/MeetingPage.tsx
git commit -m "feat(citation): 요약 BlockNote 로드/저장 마커 변환 + 점프 배선"
```

---

## Spike 결과 (2026-06-18 실측, BlockNote 0.47.2)

- **A안(inline content spec) 확정.** 라운드트립 실측 PASS: `tryParseMarkdownToBlocks`가 `⟦t:..⟧`를 text 인라인으로 보존 → `markersToInline`(text→citation) ↔ `inlineToMarkers`(citation→text) 순수 변환 왕복 100% 복원(복수 마커 포함) → `blocksToMarkdownLossy`가 원 토큰 그대로 출력.
- **핵심 함정(Task 11 필수)**: citation 인라인을 `inlineToMarkers` 선처리 없이 `blocksToMarkdownLossy`에 직접 넘기면 런타임 에러 `node type citation not found in schema`. → saveNow는 반드시 `blocksToMarkdownLossy(inlineToMarkers(blocks))` 순서. 빠뜨리면 저장 시 크래시.
- API: `createReactInlineContentSpec`(@blocknote/react), `defaultInlineContentSpecs`(@blocknote/core, `{text, link}`) 정상 export. `BlockNoteSchema.create({ inlineContentSpecs: { ...defaultInlineContentSpecs, citation } })` 동작. `BlockNoteEditor.create()` jsdom headless OK(테스트 가능).
- **realtime 마커 보존 실측(Spike Step 2)**: 로컬 sidecar/backend 기동 필요 → 코드 단계 밖, 최종 E2E 기기검증으로 이월(프롬프트 보존 규칙은 Task 4에 반영됨).

---

## Self-Review (작성자 점검 완료)

- **Spec 커버리지**: §5.1 sidecar 형식=Task3, §5.2 backend 형식=Task3, §5.3 마커 지침·보존=Task4, §5.4 BlockNote=Task10A/11, §5.5 색=Task2(speakerColor 재사용), §5.6 공용=Task1/2, §6 R5 FTS=Task7·R6 표/코드=Task4·6 프롬프트·R8 오디오 ready=Task2, §9 챗=Task5/6/8/9. 전 항목 매핑됨.
- **Placeholder**: 없음. 모든 코드 스텝에 실제 코드 포함. 픽스처/spec 헬퍼는 "기존에 맞춰 조정" 표기(저장소 관례 의존부).
- **타입 일관성**: `onSeek(ms:number)` 전 경로 동일. `speakerColor(speakerLabel)` 시그니처 일치. `markersToInline`/`inlineToMarkers` Task10A 정의=Task11 사용 일치. `CITATION_RE` Task1 정의=Task8/10A 재사용.
