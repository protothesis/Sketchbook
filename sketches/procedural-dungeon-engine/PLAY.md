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
  units reach the ceiling as a column. Crouch (Space, or the button) to crawl;
  crouched against a block that rises above you, you're **hidden**. Push into
  a block, or press E facing it, to **climb** on top. You can only step up
  one unit at a time, and never higher than one unit off the floor (any
  higher and you'd bump the ceiling). Climbing stands you up if you were
  crouched. You can walk across tops of equal height, and you drop down when
  you step off an edge. Nothing hunts you yet, so for now hiding is only the
  shadow play and the hook.
- **Rerolling (collapse).** A new room is **provisional** until you open a
  door out of it (or a loop opens one into it); from then on it's
  **committed** for good (`DP.committed`, derived from history). Stand at
  the door into a provisional room and press E (or tap the prompt): the
  door shuts and that one room dissolves, for **1 charge**. Reopening the
  door draws fresh entropy: that's the reroll. A provisional room never has
  rooms beyond it, so a reroll is always one room. Doors into committed
  rooms offer nothing. Green arrows (on the floor and the maps) mark only
  the doors into provisional rooms. Scouting is fine: walk in, take what's
  there, then reroll. See [`GAME-DESIGN.md`](GAME-DESIGN.md).
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
  - A moment in your light (0.25 s, within 4.5 cells) and it stops and turns
    to you, with an amber **?** above it.
  - Keep the light on it and, after a beat, a ring fills clockwise in violet
    around the **?** (3 s of light). Out of the light the ring rewinds
    counter-clockwise in a dim colour; once it's empty, the ghost goes back
    to wandering.
  - A full ring turns the **?** into a purple **!!** and it follows, at
    0.5 cells/s: slow but relentless, far slower than walking (2.4) or
    crawling (1.1), so you can always walk away. Its ring
    becomes the cool-down: it rewinds while the ghost is out of your light,
    and it gives up when the ring empties (2 s) or once a room lies between
    you.

  Bump into a ghost and it's onto you at once: it goes straight to **!!**,
  but reels in place for 1.2 s before it follows.

  A ghost watching or following you from off-screen gets a marker on the
  screen edge (its icon, plus an arrow pointing toward it). A ghost hidden
  behind a block or wall shows through as a dithered violet silhouette, like
  the figure does, only fainter. The closer
  a ghost is, the more the screen wobbles; contact fills it with purple
  glitch and static. Both hold for a moment once you're clear, then wear
  off over a few seconds. **Jars are how you collect them** (below).
  Collapsing a room a ghost is in simply undoes it: nothing is gained, but
  the run keeps a tally and a short log (`run.unmade`) for whatever that
  becomes later.
- **Push blocks (restoration).** About 1 room in 5 (depth 1+) has a stone
  block with a coloured top that's out of place, and a matching coloured
  square on the floor where it belongs, in the same row or column. Walk into
  the block for a beat and it slides half a cell. E, facing it, pulls it one
  half-cell toward you (you step back), which is how a block shoved into a
  corner comes back out. A block only moves within its room, onto bare
  floor, never into a doorway's mouth. Home, it locks in place, its top and
  its mark light up, and it pays **1 charge** of entropy, once. Blocks can't
  be climbed, and jars and chalk can't go on them. Positions persist with
  the run; a rerolled room rolls a new one. See
  [`GAME-DESIGN.md`](GAME-DESIGN.md).
- **Sconces (restoration).** About 1 room in 3 (depth 1+) has an unlit iron
  sconce on a wall, chambers sometimes two. Never on a south wall: the
  camera looks north and would only see its back. E, facing one in your
  room, lights it from your lantern for **1 shard**, once. A lit sconce
  burns for good (saved with the run) and lights the room around it: the
  three lit sconces nearest you get real lights (a fixed pool, so lighting
  more never recompiles materials). Doors carved later through a sconce's
  wall take the sconce's place.
- **Three kinds of item.** Every item belongs to one class, and the class
  decides how it behaves (`ITEMS` in `app/walk/items.js`):
  - **Pickups** (shards, keys) float and turn where they lie. Walk into
    one to collect it. They're counters on the HUD (entropy, and ⚷ for
    keys), never hotbar slots: a locked door uses a key by itself.
  - **Tools** (chalk, doorstones) rest on the floor. E takes one. They
    live on the hotbar and get used up with F, never put back.
  - **Objects** (jars) are things in the world as themselves. A jar from a
    room's loot is already standing there when the room appears. E lifts
    it, F sets it down again, with whatever's inside.
