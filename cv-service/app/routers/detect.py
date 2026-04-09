"""Quick Test single-image detection endpoint."""
import asyncio
import time
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from app.auth import require_api_key
from app.config import settings
from app.models.schemas import QuickTestResponse
from app.services import detector
from app.services.image_processor import decode_image, strip_exif

router = APIRouter()

MAX_IMAGE_MB = 20


@router.post(
    "/image",
    response_model=QuickTestResponse,
    dependencies=[Depends(require_api_key)],
)
async def detect_image(
    modelId: str = Query(..., min_length=1),
    file: UploadFile = File(...),
) -> QuickTestResponse:
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")

    if "/" in modelId or ".." in modelId or "\\" in modelId:
        # modelId can include `userId/filename` — allow single slash.
        if modelId.count("/") > 1 or ".." in modelId or "\\" in modelId:
            raise HTTPException(status_code=400, detail="Invalid modelId")

    contents = await file.read()
    max_bytes = MAX_IMAGE_MB * 1024 * 1024
    if len(contents) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Image too large. Max {MAX_IMAGE_MB}MB",
        )

    contents = await asyncio.to_thread(strip_exif, contents)
    try:
        frame = await asyncio.to_thread(decode_image, contents)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    h, w = frame.shape[:2]

    start = time.monotonic()
    try:
        detections = await asyncio.to_thread(
            detector.infer,
            frame,
            modelId,
            settings.min_detection_confidence,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Detection failed: {e}")
    inference_ms = (time.monotonic() - start) * 1000.0

    return QuickTestResponse(
        modelId=modelId,
        inferenceMs=round(inference_ms, 2),
        imageWidth=w,
        imageHeight=h,
        detections=detections,
    )
