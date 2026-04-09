# Phase 1 Research: Cost & CPU Trade-offs for CV Snapshot Storage

**Scope:** HarvestPredictor CV service (Python FastAPI + ONNX Runtime + YOLO) stores 1 snapshot per detection to MinIO. Scale: 100-1000 detections/day/user, list views of 50-500 items. Self-hosted modest VPS, no GPU, Uzbekistan/rural bandwidth constraints.

**Question:** What are the CPU, storage, bandwidth, and memory trade-offs between three snapshot storage strategies?

---

## Approaches Compared

- **A — Single optimized image:** Downscale to ~1280px longest side, WebP q=80, store once. List view uses the same URL (browser downscales via CSS).
- **B — Two pre-generated variants:** Thumbnail (~320px WebP q=75) + full (~1280px WebP q=82). Both generated synchronously on upload.
- **C — Original + on-the-fly resize (imgproxy sidecar):** Store 1 original (~1920px WebP q=85). imgproxy resizes on demand, nginx/CDN caches results.

Assumed drone camera frame after YOLO crop: ~1920x1080 (2.07 MP).

---

## 1. CPU Cost — Write Time (per detection)

Baseline numbers (single thread, modern x86):

- **Pillow (no SIMD)** resize 1920→1280: ~18-25 ms. Resize 1920→320: ~10 ms. JPEG/WebP encode at these sizes: 15-30 ms. ([pillow-perf](https://python-pillow.github.io/pillow-perf/), [libvips benchmarks](https://github.com/libvips/libvips/wiki/Speed-and-memory-use))
- **Pillow-SIMD (AVX2)** resize 1920→320 bilinear: ~558 Mpx/s → ~3-4 ms for one 2 MP image. Resize+encode chain roughly 8-15 ms. ([Uploadcare](https://uploadcare.com/blog/the-fastest-image-resize/))
- **libvips** single-threaded is ~2.6× faster than Pillow-SIMD on the reference pipeline (0.57s vs 1.51s for a 100 MP load+resize+sharpen+save). Per-snapshot resize+WebP encode: ~5-10 ms. ([libvips wiki](https://github.com/libvips/libvips/wiki/Speed-and-memory-use))
- **WebP encoding** is noticeably slower than JPEG at the same quality: imgproxy benchmarks show JPEG at 79.6 req/s vs WebP at 22 req/s on a c7i.large — WebP encode is ~3.6× more expensive than JPEG. ([imgproxy benchmark](https://imgproxy.net/blog/image-processing-servers-benchmark/))

### Per-approach estimates (Pillow, since that's what Python CV service will realistically ship first)

| Approach | Resize ops | Encode ops | Est. ms/detection (Pillow) | Est. ms/detection (Pillow-SIMD) | Est. ms/detection (libvips/pyvips) |
|---|---|---|---|---|---|
| **A — single** | 1 (1920→1280) | 1 (WebP q80) | 40-55 ms | 15-22 ms | 8-12 ms |
| **B — two variants** | 2 (1920→1280, 1920→320) | 2 (WebP×2) | 70-95 ms | 25-38 ms | 14-20 ms |
| **C — original only** | 0 (or light touch-up) | 1 (WebP q85, ~2MP) | 30-45 ms | 12-18 ms | 8-12 ms |

**Verdict:** Approach B is ~1.7× more expensive on write than A. C is cheapest at write time. On plain Pillow, B adds ~30-40 ms per frame — **this is the red zone for live stream inference backpressure**.

---

## 2. CPU Cost — Read Time (per list view of 500 items)

- **A / B:** zero server CPU. Static bytes served from MinIO (or nginx in front of it).
- **C:** first request triggers imgproxy resize. On cache hit (nginx/CDN), zero CPU. On cache miss, imgproxy processes at ~80 JPEG / ~22 WebP req/s per core. ([imgproxy benchmark](https://imgproxy.net/blog/image-processing-servers-benchmark/))

### Cold list of 500 items (cache empty, worst case, Approach C)

- WebP variant: 500 / 22 req/s = **~22 s of CPU time on one core**, or ~2.7s wall-clock on an 8-worker pool.
- JPEG variant: 500 / 80 = **~6.2 s single-core**, ~0.8 s on 8 workers.
- Warm cache: **~0 ms** (nginx serves from disk cache).

**Verdict:** C has a real "thundering herd" risk on first page load. Mitigation: pre-warm the thumbnail for the first N items on upload (hybrid B+C), or restrict imgproxy to JPEG output to triple throughput. With a CDN in front, this becomes a one-time cost per unique URL.

---

## 3. Storage Cost (per 1000 detections)

Empirical file sizes (photographic content, WebP is ~25-35% smaller than JPEG at equivalent visual quality, see [compress-or-die](https://compress-or-die.com/webp)):

| Image | JPEG q85 | WebP q80 |
|---|---|---|
| 1920×1080 full | ~500-700 KB | ~300-450 KB |
| 1280×720 full | ~220-320 KB | ~140-220 KB |
| 320×180 thumb | ~15-25 KB | ~8-15 KB |

### Per 1000 detections (mid-point estimates)

| Approach | Per detection | Per 1000 | Per user/year (365k detections @ 1000/day) |
|---|---|---|---|
| **A — 1280 WebP** | ~180 KB | ~180 MB | ~64 GB |
| **B — full + thumb** | ~180 + 12 = ~192 KB | ~192 MB | ~68 GB |
| **C — 1920 WebP original** | ~380 KB | ~380 MB | ~136 GB |

**Verdict:** B costs only ~7% more storage than A (thumbnails are tiny). C costs **~2× more** than A — on a self-hosted VPS with a finite 500 GB disk, C burns through capacity noticeably faster. If MinIO is mirrored or backed up, multiply accordingly.

---

## 4. Bandwidth Cost (serving 500-item list view)

Assumes grid UI shows a thumbnail per row. User on rural Uzbekistan LTE (~2-5 Mbps realistic).

| Approach | Per-item transfer | 500 items total | Time @ 2 Mbps |
|---|---|---|---|
| **A — same 1280 image for list** | ~180 KB | **~90 MB** | **~6 min** — unusable |
| **B — 320 thumb for list** | ~12 KB | **~6 MB** | **~24 s** — acceptable |
| **C — imgproxy 320 cached** | ~12 KB | **~6 MB** | **~24 s** — acceptable |

**Verdict:** **Approach A is disqualified on bandwidth alone for rural users.** Downloading 90 MB to render a list of detections is not viable. This is the single most important number in this analysis. Approaches B and C are equivalent on the wire (both deliver ~320px thumbs).

Note: even fancy browser "downscale via CSS" does not save bytes — the full image still hits the wire.

---

## 5. Memory Footprint

- **Approach A/B (in-process Pillow in FastAPI):** Pillow loads full uncompressed RGB into RAM. 1920×1080×3 bytes = 6.2 MB per image. With concurrent workers, Python CV service already holds the YOLO model (~300 MB for YOLOv8n ONNX, ~1.2 GB for YOLOv8m). Adding N image buffers per worker = 6-30 MB extra per worker. Acceptable.
- **Approach B specifically:** needs 2 buffers simultaneously during variant generation → ~12 MB peak per detection per worker.
- **Approach C (imgproxy sidecar):** imgproxy runs as separate process, ~512 MB RAM for a "couple of single-CPU instances" is the [documented sweet spot](https://imgproxy.net/faq/). Isolated from Python CV service — no shared memory pressure with ONNX. Plus nginx cache disk (size configurable, e.g. 2-10 GB on disk).
- **libvips alternative:** if adopted on the Python side via pyvips, memory drops to ~94 MB peak (vs Pillow-SIMD ~1 GB for the reference task) on the libvips wiki benchmark. Streaming/demand-driven design.

**Verdict:** A is lightest. B has a brief 2× memory spike. C adds a separate ~512 MB process but **fully isolates image processing from ONNX inference** — this is the key insight for a CPU-bound CV service.

---

## Summary Matrix

| Dimension | A (single) | B (two variants) | C (imgproxy) |
|---|---|---|---|
| Write CPU (Pillow) | 40-55 ms | 70-95 ms | 30-45 ms |
| Write CPU (libvips) | 8-12 ms | 14-20 ms | 8-12 ms |
| Read CPU (cached) | 0 | 0 | 0 |
| Read CPU (cold, 500 items) | 0 | 0 | 6-22 s single-core |
| Storage / 1000 | 180 MB | 192 MB | 380 MB |
| Bandwidth / list-500 | **90 MB (fail)** | 6 MB | 6 MB |
| Memory footprint | lightest | brief 2× spike | +512 MB isolated |
| Isolation from ONNX | none | none | **full** |
| Live-stream backpressure risk | medium | **high** (on Pillow) | **low** (resize deferred) |

---

## Where Each Approach Wins and Hurts

### A — Single optimized image
- **Wins:** simplest code path, least storage, no extra service, cheapest write on libvips.
- **Hurts:** **fails the rural-user bandwidth test** (90 MB for a list view is the dealbreaker). Not viable as the only strategy.

### B — Two pre-generated variants
- **Wins:** cheapest read path (static bytes, no CDN required), tiny bandwidth for lists, predictable latency, only 7% storage overhead vs A.
- **Hurts:** **highest write-time CPU — most dangerous for the live stream**. On vanilla Pillow, +30-40 ms per frame could cause backpressure when the YOLO pipeline is already CPU-bound. Mitigation: push thumbnail generation to a background worker (Celery/asyncio task queue) so the inference loop isn't blocked, OR switch to pyvips.

### C — Original + imgproxy
- **Wins:** **fully isolates image processing from the ONNX-bound Python service** (biggest architectural win). Flexible — can serve any size/format on demand (retina, different breakpoints, format negotiation). Lowest write-time cost. imgproxy outperforms Pillow-based thumbor by 2× on the same hardware. ([imgproxy benchmark](https://imgproxy.net/blog/image-processing-servers-benchmark/))
- **Hurts:** **2× storage cost** — significant on a self-hosted VPS. Cold-cache "thundering herd" when a user opens a never-viewed list. Adds operational complexity (new sidecar, cache eviction policy, no built-in cache so nginx config required). WebP encoding throughput is 3.6× lower than JPEG — if the team wants WebP, throughput drops accordingly.

---

## Recommendation (within this research scope)

**Hybrid B' — "two variants, async":** Generate thumb + full on upload, but **offload the thumbnail encode to a background task** so the inference loop returns immediately. This captures B's bandwidth/latency wins while neutralizing its CPU/backpressure risk.

- Storage overhead: +7%, acceptable.
- Write CPU on critical path: only full-variant encode (~30-45 ms Pillow, ~8-12 ms libvips).
- No sidecar complexity.
- Read path: static bytes from MinIO. Zero CPU at read time.

**When to revisit C:** if product starts needing multiple breakpoints (retina, mobile-small, AVIF fallback), or if frontend team wants automated format negotiation. At that point the "2× storage" pain is worth the flexibility.

**Avoid A** unless the frontend is willing to enforce aggressive lazy-loading + pagination of 10-20 items (not 500), AND the product accepts that each visible card downloads a full 180 KB image. This contradicts the stated "lists of 50-500 items" requirement.

---

## Sources

- [libvips Speed and Memory Use wiki](https://github.com/libvips/libvips/wiki/Speed-and-memory-use)
- [Pillow Performance benchmarks](https://python-pillow.github.io/pillow-perf/)
- [imgproxy Image Processing Servers Benchmark](https://imgproxy.net/blog/image-processing-servers-benchmark/)
- [Uploadcare: The Fastest Production-Ready Image Resize](https://uploadcare.com/blog/the-fastest-image-resize/)
- [imgproxy FAQ (memory & sizing guidance)](https://imgproxy.net/faq/)
- [imgproxy Memory Usage Tweaks](https://docs.imgproxy.net/memory_usage_tweaks)
- [Evil Martians: A broader picture — a guide on imgproxy](https://evilmartians.com/chronicles/a-broader-picture-a-guide-on-imgproxy-for-businesses)
- [compress-or-die: WebP compression](https://compress-or-die.com/webp)
