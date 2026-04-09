# Detection Page UX Analysis

## Spec Under Review

`/dashboard/cv/detection` — single page combining model management, 3 input sources (photo/video/IP stream), detection results, and detection history.

---

## 1. One Page — Too Much?

**Verdict: Yes, it is information overload in the current layout.**

The spec puts 4 distinct functional zones on one page:
1. Model management (list, upload, delete, select)
2. Input source (photo / video / IP stream)
3. Detection results (real-time)
4. Detection history (table with filters)

### Why this is a problem

- **Cognitive load**: dashboard UX best practices recommend no more than 5-6 cards in the initial view. This page has 4 major sections, each with sub-controls, easily exceeding that threshold.
- **Mixed user intents**: a farmer uploading a photo has a fundamentally different mindset from an admin uploading a new model. Mixing these on one page creates noise for both.
- **Progressive disclosure violation**: everything is shown upfront instead of revealing complexity as needed.

### Recommendation

Split into a **tabbed layout** with 3 tabs:

| Tab | Content | Primary User |
|-----|---------|--------------|
| **Detect** | Source selector + upload zone + results | Farmer |
| **History** | Detection history table with filters | Farmer / Agronomist |
| **Models** | Model CRUD (admin-only) | Admin |

**Why tabs, not separate pages:**
- Tabs keep context (user stays on `/detection`)
- Tabs reduce navigation depth (farmers are not power users)
- Tab switching is faster than page navigation
- The "Models" tab can be hidden for non-admin users, reducing clutter further

**Alternative: keep single page but use collapsible sections** with only the Detect section expanded by default. History and Models collapsed. This is simpler to implement but less clean.

---

## 2. User Flow Friction

### Current flow (from spec)

```
Open page → See models section → Scroll to source tabs →
Select source type → Upload photo → Wait → See results → (scroll to history?)
```

**Minimum clicks from "I have a photo" to "I see the disease":**

| Step | Action | Friction |
|------|--------|----------|
| 1 | Navigate to /dashboard/cv/detection | Low |
| 2 | Select model from dropdown | **Medium** — requires knowledge of which model to pick |
| 3 | Click "Photo" tab | Low (if photo is default) |
| 4 | Drag/drop or click to upload | Low |
| 5 | View results | Automatic |

**Total: 3-4 clicks** (acceptable), but step 2 is a friction point.

### Ideal flow (proposed)

```
Open page → Drop photo → See results
```

**How to achieve 1-click detection:**
- Auto-select the most recent / default model (skip step 2 for most users)
- Make photo upload the default source (most common use case)
- Show the drop zone prominently on page load
- Auto-detect starts immediately after upload completes

**Critical: the drop zone must be the hero element**, not buried under model management UI.

---

## 3. Model Selection UX

**Verdict: Auto-select by default, allow manual override.**

### Problem with current spec
- The spec shows model selection as a dropdown above the source area
- Farmers don't know what "YOLOv8-cotton-disease-v3.pt" means
- Forcing model selection before detection adds friction and confusion

### Recommendation: Smart defaults with override

**For farmers (non-admin):**
- System auto-selects the best model based on:
  1. User's crop type (from their Farm/Field data in the system)
  2. Most recently deployed model
  3. Default model flagged by admin
- Show a small "Model: Cotton Disease v3" label (not a dropdown)
- Add "Change model" link that expands to a dropdown if needed

**For admins:**
- Show full dropdown with model details (name, version, accuracy, date)
- Allow setting a "default model" per crop type

**UX research supports this**: auto-selection users reach peak productivity by day 3, while manual selection users take 6-7 days. For farmers who are not ML practitioners, manual model selection is pure noise.

---

## 4. History Usefulness

**Verdict: Useful, but only if designed for actionable insights, not raw data.**

### Who actually uses history?

| User | Use Case | Frequency |
|------|----------|-----------|
| Farmer | "Did I check this field already?" | Occasional |
| Agronomist | "Show me the disease trend over the season" | Weekly |
| Farm manager | "How many infected plants across all fields?" | Weekly |
| Admin | "How often is each model used?" | Monthly |

### What makes history useful

- **Timeline view** (not just a table) — shows disease progression over time
- **Field/location grouping** — "all detections from Field #3"
- **Trend indicators** — "rust increased 40% this week"
- **Quick actions** — "re-run this detection with a newer model"

### What makes history useless

- Raw table with ID, timestamp, className, confidence — this is engineering data
- No filtering by field, crop, or severity
- No visual thumbnails (the spec says crops are deleted after 72h)
- No aggregation or summary

### Recommendation

