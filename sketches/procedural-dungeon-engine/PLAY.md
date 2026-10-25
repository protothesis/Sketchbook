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
- **Saves, the menu and faints.** The page opens on a title screen:
  Continue, New run, Import / Export save. Esc (or the Menu button) pauses:
  Resume, or Quit to main menu. The run saves itself every second; using a
  waystone (waking it, travelling, or touching an awake one) is a
  **checkpoint** (walking through a waystone hall isn't: the room's line
  says where you'd wake). Faint (stamina out) and you wake at your last
  waystone: every room opened since becomes a **lost path** (violet on the
  map, quiet: no cracks, no ghosts), doors carved since are walled up, and
  your run rolls back to the checkpoint. The door to a lost path has a
  **violet seam**. E there retraces it, every room as you left it, for a
  shard per room (at least a charge), if you've found **the thread**.
  Pushing it lets the path go: something new opens and the whole path turns
  to corruption. A path you leave alone dims at your next faint and fades
  at the one after. See [`GAME-DESIGN.md`](GAME-DESIGN.md), section 17.
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

  An off-screen ghost gets a marker on a ring around the figure (not the
  screen's edge, so markers never hide in a far corner), with an arrow
  pointing toward it. Ghosts watching or following you show their status
  icon; idle ones in your room or the next show a faint ghost. A ghost hidden
  behind a block or wall shows through as a dithered violet silhouette, like
  the figure does, only fainter. Contact fills the screen with purple
  glitch and static, which holds for a moment once you're clear, then wears
  off over a few seconds. (Nearness used to wobble the screen too; that's
  switched off, `WOBBLE` in `app/walk/ghosts.js`: it cost frames, left
  artifacts, and worked through walls.)

  **Contact drains your psychic stamina** (below), and once a ghost has
  hold of you its reach swells from 0.34 to 0.8 cells, shrinking back over
  a second once you're clear, so you have to hurry away.

  **Ghosts stay.** Nothing catches them, and a room can't be rerolled
  while a ghost is in it (the prompt says so). What you can do is move
  them: they're drawn to pixies, free or in a jar, strongly enough to turn
  away from you (the ecology, below). They also back out of steady light
  (within about a tile and a half of a lit sconce or an awake waystone), so
  a restored room pushes them back. A covered or empty lamp can't be
  noticed at all.
- **Halls and waypoints.** New expeditions start in a **hall**: a big room
  with notched corners, an awake **waystone**, at least two doors and a
  pale **surface door** on a north wall. Three violet **"?" pins** on the
  map are **waypoints**, two near (25–35 cells) and one far (45–60): each
  marks a hall reserved ahead of time (the footprint isn't shown, and the
  pin isn't at its exact centre). Off the edge of the map, a pin sits on the
  edge, pointing the way. Ordinary rooms grow around a footprint, never into
  it, and any room built against one gets a door into it. Open that door
  and you're there: the hall holds from the moment you arrive (no rerolling
  it). A hall always has three push blocks, at least one sconce and a
  dormant waystone, plus anything else a room can hold. Rarely (1 room in
  100, depth 3+) an ordinary door opens onto an **unmarked hall**, waystone
  and all. See [`GAME-DESIGN.md`](GAME-DESIGN.md), sections 8 and 9.
- **Waystones.** A small slab with seeded glyphs, in the middle of a hall.
  E at a dormant one wakes it for **1 charge** (the glyphs glow), and that's
  when new waypoints appear: 0–3, seeded by the hall (0: 10%, 1: 45%, 2:
  35%, 3: 10%; never 0 if no waypoint is left waiting), near and far by
  turns, fanned out past it. E at an awake one opens the big map on every
  awake waystone, glowing; tap one to travel there. The last waystone you
  woke or used is where you wake if you pass out. The starter hall's is
  always awake. An awake waystone is hard to miss: its glyphs shine
  regardless of light, a faint violet shaft rises from it, and the nearest
  two cast a violet-blue light. It still doesn't shelter the lamp.
- **Ley lines.** Awake waystones are joined into a network. Links are made
  when you wake a stone: it joins its two nearest awake stones, and those
  links stay (saved as `run.ley`), so the network grows in the order you
  woke them, and it's always in one piece. (A save from before links were
  stored gets the tidiest network over the stones already awake, once.) They're drawn on
  both maps (dashed, and bright on the travel map). Travel rides the lines,
  by the fewest of them, and costs **a shard per line**. The travel map
  shows each stone's fare in ◆ (greyed if you can't afford it) and lights
  up the route under the pointer.
- **The lamp burns entropy.** Entropy is a fluid amount of charges, and the
  lamp burns it steadily: a shard's worth every 18 s (a charge every 54 s),
  everywhere except within a tile of a lit sconce (its tile and the 8
  around it). A shard pours a third of a charge in; push blocks two
  shards. Any gain holds the burn for 3 s, so what you just earned doesn't
  start draining at once. Rerolls, waystones and travel draw on the same
  pool. When it runs out the lamp **goes out**, and stays out until you
  relight it.
