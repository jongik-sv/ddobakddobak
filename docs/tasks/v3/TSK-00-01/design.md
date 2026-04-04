# TSK-00-01: viewport meta 및 CSS 유틸리티 추가 - 설계

## 구현 방향
- `index.html`의 viewport meta에 `viewport-fit=cover`를 추가하여 노치 디바이스에서 Safe Area 대응 가능하게 한다
- `index.css`에 Tailwind v4 `@utility` 디렉티브를 사용하여 `h-dvh`, `pb-safe`, `pt-safe` 유틸리티를 정의한다
- `animate-slide-in-left` 키프레임 애니메이션을 추가하여 모바일 사이드바 오버레이에서 사용할 수 있게 한다
- `overscroll-behavior: none`을 html/body에 전역 적용하여 풀 투 리프레시를 방지한다
- `@media (hover: hover)` 기반 호버 분기 유틸리티를 추가한다

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| `frontend/index.html` | viewport meta에 `viewport-fit=cover` 추가 | 수정 |
| `frontend/src/index.css` | Tailwind v4 커스텀 유틸리티 및 전역 스타일 추가 | 수정 |

## 주요 구조

1. **viewport meta 변경** (`index.html` line 6)
   - 현재: `content="width=device-width, initial-scale=1.0"`
   - 변경: `content="width=device-width, initial-scale=1.0, viewport-fit=cover"`

2. **Tailwind v4 `@utility` 커스텀 유틸리티** (`index.css` 하단 추가)
   - `@utility h-dvh` : `height: 100dvh` -- iOS Safari 동적 뷰포트 높이 대응
   - `@utility pb-safe` : `padding-bottom: env(safe-area-inset-bottom)` -- 노치 디바이스 하단 Safe Area
   - `@utility pt-safe` : `padding-top: env(safe-area-inset-top)` -- 노치 디바이스 상단 Safe Area

3. **`animate-slide-in-left` 키프레임 + 유틸리티** (`index.css` 하단 추가)
   - `@keyframes slide-in-left` : `translateX(-100%)` -> `translateX(0)`, 200ms ease-out
   - `@utility animate-slide-in-left` : 위 키프레임을 적용하는 유틸리티 클래스

4. **전역 스타일 추가** (`index.css` `@layer base` 내부)
   - `html, body { overscroll-behavior: none; }` -- 스크롤 바운스/풀 투 리프레시 방지

5. **호버 분기 유틸리티** (`index.css` 하단 추가)
   - `@media (hover: hover)` 블록 내에서 호버 전용 유틸리티 정의
   - `hover-only:opacity-100` 등 터치 디바이스에서 호버 효과 비활성화용

## 데이터 흐름
CSS/HTML 인프라 변경이므로 데이터 흐름 없음. 브라우저가 viewport meta와 CSS를 읽어 렌더링 동작에 반영한다.

## 선행 조건
- 없음 (v3 반응형 작업의 최초 기반 Task)
