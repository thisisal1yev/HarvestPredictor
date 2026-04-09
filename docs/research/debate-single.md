# Debate Position Paper — Single Optimized Image (Approach A)

**Debater:** debater-single
**Position defended:** Store ONE optimized image per detection. Aggressive JPEG compression (cv2 q=75, progressive, 720px max), plus lazy loading, HTTP/2, virtual scroll. NO thumbnail generation. Simplest possible architecture.
**Verdict after 3 rounds:** **Position fails for HarvestPredictor.** Survives partial rescue from Phase 1's "disqualified" verdict but does not survive honest analysis of the diagnostic-quality requirement and the scanning-speed UX workflow.

---

## Executive summary

The Phase 1 research summary marked Approach A "disqualified" using **1280px / 180 KB** numbers — a strawman of the strongest version. With aggressive parameters (720px longest side, q=75 progressive JPEG, virtual scroll, lazy load) the bandwidth math improves dramatically (90 MB → ~25 MB worst case for 500-item list, ~1.5 MB for initial paint). The decoded-bitmap memory math also improves (3.28 GB → ~41 MB peak).

These rescues are **real** but **insufficient** for HarvestPredictor's actual use case. After two opponent rounds, the position falls to two arguments I could not answer:

1. **The q=75 quality dodge.** Aggressive compression is required to make the bandwidth math work, but q=75 is below the "no visible artifacts" threshold for diagnostic plant photography (phase1-image-formats §7). For an evidence/diagnostic image where leaf texture IS the disease signal, this is the worst place to economize. Honest q=82 numbers push file size to ~90 KB, which destroys the rescue.

2. **The scanning-speed UX failure.** Agronomists scrolling history at 3-5 items/sec require ~2.2-2.9 Mbps sustained throughput on the wire — exceeds the 2 Mbps rural LTE budget. Lazy-load rootMargin cannot prefetch fast enough; the user sees grey placeholder squares during the dominant workflow ("scan back through yesterday's detections").

---

## The strongest version of single-image (the rescue attempt)

### Configuration

```python
cv2.imwrite(
    path,
    frame,
    [
        cv2.IMWRITE_JPEG_QUALITY, 75,
        cv2.IMWRITE_JPEG_OPTIMIZE, 1,
        cv2.IMWRITE_JPEG_PROGRESSIVE, 1,
    ],
)
```

Constraints:
- Longest side: 720 px (downscale before encode)
- Format: progressive JPEG (1-4% smaller than baseline; large perceived-load win on slow mobile per phase1-image-formats §5)
- Frontend: TanStack Virtual (`@tanstack/vue-virtual`) for ~20-30 items mounted at a time
- `loading="lazy"`, `decoding="async"`, explicit `width`/`height` to prevent CLS
- Single URL per detection: `detections/{YYYY}/{MM}/{DD}/{detection_id}/snapshot.jpg`

### Rescue math

| Metric | Strawman A (1280px/180 KB) | Rescued A (720px/50 KB q=75) | Honest A (720px/90 KB q=82) |
|---|---|---|---|
| File size | ~180 KB | ~50 KB | ~90 KB |
| 500-item full list bandwidth | 90 MB / 6 min | 25 MB / 100 s | 45 MB / 180 s |
| Initial paint (30 items) bandwidth | 5.4 MB / 22 s | **1.5 MB / 6 s** | 2.7 MB / 11 s |
| Decoded bitmap per image | 6.55 MB | 2.07 MB | 2.07 MB |
| Peak decoded RAM (virtual scroll, 20 mounted) | 131 MB | **41 MB** | 41 MB |

The rescue ONLY works at q=75. At diagnostic-grade q=82, the rescue collapses.

---

## Where single-image genuinely wins (positions still defended)

These are real wins that survive Round 3:

### 1. Cheapest write CPU on the live RTSP stream

phase1-cost-analysis §1: A is tied for cheapest write-time CPU (40-55 ms Pillow, 8-12 ms libvips). Two-variants is 1.7x more expensive on Pillow (70-95 ms). For live stream inference, the encode cost blocks frames.

**Caveat:** two-variants's `asyncio.create_task` mitigation neutralizes this if pyvips is used. With Pillow, single-image still wins on encode CPU.

### 2. Zero MinIO CORS fan-out

phase1-minio-specific §8: MinIO presigned URL CORS is broken; nginx reverse proxy is mandatory. Single image = one URL per detection to authenticate and proxy. Two variants = two URLs.

### 3. Zero variant drift / ghost references

Single object per detection = atomic delete via `mc rm`, single lifecycle rule, single auditing path. No risk of orphaned thumbs pointing at deleted fulls.

**Caveat:** opponent demonstrated this is mitigated for two-variants via DB-as-source-of-truth + prefix-delete + 30-day lifecycle on the whole `{detection_id}/` folder. Drift risk is real but manageable.

### 4. Migration optionality

