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
- 2026-10-26: **Gamepad support** in walk mode (`app/walk/gamepad.js`, the
  standard Gamepad API layout, polled each frame). The left stick walks,
  analog like the touch stick (a radial dead zone of 0.2, rescaled), and
  either trigger held runs. A is E (tap to act, hold to fill the ring), X is
  F, Y is the lamp, B crouches and backs out of a choice, dialog or the map,
  LB / RB step through the hotbar, the d-pad's ◀ ▶ changes a group's variant
  (jars, chalk), View is the map and Menu pauses. In a choice or a dialog, the
  d-pad or stick moves between options (held, it repeats) and A confirms. On
  the map, the stick pans, the triggers zoom and Y recenters. On the waystone
  travel map, ◀ ▶ steps through the awake stones and A travels. The camera
  is fixed, so the right stick is unused. Using the pad switches the prompts,
  captions and controls line to its glyphs (PlayStation shapes for a Sony
  pad), and its controls line shows even on touch screens. A key or a touch
  switches them back.
- 2026-10-26: **Jump.** Space (A on a pad; a jump button on touch). A tap is a
  hop, a held press clears a one-unit block, with a quick, low arc that peaks
  just after you clear the lip. It forgives: you can still jump just after
  walking off an edge, a press just before landing counts, and a block's top a
  hair above your feet catches you. Carrying or dragging a block allows only a
  hop. You still never stand higher than one unit; taller stacks and vessels
  are walls. Notes for a movement design conversation (hazards, dodge,
  noise, traversal) are in `PLAY.md`'s future directions.

### Changed

- 2026-10-26: **Controls for the jump.** Keyboard: Space jumps and crouch
  moves to C. Gamepad: A jumps, X interacts (was A), Y uses the item in hand
  (was X), L3 crouches, R3 is the lamp, and B is free in the world (still
  "back" in menus, choices and the map); in a choice, A or X confirms. Touch
  support is frozen: it keeps working (with a new jump button), but new
  features won't be designed or tested for it.
- 2026-10-26: Gravity is 30 cells/s² (was 9), the same for a jump and for
  stepping off an edge.
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
- 2026-10-21: **Opened doors show which way they go.** A collapse only
  works away from the root, so an opened door is now a green triangle,
  with its flat side on the threshold and its point in the room it opened.
  It shows on the maps and, for now, as a floor arrow in walk mode. Loops
  stay a plain green line.
- 2026-10-21: Maps: door marks are one tile wide (they used to overhang),
  every wall edge is drawn as a light line so rooms built wall to wall
  read as separate, and chalk marks are always plain, larger dots (no
  symbols).
- 2026-10-21: **Items come in three kinds** (`ITEMS` in `app/walk/items.js`):
  - Pickups (shards, keys) float and are collected by walking into them.
    Keys are now a ⚷ count beside the entropy meter, not a hotbar slot,
    since a locked door uses one by itself.
  - Tools (chalk, doorstones) lie still on the floor, and E takes them.
  - Objects (jars) stand in the world. A jar in a room's loot is now
    already standing there when the room appears, like a jar you set
    down, instead of floating as a pickup.
- 2026-10-21: **All jars share one hotbar slot**, grouped by fill with a
  count. Its default, "auto", sets down your fullest jar onto a sigil tile
  and your emptiest one anywhere else. The picker chooses a group for the
  next jar only.
- 2026-10-21: Maps: walls are a solid dark grey. Unopened and locked doors
  keep their bar and gain a point on the outside, toward where they'd
  open. The big map opens with **Tab** instead of M, so everything sits
  under the left hand.
- 2026-10-21: Map walls are near-black. A closed door's point starts at its
  bar's outer edge, and it shows in walk mode too, as an orange (or blue,
  if locked) floor point just past the door.
- 2026-10-21: **Rooms commit when you open a door out of them** (first step
  of [`GAME-DESIGN.md`](GAME-DESIGN.md)). Until then a room is provisional:
  closing the door you came in by rerolls it, for 1 charge. Once you open
  any door out of it, or a loop opens one into it, it's committed for good,
  and its door offers nothing. So a reroll only ever touches one room, and
  the old whole-branch collapse is gone. Green arrows now mark only doors
  into provisional rooms; other opened doors show as a plain green bar on
  the maps. Committing is derived from the expedition history
  (`DP.committed`), so old saves need no migration.
- 2026-10-21: **Push blocks**, the first restoration task (step 2 of
  [`GAME-DESIGN.md`](GAME-DESIGN.md)). About 1 room in 5 has a block out of
  place and a matching floor mark in the same row or column (`DP.pushBlocks`,
  seeded on its own `'push'` stream, so nothing else shifts). Walk into it
  to push it half a cell; E pulls it back toward you. Home, it locks, lights
  up and pays 1 charge once. New file `app/walk/restore.js`, loaded after
  `items.js`; positions are kept in `run.pushed`.
- 2026-10-21: **Sconces**, the second restoration task (step 3 of
  [`GAME-DESIGN.md`](GAME-DESIGN.md)). About 1 room in 3 has an unlit sconce
  on a wall (`DP.sconces`, own `'sconce'` stream, never on south walls).
  E lights it from your lantern for 1 shard, once; it stays lit
  (`run.lit`) and lights the room, through a pool of three real lights
  given to the nearest lit sconces.
