# Sketchbook — instructions for Claude

This repo is a catch-all for early-stage prototypes ("sketches") — ideas that
aren't formed enough to earn their own repository yet, but have enough of a
hook to start building. The main workflow is capturing a new sketch quickly
from the Claude Code mobile app while out and about, then refining it later
(mobile or desktop). Optimize every default in this file for that: low
friction now, easy to pick back up later.

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
4. **Add an entry to `sketches.json`** (the manifest the GitHub Pages
   gallery reads) — see schema below.
5. **Commit** with a clear message once the scaffold is in place.

## Working on an existing sketch

- Log meaningful changes in the sketch's own `CHANGELOG.md`
  (Added/Changed/Fixed/Removed).
- Update the sketch's status in both the root README table and
  `sketches.json` as it matures (see Lifecycle below).
- If the sketch grows an interactive or visual artifact (an HTML page, a
  notebook export, a small canvas/WebGL toy, etc.), give it a browsable
  entry point at `sketches/<slug>/index.html` and set `"demo"` in its
  `sketches.json` entry to that path (relative to repo root) so it shows up
  as a live link in the GitHub Pages gallery. If the demo lives somewhere
  else in the folder, point `"demo"` at that path instead.

## Lifecycle status labels

Keep it to these four so the README table and gallery stay simple:

- `seed` — just captured, not yet run/tested.
- `prototype` — working, still rough.
- `active` — being iterated on.
- `archived` — parked; kept for reference.

## `sketches.json` schema

Array of objects, one per sketch, kept in sync with `sketches/`:

```json
{
  "slug": "boids-flocking-sim",
  "title": "Boids Flocking Sim",
  "description": "One-line summary of the idea.",
  "date": "2026-09-28",
  "status": "seed",
  "tags": ["canvas", "simulation"],
  "demo": "sketches/boids-flocking-sim/index.html"
}
```

`demo` is optional — omit it (or use `null`) if the sketch has no
browsable artifact yet.

## GitHub Pages gallery

- Root `index.html` is a static, data-driven gallery page that fetches
  `sketches.json` and renders a card per sketch, linking to the sketch's
  demo when present and to its folder/README otherwise.
- Don't hand-edit per-sketch rendering into `index.html` — it should stay
  generic and driven entirely by `sketches.json`.
- Deployment is handled by `.github/workflows/pages.yml` on pushes to the
  default branch. No manual dashboard steps required.

## General conventions

- Each sketch directory is self-contained. Don't assume shared root-level
  build tooling — pick whatever stack fits the individual sketch.
- Don't add abstractions, tests, or CI for a sketch unless it's actually
  outgrowing "quick prototype" status.
