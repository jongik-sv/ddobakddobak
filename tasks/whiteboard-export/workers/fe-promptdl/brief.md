# brief: fe-promptdl (sonnet)
target_repo: /Users/jji/project/ddobakddobak · write_scope(frontend/src/): components/meeting/ExportButton*(+tests), components/settings/MeetingSettingsTab*(+test), lib/whiteboard/material.ts(파일명 헬퍼만)
배경(사용자 결정 2026-11-12): 웹 기본=서버 Claude, 데스크톱=로컬 claude. 관리자가 Claude 화이트보드를 끄면(web_mode=copy) 또는 서버 claude 없음 폴백이면 → 지시문을 **파일로 내려받기**.
## 할 일
1. ExportButton route=copy 화면: 주 버튼 "지시문 내려받기 (.txt)" → buildCopyInstruction 결과를 downloadText/downloadBlob(text/plain;charset=utf-8)로 저장. 파일명 `<제목>_<날짜>_화이트보드_지시문.txt`(formatFilenameDate 재사용, '미정' 규칙 동일). 보조 버튼 "복사"는 유지(기존 클립보드 로직·실패 시 textarea·claude.ai 경고 그대로). 화이트보드 버튼 아래 작은 글씨 "지시문 내려받기 · 내 Claude에서".
2. 완료 화면: "지시문을 내려받았습니다. Claude Code나 claude.ai에 파일 내용을 붙여 넣어 주세요." + 기존 claude.ai 경고.
3. MeetingSettingsTab: 라디오 순서·문구 → "서버의 Claude Code (기본)" / "끄기 · 지시문 파일로 내려받기". 서버 claude 없으면 서버 라디오 disabled 유지. 설명문 갱신: 기본은 서버, 끄면 사용자가 지시문 파일을 받아 자기 Claude에 붙여 넣음, 데스크톱 앱은 그 PC의 Claude Code 사용.
## 테스트
copy 경로 다운로드(파일명·내용·mime), 보조 복사 유지, 설정 탭 라벨·기본 선택. 기존 테스트 문구 기대값 갱신.
## Do NOT
백엔드·src-tauri·store·api 수정, 커밋, dev 서버 요청.
## 리포트
vitest 전체, tsc -p tsconfig.app.json, vite build.
