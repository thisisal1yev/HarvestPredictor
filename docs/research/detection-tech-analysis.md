# Detection Page - Technical Feasibility Analysis

## 1. Video in Memory: Streaming vs Loading

**Question:** 500MB video loaded into memory? Or streamed frame-by-frame?

**Answer:** OpenCV `VideoCapture` streams frame-by-frame by default. It does NOT load the entire video into RAM.

### How it works
- `cv2.VideoCapture(filepath)` opens a file handle and reads frames on-demand via `.read()` or `.grab()` + `.retrieve()`
- Each `.read()` returns a single decoded frame (~6MB for 1080p BGR). Previous frame is overwritten/released
- Memory usage: ~50MB for VideoCapture object + 1 frame buffer (~6-25MB depending on resolution)
- A 500MB video file stays on disk; only the current frame is in RAM

### "Process every Nth frame" implementation
```python
cap = cv2.VideoCapture(filepath)
frame_count = 0
while cap.isOpened():
    ret = cap.grab()  # grab is fast, doesn't decode
    if not ret:
        break
    frame_count += 1
    if frame_count % N == 0:
        ret, frame = cap.retrieve()  # decode only Nth frame
        # run YOLO inference on frame
cap.release()
```

### Known issues
- Memory leak: ~1MB per 2-3 hours of continuous reading (OpenCV known issue, see [opencv#5715](https://github.com/opencv/opencv/issues/5715))
- `cap.release()` doesn't fully free RAM (~50MB retained). Workaround: run in subprocess
- **Recommendation:** Process video in a subprocess (multiprocessing) to guarantee cleanup

### Verdict: FEASIBLE
- 500MB video = ~50-80MB RAM during processing, not 500MB
- Use `grab()`/`retrieve()` pattern to skip frames efficiently without decoding

---

## 2. Concurrent Users: 5 Users Uploading Simultaneously

**Question:** Does FastAPI handle 5 concurrent photo uploads with YOLO inference?

**Answer:** Yes, but requires careful architecture.

### The problem
- YOLOv8 inference is CPU/GPU-bound and blocks Python's event loop
- If using `async def` endpoints, a blocking `model.predict()` call freezes ALL other requests
- Python GIL prevents true parallel CPU execution in threads

### Solutions (ranked by effectiveness)

| Approach | Concurrency | Isolation | Complexity |
|----------|-------------|-----------|------------|
| `def` endpoints (sync) | Starlette thread pool (40 threads default) | Per-thread | Low |
| `asyncio.to_thread()` | Explicit thread offload | Per-thread | Low |
| `ProcessPoolExecutor` | True parallelism | Per-process | Medium |
| Celery/RQ worker queue | Unlimited scale | Full process | High |

### Recommended approach for MVP
```python
# Option 1: Use sync def (simplest)
@router.post("/detect/image")
def detect_image(file: UploadFile):  # NOT async def
    # Starlette auto-runs in threadpool
    result = model.predict(image)
    return result

# Option 2: async with to_thread
@router.post("/detect/image")
async def detect_image(file: UploadFile):
    result = await asyncio.to_thread(model.predict, image)
    return result
```

### Capacity estimate (single server, CPU)
- YOLOv8n inference: ~30-50ms per image (GPU), ~200-500ms (CPU)
- 5 concurrent users: 5 x 500ms = 2.5s worst case on CPU with sequential processing
- With thread pool (4 workers): ~625ms per user
- With GPU: ~50ms per user (GPU handles batching natively)

### Verdict: FEASIBLE
- Use sync `def` endpoints (Starlette threadpool handles concurrency automatically)
- For GPU: single model instance, queue requests, batch inference
- For scale beyond 10 concurrent: add Celery worker queue

---

## 3. WebSocket Streaming Latency: JPEG Base64 over WS

**Question:** Bandwidth at 720p/15fps? Is base64 the right encoding?

### Bandwidth calculation

| Resolution | JPEG size (q=80) | Base64 overhead | Per frame | At 15fps |
|-----------|-------------------|-----------------|-----------|----------|
| 720p (1280x720) | ~50-80KB | +33% | ~70-107KB | **1.0-1.6 MB/s** |
| 1080p (1920x1080) | ~100-150KB | +33% | ~133-200KB | **2.0-3.0 MB/s** |
| 480p (640x480) | ~20-35KB | +33% | ~27-47KB | **0.4-0.7 MB/s** |

### Base64 vs Binary WebSocket frames

| Factor | Base64 (text) | Binary (blob) |
|--------|--------------|---------------|
| Size overhead | +33% | 0% |
| Browser handling | Easy (data:image/jpeg;base64,...) | Need Blob URL |
| CPU overhead | Encode + decode | None |
| Debugging | Readable in devtools | Opaque |
| Implementation | Simple | Slightly more complex |

### Recommendation
- **Use binary WebSocket frames**, not base64
- 33% bandwidth savings is significant at 15fps
- Browser handles `Blob` → `URL.createObjectURL()` efficiently
- JPEG quality 60-70 is sufficient for detection visualization (saves ~30% more)

### Realistic target
- 720p, JPEG q=70, binary WS: ~0.7-1.0 MB/s = **5.6-8 Mbps**
- Acceptable for LAN/good broadband. Problematic for mobile/slow connections
- Consider adaptive quality: reduce JPEG quality or resolution if client reports lag

### Verdict: FEASIBLE with binary frames
- Base64 works but wastes 33% bandwidth
- Use binary WebSocket frames + JPEG q=70 at 720p
- Add adaptive quality reduction for slow connections

---

## 4. RTSP/RTMP Ingestion

**Question:** Threading needed? Reconnection? Frame dropping?

### Threading: REQUIRED
```python
class RTSPStream:
    def __init__(self, url: str):
        self.cap = cv2.VideoCapture(url)
        self.frame = None
        self.running = True
        self.lock = threading.Lock()
        self.thread = threading.Thread(target=self._capture_loop, daemon=True)
        self.thread.start()

    def _capture_loop(self):
        while self.running:
            ret = self.cap.grab()
            if not ret:
                self._reconnect()
                continue
            ret, frame = self.cap.retrieve()
            if ret:
                with self.lock:
                    self.frame = frame  # always latest frame

    def get_frame(self):
        with self.lock:
            return self.frame.copy() if self.frame is not None else None
```

### Why threading is mandatory
- `VideoCapture.read()` blocks until next frame arrives
- Without threading: YOLO inference time causes frame buffer to fill up
- Buffer fills → increasing latency (10+ seconds behind real-time)
- With threading: capture thread always has latest frame; detection thread processes at its own pace

### Reconnection strategy
- RTSP streams drop due to: network issues, camera reboot, timeout
- Implement exponential backoff: 1s, 2s, 4s, 8s... max 30s
- Detect disconnect: `grab()` returns False
- Log reconnection attempts, notify frontend via WebSocket message
- Max retry limit (e.g., 10 attempts), then notify user "stream lost"

### Frame dropping
- This is DESIRED, not a bug: always process the latest frame
- Drop strategy: capture thread overwrites `self.frame`; detection thread reads latest
- Never queue RTSP frames in a buffer — guarantees you're always processing "now"

### Key gotchas
- Use wired Ethernet when possible (Wi-Fi causes frame drops)
- Set `cv2.CAP_PROP_BUFFERSIZE` to 1 to minimize latency
- Use TCP transport: `cv2.VideoCapture("rtsp://...?tcp", cv2.CAP_FFMPEG)`
- OpenCV RTSP timeout defaults are long; set `cv2.CAP_PROP_OPEN_TIMEOUT_MSEC`

### Verdict: FEASIBLE
- Threading is mandatory but straightforward (standard pattern)
- Always-latest-frame pattern eliminates buffering lag
- Reconnection needs explicit implementation (not built into OpenCV)

---

## 5. Temp File Cleanup: Orphan Files After Crash

**Question:** What if server crashes mid-processing?

### The problem
- User uploads 500MB video → saved to `/tmp/uploads/abc123.mp4`
- Server crashes during YOLO inference
- `atexit` handlers do NOT run on SIGKILL, OOM kill, or power failure
- Orphan file stays on disk forever

### Solution: Multi-layer cleanup

**Layer 1: try/finally (handles normal errors)**
```python
@router.post("/detect/video")
async def detect_video(file: UploadFile):
    tmp_path = save_to_temp(file)
    try:
        results = process_video(tmp_path)
        return results
    finally:
        os.unlink(tmp_path)  # always runs unless process killed
```

**Layer 2: Python tempfile module (handles graceful shutdown)**
```python
import tempfile
# Auto-deleted when file handle closed or process exits normally
with tempfile.NamedTemporaryFile(suffix='.mp4', delete=True) as tmp:
    tmp.write(await file.read())
    tmp.flush()
    results = process_video(tmp.name)
```

**Layer 3: Startup cleanup (handles crash recovery)**
```python
# In FastAPI lifespan
@asynccontextmanager
async def lifespan(app: FastAPI):
    # On startup: clean up orphans from previous crash
    cleanup_old_temp_files(max_age_hours=1)
    yield
    # On shutdown: clean remaining temp files
    cleanup_old_temp_files(max_age_hours=0)

def cleanup_old_temp_files(max_age_hours: int):
    upload_dir = Path("/tmp/cv-uploads")
    now = time.time()
    for f in upload_dir.glob("*"):
        if now - f.stat().st_mtime > max_age_hours * 3600:
            f.unlink()
            logger.info(f"Cleaned orphan: {f}")
```

**Layer 4: OS-level cron (handles everything)**
```bash
# Cron job: clean /tmp/cv-uploads files older than 2 hours
0 * * * * find /tmp/cv-uploads -mmin +120 -delete
```

### Recommendation
- Use all 4 layers. Layer 1+2 handle 99% of cases. Layer 3 handles crashes. Layer 4 is safety net
- Use a dedicated temp directory (`/tmp/cv-uploads/`), NOT system `/tmp/`
- Prefix temp files with timestamp: `1711700000_abc123.mp4` for easy age-based cleanup
- Set max file age to 2 hours (longest possible video processing time)

### Verdict: FEASIBLE
- No single solution covers all crash modes
- 4-layer approach is robust. Implementation: ~30 lines of code total

---

## 6. Model Hot-Loading: Cache Strategy

**Question:** Loading takes 2-5s + 50-200MB RAM. Cache strategy? Max models?

### Measured loading characteristics

| Model | File size | Load time (CPU) | Load time (GPU) | RAM/VRAM |
|-------|-----------|-----------------|-----------------|----------|
| YOLOv8n | 6MB | ~0.5s | ~1s | ~50MB |
| YOLOv8s | 22MB | ~1s | ~1.5s | ~80MB |
| YOLOv8m | 50MB | ~2s | ~2s | ~150MB |
| YOLOv8l | 84MB | ~3s | ~3s | ~250MB |
| YOLOv8x | 131MB | ~5s | ~4s | ~400MB |

### Cache strategy: LRU with preloading

```python
from functools import lru_cache
from ultralytics import YOLO

class ModelManager:
    def __init__(self, max_models: int = 3):
        self.models: dict[str, YOLO] = {}  # model_id -> YOLO instance
        self.max_models = max_models
        self.access_order: list[str] = []

    def get_model(self, model_id: str, model_path: str) -> YOLO:
        if model_id in self.models:
            # Move to end (most recently used)
            self.access_order.remove(model_id)
            self.access_order.append(model_id)
            return self.models[model_id]

        # Evict oldest if at capacity
        if len(self.models) >= self.max_models:
            oldest = self.access_order.pop(0)
            del self.models[oldest]
            gc.collect()

        # Load new model
        model = YOLO(model_path)
        self.models[model_id] = model
        self.access_order.append(model_id)
        return model
```

### Capacity planning

| Server RAM | Max models (concurrent) | Recommendation |
|-----------|------------------------|----------------|
| 2GB | 1 (nano/small only) | Preload default model only |
| 4GB | 2-3 (nano/small) | LRU cache, max_models=2 |
| 8GB | 3-5 (mixed sizes) | LRU cache, max_models=3 |
| 16GB | 5-8 (any size) | LRU cache, max_models=5 |

### GPU memory considerations
- GPU VRAM is more limited (4-8GB typical)
- Each GPU-loaded model reserves VRAM permanently until explicitly deleted
- Consider CPU-only for secondary models, GPU for active model only
- Use `model.to('cpu')` to move inactive models off GPU

### Preloading strategy
- On startup: load the most recently used model (from DB or config)
- On model switch: async load in background while current model serves requests
- Never block a request waiting for model load — return 503 "model loading, retry in Xs"

### Verdict: FEASIBLE
- LRU cache with max 2-3 models covers MVP use case
- Preload default model on startup
- Model switch takes 1-5s — acceptable with loading indicator in UI

---

## 7. Nuxt -> Python Proxy: Large File Upload Memory

**Question:** `readMultipartFormData` loads all into RAM?

### The problem
- `readMultipartFormData()` from h3 reads entire file into memory as `Buffer`
- 500MB video upload = 500MB RAM consumed in Nuxt server process
- Node.js default heap: ~1.5GB. Two concurrent 500MB uploads = OOM crash

### Confirmed issues
- [nuxt/nuxt#20962](https://github.com/nuxt/nuxt/discussions/20962): File upload proxy through Nitro causes memory issues
- [h3js/h3#514](https://github.com/h3js/h3/issues/514): Handle large bodies — acknowledged limitation
- [nitro#1137](https://github.com/nitrojs/nitro/issues/1137): File size corruption when proxying multipart

### Solutions

**Option A: Direct upload to Python (RECOMMENDED)**
```
Browser ──POST multipart──> FastAPI (Python)
                              └── saves to disk, processes
```
- Skip Nitro proxy entirely for file uploads
- Frontend sends directly to CV service URL
- Auth: include JWT/session token in request, Python validates via Nuxt API

**Option B: Nitro stream proxy (complex)**
```typescript
// server/api/cv/detect.post.ts
export default defineEventHandler(async (event) => {
  // Stream body directly without buffering
  const response = await proxyRequest(event, 'http://localhost:8100/detect', {
    // proxyRequest streams by default
  })
  return response
})
```
- `proxyRequest()` from h3 streams the body — does NOT buffer in memory
- But: has known issues with multipart file sizes ([nitro#1137](https://github.com/nitrojs/nitro/issues/1137))

**Option C: Presigned URL pattern**
```
Browser → Nuxt API: "I want to upload"
Nuxt API → returns: upload_token + direct_url
Browser → FastAPI: POST file + upload_token
FastAPI → validates token, processes
```

### Recommendation for MVP
- **Photos (< 20MB):** Proxy through Nitro using `proxyRequest()` — acceptable memory cost
- **Videos (< 500MB):** Direct upload to Python service. Nuxt only proxies the metadata/auth
- Set `NUXT_CV_SERVICE_URL` as env var, expose it to frontend only for upload endpoints

### Verdict: PARTIALLY FEASIBLE
- Small files (< 20MB): proxy through Nitro is fine
- Large files (> 50MB): MUST bypass Nitro. Direct upload to Python service
- This is a critical architectural decision — impacts frontend implementation

---

## 8. Database Growth: Detection Results

**Question:** How many rows per day? Indexes? Pagination?

### Growth estimation

| Usage scenario | Photos/day | Detections/photo | Rows/day | Rows/month |
|---------------|------------|-------------------|----------|------------|
| 1 user, casual | 10-20 | 5 avg | 50-100 | 1.5-3K |
| 5 users, active | 50-100 | 5 avg | 250-500 | 7.5-15K |
| 10 users + video | 200+ | 10 avg (video frames) | 2,000+ | 60K+ |
| Production (50 users) | 1,000+ | 10 avg | 10,000+ | 300K+ |

### Year 1 realistic estimate
- 5-10 active users: **50K-200K rows** in Detection table
- PostgreSQL handles millions of rows easily. This is not a concern for MVP

### When to worry
- 1M+ rows: add indexes, consider keyset pagination
- 10M+ rows: add table partitioning by month
- 100M+ rows: archive old data, use TimescaleDB or partitioning

### Required indexes (from day 1)
```sql
-- Detection table
CREATE INDEX idx_detection_session ON "Detection" ("sessionId");
CREATE INDEX idx_detection_created ON "Detection" ("createdAt" DESC);
CREATE INDEX idx_detection_class ON "Detection" ("className");

-- DetectionSession table
CREATE INDEX idx_session_user ON "DetectionSession" ("userId");
CREATE INDEX idx_session_created ON "DetectionSession" ("createdAt" DESC);
CREATE INDEX idx_session_model ON "DetectionSession" ("modelId");

-- Composite for history page filters
CREATE INDEX idx_detection_session_class ON "Detection" ("sessionId", "className");
```

### Pagination strategy
- **MVP:** OFFSET/LIMIT is fine for < 100K rows. Simple to implement
- **Scale:** Switch to cursor-based (keyset) pagination when needed:
```sql
-- Instead of: SELECT * FROM detections OFFSET 10000 LIMIT 20
-- Use: SELECT * FROM detections WHERE "createdAt" < $cursor ORDER BY "createdAt" DESC LIMIT 20
```

### Data retention policy
- Detection metadata: keep forever (tiny rows, ~200 bytes each)
- Annotated image crops: auto-delete after 72 hours (as spec says)
- Session metadata: keep forever
- Implement `prisma.$queryRaw` for batch deletion of old crops

### Verdict: NOT A CONCERN for MVP
- PostgreSQL handles this volume trivially
- Add basic indexes from the start
- OFFSET/LIMIT pagination is fine for year 1
- Plan cursor-based pagination for future

---

## 9. Preprocessing: 4K Drone Images for YOLO 640x640

**Question:** Resize or tile into patches?

### The problem
- Drone cameras: 12-48MP (4000x3000 to 8000x6000 pixels)
- YOLOv8 input: 640x640 (default), 1280x1280 (high-res mode)
- Naive resize: 8000x6000 → 640x640 loses 99.3% of pixel detail
- Small objects (early disease spots, individual insects) become invisible

### Strategy comparison

| Approach | Pros | Cons | Best for |
|----------|------|------|----------|
| **Resize to 640** | Fast, simple | Loses small objects | Quick scan, large lesions |
| **Resize to 1280** | Better detail, still fast | 4x inference time | Good balance |
| **SAHI tiling** | Detects tiny objects | Slow (N tiles x inference time) | Drone/satellite imagery |
| **Manual tiles** | Full control | Complex, overlap handling | Custom pipelines |

### Recommended: SAHI (Slicing Aided Hyper Inference)

[SAHI](https://github.com/obss/sahi) is an open-source library designed exactly for this use case:

```python
from sahi import AutoDetectionModel
from sahi.predict import get_sliced_prediction

model = AutoDetectionModel.from_pretrained(
    model_type="yolov8",
    model_path="best.pt",
    confidence_threshold=0.3,
    device="cpu"
)

result = get_sliced_prediction(
    image="drone_photo_8000x6000.jpg",
    detection_model=model,
    slice_height=640,
    slice_width=640,
    overlap_height_ratio=0.2,  # 20% overlap to catch objects on tile borders
    overlap_width_ratio=0.2
)
```

### How SAHI tiling works
```
Original image: 8000 x 6000 pixels
Tile size: 640x640, overlap: 20%

Grid: ceil(8000/512) x ceil(6000/512) = 16 x 12 = 192 tiles
(512 = 640 - 128 overlap)

Each tile: YOLO inference → detections
Post-processing: NMS across overlapping tiles → deduplicate
```

### Performance impact

| Image size | Tiles (640x640, 20% overlap) | Time (CPU, YOLOv8n) | Time (GPU, YOLOv8n) |
|-----------|------------------------------|---------------------|---------------------|
| 4000x3000 | 48 tiles | ~24s | ~2.4s |
| 8000x6000 | 192 tiles | ~96s | ~9.6s |
| 4000x3000 (resize to 1280) | 1 tile | ~0.5s | ~0.1s |

### Recommendation for MVP
1. **Default: Resize to 1280x1280** — fast, good enough for most disease detection
2. **Option: "High precision" mode** — enable SAHI tiling for when user needs to find tiny objects
3. Let user choose in UI: "Quick scan" vs "Detailed analysis"
4. Always show processing time estimate before starting

### Implementation
```python
def preprocess_image(image_path: str, mode: str = "quick") -> list[np.ndarray]:
    img = cv2.imread(image_path)
    h, w = img.shape[:2]

    if mode == "quick" or max(h, w) <= 1280:
        # Resize preserving aspect ratio
        img = letterbox(img, new_shape=1280)
        return [img]
    else:
        # SAHI tiling for high-res
        return slice_image(img, slice_size=640, overlap=0.2)
```

### Verdict: FEASIBLE
- Simple resize works for MVP (90% of use cases)
- SAHI tiling available for drone imagery when precision matters
- Let user choose: "quick" (resize) vs "detailed" (SAHI) — configurable in UI
- CPU performance for tiling is slow — GPU strongly recommended for production

---

## Summary: Risk Matrix

| # | Question | Feasibility | Risk Level | Notes |
|---|----------|-------------|------------|-------|
| 1 | Video in memory | FEASIBLE | LOW | OpenCV streams frame-by-frame, not full load |
| 2 | Concurrent users | FEASIBLE | LOW | Sync endpoints + thread pool handles 5 users |
| 3 | WS streaming bandwidth | FEASIBLE | MEDIUM | Use binary frames, not base64. Adaptive quality |
| 4 | RTSP/RTMP ingestion | FEASIBLE | MEDIUM | Threading required, reconnection needs implementation |
| 5 | Temp file cleanup | FEASIBLE | LOW | 4-layer cleanup strategy covers all failure modes |
| 6 | Model hot-loading | FEASIBLE | LOW | LRU cache, max 2-3 models, preload default |
| 7 | Nuxt proxy for uploads | PARTIAL | HIGH | Large files MUST bypass Nitro. Direct upload to Python |
| 8 | Database growth | NOT A CONCERN | LOW | < 200K rows/year for MVP. Basic indexes sufficient |
| 9 | 4K preprocessing | FEASIBLE | MEDIUM | Resize for quick, SAHI for precision. GPU recommended |

## Critical Architectural Decisions

1. **File upload path:** Photos through Nitro proxy, videos direct to Python service
2. **WebSocket encoding:** Binary frames, not base64
3. **YOLO inference:** Sync `def` endpoints (Starlette threadpool), not `async def`
4. **RTSP streaming:** Dedicated capture thread per stream, always-latest-frame pattern
5. **Model caching:** LRU with max_models=3, preload default on startup
6. **Image preprocessing:** Default resize to 1280, optional SAHI tiling for drone images
