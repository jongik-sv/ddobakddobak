# result: fe-promptdl (요약)
- copy 경로: 주 버튼 "지시문 내려받기 (.txt)"(downloadText, <제목>_<날짜>_화이트보드_지시문.txt), 보조 "복사" 유지, 완료 문구·claude.ai 경고
- 안내 박스 3종(관리자 끔·서버 claude 없음·설정 조회 실패), 403 폴백은 '꺼짐' 문구
- 관리자 탭: "서버의 Claude Code (기본)" / "끄기 · 지시문 파일로 내려받기"
- vitest 2232/2234(MeetingsPage·TrashPage 1회 실패, 단독 재실행 56/56 통과), tsc 0, build OK
- 잔여: Tauri 저장 대화상자 취소도 '내려받았습니다' 표시(download.ts 미수정)
