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
