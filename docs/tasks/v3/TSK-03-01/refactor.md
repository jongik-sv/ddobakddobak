# TSK-03-01: 리팩토링 내역

## 변경 사항

| 파일 | 변경 내용 |
|------|-----------|
| `frontend/src/components/ui/BottomSheet.tsx` | ESC 키 이벤트 로직을 `useEscapeKey` 커스텀 훅으로 추출 |
| `frontend/src/components/ui/BottomSheet.tsx` | 배경 스크롤 방지 로직을 `useBodyScrollLock` 커스텀 훅으로 추출 |
| `frontend/src/components/ui/BottomSheet.tsx` | 인라인 SVG 닫기 아이콘을 lucide-react `X` 컴포넌트로 교체 (프로젝트 일관성) |
| `frontend/src/components/ui/BottomSheet.tsx` | className 조합을 상수 `SHEET_BASE_CLASS` + 조건부 결합으로 개선 (`undefined` 문자열 혼입 방지) |

## 테스트 확인
- 결과: PASS (38/38 테스트 통과)
