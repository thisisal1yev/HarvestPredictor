# Final Recommendation — CV Snapshot Storage Strategy

**Author:** chief-synthesizer (task #10)
**Date:** 2026-04-08
**Inputs:** `research-results.md`, `debate-results.md`, `tradeoff-matrix.md`, all `phase1-*.md` and `debate-*.md`.
**Audience:** Ali (project owner). Target: working MVP, not an ideal system.

---

## 1. Decision

**Ship Approach B — "two pre-generated variants, async thumbnail" — on MinIO OSS behind nginx.** Every detection writes `full.jpg` (1280px JPEG q=82, progressive) synchronously via `cv2.imwrite` on the inference hot path, and a `thumb.jpg` (320px JPEG q=78, progressive) asynchronously via a single-worker `ThreadPoolExecutor` using `pyvips`. Both are stored in a single MinIO bucket under `detections/{YYYY}/{MM}/{DD}/{ulid}/{thumb|full}.jpg` with a 90-day lifecycle rule. Nuxt serves same-origin via nginx reverse proxy, generates presigned URLs (1 h TTL) in API routes, and uses `@tanstack/vue-virtual` for list rendering. Approach A is disqualified on bandwidth and mobile memory; Approach C is a future upgrade target, not an MVP build.

---

## 2. Why (evidence)

- **A fails rural LTE and mobile RAM.** 500-item list at 1280px q=82 = **90 MB over the wire / ~6 min @ 2 Mbps**, and **3.28 GB decoded bitmap** in browser memory (`phase1-frontend-perf.md` §7, `phase1-cost-analysis.md` §4). The q=75/720px rescue cuts bandwidth to 25 MB but q=75 sits below the diagnostic threshold in `phase1-image-formats.md` §7, so the rescue math collapses at honest q=82. `debater-single` conceded in round 3.
- **B delivers 15x bandwidth reduction at 7% storage overhead.** 500-item list = **6 MB / ~24 s**, decoded bitmap **205 MB** (survivable on 4 GB Android). Storage per 1000 detections = **192 MB vs 180 MB** for A (+7%) and **vs 380 MB** for C (2.1×). At 100 users × 100 detections/day × 90d = ~9.6 GB / ~€0.50/mo Hetzner block storage (`tradeoff-matrix.md` rows 3-5, 12).
- **Write-hot-path CPU is a non-differentiator once thumb is async.** `cv2.imwrite` JPEG q=82 = 3-6 ms, identical across all three approaches on the synchronous path. The 5-10 ms thumbnail encode via pyvips runs on a background thread that releases the GIL around C extensions, so ONNX inference is not blocked (`phase1-image-formats.md` §3, `phase1-cost-analysis.md` §1).
- **C requires infrastructure HarvestPredictor does not have.** imgproxy has no internal cache and is architected to live behind a CDN (`phase1-storage-patterns.md`). On a Hetzner CPX21 (no CDN, no AVX-512), cold-cache 500-item list = **35-45 s CPU-bound** vs B's deterministic 24 s (`debate-imgproxy.md` §3.4). C adds +1 container, nginx cache tuning, signed URLs, DDoS caps, and runbooks — `debater-imgproxy` explicitly called it "a subsystem, not an increment."
- **MinIO CORS forces nginx reverse proxy regardless of approach.** Known broken on presigned URLs (issues #3985, #10002, #11111, `phase1-minio-specific.md` §8). Same-origin nginx serving is mandatory and solves TLS at the same time — the "+1 nginx" cost is shared by all three approaches, not a C-only tax.

---

## 3. What was rejected and why

### Approach A — Single optimized image

Rejected. Specific failure modes:

1. **Bandwidth on rural LTE:** 90 MB / 6 min for 500-item list at 1280px q=82. Rescue to 720px q=75 still violates diagnostic quality (`phase1-image-formats.md` §7); at honest q=82 the rescue jumps to ~180 s load.
2. **Mobile memory OOM:** 3.28 GB decoded bitmap for 500 items. "Aw, Snap!" tab kills on mid-range Android are a catastrophic UX for an agronomist review workflow.
3. **Twitter case study:** 21x decode CPU penalty (400 ms → 19 ms per image) when correctly sized thumbs are not served (`phase1-frontend-perf.md` §6).
4. **No migration path:** A-720 originals are too small to derive larger variants. A → B/C is not a clean upgrade — would require re-shooting source data.

### Approach C — On-the-fly imgproxy

Deferred, not forever-rejected. Specific triggers that would flip this decision are documented in §5. Why not at MVP:

1. **No CDN.** imgproxy without a CDN is a cache stampede foot-gun (`phase1-storage-patterns.md`).
2. **2.1× storage.** 380 MB/1000 detections vs 192 MB — not the deciding axis financially, but real on a single-disk VPS.
3. **Operational surface.** +1 container, nginx `proxy_cache` + `proxy_cache_lock` + `use_stale` + `background_update`, `IMGPROXY_KEY`/`IMGPROXY_SALT` secrets to rotate, `X-Cache-Status` monitoring, runbooks for imgproxy OOM / cache disk fill / signing key leak (`debate-imgproxy.md` §3.5, `tradeoff-matrix.md` row 9).
4. **Cold-cache tail latency.** 35-45 s on Hetzner CPX21 for a fresh 500-item list, versus B's deterministic 24 s.
5. **Migration is cheap.** B is a strict subset of C on the write path — adding imgproxy in front of `full.jpg` later requires **no data migration**. Building C now is pure YAGNI at MVP scale.

---

## 4. Concrete implementation

### 4.1 Python CV service (`cv-service/`)

**Library choice: `cv2` (already installed) for the synchronous full.jpg + `pyvips` for the async thumb.**

- `cv2.imwrite` is ~2-4 ms for a 1280px JPEG and is already a dependency (`opencv-python-headless==4.11.0.86`). No new import on the hot path.
- `pyvips` is 5-10× faster than Pillow for the thumbnail (streaming, not full-buffer), releases the GIL around C extensions, and has ~94 MB peak RAM vs Pillow's ~1 GB reference (`phase1-cost-analysis.md` §5). Cost: one extra Dockerfile line for `libvips-dev`. Worth it.
- Pillow stays for any non-hot-path work but not for the write path.

**Add to `cv-service/requirements.txt`:**
```
pyvips==2.2.3
minio==7.2.15
python-ulid==3.0.0
```

**Add to `cv-service/Dockerfile`:**
```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*
```

**Hot-path write (synchronous `cv2.imwrite`):**
```python
import cv2

FULL_JPEG_PARAMS = [
    cv2.IMWRITE_JPEG_QUALITY, 82,
    cv2.IMWRITE_JPEG_OPTIMIZE, 1,
    cv2.IMWRITE_JPEG_PROGRESSIVE, 1,
]

def encode_full_jpeg(frame_bgr) -> bytes:
    ok, buf = cv2.imencode(".jpg", frame_bgr, FULL_JPEG_PARAMS)
    if not ok:
        raise RuntimeError("cv2.imencode failed for full.jpg")
    return buf.tobytes()
```

Expected: ~45-70 KB for 640x640, ~150-250 KB for 1280px, 3-6 ms encode (`phase1-image-formats.md` §8).

**Async thumbnail (pyvips on a bounded `ThreadPoolExecutor`):**
```python
import queue
from concurrent.futures import ThreadPoolExecutor
import pyvips
from minio import Minio

# Single worker — sequential encode, easy to reason about, no contention with ONNX.
# maxsize bounds memory under live-stream burst and makes backpressure visible (rejection instead of unbounded growth).
_thumb_queue: queue.Queue = queue.Queue(maxsize=200)
_thumb_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="thumb")

def encode_thumb_jpeg(full_jpeg_bytes: bytes) -> bytes:
    img = pyvips.Image.new_from_buffer(full_jpeg_bytes, "")
    # fit:inside at 320px longest edge
    img = img.thumbnail_image(320, size="down")
    return img.jpegsave_buffer(Q=78, optimize_coding=True, interlace=True, strip=True)

def submit_thumb_job(full_bytes: bytes, bucket: str, key: str, minio_client: Minio) -> None:
    try:
        _thumb_queue.put_nowait((full_bytes, bucket, key))
    except queue.Full:
        logger.warning("thumb_queue_full", extra={"key": key})
        return  # graceful degradation — full.jpg is already stored, thumb can be regenerated later
    _thumb_pool.submit(_thumb_worker, minio_client)

def _thumb_worker(minio_client: Minio) -> None:
    try:
        full_bytes, bucket, key = _thumb_queue.get_nowait()
    except queue.Empty:
        return
    try:
        thumb_bytes = encode_thumb_jpeg(full_bytes)
        from io import BytesIO
        minio_client.put_object(
            bucket, key, BytesIO(thumb_bytes), len(thumb_bytes),
            content_type="image/jpeg",
        )
    except Exception:
        logger.exception("thumb_encode_failed", extra={"key": key})
        # No retry — rely on nightly reconciliation job to regenerate missing thumbs (see §6)
```

**Error handling when thumbnail fails:**
- `full.jpg` is always written first, synchronously. If thumb fails, detection still has diagnostic data.
- Frontend `<img>` uses `onerror` fallback to `full.jpg` URL — list cell shows full at CSS-scaled size while reconciler catches up.
- Reconciliation job (cron, nightly): walk last 24 h of detections, list MinIO keys for each, regenerate any missing `thumb.jpg`. Lives in the same Python service, runs via `APScheduler` or a plain cron-invoked CLI.

**MinIO client library and connection config:**
```python
# cv-service/app/config.py additions
class Settings(BaseSettings):
    minio_endpoint: str = "minio:9000"
    minio_access_key: str
    minio_secret_key: str
    minio_bucket: str = "harvest-snapshots"
    minio_secure: bool = False  # internal network; nginx does TLS on the edge
```

```python
# cv-service/app/services/storage.py
from minio import Minio
from app.config import settings

minio_client = Minio(
    settings.minio_endpoint,
    access_key=settings.minio_access_key,
    secret_key=settings.minio_secret_key,
    secure=settings.minio_secure,
)
```

**Key generation (ULID for sortability + uniqueness):**
```python
from datetime import datetime, timezone
from ulid import ULID

def detection_keys(detection_ulid: ULID) -> tuple[str, str]:
    ts = datetime.now(timezone.utc)
    prefix = f"detections/{ts:%Y/%m/%d}/{detection_ulid}"
    return f"{prefix}/full.jpg", f"{prefix}/thumb.jpg"
```

### 4.2 MinIO setup

**Bucket name:** `harvest-snapshots` (single bucket, prefix-partitioned).

**Prefix layout:**
```
harvest-snapshots/
  detections/
    {YYYY}/{MM}/{DD}/{detection_ulid}/
      full.jpg
      thumb.jpg
```

Rationale:
- Date-first (not user-first) keeps lifecycle rule dead-simple (one prefix, one rule).
- `{detection_ulid}/` folder groups variants for atomic prefix-delete on detection removal.
- ACL via DB (`Detection → DetectionSession → userId`), not path — standard pattern from `phase1-storage-patterns.md`.

**Lifecycle rule (exact `mc` command):**
```bash
mc alias set harvest http://minio:9000 $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD
mc mb harvest/harvest-snapshots --ignore-existing
mc version enable harvest/harvest-snapshots
mc ilm rule add harvest/harvest-snapshots \
    --id "expire-detections-90d" \
    --expire-days 90 \
    --prefix "detections/"
```

Caveats from `phase1-minio-specific.md` §1:
- Scanner-driven, can be delayed hours under load — do **not** rely on exact 90-day cut for legal retention.
- Keep an independent DB audit record (`Detection.createdAt` + the `snapshotKey` column) so the app has a source of truth.

**Presigned URL TTL:** **1 hour (3600 s) for GET** in the default "view list/detail" flow. Short enough to limit a leak window, long enough to cover a typical agronomist session without constant re-signing. Regenerated on each page load in Nuxt API routes — **never cached in the DB**.

**Server URL config (mandatory for presigned URL signatures to work behind nginx):**
```yaml
# docker-compose.yml — minio service
environment:
  MINIO_ROOT_USER: ${MINIO_ROOT_USER}
  MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
  MINIO_SERVER_URL: https://app.harvestpredictor.com
  MINIO_BROWSER_REDIRECT_URL: https://app.harvestpredictor.com/minio-console
```

Without `MINIO_SERVER_URL`, nginx rewrites the Host header and presigned signatures break (issue #6853, `phase1-minio-specific.md` §3).

**Nginx reverse proxy config snippet (same-origin serving fixes CORS + TLS):**
```nginx
# /etc/nginx/conf.d/harvestpredictor.conf
server {
    listen 443 ssl http2;
    server_name app.harvestpredictor.com;

    ssl_certificate     /etc/letsencrypt/live/app.harvestpredictor.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.harvestpredictor.com/privkey.pem;

    # Same-origin image serving — bypasses MinIO CORS bug entirely
    location /media/ {
        proxy_pass http://minio:9000/harvest-snapshots/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Images are cacheable by the browser; presign expiry handles freshness
        proxy_buffering on;
        proxy_cache_valid 200 1h;
        client_max_body_size 20m;
    }

    # Nuxt app
    location / {
        proxy_pass http://nuxt:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Frontend image URLs become `https://app.harvestpredictor.com/media/detections/...?X-Amz-Signature=...` — same origin as the Nuxt app. Zero CORS.

### 4.3 Prisma schema — Detection model update

The task prompt asked to update a `Connection` model; `prisma/schema.prisma` has no such model — treating that as a wording slip for the MinIO connection config, which lives in env vars, not the DB. Only `Detection` needs a schema change.

```prisma
model Detection {
  id          String   @id @default(cuid())
  className   String
  category    String
  confidence  Float
  severity    String
  bbox        Json
  sessionId   String

  // Snapshot storage — Approach B (thumb + full in MinIO)
  // Storage key is the detection's folder under the bucket, e.g.
  // "detections/2026/04/08/01HV7K.../", with variants "thumb.jpg" and "full.jpg" appended server-side.
  // Null for legacy pre-snapshot rows; required for new writes.
  snapshotKey String?
  // Whether async thumbnail has been uploaded. Reconciler flips this to true.
  // Frontend uses this to decide whether to request thumb URL or fall back to full.
  thumbReady  Boolean  @default(false)

  createdAt   DateTime @default(now())
  session     DetectionSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId])
  @@index([className])
  @@index([createdAt(sort: Desc)])
  @@index([thumbReady, createdAt])  // reconciler scan: find detections missing thumbs
}
```

Migration notes:
- `snapshotKey` nullable for backfill compatibility (existing `DetectionSession.thumbnail Bytes?` blobs stay as-is, get a follow-up migration job if needed).
- Do **not** store `fullUrl`/`thumbUrl` strings — URLs are presigned on demand, TTL = 1 h. Caching them in the DB guarantees a leak window equal to whatever you forget to invalidate.

### 4.4 Nuxt API routes

**AWS SDK choice:** `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (official, actively maintained, tree-shakable, S3 API-compatible with MinIO). Avoid `minio` npm package — less maintained in 2026 and pulls in more runtime.

**Shared presigner (`server/utils/s3.ts`):**
```typescript
import { S3Client } from "@aws-sdk/client-s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  endpoint: process.env.MINIO_INTERNAL_ENDPOINT,  // http://minio:9000
  region: "us-east-1",                            // ignored by MinIO but required by SDK
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY!,
    secretAccessKey: process.env.MINIO_SECRET_KEY!,
  },
  forcePathStyle: true,
});