- 2026-10-21: **Entropy retuned toward restoration** (step 4 of
  [`GAME-DESIGN.md`](GAME-DESIGN.md)). Shards are rarer: 30% of chambers,
  15% of corridors, 20% of dead ends (were 75/40/50%). Measured income is
  now about 0.27 shards per room from pickups and about 0.9 from
  restoration, so a thorough player earns a charge every ~2.5 rooms, most
  of it by restoring. Rooms that held a shard may now not, and items that
  came after the shards in a room's loot can sit on a different tile.
- 2026-10-22: **A goal and a clock** (the second slice of
  [`GAME-DESIGN.md`](GAME-DESIGN.md), sections 7–10, written up the same
  day).
  - **Halls**, a new archetype: big, with notched corners. New expeditions
    start in one (`params.starter: 'hall'`), with at least two doors, a
    **surface door** (`Exit.kind: 'surface'`, never expands; walk mode asks
    "Up to the surface (quit game)?" and shows the expedition record until
    you go back down) and an awake waystone. Older saves keep their root
    chamber.
  - **Reserved footprints** in the engine (`DE.reserve`, a `'reserve'`
    history event, `exp.reserves`). Ordinary rooms never grow into one; a
    door into it builds the reserved space from its own seed; any room built
    against one gets a door into it. Replay, export and the chart view keep
    them. The stress test now reserves footprints too.
  - **Waypoints**: sets of three hall footprints (two near, one far,
    `DP.waypointSet`), shown as a glowing violet "?" on both maps (pinned to
    the edge when off the map), not at the footprint's exact centre. The
    first set comes from the starter hall; opening a door into a waypoint's
    hall reveals the next set, out past it. A setpiece hall is committed on
    arrival and always holds three push blocks (in different colours), at
    least one sconce and a waystone.
  - **Waystones**: small monoliths with seeded glyphs. Wake one for 1
    charge; E at an awake one travels to another (free). New file
    `app/walk/waystones.js`, loaded after `restore.js`.
  - **The lamp burns entropy**: a shard every 12 s in a dark room, nothing
    in a lit one (a lit sconce or an awake waystone). It dims on the last
    charge; when it runs out it gutters, the world fades out, and you wake
    at your last waystone with 2 charges, keeping everything else.
- 2026-10-22: **Lighting a sconce costs a shard** instead of paying one; in
  return its room never drains the lamp.
- 2026-10-22: **Push blocks are solid colour** (the whole block, not a
  coloured top). Programmer art for now.
- 2026-10-22: **After the first playtest of waypoints and the lamp** (notes
  in `PLAY.md`):
  - Waypoints are much farther apart: near 25–35 cells, far 45–60.
  - New waypoints come from **waking a waystone**, not arriving: 0–3
    (`RULES.waypointOdds`, seeded by the hall; never 0 while none wait).
  - **Unmarked halls**: a rare ordinary room (2.5%, depth 3+) is a hall
    with a dormant waystone (`params.hallChance`, `DE.hallShape`). Older
    records don't roll them, so they replay unchanged.
  - **Travel on the map**: E at an awake waystone opens the big map framed
    on the awake ones, which pulse; tap one to go.
  - **Entropy is a fluid fuel** (`run.fuel`, in charges; run save v2
    migrates). The lamp burns it continuously, except within a tile of a
    lit sconce; waystones no longer shelter it. Any gain holds the burn
    for 3 s. New file `app/walk/lamp.js` (after `waystones.js`).
  - **A HUD of its own for the lamp**, bottom left: a lantern icon in the
    lamp's colour and a sectioned fluid meter, plus keys. The top-left
    panel is information and settings only; crouched/hidden is gone.
  - **The lamp shows its state**: colour from yellow through red to grey,
    flicker, a dithered halo that shrinks and fades, a trail of sparks, and
    a light that dims and shortens. A purple +◆ floats over your head when
    entropy comes in.
  - **Push blocks move after they're home**; off the mark takes their
    charge back, home again pays back only that.
  - Ghosts: the proximity **wobble is switched off** (`WOBBLE`, code kept).
    Off-screen **markers ride a ring** around the figure, and idle ghosts in
    your room or the next get one too.
  - Fixed: waking or travelling showed the room's log line instead of the
    wake/travel caption.
