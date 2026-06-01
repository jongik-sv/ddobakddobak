# G1 — 오프라인 라이브 UI 패리티 설계

- 날짜: 2026-06-01
- 상태: 설계 승인 (사용자 합의 완료 — 인라인편집 비활성·재개 허용 권장안 채택)
- 상위 전략: `docs/superpowers/specs/2026-06-01-stt-online-offline-strategy.md` §5(UI 전략)·§6 갭 G1
- 정렬: `2026-06-01-ondevice-stt-local-mode-design.md`(로컬모드), 자동결정 A26~ 기록 예정

## 1. 목표

`LocalMeetingLivePage`(완전 오프라인 회의 라이브 화면)를 **전면 재작성**한다. 현재는 커스텀 최소 UI(자체 헤더 + amber 안내 배너 + 평문 전사 리스트)다. 이를 **서버 모바일 셸 3종**으로 통일한다:

- `MobileRecordControls` (헤더/녹음 컨트롤)
- `MobileTabLayout` (탭 — 단일 "기록" 탭)
- `LiveStatusBar` (하단 상태바)

이로써 전략 §0 직교분리(STT 위치 무관 동일 회의 UI)를 오프라인 경로에서도 실증한다. 전사 본문은 서버 경로와 **같은 `LiveRecord` 컴포넌트**로 렌더되어 모양이 동일하다.

## 2. 구조 (3-zone)

### ① 헤더 = `MobileRecordControls` (순수 props, 무변경)

| prop | 값 |
|---|---|
| `title` | `rec.meta?.title ?? '오프라인 회의'` |
| `isRecording` | `rec.isRecording` |
| `elapsedSeconds` | `rec.elapsedSeconds` |
| `isPaused` | `false` (오프라인 일시정지 비목표) |
| `onBack` | `() => navigate('/meetings')` |
| `onStart` | `rec.start` (항상 연결) |
| `onPause` / `onResume` | no-op |
| `onStop` | stop 래퍼 |
| `isStopping` | 로컬 state (stop 호출~완료 사이 true) |
| `children` | 미전달 (더보기 비움 — G3 업로드/삭제 연동 여지) |

- **`onStart` 항상 연결**: `!modelDir`이어도 버튼은 활성. 탭하면 `rec.start`가 `if(!modelDir) setError('온디바이스 모델이 준비되지 않았습니다.')` → 상태 surface(③)에 피드백. `onStart=undefined`로 silent no-op 만드는 것보다 명확.
- **재개 허용**: stop 후 `status='stopped'` → `isRecording=false` → 헤더에 "회의 시작" 재노출. 같은 `localId`에 이어 녹음(타이머 0부터). 종료는 `onBack`으로 이탈. `MobileRecordControls` 기본 동작 그대로, 분기 없음.

### ② 본문 = `MobileTabLayout` 단일 탭 "기록"(FileText 아이콘)

탭 content는 모델 유무로 분기:

```
content = modelDir
  ? <LiveRecord meetingId={-1} editable={false} />   // 전사 본문
  : <ModelManager onChanged={() => bump(reloadKey)} /> // 모델 미설치 게이트
```

- `onApply` 미전달 → `LiveRecord`의 "회의록에 적용" 버튼 자동 숨김.
- `editable={false}` (신규 prop) → 인라인 편집 차단(§4).
- 모델 미설치 시 ModelManager가 탭 본문을 **대체**(reloadKey 게이트는 기존 유지 — 다운로드 완료 시 bump → resolve 재실행 → modelDir 채워짐 → LiveRecord로 전환).

### ③ 푸터 = `LiveStatusBar` (무변경)

| prop | 값 |
|---|---|
| `isActive` | `rec.isRecording` |
| `sttEngine` | `'온디바이스'` |
| `meetingApiStatus` | `null` |
| `isSystemCapturing` | `false` |
| `statusMessage` | **단일 상태/에러 surface** |

`statusMessage` = 제거된 커스텀 배너/에러 영역의 새 거처. 우선순위:

```
statusMessage = resolveErr ?? rec.error ?? (resolving ? '준비 중...' : null)
```

- `resolveErr`: `resolve_model_paths`/언어설정 해석 실패(하드).
- `rec.error`: start 실패 / 모델 미준비.
- `resolving`: 초기 해석 중.

