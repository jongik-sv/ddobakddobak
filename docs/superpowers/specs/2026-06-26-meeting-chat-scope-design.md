# 회의 화면 AI 챗 스코프 전환 설계

## 목적
회의 상세 화면 우측 패널의 **AI 챗 탭**에서, 질문 대상 스코프를 `이 회의 / 폴더 / 프로젝트 전체`로 전환할 수 있게 한다. 기존에는 회의(meeting) 스코프 고정이었다.

## 배경 / 이미 있는 것
- `AiChatPanel`은 `scopeType: 'meeting' | 'folder' | 'project'`를 이미 지원한다. (`frontend/src/components/meeting/AiChatPanel.tsx`)
- 백엔드 챗 엔드포인트(`meetings/:id/chat_messages`, `folders/:id/chat_messages`, `projects/:id/chat_messages`)는 폴더챗 기능에서 이미 main에 출시됨. (`frontend/src/api/chat.ts`)
- `FolderChatDrawer`가 폴더/프로젝트 스코프 탭 전환 + 크로스회의 인용 네비(`onSeekMeeting`)를 이미 구현. 이 패턴을 회의 화면에 이식한다.
- `Meeting` 타입에 `folder_id: number | null`, `project_id?: number | null` 존재. (`frontend/src/api/meetings/types.ts`)

→ **프론트엔드 2파일만 수정**. 백엔드·API·스토어 변경 없음.

## UI
채택안: **챗 탭 안 세그먼티드 컨트롤** (최상위 탭 구조는 그대로).

```
┌ AI 챗 │ 오타수정 │ 메모 ┐
├─────────────────────────┤
│ [이 회의] 폴더  프로젝트 │  ← 스코프 세그먼트 (chat 탭일 때만)
│ ─────────────────────── │
│  💬 대화 내용...         │
│ [____입력____] [전송]    │
└─────────────────────────┘
```

- 세그먼트 버튼: `이 회의 / 폴더 / 프로젝트 전체`.
- 회의의 `folder_id`가 없으면 `폴더` 버튼 비활성, `project_id`가 없으면 `프로젝트 전체` 버튼 비활성.
- 기본 스코프 = `이 회의`.
- 세그먼트는 `chat` 탭이 활성일 때만 렌더(오타수정/메모 탭에는 안 보임).
- 버튼 스타일은 **FolderChatDrawer의 `tabBtn`을 그대로 재사용**(사용자 요청). 활성=`bg-blue-600 text-white`, 비활성=`text-muted-foreground`, disabled=`opacity-40 cursor-not-allowed`. 동일한 `px-2 py-1 text-xs rounded` 컨테이너. 새 스타일 도입 금지.

## 동작
1. **스코프 전환 시 AiChatPanel을 `key={`${scope}:${scopeId}`}`로 remount** → 메시지/구독 완전 리셋. (FolderChatDrawer와 동일 방식.)
2. `scopeId`:
   - `meeting` → `meetingId`
   - `folder` → `folderId`
   - `project` → `projectId`
3. **인용 클릭 핸들러**:
   - `meeting` 스코프: `onSeek`(현재 페이지 내 seek) 전달.
   - `folder`/`project` 스코프: `onSeekMeeting(meetingId, ms)` 전달.
     - 대상이 현재 회의면 in-place seek(`handleSeek(ms)`), 다른 회의면 `/meetings/:id?t=ms`로 네비.
4. `emptyHint`: 스코프별 안내 문구.
   - meeting: 기본("이 회의 내용에 대해 무엇이든 물어보세요.")
   - folder: "이 폴더의 회의들에 대해 물어보세요."
   - project: "이 프로젝트의 회의들에 대해 물어보세요."

## 변경 파일
### `frontend/src/components/meeting/RightTabsPanel.tsx`
- props 추가: `folderId?: number | null`, `projectId?: number | null`, `onSeekMeeting?: (meetingId: number, ms: number) => void`.
- 내부 state `chatScope: 'meeting' | 'folder' | 'project'` (기본 `'meeting'`).
- `chat` 탭 콘텐츠 상단에 스코프 세그먼트 렌더 + 비활성 가드.
- 선택 스코프의 id가 null이면 `meeting`으로 폴백(안전망).
- AiChatPanel을 스코프에 맞춰 `key`/`scopeType`/`scopeId`/`onSeek`/`onSeekMeeting`/`emptyHint`로 렌더.

### `frontend/src/pages/MeetingPage.tsx`
- `RightTabsPanel`에 `folderId={meeting?.folder_id ?? null}`, `projectId={meeting?.project_id ?? null}`, `onSeekMeeting={handleSeekMeeting}` 전달.
- `handleSeekMeeting(mid, ms)`: `mid === meetingId ? handleSeek(ms) : navigate(`/meetings/${mid}?t=${ms}`)`.

## 비목표(YAGNI)
- 모바일 탭 레이아웃의 챗 스코프 전환은 이번 범위 밖(데스크톱 우측 패널 우선). 후속 가능.
- 새 백엔드/스토어/임베딩 변경 없음.

## 검증
- `tsc -p tsconfig.app.json` 신규 에러 0(기준선 ~24 사전존재 테스트 에러만).
- 수동: 회의 화면 → AI 챗 탭 → [폴더]/[프로젝트] 전환 시 메시지 리셋·해당 스코프 답변, 크로스회의 인용 클릭 시 해당 회의로 이동+seek.