- 2026-10-22: **After the voice-memo playtest** (the transcript is
  [`notes/playtest-2026-10-22-voice-memo.md`](notes/playtest-2026-10-22-voice-memo.md);
  points in `PLAY.md`):
  - **The lamp's look**: the halo is a flat, see-through disc with a hard
    edge (no dither), and bigger (`HALO` in `lamp.js`). Standing still, the
    sparks become embers rising in a slow, swaying column; walking, they
    still trail (`EMBER`).
  - **Slower pacing**: the lamp burns a shard every 18 s (was 12), the tank
    holds 6 charges (was 8), and a push block pays 2 shards (was a charge).
  - **Psychic stamina**, a second meter under the lamp's. A ghost's touch
    knocks off 15% and drains it while you're in its reach, which swells
    once it has hold of you (`GHOST.swell`). An empty lamp no longer
    gutters at once: it goes dark and the dark drains stamina at the same
    rate. Empty stamina: you pass out and wake at your last waystone. It
    refills in light after 1.5 s of nothing draining it. The screen's edges
    close in as it falls.
  - **Ghosts stay.** Jars no longer catch them, and a room can't be
    rerolled while a ghost is in it.
  - **Pixies** (new, `app/walk/pixies.js`): small violet lights with wings
    in about 1 room in 10 (`'pixie'` stream). F with an empty jar near one
    catches it. A jar holds one pixie (was three ghosts); a pixie jar on a
    sigil wakes it fully, +1 entropy max. Run save v3 migrates filled jars
    to pixie jars.
  - **The ecology** (new, `app/walk/ecology.js`): a first pass at emergent
    behaviour. Creatures respond to tags through a small table of rules:
    ghosts seek pixies (free or jarred), pixies flee ghosts, pixies linger
    at wells. See [`EMERGENCE.md`](EMERGENCE.md).
  - **Entropy wells** (new, `app/walk/wells.js`, `DP.well`): a basin in
    about 1 room in 20. Stand in it and it pours entropy into the lamp, a
    charge at most, then runs dry. Surge wells come back all at once after
    90 s; trickle wells refill slowly from 10 s after you last drew on them.
    Blocks keep off a well's tile, so rooms that gained a well may have
    shifted blocks.
  - **Awake waystones glow**: their glyphs shine through light and shadow,
    a faint violet shaft rises from them, and the nearest two cast a
    violet-blue light.
  - **Ley lines**: awake waystones join their two nearest and form one
    network, drawn on both maps. Travel rides the lines, a shard per line,
    by the fewest lines; the travel map shows each stone's fare and lights
    up the route under the pointer.
  - **Fewer unmarked halls**: 1 room in 100 (was 1 in 40), for new
    expeditions; older records keep their odds.
- 2026-10-22: **After playing that build** (notes in `PLAY.md`):
  - **The lamp in three stages** (uneasy at 2 charges, danger at 1, dying
    at half; `lampUneasy`, `lampDying`), blended through an `UNREST` table
    so nothing pops. The halo wobbles and flickers with the flame (more as
    it fails, sometimes past its average) and lasts until the lamp is out.
    The light reddens and its reach shrinks to under a fifth; below a
    charge a faint ring on the floor marks where it ends. Dying: a slow
    irregular fade that swells as you move, and the odd red ember.
  - **R covers or relights the lamp** (or tap its icon). Out of fuel, it
    stays out until relit, for a shard (`relightShards`); entropy alone no
    longer relights it. Covered: no light, no burn, ghosts can't notice
    you, and the dark drains stamina.
  - **The dark drains stamina slower**: 8% a second (`staminaDarkDrain`).
  - **A bigger lamp HUD**: icon and meter twice the size (smaller on
    phones), the flame lower at each stage, no state text. By a sconce the
    icon shimmers gold and motes stream from the sconce's flame into the
    lamp; at a well, violet, with a stream from the pool (`W.feedFrom`).
  - **The ecology sees light**: your lamp and lit sconces and awake
    waystones are presences. Pixies flee light; ghosts shy from steady
    light. A ghost within 2.5 cells of a pixie is held by it, even off a
    chase, and circles it closely; it leans toward it, and a jarred pixie
    flares.
  - **Wells show their clocks**: a surge well's rim has eight notches that
    light through its cooldown, then it bursts back; a trickle well has a
    spout where a drop forms through its wait, then drips with ripples.
  - **Ley links stay once made** (`run.ley`): a woken stone links to its
    two nearest awake stones. Older saves get the tidy network once.
  - Fixed: the figure dithered itself where its head or lamp overlapped
    its body. Its parts now mark the stencil and the silhouette skips them.
- 2026-10-24: **A game loop** (`GAME-DESIGN.md`, section 17):
  - **Save slots** (`app/walk/saves.js`, standalone on `DungeonPlay.saves`,
    with a swappable backend): *resume*, written every second, on pagehide
    and on quitting to the menu; *checkpoint*, written when you use a
    waystone. Every save is stamped with a build (`BUILD`); one from
    another build isn't loaded. That replaces gating generator changes
    behind params for old records. Saves from before slots come over once.
  - **A title screen** (Continue, New run, Import / Export save, as one
    file holding both slots) and **a pause menu** (Esc, or the Menu button
    that replaces New map; Resume, Quit to main menu). The N key is gone.
  - **Fainting costs progress.** Every room opened since your last
    checkpoint becomes a **lost path**, every door carved since is walled
    up, and the run rolls back to the checkpoint (inventory, entropy,
    keys, lit sconces, pushed blocks...); tallies and the thread carry on.
  - **Lost paths, apart from rerolls.** Quiet (violet on the map, no cracks
    or ghosts) until you choose at its door: **retrace** it (E: every room
    as you left it, a shard per room, at least a charge; needs **the
    thread**, a rare find at depth 3+, kept for the run) or **let it go**
    (push: something new opens, and the whole path turns to corruption).
    Left alone, a path dims at the next faint and fades at the one after.
  - New run asks first (one run at a time: it replaces yours; export
    offered), and its confirm now shows over the title screen (it opened
    behind it, so the menu seemed stuck).
  - A waystone hall that isn't where you'd wake says so as you enter
    ("touch the waystone to wake here").
  - Engine: `revert(exp, id, cause, quiet)`, `tagTraces` (quiet traces
    leave no imprint), `restorable` / `restore` (a trace built again, same
    id, seed and cells, via `expand(..., restore)`), `uncarve`. Replay is
    exact (`stress-test.js` checks restores, tags and uncarves).
  - The chart view still reads walk mode's record, but its own edits no
    longer flow into walk mode.
