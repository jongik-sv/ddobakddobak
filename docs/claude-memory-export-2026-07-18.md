# Claude 메모리 내보내기 (또박또박 프로젝트) — 정리본

생성일: 2026-07-18  
출처: `/Users/jji/.claude/projects/-Users-jji-project-ddobakddobak/memory/`  
전체 100개 중 핵심 24개만 남긴 정리본

---

## 작업 방식 (feedback)

### feedback_always_subagent_execution

> 구현 플랜 실행은 항상 서브에이전트 방식(subagent-driven), 필요시 workflow 병용. inline 금지

사용자는 구현 실행을 **무조건 서브에이전트 방식**으로 하길 원한다 (2026-06-15 명시: "나는 무조건 서브에이전트야 기억해놔"). 추가로 (2026-06-18 명시) **필요에 따라 Workflow(다중 에이전트 오케스트레이션) 사용을 선호**한다 — 서브에이전트 디스패치가 기본, 병렬 fan-out·대규모 작업엔 Workflow 도구.

**Why:** 메인 세션 컨텍스트를 코디네이션에 보존하고, task별 fresh 서브에이전트 + 2단 리뷰(spec→quality)로 품질·격리 확보. Workflow는 결정론적 control flow(루프·조건·fan-out)와 토큰 격리가 필요할 때.

**How to apply:** 구현 플랜을 실행할 때 inline 실행 옵션을 묻지 말고 곧장 `superpowers:subagent-driven-development`로 디스패치. 각 plan task = implementer 서브에이전트 → spec 리뷰 → code quality 리뷰 → 이슈 시 재디스패치. 독립 task 다수·병렬 검증·discovery 스윕 등 규모가 크면 Workflow 도구로 오케스트레이션. Orchestrator(메인)는 직접 코드를 쓰지 않고 서브에이전트 산출을 조율한다.

**추가 (2026-06-26 명시): "최대한 병렬로 구현. 메인에이전트에서 하지말고 서브에이전트/워크플로우로."** → 단순 orientation(파일 읽기·grep)조차 메인에서 길게 끌지 말고 가능한 한 위임. Workflow 설계 시 직렬 implement→review 대신 **병렬 fan-out 극대화**: 핵심 구현은 직렬일 수밖에 없어도(단일 파일 TDD), 독립 갭조사는 implement와 동시 parallel(), 리뷰는 단일이 아니라 다관점(correctness/회귀/테스트품질/누수) 동시 parallel()로. 메인은 코디네이션만.

**재강조 (2026-07-18 명시): "최대한 서브에이전트, 워크플로우를 이용하도록 해. 꼭 메모리 해놨다가 따르도록."** → 구현뿐 아니라 정찰·조사·리뷰·계획 검증 등 모든 단계에서 위임 우선. 모델 배정은 feedback_model_tiering(haiku/sonnet/최상위) 따름.

---

### feedback_model_tiering

> 서브에이전트 3단: 간단조사=haiku·코딩=sonnet·설계/오케스트레이션=세션 최상위(미지정). 무조건 Fable/Opus 금지, 일에 맞는 모델 선택

서브에이전트 모델 3단 배정 (버전 고정 없이 별칭 사용 — 버전 올라가면 자동 승계):
- **haiku** — 간단한 조사, 파일 위치 찾기, 기계적 grep/정리, 단순 확인 등 가벼운 일 전부
- **sonnet** — 코딩(구현·테스트 작성 등 코드 생산)
- **세션 최상위 모델**(model 미지정 상속) — 설계, 오케스트레이션, 계획 수립, 어려운 리뷰·검증 판단

무조건 Fable/Opus를 쓰지 말 것. 작업 난이도에 맞는 모델을 매번 의식적으로 선택.

**Why:** 비용·속도 최적화. 가벼운 일에 최상위 모델은 낭비 (2026-07-18 사용자 지시, 강조 요청).