- **R covers or relights the lamp** (or tap the lamp icon). Relighting
  costs **a shard**, so you need some entropy first: finding it doesn't
  relight the lamp by itself. Covering is free: no light, no burn, and
  ghosts can't notice you (pixies stop fleeing you too), but the dark wears
  on your psychic stamina. The light eases off and back on.
- **Psychic stamina.** A thin pink bar under the lamp's meter, 0 to 100%.
  A ghost's touch knocks off 15% and drains 20% a second while you're in
  its reach; the dark (a lamp out or covered, away from a lit sconce)
  drains it more slowly, 8% a second (about 12 s from full). Empty: you pass out, the world fades to black, and you
  wake at your last waystone with your stamina full and at least 2
  charges. Everything else stays: the map, what you carry, what you
  restored. It refills (12% a second) once nothing has drained it for
  1.5 s and you're in light. The screen's edges close in as it falls, and
  the bar pulses while something drains it.
- **Entropy wells.** A dark stone basin with a glowing pool, in about 1
  room in 20 (depth 1+). Stand in it and it pours entropy into your lamp,
  0.6 charges a second, a charge at most, and a stream of motes runs from
  the pool to your lamp; then it's dry. Each kind shows its clock in the
  world:
  - **Surge** (violet, a rim with eight notches) comes back all at once
    90 s after you last drew on it. The notches are the clock: they go out
    as you drink, then light one by one through the cooldown (the next one
    pulses), and when the last lights the pool bursts back.
  - **Trickle** (teal, a smooth rim, a little spout above) starts refilling
    10 s after you last drew on it, a full well every 120 s, so you can
    always come back for a little. While it waits, a drop slowly forms
    under the spout; refilling, drops fall steadily, each with a ripple,
    and the pool grows. Full, it still drips now and then.

  The pool's size and glow show its level, on the maps too. Times are
  walking time.
- **The lamp on the HUD** sits bottom left, by the hotbar (twice the size
  it was; smaller on phones): a lantern icon in the lamp's colour and a
  fluid meter, one section per charge, with the one that's burning shown
  dimmer. The icon's flame sways while it burns, stutters in danger, and
  stands lower at each stage (full, then at 2, 1 and half a charge). By a
  lit sconce the icon shimmers gold, and a stream of warm motes flows from
  the sconce's flame into your lamp; drinking from a well, it shimmers
  violet. No words, except when the lamp is off: how to relight it. Under
  the meter, the stamina bar and your keys. The top-left panel is
  information and settings only.
- **You can feel the lamp.** Three stages, blended so none of them pops:
  - **Uneasy** (2 charges and below): a little more flicker, and the halo
    starts to wobble.
  - **Danger** (1 charge): a clear flicker, and the caption says so.
  - **Dying** (half a charge): the flicker settles into a slow, irregular
    fade that swells brighter while you move, and only the odd red ember
    rises.

  Through all of it the lamp's colour slides from yellow through orange to
  red; the halo (a flat, see-through disc with a hard edge) shrinks but
  wobbles with the flame, more as it fails, sometimes out past its average,
  and lasts until the lamp is out; the light turns redder and gets dimmer
  and much shorter (down to under a fifth of its reach); and below a charge
  a faint ring on the floor shows where its light ends. Walking, the
  embers trail behind you; standing still, they rise in a slow, swaying
  column. Gaining entropy pops a purple +◆ over your head (+◆◆◆ for a
  charge).
- **The surface door.** Only in the starter hall. Opening it asks "Up to
  the surface (quit game)?" Going up saves and shows the expedition record
  (it stays up across reloads) until you choose to go back down. A
  placeholder for whatever lies above the dungeon.
- **Push blocks (restoration).** About 1 room in 5 (depth 1+) has a stone
  block in a solid colour that's out of place, and a matching coloured
  square on the floor where it belongs, in the same row or column. Walk into
  the block for a beat and it slides half a cell. E, facing it, pulls it one
  half-cell toward you (you step back), which is how a block shoved into a
  corner comes back out. A block only moves within its room, onto bare
  floor, never into a doorway's mouth. Home, it and its mark light up, and
  it pays **2 shards** of entropy. It can still be moved: off its mark, the
  room takes the charge back (what you still have, and never enough to put
  your lamp out), and home again pays back only what was taken, so a block
  can't be farmed. Blocks can't
  be climbed, and jars and chalk can't go on them. Positions persist with
  the run; a rerolled room rolls a new one. See
  [`GAME-DESIGN.md`](GAME-DESIGN.md).
- **Sconces (restoration).** About 1 room in 3 (depth 1+) has an unlit iron
  sconce on a wall, chambers sometimes two. Never on a south wall: the
  camera looks north and would only see its back. E, facing one in your
  room, lights it from your lantern, which **costs 1 shard**. A lit sconce
  burns for good (saved with the run); within a tile of it your lamp
  doesn't burn; and it lights the room around it: the
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
  - **Creatures** (ghosts, pixies) aren't items: they move on their own,
    by the ecology's rules.
