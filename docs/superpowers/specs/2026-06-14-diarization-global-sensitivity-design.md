# 화자 구분 민감도 전역 설정화 — 설계

> 2026-06-14 · 브랜치 TBD(feat/diarization-global-sensitivity 예정)
> 선행: `2026-06-14-diarization-split-merge-design.md` (threshold 0.3 도입)

## 목표

화자 구분 민감도(AHC threshold)를 **전역 설정 1곳**(설정 모달 `DiarizationPanel`)에서 조정. **회의별(per-meeting) 슬라이더 제거.** 모든 회의가 동일 전역 민감도 사용.

## 핵심 통찰

- 기존 `appSettingsStore.diarizationOverrides` 플러밍이 이미 `clustering_threshold`를 settings.yaml로 왕복 저장(`updateAppSettings`→`PUT settings/app`→`SettingsController#update_app_settings`→settings.yaml; `loadAppSettings`←`GET settings/app`). **ahc_threshold를 같은 경로에 추가만** 하면 됨.
- 백엔드 잡(`file_transcription_job`, `re_diarize_job`)은 **이미** `AppSettings.diarization_config["ahc_threshold"]`(=settings.yaml)를 폴백으로 읽음. per-meeting 오버라이드만 제거하면 **자동으로 전역값 사용** — 새 백엔드 로직 불필요.
- 부수효과: 전역값을 UI로 settings.yaml에 기록 → 이전의 "settings.yaml gitignored=수동 배포" 함정 **해소**(인스턴스마다 화면에서 설정).

## A. 전역 민감도 추가 (기존 패턴 미러링)

1. `frontend/src/config.ts`: `DIARIZATION_DEFAULTS.ahc_threshold = 0.3` 존재 확인/추가, `DiarizationConfig` 타입에 `ahc_threshold: number`.
2. `frontend/src/api/settings.ts`: `AppSettings`에 `diarization_ahc_threshold?: number`.
3. `frontend/src/stores/appSettingsStore.ts`:
   - `debouncedSave` `diarKeys`에 `'ahc_threshold'` 추가(override 있으면 그 값, 없으면 `DIARIZATION_DEFAULTS.ahc_threshold` 전송 — clustering_threshold와 동일 처리).
   - `loadAppSettings` `diarMap`에 `diarization_ahc_threshold: 'ahc_threshold'`.
4. `backend/app/controllers/api/v1/settings_controller.rb`:
   - `app_settings`(GET, ~203): `result["diarization_ahc_threshold"] = diar["ahc_threshold"] if diar["ahc_threshold"]`.
   - `update_app_settings`(PUT, ~234 옆): `if params.key?(:diarization_ahc_threshold); cfg["diarization"] ||= {}; cfg["diarization"]["ahc_threshold"] = params[:diarization_ahc_threshold].to_f.clamp(0.2, 0.8); end`.
5. `frontend/src/components/settings/DiarizationPanel.tsx`: enable 토글 아래 `SettingSlider` 추가.
   - label "화자 구분 민감도", value=`diarizationOverrides.ahc_threshold ?? DIARIZATION_DEFAULTS.ahc_threshold`, defaultValue=`DIARIZATION_DEFAULTS.ahc_threshold`, min 0.2 max 0.8 step 0.1, onChange=`setDiarizationOverride('ahc_threshold', v)`.
   - 설명: "낮을수록 화자를 더 많이 나눕니다. 여러 명이 한 화자로 뭉치면 값을 낮추세요. 파일 업로드·STT 재생성·'화자분리만 재실행' 시 적용됩니다."
   - diarization 비활성 시 비활성화(`opacity-50 pointer-events-none`) — enable 토글 영역과 일관.

## B. per-meeting 제거

6. `frontend/src/components/meeting/EditMeetingDialog.tsx`: "화자 구분 민감도" 슬라이더 블록(현 140-168) + `diarizationThreshold` state/setter + PATCH payload의 `diarization_threshold` 전송 제거. (참여 인원 입력은 유지.)
7. 백엔드 per-meeting 오버라이드 제거:
   - `file_transcription_job.rb:24-25`, `re_diarize_job.rb:28-29`: `if meeting.diarization_threshold.present? ... end` 제거 → `diarization_config["ahc_threshold"]`는 AppSettings 전역값 그대로.
   - `meetings_controller.rb:120`: `diarization_threshold` param 수용 제거.
   - `meeting_serializable.rb:30`: 응답에서 `diarization_threshold` 제거.
   - `meeting.rb:29`: `diarization_threshold` numericality validation 제거.

## DB 컬럼 (결정: 유지)

`meetings.diarization_threshold` 컬럼 = **유지(미사용)**. 마이그레이션 위험 0, 되돌리기 쉬움. dead column 1개 허용. (후속 정리 마이그레이션은 선택.)

## 검증

- frontend tsc 0 + 관련 vitest(DiarizationPanel/SettingsModal/EditMeetingDialog/SettingsContent).
- backend rspec: settings_controller(있으면), meetings_controller, jobs 관련 spec.
- 데이터레이어: `PUT settings/app {diarization_ahc_threshold: 0.5}` → settings.yaml `diarization.ahc_threshold == 0.5` → `AppSettings.diarization_config["ahc_threshold"] == 0.5` → `ReDiarizeJob`가 그 값 사용.
- 수동: 설정 모달 슬라이더 변경 → settings.yaml 반영 → 회의 재실행 시 전역값. EditMeetingDialog에 민감도 슬라이더 없음 확인.

## 함정

- settings.yaml gitignored (런타임 설정) — UI 기록은 인스턴스 로컬. 정상(의도).
- clamp 범위 0.2~0.8(슬라이더와 일치). meeting validation(0.1~1.0)은 제거되므로 무관.
- SettingsController가 새 autoload 루트 아님 → rails 재시작 불필요(기존 파일 편집).
