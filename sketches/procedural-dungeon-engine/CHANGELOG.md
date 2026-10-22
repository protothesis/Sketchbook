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

- 2026-10-20: **Hash ghosts.** About 1 room in 14 starts with one, and rooms
  on cracked floor are much likelier. Ghosts drift through open doorways
  and notice you after 2 s in your lantern light. They then follow at
  1.5 cells/s until they've been 3 s out of your light or are 3+ rooms
  away. Nearness wobbles the screen and contact floods it with purple
  glitch and static; both wear off after you get clear. Collapsing a room
  unravels any ghost in it, for an **echo** (tracked on the HUD, no use
  yet). Positions persist with the run.

- 2026-10-20: Hash ghosts are slower to notice and easier to shake:
  - Noticing now takes two stages: after 1.2 s in your light a ghost stops
    and shows a "!", and after a beat a ring fills while your light stays
    on it (3 s). The ring drains when you look away, and the ghost goes
    back to wandering once it's empty.
  - Followers move at 0.9 cells/s (was 1.5).
  - A follower gives up after 2 s unlit (was 3) or with a room between you
    (was 3 rooms).

- 2026-10-20: Hash ghost readability:
  - The notice icon is "?" (was "!"); a follower shows a purple "!!".
  - The ring fills clockwise in violet while lit and rewinds
    counter-clockwise in a dim colour when not. For a follower it's the
    cool-down until it gives up.
  - Off-screen ghosts that are watching or following you get an edge
    marker with an arrow.
  - Ghosts hidden behind blocks or walls show as a dithered violet
    silhouette.

- 2026-10-20: Hash ghosts notice you after a moment of light (0.25 s, was
  1.2 s). Bumping into one activates it at once, but it reels for 1.2 s
  before following. Its see-through silhouette is much fainter (opacity
  0.15, was 0.55).
- 2026-10-20: Crouch is on Space (was C). Space no longer also acts like E.

- 2026-10-20: Contact glitch is now a brief full-strength flash (0.35 s)
  that settles to half strength while in contact. Hash ghosts follow at
  0.5 cells/s (was 0.9) and wander at 0.35, so you can always walk away.
  The collapse price is a flat 1 charge per room (was 1 per cell + 2 per
  room, in 15-point charges).

