# TSK-02-01: 리팩토링 내역

## 변경 사항

| 파일 | 변경 내용 |
|------|-----------|
| frontend/src/components/layout/MobileTabLayout.tsx | handleTabClick 내 onTabChange 중복 호출 제거 (분기 외부로 추출) |
| frontend/src/components/layout/MobileTabLayout.tsx | 탭 버튼 className 조건부 클래스를 activeClass/inactiveClass 변수로 추출하여 가독성 향상 |
| frontend/src/components/layout/MobileTabLayout.tsx | WAI-ARIA tab pattern 준수를 위해 tab 버튼에 id, tabpanel에 aria-labelledby 추가 |

## 테스트 확인
- 결과: PASS
- 17개 테스트 모두 통과
