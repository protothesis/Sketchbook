# Archive Curator

**Started:** 2026-10-01
**Status:** prototype

Flashcard-style random review for a huge local image archive (e.g. a
ComfyUI `output` folder full of dated subfolders). It serves you random
batches of ten. Rate each one yes / maybe / no, then browse your keepers
in a Lightroom-ish grid, write markdown notes, and sort images into
virtual galleries.

**Strictly read-only.** Source images are never moved, copied, renamed or
deleted. Everything the app knows is a metadata layer: ratings, notes,
galleries and cached thumbnails. That layer is kept in the browser's
IndexedDB, keyed by each image's path relative to the folder you picked.
You can export it to JSON from Settings and import it back.

## Try it

Double-click `index.html`. Chrome or Edge is recommended. Click **Choose
folder…** and pick your output folder. It's scanned recursively, which can
take a while the first time on a big archive. After that, the file list and
thumbnails are cached.

- **Chrome/Edge**: the browser remembers the folder. Next visit is one
  **Reconnect** click, because browsers require a click to re-grant read
  access. New images are picked up by a background rescan on reconnect.
- **Firefox/Safari**: falls back to a folder `<input>`, so you re-pick the
  folder each visit. Ratings and notes are kept either way.

### Review (flashcards)

| Key | Action |
| --- | --- |
| `→` / `Y` / `P` | Yes |
| `↑` / `M` | Maybe |
| `←` / `N` / `X` | No |
| `↓` / `S` | Skip (stays unreviewed) |
| `Backspace` / `Z` | Back one image |
| `0` / `U` | Clear rating |
| `Enter` | Open in lightbox / next batch |
| `I` | Details panel: prompt, seed, model, notes, galleries |
| `F` | Fullscreen |

You can also flick the image with the mouse: right for yes, left for no, up
for maybe. **Queue from** can switch from unreviewed images to re-rating
your maybes (the "refinement stage"), yeses, or nos. **Path contains** limits
the random pool, e.g. to `2024-05`.

### Library

Filter by rating, by "with notes", or by gallery. Search matches paths and
notes. Sort by recently rated, chronological (path order) or shuffle. Use
the slider (or `+`/`−`, or Ctrl+scroll) to size thumbnails, and toggle
crop/fit. Click an image to open the lightbox (`←`/`→` navigate, `Space` or
click for 100% zoom, `F` fullscreen, `Y`/`M`/`N` rate). Ctrl/⌘-click and
Shift-click select images. You can add a selection to a gallery, re-rate it,
or drag it onto a gallery in the sidebar.

### Getting to the file

Browsers can't see real disk paths or open Explorer. Instead, **Copy path**
and **Copy folder** in the details panel build the full path from a root
path you paste in once, e.g. `D:\ComfyUI\output`. You can paste the result
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
src/store.js      IndexedDB wrapper (kv, records, galleries, thumbs)
src/source.js     read-only folder access: File System Access API + <input webkitdirectory> fallback
src/images.js     thumbnail generation/cache (LIFO pool) + full-size object-URL LRU
src/pngmeta.js    PNG tEXt/iTXt/zTXt reader + ComfyUI graph summarizer
src/markdown.js   tiny escape-first markdown renderer for notes
src/details.js    the side panel (path, rating, galleries, notes, metadata)
src/app.js        views, lightbox, settings, keyboard, wiring
```

Everything attaches to `window.Curator`.

## Direction notes (from first use, 2026-10-07)

None of this is implemented yet. It's captured here to steer the next round.

- **General-purpose viewer first, review as a mode.** With small changes
  this could be a slick, minimal media viewer at its core. Flashcard review
  would then be one tab/plugin you can turn on, not the whole app.
- **Browse by folder/day.** From any image, jump to everything else in its
  directory or day. More broadly: a thumbnail view of a whole folder's
  contents with filter and sort options. That doesn't need all ~20k
  images in the DOM at once.
- **Video** support matters once it's a general viewer (there's a little
  in the archive).
- **Rating UX needs rethinking.** Arrow keys read as "navigate", not
  "rate". A continual cull/re-rate loop feels promising, but the design is
  still open.
- **"More like this"** is only worth doing if it's content-aware (colour,
  composition, semantic similarity), not exact-prompt matching.

## Open questions / next steps

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
- **Very large libraries**: the grid renders every cell (with lazy thumbs).
  That's fine for thousands, but it would want virtualization at tens of
  thousands of yeses.
- Not yet verified against a real 50k-image archive. Also unverified: the
  persisted folder handle under `file://` on Windows Chrome. It's expected
  to work, but if it doesn't, the cost is one re-pick per session.
