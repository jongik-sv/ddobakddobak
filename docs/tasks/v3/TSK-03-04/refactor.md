# TSK-03-04: 리팩토링 내역

## 변경 사항

| 파일 | 변경 내용 |
|------|-----------|
| `frontend/src/components/settings/SettingsModal.tsx` | 중복된 닫기 버튼 마크업을 `closeButton` 변수로 추출하여 단일 정의로 통합; 긴 className 문자열을 `CONTAINER_DESKTOP`, `CONTAINER_MOBILE`, `CLOSE_BTN` 상수로 추출하여 가독성 개선 |
| `frontend/src/hooks/useMediaQuery.ts` | 이벤트 핸들러 타입을 `MediaQueryListEvent \| { matches: boolean }`에서 `MediaQueryListEvent`로 단순화 (불필요한 유니온 타입 제거) |

## 테스트 확인
- 결과: PASS (58 파일, 489 테스트 전체 통과)
