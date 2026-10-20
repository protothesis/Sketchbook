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
- 2026-10-19: Walk mode (`play.html`, `app/play.js`), a third-person 3D
  client built on three.js (vendored r160). You move with WASD or a touch
  stick. Pushing into a closed door (or pressing E) calls `expand` + `commit`
  with fresh entropy. The new space then appears outward from the door while
  the door swings open. It also has lantern lighting with black fog, a
  cutaway for walls south of the figure, per-space captions, and a minimap.
  It shares the map view's autosave. Design parameters are in `PLAY.md`.

- 2026-10-19: Walk mode gameplay, first pass (see `PLAY.md`). There's an
  **entropy** meter (start 30, max 100). You can close a door you opened to
  collapse its whole branch for 1 entropy per cell plus 2 per room;
  reopening it rerolls, and a branch you can't afford stays. **Shards**
  (+10 entropy) and rare **keys** are seeded per room. Locked doors appear
  past depth 4, and unlocking one ends the walk on an **expedition record**
  screen (the seed chain to the door plus a tally). The rules live in
  `app/play-rules.js`; the engine is unchanged.
- 2026-10-19: Walk mode visuals. The lantern casts point-light shadows and
  ambient light is near zero, so you can't see around corners until your
  light reaches. Rooms dissolve in reverse when collapsed.

### Changed

- 2026-10-19: Walk mode no longer sinks walls near the figure. Walls in
  front of it get a screen-door dither inside a soft circle around it
  instead. The door prompt is now a button, so on touch you tap it to
  open, unlock or collapse.

### Fixed

- 2026-10-19: You can now move between views either way and start a new map
  from walk mode. Walk mode has **Chart view** and **New map** buttons (press
  New map twice to confirm, instead of `window.confirm()`, which some
  embedded viewers block). The chart view has a **Walk 3D** button on the
  map, and its header link is now readable on the dark theme.
