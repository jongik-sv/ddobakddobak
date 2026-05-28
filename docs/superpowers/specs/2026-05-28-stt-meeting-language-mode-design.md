# STT 회의 언어 모드 (단일 고정 / 다국어 자동감지+필터) 설계

- 작성일: 2026-05-28
- 상태: 설계 승인됨

## 배경 / 문제

한국어 회의인데도 트랜스크립트에 중국어·일본어·힌디어 등 엉뚱한 언어가 섞여 나옴.

근본 원인: **언어 코드 포맷 불일치 + 자동감지 폴백**.

- 회의 언어 설정값은 ISO 코드(`ko`,`en`,`ja`,`zh`...)로 저장됨 (`config.yaml` LANGUAGES).
- Qwen3-ASR은 언어 지정 시 **영어 풀네임**(`Korean`,`Chinese`...)을 기대함 (모델 `support_languages`).
- 현재 Qwen 어댑터는 ISO 코드 `"ko"`를 그대로 전달 → mlx 내부 매칭 실패(`supported_lower.get("ko","ko")`) → 프리필 `language ko<asr_text>`가 무효 → **사실상 자동감지로 폴백** → 무음/잡음/짧은 청크에서 다른 언어 환각.
- 또한 어댑터들은 언어 2개 이상 선택 시 `language=None`(전체 자동감지)으로 처리 → 선택 언어로 제한 안 됨.

관련 코드:
- `sidecar/app/stt/qwen3_adapter.py:65,87` — ISO 코드 그대로 전달
- `sidecar/app/stt/qwen3_transformers_adapter.py:141,170,195` — `language=None` 하드코딩
- `sidecar/app/stt/whisper_adapter.py:70` / `faster_whisper_adapter.py:79,116` — 단일이면 ISO 강제(정상), 다국어면 None
- mlx 메커니즘: `qwen3_asr.py:877-885`(프리필 강제), `1167-1196`(자동감지 시 감지언어 출력)

엔진별 기대 포맷:
| 엔진 | 기대 | 비고 |
|---|---|---|
| whisper_cpp (pywhispercpp) | ISO + `auto` | 정상 |
| faster_whisper | ISO + `None` | 정상 |
| qwen3 (mlx/transformers) | 영어 풀네임 + `None` | **현재 깨짐** |

## 목표

회의 언어 설정을 두 모드로 제공:

1. **단일 언어 (정확)** — 한 언어로 디코딩 강제. 환각 제거. (기본: 한국어)
2. **다국어 자동감지** — 자동감지 후, 감지 언어가 선택 목록에 없는 세그먼트는 버림(필터).

비목표(YAGNI): 회의별 언어 저장(전역 설정 유지), 엔진 레벨 다국어 화이트리스트(엔진 미지원, 후처리로 우회).

## 설계

### 1. 데이터 / 설정 모델

- sidecar 공용 모듈에 ISO↔Qwen 풀네임 매핑 상수 추가.
- 설정 저장에 `language_mode: "single" | "multi"` 추가 (settings.yaml + ENV `LANGUAGE_MODE`). 기존 `SELECTED_LANGUAGES` 유지.
- 기본값: `single` + `ko` (한국어 회의 환각 제거 최우선이라 안전 기본).
- 범위: 전역 설정 (회의별 아님).

### 2. 설정 UI (`frontend/src/components/settings/SettingsContent.tsx`)

```
회의 언어
( ) 단일 언어 (정확)     ← 권장
    [ 한국어 ▼ ]          (드롭다운, single 선택 시만 노출)
( ) 다국어 자동감지
    [✓ 한국어] [✓ English] [ 日本語] ...  (체크박스, multi 선택 시만 노출)

ℹ️ 한국어로만 진행하는 회의는 '단일 언어(한국어)'를 선택하면 인식 정확도가
   더 높습니다. 다국어 모드는 다른 언어가 섞여 인식될 수 있습니다.
```
- 안내 문구 상시 표시.
- 모드 전환에 따라 드롭다운/체크박스 조건부 렌더.

### 3. 데이터 흐름

