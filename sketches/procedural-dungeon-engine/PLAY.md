# Walk mode: design brief

A small 3D client for the engine (`play.html`). You walk one figure around
the expedition with WASD. Opening a door is what generates the space behind
it, and closing one can un-write it, at a price. This is the engine's
"exploring *is* generating" idea, played instead of clicked on a chart.

The engine stays free of game rules. Everything game-like lives in
`app/play-rules.js`, which only reads engine data, and anything placed in
the world comes from a space's seed on its own named stream (see
Determinism).

## Pillars

1. **The door is the moment.** Every unresolved exit is a closed door, and
   nothing exists behind it until you push it open. The new space then
   assembles itself outward from the threshold.
2. **Darkness is line of sight.** You carry the only light, and walls cast
   real shadows from it. You can't see around a corner until your lantern
   does. Rooms you've left fall back into the dark, and the minimap is your
   memory of them.
3. **Un-writing has a cost.** Closing a door you opened collapses
   everything beyond it, and then the door is unknown again. That costs
   entropy, and once you've gone deep enough you can't afford to undo it.
4. **Same expedition, two views.** Walk mode reads and writes the chart
   view's autosave, and every collapse lands in its history as engine
   reverts.

## The loop (first pass)

- **Explore.** Push doors open. Each one is a fresh, unrerollable draw.
- **Collect.** Most rooms hold a **shard**, and big chambers sometimes hold
  two. Three shards fuse into one **charge** of entropy.
- **Lock first, key later.** A key only turns up after you've seen a lock.
  About 1 room in 4 is *able* to hold a key, but the key only appears in
  it if, when you open that room, there are more unopened locked doors
  around than keys (held or lying somewhere).