- **The hotbar.** Tools and objects sit in slots at the bottom of the
  screen. Pick a slot with 1–9, the mouse wheel, or a tap. **E** interacts
  with the world (doors, climbing, taking a tool, lifting a jar, wiping a
  chalk mark you're standing on). **F** (or "use" on touch) uses the
  selected item. Some slots are **groups**: one slot, several variants
  (chalk colours; jars by fill). Click a selected group again (or press and
  hold it) to open its picker, or press its number again to cycle.
- **All your jars share one slot.** It's grouped by fill (empty, 1/3, 2/3,
  full), with a count on each group. Its default, **auto**, sets down your
  fullest jar when the spot is on a sigil tile (to power it) and your
  emptiest one anywhere else (a trap). Pick a group in the picker to set
  down that one instead, just for the next jar.
- **Chalk marks.** Your own markup, drawn in the world, and it shows up on
  the maps. Chalk comes in five colours, each with its own simple mark:
  silver arrow (it points the way you faced), gold triangle, crimson
  cross, teal waves, violet crescent. A stick is good for **3 strokes**,
  and its hotbar icon loses a third per stroke. F draws a mark on the
  nearest free quarter-tile ahead (the floor, or the top of a one-unit
  block). E, standing on a mark, wipes it. You start with one silver stick,
  and more turn up in about 1 room in 13 (seeded colour). Marks persist with
  the run, and vanish with a room you collapse.
- **Jars.** Standing in about 1 room in 15 (depth 1+). F sets one down on the
  nearest free quarter-tile in front of you: on the floor, or on top of a
  one-unit block. It's a small solid thing you can't climb or stand on, and
  ghosts float over it. Nothing prompts you to place one. If there's no
  room (say you're facing a wall), the hotbar gives a little shake, and so
  does any other F that can't do anything. E lifts it again, with whatever's
  inside. A jar is a **trap**: lead a following ghost into a placed jar and
  it's caught (up to 3). A collapse shatters any jar in the branch, and its
  ghosts come undone.
- **Sigil tiles.** A glowing hex on the floor of about 1 room in 25 (depth
  1+, not the smallest rooms; never under blocks). It takes up to **four
  jars**, one per quarter of its tile. It wakes **one stage per ghost** in
  its fullest jar:
  - stage 1: a thin shaft of energy with a few rising motes
  - stage 2: a little more energised
  - a full jar: a flash, a big beam with a bright core, a ring of energy
    radiating across the floor, and a violet light (no shadows)

  Every full jar on it is **+1 entropy max** (so up to +4 per sigil) for
  as long as it stays there and full. Lifting a jar takes its +1 away.
  Sigils stack. If the max drops while you're above it, you keep the extra
  charges until spent but can't gain more.
- **Doorstones.** A rare find (about 1 room in 33, from depth 2). Select
  one, face any bare wall, and press F (or tap the prompt) to open a door
  there. It's a real, unopened door: opening it generates a room from
  fresh entropy, or loops into the room behind the wall if there already
  is one. You can collapse through it like any other. Such doors are never
  locked. The engine records the door (a `carve` event), so replay, export
  and the chart view all keep it.
- **Locked doors.** Rare, and they appear past depth 3. A key opens one and
  the walk simply goes on. The **first room past a locked door** is special:
  it's worked out from seeds (the door it was opened through was generated
  locked), so every client and every replay agrees. It has a faint gold
  warmth on its floor, "beyond a lock" in its caption, and a gold outline
  on the maps. Nothing more yet: it's a hook. The expedition-record /
  leave-the-dungeon screen (`showRecord`) is still in the code, unused, for
  whatever a lock leads to later.
