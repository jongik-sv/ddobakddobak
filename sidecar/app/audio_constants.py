"""오디오 처리 공통 상수 (PCM 16kHz mono Int16 기준)."""

SAMPLE_RATE = 16000          # Hz
BYTES_PER_SAMPLE = 2         # Int16
SEC_TO_MS = 1000
BYTES_PER_SEC = SAMPLE_RATE * BYTES_PER_SAMPLE
MIN_AUDIO_BYTES = BYTES_PER_SEC  # 1초 미만은 화자분리 불안정
