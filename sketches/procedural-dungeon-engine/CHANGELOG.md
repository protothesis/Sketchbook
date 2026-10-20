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
- 2026-10-20 (playtest pass):
  - Entropy now comes in whole **charges**: 3 shards fuse into one, you
    start with 2, and you can hold up to 8. Shards are much more common.
  - A collapse spends whole charges, rounded up (one charge covers 15
    cost), and partial shards are kept.
  - Locked doors are rarer (2.5%) and are now **checkpoints**: unlocking
    one offers **Continue down** (it opens like any other door) or
    **Leave the dungeon** (this ends the run on the record, which persists).
  - The minimap now shows opened doors in green.
- 2026-10-20 (second playtest pass):
  - **Engine: traces.** `revert` now keeps the reverted space in
    `exp.traces` (its seed, cells, depth, meta and so on). Replay rebuilds
    traces from history, so older records gain them on import.
    `imprintAt(exp, "x,y")` lists the trace layers under a cell. Traces never
    block placement.
  - Walk mode: imprinted tiles are **cracked**. Traces show greyed on the
    minimap, the new big map and the chart view, and imprinted live cells
    get a tick mark.
  - **Big map:** M or tapping the minimap opens the chart nearly
    full-screen, with pan, wheel and pinch zoom, and Center and Close
    buttons.
  - **Props:** seeded blocks (full-cell in chamber interiors, or subgrid
    against a wall) that collide and cast shadows, plus flat floor detail.
  - **Crouch** (C or the button): a crawl with a lowered lantern. Crouched
    against a block you're "hidden".
  - **Locks before keys:** a key-capable room only shows its key while
    unopened locks outnumber keys. Lock chance now scales with depth
    (4.5% at depth 3, up to 9%).

- 2026-10-20 (polish pass):
  - Props moved to a true **2×2 subgrid**: singles, doubles, 2×2s and
    partition rows. They're flush, with no gaps between neighbours, and
    stack 1–3 units high (3 is a column). They can sit against walls, but
    never on a door's or item's cell. Each placement is kept only if all
    floor stays reachable.
  - **Climb:** push into a block or press E to step up (up to 2 units).
    You walk across tops of equal height and drop when you step off an edge.
  - Blocks no longer dither. The figure shows through anything in front of
    it as a dithered orange **silhouette**.
  - The dither now only touches east–west walls. Door frames (45%) and door
    panels (60%) are capped so doorways stay readable.

- 2026-10-20 (feel pass):
  - Blocks render as one seamless box each (no seam between units). 2×2s
    are more common (30% of chamber attempts, up from 20%).
  - Climbing is one unit at a time, never above one unit. It stands you up
    if you were crouched, and the hop rises first and then carries forward,
    eased in and out.
  - The lantern light is back on the held lamp (its direction was part of
    the feel) and now has its own collision. A ray from the body stops it
    short of walls, closed doors and taller blocks.

### Fixed

- 2026-10-20: Wall corners where a wall turns an inside corner (hall bends,
  L-shaped turns) showed a wall-thick notch. The two wall pieces only
  touched at a point, so a corner post now fills the gap.
- 2026-10-20: Vaulting no longer pulls you toward the block's middle. You
  keep your position along the face you're climbing and move in just far
  enough to stand on the edge.
- 2026-10-20: The lantern light could end up inside a wall (it sat at the
  held lamp, offset forward) and light rooms beyond it. It now sits over the
  body's center, and its height is capped below the wall tops when you
  stand on a block.
- 2026-10-20: Shadows looked detached from walls and floor. The shadow bias
  is much smaller now, with a little normal bias.
- 2026-10-20: Walk mode drew some floor tiles plain white. The shade index
  went negative at far-negative coordinates, which left those tiles with no
  material.
- 2026-10-20: `local/` (scratch files, like exported expeditions shared for
  debugging) is now git-ignored.
- 2026-10-20: The walk-mode dither now tests world position instead of view
  depth, so a south wall's whole face clears when you stand against it
  (before, a solid band stayed under the figure). The circle is also bigger
  and softer, and south walls get a light dither as you approach.
- 2026-10-19: You can now move between views either way and start a new map
  from walk mode. Walk mode has **Chart view** and **New map** buttons (press
  New map twice to confirm, instead of `window.confirm()`, which some
  embedded viewers block). The chart view has a **Walk 3D** button on the
  map, and its header link is now readable on the dark theme.