- **The big map** (Tab, or tap the minimap) is a view: it opens zoomed in on
  you (two wheel steps back from the closest zoom); drag to pan, wheel or
  pinch to zoom.

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
| Big map | Tab or tapping the minimap opens the same chart nearly full-screen; drag to pan, wheel or pinch to zoom, Center / Close | walking pauses while it's open |
| Cracks | canvas-drawn fissures with a violet core on imprinted tiles; more trace layers, more cracks | seeded per cell; glows faintly even in the dark |
| Blocks | flat-shaded boxes a shade darker than the walls, filling half-cell subgrid squares flush (no gaps between neighbours), 1–3 units of 0.43 cells tall, one seamless box each | cast shadows; never dither. The figure shows through them instead |
| Silhouette | the parts of the figure hidden behind anything draw as a dithered lantern-orange silhouette | GreaterDepth pass, so it only appears where something is in front |
| Floor detail | thin slabs (bricks, tiles), 1–3 per cell on about a third of cells | no collision; just texture under the lantern |
| Crouch | the figure squashes to 55% height, and the lantern drops with it | a lowered lantern throws long shadows off low blocks |
| Hash ghost | translucent violet head with a trailing wisp and four orbiting "bits"; faintly self-lit so you can see one coming | watching you: an amber "?" with a ring (violet and filling while lit, dim and rewinding when not; drawn over walls), slow bits, and an amber dot on the maps. Following you: a purple "!!" whose ring is its cool-down, hotter magenta glow, flicker, jitter, faster bits, and a magenta dot. Off-screen: an edge marker with an arrow. Hidden behind something: a dithered violet silhouette |
| Doorstone | a small white slab with a dark doorway in it; a ⌂ slot on the hotbar; a "open a door here" prompt at a bare wall | the door looks like any other |
| Chalk | sticks in five colours; on the hotbar, one group slot: the colour's symbol over a three-segment stick (strokes left), ×n for more sticks | marks are chalky, faintly glowing decals a quarter-tile wide; on the maps a coloured dot, or the symbol when zoomed in |
| Sigil energy | an additive beam (open cylinder with an upward fade), a brighter core from stage 2, rising motes, and at a full jar a floor ring radiating outward, a flash, and a violet point light (pooled, two at most, no shadows) | |
| Hotbar | bottom-centre slots: ⚱ jars (one group slot: "auto" or a fill's pips, ×n), chalk (a group slot with a colour picker), ⌂ doorstones; the selected slot is outlined in orange. Keys are a ⚷ count beside the entropy meter | a "use" button on touch screens |
| Jar | a small glass jar with a dark lid; violet wisps bob inside, one per ghost | a solid half-cell |
| Beyond a lock | a faint gold warmth on the floor, "beyond a lock" in the caption, a gold outline on the maps | |
| Sigil | a seeded star polygon (pentagram, hexagram, {7/3}, {8/3}) in a double ring with glyph marks, drawn additively | stage 0 a faint violet trace; 1 a dim glow; 2 brighter and flickering; 3 pulsing gold. A +1 max shows as a gold-edged ninth charge slot |
| Ghost effects | full-screen pass (only while active; 8-bit sRGB target, no MSAA, CSS-pixel resolution that adapts down to half if the effect slows frames): wobble = layered sine warp plus slight colour split; glitch = torn slices, purple static, scanlines, wide colour split | wobble rises with nearness (within ~4 cells). Contact: a full-strength glitch flash that fades in 0.35 s, settling to a quarter-strength glitch while in contact. Each holds 1.2–1.5 s after, then decays |
| Entropy meter | 8 charge slots, plus 3 diamond pips for shards toward the next charge | violet |
| Camera | fixed 3/4 top-down view from the south, smooth follow | W is always north on screen and on the chart |
| Occlusion | screen-door dither on east–west walls south of the figure (a world-position test): up to 92% inside a soft circle around it (27% of the screen), and a light 30% across the whole wall within 2.5 cells. Door frames cap at 45%, door panels at 60% | side (north–south) walls never dither; doorways in south walls stay readable |
| Light | the lantern is a shadow-casting point light at the held lamp (ahead and to the right of the body, which gives it direction); ambient is almost zero | the lamp has its own collision: a ray from the body stops it 0.14 cells short of any wall, closed door or taller block, so it never lights through a wall. Plus a faint, short-range cool fill so nearby wall faces read. Shadow bias is small (−0.0008, normal bias 0.02) |
| Pickups | violet octahedron (shard), small gold key | bob and turn; lit by the lantern, so they hide in the dark too |
| Tools lying | a chalk stick on its side, a doorstone on its back (doorway inset up), at a seeded angle | still; E within 0.55 cells takes one |
| Reveal | floor tiles appear outward from the door, then the walls rise, over about 1 s | collapse plays it in reverse, deepest rooms first |
| Captions | a short typewriter-style log line when you enter a space | e.g. "s7 · chamber · damp · depth 3" (the Navidson Record feel) |

## Game parameters

All in `RULES` (`app/play-rules.js`) or at the top of `app/walk/core.js` (ghost tunables are in `GHOST`, in `app/walk/ghosts.js`).

| Parameter | Value |
| --- | --- |
| Move | WASD / arrows (Shift runs at 4 cells/s instead of 2.4); touch: drag for a stick |
| Open a door | walk into it for 0.35 s, or press E / tap the prompt |
| Entropy | whole charges: start with 2, hold up to 8; 3 shards make 1 charge |
| Shard | in 30% of chambers, 15% of corridors, 20% of dead ends; chambers of 20+ cells can hold a second |
| Push block | 25% roll per room at depth 1+, kept if a straight push fits (about 1 room in 5); home = 1 charge, once |
| Sconce | 35% of rooms at depth 1+ (chambers: 40% chance of a second), never on south walls; lit = 1 shard, once |
| Key | 25% of rooms (depth 1+) can hold one; it shows only while unopened locks outnumber keys held + lying |
| Locked door | 4.5% of unresolved exits on rooms at depth 3, +0.75% per level deeper, up to 9% |
| Crouch | Space or the button toggles; crawl at 1.1 cells/s; hidden within 0.2 cells of a block rising 0.38+ above your feet |
| Climb | push into a block for 0.35 s or press E facing it; one unit up at a time and never above one unit; a 0.42 s hop that rises first and then carries forward (both eased in and out), landing 0.12 cells past the edge you crossed while keeping your position along it; gravity 9 cells/s² when stepping off |
| Blocks | 0.32 placement attempts per chamber cell, 0.12 per corridor cell (corridors: singles only). Chamber shapes: single 30%, double 18%, 2×2 30%, row of 3–6 singles 22% (40% of rows have a gap). Height: 1 unit 55%, 2 units 30%, column 15% (rows: 1–2). Never on a cell with a door or an item; kept only if every free half-cell stays reachable |
| Collision radius | 0.2 cells, so a half-cell gap is a real (tight) passage |
| Hash ghosts | spawn 1/14 per room (seeded, `'ghost'` stream); cracked rooms +0.1 +0.3 × cracked share, max 0.4. Wander 0.35 cells/s; paths on the half-cell grid around blocks taller than 1.5 units and hovers 0.45 above lower ones. "?" after 0.25 s lit (light: a 3D ray from the lamp, range 4.5 cells, blocked by walls, closed doors and blocks), then a 0.8 s pause; the ring fills over 3 s of light, drains over 2.5 s without, and the ghost returns to wandering 1.2 s after the ring empties. Chase 0.5 cells/s; give up after 2 s unlit or with a room between you; contact within 0.34 cells. A placed jar with room catches a following ghost within 0.38 cells; a collapse just undoes ghosts in the branch (tallied in `run.unmade`) |
| Reroll price | 1 charge; only a provisional room (no door out of it ever opened) |
| Doorstones | 4.5% of rooms at depth 2+ (seeded on the loot stream); F (doorstone selected) facing a bare wall within 0.4 cells, standing on the floor; never locked |
| Jars | 1/15 of rooms at depth 1+ (seeded, drawn after chalk); capacity 3; F sets one on the free quarter-tile nearest a point 0.47 cells ahead, among the quarters in front (floor or the top of a one-unit block; not through a wall, not onto taller blocks or other jars, not in the two quarters at a doorway's mouth); 0.38 cells tall; a following ghost within 0.38 cells of a jar with room is caught |
| Chalk | start with one silver stick (3 strokes); 1/12 of rooms at depth 1+ hold a stick (seeded on the loot stream, after jars; colour from silver/gold/crimson/teal/violet); F draws on the nearest free quarter ahead (floor or a one-unit block's top, not under a jar, not on another mark); E on a mark wipes it |
| Beyond a lock | `DP.pastLock(exp, space)`: the room's entry door was generated locked (`lockedBySeed`, ignoring that it's since been opened) |
| Sigils | about 1/25 of rooms (seeded `'sigil'` stream; depth 1+, 4+ cells, not on door or item cells; blocks keep off it); up to 4 jars (one per quarter); stage = the fullest jar's fill; each full jar on it = entropy max +1 (up to +4), stacking across sigils |
| Persistence | the expedition is shared with the chart view; position and run state are saved per root seed |

Entropy income, measured over ~700 rooms (2026-10-21): shards lying around
give about 0.27 shards per room, push blocks 0.5 and sconces 0.4 (in shard
terms, if you restore everything). That's a charge every ~2.5 rooms for a
thorough player, about three quarters of it from restoration, and a charge
every ~11 rooms from pickups alone. A reroll costs 1 charge. (Before
restoration, pickups gave about 0.7 shards per room, a charge every ~4.) In random 80-room walks, the first locked door shows up after a
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
lands. The layout only sees a room's original doors. A door added later (a
loop, or one drawn with chalk) just clears any block on its own cell, so it
can never reshuffle the room or drop a block onto the figure. As a
safety net, a figure found inside a block steps out of its nearest side.

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