- Keep history, but design it as an **insights feed**, not a database dump
- Group by detection session, show summary card per session
- Include severity-based color coding (green/yellow/red)
- Move detailed analytics to a separate "Analytics" page (the existing UNDERSTAND page)
- The 72-hour crop image retention is good — but show a "No image available" placeholder after expiry, don't break the layout

---

## 5. Mobile Consideration

**Verdict: The current spec layout will break badly on mobile.**

### Problems

1. **Side-by-side layout** (upload zone | results) doesn't fit on mobile
2. **Drag-and-drop** doesn't work naturally on mobile (camera is the primary input)
3. **History table** with 5 columns won't render on 375px screens
4. **Stream viewer** with WebSocket — heavy on mobile data plans and battery
5. **Model management** UI with upload/delete — complex for touch interactions

### Farmer reality check

Agricultural app UX research emphasizes:
- Farmers primarily use smartphones in the field
- Large touch targets are essential (gloves, sunlight, dirty screens)
- Offline capability is critical (poor connectivity in rural areas)
- Visual-first, icon-driven interfaces outperform text-heavy ones

### Recommendations

**Mobile-first redesign:**
1. **Primary action = camera**: on mobile, replace drag-and-drop with a prominent "Take Photo" button using device camera
2. **Stack layout**: upload zone on top, results below (vertical scroll)
3. **History as cards**: replace table with card-based layout on mobile
4. **Hide stream tab on mobile**: IP stream is a desktop/monitoring feature, not a field tool
5. **Simplified model display**: just show the active model name, no dropdown on mobile
6. **Offline queue**: allow photos to be queued when offline, process when connected

**Critical metric**: a farmer in a field with muddy hands, bright sunlight, and 3G should be able to photograph a leaf and get a result in under 10 seconds of interaction time.

---

## 6. Empty States

**Verdict: The spec doesn't address empty states at all. This is a major UX gap.**

### Scenarios

#### Zero models uploaded (first-time admin)
**Current**: blank model list, detection won't work
**Should show**:
- Illustration + "No detection models yet"
- "Upload your first model" button (for admin)
- Brief explanation: "Models are AI files (.pt or .onnx) trained to detect crop diseases"
- Link to documentation or a sample model

#### Zero models (farmer view)
**Current**: nothing to select, page is useless
**Should show**:
- "Detection is not yet configured"
- "Contact your administrator to set up disease detection"
- No technical jargon about models

#### Zero detection history
**Current**: empty table
**Should show**:
- Illustration + "No detections yet"
- "Upload your first photo to detect crop diseases"
- Arrow pointing to the upload zone
- Optional: sample image to try detection ("Try with this sample")

#### After clearing history
- "No detections match your filters" (if filters are active)
- "Clear filters" button

### Best practices applied
- Empty states should nudge users toward the action that will populate the screen
- Use illustrations or icons to set a welcoming tone
- Include a single, clear call-to-action
- Explain what will appear here once the user takes action

---

## 7. Error States

**Verdict: The spec mentions no error handling. This is a critical gap.**

### Error scenarios and recommendations

| Error | User Impact | UX Pattern |
|-------|-------------|------------|
| **Detection fails** (CV service down) | Photo uploaded but no result | Show inline error: "Detection service is temporarily unavailable. Your photo was not stored. Please try again in a few minutes." + Retry button |
| **Model not found** | Selected model was deleted | Auto-fallback to default model. Toast notification: "The selected model is no longer available. Using [Default Model]." |
| **Stream disconnects** | Live view freezes | Overlay on stream: "Connection lost. Reconnecting..." + auto-reconnect with exponential backoff. After 3 failures: "Unable to connect to stream. Check the URL and try again." |
| **Video too large** (>500MB) | Upload rejected | Pre-upload validation: show file size before upload. "This file is 750MB. Maximum is 500MB. Try trimming the video or reducing resolution." |
| **Unsupported format** | Upload rejected | Immediate toast: "This file format is not supported. Use JPG, PNG for photos or MP4, AVI, MOV for video." |
| **Batch upload partial failure** | Some photos fail, some succeed | Show per-file status (green checkmark / red X). Summary: "45 of 50 photos processed. 5 failed." + option to retry failed ones |
| **Network timeout** | Upload stuck | Progress bar shows stalled state after 30s. "Upload seems slow. Check your connection." + Cancel button |
| **No GPU / model loading slow** | Long wait | Loading skeleton + "Preparing detection model... This may take up to 30 seconds on first run." |

### Error handling principles

1. **Never lose user data silently** — if a photo fails to process, tell the user immediately
2. **Offer recovery actions** — Retry, Try different model, Cancel
3. **Use progressive severity** — toast for minor issues, inline alert for blockers, modal for data loss risk
4. **Circuit breaker for stream** — if CV service is down, disable stream tab with explanation rather than letting user start a stream that will immediately fail
5. **Validate before upload** — check file size, format, and model availability client-side before sending to server

