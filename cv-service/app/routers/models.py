"""Model upload / delete endpoints (API key auth)."""
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from ulid import ULID

from app.auth import require_api_key
from app.config import settings
from app.models.schemas import ModelUploadResponse
from app.services import onnx_validator
from app.services.model_manager import model_manager

router = APIRouter()

logger = logging.getLogger(__name__)

CHUNK_SIZE = 1 * 1024 * 1024  # 1 MB


@router.post(
    "/upload",
    response_model=ModelUploadResponse,
    dependencies=[Depends(require_api_key)],
)
async def upload_model(
    userId: str = Query(..., min_length=1),
    name: str = Form(...),
    cropType: str | None = Form(default=None),
    file: UploadFile = File(...),
) -> ModelUploadResponse:
    if not file.filename or not file.filename.lower().endswith(".onnx"):
        raise HTTPException(status_code=400, detail="Only .onnx files accepted")

    # Sanitize userId — no path separators.
    if "/" in userId or ".." in userId or "\\" in userId:
        raise HTTPException(status_code=400, detail="Invalid userId")

    user_dir = Path(settings.model_dir) / userId
    user_dir.mkdir(parents=True, exist_ok=True)

    ulid_str = str(ULID())
    filename = f"{ulid_str}.onnx"
    file_path = user_dir / filename

    # Streamed write.
    try:
        with open(file_path, "wb") as out:
            while True:
                chunk = await file.read(CHUNK_SIZE)
                if not chunk:
                    break
                out.write(chunk)
    except Exception as e:
        file_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")

    try:
        result = onnx_validator.validate(str(file_path))
    except ValueError as e:
        file_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(e))

    return ModelUploadResponse(
        filename=filename,
        sha256=result["sha256"],
        fileSize=result["file_size"],
        name=name,
        cropType=cropType,
    )


@router.delete(
    "/{userId}/{filename}",
    dependencies=[Depends(require_api_key)],
)
def delete_model(userId: str, filename: str) -> dict:
    if "/" in userId or ".." in userId or "\\" in userId:
        raise HTTPException(status_code=400, detail="Invalid userId")
    if "/" in filename or ".." in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    file_path = Path(settings.model_dir) / userId / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Model not found")

    model_manager.evict(str(file_path))
    model_manager.evict(f"{userId}/{filename}")
    try:
        file_path.unlink()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete: {e}")
    return {"deleted": filename}