- 2026-10-24: **Crates**, the first step of the interaction cleanup
  (`INTERACTION-PLAN.md`): about 2 in 5 single one-unit prop blocks are
  loose wooden crates, pushed and pulled like push blocks but with no home
  and no reward (`crateChance`, its own `'crate'` stream). Moved crates
  persist in `run.pushed`.
- 2026-10-24: **Playtest round 2.** No E prompt line or focus brackets on
  a keyboard (fewer callouts; touch keeps its E button). Dragging a block
  is smooth along the grab axis, slower than walking by weight (crate,
  vessel, stone), and eases into the nearest half-cell when you let go.
  A carried block goes down right where you lifted it if you haven't
  moved, otherwise straight ahead along your facing. Travelling from a
  waystone takes a hold.
- 2026-10-24: **Known issue:** dragging grabbed blocks is still glitchy
  in play; a thorough investigation is needed (GitHub issue #26).
- 2026-10-24: **Fixed:** fainting while carrying a block left it in your
  hands and duplicated it when the checkpoint rebuilt the world. A
  rebuild now starts with empty hands; what you carry comes from the run.
- 2026-10-24: **Jars and vessels** (playtest round 1, step 5). A jar is a
  plain tool now: walk over one to collect it; it lives in the bag (shown
  in your left hand) and never goes back into the world, so a jar in
  hand no longer ties up E. **Vessels** are new: a clay urn in about 1
  room in 10, a loose object like a crate (grab, lift, carry, set down,
  stack), holding up to 3 of one kind. F with a full jar pours it in; F
  with an empty jar takes one out. A vessel of pixies draws ghosts and
  powers a sigil (+1 entropy max per pixie). **Run save v6**: jars that
  were set down become vessels holding what they held.
- 2026-10-24: **Stacking** (playtest round 1, step 4). Set a carried
  block down at your level or one up, on the floor or on top of anything
  that covers the whole half-cell (a fixed block, another crate); stacks
  reach 3 units. Lift a block at your level or one up, never one with
  something on it; push and pull on the floor only. An object's level is
  saved (`lv` in `run.objects`, 0 by default, so no save change).
- 2026-10-24: **Blocks travel** (playtest round 1, step 3). Crates and
  push blocks live in one run-wide list (`run.objects`) instead of with
  their room. Carried, they go anywhere and can be set down in any room
  (pushing still keeps them in their room). A rerolled room despawns what
  sits in it into `run.despawned` ("a block goes with it"); one in your
  hands or elsewhere stays. **Run save v5**: `run.pushed` becomes
  `run.objects` (kind and colour filled in from the room when it's built).
- 2026-10-24: **Grab** (playtest round 1, step 2). Crates and push
  blocks can be climbed: walking into one climbs it now, instead of
  shoving it. Hold E at one (0.4 s) to grab it: let go without moving and
  you lift it, in an arc up over your head (and back down when you set it
  down); move while holding and you push or pull it along that axis, half
  a cell at a time, moving with it; let go while moving and you let go.
  Pull is back, as part of the grab. Lifting a jar takes a 0.35 s hold.
- 2026-10-24: **After the first playtest of the cleanup** (plan in
  `INTERACTION-PLAN.md`, "Playtest round 1"): held items are their true
  size and cast no shadow; a new item goes into the bag and never into
  your hands; pushing a block or climbing no longer shows the hold ring
  (doors still do).
- 2026-10-24: **The jar swipe** (interaction cleanup, step 6). F swipes
  the jar in your hands, and the swipe always plays: an empty jar catches
  a pixie close by, or scoops a full entropy well you're standing in (with
  an empty jar in hand, the well waits for your swipe instead of pouring
  into the lamp); a jar of entropy pours into your lamp, one charge, all
  or nothing. Jars are grouped by what they hold (empty, pixie, entropy);
  "auto" is gone. A jar of entropy glows violet inside.
- 2026-10-24: **Run save v4.** A jar records what it holds (`holds: null |
  'pixie' | 'entropy'`) instead of a pixie count. Save snapshots now carry
  `runVersion` and older runs are migrated as they load (before this, a
  slot save skipped `RUN_MIGRATIONS`), so this needed no new `BUILD`: an
  existing save still loads, its pixie jars intact.
- 2026-10-24: **Carrying** (interaction cleanup, step 5). E lifts a push
  block or crate and you carry it over your head; E sets it down on the
  free half-cell ahead, shown by a faint box, so a block is never stuck.
  **Pull is gone.** Set down on its mark, a block settles and pays as
  before; lifting one that's home is a 0.5 s hold (it takes its entropy
  back). Hands full: E only sets down, F does nothing, the hotbar won't
  switch, and no climbing or running. The carried block is saved
  (`run.carry`). A jar in your hands is set down with E now, not F.