---

## 8. Batch Upload UX

**Verdict: The spec mentions "batch upload" but provides no UX details. This needs careful design.**

### The batch upload challenge

Uploading 50 drone photos is a real agricultural use case. The current spec says "single and batch upload" but doesn't specify how results are displayed.

### Proposed UX flow

#### Upload phase
1. User drops 50 photos into the drop zone
2. Show **upload queue** with thumbnails:
   - File name, size, thumbnail preview
   - Individual progress bar per file
   - Overall progress: "Uploading 12 / 50..."
   - Cancel individual or cancel all
3. **Parallel upload** — process 3-5 images simultaneously, not sequentially

#### Processing phase
1. After upload, show **detection queue**:
   - "Processing 5 / 50..."
   - Per-image: spinner → checkmark/X
   - Running statistics: "Found: 23 Rust, 8 Blight, 12 Healthy"
2. **Stream results as they come** — don't wait for all 50 to finish

#### Results phase
1. **Summary card** at top:
   - Total images processed: 50
   - Total detections: 43
   - Breakdown by category: Disease (31), Pest (8), Weed (4)
   - Processing time: 2m 14s
2. **Grid view** of all images with overlay badges:
   - Green border = healthy
   - Red border = disease detected
   - Yellow border = uncertain (low confidence)
3. **Click any image** to expand and see detailed detections (bounding boxes, class names, confidence scores)
4. **Filter/sort results**: by severity, by disease type, by confidence

### Performance considerations
- Don't render 50 high-res images simultaneously — use thumbnails + lazy loading
- Paginate or virtual-scroll if >20 results visible
- Keep the page responsive during processing (web worker or requestAnimationFrame)
- Consider a "Download Report" button for batch results (CSV/PDF)

---

## Summary of Recommendations

### Must-fix (before implementation)

1. **Split into tabs** (Detect / History / Models) to reduce cognitive load
2. **Auto-select model** based on crop type — don't force farmers to choose ML models
3. **Design all empty states** — first-time UX is the first impression
4. **Define error states** for every failure mode — silent failures erode trust
5. **Make photo upload the hero element** — biggest touch target, front and center

### Should-fix (high impact)

6. **Mobile-first layout** — stack vertically, add "Take Photo" button, hide stream on mobile
7. **Batch upload UX** — progress indicators, streaming results, summary card
8. **History as insight feed** — not a raw database table

### Nice-to-have (polish)

9. **Offline photo queue** for field use with poor connectivity
10. **Sample image** for first-time users to try detection immediately
11. **Keyboard shortcuts** for power users (Ctrl+V to paste screenshot)
12. **"Quick detect" mode** — paste/drop anywhere on the page, skip all UI

---

## Sources

- [A UI/UX Guide to Agriculture App Design | Gapsy](https://gapsystudio.com/blog/agriculture-app-design/)
- [From Seed to Screen: UX in Agriculture | f1studioz](https://f1studioz.com/blog/from-seed-to-screen-ux-in-agriculture/)
- [Best Agriculture App Designs of 2026 | DesignRush](https://www.designrush.com/best-designs/apps/agriculture)
- [Tabs UX: Best Practices | Eleken](https://www.eleken.co/blog-posts/tabs-ux)
- [Dashboard UX: Best Practices (2026) | DesignRush](https://www.designrush.com/agency/ui-ux-design/dashboard/trends/dashboard-ux)
- [Effective Dashboard UX: Design Principles | Excited Agency](https://excited.agency/blog/dashboard-ux-design)
- [File Uploader UX Best Practices | Uploadcare](https://uploadcare.com/blog/file-uploader-ux-best-practices/)
- [File Upload UI Tips | Eleken](https://www.eleken.co/blog-posts/file-upload-ui)
- [Empty State UX Examples | Eleken](https://www.eleken.co/blog-posts/empty-state-ux)
- [Empty States — The Most Overlooked Aspect of UX | Toptal](https://www.toptal.com/designers/ux/empty-state-ux-design)
- [UX Onboarding Best Practices 2025 | UX Design Institute](https://www.uxdesigninstitute.com/blog/ux-onboarding-best-practices-guide/)
- [Model Selector Pattern | UX Patterns for Developers](https://uxpatterns.dev/patterns/ai-intelligence/model-selector)
- [AI Usability Principles: 9 UX Heuristics | Eleken](https://www.eleken.co/blog-posts/ai-usability-principles)
- [Graceful Degradation: Handling Errors | Medium](https://medium.com/@satyendra.jaiswal/graceful-degradation-handling-errors-without-disrupting-user-experience-fd4947a24011)
- [Failing Gracefully | UX Magazine](https://uxmag.com/articles/failing-gracefully)
