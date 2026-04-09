# Trade-off Matrix — CV Snapshot Storage Strategies

**Author:** tradeoff-analyst (task #9)
**Date:** 2026-04-08
**Scope:** Objective comparison of three storage approaches for HarvestPredictor crop-disease snapshots. **No recommendation** — that is task #10 (chief-synthesizer).
**Sources:** `research-results.md`, `debate-results.md`, `phase1-cost-analysis.md`, `phase1-frontend-perf.md`, `phase1-storage-patterns.md`, `phase1-minio-specific.md`, `debate-single.md`, `debate-two-variants.md`, `debate-imgproxy.md`.

## The three approaches

- **A — Single optimized image:** One JPEG per detection, no thumbnail generation. Frontend uses CSS resize + lazy load + virtual scroll. Two parameter regimes are tracked because the debate forced a "rescue" version into the conversation:
  - **A-1280** = strawman from phase 1 (1280px, q=82, ~180 KB)
  - **A-720** = `debater-single`'s rescue (720px, q=75, ~50 KB) — note: q=75 is below diagnostic threshold per phase1-image-formats §7
- **B — Two pre-generated variants:** `thumb.jpg` (320px q=78, ~15 KB, async via pyvips ThreadPoolExecutor) + `full.jpg` (1280px q=82, ~70 KB, sync via cv2.imwrite).
- **C — Original + imgproxy:** One ~1280-1920px original (~380 KB) per detection, imgproxy sidecar resizes on demand, nginx `proxy_cache` caches output, signed URLs prevent abuse.

All numbers below assume the MVP scenario: ~100 active users on a self-hosted Hetzner-class VPS (no GPU, no CDN, NVMe), Uzbekistan rural LTE (~2 Mbps realistic).

---

## Trade-off matrix

| # | Dimension | A — Single | B — Two variants | C — imgproxy |
|---|---|---|---|---|
| 1 | **Write CPU — hot path (ms/detection)** | 3-6 ms (cv2.imwrite JPEG q82) | **3-6 ms** (cv2.imwrite full only; thumb deferred) | 3-6 ms (cv2.imwrite original) |
| 2 | **Write CPU — background (ms/detection)** | 0 | 5-10 ms (pyvips thumbnail off-path, GIL released) | 0 at write; resize is deferred to read time |
| 3 | **Storage — MB per 1000 detections** | A-1280: ~180 MB · A-720: ~50 MB | **~192 MB** (180 full + 12 thumb, +7% vs A-1280) | **~380 MB** (~2.1× B; original at higher resolution) |
| 4 | **Bandwidth — MB for 500-item list view** | A-1280: 90 MB · A-720: 25 MB (q75) / 45 MB (q82 honest) | **~6 MB** (15 KB × 500 thumbs) | **~6 MB** warm cache (15 KB × 500 derived thumbs); ≈90+ MB on full cold miss if all-unique |
| 5 | **List view load — seconds @ 2 Mbps LTE** | A-1280: ~360 s (6 min) · A-720 q75: ~100 s · A-720 q82: ~180 s | **~24 s** (network only, zero CPU) | **~24 s warm** · **35-45 s cold** on realistic Hetzner CPX21 (CPU-bound, 30 concurrent items, per debate-imgproxy §3.4) |
| 6 | **Detail view load — seconds @ 2 Mbps LTE** | A-1280: ~0.7 s · A-720: ~0.3 s | ~0.3-0.4 s (full.jpg ~70 KB) | ~0.3-0.4 s warm · ~1.5 s cold (single imgproxy resize) |
| 7 | **Mobile memory — MB decoded bitmap, 500 items worst case** | A-1280: **3,280 MB** (3.28 GB → mobile OOM) · A-720: **1,030 MB** (risky on 2 GB Android) | **~205 MB** (0.41 MB × 500, survivable on 4 GB Android) | **~205 MB** (same; serves 320px thumbs) |
| 8 | **Implementation complexity — LoC / new code** | ~10 LoC (single `cv2.imwrite` call) | ~40 LoC Python: `ThreadPoolExecutor(max_workers=1)` + bounded `queue.Queue(maxsize=200)` + pyvips thumbnail call. Adds `libvips-dev` build dep | ~4 LoC URL signing helper (Nuxt server route, HMAC-SHA256) + ~20 lines nginx `proxy_cache` config + DDoS caps + key rotation procedure |
| 9 | **Operational complexity — new containers / configs** | 0 new containers, 0 new configs (assumes nginx already needed for TLS+CORS) | 0 new containers, 0 new services to monitor; +1 ThreadPoolExecutor inside existing FastAPI process | **+1 container (imgproxy)**; nginx `proxy_cache_path` + `proxy_cache_lock` + `use_stale` + `background_update` tuning; cache disk sizing (`max_size`, `inactive`); `IMGPROXY_KEY`/`IMGPROXY_SALT` secrets to rotate; `X-Cache-Status` monitoring; runbooks for "imgproxy crashes / cache disk fills / signing key leaks". Per debate-imgproxy §3.5: "subsystem, not an increment" |
| 10 | **Failure modes — what breaks when X fails?** | Single point of failure: image too large → bandwidth fails or quality dodge. No fallback variant. Missing object = list cell broken | (a) pyvips crash on pathological frame wedges thread pool — shared failure domain with ONNX inference (mitigated by `restart: unless-stopped`); (b) thumb queue backpressure (200-slot bound); (c) `thumb.jpg` missing → `<img onerror>` falls back to `full.jpg`; (d) variant drift if delete is non-atomic (mitigated by prefix-delete) | (a) imgproxy OOM/crash (isolated from ONNX, restart contained); (b) nginx cache disk fills → eviction storm; (c) **cache stampede** on cold list of 500 unique items (`proxy_cache_lock` mitigates but adds latency); (d) signed-URL key leak → all outstanding URLs need rotation; (e) DDoS via resize params if signing breaks; (f) MinIO origin melt without `IMGPROXY_MAX_SRC_RESOLUTION` cap |
| 11 | **Migration flexibility — can we change strategy later?** | Poor. 720px originals are too small to derive larger variants. Upgrading to B or C requires re-shooting source data or accepting permanent ceiling. A→B/C is **not** a clean upgrade path | Medium. B is a strict subset of C **on the write path** — adding imgproxy in front of `full.jpg` later requires no data migration. **But** `full.jpg` is already 1280px q82 lossy; derived variants from B→C are 3rd-generation artifacts. If pristine originals matter (evidentiary, ML retraining), B→C requires `B-plus-archive` (third async-written `original.jpg`, ~2.2× storage) | Best on the surface — new sizes/formats are URL parameter changes, no backfill. **But** highest migration cost off MinIO: N originals at ~380 KB vs B's N×192 KB (smaller per-object footprint to copy). Trigger conditions in debate-imgproxy §4 list six events that flip C to "right answer" |
| 12 | **Cost — VPS $/mo for 100 active users (90-day retention)** | A-1280: ~9 GB extra storage (negligible, ~€0.05/mo Hetzner block) · A-720: smallest footprint baseline | **~9.6 GB / 90d** at 100 users × 100 detections/day × 192 KB. **~€0.50/mo** Hetzner block storage. VPS itself unchanged (no extra container) | **~19 GB / 90d** at 100 users × 100 detections/day × 380 KB. **~€1/mo** storage. **Plus** ~€5-10/mo for the imgproxy container's CPU/RAM share if VPS needs to be sized larger (depends on baseline VPS — unknown). Net delta vs B: **~€1-10/mo** at 100 users |

Notes on the cost row:
- Numbers from debater-single concession 7: at 50 users × 100/day × 90d, C-vs-A storage delta = 90 GB = ~€0.44/mo Hetzner. Linearly extrapolated to 100 users: ~€0.88/mo delta.
- VPS base cost (CPX21 ~€8/mo) is not changed by A or B. C may push the VPS one tier up if imgproxy + nginx cache RAM/disk usage tips the budget; this is **scenario-dependent** and not pinned in the research.
- All three are well within the "grants not VC" budget at MVP scale. Storage cost is **not the deciding axis**.

---

## Narrative interpretation

**Bandwidth and decoded memory are the load-bearing dimensions.** Rows 4, 5, and 7 are where the three approaches diverge most dramatically. A-1280 fails both on rural LTE (90 MB list view, ~6 minute load) and on mobile RAM (3.28 GB decoded bitmap). The A-720 rescue improves bandwidth to ~25 MB but only at q=75, which sits below the diagnostic-quality threshold for plant disease photography (phase1-image-formats §7) — so the rescue depends on a quality choice the product cannot ship. At honest q=82, A-720's file size jumps to ~90 KB and the rescue math collapses. B and C are functionally identical on the wire (both deliver 15 KB thumbs), and both keep mobile memory at ~205 MB worst case.

**Write-path CPU is no longer a differentiator.** Row 1 collapses all three into 3-6 ms once `cv2.imwrite` is used for the synchronous step and pyvips runs the thumbnail off-path on a `ThreadPoolExecutor`. The original phase 1 number (B = 70-95 ms with vanilla Pillow) was the worst case and was retracted in the debate. The remaining asymmetry is row 2: B does 5-10 ms of background CPU per detection that A and C do not — at 100-1000 detections/day this is 0.5-10 seconds of cumulative CPU per day, trivial.

**Read-path latency is where C carries hidden risk.** Row 5 shows B's deterministic ~24 s vs C's bimodal warm/cold split. On a Hetzner CPX21 (no AVX-512, no NVMe scratch), debater-imgproxy recomputed the cold-cache wall-clock as 35-45 s for 30 concurrently-rendering items — worse than the phase 1 happy-path number. The dominant HarvestPredictor workflow (agronomist scrolling through historical detections) is exactly the scan pattern that hits the cache eviction tail. Mitigations exist (`proxy_cache_lock`, 90-day inactive window, larger `max_size`), but at that point C's cache becomes a de-facto pre-generation store — i.e. C tuned to behave like B.

**Operational and failure-mode surface is C's biggest single cost.** Rows 9 and 10 are where the count diverges sharply: B adds zero containers and zero new services to monitor; C adds an imgproxy container, an nginx cache subsystem, signed-URL key management, DDoS caps, and runbooks for at least three new failure modes. Debater-imgproxy described this honestly as "a subsystem, not an increment." At the same time, C's row 11 advantage (URL-param flexibility for new sizes/formats) is real — but unused unless the product commits to 3+ display contexts, format negotiation, or a CDN.

**Migration flexibility cuts in both directions and depends on the evidentiary question.** Row 11 shows B is a strict subset of C on the write path — adding imgproxy later requires no data migration. The footnote is that B's `full.jpg` is already a lossy 1280px q82 artifact, so any derived variant from a future B→C transition is third-generation. If product flags evidentiary retention or ML retraining as a real constraint, B must become `B-plus-archive` (third async-written `original.jpg`), which closes B's storage advantage over C. This is flagged as a product decision in debate-results §"Open product decisions."

**Cost in dollars is not material at MVP scale.** Row 12 shows all three within ~€1-10/mo of each other on a 100-user scenario. Storage of crop snapshots is small enough that the financial difference between approaches is dwarfed by the base VPS cost. The decision should be made on rows 1-11, not row 12.

---

## Cells flagged "depends" or "unknown"

- **Row 12 VPS sizing for C:** The €5-10/mo upper bound assumes imgproxy + cache disk pushes the VPS a tier higher. Whether this actually happens depends on the headroom of the chosen base VPS — not pinned in any research file.
- **Row 4 cold-cache bandwidth for C:** The "≈90+ MB on full cold miss" number is back-of-envelope. If imgproxy serves the resized 320px output (15 KB), cold and warm bandwidth are equal — the cold cost is **CPU latency (row 5)**, not bandwidth. I split it because the wall-clock pattern differs from B's.
- **Row 6 detail view load times:** Real-world numbers depend on TLS handshake, Nuxt SSR, MinIO presign latency — not isolated in any phase 1 benchmark. The 0.3-0.7 s figures are file-size / link-speed only.
- **A's failure-mode list (row 10):** Not exhaustively explored in any research file because A was disqualified early in the debate. Treated here as "single point of failure with no variant fallback."
