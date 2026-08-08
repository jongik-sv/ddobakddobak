"""세션 전역 fixture: 실시간 STT 어댑터의 MLX 실추론 스레드 격리 결함 방지.

## 문제

`mlx_lm/__init__.py`는 `from .generate import ...`을 최상위에서 실행하므로,
`mlx_lm` 패키지가 처음 import되는 순간(예: mlx-audio Qwen3-ASR의
`make_cache()`가 `from mlx_lm.models.cache import KVCache`를 부르는 시점,
혹은 실제 `.generate()` 호출 시점) `mlx_lm/generate.py`의 모듈 전역
`generation_stream = mx.new_stream(mx.default_device())`가 **그 순간의 OS
스레드에서** 딱 한 번 생성된다.

MLX Metal 백엔드의 `Stream` 객체는 그것을 만든(=처음 사용한) 스레드에만
등록되어 있어, 다른 스레드에서 동일 `Stream` 파이썬 객체를 `mx.stream(...)`
컨텍스트로 넘기면 `RuntimeError: There is no Stream(gpu, N) in current
thread`가 난다(각 스레드 자신만의 "새" 기본 스트림을 그 스레드에서 얻어 쓰는
것은 항상 안전하다 — 문제는 스레드 간 Stream 객체 재사용이다).

Qwen3Adapter/MLXWhisperAdapter의 `load_model()`·`_infer()`는
`loop.run_in_executor(None, ...)`로 실행된다. `with TestClient(app) as c:`를
테스트마다 새로 여는 파일(test_ws_transcribe.py 등)은 매번 새 이벤트 루프 +
새 기본 ThreadPoolExecutor를 만들기 때문에, 매 테스트의 실제 추론이 이전
테스트와는 다른(한 번도 `mlx_lm`을 사용한 적 없는) 스레드에서 실행된다.
그 결과 세션 중 최초 1회의 실추론 호출만 성공하고 이후 모든 호출이
스레드 불일치로 실패한다(전체 스위트 실행 시에는 다른 파일의 lifespan
`load_model()`이 먼저 스트림을 다른 스레드에 귀속시켜, 단독 실행보다도
더 많은 실패가 난다).

## 고정 방식

프로덕션 코드는 건드리지 않는다 — `asyncio.BaseEventLoop.run_in_executor`
디스패치 지점만 테스트 세션 동안 감싸서, 실행기 스레드로 넘어가는 콜러블
직전에 (이미 import된 경우) `mlx_lm.generate.generation_stream`을
"현재(그 콜러블이 실행되는) 스레드에서 새로 얻은" 기본 스트림으로
재바인딩한다. 아직 `mlx_lm.generate`가 import되지 않았다면 아무 것도 하지
않는다 — 최초 import 시점의 자연스러운 생성(및 그 스레드에서의 즉시 사용)은
원래도 문제가 없다.

전체 실행기 콜러블을 감싸는 방식(스레드 자체를 단일 워커로 고정하지 않음)을
택한 이유: 단일 워커로 고정하면 실행기 안에서 다른 실행기 호출을 기다리는
케이스가 있을 때 데드락 위험이 있고, 순차 제출이어도 CPython
ThreadPoolExecutor가 유휴 스레드 재사용에 실패해 새 스레드를 만드는 경우가
있어(비결정적) 여전히 재현될 수 있다. 콜러블 실행 직전 재바인딩은 실제
실행 스레드가 무엇이든 항상 유효하다.
"""
from __future__ import annotations

import asyncio
import sys

import pytest


def _rebind_mlx_generation_stream_for_current_thread() -> None:
    """이미 import된 mlx_lm.generate가 있으면 generation_stream을 호출 스레드 소유로 재바인딩한다."""
    mod = sys.modules.get("mlx_lm.generate")
    if mod is None:
        return
    import mlx.core as mx

    mod.generation_stream = mx.default_stream(mx.default_device())


@pytest.fixture(scope="session", autouse=True)
def _mlx_stream_thread_affinity_fix():
    """세션 동안 run_in_executor로 넘어가는 콜러블 직전에 MLX 스트림을 재바인딩한다."""
    original_run_in_executor = asyncio.base_events.BaseEventLoop.run_in_executor

    def patched_run_in_executor(self, executor, func, *args):
        def _wrapped(*a):
            _rebind_mlx_generation_stream_for_current_thread()
            return func(*a)

        return original_run_in_executor(self, executor, _wrapped, *args)

    asyncio.base_events.BaseEventLoop.run_in_executor = patched_run_in_executor
    try:
        yield
    finally:
        asyncio.base_events.BaseEventLoop.run_in_executor = original_run_in_executor