```
프론트(mode + languages)
  → 실시간: ActionCable payload에 mode 추가
            → TranscriptionChannel → TranscriptionJob → SidecarClient#transcribe(mode, languages)
  → 파일:   FileTranscriptionJob → ENV LANGUAGE_MODE + SELECTED_LANGUAGES 읽음
            → SidecarClient#transcribe_file(mode, languages)
  → sidecar main.py → adapter.transcribe(languages, mode)
```

### 4. sidecar 엔진 로직 (핵심)

공용 헬퍼 `sidecar/app/stt/lang_utils.py` 신규:
```python
ISO_TO_QWEN = {"ko":"Korean","en":"English","ja":"Japanese","zh":"Chinese",
               "es":"Spanish","fr":"French","de":"German","th":"Thai","vi":"Vietnamese"}
QWEN_TO_ISO = {v: k for k, v in ISO_TO_QWEN.items()}

def resolve_engine_lang(mode, languages, engine) -> str | None:
    # single → 강제할 언어값(engine별 포맷) / multi → None
def allowed_iso_set(languages) -> set[str]:
    # 필터용 허용 ISO 집합
def is_filtered(detected_lang_label, allowed_iso) -> bool:
    # 감지언어(풀네임 or ISO) → ISO 정규화 후 allowed에 없으면 True(버림)
```

어댑터별 적용:
| 엔진 | single 모드 | multi 모드 |
|---|---|---|
| qwen3 (mlx) | `language="Korean"`(풀네임) 강제 | `language=None` + 세그먼트 `.language`(풀네임)→ISO 필터 |
| qwen3 (transformers) | 풀네임 강제 (`None` 하드코딩 제거) | `None` + 감지언어 필터 |
| whisper_cpp | `language="ko"`(ISO) 강제 | `language="auto"` + 감지언어 필터 |
| faster_whisper | `language="ko"` 강제 | `None` + `info.language` 필터 |

- 필터는 multi 모드에서만 동작.
- qwen mlx는 자동감지 시 `STTOutput.segments[].language`에 감지언어(풀네임) 들어옴 → 캡처해서 필터.

### 5. 엣지 / 에러 처리

- multi 필터가 모든 세그먼트를 버릴 수 있음(짧은 한국어가 타 언어로 오인식 → 드롭 → 실제 발화 손실). multi 모드의 알려진 트레이드오프. 안내 문구로 커버.
- whisper 감지언어 캡처: faster_whisper=`info.language` 사용 가능 / pywhispercpp=detected 추출 추가 필요. 미지원 시 필터 skip(자동감지 그대로) + 경고 로그.
- 매핑에 없는 언어 코드 → 안전 폴백: single이면 ISO 그대로 전달, multi 필터는 통과시킴(버리지 않음).
- 하위호환: `LANGUAGE_MODE` 미설정 시 `single`로 간주(기본 ko).

### 6. 테스트

- `lang_utils` 단위테스트: 매핑 양방향, `resolve_engine_lang`(엔진별), `is_filtered`(정규화/허용집합).
- 어댑터: single→강제 언어값 전달 확인, multi→감지언어 섞은 mock 세그먼트로 필터 동작 확인.
- 기존 STT 스펙 회귀 통과.

## 영향 파일 (예상)

- 신규: `sidecar/app/stt/lang_utils.py` (+ 테스트)
- 수정: `sidecar/app/stt/qwen3_adapter.py`, `qwen3_transformers_adapter.py`, `whisper_adapter.py`, `faster_whisper_adapter.py`, `sidecar/app/main.py`
- 수정: `backend/app/services/sidecar_client.rb`, `backend/app/jobs/transcription_job.rb`, `file_transcription_job.rb`, `backend/app/channels/transcription_channel.rb`, `backend/app/controllers/api/v1/settings_controller.rb`
- 수정: `frontend/src/components/settings/SettingsContent.tsx`, `frontend/src/stores/appSettingsStore.ts`, `frontend/src/api/settings.ts`, `frontend/src/channels/transcription.ts`, `frontend/src/hooks/useTranscription.ts`
- 수정: `config.yaml` (필요 시 풀네임 매핑/문구)
