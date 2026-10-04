# Changelog

All notable changes to this sketch are logged here, per
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- 2026-10-04: Initial sketch created from the "Procedural Dungeon Engine —
  Prototype Design Doc" (copied to `DESIGN.md`).
- Engine (`engine/`): hash-chained seeds with fresh entropy, seeded per-space
  PRNG and derived streams, chamber/corridor/stub shape generators,
  spatial registry, `expand`/`commit`/`revert` with seeded placement
  fallbacks, caps, simple loop connections, and JSON export/import with
  exact replay.
- Prototype renderer (`app/`): pan/zoom canvas map, clickable doorways,
  ghosted candidate with Accept/Reroll, inspector, revert, caps, export/import,
  and debug toggles (grid, seed labels, registry occupancy, path to root).
  Expeditions autosave to `localStorage`.
- `stress-test.js`: headless checks for overlaps, registry rebuild, replay
  and cycles.
