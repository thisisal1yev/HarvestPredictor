# Debate Position: Two Pre-Generated Variants

**Debater:** debater-two-variants
**Date:** 2026-04-08
**Task:** #7
**Opponents:** debater-single (Approach A), debater-imgproxy (Approach C)

---

## TL;DR — Final Position

**Store TWO variants per detection, pre-generated at write time, served statically from MinIO through a same-origin nginx reverse proxy.** Encode the full variant synchronously on the CV inference hot path via `cv2.imwrite` (~3–6 ms). Encode the thumbnail asynchronously on a dedicated `ThreadPoolExecutor(max_workers=1)` inside the same FastAPI process, using pyvips for ~5–10 ms per thumbnail with GIL released.

This is the right answer for HarvestPredictor's MVP constraints. It is **not** a knockout win over imgproxy (C); after honest debate, B and C are within ~70/30 for this specific project. B wins on operational minimalism, deterministic read latency, and the ability to ship in ~1 week; C wins on ONNX isolation and the ability to retain original bytes untouched. Single-image (A) lost cleanly on the central bandwidth/quality/scanning-speed axes.

---

## Exact specification

### Image parameters

| Variant | Size (longest side) | Quality | Format | Progressive | OPTIMIZE | Typical bytes | Use |
|---|---|---|---|---|---|---|---|
| `thumb.jpg` | 320 px | q=78 | JPEG | yes | yes | ~15 KB | List view, 50–500 item grids |
| `full.jpg` | 1280 px | q=82 | JPEG | yes | yes | ~60–80 KB | Detail view, diagnostic inspection |

**Encoder flags** (both variants):
```python
cv2.imwrite(path, frame, [
    cv2.IMWRITE_JPEG_QUALITY, 82,          # 78 for thumb
    cv2.IMWRITE_JPEG_OPTIMIZE, 1,
    cv2.IMWRITE_JPEG_PROGRESSIVE, 1,
])
```

Rationale for JPEG, not WebP/AVIF (per `phase1-image-formats.md` §§3, 7):
- `cv2.imwrite` JPEG (libjpeg-turbo): ~2–5 ms
- Pillow/libvips WebP: ~80–170 ms — 20–30× slower
- libaom AVIF default speed 6: 1000–2000 ms — fatal on live stream hot path
- JPEG browser support: 100%. AVIF is tempting but not required at MVP scope.
- q=82 is the "no visible artifacts" line for photographic diagnostic content; q=78 is acceptable for non-diagnostic thumbnails.

### Encode strategy — the load-bearing decision

**Full variant: synchronous on the inference hot path.**
- `cv2.imwrite` at q=82, ~3–6 ms per 1280 px JPEG.
- This IS the canonical write — the frame must be persisted before the detection record is written.
- At 100–1000 detections/day/user this cost is negligible compared to YOLO inference itself (10–50 ms/frame).

**Thumbnail variant: asynchronous via ThreadPoolExecutor inside the same FastAPI process.**
- `concurrent.futures.ThreadPoolExecutor(max_workers=1)` with a bounded `queue.Queue(maxsize=200)`.
- Worker pulls from the queue, calls `pyvips.Image.new_from_file(full_path).thumbnail_image(320).write_to_file(thumb_path, Q=78, strip=True, optimize_coding=True, interlace=True)`.
- pyvips releases the GIL around libvips C calls, so the thumb encode runs in parallel with the Python inference loop.
- ~5–10 ms per thumbnail off the hot path.

**Why this beats `asyncio.create_task`:**
- `asyncio.create_task` shares the event loop. Under sustained inference load, thumb generation lags behind in the same scheduler that's running inference.
- A `ThreadPoolExecutor` runs on a dedicated OS thread. With GIL released by C extensions, the thumbnail work is genuinely off-path.
- `debater-single` scored a real hit on the naive `create_task` proposal in Round 2. This is the corrected version.

