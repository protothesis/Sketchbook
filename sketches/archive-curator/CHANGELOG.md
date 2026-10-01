# Changelog

All notable changes to this sketch are logged here, per
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
