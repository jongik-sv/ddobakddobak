# brief: fe-render (sonnet)
target_repo: /Users/jji/project/ddobakddobak
write_scope: frontend/src/lib/whiteboard/render.ts, frontend/src/lib/whiteboard/whiteboard.test.ts(렌더 테스트만)
기준: tasks/whiteboard-export/sources/standard-board.html (디자인 원본) · 현재 결과 스크린샷: /private/tmp/claude-501/-Users-jji-project-ddobakddobak/c51e782d-25b3-42c2-9fc8-c348ea39aa3d/scratchpad/shot-sample.png (기준: shot-standard.png)
## 문제
현재 renderBoardHtml은 기준 보드보다 빈약하다: 스티커가 좌측 2칸만 차지(가로 공백), 손글씨 글꼴 없음, kind별 모양 차이 없음.
## 할 일 (renderBoardHtml 시그니처·escape·필터·다크모드 유지)
- 글꼴: 기준과 같은 Google Fonts(Nanum Pen Script·Gowun Dodum·IBM Plex Mono) link 허용. CSP는 style-src에 https://fonts.googleapis.com, font-src https://fonts.gstatic.com 만 추가. 오프라인 대비 시스템 글꼴 폴백.
- 레이아웃: 스티커 그리드 auto-fill로 폭 채움, 짧은 구역은 2열 배치(기준처럼).
- kind별 표현: topic=스티커(색 순환), decision=테두리 카드+태그, issue=⚠ 빨간 문구 스티커, todo=체크리스트형(담당·기한 칩), schedule=타임라인/날짜 칩.
- 제목·구역 제목은 marker 글꼴, 헤더에 headline·날짜·항목 수 요약.
## Do NOT
다른 파일 수정, 데이터 문자열을 script/속성 밖 위치에 미escape 삽입, 커밋.
## 리포트
vitest src/lib/whiteboard·tsc -p tsconfig.app.json 결과, CSP 최종 문자열.
