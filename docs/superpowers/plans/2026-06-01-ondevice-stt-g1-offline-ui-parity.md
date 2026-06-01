# G1 — 오프라인 라이브 UI 패리티 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 완전 오프라인 회의 라이브 화면(`LocalMeetingLivePage`)을 커스텀 최소 UI에서 서버 모바일 셸 3종(`MobileRecordControls` + `MobileTabLayout` + `LiveStatusBar`)으로 통일한다.

**Architecture:** 전사 본문은 서버 경로와 동일한 `LiveRecord`(transcriptStore 기반)로 렌더해 STT 위치 무관 동일 UI를 실증한다(전략 §0 직교분리). `LiveRecord`에 `editable` prop을 추가해 오프라인은 인라인 편집(서버 `updateTranscript`)을 원천 차단한다. 상태/에러는 단일 `LiveStatusBar.statusMessage` surface로 노출.

**Tech Stack:** React 18 + TypeScript, Vitest + @testing-library/react, Tailwind v4, Tauri(Android), zustand(transcriptStore).

**Spec:** `docs/superpowers/specs/2026-06-01-ondevice-stt-g1-offline-ui-parity-design.md`

> **커밋 정책:** 이 프로젝트는 명시적 사용자 승인 없이 커밋 금지(메모리 `feedback_no_auto_commit`). 각 Task의 커밋 스텝은 사용자가 "커밋해"라고 확인한 뒤에만 실행한다. 그 전까지는 변경만 쌓고 검증한다.

---

## File Structure

| 파일 | 역할 | 변경 |
|---|---|---|
| `frontend/src/components/meeting/LiveRecord.tsx` | 전사 본문 렌더(서버·오프라인 공용) | `editable?: boolean` prop 추가 |
| `frontend/src/components/meeting/LiveRecord.test.tsx` | LiveRecord 단위 테스트 | editable 회귀 케이스 추가 |
| `frontend/src/pages/LocalMeetingLivePage.tsx` | 오프라인 라이브 화면 | 3-zone 전면 재작성 |
| `frontend/src/pages/LocalMeetingLivePage.test.tsx` | 페이지 셸 테스트 | 신규 |
| `docs/superpowers/specs/2026-06-01-ondevice-stt-auto-decisions.md` | 자동결정 기록 | A26~A28 추가 |

---

## Task 1: `LiveRecord` editable prop

전사 본문 컴포넌트에 `editable` prop을 추가한다. 기본 `true`라 서버 경로(`RecordTabPanel`)는 무영향. 오프라인만 `false`를 넘겨 인라인 편집을 차단한다.

