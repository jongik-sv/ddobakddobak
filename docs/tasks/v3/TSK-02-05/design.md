# TSK-02-05: MobileRecordControls 컴포넌트 - 설계

## 구현 방향
- MeetingLivePage의 기존 데스크톱 헤더 컨트롤 바(line 710~902)를 모바일에서는 `MobileRecordControls` 컴포넌트로 대체
- 모바일 헤더: 1행에 뒤로가기 + 제목(truncate) + 녹음 상태(빨간 점 + 타이머), 2행에 핵심 버튼(일시정지, 종료) + `...` 더보기 버튼
- 더보기 버튼 탭 시 바텀 시트에 나머지 옵션(STT 엔진, 시스템 오디오, 마이크, 공유, 설정, 북마크, 적용주기, 초기화, 템플릿 저장)을 표시
- BottomSheet는 TSK-03-01에서 구현 예정이므로, 본 Task에서는 임시로 간단한 바텀 시트(모달/드롭다운)를 인라인 구현하고, TSK-03-01 완료 후 교체 가능하도록 설계
- 데스크톱에서는 기존 헤더 컨트롤 바를 100% 유지 (변경 없음)

## 파일 계획

| 파일 경로 | 역할 | 신규/수정 |
|-----------|------|-----------|
| `frontend/src/components/meeting/MobileRecordControls.tsx` | 모바일 녹음 컨트롤 컴포넌트 (상단 고정 헤더 + 더보기 바텀 시트) | 신규 |
| `frontend/src/pages/MeetingLivePage.tsx` | 헤더 컨트롤 바 영역에 `isDesktop` 분기 추가, 모바일일 때 `MobileRecordControls` 렌더링 | 수정 |

## 주요 구조

- **MobileRecordControls (신규)** -- 모바일 전용 녹음 컨트롤 컴포넌트
  - Props:
    - `status`: `'idle' | 'recording' | 'stopped'` -- 녹음 상태
    - `isPaused`: boolean -- 일시정지 여부
    - `isStopping`: boolean -- 종료 처리 중 여부
    - `elapsedSeconds`: number -- 경과 시간 (초)
    - `onBack`: `() => void` -- 뒤로가기 핸들러
    - `onStart`: `() => void` -- 회의 시작
    - `onPause`: `() => void` -- 일시정지
    - `onResume`: `() => void` -- 재개
    - `onStop`: `() => void` -- 종료
    - `extraControls`: ReactNode -- 더보기 시트 내부에 렌더할 추가 컨트롤 (공유, STT 엔진, 시스템 오디오 등)
  - 내부 구조:
    - **Row 1 (상단 바)**: `[<- 뒤로] [회의실 (truncate)] [빨간점 + HH:MM:SS]`
    - **Row 2 (컨트롤)**: idle 상태에서 `[회의 시작]` 버튼, recording 상태에서 `[일시정지/재개] [종료] [...더보기]`
    - **MoreSheet (더보기 패널)**: `showMore` 상태로 토글, 오버레이 + 바텀 슬라이드업 패널

- **MoreSheet (인라인 서브컴포넌트)** -- 임시 바텀 시트 (TSK-03-01 BottomSheet 교체 예정)
  - `fixed inset-x-0 bottom-0 z-50` 위치
  - 백드롭 `bg-black/50` 클릭으로 닫기
  - `max-h-[60vh]` 내부 스크롤
  - `extraControls` prop을 렌더링: 공유 버튼, STT 엔진 선택, 시스템 오디오 토글, 마이크 설정, 북마크 추가, 적용주기 선택, 회의 초기화, 설정, 템플릿 저장

- **MeetingLivePage (수정)** -- 헤더 분기 추가
  - 기존 헤더 컨트롤 바 (`<div className="flex items-center justify-between px-4 py-2 ...">`)를 `isDesktop` 조건으로 래핑
  - 모바일: `<MobileRecordControls>` 렌더링, `extraControls`에 기존 버튼들을 리스트 형태로 전달
  - 데스크톱: 기존 헤더 JSX 100% 유지

- **formatElapsed (재사용)** -- MeetingLivePage에 이미 정의된 시간 포맷 함수
  - MobileRecordControls에서도 필요하므로 props로 `elapsedSeconds` 전달 후 내부에서 동일 로직 사용 (또는 유틸로 추출)

## 데이터 흐름
MeetingLivePage에서 `useMediaQuery(BREAKPOINTS.lg)` 판별 --> 모바일: `<MobileRecordControls>` 에 녹음 상태/핸들러 props 전달 --> 사용자 탭: 일시정지/종료는 직접 콜백 호출, 더보기는 인라인 바텀 시트 열기 --> 시트 내부에서 공유/STT/설정 등 기존 핸들러 콜백 호출 --> 데스크톱: 기존 헤더 컨트롤 바 그대로 렌더링

## 선행 조건
- TSK-02-04: MeetingLivePage 패널/탭 분기 (완료) -- `isDesktop` 분기가 이미 적용되어 있음
- TSK-00-02: `useMediaQuery` 훅 (완료) -- 이미 사용 중
- TSK-03-01: BottomSheet 공용 UI 컴포넌트 (미완료, 선택적 의존) -- 본 Task에서는 임시 인라인 바텀 시트를 구현하고, TSK-03-01 완료 후 교체
- 기존 hooks: `useAudioRecorder` (isRecording, isPaused, start, stop, pause, resume), `useSystemAudioCapture`, `useMicCapture` -- MeetingLivePage에서 이미 사용 중이므로 MobileRecordControls는 콜백 props만 받음
