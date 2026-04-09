"""Shared API key auth dependency.

Checks `X-API-Key` header against `CV_API_KEY`. 401 on mismatch.
Apply to all routes except /health.
"""
import hmac

from fastapi import Header, HTTPException, status

from app.config import settings


def require_api_key(x_api_key: str = Header(default="", alias="X-API-Key")) -> None:
    if not settings.cv_api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="CV_API_KEY not configured",
        )
    if not hmac.compare_digest(x_api_key, settings.cv_api_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )
