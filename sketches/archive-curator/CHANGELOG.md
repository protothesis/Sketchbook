# Changelog

All notable changes to this sketch are logged here, per
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- 2026-10-07 — **Colour search**: a colour wheel (`C`) finds images where a
  noticeable share of the picture is near the chosen colour, best match
  first, with a Range slider and neutral presets. The details panel shows
  each image's palette; click a swatch to search for it, or **Similar
  colours** to rank by overall colour make-up.
- 2026-10-07 — **Background indexer** (`src/features.js`): an OKLab k-means
  palette and the prompt/model text for every image, stored in IndexedDB
  (database v3), current folder first, pausing while you scroll. Progress
  shows in the top bar.
- 2026-10-07 — **Search** now also covers prompts and model/LoRA names.
  Every word must match somewhere. Results are tagged with the fields that
  matched, and hovering shows the matching text highlighted.
- 2026-10-07 — **Folder headers** (`G`): one section per folder, with a
  clickable header. Sorting (including shuffle) applies within each folder.
- 2026-10-07 — **Seeded shuffle**: 🎲 / `D` rerolls; typing a seed restores
  that exact order.
- 2026-10-07 — **Gallery custom order**: drag images within a gallery to
  arrange them; the order is saved.
- 2026-10-07 — **Gallery groups**, plus drag-to-reorder of galleries and
  groups in the sidebar.
- 2026-10-07 — Library details panel that follows the selected image.

- 2026-10-07 — **Multiple folders.** Add any number of folders; each keeps
  its own remembered handle, file list and disk path, and reconnects
  independently ("Reconnect" in the top bar tries them all). Picking an
  already-added folder reconnects it instead of duplicating it.
- 2026-10-07 — **Folder tree** in a sidebar shared by every view: All
  folders, any folder, or any subfolder (recursive). It scopes the library
  and the Review module alike.
- 2026-10-07 — **Module host.** Optional features register with
  `Curator.registerModule()` and get a tab plus a section in Settings →
  Modules, where they can be switched off.
- 2026-10-07 — Galleries: drop a selection on **+ New gallery** to create
  a gallery from it; a **target gallery** (◉) that `B` adds to or removes
  from; **Show in folder** from any image's details.

### Changed

- 2026-10-07 — Library click now selects and double-click opens, instead of
  click opening. Arrow keys move the cursor, `Enter` opens it, and
  `Y`/`M`/`N`/`0` rate the selection. The bulk-action bar appears for 2+
  selected images.
- 2026-10-07 — The PNG metadata reader reads chunk by chunk and stops at the
  image data once it has found text, instead of loading whole files.

- 2026-10-07 — The app is now viewer-first: the **Library** is the default
  tab and shows every image in the selected folder, not just rated ones,
  with an All / Unrated / Yes / Maybe / No / Notes filter bar.
- 2026-10-07 — Flashcard review moved into `src/modules/review.js` (+ its
  CSS) as the first module. Its random pool follows the sidebar selection.
- 2026-10-07 — The library grid is virtualized: only visible rows exist in
  the DOM, thumbnail jobs for cells scrolled away are cancelled, and the
  in-memory thumbnail URL cache is bounded.
- 2026-10-07 — Metadata keys are now `<folder>/<relative path>` (database
  v2). Existing data is migrated on first load, and a backup of the old
  records is kept in IndexedDB (`kv` → `v1-backup`). Ratings and thumbnails
  from an earlier folder that wasn't the current one show up as
  **Unattached** until that folder is added again, then reattach.
  Exports are v2; v1 exports still import.

### Fixed

- 2026-10-07 — Library grid: rows could collapse while cells stayed square,
  so thumbnails overlapped and drifted out of alignment when scrolling or
  resizing. This came from relying on CSS `aspect-ratio` in auto-sized grid
  rows. Columns and cell size are now computed from the container width
  (re-run on resize), with fixed-pixel rows, and the first visible row stays
  in view when the size changes. The size slider now sets the *minimum* cell
  size, and cells stretch to fill the row.

### Changed

- 2026-10-07 — Thumbnails default to **Fit** (whole image, true aspect
  ratio, letterboxed in a square cell, like Lightroom's grid). **Crop** is
  the opt-in toggle. The button's tooltip now explains which mode is active.

### Added

- 2026-10-07 — `docs/face-recognition-brief.md`: concept brief for a local face
  recognition "People" layer (how it works, model options, browser-first
  implementation path, data model, open questions). Design notes only; no
  code yet.
- 2026-10-01 — Initial sketch created.
- Read-only folder access via the File System Access API, with the handle
  persisted for one-click reconnect, and an `<input webkitdirectory>`
  fallback. Recursive scan, background rescan on reconnect.
- Flashcard review: random batches (default 10) from unreviewed images,
  maybes, yeses or nos, optionally scoped by path. Yes/maybe/no/skip/back
  via arrow keys, letters or mouse flicks. Filmstrip and batch summary.
- Library grid: filter by rating, notes or gallery; search; sort; adjustable
  thumbnail size and crop/fit; multi-select; drag to galleries; bulk rating.
- Lightbox with keyboard navigation, 100% zoom and fullscreen.
- Virtual galleries, markdown notes, copyable full paths, open original.
- PNG generation metadata (ComfyUI prompt graph, A1111 parameters).
- Cached webp thumbnails in IndexedDB; JSON export/import of all metadata.
