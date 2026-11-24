# 또박또박 매뉴얼 사이트 + F1 도움말 — 작업 명세

worktree: `/Users/jji/project/ddobakddobak-manual` (branch `feature/manual-site`). 다른 경로 수정 금지.
참고 프로젝트(읽기 전용): `/Users/jji/project/oranda/site` — Astro Starlight 매뉴얼. 구조·플러그인·스타일 방식을 본뜬다.

## 1. 게시 구조
- 사이트 소스: `site/` (Astro Starlight, oranda와 같은 버전: astro 7.4.5, @astrojs/starlight 0.42.8, @astrojs/markdown-remark 7.3.5).
- `astro.config.mjs`: `site: 'https://jongik-sv.github.io'`, `base: '/ddobakddobak/manual'`. 콘텐츠 루트 `src/content/docs/` 의 `index.mdx` = 매뉴얼 첫 화면.
- 최종 주소: `https://jongik-sv.github.io/ddobakddobak/manual/<slug>/`.
- 기존 `.github/workflows/pages.yml` 하나만 고친다(두 번째 워크플로 금지): `cp -RL docs _site` 유지 → `site/` npm ci + build → `site/dist/*` 를 `_site/manual/` 로 복사(기존 `docs/manual/ddobak-api-guide.html` 보존 — 슬러그 `ddobak-api-guide` 사용 금지). `paths:` 에 `site/**` 추가.
- 이미지: 본문은 `src/assets/screens/<file>.png` 참조. 없는 파일은 oranda `plugins/remark-missing-images.mjs` 방식으로 「(화면 준비 중: …)」 텍스트로 대체 → 빌드 안 깨짐.
- 재사용 가능한 공개 캡처(이미 Pages에 게시 중): `docs/landing/assets/*.png`, `docs/screenshots/*.png` → `site/src/assets/screens/` 로 복사해 사용.
- 브랜드: 랜딩(`docs/landing/index.html`) 기준 주색 `#5c52ee`, 글꼴 Pretendard. 로고/파비콘 `docs/landing/assets/favicon-128.png`. 헤더에 「또박또박 소개」 링크 → `https://jongik-sv.github.io/ddobakddobak/landing/`, GitHub 링크.