**Files:**
- Modify: `frontend/src/components/meeting/LiveRecord.tsx`
- Test: `frontend/src/components/meeting/LiveRecord.test.tsx`

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/meeting/LiveRecord.test.tsx` 끝(마지막 `})` 직전, 마지막 `it(...)` 뒤에 두 케이스를 추가한다:

```tsx
  it('editable=false면 전사 텍스트가 읽기전용(편집 affordance 없음)', () => {
    useTranscriptStore.getState().addFinal({
      id: 1,
      content: '읽기전용 발화',
      speaker_label: 'SPEAKER_00',
      started_at_ms: 0,
      ended_at_ms: 3000,
      sequence_number: 1,
      applied: false,
    })
    render(<LiveRecord meetingId={-1} editable={false} />)
    const el = screen.getByText('읽기전용 발화')
    // 비편집: contentEditable 비활성 + 포커스 불가(tabIndex=-1)
    expect(el).toHaveAttribute('contenteditable', 'false')
    expect(el).toHaveAttribute('tabindex', '-1')
  })

  it('editable 미지정(기본 true)이면 편집 가능 affordance 유지', () => {
    useTranscriptStore.getState().addFinal({
      id: 1,
      content: '편집가능 발화',
      speaker_label: 'SPEAKER_00',
      started_at_ms: 0,
      ended_at_ms: 3000,
      sequence_number: 1,
      applied: false,
    })
    render(<LiveRecord meetingId={1} />)
    const el = screen.getByText('편집가능 발화')
    expect(el).toHaveAttribute('tabindex', '0')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/meeting/LiveRecord.test.tsx`
Expected: 새 두 케이스 중 `editable=false` 케이스 FAIL — 현재 `EditableTranscriptText`는 항상 `editable` 하드코딩 `true`라 `tabindex='0'`/`contenteditable` 미반영. (기본 케이스는 통과할 수 있음.)

- [ ] **Step 3: Add the `editable` prop to `LiveRecord`**

`frontend/src/components/meeting/LiveRecord.tsx`에서 props 인터페이스와 구조분해, 그리고 `EditableTranscriptText` 사용처를 수정한다.

인터페이스(8~12행 부근):

```tsx
interface LiveRecordProps {
  meetingId: number
  currentTimeMs?: number
  onSeek?: (ms: number) => void
  onApply?: () => Promise<void>
  editable?: boolean
}

export function LiveRecord({ meetingId, currentTimeMs = 0, onSeek, onApply, editable = true }: LiveRecordProps) {
```

본문 내 `<EditableTranscriptText ... editable />`(현재 약 85~91행)에서 `editable` 하드코딩을 prop으로 교체:

```tsx
            <EditableTranscriptText
              transcriptId={item.id}
              meetingId={meetingId}
              content={item.content}
              editable={editable}
              className="text-sm text-gray-900 leading-relaxed"
            />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/meeting/LiveRecord.test.tsx`
Expected: PASS (전체 케이스 — 기존 7 + 신규 2).

- [ ] **Step 5: Commit** (사용자 승인 후)

```bash
git add frontend/src/components/meeting/LiveRecord.tsx frontend/src/components/meeting/LiveRecord.test.tsx
git commit -m "feat(stt): LiveRecord editable prop (오프라인 읽기전용 전사·서버 무영향)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `LocalMeetingLivePage` 3-zone 재작성

오프라인 라이브 화면을 서버 모바일 셸로 통일한다.

**Files:**
- Modify(전면 재작성): `frontend/src/pages/LocalMeetingLivePage.tsx`
- Test(신규): `frontend/src/pages/LocalMeetingLivePage.test.tsx`

- [ ] **Step 1: Write the failing test**

`frontend/src/pages/LocalMeetingLivePage.test.tsx` 신규 생성:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import LocalMeetingLivePage from './LocalMeetingLivePage'
import * as useLocalRecordingModule from '../hooks/useLocalRecording'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../api/settings', () => ({
  getLanguageSettings: vi.fn().mockResolvedValue({ mode: 'single', languages: ['ko'] }),
}))
vi.mock('../stt/cohereLang', () => ({ localSttLanguage: () => 'ko' }))
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  IS_TAURI: true,
}))
vi.mock('../components/stt/ModelManager', () => ({
  default: () => <div data-testid="model-manager">모델 매니저</div>,
}))
vi.mock('../components/meeting/LiveRecord', () => ({
  LiveRecord: ({ editable }: { editable?: boolean }) => (
    <div data-testid="live-record" data-editable={String(editable)}>기록 본문</div>
  ),
}))
vi.mock('../hooks/useLocalRecording')

