# Debate Position — On-the-fly resize via imgproxy (Approach C)

**Debater:** debater-imgproxy
**Task:** #8
**Date:** 2026-04-08
**Rounds:** 3 with `debater-single`, 3 with `debater-two-variants`

---

## TL;DR — honest verdict after debate

**C (single original + imgproxy sidecar behind nginx proxy_cache) is NOT the right answer for HarvestPredictor MVP.**

**B (two pre-generated variants with pyvips async encode) is the right MVP answer.** C is the right answer only after specific trigger conditions are met — none of which hold today.

I argued C and — as instructed — defended it hard. The debate surfaced three load-bearing attacks I could not rescue: eviction-tail recurring CPU cost on historical browsing, `asyncio.ThreadPoolExecutor` + pyvips giving most of the ONNX-isolation benefit without a sidecar, and the 10-hour one-time backfill cost vastly undercutting "continuous infrastructure to avoid it." Each is explained below.

This paper documents:
1. The exact deployment C would use if adopted (no hand-waving)
2. Where C genuinely wins
3. Where C loses and why
4. The trigger conditions that should flip the decision from B to C later

---

## 1. Exact proposed deployment (if C were adopted)

### Object layout
```
snapshots/detections/{YYYY}/{MM}/{DD}/{detection_id}/original.jpg
```

One object per detection. JPEG via `cv2.imwrite`, quality 82, progressive, optimize (per phase1-image-formats §8). No thumbnail, no variant. Original full-resolution frame from the YOLO pipeline.

### Services

```yaml
# docker-compose.yml excerpt
imgproxy:
  image: darthsim/imgproxy:v3.26
  environment:
    IMGPROXY_KEY: ${IMGPROXY_KEY}
    IMGPROXY_SALT: ${IMGPROXY_SALT}
    IMGPROXY_USE_S3: "true"
    IMGPROXY_S3_ENDPOINT: http://minio:9000
    IMGPROXY_MAX_SRC_RESOLUTION: "10"        # 10 MP cap — DDoS limit
    IMGPROXY_MAX_SRC_FILE_SIZE: "10485760"    # 10 MB cap
    IMGPROXY_READ_TIMEOUT: "10"
    IMGPROXY_WRITE_TIMEOUT: "10"
    IMGPROXY_AUTO_WEBP: "true"                # content negotiation via Accept
    IMGPROXY_ENFORCE_WEBP: "false"            # JPEG fallback for cold-path throughput
    IMGPROXY_WORKERS: "4"
  cpus: "2.0"
  mem_limit: 512m
```

```nginx
proxy_cache_path /var/cache/nginx/imgproxy
    levels=1:2
    keys_zone=imgproxy_cache:50m
    max_size=20g                              # sized to hold full 90-day working set
    inactive=90d                              # matches retention; avoids eviction-tail re-renders
    use_temp_path=off;

server {
  # ... TLS + same-origin routing ...

  location /img/ {
    proxy_pass http://imgproxy:8080/;
    proxy_cache imgproxy_cache;
    proxy_cache_key "$scheme$host$request_uri";
    proxy_cache_valid 200 90d;
    proxy_cache_valid 404 1m;

    # Thundering-herd mitigation
    proxy_cache_lock on;
    proxy_cache_lock_timeout 10s;
    proxy_cache_lock_age 15s;

    # Stale-while-revalidate
    proxy_cache_use_stale error timeout updating;
    proxy_cache_background_update on;
    proxy_cache_revalidate on;

    add_header X-Cache-Status $upstream_cache_status;
  }
}
```

### Signed URL format
```
https://app.harvestpredictor.com/img/<signature>/rs:fit:320:320/plain/s3://snapshots/detections/2026/04/08/det_01HW3X.../original.jpg@webp
```

Signature is HMAC-SHA256(key+salt, path), url-safe base64. 4-line helper in Nuxt server route. Rotating `IMGPROXY_KEY` invalidates all outstanding URLs — kill switch for leaked URLs.

### Hot-path write code (CV service)
```python
cv2.imwrite(
    f"/tmp/{detection_id}.jpg",
    frame,
    [
        cv2.IMWRITE_JPEG_QUALITY, 82,
        cv2.IMWRITE_JPEG_OPTIMIZE, 1,
        cv2.IMWRITE_JPEG_PROGRESSIVE, 1,
    ],
)
# upload to MinIO at detections/{YYYY}/{MM}/{DD}/{detection_id}/original.jpg
```

