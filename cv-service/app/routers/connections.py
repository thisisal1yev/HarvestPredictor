"""RTSP / HTTP stream connection endpoints."""
from fastapi import APIRouter, Depends, HTTPException

from app.auth import require_api_key
from app.models.schemas import (
    ConnectionStartRequest,
    ConnectionStopRequest,
    ConnectionTestRequest,
    ConnectionTestResponse,
)
from app.services import stream_manager

router = APIRouter()


@router.post(
    "/test",
    response_model=ConnectionTestResponse,
    dependencies=[Depends(require_api_key)],
)
async def test_connection(req: ConnectionTestRequest) -> ConnectionTestResponse:
    ok, message = await stream_manager.test_connection(req)
    return ConnectionTestResponse(ok=ok, message=message)


@router.post(
    "/start",
    dependencies=[Depends(require_api_key)],
)
async def start_connection(req: ConnectionStartRequest) -> dict:
    try:
        await stream_manager.start(req)
    except stream_manager.StreamLimitReached as e:
        raise HTTPException(status_code=429, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start: {e}")
    return {"status": "active"}


@router.post(
    "/stop",
    dependencies=[Depends(require_api_key)],
)
async def stop_connection(req: ConnectionStopRequest) -> dict:
    stopped = await stream_manager.stop(req.connectionId)
    return {"status": "idle", "stopped": stopped}


@router.get(
    "/active",
    dependencies=[Depends(require_api_key)],
)
def active_connections() -> dict:
    return {"active": stream_manager.active_ids()}
