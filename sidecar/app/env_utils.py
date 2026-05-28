"""환경 변수(.env) 영속화 및 토큰 마스킹 유틸리티."""
from pathlib import Path


def _find_env_file() -> str | None:
    """pydantic-settings와 동일한 순서로 .env 파일을 탐색한다."""
    for candidate in (".env", "../.env"):
        p = Path(candidate).resolve()
        if p.is_file():
            return str(p)
    return None


def _persist_env(**kwargs: str) -> None:
    """변경된 설정값을 .env 파일에 영구 저장한다."""
    env_path = _find_env_file()
    if not env_path:
        return
    try:
        from dotenv import set_key
        for key, value in kwargs.items():
            set_key(env_path, key, value)
    except Exception:
        pass  # .env 쓰기 실패는 런타임에 영향 없음


def _mask_token(token: str) -> str:
    """토큰을 마스킹한다 (앞 4자 + *** + 뒤 4자)."""
    if not token or len(token) <= 8:
        return "****" if token else ""
    return f"{token[:4]}{'*' * (len(token) - 8)}{token[-4:]}"
