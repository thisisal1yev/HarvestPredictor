# Phase 1 Research: S3/MinIO Image Storage Patterns

**Task:** #1 — Research S3/MinIO image storage patterns at scale
**Owner:** storage-patterns
**Date:** 2026-04-08
**Context:** HarvestPredictor needs to store disease-detection snapshots (CV service output) in MinIO. Candidates: (A) single optimized image, (B) pre-generated thumbnail + full variants, (C) single original + on-the-fly resize via imgproxy/thumbor. Load: 100-1000 detections/day/user, list views of 50-500 items.

---

## 1. Industry patterns — what production systems actually do

### Facebook / Instagram (Haystack)
- For **every uploaded photo Facebook generates and stores 4 different resolutions** via an async job, specifically so users on slow connections don't download full-size originals ([Meta Engineering — Needle in a Haystack](https://engineering.fb.com/2009/04/30/core-infra/needle-in-a-haystack-efficient-storage-of-billions-of-photos/)).
- Haystack was built to eliminate metadata overhead of storing billions of small files on a POSIX filesystem — not directly relevant to MinIO (object store already solves that), but the **pre-generation strategy is the interesting bit**: they chose eager multi-size over on-the-fly.
- Rationale: reads massively outnumber writes (photos viewed many times), so paying CPU cost once at ingest is cheaper than on every view ([ByteByteGo — How Instagram Scaled](https://blog.bytebytego.com/p/how-instagram-scaled-its-infrastructure)).

### Shopify
- Shopify CDN hosts **~20B files across 5.3M stores, ~25M req/min**, backed by Cloudflare ([Shopify Performance Blog](https://performance.shopify.com/blogs/blog/using-shopify-cdn-for-better-performance)).
- Automatic format negotiation: serves WebP/AVIF based on `Accept` header, with fallback to JPEG.
- **Version-tagged URLs** for cache busting (e.g., `?v=12345`) — when an image is updated, the URL changes, so CDN cache invalidation is free.
- Strategy is effectively **on-the-fly with aggressive CDN caching** — Shopify merchants upload one "master" image and Shopify handles the rest.

### imgproxy in production (Shopware, Trendyol, etc.)
- Real production metric: one deployment with **~2 TB of source images delivers 1 PB/month of optimized output via CDN**. Of 5B HTTP requests/month, **only ~4M (<0.1%) reach the imgproxy origin** — the CDN absorbs the rest ([Evil Martians — imgproxy business guide](https://evilmartians.com/chronicles/a-broader-picture-a-guide-on-imgproxy-for-businesses)).
- **Critical insight:** imgproxy has NO internal cache. It is designed to run behind a CDN (Cloudflare, CloudFront, Fastly, nginx proxy_cache). Without a cache in front, you WILL melt the origin ([imgproxy docs](https://docs.imgproxy.net/)).
- Typical architecture: `Browser → CDN → imgproxy → S3/MinIO (origin)`.

### Trendyol (e-commerce, imgproxy case study)
- Implemented imgproxy as their image processing service and reported substantial disk savings vs pre-generation, plus format flexibility — they can add new size presets without re-processing the back catalog ([Trendyol Tech on Medium](https://medium.com/trendyol-tech/implementing-an-image-processing-service-using-imgproxy-e4755a47f3c5)).

### Summary of industry pattern
- **Hyperscale, read-dominant (FB, IG)**: pre-generate a fixed small set of sizes (3-4 variants) at ingest.
- **Mid-scale, flexible catalog (Shopify, Trendyol)**: on-the-fly via imgproxy/equivalent behind CDN.
- **Almost nobody ships raw originals to end users.** The question is only *when* the resize happens (ingest vs request).

---

## 2. Multi-size pre-generation vs on-the-fly — when to pick which

### Pre-generate at ingest (Option B)
**Pick when:**
- The set of sizes is **known and stable** (e.g., thumbnail 240px + full 1280px — done).
- Read-to-write ratio is high but **not extreme** (our case: 100-1000 writes/day, list views 50-500 items — maybe 10-100 reads per image lifetime).
- Team wants **predictable latency** on the first view (no cold-start resize).
- You don't want to operate a separate image-processing service.

**Trade-offs:**
- **Pro:** dead simple, zero moving parts, first request is fast, total CPU cost bounded.
- **Pro:** storage cost is predictable — N variants × avg size.
- **Con:** adding a new size later requires a backfill job over the whole bucket.
- **Con:** slightly more storage than on-the-fly (but with only 2 variants, it's negligible — ~10-15% overhead for a 240px thumb vs a 1280px master).

### On-the-fly via imgproxy (Option C)
**Pick when:**
- The set of sizes is **unknown, many, or evolving** (e.g., responsive `srcset` with 5-10 breakpoints, art direction, different device pixel ratios).
- You're OK **running an additional service** (imgproxy container, cache, monitoring).
- You have (or will have) a **CDN in front** — this is non-negotiable.
- Read patterns are very long-tail: most images viewed once, many never at all.

**Trade-offs:**
- **Pro:** storage is minimal — only originals live on disk.
- **Pro:** new sizes/formats are free — change a URL parameter, done.
- **Con:** first request is slow (50-300ms typical for 1280px JPEG on modest hardware; [imgproxy benchmark](https://imgproxy.net/blog/image-processing-servers-benchmark/)).
- **Con:** without a CDN, traffic spikes can **DDoS your own origin** ([Lincoln Loop — Trouble with Thumbnails](https://lincolnloop.com/blog/trouble-thumbnails-part-2/)).
- **Con:** operational complexity — another container, another failure mode, signed URLs to prevent abuse.

### Single optimized image (Option A)
**Pick when:**
- You only ever display images at **one size**.
- Bandwidth for mobile users is not a concern.

**Reality check for our case:** list view of 50-500 items will absolutely crush mobile users if each card loads a 1280px image. Option A is only viable if "optimized" really means "small" (~640px max), which then hurts the detail view. **Not recommended unless detail and list use identical dimensions.**

---

## 3. Image processing services in 2026

### imgproxy (recommended for on-the-fly)
- Written in Go, uses **libvips** under the hood. Fastest in 2026 benchmarks on both Intel Xeon and AWS Graviton3 ([imgproxy benchmark blog](https://imgproxy.net/blog/image-processing-servers-benchmark/)).
- **No internal cache — must run behind CDN or reverse-proxy cache.**
- Native S3 support via `IMGPROXY_USE_S3=true` — pulls originals directly from MinIO, skipping any backend roundtrip ([imgproxy S3 docs](https://docs.imgproxy.net/image_sources/amazon_s3)).
- Docker image is ~300x smaller than thumbor's.
- Signed URLs to prevent arbitrary-resize abuse.

### thumbor
- Python + Pillow. Slower than imgproxy in every 2026 benchmark. Strength: **smart crop** — face/feature detection for auto-cropping (probably irrelevant for disease snapshots, where the bounding box is the center of interest).
- More flexible plugin ecosystem, but larger attack surface and harder to secure.

### libvips (direct)
- The library imgproxy wraps. You *could* use it directly from Python (via `pyvips`) inside the existing FastAPI CV service — no extra container.
- **Pro:** one fewer service, resize happens in the same process that just detected the disease.
- **Con:** you lose imgproxy's URL-signing, format negotiation, and CDN-friendly URLs. You're building a mini imgproxy.

### AWS Lambda@Edge / serverless resize
- Not relevant: you're on-prem with MinIO, not AWS.

---

## 4. Object key naming conventions

### S3 performance at scale
- S3 (and MinIO) partition performance **per prefix**: 3,500 PUT / 5,500 GET per second per prefix ([AWS S3 key naming guide](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-keys.html)).
- For HarvestPredictor load (100-1000 writes/day = <0.02 writes/sec), **prefix partitioning is not a bottleneck**. Optimize for **human-readability and ops** instead.
- Note: since ~2018 S3 auto-manages prefix performance, so the old "hash prefix to randomize" advice is largely obsolete for small-to-medium scale.

### Recommended key structure for detection snapshots
MinIO's own docs show a time-bucketed pattern for camera snapshots ([MinIO camera snapshot integration](https://blog.min.io/)):
```
detections/{YYYY}/{MM}/{DD}/{detection_id}/{variant}.{ext}
```

Concrete example for HarvestPredictor:
```
detections/2026/04/08/det_01HW3X.../full.webp
detections/2026/04/08/det_01HW3X.../thumb.webp
```

**Why this layout:**
- **Date prefix first** — makes lifecycle rules trivial (e.g., "move detections >1 year old to cold storage", "delete after 3 years for free tier").
- **Detection ID as a folder** — groups all variants of one detection together. Listing by `det_01HW3X.../` gives you everything about that one frame. Makes per-detection delete atomic-ish (delete-by-prefix).
- **Variant as filename** — no query strings, CDN-friendly. Adding a new variant later is just a new filename under the same folder.
- **ULID or similar time-sortable ID** for `detection_id` — preserves creation order and is URL-safe.
- **No user_id in the path** — tie access control to DB ownership, not object keys. Lets us reassign/share detections without moving objects.

### Alternative: user-scoped layout
```
users/{user_id}/detections/{YYYY}/{MM}/{DD}/{detection_id}/{variant}.{ext}
```
- **Pro:** per-user bucket policies possible; easier "export all my data" / GDPR delete.
- **Con:** hot-spotting if one user drives most of traffic (unlikely at our scale).
- **Verdict:** acceptable, slight preference for the flat layout since ownership lives in the DB.

### Things to avoid
- Sequential integer IDs at the root (`1.jpg`, `2.jpg`) — breaks prefix partitioning at high scale.
- Spaces, unicode, or special chars — forces URL encoding everywhere ([AWS object keys](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-keys.html)).
- Putting the file extension *before* the variant (`det_X.jpg/thumb`) — breaks CDN content-type sniffing.
- Storing the image inside a DB BLOB column — common mistake, kills DB perf and backups.

---

## 5. Trade-offs observed in post-mortems and engineering blogs

### From Lincoln Loop ("Trouble with Thumbnails")
- **First request is always slow** for on-the-fly. A page with 30+ uncached images can stall several seconds on cold cache.
- **Cache stampede** is a real outage mode — an expired thumbnail + traffic spike = origin melts. Solutions: request coalescing, stale-while-revalidate, pre-warming.
- **DDoS via resize parameters** — if URLs aren't signed, an attacker can hit `/image/w=1,h=1` through `/image/w=9999,h=9999` and burn all your CPU. imgproxy signed URLs fix this.

### From Evil Martians (imgproxy guide)
- CDN hit rate above 99% is achievable and necessary for on-the-fly to be economical.
- Don't forget **Vary: Accept** header when serving WebP/AVIF conditionally, or CDN will cache the wrong format for the wrong browser.

### From the Laracasts discussion
- Hybrid (pre-generate the hot sizes, on-the-fly for the rare ones) is **the most common real-world answer** — Shopify, Cloudinary, and imgix all effectively do this internally.

### From Concrete CMS thumbnail docs
- Pre-generating many sizes bloats disk and complicates "size set changed" migrations. Every time you add a breakpoint, you rebuild the world.
- Pre-generating *few* sizes (2-3) avoids this pain without real disk cost.

---

## 6. Assessment for HarvestPredictor specifically

### Our actual constraints
- On-prem MinIO (no AWS CDN, no CloudFront — would need nginx/Varnish or Cloudflare if we go on-the-fly).
- 100-1000 detections/day/user: write volume is **tiny**.
- List views of 50-500 items: this **is** the read hot path.
- Only **two** display contexts currently: list (thumbnail) and detail (full). No complex responsive breakpoints.
- Team is small; ops overhead matters. Every new service is a new on-call item.
- No CDN currently deployed.

### Objective comparison

| Criterion | A: single image | B: pre-gen thumb+full | C: imgproxy on-the-fly |
|---|---|---|---|
| Mobile list perf | Bad (or detail bad) | Good | Good (after warm) |
| First-view latency | Instant | Instant | 50-300ms cold |
| Storage overhead | 1x | ~1.1-1.15x | 1x |
| CPU at ingest | Low | Medium (one extra resize) | Low |
| CPU at request | None | None | Medium (cached after) |
| New size later | Rebuild all | Backfill job | Free |
| Ops complexity | Minimal | Minimal | +1 service, +CDN required |
| DDoS risk | None | None | Real without signed URLs |
| Fits current display needs | Poor | Perfect | Overkill |

### Honest recommendation
**Option B (pre-generate thumbnail + full) is the right fit for HarvestPredictor's current stage.** Reasons:
1. We only have two display sizes. The flexibility of on-the-fly is value we won't use.
2. No CDN deployed. Option C without a CDN is an operational foot-gun.
3. Ingest volume is trivial — paying the resize cost once on upload is cheap.
4. First-view latency matters in a list of 500 items. Pre-generated is always instant.
5. Migration path is clean: **if we ever add responsive `srcset` or many breakpoints, drop imgproxy in front of the `full` variant.** Option B does not paint us into a corner — it is a subset of Option C.

**Would revisit and switch to C if:**
- We add 4+ display sizes (responsive design, DPR variants, social share cards).
- We deploy a CDN anyway for other reasons.
- Storage cost of originals becomes painful (unlikely — disease snapshots are ~200-500KB each).

Option A is rejected: it cannot satisfy both list and detail views with one size without compromising one of them.

---

## Sources

- [Meta Engineering — Needle in a Haystack: efficient storage of billions of photos](https://engineering.fb.com/2009/04/30/core-infra/needle-in-a-haystack-efficient-storage-of-billions-of-photos/)
- [ByteByteGo — How Instagram Scaled Its Infrastructure](https://blog.bytebytego.com/p/how-instagram-scaled-its-infrastructure)
- [Shopify Performance Blog — Using Shopify CDN for better performance](https://performance.shopify.com/blogs/blog/using-shopify-cdn-for-better-performance)
- [imgproxy — Image processing servers benchmark](https://imgproxy.net/blog/image-processing-servers-benchmark/)
- [imgproxy documentation](https://docs.imgproxy.net/)
- [imgproxy — Serving files from Amazon S3](https://docs.imgproxy.net/image_sources/amazon_s3)
- [Evil Martians — A broader picture: a guide on imgproxy for businesses](https://evilmartians.com/chronicles/a-broader-picture-a-guide-on-imgproxy-for-businesses)
- [Evil Martians — imgproxy: resize your images instantly and securely](https://evilmartians.com/chronicles/introducing-imgproxy)
- [Trendyol Tech — Implementing an image processing service using imgproxy](https://medium.com/trendyol-tech/implementing-an-image-processing-service-using-imgproxy-e4755a47f3c5)
- [Lincoln Loop — The Trouble with Thumbnails, Part 2](https://lincolnloop.com/blog/trouble-thumbnails-part-2/)
- [AWS — Naming Amazon S3 objects](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-keys.html)
- [AWS — Organizing objects using prefixes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-prefixes.html)
- [AWS re:Post — S3 object key naming patterns](https://repost.aws/knowledge-center/s3-object-key-naming-pattern)
- [MinIO — Object and Bucket Versioning](https://min.io/product/object-versioning-bucket-versioning)
- [Habr (Ozon Tech) — Why and how to store objects, using MinIO](https://habr.com/ru/company/ozontech/blog/586024/)
- [Kamenov — Cloud-backed on-demand thumbnails](https://www.kamenov.biz/cloud-backed-on-demand-thumbnail-generation/)
- [web.dev — Browser-level image lazy loading](https://web.dev/articles/browser-level-image-lazy-loading)