- **The hotbar.** Tools and objects sit in slots at the bottom of the
  screen. Pick a slot with 1–9, the mouse wheel, or a tap. **E** interacts
  with the world (doors, climbing, taking a tool, lifting a jar, wiping a
  chalk mark you're standing on). **F** (or "use" on touch) uses the
  selected item. Some slots are **groups**: one slot, several variants
  (chalk colours; jars by contents). Click a selected group again (or press and
  hold it) to open its picker, or press its number again to cycle.
- **All your jars share one slot.** It's grouped by contents (empty, or a
  pixie), with a count on each group. Its default, **auto**, catches a
  pixie in an empty jar when one is within reach, sets down a pixie jar
  when the spot is on a sigil tile (to power it), and an empty one
  anywhere else. Pick a group in the picker to use that one instead, just
  for the next jar.
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
  inside. A jar holds **one pixie**. A collapse shatters any jar in the
  branch, and a pixie in it is lost.
- **Pixies.** Small violet lights with fluttering wings, in about 1 room
  in 10 (depth 1+; rolled once per room, like ghosts). They drift about
  their room, flee ghosts that come close, and linger at entropy wells.
  With an empty jar, F within 0.75 cells of one catches it (the prompt
  says so). Set a pixie jar down and ghosts are drawn to it: they drift
  over and circle it, wander off, and come back. A ghost that comes within
  2.5 cells of a pixie (same room) is **held** by it: it drops whatever it
  was doing, even watching or following you ("a hash ghost turns from you
  to the pixie"), and circles it closely. You can see the pull: the ghost
  leans toward it and its bits spin faster, and a jarred pixie flares and
  beats at the glass as a ghost comes near. That's how you move a ghost
  out of your way, or peel one off you. Or put the jar on a sigil.
  Pixies flee your lit lamp (you have to corner them, or cover the lamp
  and creep up).
- **The ecology.** How creatures treat each other comes from one small
  table of rules in `app/walk/ecology.js`, by tag, not from special cases.
  Presences: ghosts, pixies (free or jarred), wells, your lamp (`light`,
  `lamp`, `player`, while lit; just `player` covered), and lit sconces and
  awake waystones (`light`, `steady`). Rules: ghosts seek pixies (90% of
  their wander goals, within 12 cells and a room, held within 2.5);
  ghosts flee steady light (1.6 cells); pixies flee ghosts (2.2) and light
  (2.5); pixies seek wells (50%, their own room). A jarred pixie still
  wears the 'pixie' tag, which is why a jar draws ghosts. Because pixies gather at wells and ghosts gather
  at pixies, ghosts end up haunting wells, which no rule says. See
  [`EMERGENCE.md`](EMERGENCE.md).
- **Sigil tiles.** A glowing hex on the floor of about 1 room in 25 (depth
  1+, not the smallest rooms; never under blocks). It takes up to **four
  jars**, one per quarter of its tile. A **pixie jar** on it wakes it: a
  flash, a big beam with a bright core, a ring of energy radiating across
  the floor, and a violet light (no shadows). (Stages 1 and 2, for jars of
  one or two ghosts, are still in the code but nothing reaches them now.)

  Every pixie jar on it is **+1 entropy max** (so up to +4 per sigil) for
  as long as it stays there. Lifting a jar takes its +1 away. That's the
  trade-off: a pixie jar powers a sigil, or it moves ghosts, not both.
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

There's no passive regen, only wells. Entropy buys rerolls, waking
waystones, travel and lighting sconces, and the lamp burns it. Running out
isn't a loss in itself: it's the dark, and the dark wears you down until
you pass out and wake at your last waystone.

## Visual parameters

| Parameter | Value | Notes |
| --- | --- | --- |
| Scale | 1 cell = 2 world units | the figure is about half a cell tall |
| Walls | 1.3 cells tall, thin, flat-shaded | tinted by the space's seeded `meta.hue` |
| Floor | one tile per cell, with a dark gap between tiles | the gaps make the grid you're walking on visible |
| Doorways | 0.6 cells wide, 1.0 tall, with a lintel above (wall, dithering with it) | |
| Lost-path door | violet seam and arrow; on the panel, both faces, an additive violet glow strongest at its edges, rippling, and 16 sparks drifting up its sides and top, twinkling (`lostFx` in `world.js`, all in shaders off one clock) | |
| Closed door | dark panel with a warm orange seam of light under it | the same orange as the chart view's open doorways |
| Locked door | iron-grey panel with two bands and a cold blue seam | blue on the minimap; once unlocked it keeps its bands and gets an orange seam |
| Minimap | unopened doors orange, locked doors blue, opened doors green; traces grey; lost paths violet (dimmer once dimmed; faded ones not drawn); imprinted cells get a violet tick | so overlapping rooms stay readable |
| Big map | Tab or tapping the minimap opens the same chart nearly full-screen; drag to pan, wheel or pinch to zoom, Center / Close | walking pauses while it's open |
| Cracks | canvas-drawn fissures with a violet core on imprinted tiles; more trace layers, more cracks | seeded per cell; glows faintly even in the dark |
| Blocks | flat-shaded boxes a shade darker than the walls, filling half-cell subgrid squares flush (no gaps between neighbours), 1–3 units of 0.43 cells tall, one seamless box each | cast shadows; never dither. The figure shows through them instead |
| Silhouette | the parts of the figure hidden behind anything (a block, a door, the solid part of a wall) draw as a dithered lantern-orange silhouette, 85% opacity | GreaterDepth pass, so it only appears where something is in front; the figure's own parts mark the stencil, so the figure never dithers itself (head over body, lamp over either). The figure draws after every other solid thing (renderOrder 5), or it would mark pixels that a block then covers |
| Floor detail | thin slabs (bricks, tiles), 1–3 per cell on about a third of cells | no collision; just texture under the lantern |
| Crouch | the figure squashes to 55% height, and the lantern drops with it | a lowered lantern throws long shadows off low blocks |
| Hash ghost | translucent violet head with a trailing wisp and four orbiting "bits"; faintly self-lit so you can see one coming | watching you: an amber "?" with a ring (violet and filling while lit, dim and rewinding when not; drawn over walls), slow bits, and an amber dot on the maps. Following you: a purple "!!" whose ring is its cool-down, hotter magenta glow, flicker, jitter, faster bits, and a magenta dot. Off-screen: an edge marker with an arrow. Hidden behind something: a dithered violet silhouette |
| Doorstone | a small white slab with a dark doorway in it; a ⌂ slot on the hotbar; a "open a door here" prompt at a bare wall | the door looks like any other |
| Chalk | sticks in five colours; on the hotbar, one group slot: the colour's symbol over a three-segment stick (strokes left), ×n for more sticks | marks are chalky, faintly glowing decals a quarter-tile wide; on the maps a coloured dot, or the symbol when zoomed in |
| Sigil energy | an additive beam (open cylinder with an upward fade), a brighter core from stage 2, rising motes, and at a full jar a floor ring radiating outward, a flash, and a violet point light (pooled, two at most, no shadows) | |
| Hotbar | bottom-centre slots: ⚱ jars (one group slot: "auto" or a fill's pips, ×n), chalk (a group slot with a colour picker), ⌂ doorstones; the selected slot is outlined in orange. Keys are a ⚷ count beside the entropy meter | a "use" button on touch screens |
| Jar | a small glass jar with a dark lid; a pixie flits inside when it holds one | a solid half-cell |
| Pixie | a small pale-violet sphere with two fluttering translucent wings and a soft additive glow, bobbing about 0.6 cells up | no light of its own (cost) |
| Entropy well | a dark stone ring on the floor around an additive pool, violet (surge) or teal (trickle); the pool's size and brightness are its level; motes rise slowly, and fast while you drink. Surge: 8 notches in the rim, lit by level (drinking) or by cooldown progress (recharging, the next one pulsing), and a burst (pool overshoot, motes thrown high, a big ripple) when it comes back. Trickle: a small stone spout 1.1 cells up; a drop forms under it over the 10 s wait, then falls every 0.7 s while refilling (every 4 s when full), each with a ripple (`WELL` in `wells.js`) | on the maps a small circle, filled by its level |
| Stamina | a thin pink bar under the lamp's meter, redder below 35%, pulsing while something drains it; a dark violet vignette closes in as it falls | |
| Beyond a lock | a faint gold warmth on the floor, "beyond a lock" in the caption, a gold outline on the maps | |
| Sigil | a seeded star polygon (pentagram, hexagram, {7/3}, {8/3}) in a double ring with glyph marks, drawn additively | stage 0 a faint violet trace; 1 a dim glow; 2 brighter and flickering; 3 pulsing gold. A +1 max shows as a gold-edged ninth charge slot |
| Ghost effects | full-screen pass (only while active; 8-bit sRGB target, no MSAA, CSS-pixel resolution that adapts down to half if the effect slows frames): wobble = layered sine warp plus slight colour split; glitch = torn slices, purple static, scanlines, wide colour split | wobble rises with nearness (within ~4 cells). Contact: a full-strength glitch flash that fades in 0.35 s, settling to a quarter-strength glitch while in contact. Each holds 1.2–1.5 s after, then decays |
| Lamp HUD | bottom left: a lantern icon (92 px; 64 on phones) in the lamp's colour, its flame scaled to 100 / 80 / 62 / 45% by stage; a fluid meter of 6 sections (32 × 20 px; more with sigils), the burning one dimmer; the stamina bar, then keys (and relight words when the lamp is off). The icon shimmers gold by a sconce, violet at a well; tap it to cover or relight | violet liquid, gold for a sigil's extra sections |
| Lamp streams | motes flowing in an arc into the lamp from what feeds it: a lit sconce's flame (warm) while it shelters you, a well's pool (its colour) while you drink (`STREAM` in `lamp.js`, 16/s, 0.6 s each) | |
| Lamp | the held sphere goes yellow → orange → red → grey with the fuel (full at 3 charges). Unrest by fuel (`UNREST` in `lamp.js`, blended): flicker depth 0.03 at full, 0.08 at 2, 0.38 at 1, then settling to 0.02 at empty while a slow irregular fade grows to 0.5; dying, a brightness swell of up to 35% while you move. Halo (`HALO`): flat, hard-edged, see-through, about 4x the lamp across at full, shrinking to 40%, wobbling with the flicker and fade (it can exceed its average), opacity 0.3 down to 0.12, until the lamp is out. Light (`LIGHT`): intensity 25%–100%, reach 18%–100%, colour following the lamp toward red; below 1 charge a faint additive ring on the floor at 1.1–3.2 cells. Embers (`EMBER`): walking, up to 22/s spraying (0.35–0.75 s); standing, 9/s in a swaying column (0.9–1.6 s); dying, 0.7/s, red. Covered or out: the light eases to nothing, no halo or embers | |
| Entropy popup | "+◆" (one diamond per shard's worth, up to three) floats up over the head in violet; "−◆" greyer when a block takes its charge back | |
| Ghost markers | on a ring around the figure, radius 42% of the shorter screen side | idle ghosts: a faint ghost icon, violet border |
| Camera | fixed 3/4 top-down view from the south, smooth follow | W is always north on screen and on the chart |
| Occlusion | screen-door dither on east–west walls south of the figure (a world-position test): up to 92% inside a soft circle around it (27% of the screen), and a light 30% across the whole wall within 2.5 cells. The wall around a doorway dithers like the rest; door panels never dither (the figure's silhouette shows through them) | side (north–south) walls never dither |
| Light | the lantern is a shadow-casting point light at the held lamp (ahead and to the right of the body, which gives it direction); ambient is almost zero | the lamp has its own collision: a ray from the body stops it 0.14 cells short of any wall, closed door or taller block, so it never lights through a wall. Plus a faint, short-range cool fill so nearby wall faces read. Shadow bias is small (−0.0008, normal bias 0.02) |
| Pickups | violet octahedron (shard), small gold key | bob and turn; lit by the lantern, so they hide in the dark too |
| Tools lying | a chalk stick on its side, a doorstone on its back (doorway inset up), at a seeded angle | still; E within 0.55 cells takes one |
| Reveal | floor tiles appear outward from the door, then the walls rise, over about 1 s | collapse plays it in reverse, deepest rooms first |
| Captions | a short typewriter-style log line when you enter a space | e.g. "s7 · chamber · damp · depth 3" (the Navidson Record feel) |
| Waypoint pin | a violet square with a "?" and a glow, on both maps; off the map, a smaller one on the edge in its direction | |
| Waystone | a grey slab, 0.38 × 0.18 cells, 2.5 units tall, with five seeded glyphs on its north and south faces; awake, the glyphs glow violet, pulse slowly and shine (an additive copy over each face, so light and shadow don't touch them), a faint additive shaft rises 3.2 cells, and the two awake stones nearest you get a violet-blue point light (`GLOW` in `waystones.js`, pooled, no shadows) | on the maps, a small slab, glowing when awake |
| Ley lines | between awake waystones on both maps: dashed and faint, solid and brighter on the travel map; the route to the stone under the pointer glows; fares in ◆ by each stone's id | |
| Surface door | weathered pale panel with a daylight-white seam | white on the maps |
| Push block | the whole block in its colour; home, it glows | |
| Passing out | the lamp fades out and the world goes black over ~1 s; HUD and captions stay | |

## Game parameters

All in `RULES` (`app/play-rules.js`) or at the top of `app/walk/core.js` (ghost tunables are in `GHOST`, in `app/walk/ghosts.js`).

| Parameter | Value |
| --- | --- |
| Move | WASD / arrows (Shift runs at 4 cells/s instead of 2.4); touch: drag for a stick |
| Open a door | walk into it for 0.35 s, or press E / tap the prompt |
| Entropy | a fluid amount in charges (`run.fuel`): start with 2, hold up to 6 (`chargesMax`, was 8); a shard is a third of a charge |
| Shard | in 30% of chambers, 15% of corridors, 20% of dead ends; chambers of 20+ cells can hold a second |
| Push block | 25% roll per room at depth 1+, kept if a straight push fits (about 1 room in 5); halls always try for 3, in different colours; home = 2 shards (`restoreCharges`, was 1 charge); off its mark takes back what it paid (never below 0.05) |
| Sconce | 35% of rooms at depth 1+ (chambers: 40% chance of a second; halls: always one, 50% a second), never on south walls; lighting one costs 1 shard; the lamp doesn't burn within one tile of it (3x3, same room) |
| Lamp | burns a shard's worth every 18 s (`lampSeconds`, was 12), continuously, except by a lit sconce; any gain holds it 3 s (`lampGrace`); looks full at 3 charges (`lampFullCharges`), danger at 1 (`lampDanger`); out: dark, and stamina drains |
| Lamp stages | uneasy at 2 charges (`lampUneasy`), danger at 1 (`lampDanger`), dying at 0.5 (`lampDying`) |
| Relight / cover | R or tapping the lamp icon; relight costs 1 shard (`relightShards`); covering is free; out of fuel, the lamp stays out until relit; covered, it doesn't burn |
| Stamina | 0..1 (`run.stamina`); a ghost's touch: −0.15 once (`staminaHit`), then 0.2/s (`staminaDrain`) while in its reach; the dark: 0.08/s (`staminaDarkDrain`); refills 0.12/s (`staminaRegen`) after 1.5 s undrained (`staminaRegenDelay`); empty: pass out, wake at your last waystone with full stamina and at least 2 charges, having lost every room opened since your last checkpoint (the run rolls back to it) |
| Wells | 1/20 of rooms at depth 1+ (`wellChance`, `'well'` stream; 4+ cells; not on door, item, sigil or waystone cells; blocks keep off); half surge, half trickle (`wellSurge`); 1 charge each (`wellCapacity`), poured at 0.6/s (`wellRate`) while you stand within 0.42 cells of its centre; surge: full again 90 s after the last draw (`wellSurgeCooldown`); trickle: refills from 10 s after (`wellTrickleDelay`), a full well per 120 s (`wellTrickleTime`); saved as `run.wells` |
| Pixies | 1/10 of rooms at depth 1+ (`pixieChance`, `'pixie'` stream), rolled once per room; wander 0.6 cells/s in their room, pausing 0.6–2 s; flee at up to 1.5 cells/s (`PIXIE` in `pixies.js`); caught within 0.75 cells |
| Ecology | `ECOLOGY.rules` in `ecology.js`: ghost seeks pixie (90%, orbit 0.3–0.75 cells, within 12 cells and 1 room; held within 2.5 cells, pausing 0.3–1 s, at 0.55 cells/s); ghost flees steady light (1.6 cells, backing off at 0.6 cells/s, `GHOST.shySpeed`); pixie flees ghost (2.2) and light (2.5); pixie seeks well (50%, orbit 0.15–0.6, own room). A held ghost leans 0.35 rad toward what holds it (`GHOST.lean`); a jarred pixie flares within 2.5 cells of a ghost |
| Halls | starter: 6–8 cells a side; waypoints: 7–9; unmarked: 6–8, 1% of rooms at depth 3+ (`params.hallChance`, own `'hall'` stream; was 2.5%, which older records keep); corners notched (65% each, 1–2 cells). Halls: 3 push blocks, 1–2 sconces, a waystone; loot as a chamber |
| Waypoints | the start: two near (25–35 cells centre to centre), one far (45–60), all round the root. Waking a waystone: 0–3 (`waypointOdds`), near/far/near, fanned outward. A free ring around each footprint; pin within ±2 cells of the centre |
| Waystones | wake: 1 charge (`waystoneCharges`), reveals waypoints; travel: awake to awake only, picked on the big map, along ley lines (a stone joins its 2 nearest awake ones, `leyNeighbours`, when it's woken; the links stay, in `run.ley`), the fewest lines first, then the shortest; 1 shard per line (`travelShardsPerHop`) |
| Key | 25% of rooms (depth 1+) can hold one; it shows only while unopened locks outnumber keys held + lying |
| Locked door | 4.5% of unresolved exits on rooms at depth 3, +0.75% per level deeper, up to 9% |
| Crouch | Space or the button toggles; crawl at 1.1 cells/s; hidden within 0.2 cells of a block rising 0.38+ above your feet |
| Climb | push into a block for 0.35 s or press E facing it; one unit up at a time and never above one unit; a 0.42 s hop that rises first and then carries forward (both eased in and out), landing 0.12 cells past the edge you crossed while keeping your position along it; gravity 9 cells/s² when stepping off |
| Blocks | 0.32 placement attempts per chamber cell, 0.12 per corridor cell (corridors: singles only). Chamber shapes: single 30%, double 18%, 2×2 30%, row of 3–6 singles 22% (40% of rows have a gap). Height: 1 unit 55%, 2 units 30%, column 15% (rows: 1–2). Never on a cell with a door or an item; kept only if every free half-cell stays reachable |
| Collision radius | 0.2 cells, so a half-cell gap is a real (tight) passage |
| Hash ghosts | spawn 1/14 per room (seeded, `'ghost'` stream); cracked rooms +0.1 +0.3 × cracked share, max 0.4. Wander 0.35 cells/s; paths on the half-cell grid around blocks taller than 1.5 units and hovers 0.45 above lower ones. "?" after 0.25 s lit (light: a 3D ray from the lamp, range 4.5 cells, blocked by walls, closed doors and blocks), then a 0.8 s pause; the ring fills over 3 s of light, drains over 2.5 s without, and the ghost returns to wandering 1.2 s after the ring empties. Chase 0.5 cells/s; give up after 2 s unlit or with a room between you; contact within 0.34 cells, swelling to 0.8 while it touches you and shrinking back over 1 s (`swell`, `swellShrink`). No catching; a room with a ghost in it can't be rerolled |
| Reroll price | 1 charge; only a provisional room (no door out of it ever opened) |
| Checkpoint | written on waking a waystone, travelling, or E at an awake one; a faint loses every room not standing then (and every door carved since), and rolls the run back to it, keeping tallies and the thread |
| Lost paths | a faint's rooms, grouped by the door they start from; retrace: a shard per room, at least 1 charge (`retracePerRoom`, `retraceMin`), needs the thread; let go: push the door (the path turns to corruption); unchosen: dim at the next faint, fade at the one after |
| Thread | 1 room in 20 at depth 3+ (`threadChance`, `threadMinDepth`, last on the loot stream); a pickup; kept for the rest of the run, through faints; 🧵 by the keys |
| Doorstones | 4.5% of rooms at depth 2+ (seeded on the loot stream); F (doorstone selected) facing a bare wall within 0.4 cells, standing on the floor; never locked |
| Jars | 1/15 of rooms at depth 1+ (seeded, drawn after chalk); one pixie each (`jarCapacity`); F sets one on the free quarter-tile nearest a point 0.47 cells ahead, among the quarters in front (floor or the top of a one-unit block; not through a wall, not onto taller blocks or other jars, not in the two quarters at a doorway's mouth); 0.38 cells tall |
| Chalk | start with one silver stick (3 strokes); 1/12 of rooms at depth 1+ hold a stick (seeded on the loot stream, after jars; colour from silver/gold/crimson/teal/violet); F draws on the nearest free quarter ahead (floor or a one-unit block's top, not under a jar, not on another mark); E on a mark wipes it |
| Beyond a lock | `DP.pastLock(exp, space)`: the room's entry door was generated locked (`lockedBySeed`, ignoring that it's since been opened) |
| Sigils | about 1/25 of rooms (seeded `'sigil'` stream; depth 1+, 4+ cells, not on door or item cells; blocks keep off it); up to 4 jars (one per quarter); a pixie jar wakes it fully; each pixie jar on it = entropy max +1 (up to +4), stacking across sigils |
| Persistence | two slots (`saves.js`): resume (every 1 s, on pagehide, on quitting to the menu) and checkpoint (waystones); each stamped with the build, and a save from another build isn't loaded; the record is mirrored to the chart view's key, but the chart view's edits don't flow back |
| Menu | Esc or the Menu button: Resume, Quit to main menu (writes the resume slot only); title: Continue, New run, Import / Export save |

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

A retraced room is the same room (same id and seed), so its loot is the
same, and anything the run keyed to it (`spaceId:seed`) still applies. After
a faint the run has rolled back, so its items lie there again.

Whether a key-capable room actually shows its key depends on the run (were
there locks waiting?), so it's run state (`run.keyRooms`), not seed state.
Traces are engine state, rebuilt by replay from the history's reverts.

Whether a room starts with a hash ghost is seeded (`'ghost'` stream, plus
the room's imprint, which is fixed once the room exists). Where ghosts drift
afterwards is run state: their positions are saved with the run, and each
room's roll happens once (`run.ghostSeen`).

## Playtest notes, 2026-10-22 (after the voice-memo build)

Addressed the same day unless marked later.

- **Pixie jars didn't seem to draw ghosts**, maybe because the lamp
  setting them off got in the way. The pull was weak (wanderers only, long
  pauses, a loose orbit). Now a ghost near a pixie is held by it, even off
  a chase, and the pull is visible (the ghost leans, the pixie flares).
- **Wells didn't say what they'd do.** Wanted in-world cues for behaviour
  everywhere, not dev-art icons; ghosts' rings and icons are dev art too.
  The surge rim's notches and the trickle drip are the wells' clocks. The
  rim could become a general timer for other things, ghosts included.
- **Ley lines** should keep their links once made (an order of operations),
  which could later let you re-tune routes. Done. *Later:* make travel an
  active act: steer along the line, or a small rhythm game of timed taps,
  where a bad run costs more (or throws you off partway) and a perfect one
  refunds some of the fare.
- **Random halls and pacing feel right**, with a bit of challenge. The game
  doesn't push back much yet. *Later:* the farther you go from a waystone
  or the start, the darker and spookier it gets, until you restore it.
- **Lamp light is something creatures should respond to**, in the chain:
  ghosts already notice it; pixies should flee it so you chase them. Done
  (the lamp is a presence in the ecology), and ghosts shy from steady
  light, so restored rooms push them back.
- **The halo** should flicker and wobble like the light, little when full
  and more as it fails, able to wobble past its shrinking average, and
  last until the end. **The light** should redden as it dims, its shrinking
  reach was hard to notice (now much shorter, with a floor ring near the
  end). **Three stages** tied to the pips (2, 1, half), with the pop at 1
  smoothed; the last a quiet irregular fade with swells as you move and
  the odd red ember. Done.
- **The lamp HUD twice as big**, the flame lower at each stage, no state
  text: a gold shimmer by a sconce and a stream of motes from it. Done.
- **The figure dithered itself** where its head or lamp overlapped its
  body. Fixed.
- **The dark drained stamina too fast.** Now 8% a second.
- **Relighting wasn't obvious** (any entropy relit it). Now R relights it
  for a shard, and R covers it. All hotkeys should sit under the left hand
  (WASD, Shift, Space).

## Playtest notes, 2026-10-22 (voice memo)

A half-hour voice memo after playing the build above; the transcript is
[`notes/playtest-2026-10-22-voice-memo.md`](notes/playtest-2026-10-22-voice-memo.md).
Addressed the same day unless marked later.

- **Lamp particles** looked good while walking but too random standing
  still: more like a flame, or wisps of embers. Now an idle ember column.
- **The dithered halo** was noisy and started too small; wanted a
  semi-transparent stylised circle with a hard edge. Done, and bigger.
- **The lamp as a timer** works and changes how you play, but a full meter
  was easy to keep, which turned careful exploring into running for
  resources. Wanted something in between, leaning slower. Slower burn,
  smaller tank, push blocks pay less.
- **Waypoints farther apart** is much better, but random big halls that
  weren't waypoints made the real ones feel less special. Unmarked halls
  are rarer. (Their irregular shape is liked; most rooms are boxes. A
  separate engine pass on room shapes and archetypes is planned for its
  own branch, later.)
- **The dungeon feels empty of life**, and ghosts got rare. Catching ghosts
  in jars was overpowered (a stealth threat became an easy lure). Ghosts
  should stay, as lingering threats that make you slow down and think
  about position; maybe no rerolling a room with a ghost in it. Done.
- **Ghost contact should cost something** now that passing out exists, but
  not unavoidably: walking through a door into a closet with a ghost in it
  shouldn't send you home. Hence psychic stamina, a chunk on contact and a
  drain while you stay, with a reach that swells so you have to hustle.
  The dark drains it too, instead of the lamp sending you home at once.
- **Entropy tiles** that refill the lamp, deplete, and recover, either
  after a full cooldown or by trickling. Both built as wells. *Later:*
  temporary entropy with a potency that drains fast, so it can't be
  carried across the map.
- **Pixies in jars** instead of ghosts: catch one with a jar, set it down,
  and ghosts drift around it like moths. A way to manage ghosts, not get
  rid of them, and a trade-off against powering a sigil. Built.
- **Emergent behaviour**: generalise "ghosts like pixie jars" into
  properties that interact, like an ecosystem. A first pass (the ecology
  rules) and a briefing ([`EMERGENCE.md`](EMERGENCE.md)).
- **Waystones should look awake**: a light like a sconce's in violet or
  blue, glyphs that glow regardless of light, a subtle shaft like a
  sigil's. Done. Waking already costs a charge (it was easy to miss).
- **Fast travel as a network with a cost**: see how waystones connect (ley
  lines), make connections matter, and charge for distance. Built as a
  shard per line. *Later:* abilities or items that make travel cheaper or
  farther.

## Playtest notes, 2026-10-22 (waypoints and the lamp)

All addressed the same day, as described above.

- **Waypoints were far too close:** some were one door away, and opening
  doors costs nothing. Now 25–35 and 45–60 cells.
- **The map filled with pins**, three more at every arrival. Now they come
  when you wake a waystone, 0–3, with 0 and 3 rare. Unmarked halls can turn
  up anyway, so a 0 doesn't strand you.
- **Waystones shouldn't refill the lamp.** Only sconces shelter it now, and
  only within a tile.
- **Travel by map, not a list.**
- **The lamp's timer was unclear.** The drain speed felt fine (unchanged),
  but nothing showed it was a countdown. Hence the fluid meter, the lamp
  icon, the colour, halo, sparks and shorter light, and the +◆ popup (the
  caption at the bottom gets lost).
- **The HUD panel mixed info with game state.** It's info and settings
  only now; crouched/hidden is gone (you can see it).
- **Push blocks should move after they're home**, taking their entropy
  back.
- **The ghost wobble** cost frames, made artifacts, and worked through
  walls: switched off.
- **Ghost markers** got lost in screen corners and only showed for ghosts
  that had noticed you: now on a ring, and for idle ghosts nearby too.

Still open: keys are the one consumable without a world object; they sit
by the lamp for now. A "map" item that reveals a waymark was floated as a
later way to get new waypoints.

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

- Combat and a real lose state. (Psychic stamina is a health bar of sorts, but passing out only sends you back to a waystone.)
- Exit kinds in the engine itself (locks live in the walk layer for now).
- Ceilings, first-person view, and camera rotation.
- Performance work. One mesh per tile and per wall, plus point-light
  shadows, renders a 130-room map in about 4 ms per frame on a desktop GPU.

## Open questions

- Should entropy regenerate slowly, or only come from shards? (Wells are a first answer: local, depletable regen.)
- Is "collapse the whole branch" too blunt once branches loop back into
  rooms you're keeping?
- Should rooms you've lit keep a faint "memory glow" in 3D, or is the
  minimap enough?
- Does a locked door ending the run feel like a win, or like being cut off?
