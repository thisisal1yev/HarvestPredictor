# Detection UX Competitor Analysis

**Date:** 2026-03-29
**Purpose:** Analyze how leading platforms handle object detection UX to inform HarvestPredictor's detection page design.

---

## 1. Roboflow

### Overview
Developer-focused CV platform with model hosting, training, and inference. Universe marketplace with 50,000+ public models.

### Upload Flow
- **Roboflow Universe (Model Page):** Navigate to model page > click "Try" tab > drag-and-drop or upload image > results appear automatically
- **Roboflow Playground:** Select task type > choose up to 5 models > upload image + set prompt > results render side-by-side for comparison
- **Workflows:** Visual block builder > chain model blocks > add visualization blocks (bounding box + label) > run

### Clicks from "I have an image" to "I see result"
- **Universe model page:** 2 clicks (upload + auto-inference)
- **Playground:** 3-4 clicks (select task, select models, upload, optional prompt)
- **Workflows:** 5+ clicks (build workflow first, then run)

### Model Selection
- **Manual.** User navigates Universe, searches models, or selects from their workspace
- Playground allows comparing up to 5 models simultaneously
- No auto-selection — user must know which model to try

### Bounding Box Display
- **Canvas overlay** with colored bounding boxes + class labels drawn directly on image
- Visualization blocks in Workflows: BoundingBox + Label overlays are separate configurable blocks
- Click thumbnail for full-size annotated image view
- JSON results also available in API response

### Detection History
- **Model Monitoring dashboard:** tracks inference counts, per-class distribution, confidence scores over time
- Individual inference inspection: view specific predictions with metadata
- Custom metadata support (camera ID, location, device ID, timestamp)
- History is production-focused, not per-user session browsing

### Mobile Experience
- Web app is responsive but desktop-first
- No native mobile app for inference
- Mobile-optimized models (RF-DETR Nano/Small) available for edge deployment
- Universe browsing works on mobile but annotation/inference is desktop-optimized

### Key UX Patterns
- Side-by-side model comparison (Playground)
- Visual workflow builder for composing detection pipelines
- Thumbnail + expand pattern for result images
- Separation of visualization from detection (modular blocks)

---

## 2. Ultralytics HUB

### Overview
Official platform from YOLOv8/YOLO26 creators. Train, deploy, and test YOLO models in browser.

### Upload Flow
- Navigate to trained model > open **Predict tab** > inference runs **automatically** when you:
  - Upload an image
  - Click a preloaded example
  - Capture via webcam
- No "Run" button — inference triggers instantly on input

### Clicks from "I have an image" to "I see result"
- **2 clicks:** Navigate to model > upload image (inference auto-triggers)
- **1 click with examples:** Click preloaded example image = instant result
- Zero-click for webcam: start feed, detections appear continuously

### Model Selection
- **Manual** — user navigates to specific model, then opens Predict tab
- Model is pre-selected by being on its page
- No cross-model comparison in single view

### Bounding Box Display
- **Canvas overlay** — annotated image returned with bounding boxes drawn on source image
- Confidence scores displayed alongside boxes
- Adjustable parameters (confidence threshold, IoU) with **auto-re-inference** on 500ms debounce
- No separate JSON/list view in Predict tab — visual-first

### Detection History
- **No detection history in Predict tab** — it's a testing tool, not a production monitor
- Each new image/example replaces the previous result
- For production tracking, export model and use external monitoring

### Mobile Experience
- Predict tab works in mobile browser
- Webcam capture works on mobile
- Streamlit integration available for custom mobile inference UIs
- Not a native mobile app

### Key UX Patterns
- **Zero-click inference** — drop image, see result (no button needed)
- Parameter adjustment triggers auto-re-inference (reactive UI)
- Preloaded examples for instant gratification
- Webcam as first-class input source
- Extremely low friction: model page = inference page

---

## 3. CVAT / Label Studio

### Overview
Annotation tools, not inference platforms. But their detection result display patterns are industry standard for bounding box visualization.

