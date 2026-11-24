[2026-11-17 00:00] [DECISION] 사용자 요청: F1 = 현재 화면 해당 장. 질문 생략·바로 진행 지시
[2026-11-17 00:00] [DECISION] base /ddobakddobak/manual, 기존 pages.yml 확장(docs 복사 + site dist → _site/manual)
[2026-11-17 00:00] [WORKER] site-scaffold(sonnet), f1-help(sonnet) 병렬 디스패치
[2026-11-17 12:30] [WORKER] 본문 작성 6개(sonnet) 병렬 완료 — 40쪽 약 4.6k줄
[2026-11-17 12:30] [VERIFICATION] site build 42쪽 성공, 내부 링크 깨짐 0, 공개 금지어 0(예시 192.168.0.10만), 첫 화면 히어로 판별 버그 수정(entry.id '')
[2026-11-17 12:30] [VERIFICATION] frontend tsc -p tsconfig.app.json 0, vitest 관련 27파일 277 통과(워커 보고 전체 2278 통과)
[2026-11-17 12:45] [VERIFICATION] 사실검증 워커: 업로드 후 자동요약·live-share 제목·login 제목·매니저/협업자 권한·화이트보드 분기·템플릿 등 코드 기준 수정, 재빌드·링크 0
[2026-11-24 09:22] [ACTION] WIP 커밋 616cd115 → main(8680714a) 머지 0df281f2(충돌 없음, 자동 병합). SettingsContent helpSlug 가 sttLearning 탭에 settings/sttLearning(없는 장)을 내던 결함 수정
[2026-11-24 09:22] [VERIFICATION] site build 43쪽 성공, 내부 링크 3701개 깨짐 0(배포 시 복사되는 ../../ddobak-api-guide.html 1건 제외), 공개 금지어 0(예시 192.168.0.10만), frontend tsc -p tsconfig.app.json 0, vite build 성공, vitest help·settings·AiSummaryPanel·layout 36파일 300 통과
