# 한글(비ASCII) 엔트리명을 Windows 탐색기가 UTF-8로 디코딩하려면 EFS 플래그
# (general purpose bit 11)가 필요하다. rubyzip은 이름 인코딩을 자동 감지하지 않고
# 이 전역 설정이 true일 때만 EFS를 세운다 — 미설정 시 한국어 Windows(CP949)에서
# 한글 파일명이 깨진다.
Zip.unicode_names = true
