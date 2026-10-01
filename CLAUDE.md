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
3. **Add a row to the root `README.md`** table of contents (the `## Sketches`
   table), linking to the new folder.
4. **Add an entry to `sketches.data.js`** (the manifest the gallery reads) —
   see schema below.
5. **Commit** with a clear message once the scaffold is in place.

## Working on an existing sketch

- Log meaningful changes in the sketch's own `CHANGELOG.md`
  (Added/Changed/Fixed/Removed).
- Update the sketch's status in both the root README table and
  `sketches.data.js` as it matures (see Lifecycle below).
- If the sketch grows an interactive or visual artifact (an HTML page, a
  notebook export, a small canvas/WebGL toy, etc.), give it a browsable
  entry point at `sketches/<slug>/index.html` and set `demo` in its
  `sketches.data.js` entry to that path (relative to repo root) so it shows up
  as a live link in the gallery. If the demo lives somewhere else in the
  folder, point `demo` at that path instead.

## Lifecycle status labels

Keep it to these four so the README table and gallery stay simple:

- `seed` — just captured, not yet run/tested.
- `prototype` — working, still rough.
- `active` — being iterated on.
- `archived` — parked; kept for reference.

## `sketches.data.js` schema

A classic script (not JSON — see the `file://` constraint above) that sets
`window.SKETCHES` to an array of objects, one per sketch, kept in sync with
`sketches/`:

```js
{
  slug: "boids-flocking-sim",
  title: "Boids Flocking Sim",
  description: "One-line summary of the idea.",
  date: "2026-09-28",
  status: "seed",
  tags: ["canvas", "simulation"],
  demo: "sketches/boids-flocking-sim/index.html",
}
```

`demo` is optional — omit it (or use `null`) if the sketch has no
browsable artifact yet.

## Gallery (root `index.html`)

- A static, data-driven gallery page that reads `window.SKETCHES` (set by
  `sketches.data.js`, loaded via a plain `<script>` tag) and renders a card
  per sketch, linking to the sketch's demo when present and to its
  `README.md` otherwise.
- Don't hand-edit per-sketch rendering into `index.html` — it should stay
  generic and driven entirely by `sketches.data.js`.
- Works identically opened directly (`file://`) or via GitHub Pages.
  Deployment to Pages is handled by `.github/workflows/pages.yml` on pushes
  to the default branch. No manual dashboard steps required.

## General conventions

- Each sketch directory is self-contained. Don't assume shared root-level
  build tooling — pick whatever stack fits the individual sketch.
- Don't add abstractions, tests, or CI for a sketch unless it's actually
  outgrowing "quick prototype" status.