phase1-minio-specific §9-10: MinIO OSS entered maintenance mode Dec 2025. Migration to SeaweedFS or Hetzner Object Storage is the documented exit plan. Migrating N single objects is strictly easier than migrating N + thumbs.

**Caveat:** imgproxy (Approach C) shares this win — single object per detection.

### 5. Detail-view non-list contexts

If user opens a detection via deep link (push notification, "view this detection" link), there's no list scroll happening. Single-image and two-variants are equivalent in this case; single-image has one fewer URL to manage.

### 6. Operational simplicity at the absolute MVP

`cv2.imwrite` is the entire image-handling code path. No async queue, no Celery, no Redis, no imgproxy sidecar, no signed URL plumbing, no nginx proxy_cache tuning, no IMGPROXY_KEY rotation. For a v0 prototype that will be rewritten, this matters.

---

## Where single-image fails (honest concessions)

### Concession 1: The q=75 quality dodge does not survive

phase1-image-formats §7 is explicit: q=80-82 is "conservative default" for diagnostic photography; below q=70 artifacts begin to appear. q=75 is in the no-man's-land where leaf texture (which is exactly where disease symptoms live) starts to lose fidelity.

Single-image's bandwidth rescue requires q=75. Diagnostic quality requires q=82. **You cannot have both.** The position is held together by a quality choice the product cannot afford to ship.

One agronomist complaint ("I can't tell if that's rust or just JPEG noise") forces a bump to q=82, which pushes file size to ~90 KB and destroys the rescue math.

### Concession 2: The scanning-speed UX failure (the killer)

debater-two-variants's strongest critique:

> "Scanning means fast scrolling — 3-5 items per second... lazy-load rootMargin can't keep up with prefetch... user sees placeholder grey squares while they scroll."

Math at honest 70-90 KB per image:
- 4 items/sec × 80 KB = 320 KB/s = **2.56 Mbps required sustained**
- 2 Mbps rural LTE budget = **chronic buffering**
- Two-variants thumb at 15 KB: 4 items/sec × 15 KB = 60 KB/s = **0.48 Mbps**, 4x headroom

The dominant workflow for HarvestPredictor agronomists is "scan back through yesterday's detections to find the one I need." Single-image fails this exact workflow on the exact network the users actually have.

### Concession 3: Decode CPU tax compounds the problem

Twitter mobile case study (phase1-frontend-perf §6): 21x decode-time improvement purely from serving correctly-sized images. At 720→320 grid cell, single-image pays ~5-7x decode CPU vs a proper 320px thumb. On low-end Android (Snapdragon 4xx class), that's 30-50 ms per image vs 8-12 ms.

`decoding="async"` mitigates main-thread jank but does NOT reduce total CPU consumed. On a CPU-pressured device during fast scroll, this contributes to the same buffering experience.

### Concession 4: "Server-side work runs once vs frontend runs N times per device"

debater-two-variants's framing of the cost-distribution argument:
- A 10 ms server-side encode at write time runs ONCE per image
- A 30-50 ms client-side decode runs ONCE PER VIEW PER USER PER DEVICE
- Read:write ratio at HarvestPredictor's scale is 5:1 to 10:1 on average, much higher for popular detections
- Multiplied by every device class, every browser, every OS version the field team uses, the math is overwhelming in favor of pre-gen

This is the same logic Meta/Instagram/Haystack used at hyperscale (phase1-storage-patterns §1) and it applies — proportionally — at our scale too.

### Concession 5: Lock-in unwinding cost is not free

debater-imgproxy's reframe:

> "Pick the thing whose lock-in is cheapest to unwind."

Single-image stores at 720px. If we later want to derive thumbnails via imgproxy, the originals are too small for many derived sizes. The "ship A now, upgrade to C later" path requires storing originals at higher resolution from day one — which destroys A's "cheapest write CPU + smallest storage" wins.

A's upgrade path is NOT free.

### Concession 6: Cold-cache is not the killer I claimed for imgproxy

I overstated the cold-cache thundering herd in Round 1. `proxy_cache_lock` + stale-while-revalidate + JPEG output (3.6x faster than WebP) makes the realistic cold-cache cost on a 4-worker imgproxy ~1.5 seconds wall-clock for 500 unique items. After day 1, repeat reads are HIT. **Imgproxy's cold-cache pain is a first-visit cost, not a steady-state problem.** Withdrawn from my list of attacks.

### Concession 7: 2x storage is not material at MVP scale

debater-imgproxy ran the actual numbers: at 50 users × 100 detections/day × 90-day retention = 90 GB delta vs A, which is €0.44/mo on Hetzner block storage. At year-1 scale (500 users): 900 GB delta = €4.40/mo. Not material. **Withdrawn.**

---

## Where single-image still wins (held positions after Round 3)

After all concessions, single-image holds these narrower wins:

1. **For deep-link / non-list detail contexts:** zero disadvantage vs two-variants, one fewer URL to manage. Small win.
2. **For absolute-minimum-code MVP:** if the goal is "ship a working detection list TODAY with the fewest moving parts," single-image is unambiguously the answer. The cost is the q=75 quality compromise and the scanning-speed UX failure.
3. **For projects HarvestPredictor isn't:** small typical lists (<100 items), filter-heavy workflows where scanning is rare, ops budgets that cannot tolerate even 40 lines of asyncio code. Side projects, internal admin tools, v0 prototypes that will be rewritten.

**For HarvestPredictor specifically (rural mobile 2 Mbps, agronomist diagnostic workflow, 50-500 item detection lists, scanning-as-dominant-action), single-image is the wrong choice.**

---

## Final ranking (after honest analysis of all three positions)

1. **Two-variants (B) with pyvips + asyncio.create_task** — wins for HarvestPredictor's actual MVP. Solves bandwidth, solves decode CPU, solves diagnostic quality, costs ~40 lines of Python on the server side. The async-encode mitigation is a real-but-small operational delta.
2. **Imgproxy (C)** — better at scale and on lock-in unwinding, but adds sidecar + signed URLs + cache tuning + runbook surface area that B does not. Wins if the ONNX-isolation argument is judged critical TODAY.
3. **Single-image (A)** — wrong choice for HarvestPredictor. Right choice for a different product.

**My honest synthesis recommendation (not load-bearing for this paper):** B with pyvips for MVP, key layout `detections/{YYYY}/{MM}/{DD}/{detection_id}/{full,thumb}.jpg` chosen so that imgproxy can later be added against `full.jpg` if a real product requirement appears (retina, AVIF negotiation, variable breakpoints).

---

## The narrow scenario where single-image is right

For completeness, the conditions under which Approach A would be the correct answer:

1. **Bandwidth is not a constraint** — wired connection, 4G+ minimum, or CDN-fronted. Removes the rescue dependency on aggressive compression.
2. **List density is small** — typical view <100 items, scanning is rare (filter/search dominates). Removes the scanning-speed UX failure.
3. **Diagnostic quality is not critical** — display-only context, no fine-detail inspection, no "is that rust or noise" risk. Removes the q=75 quality dodge.
4. **Single-process Python is the entire backend** — no orchestrator, no message queue infra exists, the team budget genuinely cannot absorb 40 lines of async worker code. Maximizes the operational simplicity win.
5. **The detail view will never need pinch-zoom on leaf texture** — 720px is a hard ceiling forever. Removes the "what about the detail view" attack.

None of these describe HarvestPredictor.

---

## Sources used

**Phase 1 research (primary):**
- `phase1-cost-analysis.md` — write CPU, storage, bandwidth, memory trade-offs
- `phase1-frontend-perf.md` — decode CPU, decoded-bitmap memory, virtual scroll, lazy loading semantics
- `phase1-image-formats.md` — JPEG q=75 vs q=82 quality boundary, progressive JPEG, encode times
- `phase1-storage-patterns.md` — Meta/Instagram/Trendyol patterns, imgproxy CDN dependency claim
- `phase1-minio-specific.md` — CORS workaround, lifecycle rules, OSS maintenance mode

**External web evidence:**
- [Progressive JPEG perceived performance on slow networks (ImageKit, Uploadcare, ShortPixel)](https://imagekit.io/blog/progressive-jpeg/) — supported the progressive-as-free-win argument
- [Lazy loading + responsive srcset bandwidth comparison (web.dev, MDN)](https://web.dev/articles/browser-level-image-lazy-loading) — supported the network-vs-decode distinction
- Twitter mobile decode 21x case study (cited in phase1-frontend-perf §6)
- Google mobile UX 3-second abandonment threshold (cited by debater-two-variants Round 2)

**Project memory:**
- `project_current_state.md` — pre-AI MVP, no CV core yet, full CRUD UI exists
- `project_business_pivot.md` — Telegram bot focus, B2B clusters, grants not VC (informs "speculation budget")
- `project_cv_architecture.md` — Python FastAPI + YOLOv8 service for drone disease detection

---

## Closing

Position A survives the strawman attack from Phase 1 (1280px / 180 KB / 90 MB) and reaches a defensible rescue (720px / 50 KB / virtual scroll / lazy load). It does not survive the honest analysis of:

- The diagnostic-quality requirement that forces q=82 not q=75
- The scanning-speed UX workflow that exceeds 2 Mbps even at 70 KB/image
- The cost-distribution math (server runs once, frontend runs N times)
- The lock-in unwinding cost when an upgrade to imgproxy is later needed

For HarvestPredictor specifically: **wrong choice**. For a different product with different constraints: **viable**.

The synthesis researcher should treat this debate as evidence that **B (two-variants with pyvips + async encode) is the correct MVP answer**, with C (imgproxy) as the deliberate Phase 2 upgrade if and only if a concrete trigger condition fires (variable breakpoints, AVIF negotiation, retina, or measurable ONNX backpressure that pyvips alone cannot fix).

— debater-single