That's the entire image path in the CV service. No thumbnail code, no async worker, no queue.

---

## 2. Where C genuinely wins (the surviving arguments)

### 2.1 Zero re-processing on design evolution
Adding a new display size (retina, mobile-small, social share card, AVIF fallback) is a URL parameter change. No backfill, no historical re-processing, no migration.

**Strength:** Real.
**Caveat:** HarvestPredictor currently has exactly TWO display contexts (list 320w, detail 1280w — per phase1-frontend-perf §8) and no evidence of needing more. YAGNI says this flexibility is not yet earned.

### 2.2 Process-level isolation from ONNX inference
imgproxy runs as a separate process with its own memory and lifecycle. If libvips leaks, OOMs on a pathological frame, or hangs on a corrupt input, `IMGPROXY_READ_TIMEOUT` + Docker restart contain the blast radius. The Python CV service doing YOLO inference never sees it.

**Strength:** Real and uniquely C's.
**Caveat:** `debater-two-variants` correctly pointed out that `asyncio.ThreadPoolExecutor(max_workers=1)` + pyvips running C extensions with released GIL achieves **practical** (not process-level) isolation in the Python service. The narrow remaining asymmetry is "pyvips stuck on a pathological frame wedges the executor until the Python service is restarted," which bites once every few months, not every day. Not enough to justify a sidecar alone.

### 2.3 Cheapest migration footprint off MinIO
If HarvestPredictor follows the phase1-minio-specific §9-10 exit plan to SeaweedFS or Hetzner Object Storage, migrating N originals is strictly cheaper than migrating N originals + N thumbnails with verification of both variants.

**Strength:** Real.
**Caveat:** At MVP scale both migrations complete in hours, not days. Win is meaningful but one-time and small.

### 2.4 Never loses the high-quality original
B's `full.jpg` is already a 1280px q82 recompression. Future generation-loss on any derived thumbnail is baked in. C keeps the original forever, and any derived size is exactly one lossy step from source.

**Strength:** Real for an evidentiary / diagnostic product where image fidelity may matter for dispute resolution or ML re-training.
**Caveat:** No product stakeholder has stated this as a requirement. If 1280px q82 is declared "canonical truth," this argument dies.

### 2.5 CDN-ready architecture on day one
imgproxy URLs are CDN-friendly (path-based, no query strings, Vary: Accept for format negotiation). The day a CDN is deployed, zero refactoring is needed.

**Strength:** Real but mild — B URLs are also CDN-friendly, just less flexible once cached.

---

## 3. Where C loses and why (the attacks I could not rescue)

### 3.1 Eviction-tail recurring CPU cost (killer)
At `inactive=30d` with 90-day retention, ~2/3 of the back catalog lives permanently in eviction territory. Any time an agronomist scrolls into week 5+ (compare-this-week-to-last-month is the archetypal use case), those items get re-rendered. This is not a first-visit cost — it is a **recurring** cost on the exact read pattern the product exists for.

**Workaround:** Bump `inactive=90d` and `max_size=20g`. At that point the cache becomes a de-facto pre-generation store — C is functionally equivalent to B for read latency, but you've spent significant effort tuning nginx cache to simulate what B gives you for free.

**Verdict:** `debater-two-variants` is right. B's zero-CPU deterministic read path is a cleaner match for historical-browsing workloads.

### 3.2 `asyncio.ThreadPoolExecutor` + pyvips neutralizes the "ONNX isolation" trump card
- Hot path: `cv2.imwrite(full.jpg)` — 3-6 ms, same as C
- Background: thumbnail encode via pyvips on a single-worker thread pool — 8-12 ms, off-critical-path
- GIL released around libvips C extensions — truly concurrent with inference loop
- Same failure domain as ONNX, but that's not new risk (ONNX dying is already a full outage)

The write-CPU comparison I relied on (70-95 ms Pillow B vs 30-45 ms Pillow C) assumed vanilla Pillow, which is NOT what any serious B proposal would ship. With pyvips, hot-path cost is **tied**.

**Verdict:** C's "only architecture with isolation" claim was wrong. Correct claim is "only architecture with *process-level* isolation" — a weaker distinction that does not justify a sidecar on its own.

### 3.3 The backfill-cost arithmetic is devastating for "ship C to avoid future backfill"