## 2. 페이지 목록(slug 고정 — F1 이 이 slug 로 연결됨. 바꾸지 말 것)
| 사이드바 그룹 | slug | 내용 |
|---|---|---|
| 시작하기 | start/overview | 또박또박 소개, 핵심 흐름, 용어 |
| | start/install | 데스크톱(macOS/Windows)·Android 설치 |
| | start/first-run | 첫 실행: 로컬/서버 모드, 초기 셋업 화면 |
| | start/login | 로그인·초대 링크 가입·비밀번호 |
| | start/project-select | 프로젝트 선택 첫 화면 |
| 프로젝트와 폴더 | projects/projects | 프로젝트 관리 화면, 팀/개인, 멤버 초대·초대 링크, 즐겨찾기 |
| | projects/sidebar-folders | 사이드바, 폴더 만들기·이동, 중요 표시, 태그, 브레드크럼 |
| 회의 | meetings/dashboard | 대시보드 |
| | meetings/list | 회의 목록, 필터(최근 3일 등), 드래그앤드롭 |
| | meetings/new-meeting | 새 회의 만들기, 회의 유형, 템플릿 |
| 녹음과 전사 | recording/live | 라이브 녹음 화면(시작·일시정지·종료, 실시간 전사·요약, 메모·북마크) |
| | recording/system-audio | 시스템 오디오 캡처(데스크톱) |
| | recording/upload | 오디오 파일 업로드, 다중 파일 병합, 앱 어디서든 드롭 |
| | recording/offline | 오프라인(온디바이스) 녹음 — Android |
| 회의록 | minutes/meeting-detail | 회의 상세 화면 구성 |
| | minutes/ai-summary | AI 회의록 보기·편집·재생성·추가 지시·잠금·전체보기·다이어그램 |
| | minutes/transcript | 전사 편집: 오타 수정·오타사전, 발언 분할/화자 변경, 기밀 구간 절단, STT 재생성 |
| | minutes/speakers | 화자 분리·이름 바꾸기·화자분리 재실행 |
| | minutes/linked-meetings | 연결(이전) 회의 |
| 검색과 AI 챗 | ai/search | 전역 검색 |
| | ai/chat | 회의 AI 챗, 인용 근거 |
| | ai/folder-chat | 폴더·프로젝트 챗 |
| 공유와 내보내기 | share/live-share | 다른 기기에서 실시간으로 보기(읽기 전용 뷰어 모드) |
| | share/collaborators | 회의 협업자 권한 |
| | share/export | 회의록 내보내기(MD/PDF/DOCX/프롬프트/화이트보드), 요약 zip |
| | share/archive | 회의·폴더 아카이브 내보내기/가져오기 |
| | share/dflow | D'Flow 전송 |
| 예약과 자동화 | schedule/schedule | 회의 예약·반복·자동 시작 |
| | schedule/background | 트레이·백그라운드·로그인 시 자동 실행 |
| 설정 | settings/personal | 「개인설정」 탭 |
| | settings/llm | 「LLM」 탭 |
| | settings/voice | 「음성·인식」 탭 |
| | settings/meeting | 「회의록 설정」 탭 |
| | settings/integrations | 「연동」 탭 (D'Flow, API 토큰 등 실제 탭 내용 기준) |
| | settings/stt-learning | (관리자) 「STT 용어 학습」 탭 — 오인식 용어 자동 학습·관리 |
| | settings/users | (관리자) 사용자 관리 |
| | settings/meeting-api | 회의 API·API 토큰·LLM 스킬 연동 (API 가이드 `../ddobak-api-guide.html` 링크) |
| 휴지통 | trash/trash | 휴지통·복구·영구 삭제 |
| 도움말 | help/shortcuts | 키보드 단축키(F1 포함) |
| | help/troubleshooting | 문제 해결 |
| | help/faq | 자주 묻는 질문 |

## 3. 본문 작성 규칙 (공개 사이트)
- 정본은 **코드**. `docs/사용자매뉴얼.md`·`docs/기능-인벤토리.md` 는 초안일 뿐이고 낡았다. 버튼·메뉴·탭 이름은 `frontend/src` 에서 실제 문자열을 grep 해 「」로 인용.
- 독자: 일반 사용자(비개발자). 존댓말 평서문(…합니다). oranda 본문(`/Users/jji/project/oranda/site/src/content/docs/editor/sql-editor.md`) 수준으로 상세하게: 화면 구성 번호 목록, 단계별 절차, 표, 주의(:::caution)·팁(:::tip) 활용.
- **금지(공개 노출)**: 내부 IP(10.x 등)·사내 서버 주소·실명/계정명·회사명·내부 운영 세부. "세컨드 브레인" 표현 금지(→ "회의 API"). 개발자용 내부 구현 설명 금지.
- 페이지 frontmatter: `title`, `description`, `sidebar.order`.
- 페이지 사이 링크는 상대경로(`../../minutes/ai-summary/`).

## 4. F1 / 매뉴얼 버튼 (frontend)
- 매뉴얼 기본 URL 상수: `https://jongik-sv.github.io/ddobakddobak/manual/`.
- 주제 해석 우선순위: ① 열린 `[role="dialog"]` 안(또는 자신)의 `data-help` 속성(마지막 것) ② 화면에 있는 `[data-help-page]` 속성(로그인·셋업처럼 라우트로 구분 안 되는 화면) ③ 현재 라우트 → slug 표 ④ 첫 화면.
- 라우트 표: `/`→start/project-select, `/dashboard`→meetings/dashboard, `/search`→ai/search, `/projects`→projects/projects, `/meetings`→meetings/list, `/meetings/:id/live`→recording/live, `/meetings/:id/viewer`→share/live-share, `/meetings/:id`→minutes/meeting-detail, `/trash`→trash/trash, `/local-meetings*`→recording/offline, `/invite/:code`→projects/projects.
- `data-help` 부착: SettingsContent 루트 `settings/{personal|llm|voice|meeting|integrations|stt-learning}`(현재 탭), UserManagementModal `settings/users`. 셋업 화면 `start/first-run`, 로그인 화면 `start/login`.
- 단축키: F1 (`preventDefault` 필수 — 브라우저 도움말 차단), App 루트(GatedApp 밖)에서 1회 등록 → 로그인·셋업·오프라인 화면에서도 동작.
- 버튼: 데스크톱 사이드바와 모바일 내비게이션에 「매뉴얼」(lucide `CircleHelp`) — title 에 「매뉴얼 (F1)」.
- 열기: Tauri = `@tauri-apps/plugin-shell` `open(url)`(`src/hooks/useAuth.ts:81` 방식), 실패 시 `window.open`. 웹 = `window.open(url, '_blank', 'noopener')`.
- 테스트: 라우트 표의 모든 slug 와 data-help 값이 `site/src/content/docs/<slug>.md(x)` 로 존재하는지 검사하는 vitest.
