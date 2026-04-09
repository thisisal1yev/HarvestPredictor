# Architecture Validation — CV Module Spec

**Validator role:** Architecture & Security
**Spec under review:** `docs/specs/cv-module-spec.md` (979 lines, dated 2026-04-08)
**Reference research:** `docs/research/final-report.md`
**Current schema:** `prisma/schema.prisma`
**Current Nuxt config:** `nuxt.config.ts`

---

## Verdict

**GO WITH FIXES**

The spec is structurally sound and the high-level decisions match the research conclusions. However, it has **3 blocking schema/Prisma defects**, **several real security gaps** (webhook auth, MinIO bypass, master-key sharing, presign rewrite), and **one section (§11 Cleanup) describing files that do not exist on disk**. None of these prevent the architecture from working — but they will block `prisma migrate dev` from running, will allow internal webhooks to be called by anyone on the host network, and will cause presigned URLs to 403 in the browser. Fix the blocking items, then start coding.

---

## Critical issues (blocking)

### C1. `prisma migrate dev` will not run as written — missing inverse relations on `User`

**Where:** §3.3, §3.4, §3.5
**What:** The spec adds three new `@relation(fields: [userId], references: [id])` arrows from `Connection`, `CVModel`, and (transitively) `Detection` to `User`. Prisma requires the inverse side on `User`. The current `User` model (`prisma/schema.prisma:10-19`) only has `farms Farm[]`. No inverse fields are added.

**Result:** `prisma generate` errors with `Error validating field "user" in model "Connection": The relation field "user" on Model "Connection" is missing an opposite relation field on the model "User"`.

**Fix:** Add to `User`:
```prisma
model User {
  ...
  farms        Farm[]
  cvModels     CVModel[]
  connections  Connection[]
}
```

### C2. `CVModel.uploadedBy → userId` rename is not actually a rename — it's a backfill that breaks existing data

**Where:** §3.4 ("rename in migration"), §3.5 step 2
**What:** The current schema has `uploadedBy String` with no FK. Renaming the column is fine if the values are real `User.id` strings, but:
- The spec gives no guarantee that current `uploadedBy` values point to real users
- After the rename, `userId` becomes a non-nullable FK with `onDelete: Cascade` — any orphan row will make the migration fail at the constraint-add step
- `prisma migrate dev` against an existing dev DB with seeded `CVModel` rows will reject the constraint because `User → CVModel` Prisma backrelation doesn't exist (see C1)

**Fix:** Either:
- (a) Drop & recreate the `CVModel` table in the same migration (dev-DB-friendly, MVP-acceptable since seed does `TRUNCATE … CVModel`), OR
- (b) Two-step: add `userId String?` nullable, backfill, then `ALTER COLUMN userId SET NOT NULL`

State the chosen approach in §3.5. As written, neither path is unambiguous.

### C3. `Detection` lost the `userId` denormalization — every ownership check now requires a join through `Connection`

**Where:** §3.3 (Detection model), §5.3 (Detections list endpoint)
**What:** `Detection.connectionId` is the only link to a user. The list query in §5.3 must `where: { connection: { userId } }` on every read. Three concrete consequences:

1. **Performance:** the listing index is `@@index([connectionId, detectedAt(sort: Desc)])`. Filtering by `userId` first requires Prisma to expand `connectionId IN (SELECT id FROM "Connection" WHERE "userId" = ?)`. For users with many connections this becomes a hash join. Add `userId` to `Detection` and index `(userId, detectedAt DESC)`.
2. **MinIO key consistency:** the snapshot key already encodes `userId` (`detections/{userId}/...`). Storing `userId` denormalized on the row prevents drift between key prefix and the row's actual owner.
3. **Cascade safety:** if a future bug allows a Connection to be re-parented across users, all historical Detections silently change owner. A denormalized `userId` makes that a hard error.