**Why this beats a MinIO webhook worker:**
- Webhooks need `queue_dir` set for retry durability (`phase1-minio-specific.md` §4).
- Adds a separate Python worker process, a webhook auth token, loop-hazard avoidance rules (`phase1-minio-specific.md` §5), eventual consistency the frontend has to handle.
- None of this is necessary at 100–1000/day throughput. A 200-slot queue never fills; a 100 thumb/s encoder has an 8000× safety margin against 0.012 detections/s steady load.

**Backlog math** (for the synthesis team to verify):
- Peak ingest rate: 1000 detections/day ≈ 0.012/s.
- Encoder throughput: 1 worker × (1 s / 10 ms) = 100 thumbs/s.
- Queue size 200 at 0.012/s fills in 16,666 seconds = 4.6 hours of backlog before backpressure hits.
- Realistic: steady-state queue depth is 0, peaks are <10.

### Storage layout

```
detections/
  {YYYY}/{MM}/{DD}/{detection_id}/
    thumb.jpg   # 320 px, q=78, ~15 KB, async-generated
    full.jpg    # 1280 px, q=82, ~70 KB, sync-generated
```

Layout rationale (per `phase1-storage-patterns.md` §4):
- **Date prefix first** → trivial lifecycle rules (`mc ilm rule add --expire-days 90`).
- **Detection ID as folder** → atomic per-detection delete (`mc rm --recursive {prefix}`).
- **Variant as filename** → CDN-friendly, no query-string gymnastics.
- **No user_id in path** → access control lives in the DB, not in object keys. This preserves the ability to reassign/share detections without moving objects.
- **ULID detection_id** for time-sortable, URL-safe, unguessable keys.

### Access and serving

- **Same-origin nginx reverse proxy** in front of MinIO at `https://app.harvestpredictor.com/media/...`.
- Fixes MinIO's well-known CORS breakage on presigned URLs (`phase1-minio-specific.md` §8, issues #3985, #10002, #11111).
- Provides TLS termination (needed anyway).
- Eliminates CORS complexity entirely — `<img>` loads are same-origin.
- MinIO runs internal-only, behind the nginx, bound to Docker network.

- **Presigned URLs** for private objects: 15–60 min TTL for image GET, re-signed on each request (per `phase1-minio-specific.md` §3).
- **Access control** in the DB at the `detections` table level. MinIO IAM uses a single prefix-scoped read-only IAM user for presign issuance.

### Frontend contract

Per `phase1-frontend-perf.md` §3, 5, 8 — the same frontend techniques apply to any backend strategy:

```vue
<NuxtImg
  :src="detection.thumbUrl"
  :alt="detection.label"
  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
  :width="320"
  :height="320"
  loading="lazy"
  decoding="async"
/>
```

- Virtual scrolling via `@tanstack/vue-virtual` kicks in at 200+ items.
- List view always requests `thumb.jpg`.
- Detail view always requests `full.jpg`.
- `<img onerror>` fallback: if `thumb.jpg` is genuinely missing (rare, only on pathological failures), fall back to `full.jpg` per-image. This is a per-image UX degradation, not a systemic one.

---

## Why B wins for HarvestPredictor

### 1. Bandwidth budget fits the actual users

`phase1-cost-analysis.md` §4 gives the anchor: 500-item list view on 2 Mbps rural Uzbek LTE.

