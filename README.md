# Sketchbook

A catchall repository for on-the-fly prototypes and sketches of all sorts.
Ideas start here when they're not yet formed enough to earn their own
repository — quick to capture (often from the Claude Code mobile app),
easy to come back to and refine later.

Browse it visually via the GitHub Pages gallery for this repo (enable it
once under repo *Settings → Pages → Source: GitHub Actions* — the included
workflow then deploys it automatically on every push).

## Sketches

| Sketch | Description | Status | Demo |
| --- | --- | --- | --- |
| _none yet_ | | | |

Each row links to `sketches/<slug>/`, which has its own `README.md` and
`CHANGELOG.md`. This table (and the `sketches.json` manifest that drives the
Pages gallery) is kept up to date automatically — see `CLAUDE.md` for the
workflow.

## Structure

```
sketches/<slug>/README.md      short description, status, date started
sketches/<slug>/CHANGELOG.md   per-sketch changelog (Keep a Changelog format)
sketches/<slug>/...            whatever the sketch actually needs
sketches.json                  manifest consumed by the Pages gallery
index.html                     the gallery page itself
```

## GitHub Pages

This repo publishes a static gallery of all sketches via GitHub Pages,
built from `sketches.json` — including live links to any sketch that has
an interactive/visual artifact. Deployment runs automatically via
`.github/workflows/pages.yml` on every push to the default branch.