**How to apply:** Agent 툴에 `model: "haiku"|"sonnet"` 지정, Workflow `agent()`에 `opts.model` 지정. 설계·판단 에이전트만 미지정(세션 모델 상속). 정찰/조사 워크플로우는 기본 haiku, 판단 섞이면 sonnet 이상.

**승급 규칙 (2026-07-18 추가):** 배정 모델의 능력 부족으로 작업이 실패하면(오답·미완수·리뷰에서 반복 반려 등) 같은 프롬프트를 한 단계 위 모델로 재시도 — haiku→sonnet→세션 최상위. 환경 문제(권한·빌드 깨짐 등) 실패는 승급 대상 아님(원인 수정 후 같은 모델 재시도). 같은 태스크 2회 승급 후에도 실패하면 사용자에게 보고.

---

### feedback_no_auto_commit

> 명시적 요청 없이 git commit, git push 하지 않기

커밋과 푸시는 사용자가 명시적으로 요청할 때만 수행한다.

**Why:** 사용자가 작업 흐름을 직접 통제하고 싶어함.

**How to apply:** 파일 수정 후 자동으로 커밋/푸시하지 말 것. 커밋이나 푸시가 필요해 보여도 먼저 물어보거나, 사용자 요청을 기다릴 것.

---

### feedback_full_compile_verify

> 변수/스토어 필드 제거 시 — 편집 파일 포함 전수 grep + vite 프로덕션 빌드로 검증

프론트에서 store 필드/변수를 제거할 때, 잔존 참조를 **편집 대상 파일까지 포함해** 전 src grep으로 확인하고, **`vite build`(또는 풀 타입체크)**로 최종 검증할 것.

**Why:** `appSettingsStore`의 `selectedLanguages` 등을 제거하면서 `SettingsContent.tsx`에 남은 참조 1곳(템플릿 문자열 `${selectedLanguages.length>1?...}`)을 놓침 → 런타임 `ReferenceError` → 컴포넌트 크래시. 놓친 이유: (1) 잔존 grep에서 `grep -v settings/SettingsContent`로 **편집 파일을 제외**, (2) `rtk proxy npx tsc --noEmit`이 clean으로 나와 과신(incremental 캐시/출력 필터 가능성).

**How to apply:** 제거 리팩토링 후 ① `grep -rn '<symbol>' src`(제외 필터 없이 전수) → 0 확인, ② `npx vite build` 또는 캐시 무시 풀 타입체크가 에러 없이 통과해야 완료로 간주. 테스트 통과만으로 끝내지 말 것.

---

### feedback_rails_pending_migration_trap

> db/migrate에 마이그레이션 파일 추가만 해도 러닝 Rails dev 서버가 전 요청 500

Rails dev 모드(puma)는 재기동하지 않아도 `db/migrate/` 디렉터리를 매 요청마다 스캔한다. 미적용 마이그레이션 파일이 **존재하기만 하면** `ActiveRecord::PendingMigrationError`로 모든 요청이 500이 된다 (로그인·API 전부 막힘).

**Why:** 2026-05-28 회의 진행 중에 desktop@local rename 마이그레이션 파일을 만들었더니, 서버를 건드리지 않았는데도 러닝 puma가 즉시 전 요청 500 → 로그인/회의목록 장애 발생.

**How to apply:** 서버 가동 중(특히 회의 중)에는 `db/migrate/`에 새 마이그레이션 파일을 두지 말 것.
- 당장 migrate 못 하면 파일을 `db/migrate/` 밖(예: `db/migrate_pending/`)에 보관.
- 안전한 시점(회의 종료 후)에 `db/migrate/`로 옮기고 `rails db:migrate` → 재기동 시 `SERVER_MODE=true`.
- 복구: pending 파일을 db/migrate 밖으로 옮기면 다음 요청부터 200 (DB·재기동 불필요).

