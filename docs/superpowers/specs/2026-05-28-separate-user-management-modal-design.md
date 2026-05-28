# 유저관리 사이드바 별도 모달 분리 — 설계

작성일: 2026-05-28

## 배경

현재 사용자 관리(UserManagementPanel)는 설정 모달(SettingsModal) 안의
"사용자 관리" 탭으로 존재한다. admin(또는 local 모드)일 때만 탭이 노출된다.
일반 설정과 관리자 전용 사용자 관리가 한 모달에 섞여 있어 역할 구분이 모호하다.

## 목표

사용자 관리를 설정에서 분리하여, 사이드바의 독립된 메뉴 + 전용 모달로 제공한다.

## 결정 사항

- 분리 방식: 사이드바에 admin 전용 "사용자 관리" 메뉴 추가
- 표시 형태: 전용 모달(설정 모달과 별개)
- 노출 조건: 기존과 동일 — `user?.role === 'admin' || getMode() === 'local'`,
  모바일에서는 미노출(설정 모달과 동일하게 `IS_MOBILE` 차단)

## 변경 범위 (4 + 1 파일)

### 1. `frontend/src/stores/uiStore.ts`
신규 상태 추가:
- `userMgmtOpen: boolean`
- `openUserMgmt()` — 설정과 동일하게 `IS_MOBILE`이면 no-op
- `closeUserMgmt()`

### 2. `frontend/src/components/layout/Sidebar.tsx`
"설정" 버튼 아래 "사용자 관리" 버튼(`Users` 아이콘) 추가.
- 노출 조건: `canManageUsers = user?.role === 'admin' || getMode() === 'local'`
- 모바일 오버레이에서는 미렌더(또는 openUserMgmt no-op과 일관되게 처리)
- 클릭 시 `openUserMgmt()` 호출, 모바일이면 오버레이 닫기

### 3. `frontend/src/components/settings/UserManagementModal.tsx` (신규)
SettingsModal 컨테이너 구조를 복제하되 탭 바 없음.
- 헤더 제목 "사용자 관리"
- 본문: 기존 `UserManagementPanel` 재사용
- Escape 키 닫기, 데스크톱/모바일 컨테이너 패턴 동일
- `userMgmtOpen`이 false면 null 반환

### 4. `frontend/src/components/settings/SettingsModal.tsx`
users 탭 제거:
- `SettingsTab` 타입, `activeTab` 상태, 탭 바 JSX 삭제
- `canManageUsers`, `Users` import, `UserManagementPanel` import 제거
- 본문은 `SettingsContent` 단일 렌더

### 5. `frontend/src/App.tsx`
`<UserManagementModal />`를 `<SettingsModal />` 옆에 마운트.

## 데이터 흐름

변경 없음. `UserManagementPanel` 내부 로직 그대로 유지, 표시 컨테이너만 교체.

## 테스트

- `SettingsModal.test.tsx`: users 탭 관련 검증 제거(이제 탭 없음)
- `UserManagementModal.test.tsx` (신규): 열림 렌더 + Escape/닫기 동작 검증

## 비목표 (YAGNI)

- 라우트(/admin/users) 추가 안 함
- UserManagementPanel 내부 기능 변경 없음
- 모바일 사용자 관리 지원 추가 안 함(기존 설정 동작 유지)
