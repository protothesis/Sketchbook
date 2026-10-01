# Changelog

All notable changes to this sketch are logged here, per
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Initial sketch created: procedural system generation (`engine/generate.js`),
  deterministic seeded RNG, invented planet archetype/glyph assignment
  (`engine/symbols.js`), position ephemeris (`engine/ephemeris.js`), and
  aspect calculation (`engine/aspects.js`).
- Reference web UI: three.js compressed-scale orrery view, SVG aspect-chart
  wheel, seed/speed/play controls, live aspect list.

### Fixed

- Opening `index.html` directly (`file://`, no server) produced dead
  buttons and no rendering, because ES modules (`type="module"`, also used
  by the three.js CDN import map) are blocked by browsers under `file://`.
  Converted `engine/` and `ui/` from ES modules to classic scripts attaching
  to a `window.Xenoscope` namespace, and vendored three.js's classic/UMD
  build plus a converted (ESM→classic) copy of OrbitControls instead of
  loading either from a CDN. Verified via headless-browser checks against a
  real `file://` URL.