**역 트랩 — 적용은 했는데 재시작 안 함(컬럼 캐시 stale):** `add_column` 마이그를 **별도 프로세스로 `bin/rails db:migrate` 적용**해도, 그 전에 떠 있던 러닝 puma는 AR 컬럼 캐시가 stale → 새 컬럼을 모름. 사례 2026-06-16: 챗 `suggestions_json` 마이그를 12:13 적용했으나 11:42부터 뜬 puma 미재시작 → 500. **How to apply**: 러닝 dev 서버에 마이그(특히 add_column) 적용했으면 **반드시 puma 재시작**. 마이그 작업 brief에 "적용 후 재시작"까지 명시할 것.

---

### feedback_dev_lan_access

> dev 서버는 항상 다른 PC에서도 접근 가능하게(LAN 노출) 실행

dev 서버 기동 시 항상 다른 PC 브라우저에서도 웹 UI 접근 가능해야 함.

**Why:** 사용자가 같은 LAN의 다른 PC에서 웹 UI를 쓰고 싶어함. localhost 전용이면 다른 PC가 `ERR_CONNECTION_REFUSED`.

**How to apply:** 다른 PC 웹접근 2조건 (둘 다 필요):
1. **vite 0.0.0.0 바인딩** — `frontend/vite.config.ts`에서 `host: process.env.TAURI_DEV_HOST || true`. `false`면 localhost(IPv6 `[::1]`)만 listen → LAN IP는 TCP 거부.
2. **backend CORS에 LAN 프론트 origin** — `http://<LAN_IP>:13325`. `dev.sh`가 기본 인터페이스 LAN IP 자동감지 후 `CORS_ORIGIN`로 주입.

포트: backend(rails)=13323, sidecar(STT)=13324, frontend(vite)=13325.

---

### feedback_tmux_check

> tmux 창 중복 생성 방지

tmux new-window는 명시적으로 요청받은 경우가 아니면 생성하지 말 것. 필요한 경우에도 먼저 `tmux list-windows`로 중복 확인 후 생성한다.

**Why:** 사용자가 직접 관리하는 tmux 세션에 불필요한 창을 만들면 혼란을 초래한다.

**How to apply:** 백그라운드 작업(다운로드, 빌드 등)은 `command > logfile 2>&1 &`로 실행. tmux 창 생성은 사용자가 명시적으로 요청할 때만.

---

### feedback_psmux_windows

> Windows에서 tmux 대안으로 psmux를 추천 (dev-team 팀 모드)

Windows에서 tmux/팀 모드 관련 질문 시 psmux를 안내하라.

**Why:** 사용자가 psmux를 직접 조사 요청하여 확인 완료. tmux 호환 명령어(send-keys, capture-pane, list-panes, split-window 등) 모두 지원. WSL 없이 Windows 네이티브로 동작.

