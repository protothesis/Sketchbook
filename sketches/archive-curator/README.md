# Archive Curator

**Started:** 2026-10-01
**Status:** prototype

A fast, minimal viewer and organizer for big local image archives — a
ComfyUI `output` folder full of dated subfolders, or a photo archive. Add
any number of folders and browse them all together or one folder (and
everything under it) at a time. Rate, write markdown notes, and collect
images into Lightroom-style virtual galleries without ever touching where
the files live. Optional modules add task-focused tabs on top; the first
is flashcard **Review**.

**Strictly read-only.** Source images are never moved, copied, renamed or
deleted. Everything the app knows is a metadata layer: ratings, notes,
galleries and cached thumbnails. That layer is kept in the browser's
IndexedDB, keyed by `<folder name>/<path inside the folder>`. You can
export it to JSON from Settings and import it back.

## Try it

Double-click `index.html`. Chrome or Edge is recommended. Click **Add
folder…** and pick a folder. It's scanned recursively, which can take a
while the first time on a big archive. After that, file lists and
thumbnails are cached. Add more folders with **+ Add** in the sidebar.

- **Chrome/Edge**: the browser remembers every folder. Next visit, the
  **Reconnect** button re-grants read access (browsers require a click).
  New images are picked up by a background rescan.
- **Firefox/Safari**: falls back to a folder `<input>`, so you re-pick
  folders each visit. Ratings and notes are kept either way.
- Picking a folder that's already in the library reconnects it. Re-adding
  a folder after removing or moving it brings its ratings, notes and
  gallery entries back (they're matched by folder name + relative path).

### Library (the core)

The sidebar's **folder tree** picks what you're looking at: **All
folders**, one folder, or any subfolder (it includes everything below it).
Clicking a **gallery** shows that gallery instead. The same choice scopes
the Review module.

The filter bar narrows by All / Unrated / Yes / Maybe / No / With notes;
search matches paths and notes. Sort by name (chronological for dated
folders), newest first, recently rated, or shuffle. Use the slider (or
`+`/`−`, or Ctrl+scroll) to size thumbnails, and toggle crop/fit. The grid
is virtualized, so 100k-image folders scroll like 100-image ones.

Click an image for the lightbox (`←`/`→` navigate, `Space` or click for
100% zoom, `F` fullscreen, `Y`/`M`/`N` rate, `I` details).

### Galleries

An image can be in any number of galleries.

- Ctrl/⌘-click or Shift-click to select, then drag onto a gallery, or onto
  **+ New gallery** to create one from the selection in one step.
- **Target gallery**: click ◉ on a gallery, then press `B` to add/remove
  the current image (lightbox, review) or the selection (library). With no
  target set, `B` makes a new gallery and targets it.
- **Show in folder** (details panel) jumps from any image, e.g. one in a
  gallery, back to its original folder with it selected.

### Modules

Settings → Modules switches optional modules on and off. Each one is a
file in `src/modules/` that registers itself with
`Curator.registerModule({...})` and gets its own tab (see the contract at
the top of `src/modules/review.js`).

**Review** (`R`): flashcard-style random batches from whatever's selected
in the sidebar.

| Key | Action |
| --- | --- |
| `→` / `Y` / `P` | Yes |
| `↑` / `M` | Maybe |
| `←` / `N` / `X` | No |
| `↓` / `S` | Skip (stays unrated) |
| `Backspace` / `Z` | Back one image |
| `0` / `U` | Clear rating |
| `Enter` | Open in lightbox / next batch |

You can also flick the image with the mouse: right for yes, left for no, up
for maybe. **Queue** switches from unrated images to re-rating maybes,
yeses, or nos. **Path contains** narrows the pool further, e.g. `2024-05`.

### Getting to the file

Browsers can't see real disk paths or open Explorer. Instead, **Copy path**
and **Copy folder** in the details panel build the full path from each
folder's disk path, pasted in once (Settings → Folders), e.g.
`D:\ComfyUI\output`. You can paste the result
into Explorer's address bar. **Open ↗** opens the original in a new tab.

### Generation metadata

PNG text chunks are parsed on demand. For ComfyUI, the positive and negative
prompts are traced back from the sampler's inputs, and the seed, steps, cfg,
sampler, model and LoRAs are shown, with buttons to copy the prompt or the
workflow JSON. A1111/Forge `parameters` text is shown as-is.

## Structure

```
index.html        markup for all views (classic <script> tags, no modules)
styles.css
src/store.js      IndexedDB wrapper (kv, roots, records, galleries, thumbs)
src/source.js     read-only access to several folders: File System Access API + <input webkitdirectory> fallback
src/images.js     thumbnail generation/cache (LIFO pool) + full-size object-URL LRU
src/pngmeta.js    PNG tEXt/iTXt/zTXt reader + ComfyUI graph summarizer
src/markdown.js   tiny escape-first markdown renderer for notes
src/details.js    the side panel (path, rating, galleries, notes, metadata)
src/app.js        core: folders + tree, virtualized library, galleries, lightbox, settings, keys, module host
src/modules/      optional modules (review.js + review.css)
```

Everything attaches to `window.Curator`.

## Direction (updated 2026-10-07)

- **Viewer/organizer first, everything else a module.** Like Obsidian: a
  lean, stable core (folders, grid, lightbox, ratings, notes, galleries)
  with task-focused modules in their own tabs, like Lightroom's modules.
  Review was the first to move out.
- **Personal use only**, run locally on a machine with an NVIDIA GPU.
  Expected scale: ~20k SDXL outputs now, 100k+ once phone and DSLR photos
  are added.
- **One index, many features.** Colour search, semantic (CLIP) search,
  "more like this", a UMAP map and People all come from per-image numbers
  computed once by a background indexer. All search modes should combine,
  and any combination should be saveable as a **smart gallery** next to
  the hand-made ones.
- **Plan:** (1) this sketch: multi-folder viewer core, galleries, modules
  (done 2026-10-07); colour palettes + colour-wheel search next, since
  that's pure JS. (2) Graduate to its own repo with a local Python backend
  (SQLite, GPU models) serving this UI. In-browser ML fights this repo's
  `file://` rule (no workers or `.wasm` fetches from `file://`). (3) People
  first, then CLIP search / similar images, smart galleries, and the UMAP
  map.
- **Rating UX needs rethinking.** Arrow keys read as "navigate", not
  "rate". A continual cull/re-rate loop feels promising, but the design is
  still open.
- **"More like this"** is only worth doing if it's content-aware (colour,
  composition, semantic similarity), not exact-prompt matching.