### CVAT Bounding Box Display
- **Canvas overlay** as primary view — colored rectangles drawn on image
- **Objects sidebar** (right panel): list of all annotations on current frame
  - Shows: class label, ID, color swatch, lock/hide toggles
  - Click object in list = highlight on canvas (and vice versa)
- **Appearance settings:** adjustable opacity for fill and borders, customizable colors per label
- **Controls sidebar** (left panel): drawing tools (rectangle, polygon, polyline, points, etc.)
- Two-panel layout: canvas center + object list right

### Label Studio Bounding Box Display
- **Canvas overlay** with RectangleLabels control tag
- **Regions panel:** list of all labeled regions with class, confidence score (for predictions)
- Sort predictions by confidence score
- Auto-annotation mode: regions appear automatically from model predictions, user accepts/rejects
- Show/hide predictions toggle — separate from manual annotations
- Crosshair cursor with axis guides for precision

### Key Display Patterns (Both Tools)
- **Canvas + List dual view** — bounding boxes on image AND itemized list in sidebar
- Per-class color coding (consistent colors across all instances of same class)
- Click-to-select synchronization between canvas and list
- Opacity controls for visual clarity on busy images
- Lock/hide per-annotation controls
- Frame-by-frame navigation for video (CVAT)

### Why This Matters for HarvestPredictor
- Our detection results should use the same **canvas + list** pattern
- Users expect: colored overlays, class labels on boxes, confidence scores in list
- Video results need frame-by-frame navigation
- The sidebar list enables filtering/sorting without cluttering the image

---

## 4. Plantix / Agrio (Consumer Ag Apps)

### Overview
Mobile-first apps for farmers. Photo-based plant disease diagnosis with treatment recommendations.

### Plantix Flow
1. Open app
2. Tap camera / upload photo
3. **Instant diagnosis** — disease name, confidence, affected area
4. Scroll down for: symptoms description, treatment recommendations, preventive measures
- **3 taps total** from launch to result

### Agrio Flow
1. Open app > tap "Upload Image" or camera
2. Select plant type from list
3. Optional: answer supplementary diagnostic questions
4. Receive diagnosis with accuracy percentage + treatment plan
- **3-4 taps** from launch to result

### Model Selection
- **Fully automatic** — no model selection at all
- User never sees model names, versions, or parameters
- Single unified AI behind the scenes

### Detection Results Display
- **No bounding boxes** — results are classification-style, not object detection
- Disease name as large header with confidence percentage
- Affected area shown as highlighted image region (not precise bbox)
- **Treatment card** below diagnosis:
  - Biological/organic treatments highlighted
  - Chemical treatments listed
  - Preventive measures
  - Fertilizer recommendations for nutrient deficiency
- Scrollable card-based layout, one disease per card

### Detection History
- Agrio: field-level history with documented findings, treatments applied, and outcomes
- Plantix: basic history of past scans
- Both support multiple users sharing findings (collaborative workgroups)

### Mobile Experience
- **Mobile-native** — designed phone-first
- Camera integration is primary input (not file upload)
- Offline diagnosis support (Plantix)
- Clean, simple cards — no technical jargon
- Weather + irrigation data integrated alongside diagnosis

### Key UX Patterns
- **Extreme simplicity** — 3 taps to result
- No model selection, no parameters, no technical details
- Treatment recommendations inline with diagnosis (actionable, not just informational)
- Card-based scrollable results
- Collaborative field-level tracking
- Focus on "what do I do about this?" not "what did the model detect?"

---

## 5. Gradio / Streamlit ML Demos

### Overview
Python frameworks for building ML demo UIs. De facto standard for research model demos and Hugging Face Spaces.

### Gradio Interface Pattern
- **gr.Interface:** simplest pattern — input component (gr.Image) + output component (gr.Label or gr.AnnotatedImage) + submit button
- **Side-by-side layout:** input left, output right
- **gr.Blocks:** custom layouts with gr.Row() and gr.Column() for complex UIs
- Upload image > click Submit > see result

