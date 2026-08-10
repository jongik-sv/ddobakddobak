# KURE 임베딩 인코더 유휴 언로드 설계

작성일: 2026-08-10
대상: `sidecar/app/embeddings/encoder.py`, `sidecar/app/stt/idle_offload.py`(재사용), `sidecar/app/main.py`, `sidecar/app/routers/embeddings.py`

## 배경

STT 어댑터(Qwen3-ASR, faster-whisper)는 `IdleOffloadController`로 유휴 시 GPU→CPU→완전 해제 2단계 오프로드를 수행한다. 반면 KURE 임베딩 인코더(`nlpai-lab/KURE-v1`)는 첫 `/embed` 호출 시 로드된 뒤 프로세스 수명 내내 상주한다. 해제 경로 자체가 없다.

측정값(2026-08-10, RTX 5000 Ada 32GB):

- 사이드카 프로세스 RSS 4.98GB, WSL GPU 점유 4.8GB
- `/embed` 호출 빈도: 하루 11회. 09:00에 1건, 09:56에 10건 — 버스트형
- KURE 콜드 로드 8초 (로그 09:00:35 → 09:00:43)

하루 11번 쓰는 모델이 GPU와 RAM을 24시간 점유한다. 버스트형이므로 재로드 비용은 버스트당 1회만 발생하고, 대부분 백그라운드 잡(`EmbedBackfillJob`) 안에서 소비되어 사용자 체감 경로가 아니다.

## 목표

KURE 인코더가 유휴 시 GPU와 RAM을 모두 반납한다. STT와 동일한 2단계 정책·동일한 TTL을 쓰고, 새 설정을 추가하지 않는다.

## 비목표

- solid-queue 워커(0.94GB) 등 GPU를 쓰지 않는 상시 Ruby 프로세스는 대상이 아니다. 잡 수신 대기가 목적이라 언로드가 성립하지 않는다.
- Windows 네이티브 프로세스(pixelrag 등)의 GPU 점유는 이 프로젝트 범위 밖이다.
- 화자분리(speakrs)는 subprocess라 종료 시 자동 해제된다. 변경하지 않는다.
- 임베딩 배치 크기·모델 교체·양자화는 다루지 않는다.

## 설계

### 1. KureEncoder에 IdleOffloadController 주입

STT 어댑터와 동일한 패턴으로 컨트롤러를 소유한다.

| 콜백 | 동작 |
|---|---|
| `stage1_offload` | `self._model.to("cpu")` + `torch.cuda.empty_cache()` |
| `stage1_target` | `CPU` (단 CUDA가 아니면 `UNLOADED` — 아래 참조) |
| `reload_from_cpu` | `self._model.to(self.device)` |
| `stage2_offload` | `self._model = None`, `self._tok = None`, `gc.collect()` (`self.dim`·`self.device`는 유지) |
| `reload_from_unloaded` | `self.load()` 재실행 (HF 캐시에서, 약 8초) |

모든 콜백은 `loop.run_in_executor(None, ...)`로 실행한다. 텐서 이동과 `gc.collect()`는 블로킹 호출이므로 이벤트 루프에서 직접 돌리지 않는다.

`stage2_offload`가 `_tok`까지 비우므로 `reload_from_unloaded`는 `load()`를 그대로 재사용한다. `load()`의 `if self._model is not None: return` 가드가 있어 멱등하다.

`self.dim`과 `self.device`는 해제하지 않는다. 같은 모델을 재로드하면 동일한 값이고, 언로드 상태에서도 `/embed`의 빈 `texts` 조기 반환이 `encoder.dim`을 참조하기 때문이다. 이를 비우면 모델을 깨우지 않고 응답하던 경로가 `dim=0`을 반환하게 되어 기존 동작이 바뀐다.

### 2. 초기 상태는 UNLOADED

`IdleOffloadController`의 기본 `state`는 `GPU`다. STT 어댑터는 lifespan에서 즉시 `load_model()`을 하므로 이 기본값이 맞지만, KURE는 lazy load라 첫 `/embed` 전까지 `_model is None`이다.

기본값을 그대로 두면 기동 600초 후 오프로드 루프가 `None.to("cpu")`를 호출해 `AttributeError`로 터진다.

따라서 인코더는 컨트롤러 생성 직후 상태를 `UNLOADED`로 초기화하고, `load()` 완료 시점에 `mark_loaded()`를 호출해 `GPU`로 전이시킨다.

