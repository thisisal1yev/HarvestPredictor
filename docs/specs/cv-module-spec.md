# CV Module Specification (v2)

**Status:** Ready for implementation
**Version:** 2 — patched after architecture & feasibility validation
**Scope:** Complete rewrite of the CV (Computer Vision) module for crop disease detection
**Predecessor:** `detection-page-spec.md` (deprecated)
**Validation reports:** `spec-validation-architecture.md`, `spec-validation-feasibility.md`

---

## 1. Overview

HarvestPredictor CV module provides crop disease detection for farmers via:
- **Uploaded ONNX models** — users bring their own models (opensource or custom)
- **Live IP camera streams** — continuous inference on RTSP/RTMP/HTTP-MJPEG feeds
- **Quick one-off photo test** — ad-hoc model validation without persistence

The module is strictly **multi-tenant (user-scoped)**: every user has an isolated environment. No user — including admins — sees another user's models, connections, or detections. Admins manage users and system settings but have **no "god mode"** into CV data. If admin support needs to debug a CV issue, route is "delete and recreate" or direct DB access.

### 1.1 Architecture at a glance

```
Browser (Nuxt 4 + Vue 3)
    │ HTTPS (same-origin)
    ▼
Nginx reverse proxy ──────┐
    │                     │
    ├─ /api/* ─────────► Nuxt (Nitro)
    │                     │
    │                     ├─ Prisma → PostgreSQL
    │                     └─ HTTP → Python CV service (internal)
    │
    ├─ /harvest-snapshots/* ─► MinIO (S3 API, private, presigned only)
    │
    └─ (internal Docker net) ─► Python CV service (FastAPI)
                                    │
                                    ├─ ONNX Runtime (YOLO inference, threadpool)
                                    ├─ OpenCV (RTSP capture, threadpool)
                                    ├─ pyvips (thumbnail generation)
                                    └─ MinIO client (snapshot storage, internal endpoint)
```

### 1.2 Key decisions (locked in)

| Area | Decision |
|---|---|
| Multi-tenancy | User-scoped everything; admin without god mode |
| Storage strategy | Two pre-generated variants (thumb 320px + full 1280px), JPEG q82 progressive |
| Storage backend | MinIO OSS pinned, behind nginx, exit plan to SeaweedFS/Hetzner documented |
| Snapshot retention | 90 days, configurable via env |
| List pagination | 50 items/page + Nuxt UI 4 `UScrollArea virtualize` (TanStack Virtual under the hood) |
| Presigned URL TTL | 1 hour, never cached in DB |
| Camera credentials | AES-256-GCM with key version byte; **encrypted by Python**, Nuxt never holds plaintext or master key |
| Stream reconnect | 3 attempts, exponential backoff 5s/15s/30s + ±20% jitter, then manual |
| Stream throttle | 1-2 fps per active connection |
| Concurrent streams | Configurable limit, default 5 |
| Quick Test | Modal dialog, no persistence, one-shot |
| Frontend framework | Nuxt 4, Vue 3, Nuxt UI 4 (4.5.1) |
| Package manager | **bun** (project ships `bun.lock`; `package.json` `packageManager` field will be corrected to bun) |
| i18n | en/uz |
| 404 vs 403 | `404` for unowned resources to prevent ID enumeration |
| Detection ID | **ULID** (used as both `Detection.id` and snapshot folder name — single ID system) |

---

## 2. UX / Page Structure

### 2.1 Navigation

One sidebar entry: **"Detection"** → `/dashboard/detection`

Single page, three tabs:
1. **Models** (`?tab=models`) — default
2. **Connections** (`?tab=connections`)
3. **Detections** (`?tab=detections`)

### 2.2 Tab 1 — Models

**Purpose:** manage user's ONNX models.

**Elements:**
- "Upload model" button (top-right)
- Grid/list of model cards
- Each card shows: name, crop type, file size, upload date, "Default" badge if applicable
- Per-card actions: **Try** (quick test), Edit, Delete, Set as default

**Upload flow (streaming, no buffering):**
1. Click "Upload model" → drawer opens
2. Fields: Name (required), Crop type (optional), File (`.onnx` only, max 100 MB)
3. Browser POSTs `multipart/form-data` to `/api/cv/models`
4. Nuxt reads only `name`/`cropType` form fields, then **streams the file body** directly to Python CV service via `ofetch` with `ReadableStream` (does NOT use `readMultipartFormData` — see §5 Code Note A)
5. Python validates ONNX (format via `onnx.checker`, size, SHA256 hash), saves to `ml_models/{userId}/{ulid}.onnx`
6. Python returns metadata to Nuxt → Nuxt creates `CVModel` row → returns to client
7. Model appears in list

**Quick Test flow:**
1. Click "Try" on any model card
2. Modal opens with drag-drop zone
3. User drops or selects image (jpg/png, max 10 MB)
4. Frontend POSTs multipart → `/api/cv/models/[id]/quick-test` → Nuxt streams body to Python `/detect/image?modelId=...`
5. Python runs inference → returns detections JSON (see §5.6 Quick Test response shape)
6. Modal shows: uploaded image with bboxes rendered in canvas overlay + list of detected classes with confidence
7. Close modal → **nothing saved** (no Connection, no Detection record, no MinIO object). Quick Test rate-limited to 10/min/user.

### 2.3 Tab 2 — Connections

**Purpose:** manage persistent IP camera sources tied to a model.

**Elements:**
- "Create connection" button
- List of connection cards
- Each card shows: name, status badge (idle/active/disconnected/error), model name, last detection time, optional field name
- Per-card actions: Start/Stop (both disabled when transition would be invalid), Edit, Delete

**Status transitions:**
```
idle ──Start──► active ──Stop──► idle
  │                │
  │                └─reconnect-fail─► error
  │                │
  │                └─cv-restart─────► disconnected
  │
  └─delete──► (gone, MinIO objects scrubbed in DELETE handler)
```

`error` and `disconnected` both require explicit user Start to recover.