세 가지 모두 짧은 전이 메시지라 `LiveStatusBar.statusMessage`(파란 텍스트) 단일 surface로 충분. 서버 셸과 동일한 상태 표기 패턴.

## 3. 컴포넌트 변경 (2 파일)

### 3.1 `LiveRecord.tsx` — `editable` prop 추가

```ts
interface LiveRecordProps {
  meetingId: number
  currentTimeMs?: number
  onSeek?: (ms: number) => void
  onApply?: () => Promise<void>
  editable?: boolean   // 신규, 기본 true
}
```

내부 `<EditableTranscriptText ... editable={editable}/>`로 전달(현재 하드코딩 `editable`).

- **서버 경로 무영향**: `RecordTabPanel`(서버)은 `editable` 미전달 → 기본 `true` → 기존 동작 동일.
- 오프라인만 `editable={false}` 전달.

### 3.2 `LocalMeetingLivePage.tsx` — 3-zone 재작성

- modelDir/language/resolve `useEffect` + `reloadKey` 게이트 = **유지**.
- `useLocalRecording(localId, language, modelDir)` 호출 = 유지.
- 신규: `isStopping` 로컬 state + `handleStop` 래퍼(`setIsStopping(true)` → `await rec.stop()` → `setIsStopping(false)`).
- 신규: `statusMessage` 파생(위 우선순위).
- 제거: 커스텀 헤더, amber 안내 배너, 평문 전사 리스트, `fmtElapsed`(MobileRecordControls가 자체 포맷), `Mic`/`Square`/`ArrowLeft`/`WifiOff` import.

### 3.3 무변경
`useLocalRecording`, `ModelManager`, `MobileRecordControls`, `MobileTabLayout`, `LiveStatusBar`, `EditableTranscriptText`, `transcriptStore`.

## 4. 센티넬 meetingId

`meetingId={-1}`. `editable={false}`이면 `EditableTranscriptText`:
- `handleDoubleClick`: `if (!editable || isEditing) return` → 조기반환.
- `handleKeyDown`: Enter 편집진입 분기 `if (editable && e.key==='Enter')` → 미진입.
- `tabIndex={editable ? 0 : -1}` → -1(포커스 불가).

→ `isEditing` 영원히 false → `save()` 미호출 → `updateTranscript(-1, …)` **도달 불가**. 센티넬은 서버 호출에 닿지 않는다.

## 5. 경계 / 비목표 (의도)

- **Android 전용**(전략 §2 오프라인=모바일). `MobileRecordControls`/`MobileTabLayout` 탭바는 `lg:hidden`/모바일 스타일. 서버 `MeetingLivePage`와 달리 `DesktopRecordControls` 대응물을 **렌더하지 않음** → 와이드 뷰포트엔 헤더 컨트롤 없음. 이는 **의도**(오프라인은 폰 전용).
- 일시정지/재개 = no-op(`useLocalRecording`에 pause 없음).
- 오프라인 인라인 편집 영속 = 비목표(YAGNI — 편집 affordance 자체 차단).
- AI요약/메모 탭 = 서버 의존 → 미노출(기록 탭만).

## 6. 테스트 전략

- **`LiveRecord.test.tsx`**(시그니처 변경 → 회귀 필수):
  - `editable={false}` → 전사 텍스트 읽기전용(편집 affordance 없음, `tabIndex=-1`, 더블클릭해도 편집 미진입).
  - `editable` 미전달(기본 true) → 기존 편집 동작 회귀(무변경 확인).
- **빌드/회귀**: `npx vite build` GREEN(=APK beforeBuildCommand). 관련 vitest(`LiveRecord`, `MobileRecordControls`, `MobileTabLayout`) 통과 유지.
- **에뮬(후속, 선택)**: `stt_arm64_api34` release APK — 오프라인 회의 진입 → 3-zone 셸 표시 → 녹음 → `LiveRecord` 전사 렌더 → stop 후 재개 가능 확인.

## 7. 자동결정 기록

`2026-06-01-ondevice-stt-auto-decisions.md`에 A26(인라인편집 비활성=editable prop), A27(재개 허용=MobileRecordControls 기본동작), A28(단일 statusMessage surface) 추가.