`IdleOffloadController.__init__`에 `initial_state: ResidentState = ResidentState.GPU` 파라미터를 추가한다. 기본값이 현행 동작과 같으므로 STT 어댑터와 기존 테스트는 영향받지 않는다.

### 3. CPU 디바이스 처리

`EMBED_DEVICE`가 `cpu`로 해석되면(또는 `auto`인데 CUDA가 없으면) GPU→CPU 전이는 의미가 없다. 이 경우 `stage1_target=UNLOADED`, `stage1_offload=stage2_offload`(완전 해제), `reload_from_cpu=None`으로 구성해 1단계에서 곧바로 모델을 해제한다.

컨트롤러가 이미 `stage1_target` 파라미터를 지원하므로 컨트롤러 변경은 필요 없다.

디바이스는 `load()` 시점에 확정되지만(`_resolve_device`), 컨트롤러는 생성자에서 만들어야 한다. 따라서 인코더 생성자에서 `_resolve_device`를 미리 호출해 디바이스를 확정하고, 그 값으로 콜백 구성을 결정한다. `_resolve_device`는 `torch.cuda.is_available()`만 호출하므로 모델을 로드하지 않는다.

단 `_resolve_device`는 `import torch`를 유발한다. 현재 인코더는 torch를 함수 내부에서만 lazy import해 유휴 풋프린트를 낮게 유지하고 있으나, 사이드카는 lifespan에서 STT 어댑터를 먼저 로드하며 이미 torch를 import한 상태다. 따라서 실질적 추가 비용은 없다.

### 4. 락 통합과 async 진입점

현재 라우터는 `app.state.embed_lock`으로 직렬화하고, 동기 `encode()`를 async 핸들러에서 직접 호출한다. 임베딩이 도는 동안 이벤트 루프가 막힌다.

컨트롤러가 자체 `asyncio.Lock`을 갖고 있어 락이 이중이 되므로, `embed_lock`을 제거하고 컨트롤러 락으로 일원화한다.

인코더에 async 진입점을 추가한다.

```python
async def encode_async(self, texts: list[str]) -> list[list[float]]:
    async with self._idle:                       # 필요 시 복귀 + 직렬화 + last_used 갱신
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._encode_sync, texts)
```

기존 동기 `encode()`는 `_encode_sync`를 호출하는 얇은 래퍼로 남긴다(테스트·직접 호출 호환).

`_encode_sync`는 `self.load()`를 호출하지 않는다. 로드는 컨트롤러의 `reload_from_unloaded`가 담당하므로 진입 시점에 모델이 항상 준비되어 있다. 단 동기 `encode()` 경로는 컨트롤러를 거치지 않으므로 `load()` 호출을 유지한다.

라우터는 `await encoder.encode_async(request.texts)` 한 줄이 된다. 빈 `texts` 조기 반환은 유지한다 — 모델을 깨우지 않는다.

부수 효과로 백필 잡이 도는 동안 실시간 전사 요청이 이벤트 루프에서 대기하던 문제도 해소된다.

### 5. 점검 대상 매 틱 동적 수집

> **구현 갱신(2026-08-10)**: 최초 설계는 lifespan에서 `app.state.idle_managed = [app.state.stt_adapter, app.state.embedder]`로 고정 리스트를 한 번 등록하는 방식이었다. 그러나 `app/routers/health.py`의 STT 엔진 런타임 교체(`PUT /settings/stt-engine`)가 `app.state.stt_adapter`를 새 어댑터 인스턴스로 교체하는데, 고정 리스트는 옛 어댑터 참조를 그대로 들고 있어 교체 후 새 어댑터가 영영 오프로드 점검 대상에서 빠지는 갭이 있었다. 이를 막기 위해 실제 구현은 아래처럼 **매 틱 동적 수집**으로 바뀌었다.

`main.py`에 헬퍼 `_collect_idle_targets(app)`를 두고, `_idle_offload_loop`가 매 틱 이 헬퍼를 호출해 그 시점의 `app.state`에서 대상을 새로 모은다.

