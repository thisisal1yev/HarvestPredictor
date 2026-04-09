# Detection Page — Feature Specification

## Overview

A single page at `/dashboard/cv/detection` that allows users to:
1. Manage CV models (upload, delete, select)
2. Run detection from multiple sources (photo, video, IP stream)
3. View detection results in real-time
4. Browse detection history

## Architecture

```
┌─────────────────────────────────────────────────────┐
│ Models (list, upload, delete)    │  Select Model ▼   │
├─────────────────────────────────────────────────────┤
│ Source: [Photo] [Video] [IP Stream]                 │
│                                                     │
│ ┌──────────────────┐  ┌──────────────────────────┐  │
│ │ Upload zone /    │  │ Detection results        │  │
│ │ video player /   │  │ (class, confidence, bbox) │  │
│ │ stream viewer    │  │                          │  │
│ └──────────────────┘  └──────────────────────────┘  │
├─────────────────────────────────────────────────────┤
│ Detection History (table, filters by date/model)    │
└─────────────────────────────────────────────────────┘
```

## Data Storage Decisions

### Uploaded files (photos, videos)
- **DO NOT store.** Process → return result → delete file.
- No exceptions. No "Save to Dataset" — no training module exists.
- Reduces storage costs, avoids privacy issues.

### Detection results
- **ALWAYS store** in database: className, category, confidence, bbox, timestamp, model used, userId.
- Display in "History" section on the same page.
- Enables: filtering past results, reviewing trends, returning to previous detections.
- Annotated image crops: store 72 hours, then auto-delete.

## Models Management
- List all uploaded .pt/.onnx model files
- Upload new model (admin only)
- Delete model (admin only)
- Select model before running detection (dropdown)

## Input Sources

### Photo
- Drag-and-drop or file picker
- Single and batch upload
- Supported: JPG, PNG (max 20MB per file)

### Video
- File upload (MP4, AVI, MOV, max 500MB)
- Process every Nth frame (configurable)
- Show progress during processing

### IP Stream
- Enter RTSP/RTMP URL
- Live detection frame-by-frame via WebSocket
- Start/Stop controls, FPS counter, detection count

## Detection Results Display
- List of detections: class name, category badge (disease/weed/pest), confidence %
- Bounding box coordinates (normalized 0-1)
- Processing time
- For video: frame number per detection

## History Section
- Table with columns: date, source type, model used, detections count, top finding
- Filters: date range, model, category
- Click row to expand and see full detection list

## Tech Stack
- Frontend: Nuxt 4 (Vue 3) + Nuxt UI v4
- Backend: Nuxt Nitro API routes → Python FastAPI CV service
- Detection: YOLOv8 (Ultralytics)
- Database: PostgreSQL + Prisma
- Streaming: WebSocket (JPEG frames over WS)

## Existing Infrastructure
- Python CV service exists with: detector.py, video_processor.py, stream_processor.py
- Nuxt CV API routes exist: models CRUD, detect image/video, sessions, detections
- Prisma models exist: CVModel, DetectionSession, Detection
- None of these are on current branch (feature) — need to rebuild from scratch