**How to apply:** "Windows에서 팀 모드 되나?" 등 질문 시 psmux(https://github.com/psmux/psmux) 추천. 설치: `winget install psmux`. tmux.exe alias 제공하므로 스킬 코드 수정 거의 불필요.

---

## 참조 (reference)

### reference_sqlite_fk_cascade_migration_wipe

> SQLite 마이그 함정: rename/FK/NOT NULL이 테이블 재생성→DDL트랜잭션 내 PRAGMA foreign_keys=OFF 무효→CASCADE 자식 전멸

SQLite 마이그레이션 자식데이터 전멸 함정 (2026-06-17 프로젝트별 관리 Phase 1에서 실제 사고 — transcripts 23919→0).

**메커니즘:** SQLite에서 `add_foreign_key`/`remove_foreign_key`/`rename_column`/`change_column_null`은 테이블을 **재생성**한다. 마이그는 **DDL 트랜잭션** 안에서 돈다. Rails `alter_table`이 `disable_referential_integrity`(=`PRAGMA foreign_keys=OFF`)로 감싸지만 **트랜잭션 열린 상태에선 이 PRAGMA가 no-op**이라 FK 강제가 켜진 채 DROP 발생 → 자식 테이블 FK가 `ON DELETE CASCADE`면 옛 부모 DROP 시 **자식 전멸**.

**해결:** 재생성 유발 마이그에 `disable_ddl_transaction!` 추가 + 본문을 FK OFF로 감쌈. 트랜잭션이 없어야 `PRAGMA foreign_keys=OFF`가 실제로 먹는다.

**철칙:**
1. 테이블 재생성(rename/FK/NOT NULL) 마이그는 SQLite에서 자식 cascade·set null 위험 → 항상 위 패턴.
2. 마이그 검증은 부모 count만 보지 말고 **자식 테이블(transcripts/summaries/chat) + FK 컬럼(folder_id) count도 백업 대비 전수 비교**.
3. 실DB 마이그 전 **백업 + 복사본 선행테스트**.

---

### reference_sqlite_like_escape

> SQLite LIKE는 기본 ESCAPE 문자가 없어 Rails sanitize_sql_like만으로는 %/_ 포함 검색어가 오동작

ddobakddobak 백엔드(SQLite)에서 `sanitize_sql_like(q)`는 `%`·`_`·`\`를 백슬래시로 이스케이프하지만, SQLite LIKE는 **기본 ESCAPE 문자가 없어** 그 백슬래시를 리터럴로 매치한다 → `100%` 검색이 false negative/positive.

**해결**: 모든 LIKE에 `ESCAPE '\'` 명시. 예: `where("title LIKE ? ESCAPE '\\'", "%#{sanitize_sql_like(q)}%")`. Meeting.search / search_with_summary는 2026-06-12 수정 완료 — 새 LIKE 검색 추가 시 같은 패턴 적용할 것.

---

### reference_tauri_window_confirm_nonblocking

> Tauri WKWebView window.confirm/alert는 non-blocking → 응답 전 후속코드 실행(Cancel 눌러도 이미 삭제)

Tauri(macOS WKWebView)에서 동기 `window.confirm()`/`alert()`는 **블로킹되지 않음**. 즉시 반환(truthy) → 후속 삭제 코드가 먼저 실행되고, 그 다음에야 네이티브 다이얼로그가 뜬다. 증상: "Cancel 눌러도 이미 휴지통으로 이동/삭제됨".

**해결:** 플랫폼 분기 헬퍼 `frontend/src/lib/confirmDialog.ts`
```ts
if (IS_TAURI) { const { confirm } = await import('@tauri-apps/plugin-dialog'); return confirm(msg, opts) }
return window.confirm(msg)
```
호출부는 반드시 `await confirmDialog(...)`. 기존 정답 사례 = `MeetingsPage.tsx` handleDeleteMeeting(IS_TAURI 분기). 웹은 window.confirm fallback 정상.

적용처: 모든 파괴적 확인(삭제·영구삭제·휴지통비우기).

---

### reference_frontend_real_typecheck

> frontend 진짜 타입체크는 tsc -p tsconfig.app.json (bare tsc --noEmit는 거짓 green)

ddobakddobak `frontend/` 타입체크 함정: **`npx tsc --noEmit`(루트 tsconfig)는 0개 파일을 검사**해 항상 "No errors found"를 낸다 — 루트 `tsconfig.json`이 `"files": []` + project references라, `--build` 아닌 평이한 `tsc`는 references를 안 따라가기 때문. **거짓 green이므로 타입검증 게이트로 쓰면 안 된다.**

**진짜 타입체크:**
```bash
cd frontend && npx tsc -p tsconfig.app.json --noEmit   # 실제 src 전체 검사
```

기준선: 이 명령은 **~24개 사전존재 에러**(거의 테스트파일)를 낸다. 게이트는 "**내가 만진 파일에 신규 에러 0**"으로 잡는다.

---

### reference_rails_user_namespace_trap

> Rails 컨트롤러가 Api::V1::User 모듈 안에 있으면 bare User가 모델이 아닌 그 모듈로 해석됨

또박또박 백엔드에는 `Api::V1::User` **모듈**이 존재한다 (`namespace :user` → `app/controllers/api/v1/user/*`).

**함정:** 그 모듈 네임스페이스 안 컨트롤러에서 bare 상수 `User`를 쓰면 Ruby 상수 조회가 `Api::V1::User`(모듈)로 먼저 해석되어 `User` **모델**이 아니다.

**규칙:** 이 영역 컨트롤러에서 User 모델을 참조할 땐 항상 `::User`(최상위)로 쓴다.

---

### reference_android_build

> Tauri 안드로이드 빌드 환경/명령 (JAVA_HOME/ANDROID_HOME/NDK 경로 + 빌드·설치 명령)

Tauri 안드로이드 빌드 (macOS, 환경변수는 `~/.zshrc`에 영구 설정됨):
- `JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home` — JDK17 필요
- `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools` (cask `android-commandlinetools`)
- `NDK_HOME=$ANDROID_HOME/ndk/26.1.10909125`, platform android-34, build-tools 34.0.0
- rustup android 타깃 4개 설치됨

**명령** (`frontend/`에서):
- APK 빌드: `npm run tauri android build -- --debug --target aarch64`
- 실기기 dev: `npm run tauri android dev` (단, dev는 비secure origin이라 **마이크 차단**)
- 설치: `adb install -r <apk>`, 실행: `adb shell monkey -p com.ddobakddobak.app -c android.intent.category.LAUNCHER 1`

**에뮬레이터:**
- AVD: **`ddobak_pixel7_api34`** (Pixel 7, Android 14).
- 실행: `$ANDROID_HOME/emulator/emulator -avd ddobak_pixel7_api34 -no-snapshot-load`.

---

### reference_android_release

> 안드로이드 릴리즈 APK 서명 키스토어 (분실 시 기존 설치 업데이트 불가)

또박또박 Android **릴리즈(배포) APK 서명** (2026-05-27 생성):
- 키스토어: `frontend/src-tauri/ddobak-release.jks` (gitignore됨 — 백업 필수)
- alias: `ddobak`, store/key 비밀번호: 사용자가 변경함(기록 안 함 — 빌드 시 사용자에게 문의)

**릴리즈 빌드** (`frontend/`에서):
- `npm run tauri android build -- --apk --target aarch64`
- 출력: `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk` (~20MB)
- 설치: debug와 **다른 키**라 기존 debug앱 위 덮어쓰기 불가 → 최초 1회 `adb uninstall com.ddobakddobak.app` 후 `adb install`.

---

### reference_android_emulator_arm64

> 온디바이스 STT 에뮬 테스트 = arm64-v8a AVD (Apple Silicon 네이티브)

온디바이스 STT(sherpa .so) Android 에뮬 검증 환경. 이 맥은 Apple Silicon(`/opt/homebrew`).

- sherpa/onnxruntime `.so`는 4 ABI 다 있으나, 플랜은 arm64-v8a만 vendoring.
- **에뮬도 arm64-v8a 시스템이미지 써야 .so 로드됨** (Apple Silicon라 arm64 게스트가 네이티브 실행).
- 설치된 AVD 2개: `ddobak_pixel7_api34`, `stt_arm64_api34`.

---

### reference_android_tauri_cmd_cdp

> 에뮬/기기서 Tauri 커맨드 호출 = CDP로 window.__TAURI_INTERNALS__.invoke

또박또박 Android 앱(Tauri v2)서 Rust 커맨드를 외부에서 호출해 검증하는 법.

- `window.__TAURI__`는 **없음** (withGlobalTauri 미설정). 대신 `window.__TAURI_INTERNALS__.invoke(cmd, args)`가 함수로 노출됨.
- WebView devtools 소켓: 앱 실행 후 `@webview_devtools_remote_<pid>` (`adb shell cat /proc/net/unix | grep webview_devtools`).
- node(v22+) 내장 global WebSocket으로 CDP `Runtime.evaluate`(awaitPromise:true)에 `__TAURI_INTERNALS__.invoke(...)` eval.
- 클라 스크립트: /tmp/cdp_invoke.mjs.

---

### reference_android_cors_origin

> 안드로이드 설치앱이 서버 연결 실패("연결 불가") 1순위 = CORS에 http://tauri.localhost 누락

또박또박 **Android 설치형 APK가 LAN 서버에 "연결 불가"** 1순위 원인 = **CORS 오리진 누락** (2026-05-27 확정 진단).

**메커니즘:**
- Tauri 안드로이드 WebView 오리진 = **`http://tauri.localhost`** (Tauri 기본 `use_https_scheme: false`).
- 모든 API는 webview `fetch()` → **CORS 적용**. 서버가 `http://tauri.localhost`를 허용 안 하면 ACAO 헤더 없어 fetch가 TypeError로 거부.
- **"서버 찾기"(`scan_lan_servers`)는 Rust raw 소켓**이라 CORS 무관 → IP는 잘 찾음. 그래서 증상이 "IP는 찾아오는데 선택하면 연결 불가".

**수정:** `backend/config/initializers/cors.rb`의 `allowed_origins`에 `"http://tauri.localhost"` 추가 후 Rails 재기동. **APK 재빌드 불필요.**

---

### reference_android_debug_apk_whitescreen

> debug APK 흰 화면 = cargo 캐시가 옛 dev 세션의 stale dev-host IP 박힌 .so 재사용

또박또박 안드로이드 **debug APK 흰 화면** 함정 (2026-05-29 디버깅).

**증상:** `npm run tauri android build -- --debug --target aarch64`로 만든 APK 설치·실행 시 webview가 흰 화면. logcat에 `E tauri::protocol::tauri: Failed to request http://<옛IP>:13325/`.

**원인:** 빌드 로그에 `Finished \`dev\` profile ... in 0.5s` = **cargo 캐시 히트**. 소스 변경이 없으면 `libapp_lib.so`를 재컴파일하지 않고, 과거 `tauri android dev` 세션이 만든 .so를 재사용한다. 그 .so엔 dev 당시 감지된 LAN dev-host IP가 박혀 있어, debug 빌드가 그 죽은 IP의 vite dev 서버(13325)를 메인 프레임으로 로드하려다 실패.

**대응:**
- 검증·배포엔 **release APK** 사용: `npm run tauri android build -- --apk --target aarch64`
- debug가 꼭 필요하면 빌드 전 `cargo clean`으로 .so 강제 재컴파일.

---

### reference_caddy_http3_lan_timeout

> 포트프리 caddy 3함정: LAN 회의열기 타임아웃(h3/UDP차단), 캐시된 alt-svc h3, localhost 연결거부(IPv6 ::1 미listen)

또박또박 맥 dev를 caddy 포트프리(443)로 돌릴 때 나온 3연쇄 함정 (2026-07-18 base Caddyfile+dev.sh 에 durable 반영).

**증상1 — LAN 다른 PC서 로그인은 되는데 회의열기 등 이후요청만 "Request timed out".** 원인=caddy가 `alt-svc: h3=":443"` 광고→브라우저가 첫응답(TCP) 후 HTTP/3(QUIC UDP443)로 전환→회사망이 UDP443 차단.

**증상2 — h3 끈 뒤 이미 캐시한 브라우저가 없어진 UDP443로 붙어 실패.**

**증상3 — `https://localhost/` "사이트에 연결할 수 없음"인데 curl은 200.** 원인=`localhost`가 IPv6 `::1` 먼저 해석되는데 caddy 주소목록에 `[::1]` 없어 ::1:443 미listen.

**durable 수정:**
```
{ auto_https off
  servers { protocols h1 h2 } }          # h3 off
https://localhost:P, https://127.0.0.1:P, https://[::1]:P, https://<ip>:P {
  tls ...
  header Alt-Svc clear                    # 캐시된 대체프로토콜 능동 evict
  ... }
```

**현재분 반영**=`caddy reload --config Caddyfile.local --adapter caddyfile`(admin API localhost:2019라 root caddy여도 **sudo 불필요**).

---

### reference_caddy_auth_route

> 웹 로그인 404 1순위 = Caddyfile @backend matcher에 /auth/* 누락

웹(Caddy LAN HTTPS 단일 origin)에서 로그인 POST가 404 나면 1순위 원인: `Caddyfile`의 `@backend path` matcher에 `/auth/*`가 빠진 것.

로그인/리프레시/로그아웃은 `/api`가 아니라 `/auth/*`다. matcher가 `/api/* /cable*`만 Rails(13323)로 보내면 `/auth/login`은 Vite(13325)로 폴백 → Vite에 라우트 없어 404.

**수정**: `@backend path /api/* /auth/* /cable*` → `caddy reload --config Caddyfile`. 검증: `curl -sk -X POST https://<ip>:13443/auth/login -d '{...bad...}'` → 401(=Rails 도달)이면 OK, 404면 여전히 Vite.

---

### reference_lmstudio_cors_modellist

> LM Studio 모델 자동목록 비면 1순위 = LM Studio CORS 꺼짐 (lms server start --cors)

ddobak LLM 설정 패널(LlmSettingsPanel)에서 **LM Studio** 선택 후 "모델 새로고침" 눌러도 모델이 **안 뜨면** 1순위 원인 = **LM Studio 서버 CORS 미설정**.

- 모델목록 fetch(`fetchLmStudioModels` → `GET http://localhost:1234/v1/models`)는 **브라우저(클라이언트)**에서 cross-origin 호출. ddobak은 HTTPS(`localhost:13443` Caddy). LM Studio가 `Access-Control-Allow-Origin` 미반환 → fetch가 `[]` 반환.
- **Ollama는 됨**: Ollama 기본값이 localhost origin CORS 허용. LM Studio는 기본 CORS **꺼짐**.

**해결**: `~/.lmstudio/bin/lms server start --cors`. 확인: `curl -sI -H "Origin: https://localhost:13443" http://localhost:1234/v1/models` → `Access-Control-Allow-Origin: *`.

**중요 구분**: 자동목록이 비어도 **챗 추론 자체는 작동** — 실제 호출은 Rails 백엔드가 **서버사이드**로 하므로 CORS 무관. 목록 비면 모델 id(예: `google/gemma-4-e2b`) 직접 입력하면 챗 됨.

---

### reference_zeitwerk_new_concern_restart

> 러닝 dev 서버에 새 autoload 루트(app/jobs/concerns 등) 추가 시 NameError → 서버 재시작 필수

새 concern 파일을 **그 폴더가 처음 생기는** 경로(예: `app/jobs/concerns/pcm_convertible.rb`)에 만들면, **이미 떠 있는 dev rails 서버**는 그 모듈을 못 찾아 `NameError` → 해당 잡/컨트롤러 로드 실패한다. Zeitwerk autoload 루트 목록은 **부팅 시점에 고정**되고, 부팅 후 새로 생긴 루트 디렉터리는 코드 리로드로도 등록 안 됨.

**증상 사례(2026-06-14)**: `ReDiarizeJob`이 `include PcmConvertible` → 러닝 서버서 NameError → 회의 영구 transcribing 정지. 근데 `bin/rails runner`(=새 프로세스)로는 멀쩡히 동작 → "코드는 맞는데 러닝 서버만 깨짐"으로 오진하기 쉬움.

**진단 신호**: 같은 코드가 `rails runner`/테스트선 통과하는데 러닝 서버서만 실패 → autoload 루트 staleness 의심. `log/development.log`서 `uninitialized constant` 확인.

**해결 = 서버 재시작**. 기존 폴더에 파일 추가는 리로드로 잡힘 — 문제는 **루트 디렉터리 자체가 새로 생길 때만**.

---

## 인덱스

- [feedback_always_subagent_execution.md](feedback_always_subagent_execution.md) - 구현 실행은 무조건 서브에이전트 방식(subagent-driven), 필요시 Workflow 병용
- [feedback_model_tiering.md](feedback_model_tiering.md) - 서브에이전트 3단: 간단조사=haiku·코딩=sonnet·설계/오케스트레이션=세션 최상위
- [feedback_no_auto_commit.md](feedback_no_auto_commit.md) - 명시적 요청 없이 커밋/푸시 금지
- [feedback_full_compile_verify.md](feedback_full_compile_verify.md) - 변수/스토어 필드 제거 시 편집 파일 포함 전수 grep+vite build로 검증
- [feedback_rails_pending_migration_trap.md](feedback_rails_pending_migration_trap.md) - db/migrate에 마이그 파일 추가만 해도 러닝 Rails dev 전 요청 500
- [feedback_dev_lan_access.md](feedback_dev_lan_access.md) - dev 서버 항상 LAN 노출. vite host:true+dev.sh가 LAN IP 자동감지→CORS_ORIGIN 주입
- [feedback_tmux_check.md](feedback_tmux_check.md) - tmux 창 생성 전 기존 창 중복 확인 필수
- [feedback_psmux_windows.md](feedback_psmux_windows.md) - Windows에서 tmux 대안으로 psmux 추천
- [reference_sqlite_fk_cascade_migration_wipe.md](reference_sqlite_fk_cascade_migration_wipe.md) - SQLite 마이그 함정: rename/FK/NOT NULL 테이블재생성→CASCADE 자식전멸
- [reference_sqlite_like_escape.md](reference_sqlite_like_escape.md) - SQLite LIKE: sanitize_sql_like만으론 %/_ 검색 깨짐, ESCAPE '\\' 필수
- [reference_tauri_window_confirm_nonblocking.md](reference_tauri_window_confirm_nonblocking.md) - Tauri WKWebView window.confirm non-blocking→Cancel눌러도 이미삭제
- [reference_frontend_real_typecheck.md](reference_frontend_real_typecheck.md) - frontend 진짜 타입체크=tsc -p tsconfig.app.json
- [reference_rails_user_namespace_trap.md](reference_rails_user_namespace_trap.md) - Api::V1::* 컨트롤러에서 bare User는 모듈로 해석→::User 필수
- [reference_android_build.md](reference_android_build.md) - Tauri 안드로이드 빌드 환경/명령
- [reference_android_release.md](reference_android_release.md) - 안드로이드 릴리즈 APK 서명 키스토어
- [reference_android_emulator_arm64.md](reference_android_emulator_arm64.md) - 온디바이스 STT 에뮬=arm64-v8a AVD
- [reference_android_tauri_cmd_cdp.md](reference_android_tauri_cmd_cdp.md) - 에뮬/기기서 Tauri 커맨드=CDP로 window.__TAURI_INTERNALS__.invoke
- [reference_android_cors_origin.md](reference_android_cors_origin.md) - 안드로이드 "연결 불가" 1순위=CORS에 http://tauri.localhost 누락
- [reference_android_debug_apk_whitescreen.md](reference_android_debug_apk_whitescreen.md) - debug APK 흰 화면=cargo 캐시가 옛 dev IP 박힌 .so 재사용
- [reference_caddy_http3_lan_timeout.md](reference_caddy_http3_lan_timeout.md) - 포트프리 caddy 3함정: LAN 회의열기 타임아웃(h3/UDP차단)·alt-svc 캐시·localhost IPv6
- [reference_caddy_auth_route.md](reference_caddy_auth_route.md) - 웹 로그인 404 1순위=Caddyfile @backend matcher에 /auth/* 누락
- [reference_lmstudio_cors_modellist.md](reference_lmstudio_cors_modellist.md) - LM Studio 모델 자동목록 비면 1순위=CORS 꺼짐
- [reference_zeitwerk_new_concern_restart.md](reference_zeitwerk_new_concern_restart.md) - 새 autoload 루트(app/jobs/concerns 첫 생성) 추가 시 러닝 dev서버 NameError→재시작 필수

---

> 다른 컴퓨터 복원법: 이 문서를 Claude Code에게 주고 '메모리 디렉토리에 복원해줘'라고 요청.