## Open questions / next steps

- **People / face recognition layer**: a local, background face index with a
  People gallery you can fully reorder, merge, split and categorize. Design
  notes, model options and a browser-first plan are in
  [`docs/face-recognition-brief.md`](docs/face-recognition-brief.md).
- **Reveal in Explorer** for real would need a tiny local helper, e.g. a
  ~30-line Python/Node script the page can ping. Another route is wrapping
  the whole thing in Tauri/Electron. That would also make the metadata a
  real file next to the archive instead of browser storage.
- **Sidecar library file**: write the metadata JSON automatically to a
  location you choose, outside the image folder, via the File System Access
  API, instead of manual export.
- **Smarter surfacing**: weight the random pool toward under-sampled dates
  or folders. Another option is a "more like this" queue built from prompt
  similarity, e.g. the same seed or prompt fragment.
- **Video outputs** (AnimateDiff `.mp4`/`.webm`/`.gif`) are skipped except
  for GIF. They'd be easy to add to the review stage.
- **Pairwise "tournament" mode** for narrowing a big Yes pile down to
  favourites.
- **Gallery organizing**: manual ordering inside a gallery, cover images,
  gallery groups (Lightroom's collection sets), sorting the gallery list.
- **Very large libraries**: thumbnails are ~30 KB each in IndexedDB, so
  100k images is a few GB of browser storage. Phone photos in HEIC can't
  be decoded by browsers at all. Both point at the Python backend.
- Not yet verified against a real 50k-image archive. Also unverified: the
  persisted folder handle under `file://` on Windows Chrome. It's expected
  to work, but if it doesn't, the cost is one re-pick per session.
