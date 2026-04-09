# Research Results — CV Snapshot Storage Strategy

Compiled summary from Phase 1. Full details in `phase1-*.md` files.

## Topic

How to optimally store crop disease detection snapshots in object storage for HarvestPredictor, given:
- Python CV service processes photo uploads AND live RTSP streams
- Scale: 100-1000 detections/day/user, lists of 50-500 items per view
- Users in Uzbekistan rural areas (slow mobile networks)
- Self-hosted, no CDN, no GPU, modest VPS
- No existing image infrastructure

## Three candidate approaches

- **A** — Single optimized image per detection (no thumbnail generation), rely on lazy loading + HTTP/2 + CSS resize
- **B** — Two variants per detection (thumbnail + full), pre-generated at write time
- **C** — One original + on-the-fly resize via imgproxy/thumbor sidecar (cached)

---

## Phase 1 findings by researcher

### 1. storage-patterns — `phase1-storage-patterns.md`

**Industry patterns:**
- Hyperscalers (FB/Instagram/Haystack) pre-generate ~4 fixed sizes at ingest. Reads >> writes, pay CPU once.
- Mid-scale (Shopify, Trendyol) use on-the-fly via imgproxy **behind a CDN** (CDN absorbs 99%+ of traffic)
- Almost nobody ships raw originals to end users

**Critical constraint:** imgproxy has NO internal cache — it's architected to live behind a CDN. Running without CDN = cache stampedes, DDoS via resize params. **HarvestPredictor has no CDN.**

**Verdict:** B is objectively the best fit right now. It's a strict subset of C — can migrate to C later by adding imgproxy in front of the `full` variant.

**Key recommendation:** Object key layout `detections/{YYYY}/{MM}/{DD}/{detection_id}/{variant}.{ext}` — date prefix enables lifecycle rules, detection_id folder groups variants, ACL via DB not path.

### 2. image-formats — `phase1-image-formats.md`

**Recommendation:** JPEG via `cv2.imwrite`, quality 82, OPTIMIZE=1, PROGRESSIVE=1. ~45-70 KB per 640x640 plant snapshot, ~3-6 ms encode.

**Why not WebP/AVIF:**
- cv2 JPEG encode: 2-5 ms
- Pillow JPEG: 5-15 ms
- WebP: 80-170 ms
- **AVIF libaom default: 1000-2000 ms** — would starve live stream worker
- AVIF speed 8: still 150-400 ms, 50x slower than JPEG

**Format support (April 2026):** JPEG 100%, WebP ~97%, AVIF ~93-95% (safe), JPEG XL ~12% (not ready).

**Progressive JPEG:** 1-4% smaller, large perceived-load win on slow mobile — free via `IMWRITE_JPEG_PROGRESSIVE`.

**Future option:** JPEG canonical, AVIF derivative async via worker queue, serve via `<picture>` with JPEG fallback.

### 3. frontend-perf — `phase1-frontend-perf.md`

**Bottom line:** Server-side thumbnails are REQUIRED. "Lazy load + HTTP/2" is NOT enough at 50-1000 scale.

**Why browser-only loses:**
- Lazy load + HTTP/2 only fix NETWORK costs, not DECODE CPU or decoded bitmap MEMORY
- 1280x1280 decoded = **6.55 MB RAM per image**. 500 images = **3.28 GB decoded** (mobile OOM)
- 320x320 thumb = 0.41 MB. 500 = 205 MB (survivable)
- CSS-resizing a 1280 px image to a 320 px cell pays FULL decode cost for pixels thrown away
- Twitter mobile team: 400 ms → 19 ms per image (21x) purely by serving correct sizes

**Techniques to use together WITH thumbnails:**
1. Native `loading="lazy"` (~96% support, free)
2. `decoding="async"` (off main thread)
3. `srcset` + `sizes` (highest leverage — needs thumbnails)
4. **Virtual scrolling for 200+ items** — recommend `@tanstack/vue-virtual` (actively maintained, clean Nuxt 4 story). Avoid vue-virtual-scroller (Nuxt SSR friction).
5. `content-visibility: auto` — Baseline Sep 2025, but can INCREASE scroll CPU on image-heavy lists — test first
6. HTTP/3 strictly better than HTTP/2 on mobile (no TCP head-of-line blocking)

**Required:** 2-3 thumbnail variants per snapshot (320w/640w/1280w) as distinct URLs.

### 4. minio-specific — `phase1-minio-specific.md`

**CRITICAL finding (non-obvious, reshapes decision):**

**MinIO OSS entered MAINTENANCE MODE in December 2025.** No new features, no PR reviews, only case-by-case security patches. Admin console GUI stripped from OSS in May-June 2025 (CLI/`mc` only). Development pivoted to commercial AIStor tiers.

