# result: fe-lib (요약 원문 보존)
- 파일: lib/whiteboard/{prompt,material,schema,render,failure,route,index}.ts + whiteboard.test.ts
- API: buildWhiteboardMaterial(data)->Material|null, buildWhiteboardFilename(title,date), WHITEBOARD_SYSTEM_PROMPT, buildWhiteboardUserContent, buildRetrySuffix, buildCopyInstruction(m, filename), parseBoardResponse(text)->Board (throws WhiteboardValidationError), renderBoardHtml(board), classifyWhiteboardFailure(err,{format}), resolveWhiteboardRoute({isTauri,localClaude,webMode,serverClaudeAvailable,serverEnabled=false})
- system prompt sha256: c39e2509ea6c23b27f38c292e6939dd99b5f10749e97c129c9757678ea04f6a6 (UTF-8, \n, 끝 줄바꿈 없음)
- 설계 차이: buildExportFilename은 '미정' 날짜에서 예외 → buildWhiteboardFilename 별도
