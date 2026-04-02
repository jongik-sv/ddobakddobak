# TSK-05-03: AI 요약 패널 UI - 설계

## 구현 방향

`transcriptStore`에 이미 `summary` 상태와 `setSummary` 액션이 있고, `transcription.ts` 채널에서 `summary_update` 이벤트를 수신하여 스토어에 저장하는 흐름이 구현되어 있다. 그러나 현재 `summary`는 단일 문자열(`string | null`)로 저장되어 있고, TSK-05-03에서 요구하는 구조화된 데이터 (`key_points`, `decisions`, Action Items) 를 표현하지 못한다.

따라서 다음 두 가지를 변경한다:
1. `transcriptStore`의 `summary` 상태 타입을 구조화된 객체로 확장
2. `AiSummaryPanel.tsx` 컴포넌트를 신규 생성하여 핵심 요약·결정사항·Action Items 섹션을 탭 또는 섹션으로 구분 표시

`MeetingLivePage`의 AI 요약 섹션 내용을 `AiSummaryPanel` 컴포넌트로 교체한다.

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| `frontend/src/components/meeting/AiSummaryPanel.tsx` | AI 요약 패널 컴포넌트 (핵심 요약/결정사항 섹션) | 신규 |
| `frontend/src/components/meeting/AiSummaryPanel.test.tsx` | AiSummaryPanel 단위 테스트 | 신규 |
| `frontend/src/channels/transcription.ts` | `SummaryUpdateData` 타입을 구조화된 형태로 확장 | 수정 |
| `frontend/src/stores/transcriptStore.ts` | `summary` 상태 타입 변경 (`SummaryData` 객체) | 수정 |
| `frontend/src/pages/MeetingLivePage.tsx` | AI 요약 섹션을 `<AiSummaryPanel />` 으로 교체 | 수정 |

## 주요 구조

### `SummaryUpdateData` 타입 (transcription.ts 수정)

```ts
// 현재
export type SummaryUpdateData = {
  summary: string
  updated_at: string
}

// 변경 후: api-spec 기반 구조화
export type SummaryUpdateData = {
  type: 'summary_update'
  key_points: string[]   // 핵심 요약 불릿 목록
  decisions: string[]    // 결정사항 목록
  updated_at: string
  is_final?: boolean     // 최종 요약 여부 (회의 종료 시 true)
}
```

### `transcriptStore` 상태 타입 (수정)

```ts
// summary 타입 변경
interface TranscriptState {
  // 기존 필드 유지 ...
  summary: SummaryUpdateData | null  // string → SummaryUpdateData
  setSummary: (data: SummaryUpdateData) => void
}
```

### `AiSummaryPanel` 컴포넌트

```tsx
// Props: 없음 (Zustand 스토어 직접 구독)
export function AiSummaryPanel()

// 내부 구조
// - useTranscriptStore 로 summary 구독
// - summary === null → 빈 상태 플레이스홀더 표시
// - summary.is_final === true → "최종 요약" 배지 표시
// - 섹션 구성: 핵심 요약 / 결정사항 (각 섹션은 헤딩 + 불릿 리스트)
```

### 빈 상태 처리

- `summary === null`: "회의가 시작되면 AI가 요약을 생성합니다." 안내 문구 (gray)
- `summary.key_points.length === 0 && summary.decisions.length === 0`: "아직 요약할 내용이 없습니다." 표시

### `MeetingLivePage` 수정

AI 요약 섹션의 인라인 div를 `<AiSummaryPanel />` 컴포넌트 호출로 교체한다.

## 데이터 흐름

```
Rails SummarizationJob
  → ActionCable broadcast: { type: "summary_update", key_points: [...], decisions: [...], updated_at: "..." }
  → transcription.ts received() → store.setSummary(data)
  → transcriptStore.summary 업데이트
  → AiSummaryPanel (useTranscriptStore 구독) 리렌더링
  → 핵심 요약/결정사항 섹션 업데이트
```

최종 요약: Rails가 `is_final: true`를 포함하여 브로드캐스트 → AiSummaryPanel에 "최종 요약" 배지 표시

## 선행 조건

- TSK-05-02: Rails SummarizationJob 구현 완료 (실제 `summary_update` 이벤트 발송)
- TSK-03-02: 라이브 기록 WebSocket 연결 (`useTranscription` 훅, TranscriptionChannel) 완료
- 현재 `transcription.ts` 채널에서 이미 `summary_update` 이벤트 핸들링 분기가 구현되어 있으므로, 타입 변경만으로 연동 가능

## 테스트 전략

### 단위 테스트 (`AiSummaryPanel.test.tsx`)

| 케이스 | 검증 |
|--------|------|
| summary === null | 안내 문구("회의가 시작되면") 렌더링 확인 |
| key_points 있음 | 핵심 요약 섹션에 항목 표시 확인 |
| decisions 있음 | 결정사항 섹션에 항목 표시 확인 |
| is_final === true | "최종 요약" 배지 렌더링 확인 |
| 빈 배열 | 빈 상태 메시지 표시 확인 |

테스트 방식: `transcriptStore`를 직접 조작하거나 Zustand 모킹을 통해 상태 주입, RTL (`@testing-library/react`) 사용
