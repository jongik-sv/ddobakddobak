# TSK-02-04: MeetingLivePage 패널/탭 분기 - 설계

## 구현 방향
- `useMediaQuery(BREAKPOINTS.lg)`로 데스크톱/모바일 분기하여 MeetingLivePage의 3컬럼 PanelGroup 영역을 조건부 렌더링
- 데스크톱(>= lg): 기존 `PanelGroup` 3컬럼 레이아웃 100% 유지 (화자+전사 20% | AI 요약 50% | 메모 30%)
- 모바일(< lg): `MobileTabLayout` 컴포넌트로 전사/요약/메모 3개 탭 전환 UI 적용
- SpeakerPanel은 모바일에서 전사 탭 상단에 접이식(accordion) `<details>` 요소로 포함
- MeetingPage(TSK-02-02)와 동일한 패턴을 적용하되, Live 페이지 고유 요소(실시간 녹음 상태, ActionCable 연결, ParticipantList)를 반영

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| `frontend/src/pages/MeetingLivePage.tsx` | 메인 수정 대상 — PanelGroup 영역(line 740~860)을 `isDesktop` 분기로 래핑 | 수정 |
| `frontend/src/hooks/useMediaQuery.ts` | 미디어 쿼리 훅 (TSK-00-02에서 생성) | 의존 |
| `frontend/src/components/layout/MobileTabLayout.tsx` | 모바일 탭 레이아웃 (TSK-02-01에서 생성 완료) | 재사용 |

## 주요 구조

- **MeetingLivePage (수정)** -- 조건부 분기 로직 추가
  - `const isDesktop = useMediaQuery(BREAKPOINTS.lg)` 훅 호출
  - `isDesktop ? <DesktopPanelLayout /> : <MobileTabbedLayout />` 분기
  - 기존 PanelGroup JSX를 데스크톱 분기 안으로 이동 (코드 변경 없음)

- **데스크톱 분기 (기존 유지)**
  - `<PanelGroup orientation="horizontal">` 3컬럼 그대로 유지
  - Panel 1: RecordTabPanel + SpeakerPanel + ParticipantList (20%)
  - Panel 2: AiSummaryPanel (50%)
  - Panel 3: MeetingEditor + 오타 수정 (30%, `memoVisible` 조건부)

- **모바일 분기 (신규 추가)**
  - `<MobileTabLayout tabs={[전사탭, 요약탭, 메모탭]}>` 사용
  - 전사 탭 content:
    - `<details>` accordion으로 SpeakerPanel 포함 (기본 닫힘)
    - `isSharing` 시 ParticipantList도 accordion 안에 포함
    - `<RecordTabPanel meetingId={meetingId} currentTimeMs={0} onApply={...} />`
  - 요약 탭 content:
    - `<AiSummaryPanel meetingId={meetingId} isRecording={isActive} onNotesChange={handleNotesChange} />`
  - 메모 탭 content:
    - 메모 저장 버튼 헤더 + `<MeetingEditor editorRef={memoEditorRef} />`
    - 오타 수정 영역 (corrections UI 그대로 재사용)

- **SpeakerAccordion (인라인 구현)** -- 전사 탭 상단 접이식 화자 패널
  - `<details className="border-b">` + `<summary>화자 관리</summary>` 패턴
  - 내부: `<SpeakerPanel meetingId={meetingId} isRecording={isActive} />`
  - 모바일 전용, 데스크톱에서는 기존 Panel 내부에 그대로 배치

## 데이터 흐름
`useMediaQuery(BREAKPOINTS.lg)` --> boolean `isDesktop` --> 조건부 렌더링 --> 데스크톱: 기존 PanelGroup / 모바일: MobileTabLayout(tabs prop) --> 각 탭 content에 기존 컴포넌트 전달 (props 변경 없음) --> ActionCable WebSocket 연결은 분기와 무관하게 동일 동작

## 선행 조건
- TSK-00-02: `useMediaQuery` 훅 및 `BREAKPOINTS` 상수 (필수, 미완료)
- TSK-02-01: `MobileTabLayout` 공용 컴포넌트 (완료)
- 기존 컴포넌트: `RecordTabPanel`, `AiSummaryPanel`, `MeetingEditor`, `SpeakerPanel`, `ParticipantList` (모두 존재)
- ActionCable WebSocket은 모바일 브라우저에서도 지원되므로 별도 대응 불요
