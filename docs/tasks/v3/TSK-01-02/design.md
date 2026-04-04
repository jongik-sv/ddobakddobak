# TSK-01-02: MobileSidebarOverlay 컴포넌트 - 설계

## 구현 방향
- 기존 `Sidebar` 컴포넌트를 그대로 재사용하되, 모바일 전용 오버레이(fixed + backdrop)로 감싸는 래퍼 컴포넌트를 신규 생성한다.
- 백드롭(반투명 `bg-black/50`)과 좌측 슬라이드 인 애니메이션(`animate-slide-in-left`, TSK-00-01에서 정의)을 적용한다.
- 오버레이 열기/닫기 상태는 uiStore의 `mobileMenuOpen`(TSK-01-04에서 추가)을 사용하며, 백드롭 클릭/터치 시 닫기를 처리한다.
- `z-50`으로 바텀 내비 등 다른 요소 위에 표시한다.

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| `frontend/src/components/layout/MobileSidebarOverlay.tsx` | 모바일 사이드바 오버레이 래퍼 컴포넌트 | 신규 |

## 주요 구조

### MobileSidebarOverlay 컴포넌트

```tsx
interface MobileSidebarOverlayProps {
  onClose: () => void
}
```

**책임:**
1. **Backdrop 렌더링**: `fixed inset-0 z-50`의 반투명 배경(`bg-black/50`)을 렌더링하고, 클릭/터치 시 `onClose` 콜백을 호출하여 오버레이를 닫는다.
2. **Sidebar 래핑**: 기존 `Sidebar` 컴포넌트를 `relative` 위치의 컨테이너(`w-72 max-w-[80vw]`)에 넣어 좌측에 표시한다.
3. **슬라이드 인 애니메이션**: 사이드바 컨테이너에 `animate-slide-in-left` 클래스를 적용하여 좌측에서 200ms ease-out 슬라이드 인 효과를 준다.
4. **이벤트 전파 방지**: 사이드바 영역 클릭이 백드롭의 `onClose`를 트리거하지 않도록 `stopPropagation` 처리한다.
5. **Escape 키 닫기**: `useEffect`로 `keydown` 이벤트를 감지하여 Escape 키 입력 시 `onClose`를 호출한다.

### DOM 구조

```tsx
<div className="fixed inset-0 z-50 flex">
  {/* 백드롭 */}
  <div
    className="fixed inset-0 bg-black/50"
    onClick={onClose}
    aria-hidden="true"
  />
  {/* 사이드바 패널 */}
  <div
    className="relative w-72 max-w-[80vw] bg-sidebar animate-slide-in-left"
    onClick={(e) => e.stopPropagation()}
  >
    <Sidebar />
  </div>
</div>
```

### 접근성 고려

- 오버레이 최상위 요소에 `role="dialog"`, `aria-modal="true"`, `aria-label="사이드바 메뉴"` 속성을 부여한다.
- 백드롭에 `aria-hidden="true"`를 설정한다.
- Escape 키로 닫을 수 있도록 키보드 이벤트를 처리한다.

## 데이터 흐름
`AppLayout`에서 uiStore의 `mobileMenuOpen` 상태를 읽어 `true`일 때 `MobileSidebarOverlay`를 조건부 렌더링 -> 사용자가 백드롭 클릭 또는 Escape 키 누르면 `onClose` 콜백 -> `setMobileMenuOpen(false)` 호출 -> 오버레이 언마운트

## 선행 조건
- **TSK-00-01**: `animate-slide-in-left` CSS 키프레임 애니메이션이 `index.css`에 정의되어 있어야 함
- **TSK-01-04** (uiStore 확장): `mobileMenuOpen` / `setMobileMenuOpen` 상태가 uiStore에 존재해야 함 (이 컴포넌트는 `onClose` props를 받으므로 직접 의존하지는 않으나, 호출부인 AppLayout에서 필요)
