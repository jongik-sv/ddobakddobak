# TSK-03-04: 리팩토링 내역

## 변경 사항
| 파일 | 변경 내용 |
|---|---|
| pages/MeetingLivePage.tsx | stopMeeting을 handleStop에서 직접 호출 (테스트 가능성 + 명확한 흐름) |
| pages/MeetingLivePage.tsx | onChunkRef 패턴으로 sendChunk stale closure 방지 |
| api/meetings.ts | FormData로 오디오 파일 업로드 (Content-Type 자동 설정) |
| App.tsx | /meetings/:id/live 라우트 추가 |

## 테스트 확인
- 결과: PASS (102/102)
