# Debate Results — CV Snapshot Storage Strategy

Compiled from Phase 2. Full position papers in `debate-*.md`.

## Final scorecard

**Winner: Approach B (two pre-generated variants) — ~70/30 over C, decisive knockout over A**

| Position | Debater | Outcome |
|---|---|---|
| A — Single optimized image | `debater-single` | **Conceded in Round 3.** Cannot survive q=82 diagnostic requirement + 1.9 Mbps scanning-speed UX bandwidth |
| B — Two pre-gen variants | `debater-two-variants` | **Won.** Both opponents acknowledged B as correct MVP answer |
| C — On-the-fly imgproxy | `debater-imgproxy` | **Conceded MVP premature.** Re-framed as correct UPGRADE target when specific triggers fire |

## Key exchanges and concessions

### A vs everyone — full knockout

**A's rescue attempt:** 720px q=75 progressive JPEG + virtual scroll + lazy load, getting bandwidth from 90 MB → 25 MB for 500-item list.

**Two attacks A could not answer:**
1. **Quality dodge** — q=75 is below diagnostic threshold per phase1-image-formats §7. Honest q=82 pushes file to ~90 KB, destroys rescue math.
2. **Scanning-speed UX** — Agronomists scan at 3-5 items/sec. At 80 KB/image requires ~2.5 Mbps sustained, **exceeds 2 Mbps rural LTE budget**. Two-variants thumbs at 15 KB give 4x headroom.

**A still wins narrowly for:** absolute-minimum-code MVP, deep-link non-list contexts, projects with non-critical diagnostic quality. **None describe HarvestPredictor.**

### B vs C — converged on "B now, C later"

**B landed:**
- Bandwidth and storage wins at MVP scale (6 MB list view, 192 MB/1000 detections)
- Zero operational complexity beyond existing Python CV service
- +1 ThreadPoolExecutor thread vs +1 imgproxy container is honest cost difference
- MinIO OSS freeze is neutral for B (still need nginx proxy for CORS regardless)

**C scored real hits:**
1. **Generation-loss** — B's "full.jpg" is already lossy (q=82), so "originals" claim was overstated. If evidentiary retention matters, need archive variant.
2. **Service count inflation** — B debater overcounted "4 services" penalty; honest is +1 thread pool.
3. **YAGNI contradiction** — projecting 5 years of storage cost vs calling C's flexibility YAGNI is inconsistent.

**B's debater conceded all three.**

**C's single winning argument:** ONNX process isolation. imgproxy sidecar decouples image work from ONNX-bound Python service. This is the ONE trigger that justifies migrating B → C.

## Final consensus recommendation

All three debaters converged on:

### Ship "B-lossy" for MVP

**Write path:**
- `full.jpg` — 1280px, JPEG q=82, progressive — synchronous via `cv2.imwrite` on hot path (3-6 ms)
- `thumb.jpg` — 320px, JPEG q=78, progressive — async via `concurrent.futures.ThreadPoolExecutor(max_workers=1)` + pyvips in same FastAPI process (5-10 ms off-path, GIL released around C extensions)

**Storage (MinIO):**
- Key layout: `detections/{YYYY}/{MM}/{DD}/{ulid}/{thumb,full}.jpg`
- Lifecycle rule: auto-delete after 90 days (configurable)
- Same-origin nginx reverse proxy (fixes MinIO CORS + TLS)

**Frontend:**
- Virtual scrolling with `@tanstack/vue-virtual` for lists >200 items
- `loading="lazy"` + `decoding="async"` on `<img>` tags
- Thumbnail URLs in list view, full URL in detail modal
- Presigned URL TTL = 1 hour, regenerated on page reload

### Migration triggers to C (document, don't build)

Upgrade B → C ONLY when ONE of these fires:
1. ONNX service CPU-bound and image encode starts causing inference backpressure (monitor via latency metrics)
2. Frontend needs 3+ breakpoint variants (retina, 4K, social share) — requires responsive images
3. CDN deployed for other reasons (e.g. serving static assets via Cloudflare)
4. Product requirement for AVIF format delivery (imgproxy handles format negotiation)

Until then, C is premature.

## Open product decisions flagged for synthesis

1. **Evidentiary retention** — Is 1280px q=82 JPEG "canonical enough", or do we need to retain originals for legal/audit? If yes → B-plus-archive (third async-written `original.jpg` at full sensor resolution).

2. **MinIO OSS freeze risk** — Community edition in maintenance mode since Dec 2025. Should we:
   - (a) Ship on MinIO OSS pinned version with documented exit plan to SeaweedFS/Hetzner Object Storage
   - (b) Skip MinIO entirely and start with SeaweedFS
   - (c) Use Hetzner Object Storage (~€5/TB/mo managed)

3. **Number of variants** — Debate settled on 2 (thumb 320px + full 1280px). Frontend-perf research suggested 3 (320w/640w/1280w) for responsive. Is the middle size needed for tablets? Decision: start with 2, add 640px if real user data shows need.

4. **Pillow vs pyvips** — Debaters recommended pyvips (5-10x faster, GIL release). Install complexity: pyvips requires libvips system library. Worth the extra Dockerfile line for 5x speedup.

## Key numbers verified across all research

| Metric | A (1280 strawman) | A (720 rescue) | B (thumb+full) | C (imgproxy) |
|---|---|---|---|---|
| Bandwidth (500-item list, 2 Mbps) | 90 MB / 6 min | 25 MB / 1.7 min | **6 MB / 24 s** | 6 MB / 24 s (warm) |
| Storage per 1000 detections | 180 MB | 90 MB | **192 MB** | 380 MB |
| Write CPU hot path | 3-6 ms | 3-6 ms | **3-6 ms** (full only, thumb async) | 3-6 ms |
| Decoded bitmap (mobile RAM) | 6.55 MB × 500 = 3.28 GB | 2 MB × 500 = 1 GB | **0.41 MB × 500 = 205 MB** | 0.41 MB × 500 = 205 MB |
| Operational complexity | 0 | 0 | +1 thread pool | +1 container + nginx cache config |
| MVP viable? | ❌ | ❌ scanning UX | ✅ | ⚠ premature |

## Files

- `/mnt/hdd/projects/ali/test-project/HarvestPredictor/docs/research/debate-single.md`
- `/mnt/hdd/projects/ali/test-project/HarvestPredictor/docs/research/debate-two-variants.md`
- `/mnt/hdd/projects/ali/test-project/HarvestPredictor/docs/research/debate-imgproxy.md`
