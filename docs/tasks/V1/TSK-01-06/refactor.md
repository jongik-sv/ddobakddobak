# TSK-01-06: 앱 레이아웃 및 네비게이션 - 리팩토링

## 변경 사항

### Sidebar.tsx - NavLink 중복 제거

**문제:** NavLink마다 동일한 className 인라인 함수(`{ isActive }` 조건부 분기)가 중복 정의됨.

**해결:** `navLinkClass` 헬퍼 함수와 `NAV_ITEMS` 상수 배열로 추출하여 단일 책임 원칙 적용.

```
// before: NavLink마다 중복 className 함수
// after: navLinkClass 함수 + NAV_ITEMS 배열로 분리
NAV_ITEMS.map(({ to, icon: Icon, label }) => (
  <NavLink key={to} to={to} className={navLinkClass}>
    <Icon className="w-4 h-4" />
    {label}
  </NavLink>
))
```

**효과:** 새 네비게이션 항목 추가 시 `NAV_ITEMS` 배열에 객체 하나만 추가하면 됨. 스타일 일관성 보장.

## 변경 없는 파일

- `AppLayout.tsx`: 단순 구조, 추가 개선 불필요
- `Header.tsx`: useAuthStore selector 분리 패턴 유지, 간결함
- `App.tsx`: 최소 수정 원칙 유지 (AppLayout wrapping만 추가)

## 테스트 결과

리팩토링 후 재실행: 11 files, 50 tests - 모두 PASS
