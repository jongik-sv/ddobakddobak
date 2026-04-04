# TSK-03-03: DashboardPage 반응형 패딩 - 설계

## 구현 방향
- DashboardPage.tsx의 Tailwind 클래스만 변경하여 모바일 반응형 지원
- 패딩, 제목 폰트, 카드 간격을 breakpoint별로 조정
- 차트 영역(통계 카드 그리드)에 `overflow-x-auto` 추가
- 로직 변경 없이 CSS 클래스만 수정

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| frontend/src/pages/DashboardPage.tsx | 대시보드 페이지 반응형 클래스 적용 | 수정 |

## 주요 구조
- `DashboardPage` 컴포넌트: 변경 대상 클래스 4곳
  1. 루트 `<div>`: `p-8` → `p-4 md:p-6 lg:p-8`
  2. `<h1>` 제목: `text-2xl` → `text-xl md:text-2xl`
  3. 통계 카드 그리드: `gap-4` → `gap-3 md:gap-6`, `overflow-x-auto` 래퍼 추가
  4. 차트/카드 영역: 가로 스크롤 허용

## 데이터 흐름
Tailwind 반응형 클래스 → 브라우저 viewport 기반 자동 적용 → 모바일/태블릿/데스크톱 패딩 차등 렌더링

## 선행 조건
- 없음 (통계 카드 그리드는 이미 `sm:grid-cols-2 lg:grid-cols-4` 적용됨)
