"""MockAdapter: 테스트용 더미 STT 어댑터.

실제 STT 모델 없이 고정된 더미 응답을 반환한다.
개발 환경, CI, 단위 테스트에서 사용한다.
"""
from typing import AsyncIterator

from app.stt.base import SttAdapter, TranscriptSegment


class MockAdapter(SttAdapter):
    """테스트/개발용 더미 STT 어댑터.

    실제 오디오 처리 없이 미리 정의된 응답을 반환한다.
    """

    DUMMY_TEXT = "[mock] 안녕하세요. 테스트 음성입니다."

    async def load_model(self) -> None:
        """더미 모델 로드 (즉시 완료)."""
        self._is_loaded = True

    async def transcribe(self, audio_chunk: bytes) -> list[TranscriptSegment]:
        """더미 단일 세그먼트 반환."""
        return [
            TranscriptSegment(
                text=self.DUMMY_TEXT,
                started_at_ms=0,
                ended_at_ms=3000,
                language="ko",
                confidence=1.0,
            )
        ]

    async def transcribe_stream(
        self, audio_stream
    ) -> AsyncIterator[TranscriptSegment]:
        """더미 세그먼트 1개를 yield."""
        yield TranscriptSegment(
            text=self.DUMMY_TEXT,
            started_at_ms=0,
            ended_at_ms=3000,
            language="ko",
            confidence=1.0,
        )

    async def transcribe_file(self, file_path: str) -> list[TranscriptSegment]:
        """더미 세그먼트 1개 반환."""
        return [
            TranscriptSegment(
                text=self.DUMMY_TEXT,
                started_at_ms=0,
                ended_at_ms=60000,
                language="ko",
                confidence=1.0,
            )
        ]