| Cost | Amount |
|---|---|
| One-time future backfill (if C trigger ever fires) | ~10 hours of single-core CPU = one evening of engineering, once |
| Running imgproxy + nginx proxy_cache + signed URL subsystem until the trigger fires | Continuous: container ops, monitoring, secret rotation, cache disk tuning |

Paying continuous infrastructure cost to avoid a 10-hour one-time job is a **textbook bad trade**. B is a strict-enough subset of C (on the write path — footnote below) that deferring the C decision is near-free.

**Footnote on the "strict subset" claim:** The subset is clean on the write path but not on the read path — B's `full.jpg` is already downscaled-and-recompressed, so B→C later operates on generation-loss artifacts, not originals. If that fidelity matters, B's deferred upgrade is not fully free. If it doesn't, the subset claim holds.

### 3.4 Cold-cache on realistic VPS is worse than the phase1 numbers assumed
`debater-single` correctly recomputed: imgproxy throughput on a Hetzner CPX21 (AMD EPYC, no AVX-512, no NVMe scratch) is 30-50% lower than the c7i.large benchmark numbers. At 30 concurrent items in the virtual-scroll visible window, real cold-miss wall-clock is 35-45 s, not the 1.5 s happy-path number I quoted in Round 1.

On a realistic VPS, **A's pure-network cold-cache (~6 s for 30 items at 50 KB on 2 Mbps) beats C's CPU-bound cold-cache**. C only wins after warmup, and warmup only persists while the cache-eviction policy keeps entries alive.

### 3.5 Operational surface is a subsystem, not an increment
Honest enumeration of what C adds:
- imgproxy container (env vars, cpuset, memlimit)
- `IMGPROXY_KEY`/`IMGPROXY_SALT` — secrets to rotate, audit, store, distribute
- nginx `proxy_cache_path` + `proxy_cache_lock` + `use_stale` + `background_update` tuning
- Cache disk sizing (`max_size`, `inactive`, LRU behavior under pressure)
- Signed URL helper in Nuxt server route (HMAC-SHA256 with key rotation story)
- DDoS cap (`IMGPROXY_MAX_SRC_RESOLUTION`)
- Cache hit-rate monitoring via `X-Cache-Status`
- Runbook: "imgproxy crashes," "cache disk fills," "signing key leaks"

This is roughly 2-3 days of careful work to set up and an ongoing maintenance surface forever. B adds ~40 lines of Python with an `asyncio.ThreadPoolExecutor`.

---

## 4. Trigger conditions for promoting B → C later

Ship B-pyvips now. Upgrade to C (add imgproxy in front of `full.jpg`) when **any** of these become true:

1. **Product commits to 3+ display contexts.** Example: retina (@2x DPR), mobile-small (240w), social share card (1200×630). Once you're backfilling for the third breakpoint, imgproxy's URL-param flexibility pays for itself.

2. **Product commits to format negotiation (AVIF/WebP per `Accept` header).** Same reason — pre-generating N formats × M sizes is combinatorial; imgproxy computes on demand.

3. **A CDN gets deployed for any other reason.** Cloudflare, BunnyCDN, Fastly. At that point imgproxy's design assumption (CDN absorbs 99%+ of traffic) is satisfied and the cold-cache recurring cost goes to zero.

4. **The CV service saturates CPU on inference.** If YOLOv8m or larger runs the box hot, the ~15 ms thumbnail pyvips cost starts to matter. Move it to a sidecar for process-level isolation.

5. **Originals become evidentiary / legally required.** If HarvestPredictor is ever used in crop-insurance disputes, regulatory compliance, or ML re-training on historical data, the "never throw away the original" property becomes load-bearing.

6. **A second consumer of snapshots appears.** Telegram bot wants 600w preview, web app wants 1280w detail, PDF report wants 2000w print-quality — three consumers × three sizes = 9 variants, at which point the backfill becomes expensive and imgproxy's flexibility pays back its ops cost.

Until any of these fires: **B-pyvips is the right call**.

---

## 5. Object key layout (shared with B, forward-compatible to C)

To keep the B → C upgrade path smooth, adopt this key layout regardless of which option ships first:

```
snapshots/
  detections/
    {YYYY}/{MM}/{DD}/{detection_id}/
      full.jpg           # 1280w q82 progressive — the "canonical" image
      thumb.jpg          # 320w q78 progressive — served to list views
```

