# Sketchbook

A catchall repository for on-the-fly prototypes and sketches of all sorts.
Ideas start here when they're not yet formed enough to earn their own
repository — quick to capture (often from the Claude Code mobile app),
easy to come back to and refine later.

Browse it visually by opening `index.html` directly (double-click it, no
server needed) or via the GitHub Pages gallery for this repo (enable it once
under repo *Settings → Pages → Source: GitHub Actions* — the included
workflow then deploys it automatically on every push).

## Sketches

| Sketch | Description | Status | Demo |
| --- | --- | --- | --- |
| [xenoscope](sketches/xenoscope/) | Procedurally generated exoplanet systems with an invented astrological aspect chart. | prototype | [Live](sketches/xenoscope/index.html) |
| [psyche-town](sketches/psyche-town/) | A Sims-like town where autonomous forces of the psyche seize people and, usually, let them go. | prototype | [Live](sketches/psyche-town/index.html) |

Each row links to `sketches/<slug>/`, which has its own `README.md` and
`CHANGELOG.md`. This table (and the `sketches.data.js` manifest that drives
the gallery) is kept up to date automatically — see `CLAUDE.md` for the
workflow.

## Structure

```
sketches/<slug>/README.md      short description, status, date started
sketches/<slug>/CHANGELOG.md   per-sketch changelog (Keep a Changelog format)
sketches/<slug>/...            whatever the sketch actually needs
sketches.data.js                manifest consumed by the gallery
index.html                     the gallery page itself
```

## Browsing

`index.html` is a static, dependency-free gallery — open it directly from
disk (no server) or visit it via GitHub Pages; both work identically. Every
sketch's own `index.html` is held to the same bar: openable straight from
`file://`, no build step, no server. See `CLAUDE.md` for what that rules out
(ES modules, `fetch()` against local files, CDN-only dependencies) and how
to work within it.

Pages deployment runs automatically via `.github/workflows/pages.yml` on
every push to the default branch.