const baseRec = {
  status: 'idle' as const,
  meta: { title: '내 오프라인 회의' } as any,
  error: null as string | null,
  elapsedSeconds: 0,
  isRecording: false,
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/local-meetings/local-abc/live']}>
      <Routes>
        <Route path="/local-meetings/:localId/live" element={<LocalMeetingLivePage />} />
        <Route path="/meetings" element={<div data-testid="meetings-route">회의목록</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('LocalMeetingLivePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useLocalRecordingModule.useLocalRecording).mockReturnValue({ ...baseRec })
  })

  it('모델 준비됨 → 3-zone 셸(헤더/기록탭/상태바) + 읽기전용 LiveRecord 렌더', async () => {
    vi.mocked(invoke).mockResolvedValue({ dir: '/models/cohere' })
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('mobile-record-controls')).toBeInTheDocument()
    })
    // 단일 "기록" 탭
    expect(screen.getByRole('tab', { name: /기록/i })).toBeInTheDocument()
    // 전사 본문 = 읽기전용 LiveRecord
    const rec = screen.getByTestId('live-record')
    expect(rec).toHaveAttribute('data-editable', 'false')
    // 상태바 STT 엔진 표기
    expect(screen.getByText(/온디바이스/)).toBeInTheDocument()
    // 제목은 meta.title
    expect(screen.getByText('내 오프라인 회의')).toBeInTheDocument()
  })

  it('모델 미설치 → 기록 탭 본문이 ModelManager로 대체', async () => {
    vi.mocked(invoke).mockResolvedValue(null)
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('model-manager')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('live-record')).not.toBeInTheDocument()
  })

  it('rec.error는 상태바 statusMessage로 노출', async () => {
    vi.mocked(invoke).mockResolvedValue({ dir: '/models/cohere' })
    vi.mocked(useLocalRecordingModule.useLocalRecording).mockReturnValue({
      ...baseRec,
      error: '온디바이스 모델이 준비되지 않았습니다.',
    })
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('온디바이스 모델이 준비되지 않았습니다.')).toBeInTheDocument()
    })
  })

  it('헤더 "회의 시작" 클릭 시 rec.start 호출', async () => {
    vi.mocked(invoke).mockResolvedValue({ dir: '/models/cohere' })
    const start = vi.fn().mockResolvedValue(undefined)
    vi.mocked(useLocalRecordingModule.useLocalRecording).mockReturnValue({ ...baseRec, start })
    renderPage()
    const controls = await screen.findByTestId('mobile-record-controls')
    fireEvent.click(within(controls).getByRole('button', { name: /회의 시작/i }))
    expect(start).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/LocalMeetingLivePage.test.tsx`
Expected: FAIL — 현재 페이지는 `mobile-record-controls`/`role="tab"`/읽기전용 `data-editable="false"`를 렌더하지 않음(커스텀 헤더 + 평문 리스트).

- [ ] **Step 3: Rewrite `LocalMeetingLivePage`**

`frontend/src/pages/LocalMeetingLivePage.tsx`를 아래로 전면 교체:

```tsx
/**
 * LocalMeetingLivePage — 완전 오프라인(서버 없음) 온디바이스 회의 녹음 화면.
 *
 * 서버 모바일 셸 3종(MobileRecordControls + MobileTabLayout + LiveStatusBar)을 재사용해
 * 서버 회의 라이브 UI와 동일한 모양으로 통일한다(전략 §0 직교분리 실증). 전사 본문은
 * 서버 경로와 같은 LiveRecord(transcriptStore 기반)로 렌더된다.
 *
 * 설계: docs/superpowers/specs/2026-06-01-ondevice-stt-g1-offline-ui-parity-design.md
 */
import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import { FileText } from 'lucide-react'

import { useLocalRecording } from '../hooks/useLocalRecording'
import { getLanguageSettings } from '../api/settings'
import { localSttLanguage } from '../stt/cohereLang'
import { IS_TAURI } from '../config'
import { MobileRecordControls } from '../components/meeting/MobileRecordControls'
import { LiveStatusBar } from '../components/meeting/LiveStatusBar'
import MobileTabLayout, { type Tab } from '../components/layout/MobileTabLayout'
import { LiveRecord } from '../components/meeting/LiveRecord'
import ModelManager from '../components/stt/ModelManager'

/** 오프라인 회의엔 서버 회의가 없다. LiveRecord에 닿지 않는 센티넬 meetingId를 쓰고
 *  editable={false}와 결합해 인라인 편집(서버 updateTranscript)을 원천 차단(설계 §4). */
const OFFLINE_SENTINEL_MEETING_ID = -1

export default function LocalMeetingLivePage() {
  const { localId } = useParams<{ localId: string }>()
  const navigate = useNavigate()

  const [language, setLanguage] = useState('ko')
  const [modelDir, setModelDir] = useState<string | null>(null)
  const [resolving, setResolving] = useState(true)
  const [resolveErr, setResolveErr] = useState<string | null>(null)
  // ModelManager 다운로드 완료 시 bump → 모델 경로 재해석(녹음 게이트 해제).
  const [reloadKey, setReloadKey] = useState(0)
  const [isStopping, setIsStopping] = useState(false)

  // 모델 경로 + 언어 결정. 모델 미설치면 modelDir=null(에러 아님) → 기록 탭이 ModelManager 노출.
  useEffect(() => {
    let cancelled = false
    setResolving(true)
    ;(async () => {
      try {
        const cfg = await getLanguageSettings().catch(
          () => ({ mode: 'single' as const, languages: ['ko'] }),
        )
        const lang = localSttLanguage(cfg) ?? 'ko'
        let dir: string | null = null
        if (IS_TAURI) {
          const paths = await invoke<{ dir: string }>('resolve_model_paths').catch(() => null)
          dir = paths?.dir ?? null
        }
        if (cancelled) return
        setLanguage(lang)
        setModelDir(dir)
        setResolveErr(null)
      } catch (e) {
        if (!cancelled) setResolveErr(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setResolving(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const rec = useLocalRecording(localId ?? '', language, modelDir)

  // 단일 상태/에러 surface(설계 §2-③). 우선순위: 해석실패 > 녹음에러 > 해석중.
  const statusMessage = resolveErr ?? rec.error ?? (resolving ? '준비 중...' : null)

  const handleStop = async () => {
    setIsStopping(true)
    try {
      await rec.stop()
    } finally {
      setIsStopping(false)
    }
  }

  // 기록 탭: 모델 있으면 LiveRecord(읽기전용), 없으면 ModelManager 게이트.
  const tabs: Tab[] = useMemo(
    () => [
      {
        id: 'transcript',
        label: '기록',
        icon: FileText,
        content: modelDir ? (
          <LiveRecord meetingId={OFFLINE_SENTINEL_MEETING_ID} editable={false} />
        ) : (
          <div className="p-4 space-y-2">
            <p className="text-sm text-muted-foreground">
              오프라인 전사를 시작하려면 먼저 온디바이스 모델을 받아야 합니다.
            </p>
            <ModelManager onChanged={() => setReloadKey((k) => k + 1)} />
          </div>
        ),
      },
    ],
    [modelDir],
  )

  if (!localId) {
    navigate('/meetings', { replace: true })
    return null
  }

  return (
    <div className="flex flex-col h-full">
      <MobileRecordControls
        title={rec.meta?.title ?? '오프라인 회의'}
        isRecording={rec.isRecording}
        isPaused={false}
        elapsedSeconds={rec.elapsedSeconds}
        onBack={() => navigate('/meetings')}
        onStart={rec.start}
        onPause={() => {}}
        onResume={() => {}}
        onStop={handleStop}
        isStopping={isStopping}
      />

      <div className="flex-1 min-h-0">
        <MobileTabLayout tabs={tabs} />
      </div>

      <LiveStatusBar
        isActive={rec.isRecording}
        isSystemCapturing={false}
        meetingApiStatus={null}
        statusMessage={statusMessage}
        sttEngine="온디바이스"
      />
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/LocalMeetingLivePage.test.tsx`
Expected: PASS (4 케이스).

- [ ] **Step 5: Commit** (사용자 승인 후)

```bash
git add frontend/src/pages/LocalMeetingLivePage.tsx frontend/src/pages/LocalMeetingLivePage.test.tsx
git commit -m "feat(stt): 오프라인 라이브 UI 서버 모바일 셸로 통일 (G1)

MobileRecordControls + MobileTabLayout(기록) + LiveStatusBar 재사용.
전사 본문 = LiveRecord(editable=false, 센티넬 meetingId). 모델 미설치 시
기록 탭이 ModelManager 노출. 상태/에러는 단일 statusMessage surface.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 자동결정 기록 + 전체 검증

**Files:**
- Modify: `docs/superpowers/specs/2026-06-01-ondevice-stt-auto-decisions.md`

- [ ] **Step 1: 자동결정 A26~A28 추가**

`2026-06-01-ondevice-stt-auto-decisions.md` 말미(마지막 결정 항목 뒤)에 추가:

```markdown
## G1 — 오프라인 라이브 UI 패리티

- **A26** 오프라인 전사 본문의 인라인 편집은 **비활성**. `LiveRecord`에 `editable?: boolean`(기본 true) 추가, 오프라인은 `editable={false}`. 사유: 서버 없는 오프라인에서 `updateTranscript` POST는 실패→롤백되어 편집이 사라짐. 거짓 affordance 제거. 오프라인 편집 영속은 비목표(YAGNI). 서버 경로는 기본 true라 무영향.
- **A27** 종료(stop) 후 **재개 허용**. `MobileRecordControls` 기본 동작(비녹음=「회의 시작」) 그대로 사용, 별도 「완료」 분기 없음. 이탈은 뒤로가기.
- **A28** 상태/에러는 **단일 `LiveStatusBar.statusMessage` surface**. 우선순위 `resolveErr > rec.error > (resolving?'준비 중...':null)`. 제거한 커스텀 배너/평문 에러 영역의 대체. 서버 셸과 동일 패턴.
- **A29**(부수) 모바일 폴리시: `.bn-editor` 좌우 패딩 모바일(lg 미만) 54px→16px(index.css), AppLayout 모바일 헤더 `min-h-12→min-h-10`·버튼 `p-2.5→p-2`. G1과 별개 시각 정리.
```

- [ ] **Step 2: 전체 검증 — 관련 vitest**

Run: `cd frontend && npx vitest run src/components/meeting/LiveRecord.test.tsx src/pages/LocalMeetingLivePage.test.tsx src/components/layout/AppLayout.test.tsx src/components/meeting/MobileRecordControls.test.tsx src/components/layout/MobileTabLayout.test.tsx`
Expected: PASS (전부).

- [ ] **Step 3: 전체 검증 — 빌드(APK beforeBuildCommand 동치)**

Run: `cd frontend && npx vite build`
Expected: `✓ built` (에러 0). tsc -b가 아니라 vite build로 검증(무관 기존 tsc 에러 무시).

- [ ] **Step 4: Commit** (사용자 승인 후)

```bash
git add docs/superpowers/specs/2026-06-01-ondevice-stt-auto-decisions.md
git commit -m "docs(stt): 자동결정 A26~A29 (G1 오프라인 UI 패리티)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- 설계 §2-① 헤더 MobileRecordControls → Task 2 (title/isRecording/elapsed/onBack/onStart/onStop/isStopping/no-op pause). ✅
- 설계 §2-② 단일 기록 탭 + modelDir 분기(LiveRecord/ModelManager) → Task 2. ✅
- 설계 §2-③ LiveStatusBar + 단일 statusMessage → Task 2. ✅
- 설계 §3.1 LiveRecord editable prop(서버 무영향) → Task 1. ✅
- 설계 §4 센티넬 -1 + editable=false 도달불가 → Task 1(읽기전용 검증) + Task 2(data-editable=false). ✅
- 설계 §6 테스트(LiveRecord 회귀 + 빌드/회귀) → Task 1·3. ✅
- 설계 §7 자동결정 A26~ → Task 3. ✅

**Placeholder scan:** 모든 스텝에 실제 코드/명령/기대출력 포함. TBD/TODO 없음. ✅

**Type consistency:** `editable?: boolean`(Task 1) = `editable={false}`(Task 2) 일치. `OFFLINE_SENTINEL_MEETING_ID=-1` 단일 정의. `Tab` 타입은 `MobileTabLayout` export 재사용. `useLocalRecording` 반환 필드(status/meta/error/elapsedSeconds/isRecording/start/stop)와 테스트 mock 일치. ✅
