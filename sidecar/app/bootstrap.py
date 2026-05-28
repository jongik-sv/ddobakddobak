"""프로세스 시작 설정 (import 시 1회 실행). main 최상단에서 import해야 한다.

torch/멀티프로세싱을 사용하기 전에 start method와 텐서 공유 전략을 고정해
macOS POSIX 세마포어 누수를 방지한다. 어떤 무거운 import(torch/transformers)보다
먼저 import 되어야 효과가 있다.
"""
import multiprocessing
import os

# macOS 세마포어 누수 방지
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("OMP_NUM_THREADS", "1")

if multiprocessing.get_start_method(allow_none=True) is None:
    multiprocessing.set_start_method("spawn")

# CPU 텐서 공유를 파일 기반으로 전환 → POSIX 세마포어 생성 방지
try:
    import torch.multiprocessing as _tmp
    _tmp.set_sharing_strategy("file_system")
    del _tmp
except Exception:
    pass
