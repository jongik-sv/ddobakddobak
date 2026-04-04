# TSK-03-01: BottomSheet 공용 UI 컴포넌트 - 설계

## 구현 방향
- React Portal 기반의 재사용 가능한 BottomSheet 컴포넌트 신규 생성
- 바텀에서 슬라이드 업 애니메이션(`animate-slide-in-bottom`)과 백드롭 오버레이 지원
- `index.css`에 `slide-in-bottom` 키프레임 및 유틸리티 클래스 추가
- 필터, 설정, 녹음 옵션 등 다양한 용도로 children을 통해 콘텐츠 주입
- 접근성: ESC 키 닫기, aria 속성, 포커스 트랩 기본 지원

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| `frontend/src/components/ui/BottomSheet.tsx` | BottomSheet 컴포넌트 (React Portal, 백드롭, 슬라이드 애니메이션) | 신규 |
| `frontend/src/index.css` | `slide-in-bottom` 키프레임 및 `animate-slide-in-bottom` 유틸리티 추가 | 수정 |

## 주요 구조

### BottomSheet 컴포넌트

- **`BottomSheetProps` 인터페이스**
  - `open: boolean` -- 시트 열림/닫힘 상태
  - `onClose: () => void` -- 닫기 콜백 (백드롭 클릭, ESC 키)
  - `title?: string` -- 선택적 헤더 타이틀
  - `children: ReactNode` -- 시트 내부 콘텐츠
  - `className?: string` -- 추가 스타일 오버라이드

- **`BottomSheet` 함수 컴포넌트** -- 메인 컴포넌트
  - `createPortal`로 `document.body`에 렌더링하여 z-index 스택 컨텍스트 문제 방지
  - `open`이 `false`이면 `null` 반환 (렌더링 스킵)
  - 구조:
    1. **백드롭**: `fixed inset-0 z-50 bg-black/50` -- 클릭 시 `onClose` 호출
    2. **시트 컨테이너**: `fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-card max-h-[80vh] animate-slide-in-bottom`
    3. **핸들 바**: `mx-auto mt-3 h-1 w-10 rounded-full bg-muted-foreground/30` -- 시각적 드래그 힌트
    4. **헤더 (조건부)**: `title`이 있을 때 제목 텍스트 + 닫기 버튼
    5. **콘텐츠 영역**: `overflow-y-auto overscroll-contain flex-1 p-4 pb-safe` -- 내부 스크롤 지원 + iOS safe area 대응

- **키보드/접근성 처리**
  - `useEffect`로 `open` 상태일 때 `keydown` 이벤트 리스너 등록, ESC 시 `onClose` 호출
  - 시트 컨테이너에 `role="dialog"`, `aria-modal="true"` 설정
  - `open` 시 `document.body`에 `overflow: hidden` 적용하여 배경 스크롤 방지, 닫힐 때 복원

### index.css 변경

- `slide-in-bottom` 키프레임 추가 (기존 `slide-in-left`와 동일 패턴):
  ```
  @keyframes slide-in-bottom {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
  }
  @utility animate-slide-in-bottom {
    animation: slide-in-bottom 250ms ease-out;
  }
  ```

## 데이터 흐름
부모 컴포넌트의 `open` 상태 변경 → BottomSheet가 Portal로 body에 마운트/언마운트 → 백드롭 클릭 또는 ESC 키 → `onClose` 콜백으로 부모에 닫기 신호 전달

## 선행 조건
- TSK-00-01 (v3 초기 환경 설정) -- `pb-safe` 유틸리티가 index.css에 추가되어 있어야 함 (미추가 시 본 Task에서 함께 추가)
