# Detection Page — Value Analysis

Product strategy review of `/docs/specs/detection-page-spec.md`.
Evaluates each feature against real user value, MVP constraints, and the business pivot (Telegram bot first, platform second).

---

## 1. Who Is the User?

The spec conflates **three distinct users** onto one page:

| Persona | Context | Device | Technical Level |
|---------|---------|--------|-----------------|
| **Farmer (dekhqon)** | Standing in field, sick plant in hand | Phone (low-end Android, 3G) | Zero. Doesn't know what YOLO is |
| **Agronomist (consultant)** | Office/field, reviewing multiple farms | Laptop/tablet | Medium. Understands disease taxonomy |
| **Admin (you/team)** | Managing models, monitoring system | Desktop | High. Knows .pt/.onnx, confidence thresholds |

**Problem:** The spec puts model management, IP stream config, and photo upload on the SAME page. A farmer who just wants "what's wrong with my tomato?" is confronted with model dropdowns and RTSP URL fields.

**Verdict:** The spec serves the admin/developer, not the farmer. This is a toolbox, not a product.

---

## 2. Core Value Proposition

The only thing that matters:

> **"I have a sick plant photo. Tell me what's wrong and what to do about it."**

The spec gets this partially right (photo upload + detection results) but buries it under model management and streaming infrastructure.

### What the spec prioritizes vs what users need:

| Spec Priority | User Priority |
|---------------|---------------|
| Model selection dropdown | "Just use the best model" |
| Bounding box coordinates (normalized 0-1) | "Is my plant sick? Yes/No" |
| Processing time display | "What disease is it?" |
| Frame number per detection | **"What do I DO about it?"** |
| RTSP/RTMP URL input | **"Will it spread to other plants?"** |

**Critical gap:** The spec stops at detection. It never answers the farmer's actual question: **"Now what?"** There are zero treatment recommendations in the detection flow.

---

## 3. Model Management — User-Facing or Admin-Only?

**Verdict: Admin-only. Remove from detection page entirely.**

Reasons:
- Farmers don't know what `.pt` or `.onnx` means
- Model upload is a system administration task, not a detection workflow step
- Even agronomists don't need to pick models — they need accurate results
- The spec already says upload/delete is "admin only" — but still puts it on the main page

**Recommendation:**
- Move model management to `/dashboard/admin/models` (separate admin page)
- Detection page uses the "active" or "best" model automatically
- If multiple models exist (e.g., cotton vs wheat), use crop type from the user's farm/field context to auto-select — don't make the user choose

---

## 4. IP Stream — Phase 2 Feature

**Verdict: Cut from MVP. This is a different product for a different user.**

| Factor | Assessment |
|--------|------------|
| Target user | Security/monitoring operator, NOT farmer in field |
| Hardware required | IP camera + stable network + RTSP server |
| Uzbek farm reality | Most farms don't have reliable electricity, let alone IP cameras |
| Engineering cost | WebSocket infra, JPEG frame streaming, reconnection logic, FPS management |
| Business value for MVP | Zero. No farmer will set up RTSP to detect tomato blight |

**When it becomes relevant:**
- Phase 2+: Large agro-clusters with installed drone stations or greenhouse cameras
- B2B contracts where the customer already has camera infrastructure
- After the Telegram bot validates demand and proves disease detection accuracy

**Recommendation:** Remove entirely from MVP spec. Add to roadmap as "Continuous Monitoring Module" for B2B phase.

---

## 5. Detection History — Conditionally Valuable

**Question:** When does a farmer return to a 3-day-old detection?

### Scenarios where history IS useful:
1. Agronomist reviewing trends: "This field had Fusarium last week AND this week — escalating"
2. Comparing before/after treatment: "I applied Fundazol 5 days ago — is the disease receding?"
3. Seasonal pattern analysis: "Every March, spider mites appear in this zone"
4. Proof for insurance/government: "Here's documented evidence of crop disease"

### Scenarios where history is NOT useful:
1. One-off farmer check: "Is this plant sick?" — they won't come back
2. Raw detection list without context: 50 rows of "Fusarium, 87%, bbox: [0.2, 0.3, 0.8, 0.9]" means nothing

**Verdict: Keep history, but redesign it.**

Current spec: table with date, source type, model used, detections count, top finding.

**Better approach:**
- Show history as a timeline/feed, not a data table
- Group by field/location if available
- Show trend: "Fusarium detections increased 3x this week"
- Link detections to treatment recommendations: "You detected this. Here's what you did. Here's the result."
- For MVP: simple list with date + disease + confidence + photo thumbnail is enough

---

## 6. What's MISSING That Brings Real Value

### 6.1 Treatment Recommendations (CRITICAL)

The spec stops at "you have Fusarium." The farmer's next question is **always**: "What do I do?"

**Must-have for MVP:**
```
Disease: Fusarium wilt (Confidence: 92%)
Severity: Moderate

RECOMMENDED ACTION:
1. Apply Fundazol (Benomyl) 1.5 kg/ha within 3 days
2. Remove and burn affected plants immediately
3. Do not plant solanaceous crops in this area for 2 seasons
4. Re-check in 7 days

COST ESTIMATE: ~150,000 UZS per hectare
```

This is where the **KnowledgeBase** model (already in the Prisma schema design) becomes critical. Detection without recommendation is a diagnosis without a prescription — useless.

### 6.2 Severity Assessment

