# 화자분리 "최대 분리 + 이름 통합 + 연속 merge" 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** 기본 threshold 0.3(더 공격적 분리) + 같은 speaker_name을 다운스트림(export/통계/검색)에서 동일인 취급 + 연속 동일화자 세그먼트 표시단 merge.

**Architecture:** speaker_name(표시명) = 진실원천 SpeakerDB의 비정규화 사본. label→name 보정은 모두 `speaker_name.presence || speaker_label`(FE `speaker_name ?? speaker_label`) 폴백 패턴. split(word 단위)은 엔진 의존으로 폐기, 연속 동일화자 merge로 대체.

**Tech Stack:** Rails 7(SQLite FTS5) · React/TS(Vite) · sidecar FastAPI(speakrs).

**선행 조사:** spec `2026-06-14-diarization-split-merge-design.md`. 요약은 `transcript.rb:17 to_sidecar_payload`가 이미 name 기준 → 변경 불필요(검증만). markdown export(`markdown_exporter.rb:109`)·search filter(`search_service.rb:52,83`)도 이미 name 폴백.

**서버 상태:** sidecar 가동 중(:13324), rails 미가동. settings.yaml/app_settings 변경은 rails 재시작 불필요(매 요청 재로드). FTS 마이그레이션은 rails 미가동이라 PendingMigration 500 위험 없음 — 추가 후 즉시 migrate.

---

## Task T1: 기본 threshold 0.4 → 0.3

**Files:**
- Modify: `settings.yaml:73` (live 값 — **이게 실효**)
- Modify: `backend/app/services/app_settings.rb:10` (fallback 기본값)
- Modify: `frontend/src/components/meeting/EditMeetingDialog.tsx:150,161`
- Modify: `backend/spec/services/app_settings_spec.rb` (기본값 단언)

- [ ] **Step 1: settings.yaml live 값 변경 (핵심)**
```yaml
# settings.yaml line 73 (diarization: 블록)
  ahc_threshold: 0.3
```
`diarization_config`가 yaml 값 우선 사용 → 이거 안 바꾸면 default 변경 무효.

- [ ] **Step 2: DIARIZATION_DEFAULTS fallback**
`app_settings.rb:10` `"ahc_threshold" => 0.4,` → `"ahc_threshold" => 0.3,`

- [ ] **Step 3: FE 슬라이더 기본 표시 (min 0.2 불변)**
`EditMeetingDialog.tsx:150` `value={diarizationThreshold || '0.4'}` → `'0.3'`
`EditMeetingDialog.tsx:161` `기본값(0.4)` → `기본값(0.3)`

- [ ] **Step 4: 기본값 단언 spec**
`app_settings_spec.rb` 기본 `"ahc_threshold" => 0.4,` → `0.3,` (yaml fixture가 키 생략 시 DEFAULTS 폴백을 단언하는 예제)

- [ ] **Step 5: 검증**
```bash
cd backend && bundle exec rspec spec/services/app_settings_spec.rb
cd frontend && npx tsc --noEmit
```
Expected: rspec green, tsc 0 errors. 슬라이더 min 0.2 유지 확인.

---

## Task T2: export를 speaker_name 기준으로 (JSON payload + FE pdf/docx)

**Files:**
- Modify: `backend/app/services/meeting_export_serializer.rb` (build_transcripts — `speaker_name` 필드 추가, label 원본 유지)
- Modify: `frontend/src/api/meetings.ts` (MeetingExportData.transcripts 타입에 `speaker_name?`)
- Modify: `frontend/src/lib/pdfExporter.ts` (per-line 표시 name 폴백)
- Modify: `frontend/src/lib/docxExporter.ts` (동일)

> 주의: markdown export는 이미 OK. JSON serializer는 label만 emit → FE가 name 못 받음. **serializer에 speaker_name 필드 추가가 load-bearing**(없으면 FE 변경이 no-op).