### Streamlit Pattern
- Linear top-to-bottom layout
- st.file_uploader() > process > st.image() with annotations
- Sidebar for model selection / parameter adjustment
- More flexible but requires more code

### Clicks from "I have an image" to "I see result"
- **Gradio gr.Interface:** 2 clicks (upload + Submit button)
- **Gradio with live=True:** 1 click (upload triggers auto-inference, no Submit needed)
- **Streamlit:** 2-3 clicks (upload + optional parameter selection + auto-refresh)

### Model Selection
- Typically **dropdown** component (gr.Dropdown or st.selectbox)
- Often hardcoded to single model in simple demos
- Multi-model comparison requires custom layout

### Bounding Box Display
- **gr.AnnotatedImage:** returns image with overlay annotations
- **gr.JSON:** raw detection results as JSON tree
- **gr.Label:** confidence bar chart for classification
- Common pattern: annotated image + JSON side by side
- Streamlit: st.image() with drawn bboxes + st.dataframe() for results table

### Detection History
- **None by default** — each inference replaces previous
- Must be custom-built if needed (database + table component)
- Gradio flagging feature: users can flag/save interesting results

### Mobile Experience
- Gradio: responsive, works on mobile but not optimized
- Streamlit: basic mobile support, scrollable layout
- Neither is mobile-first

### Key UX Patterns
- **Input > Process > Output** linear flow
- Side-by-side or top-to-bottom layout
- Submit button (explicit) or live mode (auto-trigger)
- Minimal UI — focus on model output, not chrome
- Easy parameter adjustment via sliders/dropdowns

---

## Comparative Summary

| Feature | Roboflow | Ultralytics HUB | CVAT/Label Studio | Plantix/Agrio | Gradio/Streamlit |
|---------|----------|-----------------|-------------------|---------------|-----------------|
| **Clicks to result** | 2-4 | 1-2 | N/A (annotation tool) | 3 | 1-2 |
| **Model selection** | Manual (search/browse) | Manual (navigate to model) | N/A | Automatic (hidden) | Dropdown or fixed |
| **Bbox display** | Canvas overlay | Canvas overlay | Canvas + sidebar list | No bboxes (classification) | Annotated image + JSON |
| **Detection history** | Production monitoring | None | N/A | Field-level history | None (must build) |
| **Mobile** | Responsive web | Mobile browser OK | Desktop only | Native mobile | Basic responsive |
| **Target user** | Developer | ML engineer | Annotator | Farmer | Researcher |

## Key Takeaways for HarvestPredictor

### 1. Adopt Zero-Click Inference (from Ultralytics HUB)
- Auto-trigger inference when image is uploaded — no "Detect" button needed
- Parameter changes should auto-re-run (with debounce)
- Preloaded example images for instant demo

### 2. Use Canvas + List Dual View (from CVAT/Label Studio)
- Bounding boxes overlaid on image as primary view
- Sidebar/panel list with class, confidence, category badge
- Click-to-highlight sync between canvas and list
- Per-class color coding

### 3. Treatment/Action Integration (from Plantix/Agrio)
- Don't just show "Leaf Blight 94%" — link to knowledge base entry
- Show treatment recommendations inline or one-click away
- Focus on actionable output for farmers

### 4. Model Selection as Dropdown (from Gradio pattern)
- Simple dropdown, not a separate management page
- Show model name + version
- Admin-only upload/delete (keep simple for regular users)

### 5. Detection History as Session-Based Table (our spec is good here)
- Table with filters (date, model, category)
- Expandable rows for full detection list
- 72-hour image retention (then auto-delete)

### 6. Mobile Must Work (from Plantix/Agrio)
- Camera capture as primary mobile input
- Card-based results (not tables) on mobile
- Responsive canvas with touch gestures for zoom/pan

### 7. Skip What's Unnecessary
- No workflow builder (too complex for farmers)
- No multi-model comparison (one model at a time is fine for MVP)
- No real-time production monitoring (defer to post-MVP)