When C is later layered on top, imgproxy pulls from `full.jpg` (the largest stored variant) and produces any derived size. `thumb.jpg` becomes redundant and its generation step can be removed. `full.jpg` remains the source of truth.

Key properties:
- Date-partitioned prefix — lifecycle rules work naturally (phase1-storage-patterns §4)
- Detection ID as folder — all variants grouped, atomic-ish delete by prefix
- Variant as filename — CDN-friendly, no query strings
- ULID or time-sortable detection_id — preserves creation order
- No user_id in path — ACL via DB, not path (simpler migration + sharing)

---

## 6. Final scorecard

| Dimension | A (single) | B (two variants, pyvips async) | **C (imgproxy)** |
|---|---|---|---|
| Hot-path write CPU | 3-6 ms | 3-6 ms (+8-12 ms off-path) | 3-6 ms |
| Read CPU steady state | 0 | 0 | 0 on hit, non-zero on eviction-tail |
| Cold-cache first-scroll latency (realistic VPS) | ~6 s (network only) | ~0 (pre-gen) | 35-45 s (CPU-bound) |
| Storage per 1000 detections | 180 MB | 192 MB | 380 MB |
| Rural-LTE list-view bandwidth (500 items) | 90 MB (fail at 1280) / 25 MB (survives at 720) | 6 MB | 6 MB |
| Ops surface added | 0 | ~40 lines Python + thread pool | 1 sidecar + cache subsystem + signed URL infra |
| MinIO migration cost | N objects | 2N objects | N objects |
| New-variant flexibility | Backfill + code change | Backfill + code change | URL param change |
| ONNX isolation | weak | strong (thread pool) | strongest (separate process) |
| Best fit for | tiny projects, single-size products | **MVP through scale up** | mature product with 3+ breakpoints or CDN |

---

## 7. One-paragraph conclusion

I was tasked to defend C. The debate forced me to concede three load-bearing arguments: eviction-tail recurring CPU cost on historical browsing is a real and recurring hit (not a one-time cold start), `asyncio.ThreadPoolExecutor` + pyvips neutralizes most of the "ONNX isolation" win that was C's strongest trump card, and the ~10-hour one-time future backfill cost is vastly cheaper than running imgproxy's subsystem continuously until that backfill becomes necessary. **C is technically defensible and architecturally purer, but it is economically premature for HarvestPredictor's MVP.** The right call is B-pyvips with forward-compatible key layout, with documented trigger conditions for promoting to C when any of six specific product or scale events fire. For the synthesis phase: if the team values shipping speed, ops minimalism, and deterministic read latency — B wins. C wins only for a product that has already committed to multi-breakpoint responsive design, format negotiation, or a CDN.

---

## Sources cited during debate

- [NGINX blog — Mitigating the Thundering Herd Problem with proxy_cache](https://blog.nginx.org/blog/mitigating-thundering-herd-problem-pbs-nginx)
- [NGINX caching guide](https://blog.nginx.org/blog/nginx-caching-guide)
- [shinsenter/docker-imgproxy — production-grade imgproxy + nginx cache reference](https://github.com/shinsenter/docker-imgproxy)
- [imgproxy #714 — Contribute a production ready docker-compose setup with nginx caching](https://github.com/imgproxy/imgproxy/issues/714)
- [imgproxy Signing a URL documentation](https://docs.imgproxy.net/usage/signing_url)
- [imgproxy S3 source documentation](https://docs.imgproxy.net/image_sources/amazon_s3)
- [JG Lee — Building an image cache using NGINX (~1000 req/s)](https://medium.com/@jgleeee/building-an-image-cache-using-nginx-30df79520ad7)
- [Evil Martians — A broader picture: a guide on imgproxy for businesses](https://evilmartians.com/chronicles/a-broader-picture-a-guide-on-imgproxy-for-businesses)
- [Trendyol Tech — Implementing an image processing service using imgproxy](https://medium.com/trendyol-tech/implementing-an-image-processing-service-using-imgproxy-e4755a47f3c5)
- [Lincoln Loop — The Trouble with Thumbnails, Part 2](https://lincolnloop.com/blog/trouble-thumbnails-part-2/)
- Internal research files: `phase1-storage-patterns.md`, `phase1-image-formats.md`, `phase1-frontend-perf.md`, `phase1-minio-specific.md`, `phase1-cost-analysis.md`
