# TSK-05-04: 리팩토링 내역

## 변경 사항

| 파일 | 변경 내용 |
|------|-----------|
| `frontend/src/lib/transcriptMapper.ts` | (신규) API Transcript[] -> TranscriptFinalData[] 변환 유틸리티 추출 — MeetingViewerPage와 MeetingLivePage 간 중복 제거 |
| `frontend/src/hooks/useViewerData.ts` | (신규) 뷰어 페이지 초기 데이터 로드 로직을 커스텀 훅으로 분리 — 컴포넌트의 관심사 분리 개선 |
| `frontend/src/pages/MeetingViewerPage.tsx` | 데이터 로드 로직을 useViewerData 훅으로 위임, 불필요한 import(useState, API 함수, TranscriptFinalData 타입) 제거 |
| `frontend/src/pages/MeetingLivePage.tsx` | 전사 매핑 로직을 mapTranscriptsToFinals 유틸리티로 교체, TranscriptFinalData 직접 import 제거 |
| `frontend/src/components/meeting/ViewerHeader.tsx` | 인라인 SVG 아이콘을 lucide-react Info 컴포넌트로 교체 — 아이콘 사용 일관성 확보 |

## 테스트 확인
- 결과: PASS
- 전체 52개 테스트 파일 / 422개 테스트 통과
- 변경 관련 4개 파일 (MeetingViewerPage, ViewerHeader, JoinMeetingDialog, MeetingLivePage) 37개 테스트 모두 통과
