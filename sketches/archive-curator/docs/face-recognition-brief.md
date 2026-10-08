# Face Recognition "People" Layer: Concept Brief

Handoff for the image viewer repo. Goal: decide how to implement, not a final spec.

## Goal
Add an unobtrusive, fully local face recognition layer to the image viewer. It runs in the background, groups faces into "people," and is surfaced through search and a People gallery. The differentiator versus Google Photos: **the user can sort, organize, merge, split, and categorize people however they want.**

## Context and constraints
- Viewer is clean, minimal, fast. Face indexing must never make browsing feel slower.
- Current prototype: pure JS + HTML/CSS, shared online for quick review.
- Target is desktop only, Windows only for now. No mobile.
- Privacy is a feature: photos and face data stay on the user's machine. No cloud APIs.
- Developer is comfortable with Python and SQLite and interested in Rust long term.

## How face recognition works (3 stages)
1. **Detection:** a model finds faces and returns bounding boxes plus landmarks (eyes, nose, mouth corners).
2. **Embedding:** each face is cropped and aligned (typically 112x112 from landmarks), then a neural net outputs a vector (128 or 512 floats). Same person = nearby vectors; different people = distant. Compare with cosine similarity.
3. **Clustering:** group nearby vectors into people (DBSCAN or agglomerative). Naming a cluster labels it; new photos are matched to the nearest known person.

The data is just `face -> bounding box + embedding + person_id`, so organizing features are straightforward once we own the database.

## Model options (all available as ONNX files)
| Option | Notes |
|---|---|
| **YuNet (detect) + SFace (embed)** | OpenCV Zoo. Small, permissive licenses (MIT / Apache 2.0). Good fit for minimal and fast. Lower accuracy than InsightFace. |
| **InsightFace SCRFD + ArcFace** | Best free accuracy. Pretrained weights are **non-commercial**, which matters if the app is ever sold. |
| **dlib / face_recognition** | Easiest in Python, but older, slower, own model format, poor fit for browser or Rust. |
| **MediaPipe** | Strong detector, but no embedding model. Would need pairing. |
| Cloud APIs (Azure, AWS) | Rejected: cost, uploads photos, Azure restricts identification. |

**ONNX** is a portable model file format; **ONNX Runtime** runs it on CPU or GPU (DirectML works on any Windows GPU) with bindings for Python, JS (`onnxruntime-web`), C#, C++, and Rust (`ort` crate). The same `.onnx` files work in every implementation path below.

## Implementation paths

### A. Browser-only (fits the current prototype stack)
- `onnxruntime-web` (WASM, optional WebGPU) running YuNet + SFace. Alternatives: `face-api.js` (older TF.js, 128-d descriptors), `transformers.js`.
- Folder access via the File System Access API (Chromium browsers; handles can be persisted). Fallback: drag-drop or file picker.
- Store faces/embeddings/person labels in IndexedDB (or SQLite-WASM).
- Index in a Web Worker so the UI stays smooth. Cluster in plain JS (a few thousand faces is trivial).
- Pros: stays shareable online as a static page, photos never leave the device, fastest way to test the People UX on real photos. Cons: browser memory/file-access limits, Chromium only, slower indexing on large libraries, models are tens of MB to download once (cache them).

### B. Electron + Python sidecar
- Python runs InsightFace (or YuNet/SFace) via ONNX Runtime, writes to SQLite; the viewer reads it.
- Matches the dev's existing Electron + Python + SQLite workflow. Best accuracy and easiest for large libraries.

### C. Native Rust
- `ort` + `rusqlite` + `image` crate (+ `linfa` for DBSCAN). Fast single-binary Windows app.
- More work: you must implement face alignment, pixel normalization, detector output decoding, and NMS yourself (all well documented).

**Suggested sequencing:** A (prove the UX and check accuracy on real photos) -> B or C once the design is settled. Model files and the SQLite/data schema carry over between paths.

## Data model (sketch)
- `images(id, path, mtime, hash, indexed_at)`
- `faces(id, image_id, bbox, landmarks, embedding BLOB, quality_score, thumb, person_id NULL, ignored BOOL)`
- `people(id, name NULL, sort_order, category_id NULL, cover_face_id)`
- `categories(id, name, sort_order)` (family, friends, etc.)
- `constraints(face_a, face_b, type)` where type is `same` or `different`

## Core behaviors
- **Background indexing:** low priority, resumable, only new/changed files; skip when the user is actively browsing.
- **Incremental clustering:** new faces attach to the nearest confident person, otherwise stay unassigned for later grouping.
- **User corrections are hard constraints.** Merges, splits, "not this person," and "ignore this face" are stored and never overridden by re-clustering. This is the key trust feature.
- **Surfacing:** People gallery (grid of face-crop covers), search by name, filter the viewer to one or more people.

## Organizing features Google lacks (the point of the project)
- Manual ordering (drag to reorder) plus sort by name, photo count, recency
- Group people into categories/folders
- Merge, split, and move faces between people; bulk-select faces
- Ignore faces (strangers, background people) so they stop cluttering
- Pick cover face, rename, optional notes

## Known limitations to design around
- Accuracy drops for profiles, heavy occlusion, low light/low resolution, and children as they age. A fast, pleasant manual merge/review UI matters as much as the model.
- Suggest "possible matches" at medium confidence rather than auto-merging.
- Embeddings are biometric-adjacent data: keep local, document where stored, make delete-all easy.

## Open questions for the implementing session
1. Can the browser prototype (path A) handle a realistic library size with acceptable indexing speed? Test with a few thousand photos.
2. Which model pair gives acceptable accuracy at acceptable size? Start with YuNet + SFace; compare against ArcFace.
3. Is the app ever going to be distributed/sold? That decides whether InsightFace weights are usable.
4. IndexedDB vs SQLite-WASM for the browser prototype, given the plan to move to SQLite later.
5. How does the face layer integrate with the existing viewer's folder/library model?

## Suggested first milestone
Single page: pick a folder -> detect + embed faces in a worker -> cluster -> show a People grid with merge/split/ignore and manual ordering -> persist across reloads. No polish; goal is to feel the UX and measure accuracy/speed on real photos.
