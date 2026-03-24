# TSK-04-01: BlockNote 에디터 통합 - 설계

## 구현 방향
BlockNote 라이브러리를 React에 통합하여 Notion 스타일 블록 기반 에디터를 구현한다.
`MeetingEditor.tsx`가 BlockNote 인스턴스를 래핑하며, 텍스트/제목/리스트/체크리스트/구분선/인용 등 표준 블록 타입을 기본 제공한다.
`/` 슬래시 명령어와 드래그 앤 드롭은 BlockNote 내장 기능을 활용하므로 별도 구현 없이 활성화된다.
커스텀 블록(화자 라벨 포함 트랜스크립트 블록)은 `blocks/` 디렉토리에 정의한다.
이 Task는 에디터 자체 렌더링과 편집 기능에 집중하며, API 연동(TSK-04-03)과 STT 자동 삽입(TSK-04-04)은 이후 Task에서 처리한다.

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| `frontend/src/components/editor/MeetingEditor.tsx` | BlockNote 인스턴스 생성 및 렌더링 래퍼 컴포넌트 | 신규 |
| `frontend/src/components/editor/MeetingEditor.test.tsx` | MeetingEditor 컴포넌트 단위 테스트 | 신규 |
| `frontend/src/components/editor/blocks/TranscriptBlock.tsx` | 화자 라벨 포함 커스텀 트랜스크립트 블록 | 신규 |
| `frontend/src/components/editor/blocks/index.ts` | 커스텀 블록 스펙 모음 및 re-export | 신규 |
| `frontend/package.json` | `@blocknote/react`, `@blocknote/core`, `@blocknote/mantine` 의존성 추가 | 수정 |

## 주요 구조

- `MeetingEditor` – `useCreateBlockNote(schema)`로 에디터 인스턴스를 생성하고 `BlockNoteView`를 렌더링. `initialContent`, `onChange`, `editable` props를 외부에 노출하여 재사용 가능하게 설계
- `customSchema` – `BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, transcript: TranscriptBlock } })`로 표준 블록에 트랜스크립트 블록을 추가한 스키마
- `TranscriptBlock` – `createReactBlockSpec`으로 정의된 커스텀 블록. `speakerLabel`(화자 이름), `content`(발화 텍스트) 속성을 가지며, 화자 이름을 컬러 뱃지로 표시
- `blocks/index.ts` – 커스텀 블록 스펙을 한 곳에서 내보내어 에디터 인스턴스 생성 시 주입

## 데이터 흐름

외부(페이지 컴포넌트)에서 `initialContent: Block[]`을 받아 에디터를 초기화 → 사용자가 편집하면 BlockNote 내부 상태가 갱신 → `onChange(blocks: Block[])` 콜백으로 현재 블록 배열을 부모에 전달

## 선행 조건

- TSK-00-02 완료 (React + Vite + Tailwind 환경, package.json 관리 가능)
- `@blocknote/react`, `@blocknote/core`, `@blocknote/mantine` npm 패키지 설치 필요
- BlockNote는 Mantine UI 기반이므로 `MantineProvider` 설정 필요 (MeetingEditor 내부에서 자체 감싸거나 App.tsx에서 추가)

## 테스트 전략 (Vitest)

- `MeetingEditor.test.tsx`: `@testing-library/react`로 컴포넌트 렌더링 확인 (BlockNote는 브라우저 DOM API에 의존하므로 jsdom 환경에서 기본 렌더 스모크 테스트)
- BlockNote 인스턴스 자체는 내부 라이브러리이므로 단위 테스트 대상에서 제외. 통합 시각 검증은 Storybook 또는 수동 확인으로 진행
- `TranscriptBlock` 렌더링: 주어진 props가 UI에 정상 표시되는지 단위 테스트
