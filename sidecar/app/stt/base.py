"""STT Adapter 추상 클래스 및 공통 데이터 모델."""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import AsyncIterator


@dataclass
class TranscriptSegment:
    """STT 변환 결과 단위."""
    text: str
    started_at_ms: int
    ended_at_ms: int
    language: str = "ko"
    confidence: float = 0.0
    speaker_label: str | None = None


class SttAdapter(ABC):
    """모든 STT 엔진이 구현해야 하는 공통 인터페이스.

    환경 변수 STT_ENGINE으로 구현체를 선택한다.
    factory.py의 create_stt_adapter()를 통해 인스턴스를 생성한다.
    """

    def __init__(self):
        self._is_loaded: bool = False

    @property
    def is_loaded(self) -> bool:
        """모델이 로드되었는지 여부."""
        return self._is_loaded

    @abstractmethod
    async def load_model(self) -> None:
        """모델 로드 (앱 시작 시 1회 호출).

        구현체는 이 메서드에서 모델 파일을 읽어 메모리에 올리고
        완료 후 self._is_loaded = True 로 설정해야 한다.
        """
        ...

    @abstractmethod
    async def transcribe(self, audio_chunk: bytes, languages: list[str] | None = None) -> list[TranscriptSegment]:
        """오디오 청크(bytes) → 텍스트 세그먼트 변환 (동기 배치).

        Args:
            audio_chunk: PCM 16kHz mono Int16 바이너리 데이터
            languages: 인식 대상 언어 코드 목록 (예: ["ko", "ja"]). None이면 자동 감지.

        Returns:
            TranscriptSegment 리스트 (빈 리스트 가능)
        """
        ...

    @abstractmethod
    async def transcribe_stream(
        self, audio_stream
    ) -> AsyncIterator[TranscriptSegment]:
        """실시간 오디오 스트리밍 변환.

        Args:
            audio_stream: 오디오 청크를 yield하는 이터러블

        Yields:
            TranscriptSegment (확정/부분 결과)
        """
        ...

    @abstractmethod
    async def transcribe_file(self, file_path: str) -> list[TranscriptSegment]:
        """파일 전체 변환 (녹음 원본 후처리).

        Args:
            file_path: 오디오 파일 경로 (wav, webm 등)

        Returns:
            TranscriptSegment 리스트 (시간 순 정렬)
        """
        ...
