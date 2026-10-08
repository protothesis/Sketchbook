# Changelog

All notable changes to this sketch are logged here, per
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- 2026-10-08 — **Graduated to Insight** (`protothesis/insight`). Status is
  now `graduated` and the sketch is closed: no further development here.
  README and the demo page carry a banner, and the demo stays working as
  the reference and the way to export data for Insight.

### Added

- 2026-10-08 — **Full backup**: Export now saves every store (ratings, notes,
  galleries incl. smart/history/notes, groups, colour palettes and
  profiles, the search index, folder file lists, settings). Only thumbnails
  and folder permissions are left out. **Restore** rebuilds folders as
  offline entries plus palettes, profiles and the index in a fresh browser.

- 2026-10-08 — **Image viewer zoom**: images open in Fit (scaled up or down
  to the screen); **Fit / 1:1** radio buttons (1:1 = actual device pixels);
  scroll-to-zoom around the cursor; drag to move at any scale; a % readout;
  a corner **navigator** showing the visible region (click or drag to
  move); crisp pixels when zoomed well in.
- 2026-10-08 — Lightbox **click zones**: the left and right 20% of the
  screen go to the previous / next image, highlighted on hover. Drags that
  start there move the image instead.

- 2026-10-08 — **Smart galleries**: ☆ Save keeps the current search (where,
  rating filter, words, colour/similar/profile match) and its results as a
  baseline. The sidebar shows whether the results have changed (green dot,
  or a red `+new −gone` badge). Opening one splits new matches out on top,
  with hide / accept all / accept selected / forget gone, and Update or
  Revert after editing the search. **Make gallery** turns the selection or
  saved results into an ordinary gallery that remembers its search.
- 2026-10-08 — Galleries keep a **history log** (created, renamed,
  added/removed, rearranged, accepted...) and their own **markdown notes**,
  shown in the details panel when a gallery is open and nothing is
  selected.

- 2026-10-08 — Colour wheel v2: every control lives on the wheel. Colours
  outside the search range are dimmed on the disc. An outer hue ring never
  dims and marks the current hue. Brightness (left arc, or scroll) and
  range (right arc, or Shift+scroll) replace the sliders.
- 2026-10-08 — **Swatches**: user palettes of any size and number below the
  wheel (add from the colour preview or **+**, right-click to remove or to
  start a palette). **Profiles**: save an image's colour make-up (☆ Save
  in details) and rank images against it later.
- 2026-10-08 — `[` hides the folders & galleries panel (also ☰ in the top
  bar).

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

- 2026-10-08 — Fullscreen is an app-level control (⛶ in the top bar, `F`)
  instead of a lightbox button. Clicking the lightbox background no longer
  closes it (`Esc` or × does).

- 2026-10-08 — Toolbar grouped into where / filter / sort / view with
  separators. The image count sits next to the folder name. The rating
  filter collapses into a ★ button (collapsed by default).
- 2026-10-08 — Selection is now a brighter cell, with no outline or
  checkmark. In Crop mode, where the image covers the cell, an outline and
  light wash are drawn on top; hover shows there too. Clicking the only
  selected image deselects it.
- 2026-10-08 — The library details panel opens only with `I`, independently
  of the lightbox's. With nothing selected it says so, instead of popping
  in on the first click.
- 2026-10-08 — The rated-count banner shows only on the Review tab.
- 2026-10-08 — Opening the colour picker no longer starts a search by
  itself; picking something does. Folder headers are off while sorting by
  best match.

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

- 2026-10-08 — Lightbox "1:1" just scrolled the image to the top-left and
  never showed whether it was on.

- 2026-10-08 — With the folder-input fallback (non-Chromium browsers),
  re-picking a folder that's already connected refreshes it instead of
  adding a duplicate "name (2)".

- 2026-10-08 — Picking a colour on the wheel at low brightness no longer
  resets brightness.
- 2026-10-08 — Dragging a selection to a gallery could silently cancel: a
  background refresh (e.g. indexing while searching) rebuilt the grid and
  removed the element being dragged. Refreshes now wait until the drag
  ends. The grid and sidebar no longer highlight text while dragging.
- 2026-10-08 — The shuffle seed box was too narrow to show the seed.

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