- [ ] **Step 1: serializer에 speaker_name 필드 추가**
```ruby
# meeting_export_serializer.rb build_transcripts
      {
        speaker_label: t.speaker_label,
        speaker_name:  t.speaker_name,
        timestamp:     format_timestamp_ms(t.started_at_ms),
        content:       t.content
      }
```

- [ ] **Step 2: export 타입에 speaker_name**
```ts
// meetings.ts MeetingExportData.transcripts
  transcripts: Array<{
    speaker_label: string
    speaker_name?: string | null
    timestamp: string
    content: string
  }>
```

- [ ] **Step 3: pdf/docx per-line 표시 name 폴백**
`pdfExporter.ts` `esc(t.speaker_label)` → `esc(t.speaker_name ?? t.speaker_label)`
`docxExporter.ts` `text: t.speaker_label` → `text: t.speaker_name ?? t.speaker_label`

- [ ] **Step 4: 검증**
```bash
cd frontend && npx tsc --noEmit
```
Expected: 0 errors. (수동: 이름 지정 회의 export → 이름 표시, 미지정은 라벨 폴백.)

---

## Task T3: 화자수 distinct를 name 기준 (라벨 목록·rename UI는 라벨 유지)

**Files:**
- Modify: `frontend/src/components/meeting/SpeakerPanel.tsx`

- [ ] **Step 1: name 기준 distinct count memo 추가** (`visibleSpeakers` memo 직후)
```tsx
  // 화자 "수"는 이름 기준 distinct: 다른 라벨이라도 같은 이름이면 1명.
  // 이름 없는 라벨(name===id)은 각자 id로 구분되어 별개 카운트.
  const distinctSpeakerCount = useMemo(
    () => new Set(visibleSpeakers.map((s) => s.name || s.id)).size,
    [visibleSpeakers]
  )
```

- [ ] **Step 2: 헤더 카운트 표시를 distinct로**
`화자 목록{visibleSpeakers.length > 0 ? \` (${visibleSpeakers.length})\` : ''}`
→ `... \` (${distinctSpeakerCount})\` ...` (게이트는 `visibleSpeakers.length > 0` 유지)

- [ ] **Step 3: 검증**
```bash
cd frontend && npx tsc --noEmit
```
Expected: 0 errors. (수동: 2라벨 같은 이름 → 헤더 (1), 목록은 2행 유지.)

---

## Task T4: 화자 이름 검색 (transcripts_fts에 speaker_name 추가)

**Files:**
- Modify: `backend/app/models/transcript.rb:3` (fts_table columns)
- Modify: `backend/app/models/concerns/fts_indexable.rb:17` (ensure_fts_tables! 컬럼 목록)
- Create: `backend/db/migrate/20260614######_add_speaker_name_to_transcripts_fts.rb` (drop+recreate+repopulate)

> SearchService는 이미 speaker_name **필터**됨. 갭 = FTS MATCH 인덱스에 speaker_name 없음 → 이름을 쿼리어로 치면 발화 안 잡힘. content는 컬럼0 유지(snippet 불변).

- [ ] **Step 1: 모델 fts 컬럼**
`transcript.rb:3` `columns: %i[content speaker_label]` → `%i[content speaker_label speaker_name]`

- [ ] **Step 2: concern 하드코딩 컬럼 목록**
`fts_indexable.rb:17` `[ "transcripts_fts", "content, speaker_label" ],` → `"content, speaker_label, speaker_name"`
(주의: `CREATE VIRTUAL TABLE IF NOT EXISTS`라 기존 테이블 미변경 — 마이그레이션이 권위.)

- [ ] **Step 3: 마이그레이션 작성** — 기존 `20260403062447_create_fts5_tables.rb` 스타일 따름. transcripts_fts drop → recreate(content, speaker_label, speaker_name, source_id UNINDEXED) → transcripts에서 repopulate. up/down 모두. (FTS 동기화는 Ruby 콜백 `fts_upsert`, 트리거 없음 → 트리거 재작성 불필요.)

