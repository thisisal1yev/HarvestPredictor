# Feasibility Validation — CV Module Spec

**Validator:** feasibility-validator
**Date:** 2026-04-08
**Scope:** `docs/specs/cv-module-spec.md` (979 lines)
**Current repo state:** branch `feature`, Nuxt 4.4.2, `@nuxt/ui` ^4.5.1, Prisma ^7.5.0, Tailwind ^4.2.1, pnpm 10.28.2 (NOT bun).

## Verdict

**GO WITH FIXES.**

The architecture is sound and most claims hold up, but there are several concrete blockers that will make the code-as-written fail at runtime. None are insurmountable — every one has a straightforward fix. Ship only after the critical issues are addressed.

---

## Critical issues (blocking — code will not work as spec'd)

### C1. Package manager mismatch — bun vs pnpm

- Spec (§9.4) says `bun add @tanstack/vue-virtual`. The team-lead brief also says "Package manager: bun".
- Actual `package.json` has `"packageManager": "pnpm@10.28.2"`. `bun.lock` appears in recent commits but the project declares pnpm. Mixed state.
- **Fix:** pick one. If the team is really on bun, delete `pnpm-lock.yaml`/update `packageManager` to `bun@x.y.z`. If pnpm, change all `bun add` in spec to `pnpm add`. This affects CI, devcontainers, and onboarding.

### C2. `readMultipartFormData` will OOM on 100 MB ONNX uploads

- Spec §2.2 allows `.onnx` files up to 100 MB and §5.1 says `POST /api/cv/models` is multipart. Spec does not say how the Nuxt route reads the body.
- Nitro's `readMultipartFormData` buffers the entire request into memory. Known issue: [h3js/h3#851](https://github.com/h3js/h3/issues/851). 100 MB per concurrent upload per Nitro worker → OOM risk on a small VPS.
- **Fix:** pipe the incoming stream directly to the Python CV service. Either:
  - Use `sendStream` / `proxyRequest` on the raw request body (Nitro) with a `fetch`/`ofetch` call carrying `ReadableStream`.
  - Or do a direct browser → Python upload using a short-lived, Nuxt-minted upload token (Nuxt validates session, mints token, browser uploads to `/cv-internal/models/upload` with the token). Removes Nuxt from the hot path entirely.
- Also increase `nginx client_max_body_size` to at least `110m` on the `/api/` location (spec currently sets 100m only on `/media/`).

### C3. nginx `rewrite ^/media/(.*) /harvest-snapshots/$1 break;` will break presigned URL signatures

