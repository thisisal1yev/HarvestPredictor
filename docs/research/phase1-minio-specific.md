# Phase 1 Research: MinIO-Specific Features for Snapshot Storage

**Research date:** 2026-04-08
**Scope:** MinIO capabilities relevant to HarvestPredictor crop-disease snapshot storage
**Target scale:** ~100–1000 images/day/user, 90+ day retention, object size 5 KB – 500 KB

> **CRITICAL UPFRONT:** In December 2025, the MinIO open-source Community Edition (OSS) was placed into **maintenance mode** — no new features, no PR reviews, security patches only "case-by-case". Before that (May–June 2025) the admin console/UI was stripped from the OSS build. All management features and several capabilities below are now exclusive to the **AIStor** (commercial) product line. This must be factored into every deployment decision below. See [§9](#9-community-vs-commercial-and-maintenance-mode-critical) for full impact.

---

## 1. Lifecycle policies — auto-deletion after N days

**Supported in OSS (still works in maintenance mode).** The S3-compatible ILM (Information Lifecycle Management) API is implemented.

### Configuration options
- **CLI:** `mc ilm rule add --expire-days 90 myminio/snapshots --prefix "users/"`
- **JSON import:** `mc ilm import myminio/snapshots < lifecycle.json`
- **S3 API:** standard `PutBucketLifecycleConfiguration`

### Example rule (90-day expiration)
```json
{
  "Rules": [
    {
      "ID": "expire-snapshots-90d",
      "Status": "Enabled",
      "Filter": { "Prefix": "snapshots/" },
      "Expiration": { "Days": 90 }
    }
  ]
}
```

### Gotchas (important)
- **Scanner-driven, not real-time.** MinIO's background scanner walks objects and marks expired ones for deletion. Under high IO load or resource pressure, expiration can be delayed by hours or days. Do not rely on exact 90-day cutoff.
- **Versioning interaction:** Lifecycle rules **do not run** if versioning is in *suspended* state. Must be either enabled or never-enabled.
- **Replication:** objects deleted by lifecycle are **not replicated** to replica sites — consider this for DR.
- **Historic bugs:** Issues #10478 and #21257 document cases where lifecycle either silently failed or deleted objects without a configured policy. For 90-day retention of evidentiary data (disease diagnosis history), **monitor actual deletions** via audit logs.

### Recommendation for HarvestPredictor
- Use `Expiration.Days = 90` on a prefix like `snapshots/` for auto-cleanup.
- **Do not** rely on lifecycle alone for compliance/legal retention. If diagnosis history is evidence in disputes, keep a DB-level record independent of object storage.
- Enable versioning from day one — cheaper than enabling later and avoids the "suspended" gotcha.

Sources:
- [mc ilm rule add — MinIO OSS docs](https://min.io/docs/minio/linux/reference/minio-mc/mc-ilm-rule-add.html)
- [minio/docs/bucket/lifecycle/README.md](https://github.com/minio/minio/blob/master/docs/bucket/lifecycle/README.md)
- [Lifecycle does not delete as expected #11210](https://github.com/minio/minio/issues/11210)
- [Objects deleted after 30 days despite no policy #21257](https://github.com/minio/minio/issues/21257)

---

## 2. Tiering (hot/cold) — OSS vs Enterprise

**OSS community edition:** Tiering **was** present but is effectively frozen with maintenance mode. A **critical data-loss bug** existed in the tiering feature starting `RELEASE.2022-11-10T18-20-21Z` (Julien Lau blog post). Use with extreme caution, or not at all.

**AIStor (enterprise):** Full lifecycle transitions to cold tiers (any S3-compatible target: AWS S3, Glacier, GCS, Azure, another MinIO cluster). "Automated data tiering" is an advertised AIStor feature.

### Practical verdict for HarvestPredictor
At 100–1000 images/day/user × 90 days × ~200 KB average ≈ **1.8 GB per user / 90d**. For MVP scale (Telegram bot pilot, tens of users), **tiering is irrelevant** — all data is small enough to stay "hot" on local disk. Revisit only when a single user passes ~1 TB.

**Gotcha:** If you *need* tiering later on OSS, you are walking into unmaintained code with a known data-loss history. Better path: either migrate off MinIO, or budget for AIStor Enterprise Lite.

Sources:
- [MinIO Tiering Warning: Data Loss Bug — dev.to](https://dev.to/julienlau/minio-a-critical-bug-in-the-tiering-feature-causing-data-loss-do8)
- [Data Lifecycle Management and Tiering — AIStor](https://www.min.io/product/aistor/automated-data-tiering-lifecycle-management)
- [Setting up a Hot/Warm S3 Cluster with MinIO (Jan 2026)](https://medium.com/@mickael_82295/setting-up-a-hot-warm-s3-cluster-with-minio-a6486cb680ed)

---

## 3. Presigned URL TTL — best practices & rotation

Presigned URLs are fully supported on OSS. Signatures are computed client-side using the SDK (`minio-go`, `minio-py`, `minio-js`) and **do not require a round trip to the server** — presign generation is free.

### Signing model
- URL embeds: access key id, signature, expiration timestamp, object key, HTTP verb (GET/PUT).
- **Anyone with the URL has access** during the TTL window — treat URLs as bearer tokens.
- Max TTL by S3 spec: **7 days** (604800 seconds). MinIO enforces this.

### TTL recommendations for crop snapshots
| Use case | Recommended TTL | Reason |
|---|---|---|
| Upload from mobile/browser (PUT) | 5–15 min | User completes action immediately; short window limits replay |
| Image view in app (GET) | 15–60 min | User session length; balance re-signing cost vs leak window |
| Report/export share link (GET) | 24 h max | Explicit share semantics, log every issuance |
| Admin debug/forensic | 5 min | Narrow blast radius |

### Security best practices
1. **Always serve over HTTPS.** Put MinIO behind nginx/Caddy with TLS and `HSTS`. A leaked HTTP presigned URL is an instant data leak.
2. **Short TTL + regenerate on demand.** Don't cache long-lived presigned URLs in the DB. Regenerate per request.
3. **Tie to user session.** Revoke the server-side session on logout → prevents future regeneration, but **cannot revoke URLs already issued** (this is a signing-based model, not a session-based one).
4. **Rotate the signing access/secret key periodically.** Rotating invalidates all outstanding presigned URLs — brute but effective kill switch if one leaks.
5. **Do not put presigned URLs in referrer-leaking contexts** (e.g., `<img src>` on a page that then redirects out); consider adding `Referrer-Policy: no-referrer`.
6. **Audit log issuance.** Presign generation is silent by default. Log `(user_id, object_key, ttl, ip, ua)` in your application layer — MinIO does not know who presigned what.
7. **Use a dedicated, minimally scoped IAM user** for presign issuance (read-only on one prefix), not your admin credentials.

### Rotation
No built-in URL rotation. Strategies:
- **Short TTLs + re-sign on refresh** — operational rotation.
- **Key rotation (nuclear option)** — create new access/secret key, switch app over, delete old key → all old URLs die.
- **Object key rotation** — rename/copy object to new key on sensitive events; old URLs 404.

### Gotchas
- **Presigned URLs behind a reverse proxy**: signature is computed against the URL the client sees. If nginx rewrites the Host header, signatures break. Set `proxy_set_header Host $host;` and configure MinIO with `MINIO_SERVER_URL=https://your.domain`. (Long-running issue #6853.)
- **Docker dev environment**: `minio:9000` internal DNS vs `localhost:9000` browser — mismatched host → signature mismatch. Fix with proper `MINIO_SERVER_URL` and `MINIO_BROWSER_REDIRECT_URL`.

Sources:
- [Presigned Operations — minio-go DeepWiki](https://deepwiki.com/minio/minio-go/5.2-presigned-operations)
- [Best Practices to Secure MinIO in Production — Medium](https://medium.com/@nafiul.hafiz97/best-practices-to-secure-minio-object-storage-in-production-1d6e015a6405)
- [AWS presigned URL best practices (applicable, S3 API)](https://docs.aws.amazon.com/pdfs/prescriptive-guidance/latest/presigned-url-best-practices/presigned-url-best-practices.pdf)
- [MinIO behind proxy — presigned URLs #6853](https://github.com/minio/minio/issues/6853)
- [Solving Presigned URL Issues in Docker + MinIO — Medium](https://medium.com/@codyalexanderraymond/solving-presigned-url-issues-in-dockerized-development-with-minio-internal-dns-61a8b7c7c0ce)

---

## 4. Bucket notifications → webhook (for thumbnail generation)

**Fully supported in OSS.** MinIO sends HTTP POST with JSON payload to a configured webhook endpoint on configured events (`s3:ObjectCreated:Put`, `s3:ObjectCreated:CompleteMultipartUpload`, `s3:ObjectRemoved:Delete`, etc.).

### Configuration
```bash
# 1. Configure the webhook target
mc admin config set myminio notify_webhook:thumbs \
    endpoint="http://thumbnailer:3000/on-upload" \
    auth_token="secret-token" \
    queue_dir="/tmp/webhook-queue"
mc admin service restart myminio

# 2. Attach event to bucket + prefix
mc event add myminio/snapshots arn:minio:sqs::thumbs:webhook \
    --event put --prefix raw/ --suffix .jpg
```

### Event payload (Records[0])
- `s3.bucket.name`, `s3.object.key`, `s3.object.size`, `s3.object.eTag`, `eventName`, `eventTime`, `userIdentity.principalId`

### Thumbnail pattern (canonical MinIO example)
Official `minio/thumbnailer` (Node.js) example: listens via webhook or `listenBucketNotification`, downloads the object, resizes with ImageMagick/sharp, uploads to `thumbs/` prefix. [GitHub link](https://github.com/minio/thumbnailer).

### Gotchas
- **At-most-once delivery by default.** If the webhook endpoint is down, events can be lost. **Set `queue_dir`** to enable on-disk queueing/retry — otherwise you'll silently miss events.
- **Webhook target must ack within MinIO's timeout** (default ~5s). For slow image processing, return 200 immediately and do work async.
- **No signature validation** on incoming webhook requests unless you configure `auth_token` — the thumbnailer service must enforce this.
- **Cannot filter by size or metadata**, only by prefix + suffix. Filter in the webhook handler if you need to ignore e.g. files > 10 MB.
- **Broadcast to multiple targets:** attach multiple events. But all targets see every matching event → no fanout routing.
- **Loop hazard:** if your thumbnailer writes back into the same bucket under a prefix the event rule matches, you'll create an infinite loop. Use a distinct prefix (e.g., `thumbs/`) and exclude it in the event rule suffix filter.

### Fit for HarvestPredictor
**Good fit** for post-upload processing: generate thumbnail, kick off CV inference, write EXIF metadata, create audit-log DB row. Use as trigger for the Python FastAPI + YOLOv8 CV service — MinIO PUT → webhook → enqueue inference job.

Sources:
- [Introducing Webhooks for MinIO — blog](https://blog.min.io/introducing-webhooks-for-minio/)
- [minio/docs/bucket/notifications/README.md](https://github.com/minio/minio/blob/master/docs/bucket/notifications/README.md)
- [minio/thumbnailer (official example repo)](https://github.com/minio/thumbnailer)
- [MinIO Bucket Notifications guide — Oneuptime (Jan 2026)](https://oneuptime.com/blog/post/2026-01-30-minio-bucket-notifications/view)

---

## 5. Built-in image transformation (resize / format conversion)

**OSS: none.** MinIO is a pure object store — no image manipulation primitives.

**AIStor (enterprise):** "Object Lambda" — code handlers triggered on GET that can transform the object before returning it. Analogous to AWS S3 Object Lambda. Supports format conversion, resize, redaction, etc. **Enterprise-only.**

### Practical options for HarvestPredictor (OSS path)
1. **imgproxy in front of MinIO** (recommended) — popular, production-hardened, Go, no state. URL-signed transforms: `https://imgproxy/unsafe/resize:fit:800:600/plain/s3://snapshots/raw/abc.jpg`. Pairs naturally with the CV service architecture.
2. **Thumbnail-at-upload** via webhook + sharp/Pillow → store pre-rendered sizes under `thumbs/640/…`, `thumbs/1280/…`. Simpler, higher storage cost, cheap serve.
3. **Hybrid:** pre-generate 1–2 common sizes at upload, serve arbitrary transforms via imgproxy on demand.

### Recommendation
**Pre-generate thumbnails at upload** via the webhook trigger (§4). Crop disease images are viewed in predictable contexts (mobile list thumbnail, detail view, report export). On-demand transformation is over-engineering for MVP.

Sources:
- [Building a Scalable Image CDN with MinIO + imgproxy + Cloudflare](https://medium.com/@lorenzo_33729/building-a-scalable-image-cdn-with-minio-imgproxy-and-cloudflare-4694ad4b93df)
- [An exercise with MinIO & imgproxy — Medium](https://medium.com/@Oskarr3/an-exercise-with-minio-imgproxy-fb3407e19026)
- [Transforms with Object Lambda — AIStor (enterprise)](https://docs.min.io/enterprise/aistor-object-store/developers/transforms-with-object-lambda/)
- [Kiina/image-resizer — webhook resizer example](https://github.com/Kiina/image-resizer)

---

## 6. Performance: many small objects (5 KB – 500 KB)

### How MinIO handles small objects
- **Metadata inline with object**: `xl.meta` stores metadata adjacent to the object itself, not in a separate metadata server. Avoids the metadata-server round trip that sinks many object stores with small files.
- **Fast erasure coding** applies even to tiny objects.
- **Small-object optimizations** (blog: "MinIO Optimizes Small Object Storage"): coalescing improvements to reduce inode pressure.

### Observed characteristics
- **NVMe is strongly recommended** for small-object workloads. HDDs hit IOPS walls quickly — each PUT is a metadata-heavy operation.
- **4 KB objects are measurably slower per byte** than 4 MB objects (issue #9758) — expected, but worth knowing.
- **Inode exhaustion** is a real risk on the underlying filesystem at millions of objects. XFS with default settings is fine up to hundreds of millions but monitor `df -i`.
- **Concurrency matters.** Single-client `mc mirror` is slow — parallelize uploads client-side. For our use case (one upload per diagnosis), this is not an issue.

### Numbers for HarvestPredictor scale
- Worst case: 1000 users × 1000 images/day × 500 KB = **500 GB/day ingest**. Retention 90 d → ~45 TB steady state.
- Realistic MVP: 50 users × 100 images/day × 200 KB = **1 GB/day**. 90 GB steady state. **Trivial for any modern NVMe server.**
- Metadata overhead: ~4 KB per object (xl.meta + dir entries). At 1000 users × 1000/day × 90d = 90M objects = ~360 GB pure metadata overhead at scale. **Plan inode budget accordingly.**

### Tuning
- TCP buffer `net.core.rmem_max=67108864` and `wmem_max` for high-bandwidth deployments.
- Use distributed mode across ≥4 drives/nodes for parallelism, even if single-server.
- Increase `ulimit -n` (open file descriptors) to 1M+.

Sources:
- [MinIO Optimizes Small Object Storage — blog](https://blog.min.io/minio-optimizes-small-objects/)
- [The Small Files Problem — blog](https://blog.min.io/challenge-big-data-small-files/)
- [Performance Tuning — AIStor docs (guidance applies to OSS)](https://docs.min.io/enterprise/aistor-object-store/operations/performance-tuning/)
- [Issue #9758: 4K vs 4M object performance](https://github.com/minio/minio/issues/9758)

---

## 7. Bucket layout — one bucket or multiple? Prefix patterns

### Guidelines from MinIO
- **Up to 500 000 buckets per deployment** — bucket count is cheap.
- **Target ~10 000 objects per prefix** as a baseline for modest-hardware deployments. Scales higher on good hardware.
- "Folders" in MinIO are **prefix conventions**, not first-class objects (unlike some S3 clients that create zero-byte `foo/` markers).

### Layout options for HarvestPredictor

**Option A: single bucket, hierarchical prefixes (recommended for MVP)**
```
snapshots/
  raw/{user_id}/{yyyy}/{mm}/{dd}/{uuid}.jpg
  thumbs/640/{user_id}/{yyyy}/{mm}/{dd}/{uuid}.webp
  thumbs/1280/{user_id}/{yyyy}/{mm}/{dd}/{uuid}.webp
  exports/{user_id}/{yyyy}/{mm}/{export_id}.pdf
```
Pros: one lifecycle rule per prefix, one CORS rule, one bucket-notification config, one IAM policy. Migration between tiers is a prefix filter. Fits <500K buckets guideline trivially. Date partitioning keeps any single prefix well under the 10K baseline.

**Option B: bucket per user** — overkill. Blows through object-per-prefix counting benefits, multiplies management work, and gains no isolation MinIO's prefix-level IAM can't provide.

**Option C: bucket per environment (prod/staging/dev)** — yes, always. Orthogonal to the layout above.

### Prefix pattern details
- **Date-partitioned** (`yyyy/mm/dd`) keeps any single prefix list short and works naturally with date-range queries and lifecycle filters.
- **User-first vs date-first**: put `user_id` before the date so per-user listing is a single prefix scan. Per-date listings across users are a rarer operation.
- **UUID as object name** (not sequential): avoids hot-spotting on any hashed partition and makes guessing infeasible.
- **Avoid deep nesting** (>4 levels) — slows `LIST` and makes mental model heavier.

### Gotchas
- MinIO `LIST` on a prefix is **O(objects in prefix)** — hence the 10K guideline. Date-partitioning naturally caps this for append-heavy workloads.
- Objects named with only digits or leading slashes confuse some clients. Stick to `[a-z0-9-_/]`.
- **No trailing-slash "folder" objects.** Clients that create them (legacy S3 browsers) just add noise.

Sources:
- [Prefix vs Folder — MinIO blog](https://blog.min.io/prefix-vs-folder/)
- [Managing Buckets — minio-go DeepWiki](https://deepwiki.com/minio/minio-go/4.1-managing-buckets)

---

## 8. CORS configuration for presigned GET URLs (browser direct access)

**This is MinIO's messiest area.** Long-standing limitation:

> **MinIO historically does not emit `Access-Control-Allow-Origin` on presigned URL responses**, even when the request carries an `Origin` header. (Issues #3985, #10002, #11111 — open/partially-addressed over multiple years.)

Practical consequences for our use case (browser `<img src="presigned-url">`):
- `<img>` tags usually work — they don't enforce CORS for *display*.
- `<img crossorigin="anonymous">` (e.g., for canvas operations / fetch to re-upload) **may fail**.
- `fetch()`-ing the URL for client-side processing **will fail** cross-origin unless headers are present.
- `OPTIONS` preflight has been known to return `400` (#10002).

### Workarounds
1. **Reverse proxy (nginx/Caddy) injects CORS headers.** Universal fix. Example nginx:
   ```nginx
   location /snapshots/ {
       proxy_pass http://minio:9000;
       add_header 'Access-Control-Allow-Origin' '$http_origin' always;
       add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS' always;
       add_header 'Access-Control-Allow-Credentials' 'true' always;
       if ($request_method = 'OPTIONS') {
           add_header 'Access-Control-Max-Age' 86400;
           return 204;
       }
   }
   ```
2. **Serve the same origin**. If the web app is `app.harvestpredictor.com` and images are `app.harvestpredictor.com/snapshots/...` (via reverse proxy path), CORS is not involved. **Simplest answer.**
3. **Dedicated CORS-friendly CDN** in front (Cloudflare, BunnyCDN).

### Recommendation for HarvestPredictor
Put nginx in front of MinIO (you need it for TLS anyway). Configure same-origin path-based routing: `https://app.harvestpredictor.com/media/snapshots/...` → MinIO. **Zero CORS problems.** Also gives central access logging, rate limiting, and header rewrites.

Sources:
- [MinIO CORS 'Access-Control-Allow-Origin' missing #3985](https://github.com/minio/minio/issues/3985)
- [CORS not included in response #11111](https://github.com/minio/minio/issues/11111)
- [CORS preflight OPTIONS returns 400 #10002](https://github.com/minio/minio/issues/10002)
- [Error loading image from S3 bucket on local MinIO — Label Studio forum](https://community.labelstud.io/t/error-loading-image-from-s3-bucket-on-local-minio-server/408)

---

## 9. Community vs Commercial (and maintenance mode) — CRITICAL

### Timeline
| Date | Event |
|---|---|
| May 2025 | Admin console GUI **stripped** from OSS build |
| Jun 2025 | User/policy/config management removed from OSS web UI |
| Nov–Dec 2025 | MinIO OSS GitHub repo placed into **maintenance mode**. "Not accepting new changes." |
| Dec 2025+ | Only case-by-case security patches. No feature work. No PR reviews. |

### What *still works* in OSS (as of Apr 2026)
- Core S3 API: PUT / GET / DELETE / LIST
- Presigned URLs
- Bucket notifications (webhook, Redis, NATS, Kafka targets)
- Lifecycle / ILM rules (with caveats from §1)
- Erasure coding, distributed mode
- IAM with bucket/prefix policies
- Basic encryption (SSE-S3, SSE-C)

### What is **gone or AIStor-only**
- Web admin console (policy editor, metrics dashboards) → enterprise only
- Object Lambda (transforms on GET) → enterprise only
- MinIO Catalog (metadata search, GraphQL) → enterprise only
- MinIO Cache (DRAM-backed read cache) → enterprise only
- KMS at scale (built-in enterprise KMS) → enterprise only
- SUBNET support, proactive patches, 24/7 SLA → enterprise only
- **Forward development**, performance improvements (AIStor claims ~1.7x throughput over OSS, 2x+ on small objects)

### AIStor subscription tiers (2026)
- **AIStor Free:** single-node, community support only. Could fit MVP pilot.
- **Enterprise Lite:** distributed, no premium support. Auto-upgrades to full Enterprise above 400 TiB.
- **Enterprise:** SUBNET support, <4h SLA, proactive diagnostics. Public pricing lists exabyte-scale subscriptions; smaller tier pricing requires sales contact. Unverified secondary-source figure: "~$96K/year" for entry enterprise (Medium, Elest.io) — **treat as rumor, not fact**, confirm with MinIO sales.

### Impact on HarvestPredictor
**This is the most important finding in the entire report.** A self-hosted Docker MinIO in 2026 is a **frozen** codebase with security-patch-only guarantees. For a young project with 90-day retention of user data, this is a real risk:

**Viable paths:**
1. **Stay on OSS (pragmatic).** It still works. Pin a release. Accept you are on an unmaintained base layer. Limit blast radius: monitor upstream security advisories yourself, have an exit plan to an alternative, keep MinIO behind nginx (reduces attack surface anyway). **Recommended for MVP Telegram bot pilot.**
2. **Switch now to a maintained alternative.** See §10.
3. **Move to AIStor Free** (single-node, community support). Same code as OSS for single-node, just the commercial distribution — gives a path to upgrading without re-architecture. **Worth evaluating for post-MVP.**
4. **Use a managed S3** (Backblaze B2, Cloudflare R2, Wasabi, Hetzner Object Storage). Given the business constraints ("grants not VC", cost-sensitive), Hetzner (~€5/mo/TB) or Backblaze B2 are plausible. Trades self-hosting ideal for maintained infrastructure.

### Recommendation
**MVP: Use MinIO OSS pinned to the latest RELEASE available at freeze (whichever is in `minio/minio:RELEASE.2025-xx-xx-…`), behind nginx, with exit plan documented to SeaweedFS or Hetzner Object Storage.** Do not adopt AIStor commercial for MVP — cost and overkill. Revisit at scale decision.

Sources:
- [MinIO Maintenance Mode Issue #21714](https://github.com/minio/minio/issues/21714)
- [MinIO in Maintenance Mode — InfoQ (Dec 2025)](https://www.infoq.com/news/2025/12/minio-s3-api-alternatives/)
- [MinIO Community Edition Enters Maintenance-Only — EloqData](https://www.eloqdata.com/blog/2025/12/10/minio-maintenance)
- [MinIO users complain after admin UI removed — Blocks & Files](https://blocksandfiles.com/2025/06/19/minio-removes-management-features-from-basic-community-edition-object-storage-code/)
- [Introducing New AIStor Subscription Tiers — MinIO blog](https://www.min.io/blog/introducing-new-subscription-tiers-for-minio-aistor-free-enterprise-lite-and-enterprise)
- [MinIO AIStor vs Community — MinIO blog](https://blog.min.io/minio-aistor-vs-community-edition-unlocking-enterprise-grade-performance-security-and-scalability/)
- [MinIO, Redis, HashiCorp: Sustainability Crisis 2026 — Medium](https://medium.com/@heinancabouly/minio-redis-hashicorp-a-sustainability-crisis-reaching-your-stack-in-2026-78f9577699cb)

---

## 10. Recent (2025–2026) changes — summary & alternatives watchlist

### Changes that affect us directly
- OSS freeze (§9) — biggest single factor.
- Console GUI removed from OSS (§9) — operations now via `mc` CLI only. Docker-compose stack needs `mc` sidecar or operator routines.
- No new small-object performance improvements expected on OSS path (AIStor claims 2x+ over OSS for small files — but HarvestPredictor scale doesn't need it).

### Viable alternatives to keep on the watchlist
- **SeaweedFS** — closest OSS drop-in. S3-compatible, filer included, production users. Apache 2.0. **Most popular migration target.**
- **Garage** — Rust, geo-distributed by design, simple ops, **AGPL** (contagious if you distribute — not an issue for SaaS).
- **RustFS** — Rust, Apache 2.0, includes web GUI (which MinIO removed). Newer, less battle-tested.
- **Ceph RGW** — mature, complex to operate, overkill below 100 TB.
- **Hetzner Object Storage / Backblaze B2 / Cloudflare R2** — managed, cheap, zero ops. R2 has **zero egress** — attractive for image serving.

Sources:
- [MinIO Alternatives: SeaweedFS, Garage, RustFS, Ceph — dev.to](https://dev.to/arash_ezazy_f69fb13acdd37/minio-alternatives-open-source-on-prem-real-world-credible-seaweedfs-garage-rustfs-and-ceph-36om)
- [Self-Hosted S3 Storage in 2026 — Rilavek](https://rilavek.com/resources/self-hosted-s3-compatible-object-storage-2026)
- [RustFS vs SeaweedFS vs Garage — Elest.io](https://blog.elest.io/rustfs-vs-seaweedfs-vs-garage-which-minio-alternative-should-you-pick/)
- [Distributed Storage 2026 — SIXE](https://sixe.eu/news/ceph-minio-2026-storage-guide)

---

## Summary — HarvestPredictor-specific checklist

| Concern | Verdict | Action |
|---|---|---|
| 90-day auto-delete | Supported, but scanner-delayed and has historic bugs | Use `Expiration.Days=90`, monitor audits, keep independent DB record |
| Hot/cold tiering | OSS tiering has known data-loss bug; AIStor only for safe use | Not needed at MVP scale; skip |
| Presigned URL TTL | Fully supported, S3-standard | Short TTL (5–60 min), rotate keys as kill switch, audit in app layer |
| Webhook on upload | Fully supported, reliable with `queue_dir` | Use to trigger CV inference + thumbnail generation |
| Image transforms | **Not supported on OSS** | Pre-generate thumbs at upload via webhook; imgproxy if need arbitrary sizes |
| Small-object perf | Good on NVMe, metadata inline | Plan NVMe, set `ulimit -n`, XFS filesystem |
| Bucket layout | 1 bucket + date-partitioned prefixes | `snapshots/raw|thumbs/{user}/{yyyy}/{mm}/{dd}/{uuid}` |
| CORS | **Known broken on presigned URLs** | Serve same-origin via nginx reverse proxy |
| OSS vs commercial | **OSS is frozen (Dec 2025)** | Pin version, run behind nginx, document exit plan (SeaweedFS or Hetzner) |

**Biggest non-obvious risk:** The OSS maintenance mode is the most material change since MinIO was first chosen for this project. A project plan predating December 2025 needs to be re-evaluated. For MVP it is still a reasonable choice; for post-MVP scale, plan a migration decision point.
