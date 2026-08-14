# 회의 페이지 파일 드래그앤드롭 + 이해관계자 카테고리 설계

날짜: 2026-08-14 / 브랜치: feature/meeting-drop-triage (base: main 4aa606bc)

## 개요

회의 상세 페이지(MeetingPage) 전체를 드롭존으로. 드롭된 파일을 오디오/기타로 분류(triage):

- **오디오**: 기존 오디오 있는 완료 회의 → "뒤에 연결 / 새 회의 생성" 선택. 연결 시 프론트 병합(WebAudio) 후 `POST /meetings/:id/audio`(서버 ffmpeg concat) → 재전사 확인. 새 회의 시 `UploadAudioModal`을 `initialFiles`로 오픈. 오디오 없는 회의는 선택 없이 현재 회의에 업로드.
- **기타**: 분류 다이얼로그 — 파일 리스트 + 카테고리 콤보(안건/참고자료/이해관계자/명함) 휴리스틱 사전선택 → 일괄 업로드.
- **동시 드롭**: 오디오 순서 선택 → 병합 시작(백그라운드 배너) → 즉시 첨부 분류 다이얼로그 오픈 (병렬).
- **신규 카테고리 `stakeholder`(이해관계자)**: 풀스택 추가. agenda 파이프라인 미러링 — 추출 잡 → LLM 압축 → 요약 프롬프트 주입.

상태 규칙: `recording`/`transcribing` 회의엔 오디오 드롭 거부(토스트). 첨부는 허용.

## 재사용 (수정 금지 — 소비만)

- `frontend/src/lib/audioMerge.ts`: `sortAudioFilesByName(files)`, `mergeAudioFiles(files, { onProgress?, gapSeconds? })` → 16kHz mono WAV File. gap 기본 3초.
- `frontend/src/components/meeting/AudioFileOrderList.tsx`: `{ files, onReorder, onRemove, disabled? }`. 내부 재정렬 드래그가 dataTransfer 사용 → 페이지 드롭 핸들러는 `e.dataTransfer.files.length > 0`일 때만 반응.
- `frontend/src/components/meeting/UploadAudioModal.tsx`: `initialFiles?: File[]` prop (≥2면 순서선택 상태로 오픈).
- `promoteAudio(meetingId, blob)` (`frontend/src/api/meetings/audio.ts`) — 기존 회의 오디오 append.
- `createFileAttachment` (`frontend/src/api/attachments.ts`).

## 컴포넌트 계약 (병렬 구현용 — 정확히 준수)

### `frontend/src/lib/fileTriage.ts` (신규)

```ts
export function isAudioFile(file: File): boolean
// MIME audio/* 또는 확장자 .mp3 .wav .m4a .webm .ogg .aac .flac .opus .wma .amr

export function splitDroppedFiles(files: File[]): { audio: File[]; others: File[] }

export function suggestAttachmentCategory(file: File): AttachmentCategory
// 우선순위: 파일명 /안건|agenda/i → 'agenda'
//          파일명 /이해관계자|stakeholder|참석자|조직도?/i → 'stakeholder'
//          이미지 MIME(image/*) 또는 이미지 확장자 → 'business_card'
//          나머지 → 'reference'
```

### `frontend/src/components/meeting/AttachmentTriageDialog.tsx` (신규)

```ts
interface AttachmentTriageDialogProps {
  open: boolean
  meetingId: number   // 기존 코드에서 meeting id 타입이 string이면 string으로 통일
  files: File[]
  onClose: () => void
  onUploaded?: () => void  // 전체 업로드 완료 시 (첨부 목록 갱신용)
}
```

행: 파일명·크기 + 카테고리 `<select>`(기본값 `suggestAttachmentCategory`) + 제거 버튼. "업로드" 버튼 → `createFileAttachment` 순차 또는 소규모 병렬, 파일별 진행/성공/실패 표시. 실패 파일만 재시도 가능하면 좋음(필수 아님).

### `frontend/src/components/meeting/AudioAppendFlowDialog.tsx` (신규)

```ts
interface AudioAppendFlowDialogProps {
  open: boolean
  meetingId: number  // 위와 동일 타입 규칙
  files: File[]
  onClose: () => void
  onMergeStarted?: () => void   // 병합 시작 직후 호출 — MeetingPage가 첨부 다이얼로그를 열 트리거
  onCompleted?: () => void      // 업로드(+재전사 트리거) 완료
}
```

단계: ① 순서 선택(`AudioFileOrderList`, 파일 1개면 생략, 초기값 `sortAudioFilesByName`) → ② "병합 시작" → `mergeAudioFiles`(gap 기본 3초, onProgress) — 이때 `onMergeStarted` 호출하고 다이얼로그는 우하단 고정 배너 모드로 축소(컴포넌트 내부에서 모달↔배너 전환) → ③ `promoteAudio` 업로드 → ④ "재전사 실행?" 확인 UI(배너 내) → 예: 기존 재전사 엔드포인트 호출(프론트 api 함수 없으면 `api/meetings`에 추가), 아니오: 종료. 실패 시 배너에 에러+재시도.