- Spec §6.3 rewrites `/media/{key}` → `/harvest-snapshots/{key}` and §5.5 generates the signed URL with endpoint `https://app.example.com/media` so it says the signature will match.
- **This is not how SigV4 presign works.** The canonical request that the AWS SDK signs includes the path `/{bucket}/{key}` when `forcePathStyle: true`. Setting the SDK's `endpoint` to `.../media` will make the SDK build URLs like `https://app.example.com/media/harvest-snapshots/{key}` — the `/media` becomes a path prefix that MinIO will not recognize, AND the signature is computed against `/media/harvest-snapshots/{key}`, while MinIO after nginx rewrite sees `/harvest-snapshots/{key}`. Signature mismatch either way.
- Confirmed issue: [minio/minio#9964](https://github.com/minio/minio/issues/9964), [minio/minio#7857](https://github.com/minio/minio/issues/7857), [minio/minio#19067](https://github.com/minio/minio/issues/19067).
- **Fix (proven working pattern):**
  1. Drop the `rewrite`. Mount MinIO at `/harvest-snapshots/` directly:
     ```nginx
     location /harvest-snapshots/ {
         proxy_set_header Host $host;
         proxy_set_header X-Real-IP $remote_addr;
         proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
         proxy_set_header X-Forwarded-Proto https;
         proxy_http_version 1.1;
         proxy_set_header Connection "";
         chunked_transfer_encoding off;
         proxy_pass http://minio:9000;
     }
     ```
  2. Generate presigned URLs with `endpoint: "https://app.harvestpredictor.example"` (no path suffix). The SDK will produce `https://app.harvestpredictor.example/harvest-snapshots/{key}?X-Amz-Signature=...`.
  3. Set `MINIO_SERVER_URL=https://app.harvestpredictor.example` so MinIO itself validates signatures against the public host, not the internal docker hostname.
- The `/media/` alias URL is a nice-to-have and can be re-added later with a browser-side path rewrite, but it is NOT a zero-config solution.

### C4. `cv2.VideoCapture` + `cap.read()` in an async function blocks the event loop

- Spec §4.4 shows the stream worker as:
  ```python
  async def stream_worker(connection):
      cap = cv2.VideoCapture(...)
      while not cancel_event.is_set():
          ok, frame = cap.read()   # <-- BLOCKING, C call
          ...
  ```
- `cv2.VideoCapture` and `cap.read()` are synchronous C calls. Running them inside an `async def` does **not** make them async. Every blocking read stalls the entire event loop — all FastAPI request handlers, other stream workers, and httpx calls freeze until the frame arrives (or the RTSP socket times out, which can be 10+ seconds on a dead camera).
- With `MAX_CONCURRENT_STREAMS=5` and a single event loop, one dead camera = whole service stalls.
- **Fix:** Either
  - Run each stream worker in a dedicated thread via `asyncio.to_thread` / `loop.run_in_executor(ThreadPoolExecutor(max_workers=N), ...)`, or
  - Use a process pool / subprocess per stream (higher isolation; recommended for >5 streams anyway).
- Minimum change: wrap every `cap.read()`, `cap.open()`, `cap.release()` in `await asyncio.to_thread(...)`. Detector inference (ONNX Runtime `session.run`) is also blocking C code and must be wrapped the same way.
- Spec §4.5 backoff `asyncio.sleep` is fine; the C calls are what need fixing.

### C5. `CAP_PROP_OPEN_TIMEOUT_MSEC` only works on the FFMPEG backend — and isn't applied in the spec's pseudocode

- Spec §13 Risks row: "OpenCV RTSP hang on dead camera — `cv2 capture with CAP_PROP_OPEN_TIMEOUT_MSEC = 5000`".
- `CAP_PROP_OPEN_TIMEOUT_MSEC` and `CAP_PROP_READ_TIMEOUT_MSEC` are FFMPEG-backend only ([opencv/opencv#20549](https://github.com/opencv/opencv/pull/20549)). They also must be **set before** the URL is opened, not after. `cv2.VideoCapture(url)` one-shot constructor already opens the stream — you cannot set the timeout on the resulting object.
- Correct pattern:
  ```python
  cap = cv2.VideoCapture()
  cap.setExceptionMode(True)
  cap.open(url, cv2.CAP_FFMPEG, [
      cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000,
      cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000,
  ])
  ```
- Without this, dead-camera opens will hang for OpenCV/FFMPEG's default (~30s+). Combined with C4, the service becomes unresponsive.
- Spec pseudocode in §4.4 does not show the timeout being set at all.

### C6. `package.json` does not contain required dependencies

Spec calls for the following npm packages which are **not in** `package.json`:

- `@tanstack/vue-virtual` (§9.4) — but see R6: UScrollArea already bundles this.
- `@aws-sdk/client-s3` (§5.5)
- `@aws-sdk/s3-request-presigner` (§5.5)

All three must be added (or replaced — see R1 and R8 below).

---

## Important issues (will cause re-work mid-implementation)

### I1. Prisma schema — missing back-relations and Field relation

- Spec §3.3 adds `Connection` with `field Field? @relation(fields: [fieldId], ...)`. Current `prisma/schema.prisma` lines 32-46 `Field` model does **not** have a `connections Connection[]` back-relation. Prisma 7 requires back-relations (errors on `prisma generate`).
- Same issue for `User ↔ CVModel`: current CVModel has no relation at all (just `uploadedBy String`), and `User` (lines 10-19) has no `cvModels` / `connections` lists. Spec §3.4 renames the column but doesn't show adding the back-relations.
- **Fix:** add to the User and Field models:
  ```prisma
  model User {
      // ...
      cvModels    CVModel[]
      connections Connection[]
  }
  model Field {
      // ...
      connections Connection[]
  }
  ```

### I2. `CVModel.isDefault` default-per-crop-type enforcement

- Spec §3.5 step 5 says "default per user per crop type, enforce via app logic, not DB constraint".
- Note: `cropType` is optional (`String?`). "Default per user per nullable crop type" is fragile — two models with `cropType=null` and `isDefault=true` is a valid spec-compliant state but will confuse consumers picking the default.
- **Fix:** specify behavior when `cropType IS NULL`. Either treat null as "general" (one slot) or disallow `isDefault=true` on null-crop models. Add a postgres partial unique index if you want DB-level safety:
  ```sql
  CREATE UNIQUE INDEX cvmodel_one_default_per_crop
    ON "CVModel" ("userId", COALESCE("cropType", '__general__'))
    WHERE "isDefault" = true;
  ```
- Prisma 7 doesn't support partial unique indexes in the schema DSL natively — needs raw SQL migration.

### I3. Detection deduplication race condition

- Spec §4.4: "update `lastSeenAt` via Nuxt webhook instead of creating new Detection record" — keyed on `(className, rounded_bbox)` within 60s.
- The dedup cache lives **in the Python CV service memory**, per-process. If Python restarts (crash, deploy), cache is empty → the next frame creates a duplicate Detection. Webhook callers update `lastSeenAt` but there's no query for "is there an existing Detection in the last 60s with this className+bbox?" before insert.
- **Fix:** either
  - Add a quick DB lookup in the Nuxt `/api/cv/_internal/detection` handler before insert (SELECT ... WHERE connectionId=X AND className=Y AND detectedAt > now() - 60s AND bbox overlap), OR
  - Accept the race as acceptable on restart. Document the decision either way.

### I4. `Connection.status=active` is not authoritative — drift between Nuxt DB and Python task state

- §2.3 flow: user clicks Start → Nuxt sets status=active → Python starts background task.
- If Python crashes / restarts, Nuxt still has status=active but no task is running. `POST /api/cv/connections/[id]/stop` will fail with "task not found" and the UI is stuck.
- §13 risks row "On startup, do NOT auto-resume connections" acknowledges this but doesn't handle the cleanup.
- **Fix:** on Python service startup, call Nuxt `POST /api/cv/_internal/connection-status` with status=disconnected for all connections that were active — or expose a `GET /connections/active` on Python that Nuxt periodically polls to reconcile. Minimum: a startup broadcast "I rebooted, mark all active as idle".

### I5. `nginx client_max_body_size 100m` is set on `/media/` but not `/api/` or `/`

- Spec §6.3 sets `client_max_body_size 100m` inside `location /media/`. This only affects the MinIO proxy path.
- Model upload hits `/api/cv/models` (on `/`). Nginx default is 1 MB. Uploads will fail with 413 before even reaching Nuxt.
- **Fix:** set `client_max_body_size 110m;` at the `server { ... }` level (or on `location /`).

### I6. Presigned URL TTL vs thumbnail late-ready

- Spec §4.6: thumbnail ready webhook fires after `full.jpg` is uploaded. But §5.3 `GET /api/cv/detections` generates presigned URLs per response. If `thumbReady=false`, what does the thumbnail field return? Empty string? Placeholder? Spec does not say.
- Important for UI — the virtual list needs a stable slot. Otherwise cards reflow on thumb-ready.
- **Fix:** specify UI contract — `thumbUrl: null` when not ready, frontend shows skeleton until poll.

### I7. Admin visibility enforcement is described but not enforced at layer boundary

- §1 says "admins have no god mode into CV data" but all Nuxt routes use `where: { userId: session.user.id }` — this means an admin user is just filtered like anyone else. Fine for filtering, BUT `GET /api/cv/models/[id]` with someone else's id should return 404, not 403, to avoid id enumeration. Spec does not say which.
- **Fix:** document that 404 is the correct response for unowned resources. Minor but important for security audit.

---

## Library/version corrections

### R1. pyvips==2.2.3 is two years old — bump

- pyvips 2.2.3 released **2024-04-28**. Current stable is **3.1.1** (released 2025-12-09). [PyPI](https://pypi.org/project/pyvips/)
- No reason to pin a 2-year-old release in a greenfield service. 3.x has bug fixes and supports current libvips.
- **Fix:** `pyvips==3.1.1`. Also install both `libvips` AND `libvips-dev` in Dockerfile (spec mentions only `libvips-dev`; both are required per [libvips/pyvips#83](https://github.com/libvips/pyvips/issues/83)).
- Full Dockerfile dep set for `python:3.11-slim`:
  ```dockerfile
  RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 libglib2.0-0 \
      libvips libvips-dev \
      curl \
      && rm -rf /var/lib/apt/lists/*
  ```
  (`libgl1-mesa-glx` in the current Dockerfile is deprecated on Debian 12 → use `libgl1`.)

### R2. minio==7.2.15 is fine but newer exists

- minio 7.2.15 released 2025-01-19; 7.2.16 released 2025-07-21. [PyPI](https://pypi.org/project/minio/)
- Not blocking but consider bumping to 7.2.16 for bugfixes.

### R3. python-ulid==3.0.0 is outdated

- 3.0.0 exists, but 3.1.0 (2025-08-18) is the current release. [PyPI](https://pypi.org/project/python-ulid/)
- **Fix:** `python-ulid==3.1.0` unless there's a specific reason to pin old.

### R4. cryptography==45.0.1 — verify

- 45.0.1 released 2025-05-17. Latest as of April 2026 is 46.0.x. [PyPI](https://pypi.org/project/cryptography/)
- 45.0.1 works for AES-GCM, but consider bumping to latest 46.x for CVE fixes if any have shipped.

### R5. onnxruntime==1.22.0 — verify availability for Python 3.11 on slim

- Spec keeps onnxruntime==1.22.0. Known that `onnxruntime` wheels occasionally lag Python versions. Verify `pip install onnxruntime==1.22.0` inside a fresh `python:3.11-slim` image before committing to this pin. Not a blocker, just a pre-flight check.

### R6. `@tanstack/vue-virtual` — do not install directly; use `UScrollArea`

- Nuxt UI 4 [ScrollArea](https://ui.nuxt.com/docs/components/scroll-area) supports virtualization natively via the `virtualize` prop, which internally uses `@tanstack/vue-virtual`. No extra install needed.
- Spec §9.4 says "Check Nuxt UI 4 — if UScrollArea or a similar component already wraps virtual scroll, use that instead" — **it does, so use it.** Delete the `@tanstack/vue-virtual` install step from §9.4.
- Example:
  ```vue
  <UScrollArea
    v-slot="{ item }"
    :items="detections"
    :virtualize="{ estimateSize: 96, gap: 8 }"
    class="h-full"
  >
    <DetectionCard :detection="item" />
  </UScrollArea>
  ```

### R7. MinIO docker tag — ok as pinned

- `minio/minio:RELEASE.2025-04-22T22-12-26Z` exists on [Docker Hub](https://hub.docker.com/layers/minio/minio/RELEASE.2025-04-22T22-12-26Z/images/sha256-3f97c5651cb6662b880c787a232b6b34fec8d8922e08d6617b25d241a21164bb). This IS the last release before the May 24 2025 community-console strip ([Blocks & Files](https://blocksandfiles.com/2025/06/19/minio-removes-management-features-from-basic-community-edition-object-storage-code/)). Good pin choice.
- Risk: MinIO has also stopped distributing free Docker images ([Hacker News discussion](https://news.ycombinator.com/item?id=44136108)). Pull cached image to a private registry before the image disappears. Worth documenting in the risks table.

### R8. Bun native S3 (if team is really on bun)

- If the project truly uses bun (C1), consider using bun's **native** `Bun.s3` client instead of `@aws-sdk/client-s3` — it's 5× faster and has fewer compatibility issues. Trade-off: misses `ResponseCacheControl` and user metadata ([bun#18016](https://github.com/oven-sh/bun/issues/18016)), which doesn't matter for this spec.
- If staying on pnpm/Node, `@aws-sdk/client-s3` is the right call.

---

## Concrete code corrections

### Code Fix 1 — AES-256-GCM Python side (missing from spec §7)

Spec shows Node encrypt/decrypt but §7.3 says "Python decrypts using the same master key" without showing the Python code. Without it, teams tend to write incompatible layouts and debug for hours. Add this to the spec:

```python
# cv-service/app/services/crypto.py
import base64
import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_KEY: bytes | None = None

def _key() -> bytes:
    global _KEY
    if _KEY is None:
        raw = os.environ["ENCRYPTION_KEY"]
        if raw.startswith("base64:"):
            raw = raw[len("base64:"):]
        _KEY = base64.b64decode(raw)
        if len(_KEY) != 32:
            raise RuntimeError("ENCRYPTION_KEY must decode to 32 bytes")
    return _KEY

def decrypt(payload_b64: str) -> str:
    buf = base64.b64decode(payload_b64)
    iv, tag, ct = buf[:12], buf[12:28], buf[28:]
    # Python AESGCM expects ciphertext||tag concatenated
    return AESGCM(_key()).decrypt(iv, ct + tag, None).decode("utf-8")
```

**Interop verified:** Python `AESGCM.decrypt(nonce, ciphertext||tag, aad)` matches Node's `(iv, tag, ciphertext)` layout as long as you re-concatenate `ct + tag` before handing to `AESGCM`. Node's `createCipheriv(...).getAuthTag()` returns the 16-byte GCM tag; Python's cryptography library appends it implicitly to ciphertext. Layout conversion is what the Python `decrypt()` above does.

Add a round-trip test to the spec's §12 "Implementation order" step 3 as an explicit acceptance criterion.

### Code Fix 2 — minio client wrapper (§5.5)

The spec's snippet loads `useRuntimeConfig()` **at module top level**. This runs during module import, NOT within a request context. Nuxt/Nitro will either error or return defaults. Move the client creation inside the function or use a lazy singleton:

```typescript
// server/utils/minioClient.ts
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

let _s3: S3Client | null = null

function s3(): S3Client {
  if (_s3) return _s3
  const cfg = useRuntimeConfig()
  _s3 = new S3Client({
    endpoint: cfg.minioPublicEndpoint, // e.g. https://app.example.com
    region: "us-east-1",
    credentials: {
      accessKeyId: cfg.minioAccessKey as string,
      secretAccessKey: cfg.minioSecretKey as string,
    },
    forcePathStyle: true,
  })
  return _s3
}

export async function presignGet(key: string): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: useRuntimeConfig().minioBucket as string,
    Key: key,
  })
  return getSignedUrl(s3(), cmd, {
    expiresIn: Number(useRuntimeConfig().minioPresignedTtl) || 3600,
  })
}
```

Also: spec uses `config.minioEndpoint` — wrong. For generated presigned URLs you want `minioPublicEndpoint`. `minioEndpoint` (internal) is for the CV service Python client, not Nuxt's presign.

Also: spec §8 env list has `MINIO_ENDPOINT` and `MINIO_PUBLIC_ENDPOINT` but `runtimeConfig` block has `minioAccessKey`/`minioSecretKey` **with no corresponding env var defined in §8**. Add `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` to §8 (separate from `MINIO_ROOT_USER`/`PASSWORD` — for bucket-scoped service creds via `mc admin user svcacct add`).

### Code Fix 3 — BBox overlay in canvas (feasibility: yes, trivial)

Completely feasible in a Vue 3 SFC. Coordinates in `bbox = { x, y, w, h }` normalized 0-1 per spec §3.3. Implementation sketch:

```vue
<script setup lang="ts">
const props = defineProps<{ src: string; boxes: { x:number;y:number;w:number;h:number;label:string;confidence:number }[] }>()
const canvasRef = ref<HTMLCanvasElement>()
const imgRef = ref<HTMLImageElement>()

function draw() {
  const c = canvasRef.value, i = imgRef.value
  if (!c || !i) return
  c.width = i.naturalWidth; c.height = i.naturalHeight
  const ctx = c.getContext('2d')!
  ctx.drawImage(i, 0, 0)
  ctx.strokeStyle = 'red'; ctx.lineWidth = 4; ctx.font = '20px sans-serif'; ctx.fillStyle = 'red'
  for (const b of props.boxes) {
    const x = b.x * c.width, y = b.y * c.height
    const w = b.w * c.width, h = b.h * c.height
    ctx.strokeRect(x, y, w, h)
    ctx.fillText(`${b.label} ${(b.confidence*100).toFixed(0)}%`, x, y - 6)
  }
}
</script>
<template>
  <div>
    <img ref="imgRef" :src="src" class="hidden" crossorigin="anonymous" @load="draw" />
    <canvas ref="canvasRef" class="max-w-full" />
  </div>
</template>
```

Only gotcha: presigned URLs served through the browser → `crossorigin="anonymous"` is needed for `canvas.toDataURL()` to work without tainting. For bbox rendering only, tainting is harmless. If the spec ever wants "save annotated image", set CORS on the MinIO bucket.

### Code Fix 4 — ONNX validator edge case

Spec §4.1 `onnx_validator.py` — spec doesn't say what "loadability" means. Loading a malicious `.onnx` with `onnxruntime` can exhaust memory or crash. Recommended minimum:

```python
import onnx
def validate(path: str) -> None:
    model = onnx.load(path)                # parses proto
    onnx.checker.check_model(model)        # validates graph
    # Do NOT run InferenceSession yet; that loads CUDA/etc.
    # Instead, create on-demand in model_manager.py with CPUExecutionProvider only.
```

Also: 100 MB is a reasonable upper bound but some real YOLO models (YOLOv8x) are larger. Confirm with product team before implementation.

---

## Unaddressed implementation questions

1. **Where is the shared bucket `harvest-snapshots` credential stored?** Spec §8 has only `MINIO_ROOT_USER/PASSWORD`. Using root credentials from the Nuxt/Python services is bad practice. Add a service account via `mc admin user svcacct add` in the bucket init step (§6.2), and inject those creds as `MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY`. Spec doesn't mention this.

2. **How does the Python CV service talk to MinIO — public endpoint or internal?** Python writing through nginx adds latency and a public TLS cert dependency. Should use internal `http://minio:9000` directly. Spec §4.2 has `minio_client.py` but doesn't say which endpoint.

3. **What does `DELETE /api/cv/models/[id]` do when the model is in use by active Connections?** Spec says `onDelete: Restrict` on Connection.modelId — the DELETE will fail with a Prisma error. UI needs to pre-check and show "Stop and delete N connections first" OR cascade (bad). Spec §5.1 says "204" without handling the restrict.

4. **Reconnect state after 3 failures — no resume on restart?** Spec §13 says "do NOT auto-resume" but doesn't specify: when Python starts up, does it leave status=active in the DB (lying) or mark them all disconnected? (I4 already flags this.)

5. **ULID dependency — why not use Python 3.11's `uuid.uuid4`?** `python-ulid` is a dependency, binary wheel build, and cffi — adds supply chain surface. UUIDv7 (time-sortable) is available via `uuid-utils`. Not blocking, just scope creep.

6. **Where are thumbnails cached between generation and browser fetch?** If `/detections` response has `thumbReady=true` and generates presigned URL, but the key doesn't exist yet (race: webhook before MinIO commit), browser gets 403/404. Document the order of operations in §4.6: MinIO upload must complete BEFORE webhook fires.

7. **`MINIO_SERVER_URL=https://app.harvestpredictor.example` in docker-compose** — spec §6.1 sets this, which tells MinIO its public name. Then the nginx `/media/` rewrite in §6.3 is inconsistent because MinIO expects path `/harvest-snapshots/*` (bucket-prefixed). See C3.

8. **Prisma 7 prisma.config.ts** — Prisma 7 moved database URL and migration config out of `schema.prisma` into `prisma.config.ts` ([Prisma v7 upgrade guide](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7)). Spec §12 says `prisma migrate dev` but does not mention creating/updating `prisma.config.ts`. Verify the existing repo already has this (commits 6e82aac/3fa4af9 upgraded to Prisma 7.5.0). If not, the migration step will fail.

---

## Things the spec got right

- Overall architecture: user-scoped multi-tenancy, Python CV service sidecar, Prisma + Nuxt server + nginx + MinIO — solid, battle-tested pattern.
- Pinning MinIO to `RELEASE.2025-04-22T22-12-26Z` (pre-strip) with documented exit plan — **correct** given MinIO's community degradation in mid-2025.
- Nuxt UI 4 components `UDashboardPanel`, `UDashboardNavbar`, `UTabs` — all exist in v4.5.1, confirmed via [Nuxt UI docs](https://ui.nuxt.com/docs/components/dashboard-panel).
- `UScrollArea` with native `virtualize` prop — exists and is correct for the detection list ([Nuxt UI ScrollArea docs](https://ui.nuxt.com/docs/components/scroll-area)).
- Node `crypto` AES-256-GCM layout (`iv|tag|ciphertext`) — correct and idiomatic. Round-trip with Python (with Code Fix 1) works.
- Presigned URL TTL 1h and never caching in DB — correct.
- Never logging credentials, masking as `***` in GET responses — correct.
- Dedup window with `lastSeenAt` update — correct approach (but see I3 race).
- 90-day lifecycle via `mc ilm rule add` — correct syntax.
- Snapshot key layout with ULID and YYYY/MM/DD prefixes — good for S3 lexicographic ordering and cheap date-range deletes.
- YAGNI list (§14) is well-scoped and aggressive — prevents feature creep.
- Quick Test flow (no persistence, one-shot) — clean separation, easy to implement.
- ThreadPoolExecutor bounded queue for thumbnails (maxsize=200) — good backpressure design.

---

## Summary

**Do not implement C1–C6 as written — they will fail at runtime.** Fix those, apply R1–R8 version/dep corrections, and the rest of the spec is solid. The architecture decisions are sound; the bugs are in low-level details (async vs sync, nginx signatures, Nitro multipart, package manager) where the spec waved past real constraints. Every critical issue has a concrete, low-cost fix above.

---

### Sources

- pyvips PyPI: https://pypi.org/project/pyvips/
- minio-py PyPI: https://pypi.org/project/minio/
- python-ulid PyPI: https://pypi.org/project/python-ulid/
- cryptography PyPI: https://pypi.org/project/cryptography/
- @aws-sdk/s3-request-presigner npm: https://www.npmjs.com/package/@aws-sdk/s3-request-presigner
- @tanstack/vue-virtual npm: https://www.npmjs.com/package/@tanstack/vue-virtual
- Nuxt UI ScrollArea: https://ui.nuxt.com/docs/components/scroll-area
- Nuxt UI DashboardPanel: https://ui.nuxt.com/docs/components/dashboard-panel
- MinIO Docker tag: https://hub.docker.com/layers/minio/minio/RELEASE.2025-04-22T22-12-26Z/images/sha256-3f97c5651cb6662b880c787a232b6b34fec8d8922e08d6617b25d241a21164bb
- MinIO community feature removal (Blocks & Files): https://blocksandfiles.com/2025/06/19/minio-removes-management-features-from-basic-community-edition-object-storage-code/
- Hacker News: https://news.ycombinator.com/item?id=44136108
- MinIO nginx presigned issue #9964: https://github.com/minio/minio/issues/9964
- MinIO nginx presigned issue #7857: https://github.com/minio/minio/issues/7857
- MinIO SDK v3 signature mismatch #19067: https://github.com/minio/minio/issues/19067
- OpenCV CAP_PROP_OPEN_TIMEOUT_MSEC PR: https://github.com/opencv/opencv/pull/20549
- h3 readMultipartFormData OOM: https://github.com/h3js/h3/issues/851
- pyvips Docker deps issue: https://github.com/libvips/pyvips/issues/83
- Prisma 7 upgrade guide: https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7
- Bun S3 SDK issue: https://github.com/oven-sh/bun/issues/18016