- 2026-10-24: **Hands** (interaction cleanup, step 4). What's selected
  on the hotbar is what you hold, and the figure shows it: a tool in its
  left hand, a jar over its head. Slot 1 is always the lantern (empty
  hands); F with it covers or relights the lamp (R still works). Tools
  (chalk, doorstones, and now keys) lie flat and are collected by walking
  over them; with empty hands a new tool goes into them, otherwise into
  the bag. **Keys are a tool**: F with one in hand unlocks a door, then you
  open it as usual; E at a lock only says so. The key count by the lamp
  is gone (the thread is still shown there).
- 2026-10-24: **Hold to act** (interaction cleanup, step 3). Anything
  that changes the world takes E held while a ring (like a ghost's) fills
  over the target with the action's icon: doors 0.35 s (as long as a
  push, which fills the same ring), wiping chalk 0.4 s, sconces 0.5 s,
  waking a waystone 0.7 s, rerolling or retracing 1 s. Taking, lifting,
  climbing, pulling and travelling stay a tap; a tap at something you
  can't do says why. On touch, press and hold the E prompt.
- 2026-10-24: **Any opened door closes** (hold E, from either side),
  except into a provisional room, where closing is the reroll. A closed
  door is a wall to you, ghosts and light until you open it again (push or
  hold E). Saved in `run.closed`; orange on the maps.
- 2026-10-24: **Snuff a sconce** (hold E at a lit one): its shard goes back
  to your lamp and off the restored tally.
- 2026-10-24: **E acts on what you face** (interaction cleanup, step 2).
  The fixed priority order (doors first, then waystones, tools, jars,
  marks, push blocks, sconces, blocks) is gone: of everything in reach,
  the thing you're most squarely facing wins, nearer breaking ties, so a
  sconce beside a door no longer opens the door. Faint corner brackets
  frame the focused thing. The prompt is two lines, E's and F's, each
  starting with its key (tap a line on touch), so a doorstone's or a
  pixie's prompt no longer hides behind E's. Wiping a chalk mark now means
  facing it (within 0.7 cells), not standing on it.
- 2026-10-24: `INTERACTION-PLAN.md`: the agreed plan for E/F, hold-to-act,
  hands and carrying, jars, sconces and keys.

- 2026-10-24: **Doors and the silhouette:**
  - Door panels are solid and never dither. The doorway's frame (jambs and
    lintel, which dithered less and were a lighter colour so a south-wall
    doorway stayed readable) is plain wall again and dithers with it.
  - The figure's orange **silhouette** behind blocks, doors and walls is
    back (and a little stronger, 85%). It had stopped showing when the
    figure began marking the stencil: drawn before a block in front of it,
    the figure marked pixels the block then covered. The figure now draws
    after every other solid thing.
  - A door to a **lost path** shimmers: a rippling violet glow strongest at
    the panel's edges, on both faces, and sparks drifting up its sides.
