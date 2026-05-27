# app-server.sh — 앱(production) 서버 환경 재현 스크립트 설계

- 작성일: 2026-05-27
- 상태: 설계 확정 (Approach A + `--sync`)

## 배경

또박또박의 백엔드(Rails + Sidecar) 기동 로직이 두 군데에 존재한다.

- `dev.sh`: tmux 세션 `ddobak`에 **개발 모드**(RAILS_ENV 미지정 = development, 프로젝트 소스 `backend/`·`sidecar/`)로 Rails(13323)·Sidecar(13324)를 띄우고, 현재 터미널에서 `npm run tauri:dev` 실행.
- `frontend/src-tauri/src/lib.rs`의 `start_services`: Tauri 앱이 **production 모드**로, `~/Library/Application Support/com.ddobakddobak.app/`(이하 app_data)에 복사된 소스를 실행. DB/audio/models/speaker_dbs/.env/config.yaml 모두 app_data 안에 있음.

터미널에서 "앱이 실제로 돌리는 서버 환경"을 그대로 재현·디버깅할 수단이 없다. dev.sh는 개발 모드라 데이터·설정·동작이 앱과 다르다.

## 목표

`dev.sh`는 그대로 두고, **앱과 동일한 production 서버 환경을 터미널에서 기동**하는 별도 스크립트 `app-server.sh`를 추가한다. 서버 전용(프론트엔드는 띄우지 않음).

## 접근 방식: A (app_data 소스 그대로 실행) + `--sync`

앱이 실행하는 것과 **완전히 동일한** 환경을 재현하기 위해 app_data에 복사된 소스에서 기동한다.

- Sidecar는 cwd 기준 `../.env`를 읽으므로 `app_data/sidecar`에서 실행하면 `app_data/.env`·DB가 상대경로로 자동 연결된다. 환경변수 배선이 최소화된다.
- 단점(소스가 앱 마지막 셋업 시점 복사본): `--sync` 플래그로 프로젝트 소스를 app_data로 다시 복사한 뒤 의존성을 재설치하여 **현재 코드**를 앱 환경에서 테스트할 수 있게 한다.

## 동작 명세

`lib.rs`의 `start_services`가 설정하는 환경을 그대로 맞춘다.

### 경로 (모두 app_data 기준, env로 override 가능)

- `APP_DATA_DIR` 기본값: `~/Library/Application Support/com.ddobakddobak.app`
- `BACKEND_DIR=$APP_DATA_DIR/backend`, `SIDECAR_DIR=$APP_DATA_DIR/sidecar`
- `DB_PATH=$APP_DATA_DIR/db/production.sqlite3`
- `AUDIO_DIR=$APP_DATA_DIR/audio`, `MODELS_DIR=$APP_DATA_DIR/models`, `SPEAKER_DBS_DIR=$APP_DATA_DIR/speaker_dbs`

### 기동 명령 (앱과 동일)

- Rails (cwd=`$BACKEND_DIR`):
  `RAILS_ENV=production DB_PATH=… AUDIO_DIR=… RAILS_LOG_TO_STDOUT=1 SOLID_QUEUE_IN_PUMA=1 bin/rails server -p 13323 -b 127.0.0.1`
- Sidecar (cwd=`$SIDECAR_DIR`):
  `MODELS_DIR=… SPEAKER_DBS_DIR=… uv run uvicorn app.main:app --host 127.0.0.1 --port 13324`
- 포트(`RAILS_PORT`/`SIDECAR_PORT`), 바인드(`HOST_BIND`, 기본 `127.0.0.1`)는 env로 override 가능.

### tmux

- 세션명 `ddobak-app` (dev.sh의 `ddobak`와 분리 → 충돌·중복 방지).
- `rails`·`sidecar` 두 윈도우. 기존 세션 있으면 재사용.

### 서브커맨드

- `up` (기본): 서버 기동.
- `--sync` (플래그, `up`과 조합): 프로젝트 소스(`backend/`,`sidecar/`,`config.yaml`)를 app_data로 rsync(삭제 없음, tmp/log/storage/.venv/node_modules/.git 제외) → `bundle install` + `uv sync --extra=macos` → 기동.
- `attach`: tmux 세션 attach.
- `down`: tmux 세션 종료.
- `status`: 13323/13324 포트 및 `/api/v1/health` 확인.
- `help`.

### 가드

- `$DB_PATH` 또는 `$BACKEND_DIR/Gemfile`이 없으면 "앱을 한 번 실행해 초기 셋업(SetupGate)을 완료한 뒤 사용하라"고 안내 후 종료. (`--sync`는 소스는 복사하지만 DB는 생성하지 않으므로 DB 부재 시 동일하게 안내.)
- 포트 점유 가드: 13323/13324 중 하나라도 이미 열려 있으면(앱 또는 dev.sh 실행 중) 충돌을 피하기 위해 중단하고 기존 서버 종료를 안내.
- tmux 미설치 시 안내 후 종료.

## 비목표 (YAGNI)

- 프론트엔드(Tauri/브라우저) 기동 — 서버 환경 재현이 목적.
- DB 생성/마이그레이션 — 앱 셋업이 담당. 스크립트는 기존 app_data DB를 전제.
- macOS 외 OS 경로 — 데스크톱 앱은 macOS 중심. `APP_DATA_DIR` override로 우회 가능.
