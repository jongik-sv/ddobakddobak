# brief: fix-fe (sonnet)
target_repo: /Users/jji/project/ddobakddobak · write_scope(frontend/src/): lib/whiteboard/{runner,failure,schema}.ts(+test), stores/whiteboardStore.ts, components/meeting/ExportButton.tsx, components/meeting/WhiteboardToast.tsx, 관련 테스트
근거: tasks/whiteboard-export/workers/review-1/result.md 3·4·7·8·9번, design.md §7·§10
## 할 일
3. 정상 종료 stdout도 재요청 전에 auth/rate 판정 → 맞으면 재요청 없이 해당 kind 실패.
4. done 상태에 보조 버튼 "다시 만들기"(reset 후 startLocal). 재요약 등 material digest가 바뀌면 entry를 stale로 보고 "회의록이 바뀌었습니다" 표시+다시 만들기 유도.
7. done의 저장 버튼은 entry.board 유무만 본다(wbLoaded·wbMaterial 무관). 실행 중/완료 entry가 있으면 detect 실패해도 해당 화면 유지.
8. save의 downloadBlob 예외를 잡아 사용자 문구 표시(패널·토스트 둘 다).
9. schema: zones도 빈 구역 제거·12개 절단 후 검증(items와 같은 순서).
## 테스트
각 항목 1개 이상. 기존 테스트 유지.
## Do NOT
src-tauri 수정(다른 워커), 커밋, dev 서버 요청.
## 리포트
vitest 전체, tsc -p tsconfig.app.json, vite build 결과.
