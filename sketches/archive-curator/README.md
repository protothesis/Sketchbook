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

**Click** a thumbnail to select it (click it again to deselect),
Ctrl/⌘-click or Shift-click to select more, and **double-click** (or
`Enter`) to open it in the lightbox. Arrow keys move the cursor (Shift
extends the selection), `Y`/`M`/`N`/`0` rate the selection, and `I`
toggles the details panel. `[` hides the folders & galleries panel.

The toolbar is grouped: where you are (folder and image count) | filter |
sort | view. ★ expands the rating filter (All / Unrated / Yes / Maybe / No
/ With notes); collapsed, it shows which filter is active.
Sort by name (chronological for dated folders), newest first, recently
rated, or **shuffle**. Shuffle is seeded: 🎲 (or `D`) rerolls, and typing
a seed into the box next to it brings that exact order back. Use the
slider (or `+`/`−`, or Ctrl+scroll) to size thumbnails, and toggle
crop/fit. The grid is virtualized, so 100k-image folders scroll like
100-image ones.

**Folder headers** (`G`) split the grid into one section per folder, with
a header you can click to go into that folder. With headers on, folders
stay in date order and the sort applies *within* each folder, so shuffle
shuffles each day's images separately. Turn them off for one continuous
feed shuffled across everything.

In the lightbox: `←`/`→` navigate, `Space` or click for 100% zoom, `F`
fullscreen, `Y`/`M`/`N` rate, `I` details.

### Search

The search box (`/`) matches the **file path and name**, your **notes**,
the **prompt** and the **model/LoRA names** read from the PNG. Every word
must match somewhere, but not necessarily in the same place. Each result
gets small tags saying which fields matched, and hovering over it shows the
matching text, highlighted.

**Colour** (`C`) opens a colour wheel. Results are images where a
noticeable share of the picture is near that colour, best match first.
Everything is on the wheel itself:

- **Disc**: hue around, saturation outward. Colours outside the search
  range are dimmed, so what's still lit is what counts as a match.
- **Outer ring**: full-strength hues with a marker, so you can see where
  you are in the spectrum even at brightness 0. Drag it to change hue only.
- **Left arc** (☀): brightness, or scroll over the wheel.
- **Right arc** (◎): range, i.e. how close counts, or Shift+scroll.

Below the wheel:

- **Swatches**: your own palettes, any number, any size. Click the colour
  preview (or a palette's **+**) to add the current colour, click a swatch
  to use it, right-click a swatch to remove it, right-click empty space for
  a new palette, double-click a name to rename it.
- **Profiles**: saved colour make-ups of images. **☆ Save** next to
  Colours in the details panel keeps one, with its proportions. Click a
  profile to rank images by how closely they match it.

In the details panel, an image's palette swatches start a colour search,
and **Similar colours** ranks everything by how close its colour make-up is
to that image. All of these combine with folders, filters and text search.
While sorting by best match, folder headers are off, so the ranking reads
straight down.

Prompts and palettes come from a **background indexer** that works through
every image once, current folder first. Its progress shows in the top bar
("Indexing 1,234 / 20,000"), and search covers whatever's indexed so far.
Palettes come from the cached thumbnail when there is one, so they work
for disconnected folders too. Prompts need the folder connected.

There's no AI here. Colour search is plain maths: a k-means palette in
OKLab, a colour space built so that distance matches what looks different.

### Galleries

An image can be in any number of galleries.

- Select images, then drag them onto a gallery, or onto **+ New gallery**
  to create one from the selection in one step.
- **Target gallery**: click ◉ on a gallery, then press `B` to add/remove
  the current image (lightbox, review) or the selection (library). With no
  target set, `B` makes a new gallery and targets it.
- **Custom order**: drag images within a gallery to arrange them. The
  gallery switches to "Custom order (drag)", and its order is saved.
- **Groups**: **+ Group** makes a group. Drag galleries onto it to file
  them, and drag galleries or groups to reorder the sidebar.
- **Show in folder** (details panel) jumps from any image, e.g. one in a
  gallery, back to its original folder with it selected.
- **Notes and history**: with a gallery open and nothing selected, the
  details panel (`I`, or **Info** in the gallery bar) shows the gallery's
  own markdown notes and a log of its history: created, renamed, images
  added/removed/rearranged.

### Smart galleries (saved searches)

**☆ Save** in the filter section saves what's on screen as a smart
gallery: where you are (folder or gallery), the rating filter, the search
words, and any colour / similar / profile match. It also records the
results at that moment as its **baseline**.

Smart galleries (⌕) live in the gallery list and keep checking themselves
as the library changes (new images scanned, ratings, indexing). A green
dot means the results are the same as the baseline. A red badge like
`+29 −3` means 29 new images now match and 3 saved ones no longer do.

Opening one puts its search back in the toolbar and adds a bar under it:

- New matches appear on top under **New since saved**, tagged NEW.
  **Hide new** hides them. **Accept all**, or **Accept N selected**, adds
  them to the baseline.
- **−N gone**, then **Forget**, drops saved results the search no longer
  finds.
- Change the search while one is open and the bar offers **Update** (save
  it, re-baselining) or **Revert**. ☆ Save makes it a new smart gallery
  instead.
- **Make gallery** creates an ordinary gallery from the selection, or else
  from the saved results. That gallery remembers the search it came from:
  its bar says "made from search …" with **Show the search**.

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
src/pngmeta.js    PNG tEXt/iTXt/zTXt reader (reads only up to the image data) + ComfyUI graph summarizer
src/features.js   background indexer: OKLab colour palettes + prompt/model text per image
src/colorpicker.js  the colour-search wheel
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
- **Plan:** (1) this sketch: multi-folder viewer core, galleries, modules,
  colour search, prompt search (done 2026-10-07). (2) Graduate to its own repo with a local Python backend
  (SQLite, GPU models) serving this UI. In-browser ML fights this repo's
  `file://` rule (no workers or `.wasm` fetches from `file://`). (3) People
  first, then CLIP search / similar images, smart galleries, and the UMAP
  map.
- **Rating UX needs rethinking.** Arrow keys read as "navigate", not
  "rate". A continual cull/re-rate loop feels promising, but the design is
  still open.
- **"More like this"** is only worth doing if it's content-aware (colour,
  composition, semantic similarity), not exact-prompt matching.

## Wishlist: semantic search

The dream: search "death" and get skulls, even when no prompt says
"death". That means matching by meaning, not by characters. It needs a
model, so it belongs to the local-backend phase. There are two halves:

- **Image content (CLIP / SigLIP).** One model embeds both images and text
  into the same space. "death" lands near pictures that *look* like it,
  whatever the prompt said or whether there's a prompt at all, so it
  works on photos too. The same vectors power "similar to this image"
  (by content, not just colour) and the UMAP map.
- **Prompt meaning (a sentence-embedding model).** Embeds the prompt text,
  so "death" finds prompts about skulls, graves or reapers. It's cheaper
  than CLIP and specific to generated images.

Both slot into the existing search box as another field, next to the
plain word match, and their results can be pinned as smart galleries.
Running them in this page is possible in principle (onnxruntime-web,
transformers.js), but they fetch model and `.wasm` files and want Web
Workers, which `file://` blocks. A Python sidecar on the GPU is the
straightforward route.

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
- **Gallery organizing**: cover images; nested groups (groups are one
  level for now).
- **Smart galleries**: save a search (folder + filter + words + colour)
  as a sidebar entry that stays live.
- **Colour search quality** on real archives is untested. Colour is
  measured on a 64px version, and the match threshold (8% of the image)
  may need tuning.
- **Very large libraries**: thumbnails are ~30 KB each in IndexedDB, so
  100k images is a few GB of browser storage. Phone photos in HEIC can't
  be decoded by browsers at all. Both point at the Python backend.
- Not yet verified against a real 50k-image archive. Also unverified: the
  persisted folder handle under `file://` on Windows Chrome. It's expected
  to work, but if it doesn't, the cost is one re-pick per session.
