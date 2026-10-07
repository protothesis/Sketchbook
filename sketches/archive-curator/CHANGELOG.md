# Changelog

All notable changes to this sketch are logged here, per
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