```python
def _collect_idle_targets(app: FastAPI) -> list:
    """유휴 오프로드 점검 대상을 현재 app.state에서 수집한다.

    매 틱 새로 수집하므로 STT 엔진이 런타임에 교체돼도 항상 최신 어댑터를 점검한다.
    GPU 상주 모델이 늘면 여기에 추가한다.
    """
    candidates = [
        getattr(app.state, "stt_adapter", None),
        getattr(app.state, "embedder", None),
    ]
    # None이거나 maybe_offload 코루틴이 없는 대상은 걸러낸다.
    # (엔진 교체 도중 stt_adapter가 일시적으로 None인 창이 있음)
    return [c for c in candidates if c is not None and callable(getattr(c, "maybe_offload", None))]
```

`_idle_offload_loop`는 이 목록을 순회하며 `maybe_offload(idle_unload_sec, idle_full_unload_sec)`를 호출한다. 대상별로 예외를 격리해 한 대상의 실패가 다른 대상 점검을 막지 않게 한다.

고정 리스트(`app.state.idle_managed`)는 사용하지 않는다 — `app.state.stt_adapter`·`app.state.embedder`를 매번 `getattr`로 직접 읽으므로 별도 등록·종료 시 비우기 절차가 필요 없다.

앞으로 GPU 상주 모델이 늘면 `_collect_idle_targets`의 candidates 목록에만 추가한다.

### 6. 관측

`/health` 응답에 `embed_state` 필드(`gpu` | `cpu` | `unloaded`)를 추가한다. 인코더가 한 번도 로드되지 않았으면 `unloaded`다.

현재 KURE의 상주 여부를 외부에서 확인할 방법이 없어, 이 변경의 동작 검증 수단으로 필요하다. `schemas.py`의 health 응답 모델에 기본값 `"unloaded"`로 필드를 추가한다.

## TTL

`STT_IDLE_UNLOAD_SEC`(600) / `STT_IDLE_FULL_UNLOAD_SEC`(3600)을 그대로 공유한다. 새 설정을 만들지 않는다.

두 값은 `resolve_idle_thresholds`로 이미 검증되며, 루프 시작 시 1회 해석되어 모든 대상에 동일하게 적용된다.

## 에러 처리

- **재로드 실패**: `IdleOffloadController.__aenter__`가 락을 풀고 예외를 전파한다(기존 동작). `/embed`는 500을 반환하고 상태는 `UNLOADED`로 남아 다음 요청에서 재시도된다. 영구 고장이 되지 않는다.
- **오프로드 실패**: `maybe_offload`는 콜백 성공 후에만 상태를 전이시키므로 예외 시 이전 상태가 유지되고 다음 주기(60초)에 재시도된다. 루프의 대상별 `try/except`가 예외를 삼켜 로그로 남긴다.
- **CUDA 캐시 반납 실패**: `_release_cuda_cache`가 이미 경고 로그 후 계속 진행한다. 오프로드 자체는 완료된 상태다.

## 테스트

`IdleOffloadController`는 `clock` 주입이 가능해 torch 없이 유닛 테스트할 수 있다. 기존 STT 오프로드 테스트와 같은 패턴을 따른다.

가짜 모델을 주입한 `KureEncoder`로 검증한다.

- lazy load 전(모델 미로드) 상태에서 `maybe_offload`가 크래시하지 않는다 — 초기 상태 `UNLOADED`
- 첫 `encode_async`가 `UNLOADED` → `GPU` 복귀를 수행한다
- 유휴 TTL 초과 시 `GPU` → `CPU` → `UNLOADED` 전이가 순서대로 일어난다
- `CPU` 상태에서 `encode_async` 호출 시 GPU로 복귀한다
- 디바이스가 cpu일 때 1단계가 곧바로 `UNLOADED`로 전이한다
- 빈 `texts` 요청이 모델을 로드하지 않는다
- 재로드 실패 시 예외가 전파되고 락이 해제된다

회귀 확인: 기존 STT 유휴 오프로드 테스트 26개가 그대로 통과해야 한다. `initial_state` 파라미터는 기본값이 현행과 같다.

## 검증

배포 후 실측으로 확인한다.

1. `/health`의 `embed_state`가 기동 직후 `unloaded`
2. `/embed` 호출 후 `gpu`
3. 10분 유휴 후 `cpu` + `nvidia-smi`로 GPU 점유 감소 확인
4. 1시간 유휴 후 `unloaded` + 사이드카 RSS 감소 확인
5. 이후 `/embed` 호출이 정상 응답 (재로드 경로)