- 2026-10-20: **Chalk marks, doorstones, sigil energy.**
  - **Chalk marks replace map pins.** Chalk comes in five colours, each
    with its own mark (silver arrow, gold triangle, crimson cross, teal
    waves, violet crescent). A stick is 3 strokes, and the hotbar icon
    loses a third per stroke. F draws on the nearest free quarter-tile ahead
    (floor or a one-unit block); E on a mark wipes it. Marks show on the
    maps and persist. You start with one silver stick; more are found in
    about 1 room in 13.
  - **Group hotbar slots:** chalk sits in one slot. Click it again or hold
    it to open a colour picker, or press its number again to cycle. Built
    to generalise to other items.
  - **Doorstones** replace door chalk for opening doors in bare walls (same
    rarity; old saves' door chalk converts).
  - **The big map is a view only**, and opens zoomed in on you.
  - **Jars are how you collect ghosts.** Collapses no longer give echoes:
    ghosts in a collapsed branch (or in a jar that shatters) come undone,
    tallied with a short log in `run.unmade` for later. Echo pouring is gone.
  - **Sigil energy:**
    - stage 1–2: a beam and rising motes
    - a full jar: a flash, a big beam with a bright core, a radiating floor
      ring, and a pooled violet point light (no shadows)
- 2026-10-20: **Locked doors just open** (with a key). The checkpoint
  overlay is gone, but `showRecord` is kept for later. The first room past a
  locked door is marked "beyond a lock": a gold floor warmth, the caption,
  and a gold outline on the maps. It's derived from seeds (`pastLock`).
- 2026-10-20: **Map pins.** Coloured markers for the chart. You start with
  3 silver, and more are found in about 1 room in 13 (seeded colours). F
  drops one on the tile ahead (F again takes it back), or click the big map
  to place one and click a pin to take it back, with a colour palette in
  the map's bar. Pins persist.
- 2026-10-20: Jar placement:
  - Placing never prompts; a failed use of any item shakes the hotbar.
  - F picks the nearest free quarter-tile in front of you, including on
    top of one-unit blocks. Only a doorway's mouth is off limits.
  - A sigil takes up to four jars (one per quarter), each full jar giving
    +1 entropy max (up to +4).
- 2026-10-20: **Hotbar, jars and sigils.**
  - **Hotbar.** A slot bar for carried things. 1–9, the wheel or a tap
    selects; E interacts with the world, and F (or "use" on touch) uses the
    selected item. Chalk now draws doors with F, so E no longer does it by
    accident.
  - **Jars.** About 1 room in 15. Set them down with F and lift them with
    E, contents and all. They hold up to 3 hash ghosts: pour in echoes, or
    lead a following ghost into a placed jar to catch it. A collapse
    shatters a jar in the branch, and its ghosts become echoes.
  - **Sigil tiles.** About 1 room in 25. A jar on a sigil powers it one
    stage per ghost inside; at 3, entropy max +1 while it holds. Sigils
    stack.
  - Placed jars persist with the run.
- 2026-10-20: **Door chalk.** A rare item (about 1 room in 33, depth 2+). Press
  E facing a bare wall to draw a real door there: it opens onto a fresh
  room, or loops into the room behind the wall. It's never locked, and
  you can collapse through it. Engine: a new `carve` / `canCarve` adds an
  exit to an existing space and records a `carve` history event, so
  replay, export and the chart view keep drawn doors.
- 2026-10-20: The sustained contact glitch is at a quarter of the flash's
  strength (was half).
- 2026-10-21: **Walk mode is split into files.** The 3,200-line
  `app/play.js` is now ten classic scripts in `app/walk/` (core, world,
  figure, items, actions, input, ghosts, fx, hud, main), loaded in that
  order by `play.html`. They share one namespace, `DungeonPlay.walk`. Each
  file destructures what it needs from earlier files and exports what
  others use, and calls into a later file go through `W.` at call time.
  It's a mechanical move with no behaviour change: a scripted session
  (open doors, collapse, reopen) gave identical worlds and runs before and
  after.
- 2026-10-21: **The run save has a version.** `savePlayer` writes `v: 1`,
  and loading runs each migration step from the save's version up
  (`migrateRun` in `core.js`). Older saves count as version 0, and their
  step folds in the old patches: door chalk becomes doorstones, and leftover
  `pins` / `echoes` fields are dropped.

### Fixed

- 2026-10-20: Walk mode froze for a remote playtester the moment they
  picked up chalk. Their browser had cached copies of different versions:
  an older play.html with no chalk counter, next to a newer play.js. The
  HUD update threw, and the error stopped the game loop, while the HTML
  buttons kept working. Fixes:
  - `tools/serve.py`, a static server that sends `Cache-Control: no-cache`,
    so every machine revalidates every file and runs the same code.
  - The frame loop schedules its next frame before running, so an error
    can't stop it; the first error shows as an on-screen notice.
  - HUD writes skip missing elements.
  - A boot check shows a "files are out of date, hard-refresh" notice if
    the page and scripts don't match.
- 2026-10-20: Drawing a door with chalk could trap the figure. The room
  rebuilt with the new door, the block layout reshuffled around it, and a
  block could land on the figure (62 of 381 possible spots changed the
  layout). Layouts now use only a room's original doors. Later doors (drawn
  or loop) only clear blocks on their own cell, which also fixes the rare
  reshuffle when a loop door appeared. Plus a safety net: a figure inside a
  block steps out of its nearest side.
- 2026-10-20: The ghost screen effect (wobble and glitch) tanked the frame
  rate at full screen on high-DPI displays: about 71 ms a frame versus 21
  without it, measured at 1920×1080 on a 2× display. The scene was rendered
  into a half-float, 4× MSAA target at full device resolution. It now uses
  an 8-bit sRGB target with no MSAA, sized in CSS pixels (a quarter of the
  pixels at 2×). It also steps its resolution down toward half if it still
  slows frames, measured against the frame time without the effect.
  Effect-on frames now match effect-off ones.
- 2026-10-20: Hash ghosts noticed you from places that looked dark. The
  light test is now a 3D ray from the actual lamp (so crouching lowers it)
  that walls and blocks block, matching the cast shadows. Light range is now
  4.5 cells.
- 2026-10-20: Hash ghosts drifted through blocks. They now path around
  blocks taller than one unit and float over one-unit blocks.
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