**Feature status for our use case:**
1. **Lifecycle/auto-delete:** Supported. `mc ilm rule add --expire-days 90`. Scanner-driven (delayed under load). Keep independent DB audit record.
2. **Tiering:** Data-loss bug in OSS since RELEASE.2022-11-10+. AIStor only. Irrelevant at MVP scale.
3. **Presigned URLs:** Works, S3-standard, max TTL 7d. **Gotcha:** reverse-proxy host mismatches break signatures — must set `MINIO_SERVER_URL` explicitly.
4. **Webhooks on upload:** Supported (`notify_webhook`). Reliable only with `queue_dir` set for retry. **Loop hazard** if thumbnailer writes to same prefix it listens on.
5. **Image transforms:** **NOT on OSS.** Object Lambda is AIStor-only. Must use pre-gen (sharp/Pillow) or imgproxy sidecar.
6. **Small-object perf:** Good on NVMe. **HDD is no-go.** Watch inodes at millions of objects.
7. **Bucket layout:** 1 bucket + date-partitioned prefixes: `snapshots/{raw|thumbs}/{user}/{yyyy}/{mm}/{dd}/{uuid}`
8. **CORS: BROKEN on presigned URLs.** MinIO doesn't emit `Access-Control-Allow-Origin` reliably (issues #3985, #10002, #11111). **Mandatory workaround: nginx reverse proxy, same-origin serving.**

**Recommendation:** Pin MinIO OSS to latest pre-freeze release, behind nginx (TLS + CORS fix), with documented exit plan to SeaweedFS (Apache 2.0 drop-in) or Hetzner Object Storage (~€5/TB/mo managed). Skip AIStor for MVP.

### 5. cost-analysis — `phase1-cost-analysis.md`

**Write CPU per detection (Pillow / libvips):**
- A single 1280 WebP: 40-55 / 8-12 ms
- B thumb+full: 70-95 / 14-20 ms (worst — backpressure risk on live stream)
- C original only: 30-45 / 8-12 ms (best at write)

**Read CPU (500-item list):** A=B=0 (static). C=0 warm, but 6-22s single-core cold cache (thundering herd).

**Storage per 1000 detections:** A=180 MB, B=192 MB (+7%), **C=380 MB (~2x more)** — hurts on self-hosted VPS.

**Bandwidth for 500-item list on 2 Mbps rural LTE:**
- **A: 90 MB / ~6 min — DISQUALIFIED for Uzbekistan rural users**
- B: 6 MB / ~24 s — acceptable
- C: 6 MB / ~24 s — acceptable

**Memory:** A lightest. B brief 2x spike. **C adds ~512 MB isolated sidecar process — critically decouples image work from ONNX-bound Python service.**

**Key findings:**
1. A is not viable on bandwidth alone given rural-user constraint
2. B's main risk: adding ~30-40 ms Pillow CPU on live-stream inference path. **Mitigation: async background thumbnail encode, or pyvips**
3. C's killer win: isolation from ONNX. C's killer costs: 2x storage + cold-cache latency

**Recommendation:** "B-async" — generate both variants but offload thumbnail encode to background task so inference loop returns immediately. Captures B's wins without CPU backpressure risk.

---

## Emerging consensus (pre-debate)

**Approach A** appears disqualified:
- Bandwidth catastrophic on rural LTE (90 MB for 500-item list)
- Mobile browser OOM from 3.28 GB decoded bitmap
- Twitter case study: 21x decode CPU penalty from wrong sizes

**Approach C** has appeal but blocked:
- Requires CDN (HarvestPredictor has none)
- 2x storage cost on self-hosted VPS
- imgproxy has no internal cache = foot-gun without CDN
- Adds operational complexity (sidecar, cache tuning, signed URLs for imgproxy)
- **Win:** isolation from ONNX process + future flexibility

**Approach B** strongest for MVP:
- +7% storage overhead (negligible)
- 6 MB over wire for 500-item list (24s on 2 Mbps — acceptable)
- Zero read-time CPU
- Simple ops (no sidecar)
- **Risk:** 30-40 ms Pillow encode on live stream path → **mitigation: async encode**
- **Migration path open:** B is strict subset of C — can add imgproxy later

## Open questions for debate phase

1. **JPEG vs WebP for thumbnails** — image-formats says JPEG q82, but WebP ~25-34% smaller. Is WebP encode cost (80-170 ms) acceptable on an ASYNC worker?
2. **MinIO OSS freeze risk** — should MVP ship on MinIO knowing it's maintenance-only? Alternatives: SeaweedFS, Hetzner Object Storage.
3. **Number of variants** — frontend-perf wants 320w/640w/1280w (3 variants). cost-analysis assumed 2. What's the real requirement?
4. **pyvips vs Pillow** in Python CV service — pyvips is 5-10x faster. Is the install complexity worth it?
5. **CORS problem** — nginx reverse proxy is mandatory. Does this change our architecture (Nuxt proxy vs separate nginx)?
6. **Virtual scroll + lazy load** — are thumbnails really needed if we virtual scroll? Or is this belt-and-suspenders?
7. **Webhook-driven async thumbnails** — CV service writes full image → MinIO webhook triggers Python worker → generates thumb. Avoids blocking inference loop but adds eventual consistency.

## Files for debaters to read

- `/mnt/hdd/projects/ali/test-project/HarvestPredictor/docs/research/research-results.md` (this file)
- `/mnt/hdd/projects/ali/test-project/HarvestPredictor/docs/research/phase1-storage-patterns.md`
- `/mnt/hdd/projects/ali/test-project/HarvestPredictor/docs/research/phase1-image-formats.md`
- `/mnt/hdd/projects/ali/test-project/HarvestPredictor/docs/research/phase1-frontend-perf.md`
- `/mnt/hdd/projects/ali/test-project/HarvestPredictor/docs/research/phase1-minio-specific.md`
- `/mnt/hdd/projects/ali/test-project/HarvestPredictor/docs/research/phase1-cost-analysis.md`