Not all detections are equal:
- Early-stage Fusarium on 1 plant = "monitor"
- Late-stage Fusarium on 20% of field = "emergency"

The spec shows confidence % but never translates it into actionable severity levels.

### 6.3 Uzbek Language Disease Names

Competitive advantage (per business pivot research). Farmers know local disease names, not Latin taxonomy:
- "Fuzarioz" not "Fusarium oxysporum"
- "O'rgimchak kana" not "Tetranychus urticae"

The i18n infrastructure exists (en.json, uz.json) — disease names and recommendations should be localized.

### 6.4 Offline Photo Queue

Uzbek farm reality: 3G is unreliable. Farmer takes 5 photos, has no signal.
- Queue photos locally
- Upload + detect when signal returns
- Show cached results from last detection

This is a Telegram bot advantage — Telegram handles offline queuing natively. For the web platform, this is Phase 2.

---

## 7. Batch Detection — Useful but Misframed

**Spec approach:** Upload 50 photos, get 50 individual detection results.
**Problem:** Nobody wants to review 50 individual bounding box results.

**What's actually useful:**

### Summary/Aggregation View:
```
Batch: Drone flight 2026-03-28, Cotton Field #3
Total images: 47
Healthy: 31 (66%)
Diseased: 16 (34%)
  - Fusarium: 9 images (19%)
  - Spider mites: 5 images (11%)
  - Aphids: 2 images (4%)

OVERALL ASSESSMENT: Moderate Fusarium infestation, concentrated in SE quadrant
PRIORITY: High — treat within 5 days
```

### For MVP:
- Single photo detection = primary flow (90% of use)
- Batch = "nice to have" with summary view, not raw list
- If building batch, invest in aggregation/summary, not in displaying 50 individual results

---

## 8. Confidence Threshold UX

### Current spec: Shows all detections with confidence %

### Recommendation: Tiered display

| Confidence | Display | Action |
|------------|---------|--------|
| 90-100% | Full result with treatment recommendation | "Confirmed: Fusarium. Apply treatment." |
| 70-89% | Result with advisory note | "Likely Fusarium. Verify with closer photo." |
| 50-69% | Warning with suggestion | "Possible issue detected. Take a clearer photo." |
| <50% | Hidden by default | Only shown in "detailed view" for agronomists |

**Why hide <50%:** A farmer seeing "Maybe Fusarium (34%)" will either panic unnecessarily or lose trust in the system. Low-confidence results create more confusion than value.

**For agronomists/admins:** Add a toggle "Show all detections" that reveals low-confidence results.

---

## 9. Feature Priority Matrix

| Feature | Value | Effort | MVP? | Verdict |
|---------|-------|--------|------|---------|
| Single photo detection | HIGH | Low | YES | Core flow |
| Treatment recommendations | HIGH | Medium | YES | Differentiator |
| Disease info (Knowledge Base) | HIGH | Low | YES | Already designed in schema |
| Confidence tiers | MEDIUM | Low | YES | Better UX |
| Detection history (simple) | MEDIUM | Low | YES | Timeline, not table |
| Batch summary/aggregation | MEDIUM | Medium | Phase 1.5 | After single photo works |
| Model auto-selection | MEDIUM | Low | YES | Based on crop type |
| Uzbek disease names | HIGH | Low | YES | Competitive advantage |
| Video file processing | LOW | High | NO | Cut |
| IP Stream | LOW | Very High | NO | Phase 2+ B2B |
| Model management UI | LOW (for users) | Medium | ADMIN ONLY | Separate page |
| Bounding box display | LOW | Medium | OPTIONAL | Farmers don't need bbox |
| FPS counter | ZERO | Low | NO | Developer vanity |

---

## 10. Summary: Recommended MVP Detection Page

### Keep:
1. **Photo upload** (single image, drag-and-drop)
2. **Detection results** with disease name, confidence tier, severity
3. **Treatment recommendation** linked to each detection
4. **Simple history** as timeline/feed
5. **Auto model selection** (hide model management from users)
6. **Uzbek language** disease names and recommendations

### Cut:
1. **Video file processing** — high effort, low MVP value
2. **IP stream** — different user, different product
3. **Model management on detection page** — move to admin
4. **Raw bounding box coordinates** — farmers don't need this
5. **FPS counter, frame numbers** — developer metrics, not user value
6. **Batch as raw list** — if batch exists, show summary only

### Add (missing from spec):
1. **Treatment recommendations** — the single most valuable missing feature
2. **Severity assessment** — translate confidence into actionable levels
3. **"Take a better photo" guidance** — when detection is uncertain
4. **Crop context** — auto-link detection to user's farm/field/crop

### Redesign:
1. **History** — from data table to contextual timeline
2. **Results display** — from technical (bbox, processing time) to actionable (disease, severity, treatment)
3. **Page structure** — from "toolbox with everything" to "simple flow: upload -> result -> action"

---

## 11. Alignment with Business Pivot

The business pivot says: **MVP = Telegram bot, platform = Phase 2+.**

This means the detection page on the Nuxt platform should:
1. Be the **admin/agronomist interface**, not the farmer-facing product
2. Support the Telegram bot backend (same API, different frontend)
3. Focus on **agronomist workflow**: review detections from bot, add expert recommendations, train models

The farmer gets the Telegram bot. The agronomist gets the web platform. The admin gets model management. **Three interfaces, one backend, three different UX priorities.**
