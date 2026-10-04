from fastapi import Header, HTTPException

from gateway.config import settings


def require_token(authorization: str = Header(default="")) -> None:
    expected = f"Bearer {settings.gateway_token}"
    if settings.gateway_token and authorization != expected:
        raise HTTPException(status_code=401, detail="unauthorized")