- [ ] **Step 4: 마이그레이션 실행 + 컬럼 순서 검증**
```bash
cd backend && bin/rails db:migrate
bin/rails runner "puts ActiveRecord::Base.connection.execute(%q{SELECT name FROM pragma_table_info('transcripts_fts')}).map{|r| r['name']}.inspect"
```
Expected: `["content","speaker_label","speaker_name","source_id"]` (content=0).

- [ ] **Step 5: 이름 검색 동작 + 기존 검색 회귀 검증**
```bash
cd backend && bundle exec rspec spec/requests/api/v1/search_spec.rb
```
Expected: green. (수동: 이름으로 검색 → 그 화자 발화 rows. 같은 이름 2라벨 둘 다.)

---

## Task T5 (§4'): 연속 동일화자 표시단 merge

**Files:**
- Modify: `frontend/src/components/meeting/TranscriptPanel.tsx` (groups useMemo + grouped render)

> 표시 전용. 세그먼트별 id·편집(EditableTranscriptText)·하이라이트(HighlightedText)·오디오싱크(flatIdx===highlightedIndex)·timestamp 전부 유지. 텍스트 blob 병합 금지 — 그룹 헤더(화자칩+첫 시각) 1개 + 멤버 세그먼트 각자 렌더.

- [ ] **Step 1: groups useMemo 추가** (`highlightedIndex` 계산 직후)
```tsx
  // 표시 병합: 해석된 이름이 연속 동일한 세그먼트를 한 그룹으로.
  // 편집/하이라이트/타임스탬프는 세그먼트별 유지 위해 flatIdx 함께 보관.
  // rename이 그룹 경계 바꾸므로 deps에 speakerNameOverrides 포함.
  const groups = useMemo(() => {
    const resolveName = (t: Transcript): string =>
      ((speakerNameOverrides.has(t.id)
        ? speakerNameOverrides.get(t.id)
        : t.speaker_name) ?? t.speaker_label)
    const out: {
      key: number
      name: string
      startedAtMs: number
      segments: { transcript: Transcript; flatIdx: number }[]
    }[] = []
    transcripts.forEach((transcript, flatIdx) => {
      const name = resolveName(transcript)
      const last = out[out.length - 1]
      if (last && last.name === name) {
        last.segments.push({ transcript, flatIdx })
      } else {
        out.push({ key: transcript.id, name, startedAtMs: transcript.started_at_ms,
          segments: [{ transcript, flatIdx }] })
      }
    })
    return out
  }, [transcripts, speakerNameOverrides])
```
(`Transcript` 타입 import 확인 — 없으면 `meetings.ts`에서 import 추가.)

- [ ] **Step 2: flat map → grouped render 교체** (draft의 newString 적용: 그룹 헤더 + 내부 세그먼트 맵, 내부 row는 `flatIdx === highlightedIndex`로 하이라이트·`highlightedRef`·`onSeek(transcript.started_at_ms)` 유지)

- [ ] **Step 3: 검증**
```bash
cd frontend && npx tsc --noEmit
```
Expected: 0 errors. (수동: 연속 동일화자 → 헤더 1 + 각 발화 행 유지. 편집/검색/오디오싱크/rename 후 경계 갱신 동작.)

---

## Task T6: 다운스트림 요약 동일인 — 검증만 (코드 변경 없음)

- [ ] `transcript.rb:17 to_sidecar_payload`가 `speaker_name.presence || speaker_label` 사용 확인 → 요약 LLM payload는 이미 name 기준. 변경 없음. (회귀 방지로 기존 spec 통과만 확인.)

---

## 통합 검증

- [ ] `cd frontend && npx tsc --noEmit` (전체 0 errors)
- [ ] `cd backend && bundle exec rspec spec/services/app_settings_spec.rb spec/requests/api/v1/search_spec.rb` (green)
- [ ] FTS 컬럼 순서 `["content","speaker_label","speaker_name","source_id"]`
- [ ] 수동(회의 111, dev DB): threshold 0.3 신규/리셋 시 분리 양상 · 같은 이름 2라벨 → export·통계 1명·이름검색 양쪽 · 연속 동일화자 merge 블록.
- [ ] 커밋은 **명시 요청 시만**.
