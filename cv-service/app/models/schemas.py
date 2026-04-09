from typing import Literal, Optional

from pydantic import BaseModel, Field


# ---------- Detection primitives ----------

class DetectionBBox(BaseModel):
    """Normalized 0-1 coordinates, top-left origin."""
    x: float = Field(..., ge=0.0, le=1.0)
    y: float = Field(..., ge=0.0, le=1.0)
    w: float = Field(..., ge=0.0, le=1.0)
    h: float = Field(..., ge=0.0, le=1.0)


class DetectionResult(BaseModel):
    className: str
    category: str  # disease | pest | weed
    confidence: float
    severity: Literal["confirmed", "likely", "possible"]
    bbox: DetectionBBox


# ---------- Endpoint responses ----------

class HealthResponse(BaseModel):
    status: str = "ok"


class QuickTestResponse(BaseModel):
    modelId: str
    inferenceMs: float
    imageWidth: int
    imageHeight: int
    detections: list[DetectionResult]


class ModelUploadResponse(BaseModel):
    filename: str
    sha256: str
    fileSize: int
    name: str
    cropType: Optional[str] = None


# ---------- Connections ----------

class ConnectionStartRequest(BaseModel):
    connectionId: str
    userId: str
    streamToken: str
    protocol: str  # rtsp | http | ...
    streamUrl: str
    usernameEnc: Optional[str] = None
    passwordEnc: Optional[str] = None
    modelId: str


class ConnectionTestRequest(BaseModel):
    protocol: str
    streamUrl: str
    usernameEnc: Optional[str] = None
    passwordEnc: Optional[str] = None
    modelId: str


class ConnectionTestResponse(BaseModel):
    ok: bool
    message: str


class ConnectionStopRequest(BaseModel):
    connectionId: str


# ---------- Credentials ----------

class CredentialsEncryptRequest(BaseModel):
    plaintext: str


class CredentialsEncryptResponse(BaseModel):
    ciphertext: str
