# Detection Page — Security Analysis

**Date:** 2026-03-29
**Scope:** `/dashboard/cv/detection` feature as described in `docs/specs/detection-page-spec.md`
**Severity scale:** CRITICAL > HIGH > MEDIUM > LOW > INFO

---

## 1. Model Upload = Remote Code Execution (CRITICAL)

### The Problem

PyTorch `.pt` files use Python's `pickle` serialization. **Loading a `.pt` file executes arbitrary Python code.** This is not a bug — it is by design. An attacker who uploads a crafted `.pt` file gets full code execution on the CV service server.

### Recent CVEs Confirming This

| CVE | CVSS | Description |
|-----|------|-------------|
| [CVE-2025-32434](https://github.com/advisories/GHSA-53q9-r3pm-6pq6) | 9.3 | `torch.load` with `weights_only=True` bypassed — RCE on PyTorch < 2.6.0 |
| [CVE-2026-24747](https://securityonline.info/safety-broken-pytorch-safe-mode-bypassed-by-critical-rce-flaw/) | 8.8 | Even the patched `weights_only=True` unpickler bypassed again via memory corruption |
| [CVE-2025-33244](https://www.thehackerwire.com/nvidia-apex-deserialization-rce-cve-2025-33244/) | 9.0 | NVIDIA APEX deserialization RCE — same class of vulnerability |

Additionally, [JFrog discovered 3 zero-day bypasses in PickleScan](https://jfrog.com/blog/unveiling-3-zero-day-vulnerabilities-in-picklescan/), the industry-standard tool for scanning `.pt` files for malware. **Scanning is not a reliable defense.**

### Impact

- Full Remote Code Execution on the CV service container
- Data exfiltration (database credentials, API keys, uploaded images)
- Lateral movement to other services on the network
- Cryptominer installation, backdoor persistence

### Recommended Mitigations

| Mitigation | Effectiveness | Effort |
|------------|---------------|--------|
| **ONNX-only policy** — reject `.pt` files entirely, accept only `.onnx` | **Best** | Medium |
| **Safetensors-only** — use Hugging Face safetensors format (cannot execute code by design) | **Best** | Medium |
| **Container sandbox** — run model loading in a disposable, network-isolated container with no disk persistence | Good | High |
| **gVisor/Firecracker** — use a micro-VM for model loading | Good | High |
| **PickleScan** — scan before loading | **Insufficient alone** (bypasses exist) | Low |
| **Virus scan (ClamAV)** — scan uploaded files | Catches known malware only, not custom payloads | Low |

**Recommendation for this project:** **ONNX-only policy.** The spec already mentions `.pt/.onnx` — restrict to `.onnx` only. ONNX files contain a computation graph (protobuf) and tensor data — no arbitrary code execution. If `.pt` support is required, load it inside a disposable Docker container with:
- No network access (`--network=none`)
- Read-only filesystem
- 60-second timeout
- Memory limit (2GB)
- Dropped capabilities (`--cap-drop=ALL`)

---

## 2. File Upload Attacks (HIGH)

### Attack Vectors

#### 2a. Path Traversal via Filename

A filename like `../../../etc/cron.d/backdoor` can write outside the upload directory, overwriting system files.

**Mitigation:**
- **Never use user-supplied filenames.** Generate a UUID: `{uuid4()}.{validated_extension}`
- Strip all path separators before any processing
- Validate the final resolved path is within the expected directory (`os.path.commonpath()`)

#### 2b. Zip Bombs (for video/archive uploads)

A 42KB zip file can expand to 4.5 petabytes, causing disk exhaustion and DoS.

**Mitigation:**
- Do not accept archive formats (ZIP, TAR, RAR) — only raw image/video files
- If video processing extracts frames, monitor decompressed size with a streaming limit
- Set max file size at the reverse proxy level (nginx: `client_max_body_size`)

#### 2c. Polyglot Files

A file can be simultaneously a valid JPEG and contain embedded JavaScript/PHP/Python. If served back to users, this enables XSS or code execution.

**Mitigation:**
- Validate magic bytes (file header), not just extension: JPEG = `FF D8 FF`, PNG = `89 50 4E 47`
- Use `python-magic` (libmagic) for server-side validation
- Use `file-type` npm package for Node.js validation
- Strip EXIF metadata from images before processing (`Pillow` — `image.getexif().clear()`)
- Never serve uploaded files directly — always re-encode images before returning results

#### 2d. EXIF Injection

EXIF metadata in JPEG files can contain malicious payloads, XSS strings, or SQL injection attempts.

**Mitigation:**
- Strip all EXIF/metadata on upload using Pillow or ExifTool
- Never render raw EXIF data in HTML without sanitization

### Recommended Validation Pipeline

```
1. Check Content-Type header (informational only — easily spoofed)
2. Check file extension against allowlist (jpg, jpeg, png, mp4, avi, mov)
3. Validate magic bytes match expected format
4. Check file size < configured maximum (20MB images, 500MB video)
5. Generate UUID filename, discard original name
6. Strip EXIF metadata
7. Re-encode image (prevents polyglot attacks)
8. Store in isolated temp directory with restricted permissions (0600)
```

---

## 3. RTSP/RTMP URL Injection — SSRF (HIGH)

### The Problem

The spec allows users to enter RTSP/RTMP stream URLs. The CV service then connects to these URLs. An attacker can provide:

- `rtsp://169.254.169.254/latest/meta-data/` — access AWS metadata service
- `rtsp://10.0.0.1:5432/` — port scan internal PostgreSQL
- `rtsp://internal-service:8080/admin/delete-all` — hit internal APIs
- `http://localhost:8100/api/admin/...` — attack the CV service itself
- `file:///etc/passwd` — read local files (if the RTSP library supports file:// scheme)

[SonicWall's 2025 report](https://www.wiz.io/academy/application-security/server-side-request-forgery) documents a **452% increase in SSRF attacks** from 2023 to 2024.

### Recommended Mitigations

| Control | Description |
|---------|-------------|
| **Protocol allowlist** | Only allow `rtsp://` and `rtmp://` schemes — reject http, https, file, ftp, gopher, dict |
| **IP blocklist** | Block RFC1918 private ranges (10.x, 172.16-31.x, 192.168.x), loopback (127.x), link-local (169.254.x), and IPv6 equivalents |
| **DNS resolution check** | Resolve hostname before connecting — verify resolved IP is not in blocked ranges (prevents DNS rebinding) |
| **Network isolation** | Run stream processing in a container with no access to internal services — only egress to the internet |
| **Connection timeout** | 10-second connection timeout, 5-minute max session duration |
| **Rate limit** | Max 1 active stream per user, max 3 stream starts per hour |
| **URL validation regex** | `^rtsp://[a-zA-Z0-9.-]+(:\d{1,5})?/.*$` — reject URLs with `@`, encoded characters, or authentication credentials |

### Implementation Example (Python)

```python
import ipaddress
import socket

BLOCKED_NETWORKS = [
    ipaddress.ip_network('10.0.0.0/8'),
    ipaddress.ip_network('172.16.0.0/12'),
    ipaddress.ip_network('192.168.0.0/16'),
    ipaddress.ip_network('127.0.0.0/8'),
    ipaddress.ip_network('169.254.0.0/16'),
    ipaddress.ip_network('0.0.0.0/8'),
]

def validate_stream_url(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in ('rtsp', 'rtmp'):
        raise ValueError("Only RTSP/RTMP protocols allowed")
    if parsed.username or parsed.password:
        raise ValueError("Credentials in URL not allowed")
    # Resolve DNS and check IP
    ip = socket.gethostbyname(parsed.hostname)
    addr = ipaddress.ip_address(ip)
    for network in BLOCKED_NETWORKS:
        if addr in network:
            raise ValueError(f"Connection to private network blocked")
    return True
```

---

## 4. Authentication & Authorization Gaps (HIGH)

### Current State

- `nuxt-auth-utils` provides session-based auth
- User roles: `farmer` (default), `admin`
- Spec says model upload/delete is "admin only" — but no middleware enforces this on the CV API proxy routes

### Required Access Control Matrix

| Action | farmer | admin | Unauthenticated |
|--------|--------|-------|-----------------|
| List models | Read | Read | Deny |
| Upload model | Deny | Allow | Deny |
| Delete model | Deny | Allow | Deny |
| Run detection (photo) | Allow (own quota) | Allow | Deny |
| Run detection (video) | Allow (own quota) | Allow | Deny |
| Start stream | Allow (own quota) | Allow | Deny |
| View own history | Allow | Allow | Deny |
| View all history | Deny | Allow | Deny |
| Delete history | Own only | All | Deny |

### Gaps to Address

1. **CV service has no auth** — it is a separate FastAPI service. The Nuxt API proxy must authenticate before forwarding. The CV service should accept requests only from the Nuxt backend (API key + IP allowlist).
2. **No per-user quotas** — a farmer can run unlimited detections, exhausting GPU resources.
3. **No ownership check on history** — without filtering by `userId`, users could see others' detection results.
4. **Model upload has no admin check** — the spec says "admin only" but `requireAdmin` utility must be called in every model management endpoint.

### Implementation Requirements

```typescript
// Every CV API route must start with:
const { user } = await requireUserSession(event)

// Admin-only routes additionally:
requireAdmin(user)

// Ownership check on history queries:
where: { userId: user.id }
```

The CV service (FastAPI) must validate an API key on every request:

```python
CV_API_KEY = os.environ["CV_API_KEY"]

@app.middleware("http")
async def verify_api_key(request: Request, call_next):
    if request.headers.get("X-API-Key") != CV_API_KEY:
        return JSONResponse(status_code=403, content={"error": "Invalid API key"})
    return await call_next(request)
```

---

## 5. Rate Limiting & GPU DoS (HIGH)

### The Problem

Without rate limiting, an attacker (or a legitimate user with a script) can:
- Upload 1000 high-resolution images simultaneously — exhaust GPU memory, crash the service
- Start dozens of video processing jobs — each holds GPU memory for minutes
- Open multiple RTSP streams — each consumes a persistent GPU allocation

### Recommended Limits

| Resource | Limit | Scope |
|----------|-------|-------|
| Photo detection | 30 requests/minute | Per user |
| Batch upload | 10 images per batch, 5 batches/hour | Per user |
| Video upload | 1 concurrent, 5/day | Per user |
| Stream connection | 1 concurrent, 3 starts/hour | Per user |
| Model upload | 3/day | Per admin |
| Max concurrent GPU jobs | 4 total | Global |
| Request body size | 20MB (images), 500MB (video) | Global |

### Implementation

**Nuxt API layer** (first line of defense):
- Use `h3` event handler with in-memory rate counter per `userId`
- Reject before proxying to CV service

**FastAPI layer** (second line):
- Use [SlowAPI](https://pypi.org/project/slowapi/) or [FastAPI-Limiter](https://pypi.org/project/fastapi-limiter/) with Redis backend
- GPU job queue with max concurrency (e.g., `asyncio.Semaphore(4)`)
- Auto-kill jobs exceeding timeout (60s for images, 300s for video, 600s for streams)

**Infrastructure layer** (third line):
- nginx: `client_max_body_size 500m;` and `limit_req_zone`
- Docker: `--memory=4g --gpus '"device=0"'` to prevent GPU memory exhaustion

---

## 6. Data Deletion & Temp File Security (MEDIUM)

### The Problem

The spec says "Process -> return result -> delete file." But:
- If the process crashes mid-detection, temp files remain on disk
- Standard `fs.unlink()` / `os.remove()` doesn't overwrite data — it just removes the directory entry
- On SSDs, `shred` is ineffective due to wear leveling
- Temp files in `/tmp` may be on persistent storage, surviving reboots

### Recommended Approach

| Measure | Purpose |
|---------|---------|
| **Use tmpfs mount** | Files stored only in RAM — gone on unmount/reboot, never written to disk |
| **try/finally cleanup** | Always delete in a `finally` block, even on exceptions |
| **Periodic cleanup cron** | Delete all files in upload dir older than 1 hour |
| **Docker tmpfs volume** | `--tmpfs /app/uploads:rw,noexec,nosuid,size=2g` |
| **Annotated crops: scheduled deletion** | Spec says 72-hour retention — use a cron job or Prisma middleware to enforce |

### Implementation

```python
import tempfile
import os

async def process_detection(file_data: bytes):
    # Use tmpfs-backed directory
    with tempfile.NamedTemporaryFile(
        dir="/dev/shm",  # RAM-backed on Linux
        suffix=".jpg",
        delete=True  # Auto-delete on close
    ) as tmp:
        tmp.write(file_data)
        tmp.flush()
        result = await run_yolo_detection(tmp.name)
    # File is automatically deleted here
    return result
```

Docker Compose config:
```yaml
cv-service:
  tmpfs:
    - /app/uploads:rw,noexec,nosuid,size=2g
```

### Annotated Crops Cleanup

```sql
-- Run daily via cron or pg_cron
DELETE FROM detection_crops WHERE created_at < NOW() - INTERVAL '72 hours';
```

---

## 7. WebSocket Security (MEDIUM)

### Attack Vectors

#### 7a. Cross-Site WebSocket Hijacking (CSWSH)

If the WebSocket handshake relies only on cookies, any website can open a WS connection to the server and read detection results in real-time.

**Mitigation:**
- Validate `Origin` header against an explicit allowlist during handshake
- Require a CSRF token or short-lived ticket in the WS connection URL
- Use the ticket pattern: HTTP request to get a one-time token -> connect WS with token in query string -> server validates and invalidates the token

#### 7b. Token Hijacking in Query String

If the auth token is passed as `?token=xxx` in the WS URL, it appears in:
- Server access logs
- Browser history
- Referrer headers
- Proxy logs

**Mitigation:**
- Use short-lived tickets (30-second TTL, single-use)
- Generate ticket via authenticated HTTP endpoint, not reusing the session token
- After WS connection established, invalidate the ticket immediately

#### 7c. Message Injection

Without input validation on WS messages, an attacker could send malformed commands to the stream processor.

**Mitigation:**
- Define a strict JSON schema for WS messages (e.g., only `{"action": "start"|"stop"|"config", ...}`)
- Validate every incoming message against the schema
- Reject and close connection on invalid messages (max 3 violations)

#### 7d. Resource Exhaustion via WS

An attacker opens hundreds of WS connections without sending data, exhausting server resources.

**Mitigation:**
- Max 2 WS connections per user
- Idle timeout: close connections with no activity for 60 seconds
- Max message size: 1KB (control messages only — frames are server-to-client)

### Implementation

```typescript
// Nuxt server WebSocket handler
export default defineWebSocketHandler({
  open(peer) {
    // Validate Origin header
    const origin = peer.request?.headers.get('origin')
    if (!ALLOWED_ORIGINS.includes(origin)) {
      peer.close(4003, 'Origin not allowed')
      return
    }
    // Validate one-time ticket from query string
    const url = new URL(peer.request?.url, 'http://localhost')
    const ticket = url.searchParams.get('ticket')
    if (!validateAndConsumeTicket(ticket)) {
      peer.close(4001, 'Invalid ticket')
      return
    }
  }
})
```

---

## 8. Model File Validation (MEDIUM)

### The Problem

Even with ONNX-only policy, an attacker could upload:
- A `.onnx` file that is actually a different format (renamed `.exe`)
- A corrupted ONNX file designed to crash the parser (fuzzing attack)
- An ONNX file with extremely large tensor dimensions (memory bomb)
- A file with embedded metadata containing XSS payloads

### Validation Pipeline

```
1. Check file extension (.onnx only)
2. Validate ONNX magic bytes (first bytes should match protobuf/ONNX signature)
3. Parse with onnx.load() in a sandboxed subprocess with memory limit
4. Validate model metadata:
   - Input/output shapes are reasonable (no dimension > 10000)
   - Total parameter count < configured maximum (e.g., 500M params)
   - opset_version is supported
5. Verify model can run inference on a test image (1x3x640x640 zeros)
6. Store with generated UUID name, record original name in database only
7. Calculate and store SHA-256 hash for integrity verification
```

### Implementation (Python)

```python
import onnx
import onnxruntime
import hashlib

MAX_MODEL_SIZE = 500 * 1024 * 1024  # 500MB
MAX_PARAMS = 500_000_000

def validate_onnx_model(file_path: str) -> dict:
    # Size check
    size = os.path.getsize(file_path)
    if size > MAX_MODEL_SIZE:
        raise ValueError(f"Model too large: {size} bytes")

    # Parse ONNX
    model = onnx.load(file_path)
    onnx.checker.check_model(model)

    # Validate shapes
    for tensor in model.graph.initializer:
        for dim in tensor.dims:
            if dim > 10000:
                raise ValueError(f"Suspicious tensor dimension: {dim}")

    # Count parameters
    total_params = sum(
        np.prod(t.dims) for t in model.graph.initializer
    )
    if total_params > MAX_PARAMS:
        raise ValueError(f"Too many parameters: {total_params}")

    # Test inference
    session = onnxruntime.InferenceSession(file_path)
    test_input = np.zeros((1, 3, 640, 640), dtype=np.float32)
    session.run(None, {session.get_inputs()[0].name: test_input})

    # Compute hash
    sha256 = hashlib.sha256()
    with open(file_path, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            sha256.update(chunk)

    return {
        "opset": model.opset_import[0].version,
        "params": total_params,
        "hash": sha256.hexdigest()
    }
```

---

## Summary: Risk Matrix

| # | Risk | Severity | Likelihood | Mitigation Effort |
|---|------|----------|------------|-------------------|
| 1 | Model upload RCE via pickle | **CRITICAL** | High | Medium (ONNX-only) |
| 2 | File upload attacks (path traversal, polyglot) | **HIGH** | High | Low |
| 3 | RTSP/RTMP SSRF | **HIGH** | Medium | Medium |
| 4 | Authentication/authorization gaps | **HIGH** | High | Low |
| 5 | GPU DoS via unlimited requests | **HIGH** | Medium | Medium |
| 6 | Insecure temp file handling | **MEDIUM** | Low | Low |
| 7 | WebSocket hijacking/abuse | **MEDIUM** | Medium | Medium |
| 8 | Malicious ONNX model | **MEDIUM** | Low | Medium |

---

## Top 5 Actions (Ordered by Priority)

1. **ONNX-only model policy** — completely eliminates the CRITICAL RCE risk. No `.pt` files ever.
2. **Auth on every CV endpoint** — `requireUserSession` + `requireAdmin` + ownership checks. Non-negotiable.
3. **SSRF protection for stream URLs** — protocol allowlist + IP blocklist + DNS resolution check.
4. **File upload validation pipeline** — UUID filenames, magic byte validation, EXIF stripping, size limits.
5. **Rate limiting at both layers** — Nuxt API (per-user) + FastAPI (global GPU concurrency).

---

## Sources

- [CVE-2025-32434 — PyTorch weights_only RCE](https://github.com/advisories/GHSA-53q9-r3pm-6pq6)
- [CVE-2026-24747 — PyTorch Safe Mode Bypass](https://securityonline.info/safety-broken-pytorch-safe-mode-bypassed-by-critical-rce-flaw/)
- [JFrog — 3 Zero-Day PickleScan Vulnerabilities](https://jfrog.com/blog/unveiling-3-zero-day-vulnerabilities-in-picklescan/)
- [Sonatype — 4 Critical PickleScan Vulnerabilities](https://www.sonatype.com/blog/bypassing-picklescan-sonatype-discovers-four-vulnerabilities)
- [Rapid7 — From .pth to p0wned](https://www.rapid7.com/blog/post/from-pth-to-p0wned-abuse-of-pickle-files-in-ai-model-supply-chains/)
- [OWASP — SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP — File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [OWASP — WebSocket Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)
- [PortSwigger — Cross-site WebSocket Hijacking](https://portswigger.net/web-security/websockets/cross-site-websocket-hijacking)
- [Safetensors vs Pickle — Security Revolution](https://notes.suhaib.in/docs/tech/latest/safetensors-vs-pickle-the-security-revolution-shaping-machine-learning/)
- [NEDNEX — AI Model Formats 2026](https://nednex.com/en/what-are-safetensors/)
- [FastAPI Rate Limiting Strategies](https://dev.turmansolutions.ai/2025/07/11/rate-limiting-strategies-in-fastapi-protecting-your-api-from-abuse/)
- [WebSocket Security Guide](https://websocket.org/guides/security/)
