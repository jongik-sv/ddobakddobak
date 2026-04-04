# TSK-02-04: 리팩토링 내역

## 변경 사항

| 파일 | 변경 내용 |
|------|-----------|
| `frontend/src/pages/MeetingLivePage.tsx` | 모바일/데스크톱 양쪽에서 중복되던 오타 수정 UI를 `CorrectionsSection` 로컬 컴포넌트로 추출 |
| `frontend/src/pages/MeetingLivePage.tsx` | 모바일/데스크톱 양쪽에서 중복되던 메모 저장 헤더를 `MemoHeader` 로컬 컴포넌트로 추출 |

## 테스트 확인
- 결과: PASS
- 15/15 테스트 통과 (MeetingLivePage.test.tsx)