**Fix:** Add `userId String` + `user User @relation(...)` + `@@index([userId, detectedAt(sort: Desc)])` to `Detection`. Set it from the parent connection at insert time.

---

## Important issues (fix before coding)

### I1. Internal webhook auth (`/api/cv/_internal/*`) is a static shared secret with no transport binding

**Where:** §5.4, §8 (`CV_API_KEY`)
**What:** `CV_API_KEY` is checked via header. Three holes:

1. **No origin restriction in nginx.** Anyone who can reach the Nuxt container's port (other tenants on the host, a sidecar that gets popped, an SSRF in any other Nuxt endpoint) can POST to `/api/cv/_internal/detection` with the right header and inject fake detections into anyone's history (`connectionId` is user-controlled in the body — there's no proof it actually corresponds to an active stream).
2. **No mTLS, no IP allowlist.** Spec mentions nothing about restricting `_internal/*` to the Docker network or to the CV service's container IP.
3. **`connectionId` trust.** The webhook handler must verify the `connectionId` belongs to a connection currently in `status=active` *and* started by the CV service. Otherwise an attacker who learns a connection ID can backfill arbitrary detections retroactively.

**Fix (cheap and sufficient for MVP):**
- nginx `location /api/cv/_internal/` block with `allow 172.16.0.0/12; deny all;` (Docker bridge range) or pin to the cv-service container IP via `allow`.
- In the Nuxt webhook handler, lookup `Connection` by ID and assert `status === 'active'` before creating a Detection.
- Add a per-stream nonce: when Nuxt POSTs `/connections/start` to Python, it returns a `streamToken`; webhook payloads must include the matching token. Short-lived, in-memory, dies on CV-service restart.

### I2. ENCRYPTION_KEY shared between Nuxt and Python is a single point of total compromise

**Where:** §7.3, §8
**What:**
- The same 32-byte key is in `.env` for *both* Nuxt and Python services. If either container is read by an attacker (e.g., env dump via SSRF), all camera credentials are decryptable forever.
- §7.1 mentions "rotation: documented but not implemented in MVP" — but doesn't actually document it. There's no key versioning in the ciphertext layout (`iv | tag | ciphertext`), so adding a second key later requires migrating every blob.
- The "where decryption happens" choice in §7.3 (Python-side decryption) is correct, but the spec then leaks the key into Nuxt anyway because Nuxt does the *encryption* on save. So Nuxt has the key in memory. The justification "Nuxt never has plaintext credentials in API responses" is true but irrelevant — Nuxt has the key, which is strictly worse than holding plaintext for one request.

**Fix:**
- Decide: **either** Python encrypts AND decrypts (Nuxt forwards plaintext over the trusted internal HTTP hop on save, never stores it; Nuxt only ever receives ciphertext from Python and stores it in DB), **or** Nuxt encrypts AND decrypts (and then sends plaintext to Python on `/connections/start` over the internal network — same trust assumption as the API key already requires).
- Add a key version byte to the ciphertext layout: `version(1) | iv(12) | tag(16) | ciphertext`. Costs nothing now, makes rotation possible later.
- Document in §7.1 *what* a key leak means operationally: rotate `ENCRYPTION_KEY`, mark all existing `Connection.usernameEnc/passwordEnc` as `null`, force re-entry. Right now §7.1 says "users must re-enter" without saying what triggers the re-entry flow.

### I3. Presigned URL signature breaks behind nginx — the spec's two `endpoint` settings contradict each other

**Where:** §5.5 vs §6.1 vs §6.3 vs final-report.md §4.4
**What:**
- §5.5 creates the S3 client with `endpoint: config.minioEndpoint` (which from §8 is `http://minio:9000` — internal). The presigned URL produced by `getSignedUrl` will have `Host: minio:9000` baked into the signature.
- §6.3 nginx rewrites `/media/(.*) → /harvest-snapshots/$1` and proxies to `http://minio:9000` with `proxy_set_header Host $host` — i.e., Host becomes `app.harvestpredictor.example`.
- MinIO validates the presigned URL using the *request* Host. Mismatch → 403 SignatureDoesNotMatch.
- §6 says "Presigned URLs MUST be generated with `endpoint: https://app.harvestpredictor.example/media`" — but §5.5's code does the opposite, and §8 has TWO env vars (`MINIO_ENDPOINT` internal, `MINIO_PUBLIC_ENDPOINT` external) but §5.5 only reads `minioEndpoint`.

This contradicts the research final report's working pattern (`final-report.md:303-329`), which uses internal endpoint for signing AND rewrites the URL to `/media/` after signing. That works *because* MinIO honors `MINIO_SERVER_URL` for signature validation. The spec sets `MINIO_SERVER_URL` in §6.1 but doesn't explain that this is the load-bearing piece.

**Fix:** Pick one of:
- (a) Sign with `endpoint: minioPublicEndpoint` (`https://app.example.com/media`) AND set `forcePathStyle: true` AND ensure nginx forwards the path as-is. Simplest mental model.
- (b) Sign with internal endpoint, rely on `MINIO_SERVER_URL=https://app.example.com` matching nginx's forwarded Host, then string-rewrite `http://minio:9000/harvest-snapshots/...` → `/media/...` in `presignGet` (the final-report.md approach).

State which approach explicitly and update §5.5 code to match. Add a note that without `MINIO_SERVER_URL` set correctly, all media will 403.

### I4. Stream restart / idempotency / leak on CV-service restart

**Where:** §4.4, §13 ("On startup, do NOT auto-resume connections"), §15 Q-none
**What:** The spec correctly says CV service does NOT auto-resume on restart, but doesn't specify:

1. **Startup reconciliation.** On boot, the CV service has zero in-memory state. Nuxt's `Connection.status` may say `active` for 5 connections that the CV service no longer knows about. When the user navigates to Connections, they see "active" badges that are lies. The Start button is disabled because `status !== idle`.
   **Fix:** On CV service startup, POST `/api/cv/_internal/connection-status` for each connection it does NOT know about (or have Nuxt do a startup reconciliation: `UPDATE Connection SET status='disconnected', errorMessage='cv-service restart' WHERE status='active'`).

2. **Double-start race.** User clicks Start twice quickly, or two browser tabs both click Start. Two background tasks start, both upload to MinIO, two sets of duplicate detections. The spec has no mention of an idempotency key or DB-level lock.
   **Fix:** In the `/start` handler, do `UPDATE Connection SET status='active' WHERE id=? AND status='idle' RETURNING *`. If 0 rows, return 409 Conflict. Then call Python.

3. **Delete-mid-stream.** User deletes a Connection while CV service is actively writing detections to MinIO. `onDelete: Cascade` removes the Detection rows, but the MinIO objects under `detections/{userId}/.../{ulid}/` are orphaned forever (90-day lifecycle eventually catches them, but for 90 days they're zombie objects with no DB record).
   **Fix:** DELETE handler for Connection must (a) call Python `/connections/stop` first, (b) collect snapshotKeys via a join, (c) issue `DeleteObjects` to MinIO for each prefix, (d) then Cascade. Or accept the lifecycle will catch them and document it.

### I5. `Detection.snapshotKey` includes `userId` in the path — if userId rotates, key becomes a lie

**Where:** §3.3 (key shape), §6.2 (key layout)
**What:** Storing `userId` in the MinIO key (`detections/{userId}/...`) is fine, but:
- It contradicts the research final report which uses date-first paths (`detections/{YYYY}/{MM}/{DD}/{ulid}`, no userId — see `final-report.md:179-186`). The lifecycle rule is `--prefix "detections/"` and works either way, but the rationale in final-report.md was "ACL via DB, not path." The spec changed this without justification.
- The spec gives no `--prefix` argument to `mc ilm rule add` in §6.2 (just `--expire-days 90`). Without `--prefix`, the rule applies bucket-wide, which is what we want — but state it.
- If userId is in the key, every key lookup must validate the userId portion against the requesting user's ID — otherwise a presign endpoint that takes a `key` query param becomes an IDOR. (The spec's API surface doesn't take user-supplied keys, but this is a sharp edge for whoever writes the next endpoint.)

**Fix:** Either revert to date-first per the research, OR keep userId-first and add a `presignGet` precondition that the caller asserts ownership before calling. Pick one, document in §6.2.

### I6. §11 Cleanup section references files that DO NOT EXIST in the current codebase

**Where:** §11
**What:** Verified against the actual filesystem:
- `server/api/cv/sessions/` — does not exist
- `server/api/cv/detect/` — does not exist
- `server/api/cv/models/` — does not exist
- `server/api/cv/knowledge/` — does not exist
- `server/utils/cvService.ts` — does not exist
- `app/pages/dashboard/diagnosis.vue` — does not exist
- `app/pages/dashboard/cv/` — does not exist
- `app/components/cv/PhotoUpload.vue` — does not exist
- `app/components/cv/HistoryTimeline.vue` — does not exist
- `app/components/cv/TreatmentCard.vue` — does not exist
- `app/components/cv/DetectionList.vue` — does not exist
- `app/components/cv/ModelManager.vue` — does not exist
- `app/composables/useDiagnosis.ts` — does not exist
- `app/composables/useDiagnosisHistory.ts` — does not exist
- `app/composables/useCVModels.ts` — does not exist
- `i18n/locales/*.json` `diagnosis.*` keys — need to verify

(Note: the session-start git status showed many of these as `??` untracked, but the working tree currently has none of them. They were likely staged via earlier edits and then reverted. Either way, the spec is not aligned with reality.)

**Fix:** Re-walk the actual repo, regenerate §11 against ground truth. As written, an implementer following §11 will spend 15 minutes confused and may delete the wrong things.

### I7. `CVModel.isDefault` "default per user per crop type" is enforced in app code, not DB — race-prone

**Where:** §3.5 step 5
**What:** "Set as default" is a two-step UPDATE: (1) clear the old default for `(userId, cropType)`, (2) set the new one. With concurrent requests this can leave zero defaults or two defaults. The spec says "Postgres partial unique index possible but overkill for MVP" — it's literally one line and removes the race entirely:

```prisma
@@index([userId, cropType, isDefault])  // ← weak: can have two trues
// vs
@@unique([userId, cropType], where: { isDefault: true }, name: "one_default_per_crop_per_user")
```

Prisma's `@@unique` doesn't support partial conditions natively; do it via a raw migration SQL: `CREATE UNIQUE INDEX one_default_per_crop_per_user ON "CVModel" ("userId", "cropType") WHERE "isDefault" = true;`

**Fix:** Add the partial unique index. Cost: one migration line. Benefit: zero correctness pitfalls.

---

## Minor issues / suggestions

### M1. `Connection.status` enum should be a Postgres ENUM, not a free-form String

§3.3 declares `status String @default("idle")` with four allowed values. Free-form String allows typos like `"Active"` (case mismatch) to silently bypass status filters. Use Prisma `enum`. Same for `protocol`, `severity`, `category`.

### M2. Quick Test endpoint forwards multipart to Python — file size limits unclear

§2.2 says "max 10 MB" for Quick Test images and "max 100 MB" for ONNX uploads. §5.1 lists the routes but doesn't specify Nitro's `bodySize` limit. Nitro's default `maxRequestSize` is small. Add to `nuxt.config.ts`:
```typescript
nitro: { experimental: { tasks: false }, routeRules: { '/api/cv/models': { /* large body */ } } }
```
Or use streaming via `readMultipartFormData` with a manual size check. The spec just hand-waves "multipart" — it'll work in dev and fail in prod with the wrong nginx `client_max_body_size` (§6.3 sets `100m` but only on `/media/`, not on `/api/cv/`).

### M3. `lastSeenAt` update path from CV service to Nuxt has no endpoint

§3.3 introduces `lastSeenAt DateTime @default(now())` "updated when same class+bbox seen again." §5.4 lists three internal webhooks: `detection`, `thumb-ready`, `connection-status`. There's NO `update-last-seen` webhook. Either:
- (a) Reuse `/_internal/detection` and have it perform `upsert`-like logic (look up recent detection with matching `(connectionId, className, roughBbox)` and either update lastSeenAt or insert), OR
- (b) Add a fourth `/_internal/detection-seen` webhook.

The spec is silent on which.

### M4. ULID for snapshot_key, cuid for Detection.id — two ID systems, no link between them

§3.3 uses `cuid()` for `Detection.id`. §4.6 generates a separate ULID for `snapshot_key`. So a Detection has *two* identifiers. Why not generate the ULID in Nuxt and use it as both `id` and `snapshotKey`? Or use cuid as the snapshot folder name? Two ID systems = two indices to maintain and one more thing for engineers to mistake.

### M5. `MAX_CONCURRENT_STREAMS=5` returns 429 — UX is unclear

§4.4 says start returns 429 if limit reached. §9 doesn't show any UI handling for this. The user clicks Start, sees... what? A toast? Silent failure? Error badge? Specify in §2.3.

### M6. `proxy_read_timeout 30s` on nginx `/media/` is too short for large image fetches over rural LTE

§6.3 sets 30s. A 250 KB full.jpg over 2 Mbps takes ~1 s, so 30s is fine for a single image. But the *first byte* from MinIO can take longer if the bucket is cold or the lifecycle scanner is locking objects. 60s is safer; cost is zero.

### M7. No request rate limiting on `/api/cv/connections/test`

§5.2 exposes a public endpoint that calls `cv2.VideoCapture` against a URL the user provides. This is an SSRF vector: a user can probe internal IPs (`rtsp://127.0.0.1:80/`, `rtsp://10.0.0.1:8080/`) and observe timing/error differences. Plus it's CPU-expensive — Python ties up a thread for 5 seconds per call. Add basic rate limiting (5/minute/user) and a denylist for RFC1918 + loopback ranges in `streamUrl` validation.

### M8. `KEY` constant in `server/utils/crypto.ts` is computed at module-load time

§7.2 has `const KEY = Buffer.from((useRuntimeConfig()...))`. `useRuntimeConfig()` at module top-level does not work in Nitro outside of an event handler context. Move into the function body or memoize via `lazy` pattern.

### M9. Severity tier "filtered out (not stored)" for confidence < 0.40 happens in Python

§16 says detections below 0.40 are filtered. The spec doesn't say *where*. If filtered in Python before Nuxt sees them, the confidence threshold is hardcoded in CV service and you cannot lower it later without redeploy. Make it a per-model or per-connection setting in DB? At minimum, document it as a CV service env var.

### M10. The spec doesn't mention auth on `/health`

§4.3 says `GET /health` has `Auth: None`. Fine for a healthcheck, but it lists "loaded models" — that's information disclosure (model names hint at user activity, possibly user IDs if filenames include them per `ml_models/{userId}/`). Either return only `{ status: "ok" }` from `/health`, or add API-key auth.

---

## Cross-section inconsistencies

### X1. §4 (Python) snapshot save flow vs §5 (Nuxt API) webhook contract — order of operations is racy

§4.6 step 4 says: "POST detection metadata + snapshot_key + thumbReady=false to Nuxt webhook."
§4.6 step 6 says: "Later thumbnail task completes → Nuxt updates thumbReady=true."

But §4.6 step 3c does the thumbnail upload AND posts `thumb-ready` BEFORE step 4 has guaranteed completion. ThreadPoolExecutor task may finish before the synchronous step 4 webhook returns — meaning Nuxt receives `thumb-ready` for a `detectionId` it has not created yet. The webhook handler will 404 and silently lose the thumb-ready update; `thumbReady` stays `false` forever.

**Fix:** Either (a) guarantee step 4 completes before scheduling the thumbnail job, OR (b) `thumb-ready` webhook keys on `snapshotKey` (which the producer knows before step 4), and Nuxt does an upsert by `snapshotKey` when it sees thumb-ready before detection.

### X2. §4 says CV service knows `userId` (it's in the snapshot key); §5 does not say how Nuxt passes it

§4.6 step 3a constructs `snapshot_key = f"detections/{userId}/...`. The CV service doesn't have a Prisma client. So `userId` must be passed by Nuxt when starting the connection. §5 doesn't show this in the `/connections/[id]/start` request body or in any Python endpoint signature. Add it to §4.3 (`POST /connections/start` body must include `userId`) and to the Nuxt route handler.

### X3. §9 references components matching §5 endpoints — but `quick-test` modal uses canvas overlay with bboxes

§2.2 says Quick Test results show bboxes. §5.1 returns "Inference result (not persisted)." The shape of that result is not specified in any contract. §9.1's `BBoxOverlay.vue` consumes "bbox" — what format? Normalized 0-1? Pixel? Same as `Detection.bbox`? Add a Pydantic schema to §4 and a TypeScript type in §5.

### X4. §5.5 hard-codes `region: "us-east-1"` — inconsistent with §6.1 which has no region setting

Cosmetic, but worth documenting that MinIO ignores region — otherwise an engineer will spend an hour trying to "fix" the region.

### X5. §13 "On startup, do NOT auto-resume connections" vs §3.3 `Connection.status @default("idle")`

Status persists across restarts. After a CV-service restart, all rows still say `active` (or `error`, etc.) but no background tasks exist. §13 says "user must manually Start" — but §2.3 says the Start button only appears for `idle` connections. **A user with status=active and no running task cannot recover without DB surgery.** See I4.1.

### X6. §8 `MINIO_ACCESS_KEY` is mentioned in `runtimeConfig` but NOT in the `.env` block

§8's env block has `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` (admin credentials), but the `runtimeConfig` block lists `minioAccessKey`/`minioSecretKey`. These are different things: root user vs a service account. The S3 SDK should use a *non-root* IAM user scoped to read-only on `detections/`. Spec conflates them. Add `MINIO_ACCESS_KEY` and `MINIO_SECRET_KEY` to the env block and document the `mc admin user add` step.

---

## Things the spec got right (worth noting)

- **Two-variant storage strategy** matches the research conclusion exactly.
- **MinIO behind nginx for CORS** — correctly identified as mandatory, not optional.
- **Decryption in Python, not Nuxt** for keeping plaintext off the API surface — good instinct (modulo the key-sharing issue in I2).
- **Presigned URLs never cached in DB** — correct.
- **`onDelete: Cascade` from User → Connection → Detection** — correct ownership semantics.
- **`@@index([userId, status])` on Connection** — supports the "list active streams" hot query.
- **Reconnect with exponential backoff + jitter** — textbook correct.
- **Bounded ThreadPoolExecutor queue (maxsize=200)** — explicit backpressure rather than unbounded growth, good.
- **YAGNI section is genuinely YAGNI** — resists the temptation to add real-time WebSocket / multi-model ensembles / AVIF / etc.
- **§11 lists files to delete BEFORE writing new code** — good discipline (even if the file list is wrong, the discipline is right).
- **§16 severity tier mapping is concrete and testable.**

---

## Recommended additions to §13 Risks

- **CV service restart leaves DB in inconsistent state.** Mitigation: startup reconciliation job in Nuxt clears `status=active` rows. (See I4.1)
- **Concurrent Start requests (double-click / two tabs).** Mitigation: optimistic lock via `UPDATE … WHERE status='idle' RETURNING`. (See I4.2)
- **Connection delete leaves orphan MinIO objects for up to 90 days.** Mitigation: explicit prefix delete in DELETE handler, or accept and document. (See I4.3)
- **Webhook spoofing from anything else on the Docker network.** Mitigation: nginx allowlist + per-stream nonce. (See I1)
- **ENCRYPTION_KEY leak = total camera credential compromise, irreversible.** Mitigation: key versioning in ciphertext, single-service encryption, documented rotation flow. (See I2)
- **SSRF via `streamUrl` in test endpoint.** Mitigation: rate limit + RFC1918/loopback denylist. (See M7)
- **Quick Test endpoint as DoS vector.** A user can repeatedly upload 10 MB images and tie up the inference path. Mitigation: rate limit (e.g., 10/min/user) and reject if any active stream is on this user's models.
- **`thumb-ready` webhook race against detection insert.** Mitigation: key by snapshotKey, not detectionId; upsert. (See X1)
- **MinIO `MINIO_SERVER_URL` mismatch between docker-compose env and nginx server_name.** Mitigation: same value, set in one place via shared `.env` variable. Currently §6.1 has it hardcoded as `app.harvestpredictor.example` — make it `${PUBLIC_URL}`.
- **`prisma migrate dev` failure on first run** because of missing inverse relations / nullable userId backfill. (See C1, C2)

---

## Open questions in §15 — re-classification

§15 marks all 8 questions "non-blocking." Two are arguably blocking:

- **Q6 "Admin god mode"** — non-blocking technically, but the architecture decision to exclude admins from CV data (§1) interacts with the choice. If admin support tickets need to inspect a user's connection to debug, and there's no admin path, you have a hard-to-fix UX gap on day one. Decide *now*: either (a) admins literally cannot help with CV issues (document it, route to "delete and recreate"), or (b) admin gets a per-incident impersonation token. Don't punt.
- **Q7 "Webhook dedup edge cases"** — affects schema. If "same disease after 60s window" is "update existing," you need an upsert key (`(connectionId, className, roundedBbox)` unique index). If it's a new row, you need nothing. The dedup logic is in §4.4 but the open question contradicts it ("update the previous one" vs "create new Detection"). Resolve before implementing the webhook handler, or you'll rewrite it.

The other six (KB contributions, treatment priority, evidentiary archive, retina breakpoints, model isolation cache) are correctly non-blocking.

---

## Summary table

| Area | Status |
|---|---|
| Multi-tenancy | Mostly correct, but `Detection` lacks denormalized `userId` (C3) and §11 cleanup is wrong (I6) |
| Encryption | Master key sharing creates SPOF (I2); no key versioning; rotation flow undocumented |
| MinIO + nginx | Presign endpoint mismatch will 403 in production (I3); orphan object risk on delete (I4.3) |
| Stream lifecycle | Restart reconciliation missing (I4.1); double-start race (I4.2); delete-mid-stream orphans (I4.3) |
| Webhook auth | Static API key only — vulnerable to host-network attacker (I1); no nonce; no IP restriction |
| Schema migration | Will not run as written — missing inverse relations (C1); ambiguous backfill (C2) |
| Race conditions | Several unaddressed: thumb-ready/insert race (X1), double-start (I4.2), default uniqueness (I7) |
| Cross-section consistency | Webhook payload shapes underspecified (X3); userId routing to Python missing (X2); status semantics broken on restart (X5) |
| Failure modes in §13 | Missing 9 important risks (see "Recommended additions") |
| §15 open questions | Q6 and Q7 should be resolved before coding, not deferred |

---

## Recommendation

Spend half a day fixing C1-C3, I1-I4, and §11 (file list audit). Then start coding. The remaining items (M1-M10, X1-X6) can be addressed during implementation as long as someone tracks them.

The spec's high-level architecture is correct. The defects are in the joints — exactly where architecture validation is supposed to find them.