**Create flow:**
1. Click "Create connection" → drawer opens
2. Fields:
   - Name (required)
   - Protocol: RTSP / RTMP / HTTP-MJPEG (Postgres enum)
   - Stream URL (without credentials, e.g. `rtsp://192.168.1.10:554/stream`)
   - Username (optional)
   - Password (optional, masked input)
   - Model (dropdown from user's models)
   - Field (optional, dropdown from user's fields)
3. **"Test connection"** button → calls `/api/cv/connections/test` → Nuxt validates URL host (denies RFC1918, loopback, link-local — see §5 SSRF guard) → forwards to Python → Python opens stream with 5s timeout → returns ok/error. Rate-limited 5/min/user.
4. On ok → "Save" button becomes primary
5. On save → Nuxt forwards plaintext credentials to Python `/credentials/encrypt` → Python encrypts via master key → returns ciphertext → Nuxt stores ciphertext in `Connection.usernameEnc` / `passwordEnc`. Plaintext never touches Nuxt memory beyond the request scope.
6. Connection appears with `status=idle`
7. User clicks Start → Nuxt does optimistic DB lock (`UPDATE WHERE status='idle' RETURNING`), 409 if not idle, then POSTs to Python `/connections/start` with `connectionId`, `userId`, `streamToken` (per-stream nonce, in-memory, dies on CV restart)
8. Python kicks off background stream worker, status stays `active`

**Test connection guards (SSRF prevention):**
- Block hostnames resolving to: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, `fc00::/7`
- Resolve hostname server-side, validate, then pass *resolved IP* (not original host) to Python
- 5/min/user rate limit
- Reject `streamUrl` schemes other than `rtsp://`, `rtmp://`, `http://`, `https://`

### 2.4 Tab 3 — Detections

**Purpose:** browse detection history.

**Elements:**
- Filter bar: Connection (dropdown), Class (dropdown), Severity (dropdown), Date range
- `UScrollArea` virtualized list (50 items per page, infinite scroll appends)
- Each detection card shows: thumbnail (or skeleton if `thumbReady=false`) + className + confidence + severity badge + connection name + detectedAt
- Click card → modal with full 1280px image + bboxes drawn + metadata + treatment info (if KnowledgeBase match)

---

## 3. Prisma Schema

### 3.1 Models to DELETE

```
DetectionSession   — replaced by direct Detection → Connection relation
Detection (old)    — rewritten with snapshotKey and connection relation
```

### 3.2 Models to KEEP unchanged

```
CVModel.*KnowledgeBase fields — KB stays public, no user-scoped CRUD in v1
```

### 3.3 Models updated/added

#### `User` — add inverse relations (FIX C1 / I1)

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String
  passwordHash String
  role         String   @default("farmer")
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  farms        Farm[]
  cvModels     CVModel[]      // NEW
  connections  Connection[]   // NEW
  detections   Detection[]    // NEW (denormalized userId — see Detection model)
}
```

#### `Field` — add inverse relation

```prisma
model Field {
  // ... existing fields ...
  connections  Connection[]   // NEW
}
```

#### `CVModel` — switch to FK + multi-tenancy + Postgres enum

```prisma
model CVModel {
  id           String   @id @default(cuid())
  name         String
  filename     String           // ULID-based, no user input
  originalName String
  format       CvModelFormat @default(onnx)
  cropType     String?
  isDefault    Boolean  @default(false)
  fileSize     Int
  hash         String           // SHA256 of .onnx file
  metadata     Json?
  userId       String           // was "uploadedBy" — see migration §3.5
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  user         User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  connections  Connection[]

  @@index([userId])
  @@index([userId, isDefault])
}

enum CvModelFormat {
  onnx
}
```

`isDefault` uniqueness enforced via partial unique index in raw SQL migration (see §3.5):
```sql
CREATE UNIQUE INDEX cvmodel_one_default_per_crop
  ON "CVModel" ("userId", COALESCE("cropType", '__general__'))
  WHERE "isDefault" = TRUE;
```

#### `Connection` — new

```prisma
model Connection {
  id               String              @id @default(cuid())
  name             String
  protocol         CvStreamProtocol
  streamUrl        String              // URL without credentials
  usernameEnc      String?             // AES-256-GCM with key version byte (base64)
  passwordEnc      String?
  status           CvConnectionStatus  @default(idle)
  lastFrameAt      DateTime?
  lastDetectionAt  DateTime?
  errorMessage     String?
  reconnectAttempt Int                 @default(0)
  modelId          String
  userId           String
  fieldId          String?
  createdAt        DateTime            @default(now())
  updatedAt        DateTime            @updatedAt

  model            CVModel     @relation(fields: [modelId], references: [id], onDelete: Restrict)
  user             User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  field            Field?      @relation(fields: [fieldId], references: [id], onDelete: SetNull)
  detections       Detection[]

  @@index([userId, status])
  @@index([modelId])
}

enum CvStreamProtocol {
  rtsp
  rtmp
  http_mjpeg
}

enum CvConnectionStatus {
  idle
  active
  disconnected
  error
}
```

`onDelete: Restrict` on `modelId` prevents deleting a model with active connections — UI shows "Stop and delete N connections first" before allowing model delete.

#### `Detection` — new (with denormalized userId — FIX C3)

```prisma
model Detection {
  id             String              @id          // ULID, generated in Nuxt; matches MinIO folder name
  className      String
  category       CvDetectionCategory
  confidence     Float                            // 0.0 - 1.0
  severity       CvDetectionSeverity
  bbox           Json                             // { x, y, w, h } normalized 0-1, top-left origin
  snapshotKey    String?                          // MinIO key base: "detections/{YYYY}/{MM}/{DD}/{ulid}"
                                                  // actual objects: "{snapshotKey}/full.jpg" and "{snapshotKey}/thumb.jpg"
  thumbReady     Boolean             @default(false)
  connectionId   String
  userId         String                           // DENORMALIZED for fast user-scoped reads (no JOIN)
  detectedAt     DateTime            @default(now())
  lastSeenAt     DateTime            @default(now())  // updated on dedup hit

  connection     Connection @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  user           User       @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, detectedAt(sort: Desc)])       // primary listing index
  @@index([connectionId, detectedAt(sort: Desc)]) // per-connection listing
  @@index([className])
  @@index([thumbReady, detectedAt])
}

enum CvDetectionCategory {
  disease
  pest
  weed
}

enum CvDetectionSeverity {
  confirmed
  likely
  possible
}
```

**Note on key layout:** `snapshotKey` is **date-first**, no `userId` in the path (per research final-report.md). Ownership lives in the DB row, not the object key. Lifecycle and date-range queries are simple.

### 3.4 KnowledgeBase

Unchanged in this spec. Public, system-seeded, read-only for users in v1. User contributions deferred to §15.

### 3.5 Migration plan (concrete, ordered)

The current schema (`prisma/schema.prisma`) still has:
- `DetectionSession` (lines 179-196)
- old `Detection` (lines 198-212)
- `CVModel.uploadedBy String` (line 173) without FK
- `User` model with no CV relations

#### Migration 1 — `cv_module_v1`

Generated migration must:

1. **DROP** `DetectionSession` (cascades old `Detection`)
2. **DROP** old `Detection` if any survives
3. **CREATE TYPE** the four new Postgres enums (`CvModelFormat`, `CvStreamProtocol`, `CvConnectionStatus`, `CvDetectionCategory`, `CvDetectionSeverity`)
4. **ALTER TABLE CVModel:**
   - Backfill ambiguity is resolved by **dropping and recreating the table** (acceptable because the existing seed `down()` already TRUNCATEs it; no production data to preserve at this stage). Document this clearly in the migration's comment header.
   - Recreate with `userId String` + FK + indexes
5. **CREATE TABLE Connection** with FKs to User, CVModel, Field
6. **CREATE TABLE Detection** with FKs to Connection (cascade) and User (cascade), denormalized `userId`
7. **CREATE INDEX** all `@@index` directives
8. **Raw SQL** for the partial unique index:
   ```sql
   CREATE UNIQUE INDEX cvmodel_one_default_per_crop
     ON "CVModel" ("userId", COALESCE("cropType", '__general__'))
     WHERE "isDefault" = TRUE;
   ```

Add inverse relations to `User` and `Field` in the same Prisma schema edit so `prisma generate` succeeds (FIX C1 / I1).

`prisma migrate dev --name cv_module_v1` — verify it runs cleanly against a fresh DB before merging.

---

## 4. Python CV Service

Located at `cv-service/`. FastAPI + ONNX Runtime + OpenCV + pyvips.

### 4.1 Dependencies (`requirements.txt`)

```
fastapi==0.115.12
uvicorn[standard]==0.34.2
onnxruntime==1.22.0          # verify wheel availability for python:3.11-slim before pinning
onnx==1.17.0                 # for safe validator (onnx.checker, no InferenceSession at validation)
opencv-python-headless==4.11.0.86
pyvips==3.1.1                # BUMP from 2.2.3 — 2-year-old release replaced
minio==7.2.16                # BUMP minor for bugfixes
python-ulid==3.1.0           # BUMP — 3.0.0 was unavailable
python-multipart==0.0.20
pydantic-settings==2.9.1
httpx==0.28.1
numpy==2.2.6
Pillow==11.2.1
pyyaml==6.0.2
cryptography==46.0.0         # BUMP for CVE fixes
```

#### Dockerfile system deps

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 \
    libvips libvips-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*
```

