# 트랜스크립트 화자 이름 인라인 더블클릭 편집

**날짜**: 2026-06-26
**상태**: 설계 승인됨

## 목표

화자 목록(SpeakerPanel)이 아니라 **트랜스크립트 본문의 화자 이름 칩을 더블클릭**하면 그 자리에서 인라인으로 이름을 바꿀 수 있게 한다. TranscriptPanel(메인 전사 뷰)과 FullRecord(전체 기록 뷰) 둘 다 적용.

## 핵심 설계

편집 로직을 두 패널이 공유하는 `SpeakerLabel` 컴포넌트 한 곳에 넣는다. 새 입력 UI를 만들지 않고 기존 SpeakerPanel의 인라인 편집 패턴을 그대로 따른다. 백엔드·API·라우트 변경 없음 — 기존 `renameSpeaker` PUT + `setSpeakerName` store 경로를 재사용한다.

## 컴포넌트

### 1. `SpeakerLabel` 확장 (`frontend/src/components/meeting/SpeakerLabel.tsx`)

새 옵셔널 prop 2개:

- `editable?: boolean` — 기본 `false`. `false`면 현행 그대로 `<span>` 렌더.
- `onRename?: (name: string) => void | Promise<void>` — 저장 시 trim된 이름으로 호출.

동작:

- `editable && onRename`일 때만 더블클릭(`onDoubleClick`) → 인라인 `<input>` 진입.
- 입력: `autoFocus`, Enter 저장, Esc 취소, blur 저장. SpeakerPanel 스타일(`border-b border-blue-400 outline-none bg-transparent`)과 동일.
- 시작값: 커스텀 이름이 있으면(`speakerName != null && speakerName !== speakerLabel`) 그 값, 없으면 빈칸. SpeakerPanel의 `name === id → ''` 의미와 일치.
- 저장 조건: `name = value.trim()`; `name && name !== (speakerName ?? speakerLabel)`일 때만 `await onRename(name)`. 그 뒤 편집 종료.
- 비-editable이면 더블클릭 무반응(현행 span 유지).
- title 툴팁: `editable`일 때 "더블클릭하여 이름 편집".

내부 상태: `editing: boolean`, `value: string` (로컬 useState).

### 2. 부모 배선

공통 핸들러(각 패널 내부에 정의):

```ts
const handleRename = async (speakerLabel: string, name: string) => {
  const updated = await renameSpeaker(meetingId, speakerLabel, name).catch(() => null)
  if (updated) setSpeakerName(speakerLabel, updated.name === speakerLabel ? null : updated.name)
}
```

- **TranscriptPanel** (`TranscriptPanel.tsx`): 화자 칩에
  `editable={!readOnly}`,
  `onRename={(n) => handleRename(group.segments[0].transcript.speaker_label, n)}` 전달.
  `setSpeakerName`은 `useTranscriptStore`에서 가져온다.
- **FullRecord** (`FullRecord.tsx`): 화자 칩에
  `editable={!readOnly}`,
  `onRename={(n) => handleRename(first.speaker_label, n)}` 전달.

## 데이터 흐름

SpeakerPanel과 동일:

1. 더블클릭 → 인라인 입력 → Enter/blur 저장
2. `renameSpeaker(meetingId, speakerLabel, name)` → `PUT /api/v1/speakers/{speakerLabel}?meeting_id=…` `{ name }`
3. 백엔드가 `Transcript.where(speaker_label:).update_all(speaker_name:)` 갱신
4. `setSpeakerName(speakerLabel, name)` → store finals 갱신
5. TranscriptPanel(`speakerNameOverrides`), FullRecord(`finals` 직접), SpeakerPanel 모두 즉시 리렌더. 연속 동일 화자 그룹 경계도 재계산됨.

## 잠금(읽기 전용)

`readOnly`면 `editable=false`로 전달 → 더블클릭 무반응. SpeakerPanel의 잠금 가드와 동작 일치.

## 에러 처리

`renameSpeaker` 실패 시 `.catch(() => null)` → store 갱신 안 함(화면 변화 없음). SpeakerPanel과 동일.

## 테스트

`SpeakerLabel` 단위 테스트(vitest):

- `editable` + 더블클릭 → 입력 노출, 시작값 검증(커스텀명 있음/없음)
- Enter → `onRename` 호출(trim된 값), 입력 종료
- Esc → `onRename` 미호출, 입력 종료
- 동일 값 입력 → `onRename` 미호출
- 비-editable → 더블클릭해도 입력 안 뜸

## 범위 밖

- 모바일 터치 더블클릭(데스크톱 한정. 모바일은 SpeakerPanel 사용).
- 백엔드/API/라우트 변경(전부 재사용).