const BUCKET = "harvest-snapshots";
const PRESIGN_TTL_SECONDS = 3600;

export async function presignGet(key: string): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  const signed = await getSignedUrl(s3, cmd, { expiresIn: PRESIGN_TTL_SECONDS });
  // Rewrite internal MinIO URL to same-origin /media/ path for browser
  const url = new URL(signed);
  return `/media/${url.pathname.replace(/^\/harvest-snapshots\//, "")}${url.search}`;
}
```

**List endpoint — returns thumb URLs only (`server/api/cv/detections/index.get.ts`):**
```typescript
import { presignGet } from "~/server/utils/s3";

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  const { sessionId, limit = "50", cursor } = getQuery(event);

  const detections = await prisma.detection.findMany({
    where: {
      session: { userId: user.id, ...(sessionId ? { id: sessionId as string } : {}) },
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Number(limit), 200),
    ...(cursor ? { cursor: { id: cursor as string }, skip: 1 } : {}),
    select: {
      id: true, className: true, category: true, severity: true,
      confidence: true, createdAt: true,
      snapshotKey: true, thumbReady: true,
    },
  });

  return Promise.all(
    detections.map(async (d) => ({
      id: d.id,
      className: d.className,
      category: d.category,
      severity: d.severity,
      confidence: d.confidence,
      createdAt: d.createdAt,
      // If thumb not yet ready, fall back to full — frontend CSS-resizes as degraded mode
      thumbUrl: d.snapshotKey
        ? await presignGet(`${d.snapshotKey}${d.thumbReady ? "thumb.jpg" : "full.jpg"}`)
        : null,
    })),
  );
});
```

**Detail endpoint — returns full URL + all metadata (`server/api/cv/detections/[id].get.ts`):**
```typescript
import { presignGet } from "~/server/utils/s3";

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  const id = getRouterParam(event, "id")!;

  const detection = await prisma.detection.findFirst({
    where: { id, session: { userId: user.id } },
  });
  if (!detection) throw createError({ statusCode: 404 });

  return {
    ...detection,
    fullUrl: detection.snapshotKey
      ? await presignGet(`${detection.snapshotKey}full.jpg`)
      : null,
    thumbUrl: detection.snapshotKey && detection.thumbReady
      ? await presignGet(`${detection.snapshotKey}thumb.jpg`)
      : null,
  };
});
```

### 4.5 Frontend (Nuxt 4 + Vue 3)

**Virtual scroll library:** `@tanstack/vue-virtual`. Rationale from `phase1-frontend-perf.md` §3: actively maintained, first-class Vue 3, headless (no SSR traps), clean Nuxt 4 story. Kick in at 200+ items. Under 200, plain grid + lazy loading is cheaper and avoids layout oddities. **Check first** whether Nuxt UI 4's `UScrollArea` already wraps TanStack under the hood — if yes, use it instead to avoid the dep.

**List cell — `app/components/cv/DetectionCard.vue`:**
```vue
<template>
  <div class="aspect-square overflow-hidden rounded-lg bg-neutral-100">
    <img
      v-if="detection.thumbUrl"
      :src="detection.thumbUrl"
      :alt="detection.className"
      width="320"
      height="320"
      loading="lazy"
      decoding="async"
      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
      class="h-full w-full object-cover"
      @error="onImgError"
    >
    <div v-else class="flex h-full items-center justify-center text-neutral-400">
      <UIcon name="i-lucide-image-off" />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ detection: { id: string; thumbUrl: string | null; className: string } }>();