### `frontend/src/components/meeting/MeetingFileDropOverlay.tsx` (신규)

```ts
interface MeetingFileDropOverlayProps {
  disabled?: boolean
  onFilesDropped: (files: File[]) => void  // 원본 그대로 전달, triage는 호출측
}
```

페이지 컨테이너에 dragenter/dragover/dragleave/drop. `types`에 'Files' 포함 시에만 오버레이 표시, drop은 `files.length > 0`일 때만. 오버레이: 반투명 + "파일을 놓아 추가" 안내.

### MeetingPage 배선 (수정)

- `MeetingFileDropOverlay` 장착 → `splitDroppedFiles`로 분기.
- audio.length > 0:
  - status가 recording/transcribing → 오디오 거부 토스트 (others는 계속 진행)
  - 회의에 기존 오디오 있음(`audio_available` 등 기존 필드 확인) → 선택 다이얼로그(작은 confirm: "기존 녹음 뒤에 연결" / "새 회의로 생성" / 취소)
    - 연결 → `AudioAppendFlowDialog` open
    - 새 회의 → `UploadAudioModal`을 `initialFiles={audio}`로 open (기존 모달 컴포넌트 재사용)
  - 기존 오디오 없음 → 바로 `AudioAppendFlowDialog` open
- others.length > 0: 오디오 플로우가 없으면 즉시, 있으면 `onMergeStarted` 시점(또는 오디오 플로우 취소/새회의 모달 오픈 시점)에 `AttachmentTriageDialog` open. 첨부는 항상 현재 회의에 등록.

## 백엔드: stakeholder 카테고리 (agenda 미러)

1. `meeting_attachment.rb` `CATEGORIES`에 `stakeholder` 추가
2. 마이그레이션: `meetings.stakeholder_reference` (text), `meetings.stakeholder_reference_applied_at` (datetime)
3. `meeting_attachments_controller.rb` create/destroy: agenda 분기(85-89, 129-130 부근) 미러 — 텍스트(.md/.txt)면 `StakeholderReferenceJob`, 비텍스트면 `StakeholderExtractionJob`. 삭제 시 재계산 트리거도 agenda와 동일하게.
4. `StakeholderExtractionJob`: `AgendaExtractionJob` 패턴 (추출 서비스 재사용/파라미터화, `<file>.extracted/` 저장) → 완료 후 `StakeholderReferenceJob` 체인
5. `StakeholderReferenceJob`: `AgendaReferenceJob` 패턴 — stakeholder 첨부 전체 수집 → LLM 압축 → `meeting.stakeholder_reference` 저장 (최대 길이 agenda와 동일) → WebSocket 브로드캐스트 미러
6. LLM 압축 프롬프트: 이해관계자 특화 — 이름·소속·부서·직책·역할·관심사 위주 구조화 요약
7. `llm_service.rb` `build_prompt`/`build_context_parts`: `stakeholder_reference:` 파라미터 + 블록:
   `이해관계자 정보(참고용 — 회의 내용 우선): 화자 표기, 담당자 지정, 직책 표기의 정확도를 높이는 데 활용:`
8. `meeting_summarization_job.rb`: realtime 경로 1회 주입(`stakeholder_reference_applied_at` 플래그, agenda 67-70·278-279 미러), final 경로 매회 주입 (382·392·403 미러). `call_refine_notes`/`call_append_notes` 시그니처 확장.
9. meeting 직렬화에 agenda_reference가 포함돼 있으면 stakeholder_reference도 동일하게.

## 프론트: stakeholder 노출

- `api/attachments.ts`: `AttachmentCategory`에 `'stakeholder'` 추가
- `AttachmentSection.tsx`: CATEGORIES에 `{ value: 'stakeholder', label: '이해관계자' }` (참고자료와 명함 사이 권장), countByCategory 초기화
- `AddFileDialog.tsx`: 카테고리 지원 확인·추가

## 테스트

- vitest: fileTriage(분류·휴리스틱), AttachmentTriageDialog(사전선택·변경·업로드 호출), AudioAppendFlowDialog(단계 전이·1개 파일 생략·재전사 확인), MeetingFileDropOverlay(Files 타입 가드), AttachmentSection 탭
- rspec: 카테고리 validation, 컨트롤러 분기(잡 enqueue), StakeholderReferenceJob 수집·저장, llm_service 블록 조립, summarization job 1회 주입 플래그
- 게이트: `tsc -p tsconfig.app.json` 전체 0, vitest green, rspec green

## 금지

- `UploadAudioModal.tsx`, `audioMerge.ts(+test)`, `AudioFileOrderList.tsx(+test)` 수정 금지
- 커밋 금지 (오케스트레이터가 최종 일괄)
- 러닝 dev 서버 실요청·실 settings.yaml 변경 금지
