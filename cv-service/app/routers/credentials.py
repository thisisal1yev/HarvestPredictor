"""Credentials encryption endpoint — Nuxt's only way to encrypt without holding the master key."""
from fastapi import APIRouter, Depends, HTTPException

from app.auth import require_api_key
from app.models.schemas import CredentialsEncryptRequest, CredentialsEncryptResponse
from app.services import crypto

router = APIRouter()


@router.post(
    "/encrypt",
    response_model=CredentialsEncryptResponse,
    dependencies=[Depends(require_api_key)],
)
def encrypt_credentials(req: CredentialsEncryptRequest) -> CredentialsEncryptResponse:
    if not req.plaintext:
        raise HTTPException(status_code=400, detail="plaintext required")
    try:
        ciphertext = crypto.encrypt(req.plaintext)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Encryption failed: {e}")
    return CredentialsEncryptResponse(ciphertext=ciphertext)