| Approach | Per-item transfer | 500 items | Time @ 2 Mbps |
|---|---|---|---|
| Single 1280 px | ~180 KB | 90 MB | **~6 min — unusable** |
| Single 720 px q75 (debater-single's rescue) | ~60–90 KB | 30–45 MB | **~2–3 min — marginal** |
| Two variants (thumb in list) | ~15 KB | 6 MB | **~24 s — usable** |
| imgproxy cached (same 320 w thumb) | ~15 KB | 6 MB | **~24 s — usable (after warmup)** |

For the **scanning workflow** (agronomist scrolling 4 items/sec through history):
- Two-variants: 4 × 15 KB = 60 KB/s = 0.48 Mbps (4× headroom on 2 Mbps)
- Single 720 px q=82: 4 × 80 KB = 320 KB/s = 2.56 Mbps (exceeds link capacity)

B has constant 4× headroom on the bandwidth budget across both initial-load and scan workflows. A and C (cold) do not.

### 2. Decoded bitmap memory fits phone RAM

`phase1-frontend-perf.md` §7:

| Source | Decoded per image | 500 images |
|---|---|---|
| 1280 × 1280 | **6.55 MB** | **3.28 GB — mobile OOM** |
| 720 × 720 | 2.07 MB | 1.03 GB — risky on 2 GB Android |
| 320 × 320 | **0.41 MB** | **205 MB — survivable** |

Virtual scrolling limits concurrent decoded bitmaps to ~20 mounted items, but on fast scroll every newly-mounted row pays a fresh decode. 1280 or 720 px decode on low-end Android is 5–10× more expensive per image than 320 px. B's thumbnails attack this directly.

Twitter's mobile-web case study (`phase1-frontend-perf.md` §6): **400 ms → 19 ms per image (21×)** purely by serving correct sizes. Not by lazy loading, not by HTTP/2, not by virtual scroll — by resizing on the server.

### 3. Deterministic zero-CPU read path

B serves static bytes from MinIO through nginx. **Zero CPU at read time, ever.** First view = thousandth view. No cold-path stall on:
- First-view latency for a new user (no cache to warm)
- Device-cache misses (3–5 per user across phone + tablet + desktop)
- 30-day+ old detections outside any LRU eviction window
- Post-restart cache flush
- Disk-full evictions

C's bimodal latency (0 on hit, 12–50 ms on miss) is acceptable for the hot "recent detections" workflow but penalizes the "scan back to last month" workflow — the exact use case agronomists need when comparing current field state to historical baselines.

### 4. Operational minimalism for a 1–3 person team

| | Approach B | Approach C |
|---|---|---|
| Containers on host | MinIO + nginx | MinIO + nginx + imgproxy |
| New config lines | ~0 (nginx already needed) | ~20 (nginx cache block) |
| New code | ~40 lines Python (ThreadPoolExecutor + pyvips) | ~4 lines (URL signing helper) |
| New services to monitor | None | imgproxy + nginx cache hit rate |
| New failure modes | Missing thumb → fallback to full (rare) | Cold miss stall, cache disk full, imgproxy OOM, signed URL key rotation |
| New secrets to manage | None | `IMGPROXY_KEY`, `IMGPROXY_SALT`, rotation policy |

Honest count after Round 2 corrections: **+1 thread pool vs +1 container**. Both are incremental on the same base stack. B is about 30% cheaper on ops surface, not 2× cheaper — but 30% still matters for a team without 24/7 on-call.

### 5. Strict upgrade path to C, at some cost

**B-with-lossy-full-jpg** is a strict subset of C on the write path: same originals feed in, both write durable bytes to MinIO. The upgrade to C (drop imgproxy in front of `full.jpg`) is ~1 week of work, no data migration.

**However** — and this is a point `debater-imgproxy` landed in Round 2 that I owe honestly — **B's `full.jpg` is already a 2nd-generation lossy artifact** (downscaled + recompressed JPEG q82). If we later need imgproxy to regenerate variants, every derived variant is a 3rd-generation artifact. For diagnostic/evidentiary products where fine leaf texture is the diagnosis signal, this is information that cannot be recovered.

**Recommended mitigation for the synthesis phase**: the product team should make an explicit call on whether originals need to be retained. Three options:

1. **B-lossy** (accept the footnote): ship thumb.jpg + full.jpg. Cheapest, fastest, accepts that `full.jpg` is the canonical truth. Right if the product decides 1280 px q=82 is sufficient for all future use cases.

2. **B-plus-archive**: ship thumb.jpg + full.jpg + original.jpg (async). Storage cost ~2.2× B-lossy (close to C's footprint), but preserves lossless upgrade path to C and evidentiary retention. Right if the product flags evidentiary or future-flexibility concerns.

3. **C directly**: ship original.jpg + imgproxy sidecar. Pays operational complexity now. Right if the product wants retina/multiple breakpoints within 6 months AND a CDN is coming anyway.

The debate clarified this is a **product decision**, not a technical one. My recommendation: default to **B-lossy** for the MVP Telegram-bot pilot, with a documented escalation path to B-plus-archive if any of the trigger conditions below are met.

---

## Migration trigger conditions (C becomes the right answer)

C (imgproxy sidecar) should replace B if **any** of these become true:

1. **Third display context appears.** If design adds retina (2×/3× DPR), social share cards, mobile-small (240w), or art-direction crops, B's backfill burden exceeds C's ongoing cost. Threshold: 3+ distinct sizes.

2. **CDN is deployed for other reasons.** If HarvestPredictor puts Cloudflare/BunnyCDN in front of the app for any reason (bandwidth cost, DDoS protection, static asset speed), the cold-miss argument for B collapses and C becomes strictly better on flexibility.

3. **Format negotiation matters.** If agronomist devices start showing uneven AVIF/WebP support performance, `<picture>` with `Accept`-header routing via imgproxy becomes worth it.

4. **Evidentiary use case confirmed.** If product confirms the detections are legal/compliance evidence requiring untouched originals, migrate to B-plus-archive immediately (not C) — that's the cheapest way to preserve originals without adopting imgproxy.

5. **Scale breakpoint at ~5000 active users.** The storage cost difference starts to matter on self-hosted VPS budgets.

6. **A corrupt-frame libvips crash takes down the CV service.** The shared-failure-mode risk I identified becomes real. Mitigate first with supervisor restart, migrate to C only if recurrent.

None of these are true today.

---

## Weaknesses of this position — honestly named

### 1. Non-trivial write-path code (vs C)

C writes the original untouched. B writes full + queues thumb. That's ~40 lines of Python for the queue + worker, plus pyvips as a new dependency in the CV service. Small, but real. `debater-imgproxy` correctly pointed out this shares libvips into the inference process, coupling failure modes with ONNX.

**Defense:** libvips is production-proven in thousands of deployments. Run the CV service under a supervisor (systemd / `restart: unless-stopped`) so crashes self-heal. If libvips ever becomes a real fault source, migrate to C. Until then it's a theoretical risk.

### 2. Lossy canonical `full.jpg`

The single biggest hit I took in Round 2 against imgproxy. If we ever need higher-fidelity derivatives than q=82 1280 px, the bytes are gone. This is a permanent information loss mitigated only by shipping originals alongside — which erases B's storage advantage over C.

**Defense:** for the MVP scope (review yesterday's detections, verify YOLO bounding box), 1280 px q=82 IS the diagnostic unit of truth. Escalate to B-plus-archive if the product team flags evidentiary concerns.

### 3. Cold-cache doesn't apply to B — but imgproxy's cold-cache argument was overstated

In Round 1 I framed "imgproxy has no internal cache → origin melts without CDN" as decisive. After `debater-imgproxy` brought receipts on `proxy_cache_lock` + `proxy_cache_background_update` + JPEG throughput, the honest number is ~1.5 s wall-clock for a 500-item cold view at 4 imgproxy workers, not 22 s. I **withdrew the origin-melt framing**. C without a CDN is operationally viable. It's not catastrophically bad; it's just slightly worse on cold paths where B is zero.

### 4. Thumbnail correctness depends on pyvips availability

The `pyvips`/libvips dependency must be installed in the CV service Docker image. On Debian/Ubuntu this is `apt install libvips-dev`. Not complex, but a new build-time dependency. Pillow alone at 30–40 ms per thumb works but eats noticeably more CPU budget.

### 5. Single-image was not disqualified as cleanly as I first argued

I initially framed single-image as "cannot work on 2 Mbps LTE" — that was based on a 1280 px strawman `debater-single` never proposed. After their 720 px rescue, the honest framing is: single-image depends on three conjunctive assumptions (q=75 is enough for diagnosis, file sizes land at ~50 KB, users scroll slowly) that all need to hold simultaneously. They probably don't all hold. But the margin is thinner than my Round 1 rhetoric claimed.

Where B still wins vs single-image cleanly: zero conjunctive assumptions. 15 KB thumbnails fit the bandwidth budget at any scroll speed, any file-size variance, any diagnostic pixel requirement.

`debater-single` conceded the debate in Round 3 acknowledging "two-variants wins on the merits for this specific project." That resolution is honest.

---

## Key numbers (source of truth)

Referenced from `phase1-*.md`:

| Number | Value | Source |
|---|---|---|
| cv2 JPEG encode (640² plant photo) | 2–5 ms | phase1-image-formats §3 |
| pyvips/libvips JPEG encode | 2–4 ms | phase1-image-formats §3 |
| pyvips thumbnail (resize+encode) | 5–10 ms | phase1-cost-analysis §1 |
| Pillow sync B write path | 70–95 ms | phase1-cost-analysis §1 |
| JPEG q82 640² plant photo | 50–80 KB | phase1-image-formats §7 |
| JPEG q82 1280² | ~150–250 KB | phase1-image-formats §7 |
| JPEG q75 640² | 30–50 KB | phase1-image-formats §7 |
| Storage B per 1000 detections | ~192 MB | phase1-cost-analysis §3 |
| Storage C per 1000 detections | ~380 MB | phase1-cost-analysis §3 |
| Bandwidth B 500-item list | ~6 MB / 24 s @ 2 Mbps | phase1-cost-analysis §4 |
| Bandwidth A 500-item list (1280) | ~90 MB / 6 min @ 2 Mbps | phase1-cost-analysis §4 |
| Decoded 1280² bitmap | 6.55 MB | phase1-frontend-perf §7 |
| Decoded 320² bitmap | 0.41 MB | phase1-frontend-perf §7 |
| Twitter decode case study | 400 ms → 19 ms (21×) | phase1-frontend-perf §6 |
| imgproxy JPEG throughput (c7i.large) | 79.6 req/s | phase1-cost-analysis §2 |
| imgproxy WebP throughput (same) | 22 req/s | phase1-cost-analysis §2 |
| MinIO OSS maintenance mode start | December 2025 | phase1-minio-specific §9 |

---

## Debate log summary

### Round 1 — Opening

- **vs single-image**: attacked on 1280 px bandwidth (90 MB), decoded memory (3.28 GB), size-fits-all geometric impossibility. Strong-but-overshot on 1280 px strawman.
- **vs imgproxy**: attacked on CDN dependency, 2× storage, cold-cache latency, operational complexity, MinIO-OSS-freeze migration risk. Offered the "B is strict subset of C" closer.

### Round 2 — Rebuttal

- **vs single-image (their 720 px q=75 rescue)**: re-anchored on realistic 60 KB file size, scan-speed UX failure mode at 1.9 Mbps sustained, server-side vs client-side cost distribution, ThreadPoolExecutor answer to the async reliability attack.
- **vs imgproxy (their nginx proxy_cache rebuttal)**: withdrew "origin melt without CDN" framing, conceded `proxy_cache_lock` works; reframed around 30-day cache eviction tail, scanning workflow, operational count honesty.

### Round 3 — Concessions and Close

- **vs single-image**: conceded the 1280 px strawman was unfair, conceded the async-is-not-free attack was sharp, delivered ThreadPoolExecutor answer, narrowed claim to "depends on three unverified conjunctive assumptions." `debater-single` conceded the core position: two-variants wins on merits for HarvestPredictor's use case.
- **vs imgproxy**: conceded the generation-loss point (my `full.jpg` is lossy, not the original), conceded "4 services vs 2" was overcounting (~1.5 vs 1 honest), conceded the "17 TB vs 34 TB" scale math contradicted my own YAGNI rule. `debater-imgproxy` converged on "B is the right MVP answer; C is the right upgrade target when triggers fire."

### Net outcome

- **A (single-image)**: Decisively disqualified. `debater-single` withdrew the position.
- **B (two variants)**: Wins on MVP merit, ~70/30 vs C.
- **C (imgproxy)**: Defensible, loses on current constraints, correct upgrade target when trigger conditions fire.

---

## Recommendation to synthesis phase (task #10)

**Ship B-lossy for MVP** with the following exact specification:

1. **Write path**:
   - `cv2.imwrite(full.jpg, q=82, progressive, optimize)` synchronously on the CV inference path — 3–6 ms.
   - `concurrent.futures.ThreadPoolExecutor(max_workers=1)` + bounded `queue.Queue(maxsize=200)` for thumbnail generation using pyvips, 5–10 ms off-path with GIL released.
   - Both objects written to `detections/{YYYY}/{MM}/{DD}/{ulid}/{thumb,full}.jpg`.

2. **Read path**:
   - `thumb.jpg` for list views (50–500 items).
   - `full.jpg` for detail views.
   - `<img onerror>` fallback from thumb → full for pathological missing-thumb cases.
   - Same-origin path routing through nginx reverse proxy; MinIO internal-only.

3. **Frontend**:
   - `<NuxtImg>` with `loading="lazy"`, `decoding="async"`, explicit `width`/`height`.
   - `@tanstack/vue-virtual` for lists ≥200 items.
   - No `srcset` at MVP (single thumb variant is enough for a single list breakpoint).

4. **Infrastructure**:
   - Pin MinIO to latest pre-freeze RELEASE (`phase1-minio-specific.md` §9).
   - nginx for TLS, CORS, same-origin routing, access logging.
   - 90-day lifecycle rule via `mc ilm rule add --expire-days 90 detections/`.
   - Document SeaweedFS / Hetzner Object Storage exit plan.
   - Supervise CV service with `restart: unless-stopped` to self-heal libvips edge cases.

5. **Open product question** for the team to decide before shipping:
   - Is `full.jpg` at 1280 px q=82 the canonical truth, or does HarvestPredictor need to retain pristine originals for evidentiary use? If yes, upgrade to **B-plus-archive** (add `original.jpg` as a third async-written object).

6. **Documented migration triggers to C** (imgproxy sidecar): 3+ display sizes, CDN deployment, format negotiation need, evidentiary retention confirmed, scale > 5000 active users, libvips becomes a recurring fault source.

---

## Sources

From `docs/research/phase1-*.md`:
- `phase1-storage-patterns.md` — industry patterns (Facebook Haystack, Shopify, Trendyol, imgproxy case studies)
- `phase1-image-formats.md` — JPEG/WebP/AVIF encoder throughput, quality-vs-size tables
- `phase1-frontend-perf.md` — decoded bitmap memory math, Twitter case study, virtual scrolling guidance
- `phase1-minio-specific.md` — MinIO OSS maintenance-mode, CORS breakage, webhook reliability
- `phase1-cost-analysis.md` — CPU/bandwidth/storage/memory tradeoff matrix

External corroboration via WebSearch:
- pyvips is 5–10× faster than Pillow for thumbnail generation ([pyvips benchmark gist](https://gist.github.com/amw/2febf24ebcb3baf409c50decbea71e6e), [Pond5 case study](https://medium.com/@pond5-technology/our-journey-to-an-optimised-image-management-library-81aeed079532))
- MinIO webhook requires `queue_dir` for reliable delivery ([MinIO docs](https://github.com/minio/minio/blob/master/docs/bucket/notifications/README.md))
- libvips releases GIL around C extension calls ([libvips wiki](https://github.com/libvips/libvips/wiki/Speed-and-memory-use))
- nginx `proxy_cache_lock` coalesces concurrent misses ([NGINX blog — mitigating thundering herd](https://blog.nginx.org/blog/mitigating-thundering-herd-problem-pbs-nginx))

---

## Final honest note

This position won the debate, but not by knockout. `debater-single` conceded the core claim after honest exchange. `debater-imgproxy` and I converged on "B now, C later if triggers fire." The debate improved my position materially: I started with a rhetorical "B is a strict subset of C" bumper sticker and ended with a nuanced "B-lossy is a subset for the bytes we've thrown away, which is fine for MVP but needs a product-level decision on evidentiary retention."

The synthesis team should treat this recommendation as **high-confidence on B as the MVP direction**, **medium-confidence on the exact three-object vs two-object layout** (pending the evidentiary product decision), and **low-confidence on the 30-day vs 90-day cache eviction assumptions** (pending real-world usage data once the MVP ships).

— debater-two-variants