function onImgError(e: Event) {
  // Presigned URL expired mid-scroll or object 404 — swap in placeholder and log
  const img = e.target as HTMLImageElement;
  img.src = "/img/snapshot-placeholder.svg";
  console.warn("snapshot_load_failed", { id: props.detection.id });
}
</script>
```

Key attributes and why:
- `width`/`height` fixed at 320 — prevents CLS, reserves layout slot before load.
- `loading="lazy"` — native, ~96% support, free defer of off-screen network fetch.
- `decoding="async"` — off-main-thread decode, prevents jank on scroll.
- `sizes` reflects real CSS layout, not `100vw` (over-fetch trap from `phase1-frontend-perf.md` §5).
- No `srcset` in MVP — we only generate one thumb size. Revisit if telemetry shows retina screens needing 640w.

**Detail modal behavior:**
- On card click, open `UModal` containing the full image + classification metadata + bbox overlay.
- Full image uses `loading="eager"` + `fetchpriority="high"` (it's the modal's LCP).
- Fetch detail endpoint once on mount to get fresh presigned URL; do not re-use list `thumbUrl`.

**Error states:**
- **Presigned URL expired (403 from MinIO):** `<img onerror>` handler swaps to placeholder, log to Sentry. Page reload regenerates URLs — acceptable UX for a 1 h TTL edge case.
- **Image 404 (object missing):** same handler, same fallback. Reconciler job catches this in the next run.
- **Thumb not ready but full exists (`thumbReady=false`):** list returns full URL in place of thumb — browser CSS-resizes, higher bandwidth for that cell only. Self-healing once reconciler runs.

---

## 5. Migration triggers to Approach C

Upgrade B → C (add imgproxy sidecar) **only** when a specific, measurable trigger fires. Until then, B is correct.

1. **ONNX inference backpressure.** P95 inference latency exceeds SLO and `/metrics` shows the thumb `ThreadPoolExecutor` queue depth > 50 for sustained periods. Measured: add Prometheus gauge `cv_thumb_queue_depth` and alert on > 50 for 5 min.
2. **Frontend needs 3+ breakpoint variants.** Product asks for retina (640w), 4K (1280w), social share (1200x630). At 3+ sizes, pre-generation starts costing more than imgproxy URL-param resize.
3. **CDN deployed for other reasons.** If Cloudflare/BunnyCDN goes in front of the app for static asset delivery, the imgproxy cache-stampede objection disappears — imgproxy now has a cache above it.
4. **AVIF format delivery requirement.** Product wants `<picture>` with AVIF source. Pre-generating AVIF in Python is 150-2000 ms per image (`phase1-image-formats.md` §3) — imgproxy does it on demand with format negotiation.
5. **Evidentiary archive requirement emerges.** If legal flags 1280px q=82 as insufficient for audit and we must retain sensor-resolution originals, the footprint becomes 2.2× anyway — at that point B's storage advantage over C disappears and C's flexibility becomes free.

Not triggers: "it would be nice," "we might need it someday," storage cost delta alone at MVP scale.

---

## 6. Risks and mitigations

- **MinIO OSS freeze (Dec 2025 maintenance mode).** Real risk: no new features, security patches case-by-case. **Mitigation:** (a) Pin to the latest RELEASE tag before the freeze cutoff and lock it in `docker-compose.yml`. (b) Keep MinIO internal-only behind nginx — reduces attack surface. (c) Document exit plan now: SeaweedFS (Apache 2.0 drop-in, S3-compatible) or Hetzner Object Storage (~€5/TB/mo managed) — both are `@aws-sdk/client-s3` swap-outs with no app code changes. Migration becomes a `mc mirror` copy + endpoint flip.
- **Async thumbnail generation fails (pyvips crash / pathological frame / OOM).** **Mitigation:** (a) Queue is bounded at 200 — backpressure is visible, not silent. (b) `full.jpg` is written synchronously first, so no data is lost when thumb fails. (c) Frontend `<img onerror>` falls back to full URL for unaffected rendering. (d) Nightly reconciler job walks last 24 h, regenerates any missing thumbs. (e) Container `restart: unless-stopped` restarts the service if pyvips hard-crashes the process.
- **Presigned URL leak.** Bearer token for 1 h. **Mitigation:** (a) HTTPS-only + `Referrer-Policy: no-referrer` header in nginx. (b) 1 h TTL is short enough that leaks auto-expire within one session. (c) Nuclear option documented: rotate the MinIO access/secret key pair → all outstanding signatures die immediately. (d) Dedicated minimally-scoped IAM user for presign (read-only on `detections/` prefix), not admin credentials.
- **Thumbnail generation backpressure on live stream burst.** Live RTSP pipeline can fire detections faster than a single pyvips worker keeps up. **Mitigation:** (a) Bounded queue rejects new thumbs at 200 rather than growing unbounded — full.jpg still lands, reconciler catches up. (b) Monitor `cv_thumb_queue_depth` and enqueue rejections via Prometheus. (c) Escape hatch: bump `ThreadPoolExecutor(max_workers=2)` if data shows sustained pressure — still cheap on GIL-release. Do not escalate to Celery/Redis for MVP.
- **Storage growth beyond projection.** Projection is ~10 GB / 90 d for 100 users × 100 detections/day × 192 KB. **Mitigation:** (a) Lifecycle rule auto-deletes at 90 d. (b) `mc du` weekly cron report. (c) Alert at 80% disk usage. (d) Real-user telemetry in first 2 weeks — recalibrate 192 KB average from actual drone footage (`phase1-image-formats.md` §9 flagged this as empirically unverified). If real photos are 2× larger, bump VPS tier or tighten q=82 → q=78 on full.
- **MinIO lifecycle scanner delayed or buggy.** Historic bugs (#11210, #21257). **Mitigation:** Keep DB `Detection.createdAt` as the authoritative retention record. Weekly job: query detections older than 90 d and delete their MinIO prefixes directly via `mc rm --recursive`, then delete the DB row. Belt-and-suspenders.

---

## 7. What NOT to build (YAGNI list)

- **No AVIF or WebP pre-generation.** JPEG q=82 is the right MVP answer. AVIF speed-8 is 150-400 ms per image (`phase1-image-formats.md` §3), WebP is 80-170 ms. Revisit as an async derivative later, never on hot path.
- **No third "original" archive variant.** Open product question in §8. Do not ship `B-plus-archive` speculatively — it's 2.2× storage for a use case that may not exist.
- **No 3-size srcset (320/640/1280).** `phase1-frontend-perf.md` recommended it for responsive. One size is enough for MVP; add 640w only if retina users complain or telemetry shows CSS upscaling artifacts.
- **No MinIO webhook-driven thumbnail pipeline.** In-process `ThreadPoolExecutor` is simpler. Webhooks add loop hazards, eventual consistency, and an extra HTTP hop for no gain at MVP scale.
- **No Celery / RQ / Redis queue.** Bounded Python `queue.Queue(maxsize=200)` + single-worker pool is enough. Do not add a broker until backpressure metrics prove it is needed.
- **No imgproxy.** See §5. No CDN, no cache, no URL signing layer, no runbooks.
- **No MinIO tiering.** OSS has a data-loss bug; MVP scale does not need it.
- **No MinIO versioning beyond lifecycle compliance.** Enable versioning (cheap insurance, avoids the "suspended" gotcha from `phase1-minio-specific.md` §1), but do not expose version history in the UI.
- **No `content-visibility: auto` on list items.** Baseline-available but can **increase** scroll CPU on image-heavy lists (`phase1-frontend-perf.md` §6). Skip until profiling says otherwise.
- **No separate S3 bucket per user / per environment**, beyond prod/staging/dev. Prefix partitioning is enough.
- **No pre-warming of presigned URLs.** Always sign on demand in the API route. Never cache URLs in the DB.

---

## 8. Open product questions for user

These must be answered **before** implementation starts. Each has a default we will use if no answer arrives.

1. **Evidentiary retention requirement — load-bearing.** Is `full.jpg` at 1280px q=82 "canonical enough" for the product's use case, or do we need to retain sensor-resolution originals for legal/audit/ML retraining purposes?
   - **If no (default):** Ship B as specified. Storage footprint ~192 KB/detection.
   - **If yes:** Upgrade to `B-plus-archive` — add a third async-written `original.jpg` at native resolution (~500 KB). Storage goes from 192 KB to ~690 KB per detection (3.6× the B plan), ~€1.80/mo for 100 users × 90 d instead of ~€0.50/mo. Also triggers earlier consideration of Approach C because C's 2× storage no longer looks expensive by comparison.

2. **MinIO OSS vs managed alternative — architecture decision.**
   - **(a) MinIO OSS pinned to pre-freeze release (default).** Self-hosted, cheapest, known quantity, documented exit plan. Recommended for MVP.
   - **(b) Start on SeaweedFS instead.** Apache 2.0, actively maintained, S3-compatible. Avoids the freeze question entirely. Cost: one extra learning curve, less battle-tested than MinIO. Worth it if Ali is uncomfortable running frozen infrastructure for user data.
   - **(c) Hetzner Object Storage (~€5/TB/mo).** Managed, zero ops. Costs ~€0.05/mo for MVP scale. Removes the "maintain object storage" burden entirely. Worth it if the grant-funded ops budget can absorb managed infra.

3. **Full-variant resolution cap.** The plan uses 1280px longest edge for `full.jpg`. Drone footage may arrive at 4K. Confirm 1280px is acceptable for the detail view, or bump to 1920px (adds ~100 KB per full, ~50% bandwidth on detail view but still trivial vs list view).

4. **Retention window.** Plan uses 90 days. Is that the product's actual target, or is it 30 / 180 / indefinite? Lifecycle rule is a one-line change, but this interacts strongly with question 1 (evidentiary).

5. **List view page size.** The plan assumes list render of up to 500 items with virtual scroll for 200+. Confirm the real product flow — if agronomists only view "last 50" or paginate 20 at a time, virtual scroll is premature optimization and `@tanstack/vue-virtual` can be dropped.

6. **Multi-tenant ACL model.** Plan uses `Detection → DetectionSession → userId` as the only ACL check. Confirm HarvestPredictor's B2B cluster pivot (from memory) does not need field-scoped sharing, team-based permissions, or cross-user visibility — those would change both the API route and the key layout.

---

## Key numbers (single-page reference)

| Metric | Value | Source |
|---|---|---|
| `full.jpg` size (1280px q=82) | ~70 KB | `phase1-image-formats.md` §7 |
| `thumb.jpg` size (320px q=78) | ~12-15 KB | `phase1-cost-analysis.md` §3 |
| Storage per 1000 detections | ~192 MB | `tradeoff-matrix.md` row 3 |
| Storage per 100 users × 90 d | ~9.6 GB (~€0.50/mo Hetzner) | `tradeoff-matrix.md` row 12 |
| 500-item list bandwidth | 6 MB / ~24 s @ 2 Mbps | `tradeoff-matrix.md` row 5 |
| 500-item list decoded bitmap | ~205 MB | `phase1-frontend-perf.md` §7 |
| Sync write CPU (hot path) | 3-6 ms (cv2.imwrite) | `phase1-image-formats.md` §8 |
| Async thumb CPU (off path) | 5-10 ms (pyvips) | `phase1-cost-analysis.md` §1 |
| Presigned URL TTL | 3600 s (1 h) | `phase1-minio-specific.md` §3 |
| Lifecycle retention | 90 days | product default |
| Virtual scroll threshold | 200 items | `phase1-frontend-perf.md` §3 |
