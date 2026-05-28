# 설계: 회의 템플릿 중앙관리 전환 + 설정 화면 개인/전역 탭 분리

- 날짜: 2026-05-28
- 상태: 승인됨 (구현 대기)

## 배경 / 목적

설정(Settings) 화면이 개인 설정과 관리자 전역 설정을 단일 페이지에 섞어 보여준다.
또한 "회의 템플릿"(`MeetingTemplate`)이 사용자별 개인 소유 데이터라, 조직 차원에서
일관된 회의 양식/프리셋을 강제·공유하기 어렵다.

목표 두 가지:

1. **회의 템플릿 중앙관리 전환** — `MeetingTemplate`을 사용자별 소유에서 전역 공유로
   바꾸고, 변경(CRUD)은 관리자만, 조회·사용은 모두 허용한다.
2. **설정 화면 탭 분리** — 설정을 `개인설정` / `전역설정` 두 탭으로 나눈다. 전역설정 탭은
   관리자에게만 노출한다.

관련 선행 작업(이미 적용됨): 회의록 양식(`PromptTemplate`)은 백엔드 `require_admin!`
+ 프론트 UI 게이트가 이미 적용되어 전역 관리 대상이다. 본 작업에서는 전역설정 탭으로
배치만 이동한다.

## 권한 모델 (기존 규약 재사용)

- 백엔드: `ApplicationController#require_admin!` — `server_mode?`일 때만 강제하며
  `current_user.admin?` 아니면 403. 로컬 모드(맥 데스크톱 앱)는 통과(= admin 취급).
- 프론트: `showAdminSettings = isAdmin || isLocalMode` (`SettingsContent.tsx` 기존 변수).

두 규약이 일관되게 "관리자 또는 로컬 앱 = 전역 관리 주체"를 의미한다.

## 1. 백엔드 — 회의 템플릿 중앙관리

### 1.1 마이그레이션 (신규)

`db/migrate/<ts>_centralize_meeting_templates.rb`

- `meeting_templates.user_id` 컬럼 제거 (FK `add_foreign_key "meeting_templates", "users"`
  및 `index_meeting_templates_on_user_id` 함께 제거).
- 기존 행은 그대로 유지(= 전부 전역 승격). 데이터 삭제 없음.
- `folder_id`는 유지. `Folder`는 team 공유 모델(`folder.rb`에 `user_id` 없음)이라 전역
  템플릿이 folder를 참조해도 무방.
- `down` 경로: `user_id` 재추가는 어떤 사용자에 귀속할지 모호하므로 `null: true`로 복원
  (비파괴적 롤백). 비가역성 방지를 위해 reversible 블록 또는 `up`/`down` 명시.

마이그레이션 후 `db/schema.rb` 갱신 반영.

### 1.2 모델

`app/models/meeting_template.rb`

- `belongs_to :user` 제거.
- `belongs_to :folder, optional: true` 유지.
- `validates :name, presence: true, length: { maximum: 100 }` 유지.

### 1.3 컨트롤러

`app/controllers/api/v1/meeting_templates_controller.rb`

- `before_action :require_admin!, only: %i[create update destroy]` 추가.
- `index`: `current_user.meeting_templates...` → `MeetingTemplate.order(updated_at: :desc)`
  (전역, 인증된 사용자 모두 조회).
- `create`: `current_user.meeting_templates.new(...)` → `MeetingTemplate.new(...)`.
- `set_template`: `current_user.meeting_templates.find` → `MeetingTemplate.find`.
- `template_params`에서 user 귀속 관련 없음(그대로). 응답 JSON 변화 없음.

## 2. 프론트엔드 — 설정 탭 분리

### 2.1 탭 셸

`SettingsContent.tsx` (현재 831줄 단일 컴포넌트)를 탭 셸로 축소:

- 탭 상태: `const [tab, setTab] = useState<'personal' | 'global'>('personal')`.
- 탭 버튼: `개인설정` 항상, `전역설정`은 `showAdminSettings`일 때만.
- `showAdminSettings === false`이면 탭바를 숨기고 개인설정 본문만 렌더(단일 탭 어색함 방지).
- 공통 상태/핸들러(LLM 폼 등)는 셸 또는 store에 두고 탭 컴포넌트에 props/store로 전달.

### 2.2 탭별 컴포넌트 분리 (파일 추출)

831줄은 책임 과다 → 두 파일로 추출:

`PersonalSettingsTab.tsx`:
- 실행 모드 (Tauri 전용 섹션)
- 회의 언어 (`UserLanguageSettings`)
- 비밀번호 변경 (`PasswordChangeSection`, 기존 `showPasswordSection` 조건 유지)
- 내 LLM 설정 (`UserLlmSettings`)

`GlobalSettingsTab.tsx` (관리자 전용, 탭 자체가 admin 게이트되므로 내부 중복 게이트 제거 가능):
- STT 모델
- AI 요약 모델 (서버 LLM 설정 폼)
- 회의 템플릿 (`MeetingTemplateManager`)
- 회의록 양식 (`PromptTemplateManager`)
- 음성 청킹 설정
- HuggingFace 설정
- 화자 분리 설정

주의: AI 요약 모델 폼은 현재 LLM 상태/핸들러(`currentForm`, `handleLlmSave`,
`handleLlmTest` 등)와 결합. 추출 시 해당 상태를 `GlobalSettingsTab`로 이동하거나
공통 훅으로 분리. 개인 LLM(`UserLlmSettings`)과 서버 LLM은 별개 — 혼동 주의.

### 2.3 라이브 화면 저장 버튼

`MeetingLivePage.tsx`:
- `SaveTemplateDialog`를 여는 버튼(템플릿으로 저장)에 `showAdminSettings` 게이트 추가.
  비-admin은 버튼 미노출. (admin 판별: 기존 인증 store 활용)

## 3. 테스트 전략 (TDD)

### 3.1 백엔드

`spec/requests/api/v1/meeting_templates_spec.rb` (신규):
- `GET index`: 일반 사용자(server_mode)도 전역 템플릿 전체 조회 → 200, 다른 사용자가
  만든 템플릿도 보임.
- `POST create`: server_mode 일반 사용자 → 403; admin → 201.
- `PATCH update` / `DELETE destroy`: 일반 사용자 → 403; admin → 성공.
- 로컬 모드(loopback/비-server_mode): 일반 흐름 통과(require_admin! 미강제) 확인.

모델/마이그레이션: 기존 `user` 연관 제거 후에도 생성·조회 정상 동작하는지.

### 3.2 프론트엔드

`SettingsContent.test.tsx` (확장):
- admin/로컬: 탭 2개 렌더, 전역 탭 선택 시 전역 섹션 표시.
- 일반 사용자: 전역 탭 없음(탭바 숨김), 개인 섹션만.
- (가능하면) `MeetingLivePage` 저장 버튼이 admin에만 보이는지.

## 4. 영향 파일

| 영역 | 파일 | 종류 |
|------|------|------|
| BE 마이그레이션 | `backend/db/migrate/<ts>_centralize_meeting_templates.rb` | 신규 |
| BE 스키마 | `backend/db/schema.rb` | 수정 |
| BE 모델 | `backend/app/models/meeting_template.rb` | 수정 |
| BE 컨트롤러 | `backend/app/controllers/api/v1/meeting_templates_controller.rb` | 수정 |
| BE 스펙 | `backend/spec/requests/api/v1/meeting_templates_spec.rb` | 신규 |
| FE 탭 셸 | `frontend/src/components/settings/SettingsContent.tsx` | 수정(축소) |
| FE 탭 | `frontend/src/components/settings/PersonalSettingsTab.tsx` | 신규 |
| FE 탭 | `frontend/src/components/settings/GlobalSettingsTab.tsx` | 신규 |
| FE 게이트 | `frontend/src/pages/MeetingLivePage.tsx` | 수정 |
| FE 스펙 | `frontend/src/components/settings/SettingsContent.test.tsx` | 수정 |

## 비목표 (YAGNI)

- 회의 템플릿의 팀/조직 단위 스코프(team별 분리)는 하지 않음 — 단일 전역.
- 회의록 양식(`PromptTemplate`) 권한 로직 변경 없음(기 적용분 재사용).
- 개인 LLM/회의 언어 등 개인 설정 로직 변경 없음 — 위치만 탭 이동.
- 전역설정 탭 비활성/읽기전용 노출 옵션 채택 안 함 — 아예 숨김.

## 리스크

- `SettingsContent.tsx` LLM 폼 상태 추출이 가장 까다로움 — 회귀 위험. 추출 전후 기존
  테스트 통과로 가드.
- 마이그레이션은 운영 데이터에 영향(user_id 제거). down 경로 비파괴 복원으로 완화하되,
  배포 전 백업 권장.