- 2026-10-24: **Shadow creepers** (`app/walk/creepers.js`, tunables in
  `CREEPER`): a small dark capsule with one emissive red eye that always
  faces you. About 1 room in 12 from depth 2 (`RULES.creeperChance`,
  rolled once per room, saved like pixies). It hops (a dip, an arc, a
  landing squish, a nervous pause) with a contact shadow, and walks around
  every block. Its mood follows your lamp: *afraid* (over two charges) it
  waits just past the light's edge and never steps inside, scrambling back
  if you walk at it, and flinching, blinking and dashing off if your light
  hits it; *bold* (the last two charges) the same with a thinner margin,
  a little inside the edge; *hunting* (under one charge, or the lamp
  covered or out) it skitters about you and now and then winds up and
  dashes at you. It keeps its waiting spot until that stops being at the
  edge, so it doesn't jitter between shadows. Lurking, it hops slowly
  between dark corners and keeps off steady light (an ecology rule). Bold
  or hunting, it drains psychic stamina like the dark, in bands
  (`CREEPER.bands`, × `RULES.staminaCreeperDrain`, in its sight): bold, a
  faint pull within 0.55 cells; hunting, full within 0.45 and about half
  out to 0.75, and half again harder while it dashes. Afraid, it doesn't
  drain. Creepers stack. While it hunts, its bands show as faint solid
  discs on the floor (flaring as it dashes; `CREEPER.debugBands` shows
  them in every mood that has bands), and a subtle red glitch eases in. Its hops average well under walking pace. Blinks:
  every 2-6 s, sometimes a quick double or triple. New: `lightRadius()` in
  `lamp.js` (the floor ring's radius, growing to 4.5 cells at a full lamp).
- 2026-10-24: **A creature kit** (`app/walk/creatures.js`): the movement
  and light helpers ghosts had (half-cell paths, drifting, `lightReaches`)
  moved out of `ghosts.js` for every creature type to use. A creature can
  set its own `tall` (blocks above that are in its way; 0 for walkers) and
  `radius`, and `lightReaches` takes an optional range.
- 2026-10-24: **Screen effect profiles** (`fx.js`, `FX_PROFILES`): the
  ghost's glitch post-process is now general. Each creature kind has a
  profile (tear, colour split, static, scanlines, tint, glow) and a level;
  levels add up, so effects mix and stack. Ghosts look as before; creepers
  use a much subtler red one that eases in (`fxToward`).
- 2026-10-24: **Off-screen markers for any creature** (`app/walk/markers.js`):
  the ghosts' ring markers moved out of `ghosts.js` into a module each
  creature kind registers with (which ones want a marker, the icon, the
  ring's colour). Ghosts look as before; shadow creepers get a dark disc
  with the red eye (it blinks there too), ringed red while stalking and
  faint red while lurking in your room or the next.
- 2026-10-25: **Leave dragged objects anywhere.** Let go of a block you're
  dragging and it stays exactly where it stopped, off the grid (saved as
  an offset, `ox`/`oy` in `run.objects`, from its nearest half-cell). It
  only **sockets** when it stops within 0.1 cell of a half-cell both ways,
  with a short ease in. While you drag, a faint corner-bracket outline
  shows the next notch ahead the way it's moving, and brightens once
  letting go would socket it. A push block is home only socketed on its
  mark. Stacking and set-down stay on the grid: nothing goes on top of (or
  overlapping) an object left off it.
- 2026-10-25: **Heaviness.**
  - Heft: a dragged object takes a moment to get going and to stop (stone
    more than a crate), and coasts a little when you let go.
  - Pulling runs at 0.7 of push speed.
  - Lifting and setting down takes 0.6 s for stone, 0.38 s for a crate
    and 0.32 s for a vessel.
  - Carrying overhead, you walk at 0.7 of your speed with stone and 0.85
    with a crate.
- 2026-10-25: **The lamp's light has a hard edge** (item B of
  `notes/action-list-2026-10-25.md`). Inside a circle around you the light
  looks as before; past it there's only the ambient fill. The circle is
  always there, full lamp included (3.2 cells, where the light used to
  reach across rooms), and shrinks with the fuel to 0.9 cells. It's a mask
  on the lantern in every lit material's shader (`lamp.js`), measured
  across the ground, so walls are cut at the same distance as the floor.
  The additive floor ring under 1 charge is gone. `lightRadius()` returns
  the edge, so creepers wait just past what you can see. New `LIGHT` keys
  for the dev panel: `radiusFull`, `radiusEmpty`, `radiusCurve`,
  `breathe`, `soft`, and a banding toggle (`banded`, `bands`, `bandWidth`,
  `bandFloor`) that steps the light down just inside the edge, like a
  creeper's discs. Off by default. Screenshots in `notes/screenshots/`.
- 2026-10-25: **A dev panel** (`app/walk/dev.js`), toggled with `` ` `` (backquote,
  above Tab). It can give you any item or tool (shards, a full or empty
  lamp, stamina, keys, doorstones, jars empty or filled, the thread, every
  chalk colour, a crate, block or vessel in your hands). It can spawn a
  ghost, pixie or creeper in front of you, or clear them all, and teleport
  you to a waystone or wherever you click on the big map. It also has live
  tuning: sliders, number boxes and checkboxes built from the tuning tables
  on `DungeonPlay.walk` (`RULES`, `LIGHT`, `HALO`, `UNREST`, `EMBER`,
  `STREAM`, `CREEPER`, `GHOST`, `PIXIE`, `CREATURE`, `ECOLOGY`, `WELL`,
  `GLOW`), grouped per table with a reset per table and overall. Changed
  values show in gold and stay across reloads (in their own localStorage
  key, never the save). "Copy changes" puts them on the clipboard as JSON.
  `lamp.js`, `ghosts.js` and `waystones.js` now export their tables for it.
- 2026-10-26: **Light pools** (`app/walk/light.js`): one floor layer for
  the look and the gameplay, replacing the lamp's mask.
  - The lights look as they did before the mask, walls included: the
    lamp's long falloff and subtle flicker are back.
  - Your lamp and lit sconces own a pool: a steady circle on the floor
    (`LIGHT.poolFull` 3.2 to `poolEmpty` 0.9 cells, `SCONCE_LIGHT.pool` 2).
    On faces turned up, their light shows only inside the pools: the core,
    3 bands of 0.32 cells down to 20% at the edge (`POOL`), then dark.
  - Overlapping pools merge: each floor point takes the strongest pool, so
    there are only those few values and no interference.
  - The flicker no longer moves the edge (`LIGHT.breathe`, now 0).
  - Creatures read the pools: a spot is lit inside a pool with nothing
    blocking it. Ghosts notice you only inside your pool (was a fixed 4.5
    cells, well outside the visible edge). Pixies flee any pool they're in
    (was 2.5 cells). Ghosts and creepers are pushed out of lit sconces'
    pools (was 1.6 and 2.4 cells). You're sheltered standing in one (was
    its tile and the 8 around it).
  - Waystones no longer push ghosts and creepers away or scare pixies.
    They're their own kind of light, with no pool and a `waystone`
    presence for a later area effect.
  - `POOL` and `SCONCE_LIGHT` are in the dev panel. Screenshot:
    `notes/screenshots/light-pool-2-charges.jpg`.
- 2026-10-25: **Moods form regions.** A room now usually carries on its
  parent's mood, with a hue near its parent's, so a branch has stretches of
  one character (about 80% of rooms keep their parent's mood, against about
  10% by chance before). When it doesn't, the new mood starts a region of its
  own, and more often than not it's one the old mood leads into (a small
  table, `DungeonEngine.MOOD_JUNCTIONS`: damp leads to cold, breathing or
  echoing, and so on). Tuning is `DungeonEngine.MOOD_REGIONS` (`inherit`,
  `junction`, `hueDrift`), copied into a new expedition's params, so a
  change needs a new expedition and a replay uses the values it was made
  with. `inherit: 0` turns it off: params and rooms then come out exactly as
  before. The decision is on its own stream (`'region'`), so layouts, loot
  and everything else seeded are unchanged either way; only moods and hues
  differ. Records from before (no `moodInherit` in their params) keep their
  old moods. Waypoint halls and the root roll their own. `stress-test.js`
  checks the regions.
- 2026-10-26: **The thread is now the hourglass, and it's the key to a lost
  path** (`app/walk/hourglass.js`).
  - Same find (1 room in 20, depth 3+, one per run), but it starts empty and
    holds one pixie: F with it near a pixie catches it (the jar's catch), F
    at a vessel pours it in or takes one out of a vessel of pixies. A pixie
    glows in its lower bulb and its hotbar glyph when charged; the 🧵 under
    the lamp is gone.
  - **At a lost path's door, E held rerolls** (1 s, twice that with
    something of yours on the path; the ring shows what's lost), and **F
    with a charged hourglass in hand retraces** (a shard a room, as before,
    and the pixie). Without a charged hourglass the reroll is all there is.
    A door onto ground the path holds works the same way.
  - The retrace-or-reroll choice is kept behind a switch,
    `RULES.lostDoorChoice` (off; on the dev panel), in case this doesn't
    play well. On, it's the choice as before, its retrace needing a charged
    hourglass and spending the pixie.
  - It's the first **equipment**, a draft item class that's always with you
    (`run.equipment`): a faint leaves it out of your pack, pixie and all.
  - Saves carry on: run version 9; a thread you'd found becomes an empty
    hourglass. The loot roll is unchanged (its id is still `thread`), so
    there's no new build. Dev panel: "hourglass" and "hourglass: pixie" in
    place of "thread".
- 2026-10-26: **Lost paths read on the maps; packs shine.**
  - Doors to a lost path (its own door, or one onto ground it holds) are
    violet on the maps, like their seam.
  - Lost paths are hatched, by stage: since your last faint, a violet fill
    that breathes, close hatching and a solid glowing edge; dimmed (gone at
    the next faint), fainter, sparse hatching and a dashed edge.
  - A pack's little lantern is a real light now: like your lamp at the fuel
    it holds (brightness, reach, colour, floor pool), without shadows, on
    the nearest pack; even an empty one glows dimly (`PACK_LIGHT`).
- 2026-10-26: **Lost paths hold their ground.** A room opened next to a lost
  path could grow over it, and then the path couldn't come back. Now no new
  room is placed on a lost path's cells while it waits (the engine's
  `heldAt`, like a waypoint's reserve; a room coming back ignores it), and a
  door whose far side is that ground joins the path's choice: retrace (then
  it opens onto the path like a loop) or open anyway (the path is let go).
  Switched on by a 'hold' event in the history (`DE.holdLostPaths`, called
  when a run loads), so older records replay exactly and follow the rule
  from then on. `stress-test.js` checks it.
- 2026-10-26: **Doors are a tap; rerolling is a hold.**
  - E opens or closes a door with a tap, from either side, when you're
    close to it and facing it. Any opened door closes for free, a door into
    a provisional room included: closing no longer rerolls.
  - To reroll, close the door into a provisional room, then hold E at it
    (1 s, twice that with something of yours inside) from the side you came
    in by. A tap there opens it again. The ring shows after 0.15 s, so a tap
    doesn't flash it; an awake waystone works the same way (tap travels).
  - Closed doors stop you, ghosts, pixies, creepers and light, as before,
    so shutting a door now traps or holds back what's on the other side.
  - Lost-path doors are unchanged: a 0.7 s hold, then the choice.
- 2026-10-26: **Waystones are blocks you carry** (GAME-DESIGN §19).
  - A one-unit block of dark glass with a seeded sigil on its sides, handled
    like a crate (grab, lift, drag; heavy as stone). The fixed monolith is
    gone.
  - **Where:** half the halls keep theirs on the centre cell
    (`hallStoneChance`); for the rest it turns up in the first room grown
    within two rooms of the hall, and again if that room is rerolled before
    you take it (`run.stonePaid`). The starter hall's is already awake.
  - **F wakes one, once:** a charge from your lamp (lamp in hand), or a full
    jar's entropy or pixie. A pixie's stone draws ghosts like a jar.
  - **A tap of E at an awake stone travels** (the map, as before); a hold
    grabs it.
  - **The network is worked out from where awake stones stand** (each to its
    two nearest, plus a spanning tree), so moving stones rewires it; a stone
    in your hands or on a lost path is out of it. `run.ley` is gone.
  - Loss icons and the longer reroll cover waystones too. Dev panel: give a
    waystone, dormant or awake.
  - Saves carry on: run version 8; a hall whose old stone you woke gets its
    block awake.
- 2026-10-26: **A faint moves you, it doesn't rewind; save lanterns**
  (GAME-DESIGN §17, §19).
  - **Save lanterns** (`app/walk/lanterns.js`): every hall has one, beside
    its waystone on the centre cell: a lantern on a dark stone plinth,
    always dimly lit red. E held saves: it flares and settles. It's the
    only respawn, and the first save at a hall reveals its waypoints (that
    moved off waking a waystone). Its light pool shelters your lamp and
    keeps ghosts and creepers out, like a lit sconce's. A small red flame
    on the maps.
  - **Waystones are for travel only:** waking or using one no longer
    saves, or sets where you wake.
  - **Faints don't roll the run back.** You wake by your lantern with 2
    charges (`wakeCharges`); rooms opened since the save become a lost path
    as they are; doors carved since stay; a retraced room's creatures roll
    again.
  - **Your pack** (`app/walk/packs.js`): what you carried (tools, jars,
    keys, chalk and your lamp's entropy) stays where you fell, in a bundle
    with a little lantern glowing at its fuel, and a flame on the maps.
    Walk over it to take it back. It follows its room: waits on a lost
    path, goes when the path fades or is rerolled. Something in your hands
    is set down there.
  - **Doors only open with E held.** Walking into one doesn't (a caption
    says so, once per door).
  - **A choice at the door to a lost path** (`app/walk/choice.js`, generic:
    `W.openChoice`): hold E (0.7 s), then A / D between retrace and reroll
    and hold E (0.8 s) to confirm. Unavailable options say why.
  - **What's at stake shows over the hold ring:** icons for a pack or a
    hall's lantern beyond the door, red and crossed out when the action
    would lose them. Rerolling a room with your pack in it takes twice as
    long (`rerollLoseFactor`).
  - Dev panel: a faint button, the lanterns to jump to, and the
    `SAVE_LANTERN` table.
  - Saves carry on: run version 7 (a hall whose waystone you woke counts as
    saved at).
- 2026-10-26: **Design decided, not built: saves, save lanterns and
  waystone blocks** (GAME-DESIGN §17, §19). A faint moves you without
  rewinding anything; your pack stays where you fell. Save lanterns replace
  waystones in halls and are the only respawn. Waystones become 1x1 blocks
  you carry and power from a jar. The action list
  (`notes/action-list-2026-10-25.md`) has the new build order.

### Removed

- 2026-10-26: Vaulting. Pushing into a block, or pressing E facing it, no
  longer climbs it; you jump.

### Fixed

- 2026-10-26: **A new door no longer reshuffles a room.** Opening a door
  with a doorstone, or a loop opening one into the room, used to move the
  room's push-block marks and change their colours. The blocks you'd set
  home were then left off target, and sometimes a block was left with no
  mark at all. The vessel, sigil, well and scattered waystone spots could
  move too.

  The cause was that all of these were placed around the room's current
  doors. Now they're placed around the doors the room was made with
  (`exitsMadeWith` in `play-rules.js`), the way props and sconces already
  were. Two more fixes in the same area:
  - Crates are rolled before props are cleared off a later door, so a
    clearing can't shift which singles are crates.
  - Placement reads the props layout as it was made.

  Rooms that already moved go back to their original layout.
- 2026-10-25: **Dragging blocks is smooth** (issue #26). It used to pop
  and jerk for two reasons:
  - The block's collision box stayed on its old half-cell while its mesh
    slid up to half a cell ahead. Pushing, the figure walked into that
    stale box, so collision and the inside-a-block safety net held it
    still while the block slid away. Near the halfway mark the figure
    popped out of the far side, and the block snapped back to where it
    started. A push never got past the first half-cell.
  - When the way ahead (or, pulling, behind you) closed mid-drag, the drag
    offset reset to zero instead of holding, so the block jumped back as
    much as half a cell, again and again.

  Now the box is the mesh: it moves continuously and is indexed under
  every cell it overlaps. The saved half-cell follows the nearest notch.
  Block and figure move by the same amount, after checking the block's
  next half-cell and probing the figure's path with the same collisions it
  walks by. Nothing has to push either one back afterwards. Let go, and the
  block eases into the nearest half-cell you can follow it to, at about
  the speed it was moving, with the figure. That runs through the same
  path as the drag, before the camera and the figure mesh update.
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
