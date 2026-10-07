# Sketchbook — instructions for Claude

This repo is a catch-all for early-stage prototypes ("sketches") — ideas that
aren't formed enough to earn their own repository yet, but have enough of a
hook to start building. The main workflow is capturing a new sketch quickly
from the Claude Code mobile app while out and about, then refining it later
(mobile or desktop). Optimize every default in this file for that: low
friction now, easy to pick back up later.

**Every sketch with a browsable UI must work by double-clicking its
`index.html` — no local server, no build step.** Concretely, that rules out:

- `<script type="module">` and bare `import`/`export` — browsers block ES
  module loading when the page itself is `file://`. Use classic
  `<script src="...">` tags in dependency order instead, with each file
  attaching its public pieces to a sketch-specific global namespace object
  (e.g. `window.<SketchName> = window.<SketchName> || {}; window.<SketchName>.foo = foo;`)
  rather than `export`ing them.
- `fetch()` / `XMLHttpRequest` against local files — also blocked under
  `file://` in Chromium-based browsers. If a sketch needs a local data
  manifest, make it a classic script that sets a global
  (`window.SOME_DATA = [...]`) instead of a `.json` file loaded via `fetch`.
- CDN script tags for third-party libraries — vendor the dependency's
  classic/UMD build into the sketch's own `vendor/` folder instead (see
  `sketches/xenoscope/vendor/README.md` for a worked example, including how
  to mechanically convert an ES-module-only library like three.js's
  OrbitControls into a classic script). This also makes the sketch work
  offline and immune to a CDN going down or changing.

GitHub Pages serving the repo over HTTPS is secondary — it has to work
either way, but the `file://` case is the one that actually gets exercised
from the mobile workflow this repo is built around, so design for it first.

## Starting a new sketch

Trigger: the user describes a new idea/prototype that isn't an edit to an
existing sketch. Don't ask clarifying questions before scaffolding — pick
reasonable defaults and start; the user can redirect. Do the following
automatically, without asking permission first:

1. **Pick a slug**: kebab-case, short, derived from the idea (e.g. "a boids
   flocking sim" → `boids-flocking-sim`). Check `sketches/` for collisions
   and disambiguate with a numeric suffix if needed.
2. **Create `sketches/<slug>/`** containing:
   - `README.md` — one-line summary, a short description of the idea, the
     date started, and a status label (see Lifecycle below).
   - `CHANGELOG.md` — [Keep a Changelog](https://keepachangelog.com) format,
     seeded with a dated entry: "Initial sketch created."
   - Starter code appropriate to the idea. Match the scaffold to what's
     actually being built — a single HTML file for a visual toy, a script
     for a data experiment, etc. Don't over-scaffold (no build tooling,
     package.json, linters, etc.) unless the idea actually needs it.
   - `sketch.json` — the sketch's metadata (see schema below). This is the
     *only* way a sketch gets listed in the gallery and README.
3. **Don't touch the shared index files** — the root `README.md` sketches
   table and `sketches.data.js` are generated from every `sketch.json` by
   `tools/build-index.js`, which CI runs on each push to `main`. Editing
   them on a branch (by hand *or* by running the script and committing the
   output) brings back the merge conflicts this setup exists to prevent.
   Running `node tools/build-index.js` locally to preview the gallery is
   fine; just don't commit the result.
4. **Commit** with a clear message once the scaffold is in place.

## Working on an existing sketch

- Log meaningful changes in the sketch's own `CHANGELOG.md`
  (Added/Changed/Fixed/Removed).
- Update the sketch's status in its own `sketch.json` as it matures (see
  Lifecycle below). The README table and gallery pick it up after merge.
- If the sketch grows an interactive or visual artifact (an HTML page, a
  notebook export, a small canvas/WebGL toy, etc.), give it a browsable
  entry point at `sketches/<slug>/index.html` and set `"demo": "index.html"`
  in its `sketch.json` so it shows up as a live link in the gallery. If the
  demo lives somewhere else in the folder, point `demo` at that path
  (relative to the sketch folder) instead.

## Lifecycle status labels

Keep it to these four so the README table and gallery stay simple
(`tools/build-index.js` rejects anything else):

- `seed` — just captured, not yet run/tested.
- `prototype` — working, still rough.
- `active` — being iterated on.
- `archived` — parked; kept for reference.

## `sketch.json` schema

One per sketch at `sketches/<slug>/sketch.json`. The slug is the folder
name.

```json
{
  "title": "Boids Flocking Sim",
  "description": "One or two sentences for the gallery card.",
  "summary": "Optional shorter line for the README table (defaults to description).",
  "date": "2026-09-28",
  "status": "seed",
  "tags": ["canvas", "simulation"],
  "demo": "index.html"
}
```

`demo` is optional and relative to the sketch folder. Omit it (or use
`null`) if the sketch has no browsable artifact yet.

`tools/build-index.js` turns these into `sketches.data.js`, a classic script
(not JSON, because of the `file://` constraint above) that sets
`window.SKETCHES`, plus the README table between the
`<!-- sketches:start -->`/`<!-- sketches:end -->` markers. On a branch, the
root gallery won't list the new sketch until it's merged. Open the sketch's
own `index.html` to try it in the meantime.

## Gallery (root `index.html`)

- A static, data-driven gallery page that reads `window.SKETCHES` (set by
  the generated `sketches.data.js`, loaded via a plain `<script>` tag) and renders a card
  per sketch, linking to the sketch's demo when present and to its
  `README.md` otherwise.
- Don't hand-edit per-sketch rendering into `index.html` — it should stay
  generic and driven entirely by the generated manifest.
- Works identically opened directly (`file://`) or via GitHub Pages.
  Deployment to Pages is handled by `.github/workflows/pages.yml` on pushes
  to the default branch, which first regenerates and commits the index. No manual dashboard steps required.

## General conventions

- Each sketch directory is self-contained. Don't assume shared root-level
  build tooling — pick whatever stack fits the individual sketch.
- Don't add abstractions, tests, or CI for a sketch unless it's actually
  outgrowing "quick prototype" status.