`libgl1-mesa-glx` is deprecated on Debian 12 — use `libgl1`. **Both** `libvips` AND `libvips-dev` required for pyvips (per libvips/pyvips#83).

### 4.2 Directory structure

```
cv-service/
├── app/
│   ├── main.py              # FastAPI app, lifespan (sets OPENCV_FFMPEG_CAPTURE_OPTIONS BEFORE cv2 import)
│   ├── config.py            # pydantic-settings
│   ├── routers/
│   │   ├── health.py        # GET /health (returns {status:"ok"} only — no model list)
│   │   ├── models.py        # POST /models/upload, DELETE /models/{userId}/{filename}
│   │   ├── detect.py        # POST /detect/image (Quick Test)
│   │   ├── connections.py   # /connections/test, /start, /stop
│   │   └── credentials.py   # POST /credentials/encrypt (Nuxt uses this on Connection save)
│   ├── services/
│   │   ├── onnx_validator.py    # onnx.checker only, no InferenceSession
│   │   ├── model_manager.py     # LRU cache of ONNX sessions, CPUExecutionProvider only
│   │   ├── detector.py          # Inference + YOLO output parsing + severity tiers
│   │   ├── image_processor.py   # cv2 encode/resize, runs in thread pool
│   │   ├── thumbnail_worker.py  # pyvips + bounded ThreadPoolExecutor (maxsize=200)
│   │   ├── stream_manager.py    # Background asyncio.Tasks; cv2 calls in run_in_executor
│   │   ├── reconnect.py         # Exponential backoff with jitter
│   │   ├── minio_client.py      # internal endpoint; service account creds (NOT root)
│   │   └── crypto.py            # AES-256-GCM encrypt + decrypt (master key only here)
│   └── models/
│       └── schemas.py       # Pydantic request/response
├── ml_models/               # User-uploaded .onnx files, structure: ml_models/{userId}/{ulid}.onnx
├── Dockerfile
├── requirements.txt
└── .env.example
```

### 4.3 Endpoints

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/health` | Healthcheck — returns `{"status":"ok"}` only | None |
| POST | `/models/upload` | Validate + store .onnx (streamed body) | API key |
| DELETE | `/models/{userId}/{filename}` | Remove model file | API key |
| POST | `/detect/image?modelId=` | One-shot inference (Quick Test) | API key |
| POST | `/credentials/encrypt` | Encrypt plaintext via master key, return ciphertext | API key |
| POST | `/connections/test` | Test stream connectivity (5s open timeout) | API key |
| POST | `/connections/start` | Start background inference (`{connectionId, userId, streamToken, ...}`) | API key |
| POST | `/connections/stop` | Stop background inference | API key |
| GET | `/connections/active` | Return active connection IDs (used by Nuxt for reconcile) | API key |

**Authentication:** shared `CV_API_KEY` in `X-API-Key` header. **In addition**, nginx restricts `/api/cv/_internal/*` and Python's container ports to the Docker bridge network only (see §6.3 nginx config).

### 4.4 Stream Manager — corrected pseudocode

`cv2.VideoCapture` and `cap.read()` are blocking C calls. They MUST run in a thread pool to avoid stalling the event loop.

Also: `CAP_PROP_OPEN_TIMEOUT_MSEC` must be set BEFORE the URL is opened, and only works on the FFMPEG backend. The pattern is `cap = VideoCapture()` then `cap.open(url, CAP_FFMPEG, [params])`.

Set `OPENCV_FFMPEG_CAPTURE_OPTIONS` env var **before** `import cv2` for global RTSP transport tuning.

```python
# main.py — at the very top, BEFORE importing cv2
import os
os.environ.setdefault(
    "OPENCV_FFMPEG_CAPTURE_OPTIONS",
    "rtsp_transport;tcp|stimeout;5000000",
)
import cv2  # noqa: E402
```

```python
# stream_manager.py
import asyncio
import cv2
import random
from concurrent.futures import ThreadPoolExecutor

STREAM_THROTTLE_SECONDS = 0.5
MAX_RECONNECT_ATTEMPTS = 3
BACKOFF = [5, 15, 30]

# Per-stream executor (single thread per worker, isolated from API event loop)
def make_executor() -> ThreadPoolExecutor:
    return ThreadPoolExecutor(max_workers=1, thread_name_prefix="stream")

async def open_capture(url: str) -> cv2.VideoCapture:
    """Open RTSP capture in a thread, with explicit FFMPEG timeouts."""
    def _open() -> cv2.VideoCapture:
        cap = cv2.VideoCapture()
        cap.open(url, cv2.CAP_FFMPEG, [
            int(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC), 5000,
            int(cv2.CAP_PROP_READ_TIMEOUT_MSEC), 5000,
        ])
        return cap
    return await asyncio.to_thread(_open)

async def read_frame(cap: cv2.VideoCapture) -> tuple[bool, "np.ndarray | None"]:
    return await asyncio.to_thread(cap.read)

async def release_capture(cap: cv2.VideoCapture) -> None:
    await asyncio.to_thread(cap.release)

def backoff_delay(attempt: int) -> float:
    base = BACKOFF[min(attempt - 1, len(BACKOFF) - 1)]
    return base * (0.8 + random.random() * 0.4)  # ±20% jitter

async def stream_worker(connection: "ConnectionConfig", cancel: asyncio.Event):
    cap = await open_capture(build_url_with_creds(connection))
    attempt = 0
    try:
        while not cancel.is_set():
            ok, frame = await read_frame(cap)
            if not ok:
                attempt += 1
                if attempt > MAX_RECONNECT_ATTEMPTS:
                    await notify_status(connection.id, "error", "stream dead after 3 attempts")
                    return
                await asyncio.sleep(backoff_delay(attempt))
                await release_capture(cap)
                cap = await open_capture(build_url_with_creds(connection))
                continue

            attempt = 0
            detections = await asyncio.to_thread(
                detector.infer, frame, connection.model_id
            )
            for det in deduplicate(detections, recent_cache):
                await save_snapshot_and_notify(frame, det, connection)

            await asyncio.sleep(STREAM_THROTTLE_SECONDS)
    finally:
        await release_capture(cap)
```

**ONNX Runtime `session.run` is also blocking C code** — wrap in `asyncio.to_thread` (shown above).

**Concurrency limit:** `MAX_CONCURRENT_STREAMS` env var, default 5. `POST /connections/start` returns 429 if limit reached. UI handles 429 with toast: "Stream limit reached. Stop another connection first."

**Deduplication cache:** per-connection in-memory dict of `(className, rounded_bbox_tuple) → last_seen_ts`. Within 60s window: update `lastSeenAt` on existing Detection via webhook (see §5.4 — webhook upserts on `(connectionId, className, rounded_bbox)`). After 60s: new Detection. (Resolves §15 Q7.)

### 4.5 Reconnect

3 attempts with exponential backoff `5s / 15s / 30s` + ±20% jitter (already shown in §4.4 `backoff_delay`). After 3 fails → status=error, errorMessage set, background task stops. User must manually Start to recover.

### 4.6 Snapshot save flow (race-free order)

```
1. Frame captured from stream worker
2. YOLO inference → detections (in thread pool)
3. For each detection passing dedup:
   a. Generate ULID = ulid_for_this_detection
   b. snapshot_key = f"detections/{YYYY}/{MM}/{DD}/{ulid_for_this_detection}"
   c. Encode full frame → cv2.imencode (in thread pool) → bytes
   d. Upload to MinIO as "{snapshot_key}/full.jpg" — AWAIT this completion
   e. POST detection metadata to Nuxt /api/cv/_internal/detection
      Body: { id: ulid_for_this_detection, connectionId, userId, className,
              category, confidence, severity, bbox, snapshotKey, streamToken }
      Nuxt creates Detection row with id = ULID.
   f. Submit thumbnail task to bounded ThreadPoolExecutor (maxsize=200):
      - pyvips resize frame to 320px max
      - JPEG q=78 progressive
      - Upload to MinIO as "{snapshot_key}/thumb.jpg"
      - On success: POST /api/cv/_internal/thumb-ready { id: ulid_for_this_detection }
        (Nuxt updates thumbReady=true; if row missing, returns 404 — but this can't happen
        because step e completes BEFORE the thumbnail job is enqueued)
```

**Why ULID-as-ID:** Python generates the ULID, uses it as the MinIO folder name, and sends it as `id` in the webhook. Nuxt accepts it as `Detection.id`. No second ID system, no race between detection insert and thumb-ready (see X1 fix).

**Why upload before webhook:** if `e` fires before `d` completes, browser presigned URL for `full.jpg` returns 404. Order matters.

**ThreadPoolExecutor backpressure:** if queue fills (200 pending thumbnails), drop oldest, log warning. Detection row stays with `thumbReady=false` forever — UI shows skeleton in place.

---

## 5. Nuxt API Routes

All routes under `server/api/cv/`. Auth via `requireUserSession()`. Ownership enforced via Prisma `where: { userId: session.user.id }` in every read; for `/[id]` endpoints, missing rows return **404** (not 403, to avoid ID enumeration).

### 5.1 Models

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/cv/models` | — | `CVModel[]` (user's only) |
| POST | `/api/cv/models` | multipart (streamed) | Created `CVModel` |
| GET | `/api/cv/models/[id]` | — | `CVModel` or 404 |
| PUT | `/api/cv/models/[id]` | `{ name?, cropType?, isDefault? }` | Updated `CVModel` |
| DELETE | `/api/cv/models/[id]` | — | 204; **fails 409** if model has connections (Prisma `Restrict`); UI must pre-check |
| POST | `/api/cv/models/[id]/quick-test` | multipart (streamed) | Quick Test response (see §5.6) |

### 5.2 Connections

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/cv/connections` | — | `Connection[]` |
| POST | `/api/cv/connections` | `{ name, protocol, streamUrl, username?, password?, modelId, fieldId? }` | Created `Connection` (creds masked) |
| GET | `/api/cv/connections/[id]` | — | `Connection` (creds as `"***"`) or 404 |
| PUT | `/api/cv/connections/[id]` | partial | Updated |
| DELETE | `/api/cv/connections/[id]` | — | 204; handler stops Python task, deletes MinIO objects under all snapshotKeys, then Cascade-deletes rows |
| POST | `/api/cv/connections/test` | full create body | `{ ok: bool, message: string }`; SSRF guard + 5/min/user rate limit |
| POST | `/api/cv/connections/[id]/start` | — | `{ status: "active", streamToken }`; uses optimistic lock (`UPDATE WHERE status='idle' RETURNING`); 409 if not idle |
| POST | `/api/cv/connections/[id]/stop` | — | `{ status: "idle" }` |

### 5.3 Detections

| Method | Path | Query | Returns |
|---|---|---|---|
| GET | `/api/cv/detections` | `?connectionId=&className=&severity=&from=&to=&page=&limit=50` | `{ items: DetectionDto[], total, page }`; thumbnail URLs presigned per request; `thumbUrl: null` if `thumbReady=false` |
| GET | `/api/cv/detections/[id]` | — | `DetectionDto & { fullUrl, treatment? }` or 404 |
| DELETE | `/api/cv/detections/[id]` | — | 204; deletes MinIO objects under `snapshotKey/` prefix |

`DetectionDto` always includes `userId` server-side check; the response body never echoes `userId` (no need on client).

### 5.4 Internal webhooks (Python → Nuxt)

| Method | Path | Body | Auth |
|---|---|---|---|
| POST | `/api/cv/_internal/detection` | `{ id (ULID), connectionId, userId, className, category, confidence, severity, bbox, snapshotKey, streamToken }` | API key + nginx IP allowlist + streamToken validation |
| POST | `/api/cv/_internal/thumb-ready` | `{ id }` | API key + nginx IP allowlist |
| POST | `/api/cv/_internal/connection-status` | `{ connectionId, status, errorMessage?, streamToken? }` | API key + nginx IP allowlist |
| POST | `/api/cv/_internal/reconcile` | `{ activeConnectionIds: string[] }` | API key + nginx IP allowlist |

**Webhook handler responsibilities:**
- `/detection` — verifies `connectionId` exists, belongs to `userId`, currently `status='active'`, and `streamToken` matches the in-memory token issued at `/start`. Then performs upsert based on dedup window: if there's an existing Detection in the last 60s with matching `(connectionId, className, rounded_bbox)`, update `lastSeenAt`; else insert new with `id = body.id`.
- `/thumb-ready` — `UPDATE Detection SET thumbReady=TRUE WHERE id = ?`. 404 if missing (should not happen given §4.6 ordering).
- `/connection-status` — sets status, optionally errorMessage; clears streamToken if status moves out of `active`.
- `/reconcile` — called by Python on its own startup. Body is the list of connection IDs Python knows about (zero on cold start). Nuxt: `UPDATE Connection SET status='disconnected', errorMessage='cv-service restart', updatedAt=now() WHERE status='active' AND id NOT IN (...)`. (Resolves I4 startup reconciliation.)

### 5.5 Presigned URL helper — corrected (FIX C3, I3, M8)

**Critical:** The S3 client must be created **lazily** inside a function (not at module load), and must use `minioPublicEndpoint`. The nginx setup mounts `/harvest-snapshots/` directly (no rewrite), so the SDK signs the path as `/harvest-snapshots/{key}` and MinIO sees the same — signatures match.

```typescript
// server/utils/minioClient.ts
import { S3Client, GetObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

let _s3: S3Client | null = null

function s3(): S3Client {
  if (_s3) return _s3
  const cfg = useRuntimeConfig()
  _s3 = new S3Client({
    endpoint: cfg.minioPublicEndpoint as string,  // e.g. "https://app.example.com"
    region: "us-east-1",                          // ignored by MinIO; SDK requires non-empty
    credentials: {
      accessKeyId: cfg.minioAccessKey as string,
      secretAccessKey: cfg.minioSecretKey as string,
    },
    forcePathStyle: true,
  })
  return _s3
}

export async function presignGet(key: string, ttlSeconds?: number): Promise<string> {
  const cfg = useRuntimeConfig()
  const cmd = new GetObjectCommand({ Bucket: cfg.minioBucket as string, Key: key })
  return getSignedUrl(s3(), cmd, {
    expiresIn: ttlSeconds ?? Number(cfg.minioPresignedTtl) || 3600,
  })
}

export async function deleteSnapshotPrefix(snapshotKey: string): Promise<void> {
  // snapshotKey = "detections/2026/04/08/01J..."
  // Objects under it: full.jpg, thumb.jpg
  const cfg = useRuntimeConfig()
  await s3().send(new DeleteObjectsCommand({
    Bucket: cfg.minioBucket as string,
    Delete: {
      Objects: [
        { Key: `${snapshotKey}/full.jpg` },
        { Key: `${snapshotKey}/thumb.jpg` },
      ],
    },
  }))
}
```

**Never cache presigned URLs in DB.** Generate on every API response.

### 5.6 Quick Test response shape

```typescript
// Response from POST /api/cv/models/[id]/quick-test
type QuickTestResponse = {
  modelId: string
  inferenceMs: number
  imageWidth: number   // pixel dimensions of submitted image (for canvas overlay scale)
  imageHeight: number
  detections: Array<{
    className: string
    category: "disease" | "pest" | "weed"
    confidence: number      // 0..1
    severity: "confirmed" | "likely" | "possible"
    bbox: { x: number; y: number; w: number; h: number }  // normalized 0..1, top-left origin
  }>
}
```

### 5.7 Code Note A — streaming multipart upload (FIX C2)

`readMultipartFormData` buffers everything into memory (h3js/h3#851). At 100 MB ONNX × concurrent users → OOM. The route handler must:

1. Read non-file form fields from a small initial chunk OR pass them as query params
2. Stream the request body straight to Python via `proxyRequest` or `ofetch` with `body: getRequestWebStream()`

Sketch:
```typescript
// server/api/cv/models/index.post.ts
export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id

  const cfg = useRuntimeConfig()
  const url = new URL(`${cfg.cvServiceUrl}/models/upload`)
  url.searchParams.set("userId", userId)

  // Stream raw body to Python; Python parses multipart
  const upstream = await $fetch.raw(url.toString(), {
    method: "POST",
    headers: {
      "X-API-Key": cfg.cvApiKey as string,
      "Content-Type": getRequestHeader(event, "content-type") ?? "",
      "Content-Length": getRequestHeader(event, "content-length") ?? "",
    },
    body: getRequestWebStream(event),
    duplex: "half",
  })

  const meta = upstream._data as { filename: string; sha256: string; fileSize: number; name: string; cropType?: string }
  return await prisma.cVModel.create({
    data: {
      userId,
      name: meta.name,
      filename: meta.filename,
      originalName: meta.filename,
      hash: meta.sha256,
      fileSize: meta.fileSize,
      cropType: meta.cropType ?? null,
    },
  })
})
```

**Nginx must allow body size on `/api/cv/models` too** — see §6.3 (`client_max_body_size 110m;` at server level).

---

## 6. MinIO Setup

### 6.1 Docker compose — full multi-service stack

The current `docker-compose.yml` only has `cv-service`. Replace with:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=${POSTGRES_USER}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=${POSTGRES_DB}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER"]
      interval: 10s

  minio:
    image: minio/minio:RELEASE.2025-04-22T22-12-26Z   # last release before community-console strip
    command: server /data --console-address ":9001"
    environment:
      - MINIO_ROOT_USER=${MINIO_ROOT_USER}
      - MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}
      - MINIO_SERVER_URL=${PUBLIC_URL}              # MUST equal nginx public URL
    volumes:
      - minio-data:/data
    restart: unless-stopped
    # No host port published — only nginx talks to MinIO
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 15s

  cv-service:
    build: ./cv-service
    environment:
      - CV_API_KEY=${CV_API_KEY}
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}            # only this service has the master key
      - MODEL_DIR=/app/ml_models
      - MINIO_ENDPOINT=http://minio:9000            # internal: bypass nginx for performance
      - MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY}
      - MINIO_SECRET_KEY=${MINIO_SECRET_KEY}
      - MINIO_BUCKET=${MINIO_BUCKET}
      - NUXT_INTERNAL_URL=http://nuxt:3000
      - MAX_CONCURRENT_STREAMS=${MAX_CONCURRENT_STREAMS}
      - STREAM_THROTTLE_SECONDS=${STREAM_THROTTLE_SECONDS}
      - STREAM_DEDUP_WINDOW_SECONDS=${STREAM_DEDUP_WINDOW_SECONDS}
    volumes:
      - ./cv-service/ml_models:/app/ml_models
    depends_on:
      minio:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8100/health"]
      interval: 15s

  nuxt:
    build: .
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - NUXT_SESSION_PASSWORD=${NUXT_SESSION_PASSWORD}
      - CV_SERVICE_URL=http://cv-service:8100
      - CV_API_KEY=${CV_API_KEY}
      - MINIO_ENDPOINT=http://minio:9000            # internal (rarely used by Nuxt)
      - MINIO_PUBLIC_ENDPOINT=${PUBLIC_URL}         # for presigned URL generation
      - MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY}
      - MINIO_SECRET_KEY=${MINIO_SECRET_KEY}
      - MINIO_BUCKET=${MINIO_BUCKET}
      - MINIO_PRESIGNED_TTL=${MINIO_PRESIGNED_TTL}
      # NOTE: ENCRYPTION_KEY intentionally not passed to Nuxt — Python encrypts via /credentials/encrypt
    depends_on:
      postgres:
        condition: service_healthy
      cv-service:
        condition: service_healthy
    restart: unless-stopped

  nginx:
    image: nginx:1.27-alpine
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/certs:/etc/ssl:ro
    depends_on:
      - nuxt
      - minio
    restart: unless-stopped

volumes:
  postgres-data:
  minio-data:
```

### 6.2 Bucket initialization

One bucket: `harvest-snapshots`, **private**. Plus a **service account** scoped to read+write on `detections/*` only — never use root credentials from app code.

```bash
# In an init container or one-off script:
mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
mc mb --ignore-existing local/harvest-snapshots
mc anonymous set none local/harvest-snapshots

# Service account for app services
mc admin user svcacct add local "$MINIO_ROOT_USER" \
  --access-key "$MINIO_ACCESS_KEY" \
  --secret-key "$MINIO_SECRET_KEY" \
  --policy rw-detections-only.json

# rw-detections-only.json — restrict service account to detections/* prefix
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::harvest-snapshots/detections/*"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": ["arn:aws:s3:::harvest-snapshots"],
      "Condition": { "StringLike": { "s3:prefix": ["detections/*"] } }
    }
  ]
}

# Lifecycle: auto-delete objects older than 90 days, bucket-wide
mc ilm rule add --expire-days 90 local/harvest-snapshots
```

**Key layout (date-first, no userId — fixes I5 against research):**
```
harvest-snapshots/
└── detections/
    └── {YYYY}/
        └── {MM}/
            └── {DD}/
                └── {ulid}/
                    ├── full.jpg
                    └── thumb.jpg
```

Ownership lives in `Detection.userId` (DB), never in the key path. This prevents IDOR if a future endpoint takes user-supplied keys.

### 6.3 Nginx reverse proxy (FIX C3 — drop the rewrite)

The previous spec used `rewrite ^/media/(.*) /harvest-snapshots/$1` which breaks SigV4 signatures (the SDK signs the canonical path including the bucket; the rewrite removes the bucket from the URL but the signature is unchanged, so MinIO 403s).

Correct pattern: mount `/harvest-snapshots/` directly at the same path the SDK signs.

```nginx
server {
    listen 443 ssl http2;
    server_name app.harvestpredictor.example;

    ssl_certificate     /etc/ssl/certs/app.crt;
    ssl_certificate_key /etc/ssl/private/app.key;

    # Server-level: covers /api/cv/models uploads (100 MB ONNX)
    client_max_body_size 110m;

    # Nuxt app
    location / {
        proxy_pass http://nuxt:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_http_version 1.1;
    }

    # MinIO bucket — mounted at the SAME path the SDK signs (/harvest-snapshots/...)
    # Drops the previous /media/ rewrite which broke signatures.
    location /harvest-snapshots/ {
        proxy_pass http://minio:9000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        chunked_transfer_encoding off;
        proxy_connect_timeout 5s;
        proxy_read_timeout 60s;          # bumped from 30s for large image / slow LTE
    }

    # Internal webhook endpoints — Docker bridge network only
    location /api/cv/_internal/ {
        allow 172.16.0.0/12;             # Docker default bridge range
        allow 10.0.0.0/8;                # If using a custom user-defined network
        deny all;
        proxy_pass http://nuxt:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

**`MINIO_SERVER_URL`** in docker-compose env equals the public host (no path suffix). The SDK signs URLs of the form `https://app.example.com/harvest-snapshots/{key}?X-Amz-Signature=...` — MinIO validates against the same canonical path. No rewrite, no mismatch.

If you ever want a `/media/` alias for branding, do it via **client-side** URL rewriting after presign, not nginx.

---

## 7. Credential Encryption (AES-256-GCM, key version byte, Python-only key)

### 7.1 Master key

```bash
# .env (generate once, 32 raw bytes encoded base64):
ENCRYPTION_KEY=base64:<openssl rand -base64 32>
```

**Critical:** the `ENCRYPTION_KEY` env var is **only injected into the Python CV service container**. Nuxt does NOT have it. Nuxt forwards plaintext credentials to Python's `/credentials/encrypt` once on save, receives ciphertext, and stores ciphertext in DB. After that, Nuxt never sees plaintext or the key — it just hands ciphertext back to Python on `/connections/start`.

**Why:** if Nuxt is compromised (more attack surface — public web traffic), the master key remains in the more-isolated Python container. Trade-off: one extra HTTP hop on Connection save. Worth it.

### 7.2 Ciphertext layout (with version byte for rotation)

```
version(1) | iv(12) | tag(16) | ciphertext(N)
```

`version=0x01` for v1 of the scheme. Future rotation: encrypt new credentials with `version=0x02` under a new key, decrypt either at read time. Zero data migration.

### 7.3 Python implementation (encrypt + decrypt)

```python
# cv-service/app/services/crypto.py
import base64
import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

VERSION = 0x01
_KEY: bytes | None = None

def _key() -> bytes:
    global _KEY
    if _KEY is None:
        raw = os.environ["ENCRYPTION_KEY"]
        if raw.startswith("base64:"):
            raw = raw[len("base64:"):]
        _KEY = base64.b64decode(raw)
        if len(_KEY) != 32:
            raise RuntimeError("ENCRYPTION_KEY must decode to exactly 32 bytes")
    return _KEY

def encrypt(plaintext: str) -> str:
    """version | iv(12) | tag(16) | ciphertext, base64-encoded."""
    iv = os.urandom(12)
    aesgcm = AESGCM(_key())
    ct_with_tag = aesgcm.encrypt(iv, plaintext.encode("utf-8"), None)
    # cryptography returns ciphertext||tag concatenated. Split for layout.
    ct, tag = ct_with_tag[:-16], ct_with_tag[-16:]
    blob = bytes([VERSION]) + iv + tag + ct
    return base64.b64encode(blob).decode("ascii")

def decrypt(payload_b64: str) -> str:
    blob = base64.b64decode(payload_b64)
    version = blob[0]
    if version != VERSION:
        raise RuntimeError(f"Unsupported ciphertext version: {version}")
    iv = blob[1:13]
    tag = blob[13:29]
    ct = blob[29:]
    return AESGCM(_key()).decrypt(iv, ct + tag, None).decode("utf-8")
```

**Round-trip test required** before merging — add to CI.

### 7.4 Rotation flow (documented, not implemented in v1)

To rotate:
1. Generate new key, store as `ENCRYPTION_KEY_V2` in env
2. Bump `crypto.py` `VERSION` to `0x02`, `_key()` returns the new key for `0x02`, falls back to old key for `0x01` decrypt
3. On any Connection save, re-encrypt with v2
4. Background job: read all `usernameEnc`/`passwordEnc` rows, decrypt with old key, encrypt with new, write back
5. Once 100% migrated, remove old key from env

### 7.5 Compromise response

If `ENCRYPTION_KEY` leaks:
1. Generate new key, deploy
2. Run SQL: `UPDATE "Connection" SET "usernameEnc" = NULL, "passwordEnc" = NULL, status = 'idle', "errorMessage" = 'Re-enter credentials';`
3. Email all users with active connections
4. They re-enter creds via the existing Edit UI

---

## 8. Environment Variables

```bash
# .env

# Database
POSTGRES_USER=harvest
POSTGRES_PASSWORD=<strong-random-32>
POSTGRES_DB=harvestpredictor
DATABASE_URL=postgresql://harvest:${POSTGRES_PASSWORD}@postgres:5432/harvestpredictor

# Public URL (used by both nginx server_name and MINIO_SERVER_URL)
PUBLIC_URL=https://app.harvestpredictor.example

# Nuxt auth
NUXT_SESSION_PASSWORD=<strong-random-32>

# MinIO — root credentials (only used by init script + MinIO itself)
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=<strong-random-32>

# MinIO — service account (used by Nuxt + Python at runtime)
MINIO_ACCESS_KEY=<svcacct-access-key>
MINIO_SECRET_KEY=<svcacct-secret-key>
MINIO_BUCKET=harvest-snapshots
MINIO_PRESIGNED_TTL=3600                              # 1 hour
# NOTE: MINIO_ENDPOINT and MINIO_PUBLIC_ENDPOINT are set per-service in docker-compose, not here

# CV Service ↔ Nuxt
CV_API_KEY=<strong-random-32>                         # shared Nuxt <-> Python

# Encryption — INJECTED ONLY INTO cv-service container
ENCRYPTION_KEY=base64:<openssl rand -base64 32>

# Stream limits
MAX_CONCURRENT_STREAMS=5
STREAM_THROTTLE_SECONDS=0.5
STREAM_DEDUP_WINDOW_SECONDS=60
```

`nuxt.config.ts` `runtimeConfig`:
```typescript
runtimeConfig: {
  cvServiceUrl: "",
  cvApiKey: "",
  // NO encryptionKey on Nuxt
  minioPublicEndpoint: "",
  minioAccessKey: "",
  minioSecretKey: "",
  minioBucket: "",
  minioPresignedTtl: "3600",
}
```

---

## 9. Frontend Components

Located at `app/components/cv/`. Naming: no `Cv` prefix (global auto-import with `pathPrefix: false`, which is the current `nuxt.config.ts` setting).

### 9.1 Components to create

| File | Purpose |
|---|---|
| `ModelCard.vue` | Single model card with Try/Edit/Delete/Default actions |
| `ModelUploadDrawer.vue` | Upload form in drawer (streamed POST) |
| `QuickTestModal.vue` | Modal with drag-drop + canvas bbox overlay + results list |
| `ConnectionCard.vue` | Connection card with status badge + Start/Stop |
| `ConnectionFormDrawer.vue` | Create/edit form with Test connection button |
| `DetectionCard.vue` | Detection card with thumbnail (or skeleton if `thumbReady=false`) |
| `DetectionDetailModal.vue` | Full-size image + bboxes + metadata + treatment |
| `DetectionsFilterBar.vue` | Filter dropdowns |
| `BBoxOverlay.vue` | Canvas-based bbox rendering on top of an image |
| `StatusBadge.vue` | Connection status badge (idle/active/disconnected/error) |

### 9.2 BBoxOverlay implementation

```vue
<!-- app/components/cv/BBoxOverlay.vue -->
<script setup lang="ts">
type Box = { x: number; y: number; w: number; h: number; label: string; confidence: number }
const props = defineProps<{ src: string; boxes: Box[] }>()

const canvasRef = ref<HTMLCanvasElement>()
const imgRef = ref<HTMLImageElement>()

function draw() {
  const c = canvasRef.value, i = imgRef.value
  if (!c || !i) return
  c.width = i.naturalWidth
  c.height = i.naturalHeight
  const ctx = c.getContext('2d')!
  ctx.drawImage(i, 0, 0)
  ctx.lineWidth = Math.max(2, c.width / 320)
  ctx.font = `${Math.max(12, c.width / 64)}px sans-serif`
  for (const b of props.boxes) {
    const x = b.x * c.width
    const y = b.y * c.height
    const w = b.w * c.width
    const h = b.h * c.height
    ctx.strokeStyle = severityColor(b.confidence)
    ctx.strokeRect(x, y, w, h)
    ctx.fillStyle = severityColor(b.confidence)
    ctx.fillText(`${b.label} ${(b.confidence * 100).toFixed(0)}%`, x, y - 4)
  }
}

function severityColor(c: number): string {
  if (c >= 0.8) return 'red'
  if (c >= 0.6) return 'orange'
  return 'yellow'
}
</script>

<template>
  <div>
    <img ref="imgRef" :src="src" class="hidden" crossorigin="anonymous" @load="draw" />
    <canvas ref="canvasRef" class="max-w-full" />
  </div>
</template>
```

`bbox` is normalized 0-1 with **top-left origin** matching `Detection.bbox` and Quick Test response.

### 9.3 Composables

| File | Purpose |
|---|---|
| `app/composables/useCVModels.ts` | CRUD + `quickTest` method |
| `app/composables/useCVConnections.ts` | CRUD + `start`/`stop`/`test` methods |
| `app/composables/useCVDetections.ts` | List with filters + detail |

### 9.4 Page

**File:** `app/pages/dashboard/detection.vue`

```vue
<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'auth' })
const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const activeTab = computed({
  get: () => (route.query.tab as string) || 'models',
  set: (v) => router.replace({ query: { ...route.query, tab: v } }),
})

const tabs = [
  { label: t('detection.tabs.models'),      value: 'models',      icon: 'i-lucide-boxes' },
  { label: t('detection.tabs.connections'), value: 'connections', icon: 'i-lucide-plug' },
  { label: t('detection.tabs.detections'),  value: 'detections',  icon: 'i-lucide-scan-eye' },
]
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <UDashboardNavbar :title="t('detection.title')" />
    </template>
    <template #body>
      <UTabs v-model="activeTab" :items="tabs" />
      <ModelsTab      v-if="activeTab === 'models'" />
      <ConnectionsTab v-if="activeTab === 'connections'" />
      <DetectionsTab  v-if="activeTab === 'detections'" />
    </template>
  </UDashboardPanel>
</template>
```

### 9.5 Virtual scrolling — use `UScrollArea`, NOT `@tanstack/vue-virtual`

Nuxt UI 4 `UScrollArea` exposes a `virtualize` prop backed by TanStack Virtual internally. **Do not install `@tanstack/vue-virtual` separately.** Use:

```vue
<UScrollArea
  :items="detections"
  :virtualize="{ estimateSize: 96, gap: 8 }"
  class="h-full"
>
  <template #default="{ item }">
    <DetectionCard :detection="item" />
  </template>
</UScrollArea>
```

For lists < 200 items, plain `v-for` is fine.

### 9.6 NPM dependencies to add

```bash
bun add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

**No** `@tanstack/vue-virtual` install.

**Also: fix `package.json` `packageManager` field** — currently declares `pnpm@10.28.2` but lockfile is `bun.lock`. Edit `package.json`:
```json
"packageManager": "bun@1.2.40"
```
(Or whatever current bun version is in dev container.) Without this fix, corepack will install pnpm and confuse CI.

---

## 10. i18n Keys

Add to both `i18n/locales/en.json` and `i18n/locales/uz.json`:

```json
{
  "nav": {
    "detection": "Detection"
  },
  "detection": {
    "title": "Detection",
    "tabs": {
      "models": "Models",
      "connections": "Connections",
      "detections": "Detections"
    },
    "models": {
      "upload": "Upload model",
      "try": "Try",
      "noModels": "No models yet. Upload your first ONNX model.",
      "deleteBlocked": "This model is in use by {n} connection(s). Stop and delete them first.",
      "form": {
        "name": "Name",
        "cropType": "Crop type",
        "file": "ONNX file"
      },
      "quickTest": {
        "title": "Quick test",
        "drop": "Drop an image here or click to select",
        "noDetections": "No detections found",
        "rateLimit": "Quick test rate limit reached. Try again in a minute."
      }
    },
    "connections": {
      "create": "Create connection",
      "start": "Start",
      "stop": "Stop",
      "test": "Test connection",
      "testOk": "Connection successful",
      "testFail": "Connection failed",
      "limitReached": "Stream limit reached. Stop another connection first.",
      "alreadyActive": "Connection is already active.",
      "status": {
        "idle": "Idle",
        "active": "Active",
        "disconnected": "Disconnected",
        "error": "Error"
      },
      "form": {
        "name": "Name",
        "protocol": "Protocol",
        "streamUrl": "Stream URL",
        "username": "Username",
        "password": "Password",
        "model": "Model",
        "field": "Field (optional)"
      }
    },
    "detections": {
      "empty": "No detections yet.",
      "thumbPending": "Thumbnail processing…",
      "filters": {
        "connection": "Connection",
        "class": "Class",
        "severity": "Severity",
        "dateFrom": "From",
        "dateTo": "To"
      },
      "severity": {
        "confirmed": "Confirmed",
        "likely": "Likely",
        "possible": "Possible"
      }
    }
  }
}
```

Uzbek translations to be filled by translator.

---

## 11. Cleanup — current state and remaining steps

**Done already (verified against working tree, 22 files removed earlier):**
- All `app/pages/dashboard/diagnosis.vue`, `app/components/cv/{PhotoUpload,HistoryTimeline,TreatmentCard,DetectionList,ModelManager}.vue`
- All `app/composables/{useDiagnosis,useDiagnosisHistory,useCVModels}.ts`
- All `server/api/cv/{detect,sessions,models,knowledge}/` directories and files
- `server/utils/cvService.ts`
- Empty parent directories pruned

**Remaining cleanup (will be part of the migration / first PR):**

1. **Prisma:** in `prisma/schema.prisma`, delete `DetectionSession` (lines ~179-196) and old `Detection` (lines ~198-212). Also delete the field `CVModel.sessions DetectionSession[]` (line ~176).

2. **Prisma seed:** in `prisma/seed.ts`, remove `DetectionSession` and old `Detection` from the TRUNCATE list in `down()`. KnowledgeBase seed stays.

3. **Layout:** verify `app/layouts/dashboard.vue` does not still reference `nav.diagnosis` or `/dashboard/diagnosis`. If it does, replace with `/dashboard/detection` and `nav.detection`.

4. **i18n:** in both locale files, remove any leftover `diagnosis.*` keys and `nav.diagnosis`. Add the new `detection.*` keys per §10.

5. **Python CV service:** the existing files in `cv-service/app/` (main.py, config.py, routers/, services/, models/) are template-only stubs from a prior session. Review each and rewrite per §4.2. The `Dockerfile` needs the new system deps from §4.1.

6. **`docker-compose.yml`:** currently has only `cv-service`. Replace entirely with the multi-service stack from §6.1.

7. **`.env.example`:** currently lists only `DATABASE_URL`, `NUXT_SESSION_PASSWORD`, `CV_SERVICE_URL`, `CV_API_KEY`. Add all variables from §8.

8. **`nuxt.config.ts`:** currently has only `cvServiceUrl` + `cvApiKey` in `runtimeConfig`. Add the MinIO keys from §8 (NOT `encryptionKey` — that goes only to Python).

9. **`package.json`:** change `packageManager` from `pnpm@10.28.2` to `bun@<current>`. Add npm deps from §9.6.

---

## 12. Implementation Order (logical dependencies)

**Not a plan with tasks — just the order things need to be built so each step compiles/runs.**

1. **Schema + env foundation**
   - Edit `prisma/schema.prisma` per §3 (delete old, add new, add User/Field inverse relations, define enums)
   - Edit `prisma/seed.ts` to remove old models from TRUNCATE
   - Run `prisma migrate dev --name cv_module_v1`
   - Add raw SQL partial unique index migration
   - Update `.env.example` per §8
   - Update `nuxt.config.ts` `runtimeConfig` per §8
   - Fix `package.json` `packageManager` field

2. **MinIO + nginx infra**
   - Replace `docker-compose.yml` per §6.1 (full multi-service stack)
   - Write `nginx/nginx.conf` per §6.3 (no `/media/` rewrite, allowlist for `/api/cv/_internal/`)
   - Write bucket init script per §6.2 (creates bucket, lifecycle, service account, policy)
   - `bun add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`
   - Write `server/utils/minioClient.ts` per §5.5 (lazy singleton, public endpoint, `presignGet`, `deleteSnapshotPrefix`)

3. **Crypto utility (Python only)**
   - Write `cv-service/app/services/crypto.py` per §7.3
   - Add round-trip unit test
   - Add Python `cryptography` to `requirements.txt`

4. **Python CV service**
   - Set `OPENCV_FFMPEG_CAPTURE_OPTIONS` env var in `main.py` BEFORE `import cv2`
   - Implement `onnx_validator.py` (`onnx.checker` only, no InferenceSession)
   - `model_manager.py` (LRU cache, CPUExecutionProvider)
   - `detector.py` (severity tier mapping, blocking inference wrapped in `to_thread` from caller)
   - `image_processor.py` (cv2 encode in thread pool)
   - `thumbnail_worker.py` (pyvips, bounded ThreadPoolExecutor)
   - `stream_manager.py` (corrected pseudocode from §4.4)
   - `reconnect.py` (`backoff_delay` from §4.5)
   - `minio_client.py` (internal endpoint, service account)
   - `routers/health.py` (returns `{status:"ok"}` only, no model list)
   - `routers/models.py` (`POST /models/upload` parses streamed multipart from Nuxt)
   - `routers/credentials.py` (`POST /credentials/encrypt` — Python is the only place with the key)
   - `routers/connections.py` (`/test`, `/start`, `/stop`, `/active`)
   - `routers/detect.py` (`POST /detect/image` for Quick Test)
   - On startup: POST `/api/cv/_internal/reconcile` with `activeConnectionIds=[]` (cold start)
   - `Dockerfile` updated with new system deps

5. **Nuxt API routes**
   - `server/utils/crypto.ts` — **NOT WRITTEN** (Python encrypts)
   - `server/utils/cvService.ts` — proxy helper for forwarding to Python with API key
   - `server/api/cv/models/index.{get,post}.ts` (POST uses streaming pattern from §5.7)
   - `server/api/cv/models/[id].{get,put,delete}.ts` (DELETE handles 409 from Restrict)
   - `server/api/cv/models/[id]/quick-test.post.ts` (streamed)
   - `server/api/cv/connections/index.{get,post}.ts` (POST: SSRF guard, Python `/credentials/encrypt`)
   - `server/api/cv/connections/[id].{get,put,delete}.ts` (DELETE: stop Python task → MinIO prefix delete → Cascade)
   - `server/api/cv/connections/test.post.ts` (SSRF guard, rate limit, forwards to Python)
   - `server/api/cv/connections/[id]/start.post.ts` (optimistic lock, mints `streamToken`, forwards to Python)
   - `server/api/cv/connections/[id]/stop.post.ts`
   - `server/api/cv/detections/index.get.ts` (paginated, presigns thumbs)
   - `server/api/cv/detections/[id].{get,delete}.ts` (DELETE: MinIO prefix delete + DB delete)
   - `server/api/cv/_internal/{detection,thumb-ready,connection-status,reconcile}.post.ts` (verify API key + streamToken + status=active)

6. **Frontend**
   - `app/composables/useCVModels.ts`, `useCVConnections.ts`, `useCVDetections.ts`
   - `app/components/cv/{ModelCard,ModelUploadDrawer,QuickTestModal,ConnectionCard,ConnectionFormDrawer,DetectionCard,DetectionDetailModal,DetectionsFilterBar,BBoxOverlay,StatusBadge}.vue`
   - `app/components/cv/{ModelsTab,ConnectionsTab,DetectionsTab}.vue`
   - `app/pages/dashboard/detection.vue` per §9.4
   - `app/layouts/dashboard.vue` — replace any old `Diagnosis` link with `Detection`
   - `i18n/locales/{en,uz}.json` updated per §10

7. **Smoke test**
   - Round-trip AES test (encrypt in Python, decrypt in Python — Nuxt is not in this loop now)
   - Upload .onnx model via UI
   - Quick test with static photo, verify bboxes render
   - Create Connection with a test RTSP feed, click Test → should pass
   - Save Connection, click Start → status=active in UI within 2s
   - Verify detections appear in Detections tab with thumbnails
   - Click a detection → modal with full image + bboxes
   - Stop → status=idle
   - Delete Connection → MinIO objects gone, no orphan rows
   - Restart cv-service container → all `active` connections reconciled to `disconnected` within 5s of Python startup

---

## 13. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| MinIO OSS frozen since Dec 2025 | Pinned pre-freeze release; documented exit plan to SeaweedFS or Hetzner Object Storage. **Also: cache the pinned image in a private registry — MinIO has stopped distributing free Docker images.** |
| MinIO CORS broken on presigned | Nginx mounts `/harvest-snapshots/` directly (no rewrite); SDK signs against the same path; `MINIO_SERVER_URL` matches public host |
| Thumbnail backpressure on stream path | Bounded ThreadPoolExecutor queue (maxsize=200); drop oldest, log warning |
| Credential leak via logs | `username`/`password` never logged; API responses mask as `"***"`; Nuxt never has plaintext beyond a single request |
| **ENCRYPTION_KEY leak = total camera credential compromise** | Master key only in cv-service container (smaller attack surface than Nuxt); version byte in ciphertext for rotation; documented compromise response in §7.5 |
| Presigned URL leak | 1h TTL + ownership check in API before generation |
| Stream thundering herd on service restart | On startup, do NOT auto-resume connections; Nuxt reconciles `status=active` rows to `disconnected` via `/_internal/reconcile` |
| **CV service restart leaves DB in inconsistent state** | Python POSTs `/_internal/reconcile` with `activeConnectionIds=[]` on startup; Nuxt marks all stale `active` rows as `disconnected` |
| **Concurrent Start (double-click / two tabs)** | Optimistic lock: `UPDATE WHERE status='idle' RETURNING`; 409 if not idle |
| **Connection delete orphans MinIO objects for 90 days** | DELETE handler stops Python task → fetches all snapshotKeys via SELECT → `DeleteObjects` MinIO → Cascade DB delete |
| **Webhook spoofing from Docker network** | Nginx IP allowlist on `/api/cv/_internal/`; per-stream `streamToken` nonce validated server-side; webhook verifies `Connection.status='active'` |
| **`isDefault` race condition** | Postgres partial unique index via raw SQL migration |
| libvips missing in Docker | Both `libvips` AND `libvips-dev` in Dockerfile per §4.1 |
| Disk fill from snapshots | 90-day lifecycle rule + monitoring on MinIO disk usage |
| Detection table row explosion | Deduplication window (60s) + `lastSeenAt` update; new row after window per §15 Q7 resolution |
| **SSRF via `streamUrl` test endpoint** | Resolve hostname server-side, deny RFC1918/loopback/link-local; rate-limit 5/min/user; reject non-stream schemes |
| User uploads malicious ONNX | `onnx.checker` validation only at upload; `InferenceSession` only at inference time with `CPUExecutionProvider` |
| **`readMultipartFormData` OOM on 100 MB ONNX** | Stream body via `getRequestWebStream` → Python parses; nginx `client_max_body_size 110m` at server level |
| **`cv2.VideoCapture.read()` blocks event loop** | All cv2 calls via `asyncio.to_thread`; one thread per stream worker |
| **OpenCV RTSP hangs on dead camera** | `OPENCV_FFMPEG_CAPTURE_OPTIONS=...stimeout;5000000` env var BEFORE `import cv2`; `CAP_PROP_OPEN_TIMEOUT_MSEC` set in `cap.open()` call |
| **`thumb-ready` webhook race** | Detection insert (step e in §4.6) AWAITED before thumbnail enqueue (step f); ULID is generated by Python and used as `Detection.id` so no second ID needed |
| **Quick Test as DoS vector** | Rate limit 10/min/user; max 10 MB image |
| **Information disclosure via /health** | `/health` returns only `{status:"ok"}` — no model list, no user IDs |
| `MINIO_SERVER_URL` mismatch with nginx | Both come from `${PUBLIC_URL}` env var |
| `prisma migrate dev` failure | Inverse relations on User/Field added in same edit; CVModel rebuilt cleanly via drop+recreate (acceptable: TRUNCATE in seed.down already) |

---

## 14. YAGNI — NOT in MVP

Do not build these unless a specific real requirement surfaces:

- AVIF/WebP format delivery
- Archive/original image retention (evidentiary)
- `srcset` responsive image variants
- MinIO webhook-driven thumbnail pipeline
- Celery / RabbitMQ task queue
- imgproxy / thumbor sidecar
- MinIO tiering (hot/cold)
- Pre-warmed / long-lived presigned URLs
- Multi-model ensemble inference
- Real-time WebSocket frame streaming to browser
- Live video preview in UI (only detections, not the raw stream)
- Auto-resume connections on CV service restart
- Webhook notifications to external systems (Telegram, email)
- Treatment recommendations beyond KB lookup
- Custom class label editing
- Model fine-tuning / training UI
- Export detections to CSV/PDF
- Multi-user shared connections
- Cross-field detection analytics
- Admin god mode into other users' CV data
- KnowledgeBase user contributions / public-private toggle
- Encryption key rotation (designed for, not implemented)

---

## 15. Open Product Questions (deferred, non-blocking)

**Resolved during validation (NOT open):**
- ~~Q6 admin god mode~~ → resolved: **NO**, admins do not see other users' CV data. Support route is delete-and-recreate or DB access.
- ~~Q7 dedup edge cases~~ → resolved: after the 60s window expires, a new Detection row is created. Within the window, `lastSeenAt` is updated on the existing row.

**Still open (deferred):**
1. **KnowledgeBase user contributions** — allow users to add/edit/delete KB entries with public/private visibility toggles?
2. **Admin moderation** — should admin be able to review/remove public KB entries from other users?
3. **Treatment priority resolution** — when multiple KB entries match a detection className, which wins?
4. **Evidentiary archive** — if legal/audit requires original sensor-resolution images, add B-plus-archive variant (+3.6× storage).
5. **Responsive image breakpoints** — add 640w variant for tablets if user data shows need.
6. **Model isolation cache** — global LRU vs per-request load (memory vs CPU at scale).

---

## 16. Appendix — YOLO severity tier mapping

Severity tiers are derived from confidence bands in `detector.py`. **Filtering happens in Python**, so the threshold lives in `cv-service/.env` as `MIN_DETECTION_CONFIDENCE` (default `0.40`).

| Confidence | Severity | UI badge color |
|---|---|---|
| >= 0.80 | `confirmed` | red |
| 0.60 - 0.79 | `likely` | orange |
| 0.40 - 0.59 | `possible` | yellow |
| < 0.40 (`MIN_DETECTION_CONFIDENCE`) | filtered out (not stored) |

Category (`disease`/`pest`/`weed`) is derived from the class name via a static mapping file `cv-service/app/services/class_categories.yaml`. For unknown classes, default to `disease`.

**YOLO bbox coordinate convention:** all bboxes in `Detection.bbox`, `/detect/image` response, and `BBoxOverlay.vue` use **normalized 0-1 coordinates with top-left origin**. `{ x, y, w, h }` where `(x, y)` is the top-left corner of the box. `x + w <= 1`, `y + h <= 1`. The detector in Python is responsible for converting YOLO's native (center-x, center-y, w, h, possibly letterboxed) output to this convention before sending.

---

## End of spec v2.