- **Hide and climb.** Rooms have blocks on a half-cell subgrid: singles,
  doubles, full 2×2s, and partition rows. They stack 1–3 units high, and 3
  units reach the ceiling as a column. Crouch (C, or the button) to crawl;
  crouched against a block that rises above you, you're **hidden**. Push into
  a block, or press E facing it, to **climb** on top. You can only step up
  one unit at a time, and never higher than one unit off the floor (any
  higher and you'd bump the ceiling). Climbing stands you up if you were
  crouched. You can walk across tops of equal height, and you drop down when
  you step off an edge. Nothing hunts you yet, so for now hiding is only the
  shadow play and the hook.
- **Collapse.** Stand at a door you opened and press E (or tap the prompt),
  and the door shuts. The whole branch beyond it (that room and every room
  opened from it, deepest first) dissolves. The price is **1 per cell plus
  2 per room, paid in whole charges** (15 each, rounded up), so a cost that
  needs only part of a charge still burns the whole charge. Shards
  collected toward your next charge are kept. Reopening the door draws fresh
  entropy: that's the reroll. If the price is more charges than you have,
  the door stays open: "too much lies beyond."
- **Traces.** A collapsed room isn't deleted. The engine keeps its seed and
  cells as a **trace** (a branch that existed but wasn't kept), shown
  greyed on the minimap, the big map and the chart view. A new room that
  overlaps a trace carries its **imprint**, per tile: for now the tile is
  cracked, with a faint violet glow. `DungeonEngine.imprintAt(exp, "x,y")`
  returns every trace layer under a cell, oldest first, so later effects
  (corruption, echoes, hazards) can key off the seeds underneath.
- **Hash ghosts.** About 1 room in 14 starts with one, and a room standing
  on cracked floor is much likelier to (up to ~2 in 5, scaling with how much
  of it is cracked). A ghost drifts around its room and sometimes the next
  one. It passes open doorways but not walls, closed doors or tall blocks
  (it floats over low, one-unit ones). "In your light" is a 3D ray from the
  lamp itself to the ghost, blocked by walls and by any block. Standing, your
  light clears most low blocks; **crouched**, the lamp drops and a low block
  hides the ghost, matching the shadows you see. Noticing you takes two
  stages:
  - After 1.2 s in your light (within 4.5 cells) it stops and turns to you,
    with an amber **?** above it.
  - Keep the light on it and, after a beat, a ring fills clockwise in violet
    around the **?** (3 s of light). Out of the light the ring rewinds
    counter-clockwise in a dim colour; once it's empty, the ghost goes back
    to wandering.
  - A full ring turns the **?** into a purple **!!** and it follows, at
    0.9 cells/s (slower than walking at 2.4 or crawling at 1.1). Its ring
    becomes the cool-down: it rewinds while the ghost is out of your light,
    and it gives up when the ring empties (2 s) or once a room lies between
    you.

  A ghost watching or following you from off-screen gets a marker on the
  screen edge (its icon, plus an arrow pointing toward it). A ghost hidden
  behind a block or wall shows through as a dithered violet silhouette, like
  the figure does. The closer
  a ghost is, the more the screen wobbles; contact fills it with purple
  glitch and static. Both hold for a moment once you're clear, then wear
  off over a few seconds. The only way to be rid of one is to collapse the
  room it's in: it unravels and leaves an **echo**, a resource that does
  nothing yet.
- **Checkpoints.** Locked doors appear past depth 3, more often the deeper you go. Unlocking
  one with a key opens the **expedition record** (the seed chain from the
  root to that door, `H(parent | exit | entropy) → seed` per step, and a
  tally) and offers a choice:
  - **Continue down:** the door opens like any other, and you can collapse
    it later.
  - **Leave the dungeon:** this ends the run, and the record comes back if
    you reload.

There's no passive regen and no lose state yet. You can always keep walking
forward; collapsing is the only thing entropy buys.

## Visual parameters

| Parameter | Value | Notes |
| --- | --- | --- |
| Scale | 1 cell = 2 world units | the figure is about half a cell tall |
| Walls | 1.3 cells tall, thin, flat-shaded | tinted by the space's seeded `meta.hue` |
| Floor | one tile per cell, with a dark gap between tiles | the gaps make the grid you're walking on visible |
| Doorways | 0.6 cells wide, 1.0 tall, with a lintel above | |
| Closed door | dark panel with a warm orange seam of light under it | the same orange as the chart view's open doorways |
| Locked door | iron-grey panel with two bands and a cold blue seam | blue on the minimap; once unlocked it keeps its bands and gets an orange seam |
| Minimap | unopened doors orange, locked doors blue, opened doors green; traces grey; imprinted cells get a violet tick | so overlapping rooms stay readable |
| Big map | M or tapping the minimap opens the same chart nearly full-screen; drag to pan, wheel or pinch to zoom, Center / Close | walking pauses while it's open |
| Cracks | canvas-drawn fissures with a violet core on imprinted tiles; more trace layers, more cracks | seeded per cell; glows faintly even in the dark |
| Blocks | flat-shaded boxes a shade darker than the walls, filling half-cell subgrid squares flush (no gaps between neighbours), 1–3 units of 0.43 cells tall, one seamless box each | cast shadows; never dither. The figure shows through them instead |
| Silhouette | the parts of the figure hidden behind anything draw as a dithered lantern-orange silhouette | GreaterDepth pass, so it only appears where something is in front |
| Floor detail | thin slabs (bricks, tiles), 1–3 per cell on about a third of cells | no collision; just texture under the lantern |
| Crouch | the figure squashes to 55% height, and the lantern drops with it | a lowered lantern throws long shadows off low blocks |
| Hash ghost | translucent violet head with a trailing wisp and four orbiting "bits"; faintly self-lit so you can see one coming | watching you: an amber "?" with a ring (violet and filling while lit, dim and rewinding when not; drawn over walls), slow bits, and an amber dot on the maps. Following you: a purple "!!" whose ring is its cool-down, hotter magenta glow, flicker, jitter, faster bits, and a magenta dot. Off-screen: an edge marker with an arrow. Hidden behind something: a dithered violet silhouette |
| Ghost effects | full-screen pass (only while active): wobble = layered sine warp plus slight colour split; glitch = torn slices, purple static, scanlines, wide colour split | wobble rises with nearness (within ~4 cells); glitch with contact. Each holds 1.2–1.5 s, then decays |
| Entropy meter | 8 charge slots, plus 3 diamond pips for shards toward the next charge | violet |
| Camera | fixed 3/4 top-down view from the south, smooth follow | W is always north on screen and on the chart |
| Occlusion | screen-door dither on east–west walls south of the figure (a world-position test): up to 92% inside a soft circle around it (27% of the screen), and a light 30% across the whole wall within 2.5 cells. Door frames cap at 45%, door panels at 60% | side (north–south) walls never dither; doorways in south walls stay readable |
| Light | the lantern is a shadow-casting point light at the held lamp (ahead and to the right of the body, which gives it direction); ambient is almost zero | the lamp has its own collision: a ray from the body stops it 0.14 cells short of any wall, closed door or taller block, so it never lights through a wall. Plus a faint, short-range cool fill so nearby wall faces read. Shadow bias is small (−0.0008, normal bias 0.02) |
| Pickups | violet octahedron (shard), small gold key | bob and turn; lit by the lantern, so they hide in the dark too |
| Reveal | floor tiles appear outward from the door, then the walls rise, over about 1 s | collapse plays it in reverse, deepest rooms first |
| Captions | a short typewriter-style log line when you enter a space | e.g. "s7 · chamber · damp · depth 3" (the Navidson Record feel) |

## Game parameters

All in `RULES` (`app/play-rules.js`) or at the top of `app/play.js`.

| Parameter | Value |
| --- | --- |
| Move | WASD / arrows (Shift runs at 4 cells/s instead of 2.4); touch: drag for a stick |
| Open a door | walk into it for 0.35 s, or press E / tap the prompt |
| Entropy | whole charges: start with 2, hold up to 8; 3 shards make 1 charge |
| Shard | in 75% of chambers, 40% of corridors, 50% of dead ends; chambers of 20+ cells can hold a second |
| Key | 25% of rooms (depth 1+) can hold one; it shows only while unopened locks outnumber keys held + lying |
| Locked door | 4.5% of unresolved exits on rooms at depth 3, +0.75% per level deeper, up to 9% |
| Crouch | C or the button toggles; crawl at 1.1 cells/s; hidden within 0.2 cells of a block rising 0.38+ above your feet |
| Climb | push into a block for 0.35 s or press E facing it; one unit up at a time and never above one unit; a 0.42 s hop that rises first and then carries forward (both eased in and out), landing 0.12 cells past the edge you crossed while keeping your position along it; gravity 9 cells/s² when stepping off |
| Blocks | 0.32 placement attempts per chamber cell, 0.12 per corridor cell (corridors: singles only). Chamber shapes: single 30%, double 18%, 2×2 30%, row of 3–6 singles 22% (40% of rows have a gap). Height: 1 unit 55%, 2 units 30%, column 15% (rows: 1–2). Never on a cell with a door or an item; kept only if every free half-cell stays reachable |
| Collision radius | 0.2 cells, so a half-cell gap is a real (tight) passage |
| Hash ghosts | spawn 1/14 per room (seeded, `'ghost'` stream); cracked rooms +0.1 +0.3 × cracked share, max 0.4. Wander 0.45 cells/s; paths on the half-cell grid around blocks taller than 1.5 units and hovers 0.45 above lower ones. "?" after 1.2 s lit (light: a 3D ray from the lamp, range 4.5 cells, blocked by walls, closed doors and blocks), then a 0.8 s pause; the ring fills over 3 s of light, drains over 2.5 s without, and the ghost returns to wandering 1.2 s after the ring empties. Chase 0.9 cells/s; give up after 2 s unlit or with a room between you; contact within 0.34 cells. Collapse a room to unravel its ghosts: +1 echo each |
| Collapse price | 1 per cell + 2 per room across the whole branch, divided by 15 and rounded up to whole charges |
| Persistence | the expedition is shared with the chart view; position and run state are saved per root seed |

In a 2,000-room simulation that works out to about 0.7 shards per room (one
charge every ~4 rooms), and collapsing a single room costs 1.4 charges on
average. In random 80-room walks, the first locked door shows up after a
median of 18 rooms (90th percentile: 47), with about 6 locked doors on the
frontier by room 80. About 2.6 blocks land per room. A fine-grained
flood fill with the player's real radius, over ~360 rooms, found every free
half-cell reachable from the entry.

## Determinism

Loot uses `deriveRng(space.seed, 'loot')`. A lock uses
`deriveRng(space.seed, 'lock|' + exit.index)`. Neither consumes the layout
stream, so a replayed expedition holds identical shards, keys and locks. A
collapsed-and-regenerated room has a new seed and so new loot. A collected
item is remembered as `spaceId:seed:itemId`.

Props use `deriveRng(space.seed, 'props')` (floor detail uses `'detail'`),
and each placement attempt draws a fixed run of numbers whether or not it
lands. The reachability check makes acceptance depend on earlier
placements, though. So a loop door added to a room later can change that
room's layout a little when it rebuilds. That's rare, and it's acceptable
for now.

Whether a key-capable room actually shows its key depends on the run (were
there locks waiting?), so it's run state (`run.keyRooms`), not seed state.
Traces are engine state, rebuilt by replay from the history's reverts.

Whether a room starts with a hash ghost is seeded (`'ghost'` stream, plus
the room's imprint, which is fixed once the room exists). Where ghosts drift
afterwards is run state: their positions are saved with the run, and each
room's roll happens once (`run.ghostSeen`).

## Playtest notes, 2026-10-20 (second session)

- **White tiles** were a bug. The floor shade index `(x*7 + y*13 + 999) % 3`
  goes negative far into negative coordinates, and JavaScript's `%` keeps
  the sign, so those tiles got no material and three.js drew its default
  white. Fixed.
- **Locked doors felt too rare, and a key came before any lock.** Locks now
  scale with depth (see above), and keys only appear once a lock is waiting.
- **The minimap should open up.** Added the big map.
- **Less pull to reroll corridors.** Left as is for now. Traces and
  imprints are a first step toward making rerolls matter.
- **Traces, props, crouch:** built as described above.

## Playtest notes, 2026-10-20 (all five addressed)

From the first hand-played session. All five were fixed the same day as
described below. Two details changed along the way: locks went to 2.5%,
and a charge covers 15 cost.

1. **Opened doors vanish from the minimap.** It only draws unresolved
   doors, and overlapping rooms make the chart hard to read without them.
   *Fix:* draw opened (connected) doors too, in green instead of orange.
2. **Locked doors are too common, and "Keep walking" is broken.**
   - Frequency: `lockChance` (10%) applies to every unresolved exit at
     depth 4 or deeper, and the whole frontier ends up that deep, so locks
     pile up. *Fix:* drop it to about 2–3%, or limit it per branch.
   - After unlocking, `act()` just reopens the record screen; the door
     never opens.
   - *Fix:* make locked doors **checkpoints**. Unlocking offers **Leave the
     dungeon** (extract and show the record) or **Continue down**, and an
     unlocked door then opens like any other. An extraction mechanic could
     grow from this.
3. **Shards should come in threes.** The original idea was that 3 shards
   make one complete item, and that got merged into a smooth meter.
   - Shards drop much more often (each one is small).
   - Every 3 shards make one whole **charge**, and the meter shows whole
     charges plus a 0–2 shard partial.
   - A collapse spends whole charges, rounding up: a cost that needs only
     part of a charge uses up the entire charge. Partial shards collected
     toward the next charge are kept.
4. **The south wall draws back in when you're close.** The dither tests
   view depth (`vViewPosition.z < uDitherDepth`). The camera looks down at
   the wall, so the lower part of the wall's face is farther from the
   camera than the figure and stays solid when you stand against it (a
   band under the figure). *Fix:* test world position instead (is this
   wall pixel south of the figure, e.g. via a `vWorldPos` varying).
5. **The dither should be bigger and softer.** *Fix:* make the radius big
   enough that the wall directly above the figure never comes back, with a
   longer falloff. Also add a light dither over the whole south wall as the
   figure approaches it, on top of the full dither near the figure.

## Future directions (noted, not built)

From the 2026-10-19 design chat. The meter is the seed of a bigger idea:
undoing gets harder and more consequential the deeper you go.

- **Depth makes it stranger.** The deeper you go, the more uncanny, surreal
  and dangerous things get: mood, geometry, lighting, sound, and what lives
  there. The seed chain already gives depth a natural "distance from the
  root".
- **Points of no return.** Some dangers, once unleashed, can't be undone. If
  you don't have enough entropy to reseed the whole path back past them, you
  have to find another way through. Collapse becomes an escape hatch with a
  horizon.
- **Growing the resource.** Ways to raise the entropy cap, add regen, or
  make collapse cheaper: XP, skills, items you have to find (and maybe
  find again after a collapse).
- **Partial or targeted collapse.** Erase one room, not the whole branch,
  for a different price. Or collapse that leaves "scars" the generator
  remembers.
- **Reroll in place.** Peek at what's behind a door (the chart view's
  ghost) and pay to reroll before ever stepping through.
- **Locked doors that lead somewhere:** a next level, a vault, or the relic
  from the design doc's roguelike idea, instead of ending the walk.

## Out of scope for now

- Combat, health, enemies, and any lose state.
- Exit kinds in the engine itself (locks live in the walk layer for now).
- Ceilings, first-person view, and camera rotation.
- Performance work. One mesh per tile and per wall, plus point-light
  shadows, renders a 130-room map in about 4 ms per frame on a desktop GPU.

## Open questions

- Should entropy regenerate slowly, or only come from shards?
- Is "collapse the whole branch" too blunt once branches loop back into
  rooms you're keeping?
- Should rooms you've lit keep a faint "memory glow" in 3D, or is the
  minimap enough?
- Does a locked door ending the run feel like a win, or like being cut off?
