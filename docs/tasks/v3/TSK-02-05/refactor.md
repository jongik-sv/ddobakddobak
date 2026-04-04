# TSK-02-05: 리팩토링 내역

## 변경 사항

| 파일 | 변경 내용 |
|------|-----------|
| `frontend/src/lib/audioUtils.ts` | `formatElapsedSeconds` 유틸 함수 추가 (초 단위 -> MM:SS / HH:MM:SS) |
| `frontend/src/components/meeting/MobileRecordControls.tsx` | 중복 `formatElapsed` 제거, `formatElapsedSeconds` import로 교체 |
| `frontend/src/pages/MeetingLivePage.tsx` | 중복 `formatElapsed` 제거, `formatElapsedSeconds` import로 교체 |

## 테스트 확인
- 결과: PASS
- MobileRecordControls.test.tsx: 17 passed
- MeetingLivePage.test.tsx: 21 passed
- MeetingPage.test.tsx 2건 실패는 기존 결함 (본 리팩토링과 무관)
