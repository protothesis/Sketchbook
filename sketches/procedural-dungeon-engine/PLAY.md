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
   nothing exists behind it until you open it. The new space then
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

- **Explore.** Open doors (E). Each one is a fresh draw.
- **Collect.** Most rooms hold a **shard**, and big chambers sometimes hold
  two. Three shards fuse into one **charge** of entropy.
- **Lock first, key later.** A key only turns up after you've seen a lock.
  About 1 room in 4 is *able* to hold a key, but the key only appears in
  it if, when you open that room, there are more unopened locked doors
  around than keys (held or lying somewhere).
- **Hide and jump.** Rooms have blocks on a half-cell subgrid: singles,
  doubles, full 2×2s, and partition rows. They stack 1–3 units high, and 3
  units reach the ceiling as a column. Crouch (C, or the button) to crawl;
  crouched against a block that rises above you, you're **hidden**. **Jump**
  (Space; A on a pad) to get on top of one: a tap is a hop, a held press
  clears a one-unit block. You never stand higher than one unit off the
  floor (any higher and you'd bump the ceiling), so taller stacks are walls.
  Jumping stands you up if you were crouched. You can walk across tops of equal height, and you drop down when
  you step off an edge. Nothing hunts you yet, so for now hiding is only the
  shadow play and the hook.
- **Rerolling (collapse).** A new room is **provisional** until you open a
  door out of it (or a loop opens one into it); from then on it's
  **committed** for good (`DP.committed`, derived from history). Close the
  door into a provisional room (a tap of E), then, from the side you came
  in by, hold E at it (1 s): that one room dissolves, for **1 charge**.
  Opening the door again draws fresh entropy: that's the reroll. (A tap at
  that closed door just opens it again.) A provisional room never has
  rooms beyond it, so a reroll is always one room. Doors into committed
  rooms offer nothing. Green arrows (on the floor and the maps) mark only
  the doors into provisional rooms. Scouting is fine: walk in, take what's
  there, then reroll. See [`GAME-DESIGN.md`](GAME-DESIGN.md).
- **Saves, the menu and faints.** The page opens on a title screen:
  Continue, New run, Import / Export save. Esc (or the Menu button) pauses:
  Resume, or Quit to main menu. The run saves itself every second. Hold E
  at a hall's **save lantern** to **save**: that's where you'll wake
  (walking through a hall doesn't move it: the room's line says where you'd
  wake). Faint (stamina out) and you wake by that lantern with 2 charges.
  A faint moves you, it doesn't rewind: nothing you did is undone. Every
  room opened since your save becomes a **lost path** (violet on the map,
  quiet: no cracks, no ghosts), suspended exactly as you left it, and what
  you carried (tools, jars, keys, chalk and your lamp's entropy) stays
  where you fell, in a **pack** (below). The door to a lost path has a
  **violet seam**. Hold E there (1 s, twice that with something of yours on
  the path) to **reroll** it: something new opens and the whole path turns
  to corruption, with anything of yours on it (the ring shows what). To
  **retrace** it instead, every room as you left it, for a shard per room
  (at least a charge), hold a **charged hourglass** and press F at the door:
  the retrace spends its pixie. (`lostDoorChoice` in the rules brings back
  the older way: hold E for a choice between the two.) A path you
  leave alone dims at your next faint and fades at the one after, and a
  pack on it goes with it. **A lost path holds its ground** while it waits:
  no new room grows over it, so it can always come back. A door that opens
  onto that ground gets the violet seam too, and works the same way: the
  hourglass retraces (the path comes back, and that door then opens onto it
  like any loop), E held opens it anyway (the path is let go, with anything
  of yours on it, and something new opens there). Your hourglass isn't in
  the pack: equipment stays with you, pixie and all. See [`GAME-DESIGN.md`](GAME-DESIGN.md), sections
  17 and 19.
- **Save lanterns.** Every hall has one, on its centre cell: a lantern on a
  dark stone plinth, always lit with a dim, flickering red flame. E held
  (0.5 s) saves: the flame flares bright, then settles back. The first save
  at a hall's lantern is what reveals new waypoints (0–3, below). Like a lit
  sconce, it has a light pool: your lamp rests in it, ghosts and creepers
  keep out of it, pixies flee it. On the maps, a small red flame (brighter
  where you'd wake).
- **Your pack.** A cloth bundle with a little lantern that shines like your
  lamp would at the fuel it holds (a real light, without shadows, and a
  pool on the floor; even a pack with next to no fuel glows dimly, as if it
  held half a charge), lying where you fainted, and a flame on the maps for as
  long as it's there. Walk over it to take everything back; your lamp takes
  what entropy it can hold, and the rest stays in the pack. It follows its
  room: on a lost path it waits until you retrace it, dims with the path
  and goes when the path fades, or when you reroll it (or reroll the room
  it's in). An object in your hands is set down where you fell.
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
  (a lit sconce's or a save lantern's light pool), so
  a restored room pushes them back. A covered or empty lamp can't be
  noticed at all.
- **Halls and waypoints.** New expeditions start in a **hall**: a big room
  with notched corners, a **save lantern** and an awake **waystone** (a block), at least two doors and a
  pale **surface door** on a north wall. Three violet **"?" pins** on the
  map are **waypoints**, two near (25–35 cells) and one far (45–60): each
  marks a hall reserved ahead of time (the footprint isn't shown, and the
  pin isn't at its exact centre). Off the edge of the map, a pin sits on the
  edge, pointing the way. Ordinary rooms grow around a footprint, never into
  it, and any room built against one gets a door into it. Open that door
  and you're there: the hall holds from the moment you arrive (no rerolling
  it). A hall always has three push blocks, at least one sconce and a save
  lantern, and its waystone (a dormant one) is in it or turns up nearby,
  plus anything else a room can hold.
  Rarely (1 room in 100, depth 3+) an ordinary door opens onto an
  **unmarked hall**, lantern, waystone and all. See
  [`GAME-DESIGN.md`](GAME-DESIGN.md), sections 8, 9 and 19.
- **Waystones.** A block of dark glass, one unit, with a seeded sigil on
  its four sides. It's a loose object like a crate: hold E to grab it, lift
  it or drag it (heavy as stone: slow to drag, 0.7 of your pace carried,
  one at a time). Every hall had one: half of them still do (on the centre
  cell, beside the lantern; `hallStoneChance`), and for the rest the ruin
  scattered it, so it turns up in the first room grown within two rooms of
  the hall (reroll that room before you take it and it turns up again). The
  starter hall's stands there, already awake. **F wakes a dormant one,
  once:** with your lamp in hand it costs a charge (`waystoneCharges`);
  with a full jar in hand it takes the jar's entropy or its pixie. Awake,
  its sigil glows (paler for a pixie) and the nearest two cast a violet
  light. A stone woken by a pixie still holds one, so it draws ghosts like
  a jar. **A tap of E at an awake stone** opens the big map on every awake
  stone; tap one to travel there (a hold grabs it, as with any object).
  Waystones don't save, and don't set where you wake. They don't shelter
  the lamp.
- **Ley lines.** Awake stones standing in the world are joined into a
  network, worked out from where they stand: each links to its two nearest
  awake stones, plus whatever joins the pieces into one. Move a stone and
  the network rewires; one in your hands (or on a lost path) is out of it
  until you set it down (or retrace the path). The lines are drawn on both
  maps (dashed, and bright on the travel map). Travel rides the lines, by
  the fewest of them, and costs **a shard per line**. The travel map shows
  each stone's fare in ◆ (greyed if you can't afford it) and lights up the
  route under the pointer.
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
  wake by the save lantern you last saved at with your stamina full and 2
  charges; your pack stays where you fell (above). It refills (12% a second) once nothing has drained it for
  1.5 s and you're in light. The screen's edges close in as it falls, and
  the bar pulses while something drains it.
- **Entropy wells.** A dark stone basin with a glowing pool, in about 1
  room in 20 (depth 1+). Stand in it and it pours entropy into your lamp,
  0.6 charges a second, a charge at most, and a stream of motes runs from
  the pool to your lamp; then it's dry. With an **empty jar in your
  hands** the well waits instead: swipe the jar through it (F) and a full
  well's charge goes into the jar (a jar takes a whole well or nothing). Each kind shows its clock in the
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
  the meter, the stamina bar. The top-left panel is
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
  and much shorter. On the floor it shows in a pool around you: the light
  as it is in the middle, then three bands stepping down to a hard edge,
  a circle that closes in as the fuel drops; past it, only the dark.
  Walls are lit as usual. That pool is what every creature reads as your
  light (see "Light pools" below). Walking, the
  embers trail behind you; standing still, they rise in a slow, swaying
  column. Gaining entropy pops a purple +◆ over your head (+◆◆◆ for a
  charge).
- **The surface door.** Only in the starter hall. Opening it asks "Up to
  the surface (quit game)?" Going up saves and shows the expedition record
  (it stays up across reloads) until you choose to go back down. A
  placeholder for whatever lies above the dungeon.
- **Crates.** About 2 in 5 of the single, one-unit blocks a room's props
  lay out are loose wooden crates instead (boards in a frame, crossed by a
  brace). They're handled exactly like push blocks (below), but they have
  no home and pay nothing: just something to rearrange.
- **Push blocks (restoration).** About 1 room in 5 (depth 1+) has a stone
  block in a solid colour that's out of place, and a matching coloured
  square on the floor where it belongs, in the same row or column. Home,
  it and its mark light up, and it pays **2 shards** of entropy. It can
  still be moved: off its mark, the room takes the charge back (what you
  still have, and never enough to put your lamp out), and home again pays
  back only what was taken, so a block can't be farmed. Jars and chalk
  can't go on them. See [`GAME-DESIGN.md`](GAME-DESIGN.md).
- **Moving blocks (crates and push blocks).** Jump onto one, like any
  one-unit block. **Hold E** facing it and a ring
  fills (0.4 s): you've **grabbed** it. Then:
  - let go of E without moving and you **lift** it: it swings up in an
    arc over your head (0.38 s for a crate, 0.32 s for a vessel, 0.6 s for
    stone), and you carry it, walking slower with stone (0.7 of your speed)
    or a crate (0.85). E again sets it down
    (a faint box shows where), arcing back down: right back where it was
    if you haven't moved, otherwise on the half-cell straight ahead along
    the way you most face (never a diagonal). So a block shoved into a
    corner is never stuck.
  - move while holding E and you **drag** it: toward it pushes, away pulls
    (if there's room behind you). It slides smoothly, off the grid, slower
    than you walk (a crate at 0.55 of walking speed, a vessel 0.6, a stone
    block 0.35), and you move with it; it stops against anything in the
    way, or against anything in yours (pulling, you need room to back up).
    Sideways does nothing. What collides is where you see it, all the way.
    It has heft: it takes a moment to get going and to stop (stone more
    than a crate), and pulling is slower than pushing (0.7). Let go of E
    and it coasts to a stop and **stays there**, off the grid if that's
    where it is. Stopped within 0.1 cell of a half-cell both ways, it
    **sockets**: it eases the last bit in, and you with it. While you drag,
    a faint outline marks the next half-cell ahead the way it's moving,
    brighter once letting go would socket it. (Off the grid across the
    way you're dragging, it can't line up, so there's no outline.)
  Pushed or pulled, a block stays in its room, on the floor; carried, it
  goes anywhere: set it down in any room, never in a doorway's mouth. Set
  down or pushed onto its mark (in its home room), socketed, it's home.
  Nothing can be set down on top of, or overlapping, an object left off
  the grid.
- **Stacking.** A carried block can be set down at the level you stand on
  or one level up: on the floor, or on top of anything that covers the
  whole half-cell (a fixed block, another crate). From the floor that's
  the floor or a one-unit top; standing on a block, a one- or two-unit
  top. A stack reaches 3 units, the ceiling. You still only stand one unit
  up (you jump onto a one-unit stack, not a taller one). You can lift a block
  at your level or one up, but not one with something resting on it, and
  you push or pull only on the floor (a block up a stack, or you on one:
  let go of E to lift it instead).
- **Blocks travel.** Crates and push blocks live in one run-wide list
  (`run.objects`), not with their room: a room adds its own the first time
  it's built, and builds whatever sits in its cells now. What happens to
  one depends on where it is, never where it came from. In your hands, or
  set down in another room, it stays when its home room is rerolled. One
  **sitting in a room when that room is rerolled is despawned**: gone from
  the world ("a block goes with it"), and kept in `run.despawned` for some
  later use. A room lost to a faint isn't rerolled: what's in it waits,
  and comes back if you retrace the path.
- **Hands full.** With a block in your hands, E only sets it down; F does
  nothing ("your hands are full"), the hotbar won't switch (it shakes),
  and you can't run, and a jump is only a hop. The block you carry is saved with the run
  (`run.carry`).
- **Sconces (restoration).** About 1 room in 3 (depth 1+) has an unlit iron
  sconce on a wall, chambers sometimes two. Never on a south wall: the
  camera looks north and would only see its back. E, facing one in your
  room, held for half a second, lights it from your lantern, which **costs
  1 shard**. Hold E at a lit one to snuff it: the shard goes back into
  your lamp and it comes off the restored tally, so lighting and snuffing
  net to nothing. A lit sconce burns until you snuff it (saved with the
  run); within a tile of it your lamp
  doesn't burn; and it lights the room around it: the
  three lit sconces nearest you get real lights (a fixed pool, so lighting
  more never recompiles materials). Doors carved later through a sconce's
  wall take the sconce's place.
- **Four kinds of item.** Every item belongs to one class, and the class
  decides how it behaves (`ITEMS` in `app/walk/items.js`):
  - **Pickups** (shards) float and turn where they lie. Walk into one to
    collect it. They're on the HUD (entropy), never hotbar slots.
  - **Tools** (chalk, doorstones, keys) lie flat on the floor. Walk over
    one to collect it. They live on the hotbar and work only in your hand,
    with F, used up and never put back. Collected, a tool goes in the
    bag; what's in your hands never changes by itself.
  - **Objects** (crates, push blocks, vessels) are things in the world as
    themselves, never in the bag. Hold E to grab one and lift it, E to set
    it down again, with whatever's inside.
  - **Equipment** (the hourglass, the duster; a draft class) is always with you, kept
    through faints along with what's in it. One of each, collected like a
    tool, on the hotbar if it has a use. **The hourglass**
    (`app/walk/hourglass.js`) holds one pixie: F near a pixie catches it,
    F at a vessel pours it in or takes one out of a vessel of pixies. A
    pixie glows in its lower bulb (and its hotbar glyph) when it's
    charged. Charged, it's the key to a lost path: F with it in hand at
    the path's door retraces it, and spends the pixie. **The feather
    duster** (`app/walk/dust.js`) is in your bag from the start, for now,
    and keeps hotbar slot 1: F (RT on a gamepad) swipes it at the dust
    (see Dusting, below).
  - **Creatures** (ghosts, pixies) aren't items: they move on their own,
    by the ecology's rules.
- **The hotbar.** Tools and objects sit in slots at the bottom of the
  screen. Pick a slot with 1–9, the mouse wheel, or a tap. **E** interacts
  with the world (doors, lifting a jar, wiping a chalk mark
  you're facing). **F** (RT on a gamepad, or "use" on touch) uses the
  selected item: the one in your hand, with a fast side-to-side slash
  and a dithered swoosh behind it (`SLASH`).
- **One thing in your hand.** The selected slot is what you're holding,
  and the figure shows it: a tool in its left hand (the lantern is in the
  right), a jar held over its head. The lamp isn't a slot (since
  2026-10-27): R (R3) covers or relights it. The selected slot's number,
  or a tap on it, puts it away again: **empty hands**. With nothing in
  hand that wants it, F at a dormant waystone wakes it from your lamp.
  Some slots are **groups**: one slot, several variants
  (chalk colours; jars by contents). Click a selected group again (or press and
  hold it) to open its picker, or press its number again to cycle.
- **Focus and prompts.** E acts on one thing at a time: of everything in
  reach, the one you're most squarely facing (nearer breaks a tie; the
  score is distance + 0.6 × (1 − cos of the angle to it)). Nothing on
  screen marks it, and E has no prompt line (on a keyboard): the hold
  ring is its feedback, and a tap at something you can't do says why in a
  caption. F keeps a prompt line below the figure for what the item in
  hand would do (open a door with a doorstone, catch a pixie, pour into a
  vessel), starting with its key; one that can't be done right now has no
  key and reads muted. On touch the E line stays too (it's the E button):
  press a line to do it. Drawing a mark never prompts.
- **Hold to act.** Anything that changes the world takes E held (or the E
  prompt pressed and held on touch) while a ring fills over the target,
  with the action's icon in it (on touch, the E prompt's key fills too,
  and its line ends "· hold"). Let go early and nothing happens; one hold,
  one action. **Doors are the exception**, everyday enough for a tap: E
  opens or closes a door you're close to and facing, from either side
  (walking into one does nothing; the first time, a caption says E opens
  it). Wiping chalk takes 0.4 s, lighting or snuffing a sconce or saving at
  a lantern 0.5 s, and rerolling a room or a lost path, which can't be
  undone, 1 s, or 2 s if something of yours is in it. Grabbing a block takes 0.4 s.
  Where one thing takes both (a closed door you could reroll, an awake
  waystone), letting go before the ring fills is the tap (open it, travel),
  and the ring only shows after 0.15 s. Setting something down and the
  surface door are a tap.
  Something you can't do right now (a lock with no key, a reroll you can't
  afford) is a tap that says why. Over the ring, icons show anything of
  yours at stake (a pack, a hall's lantern), red and crossed out when the
  action would lose them.
- **Choices.** Some actions put up a choice over what you're acting on
  (today, only the door to a lost path, retrace or reroll, and only with
  `lostDoorChoice` on in the rules; it's off by default). You stand still
  while it's up; A / D (or the arrows) pick an option, E held (0.8 s)
  confirms it, Esc, W or S backs out. An option you can't take now is
  muted and says why. On touch, press and hold an option (`choice.js`,
  `W.openChoice`, for anything that needs one later).
- **Closing doors.** Any opened door closes (E, from either side), for
  free, a door into a provisional room included (rerolling is its own act,
  above). A closed door is a wall to you, to ghosts, pixies and creepers
  and to light until you open it again (E, from either side): shut one to
  keep something in, or out. Closed doors
  are kept with the run (`run.closed`, by connection) and show on the maps
  as an orange bar.
- **All your jars share one slot.** It's grouped by what they hold (empty,
  a pixie, a charge of entropy), with a count on each group; the group you
  pick is the jar in your hands. **F swipes it** (a quick sweep forward
  and down, always, so you see it): an empty jar catches a pixie within
  0.75 cells, or scoops a full well you're standing in; a jar of entropy
  pours into your lamp, all or nothing (it tops the lamp up to its max,
  and the jar is empty after either way). At a **vessel** right in front
  of you, F pours the jar into it, or (an empty jar) takes one back out.
  A swipe at nothing just swipes.
- **Chalk marks.** Your own markup, drawn in the world, and it shows up on
  the maps. Chalk comes in five colours, each with its own simple mark:
  silver arrow (it points the way you faced), gold triangle, crimson
  cross, teal waves, violet crescent. A stick is good for **3 strokes**,
  and its hotbar icon loses a third per stroke. F draws a mark on the
  nearest free quarter-tile ahead (the floor, or the top of a one-unit
  block). E, facing a mark within 0.7 cells (or standing on it, facing
  ahead), wipes it. You start with one silver stick,
  and more turn up in about 1 room in 13 (seeded colour). Marks persist with
  the run, and vanish with a room you collapse.
- **Jars** are a tool: one lies in about 1 room in 15 (depth 1+); walk
  over it to collect it, empty. It lives in the bag and is shown in your
  left hand when selected. A jar holds **one thing**, a pixie or a charge
  of entropy, and never goes back into the world.
- **Vessels.** A squat clay urn standing in about 1 room in 10 (depth
  1+; seeded on its own `'vessel'` stream, on a free half-cell). An object,
  like a crate: hold E to grab and lift it, carry it anywhere, set it down
  (stacked too, but nothing stacks on a vessel, and you can't stand on it;
  ghosts float over it). It holds **up to 3 of one kind** (pixies, or
  charges of entropy): F with a full jar pours it in, F with an empty jar
  takes one back out (a jar of the other kind, or a full vessel, says
  so). Pixies in it flit above its mouth; entropy glows in it, brighter
  the more there is. A vessel sitting in a rerolled room is despawned
  with what's inside (`run.despawned`).
- **Pixies.** Small violet lights with fluttering wings, in about 1 room
  in 10 (depth 1+; rolled once per room, like ghosts). They drift about
  their room, flee ghosts that come close, and linger at entropy wells.
  With an empty jar in your hands, swipe it (F) within 0.75 cells of one
  to catch it (the prompt says so). Pour it into a vessel and ghosts are drawn to it: they drift
  over and circle it, wander off, and come back. A ghost that comes within
  2.5 cells of a pixie (same room) is **held** by it: it drops whatever it
  was doing, even watching or following you ("a hash ghost turns from you
  to the pixie"), and circles it closely. You can see the pull: the ghost
  leans toward it and its bits spin faster, and a jarred pixie flares and
  flits faster as a ghost comes near. That's how you move a ghost out of
  your way, or peel one off you. Or set the vessel on a sigil.
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
  vessels**, one per quarter of its tile. A **vessel of pixies** on it wakes it: a
  flash, a big beam with a bright core, a ring of energy radiating across
  the floor, and a violet light (no shadows). (Stages 1 and 2, for jars of
  one or two ghosts, are still in the code but nothing reaches them now.)

  Every pixie in the vessels on it is **+1 entropy max** (up to 3 per
  vessel) for as long as it stays there. Lifting the vessel takes it away.
  That's the trade-off: a vessel of pixies powers a sigil, or it moves
  ghosts, not both.
  Sigils stack. If the max drops while you're above it, you keep the extra
  charges until spent but can't gain more.
- **Doorstones.** A rare find (about 1 room in 33, from depth 2). Select
  one, face any bare wall, and press F (or tap the prompt) to open a door
  there. It's a real, unopened door: opening it generates a room from
  fresh entropy, or loops into the room behind the wall if there already
  is one. You can collapse through it like any other. Such doors are never
  locked. The engine records the door (a `carve` event), so replay, export
  and the chart view all keep it.
- **Locked doors.** Rare, and they appear past depth 3. Select a key (it's
  a tool on the hotbar) and press F at the door: the key turns. Then open
  it as usual (E). E alone at a locked door only says so. The **first room past a locked door** is special:
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
you pass out and wake by your save lantern.

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
| Minimap | unopened doors orange, locked doors blue, opened doors green, doors to a lost path (its own, or onto ground it holds) violet; traces grey; lost paths violet and hatched, by stage: since your last faint, a fill that breathes, close hatching and a solid glowing edge; dimmed (it fades at the next faint), fainter, sparse hatching and a dashed edge (faded ones not drawn); imprinted cells get a violet tick | so overlapping rooms stay readable |
| Big map | Tab or tapping the minimap opens the same chart nearly full-screen; drag to pan, wheel or pinch to zoom, Center / Close (on a gamepad: View opens it, the stick pans, LT / RT zoom, Y centers, B closes) | walking pauses while it's open |
| Cracks | canvas-drawn fissures with a violet core on imprinted tiles; more trace layers, more cracks | seeded per cell; glows faintly even in the dark |
| Blocks | flat-shaded boxes a shade darker than the walls, filling half-cell subgrid squares flush (no gaps between neighbours), 1–3 units of 0.43 cells tall, one seamless box each | cast shadows; never dither. The figure shows through them instead |
| Silhouette | the parts of the figure hidden behind anything (a block, a door, the solid part of a wall) draw as a dithered lantern-orange silhouette, 85% opacity | GreaterDepth pass, so it only appears where something is in front; the figure's own parts mark the stencil, so the figure never dithers itself (head over body, lamp over either). The figure draws after every other solid thing (renderOrder 5), or it would mark pixels that a block then covers |
| Floor detail | thin slabs (bricks, tiles), 1–3 per cell on about a third of cells | no collision; just texture under the lantern |
| Crouch | the figure squashes to 55% height, and the lantern drops with it | a lowered lantern throws long shadows off low blocks |
| Hash ghost | translucent violet head with a trailing wisp and four orbiting "bits"; faintly self-lit so you can see one coming | watching you: an amber "?" with a ring (violet and filling while lit, dim and rewinding when not; drawn over walls), slow bits, and an amber dot on the maps. Following you: a purple "!!" whose ring is its cool-down, hotter magenta glow, flicker, jitter, faster bits, and a magenta dot. Off-screen: an edge marker with an arrow. Hidden behind something: a dithered violet silhouette |
| Doorstone | a small white slab with a dark doorway in it; a ⌂ slot on the hotbar; a "open a door here" prompt at a bare wall | the door looks like any other |
| Chalk | sticks in five colours; on the hotbar, one group slot: the colour's symbol over a three-segment stick (strokes left), ×n for more sticks | marks are chalky, faintly glowing decals a quarter-tile wide; on the maps a coloured dot, or the symbol when zoomed in |
| Sigil energy | an additive beam (open cylinder with an upward fade), a brighter core from stage 2, rising motes, and at a full jar a floor ring radiating outward, a flash, and a violet point light (pooled, two at most, no shadows) | |
| Hotbar | bottom-centre slots: the duster (always slot 1, lit violet while a swipe would find dust), ⚱ jars (one group slot: empty, a violet pip for a pixie or a violet bar for entropy, ×n), chalk (a group slot with a colour picker), ⌂ doorstones, ⚷ keys; the selected slot is outlined in orange | a "use" button on touch screens |
| Held item | the selected tool in the figure's left hand, tilted up; a jar or block over its head; all at their true size, and casting no shadow; nothing with empty hands | |
| Slash | using what's in your hand whips it side to side across in front of you: 0.16 s across (`SLASH.time`, turning from −0.55 to +2.5 radians off its rest, `from`, `to`, reaching out 0.1 cells), 0.14 s back (`back`); a flat ring at tool-tip height (0.2–0.52 cells round the figure) lights the 1.3 radians behind the tip (`trail`) in a 2-px Bayer dither, densest at the outside, gone in 0.22 s (`trailLife`) | |
| Jar | a small glass jar with a dark lid; a pixie flits inside when it holds one | a solid half-cell |
| Pixie | a small pale-violet sphere with two fluttering translucent wings and a soft additive glow, bobbing about 0.6 cells up | no light of its own (cost) |
| Jars | glass, a dark lid; a pixie flits inside, a jar of entropy holds a glowing violet liquid; on the floor and in the left hand at 0.55×; the swipe tips it forward and down over 0.32 s | |
| Vessel | a squat clay urn 0.4 cells tall; pixies (up to 3) flit above its mouth, entropy glows violet in it (brighter per charge) | |
| Entropy well | a dark stone ring on the floor around an additive pool, violet (surge) or teal (trickle); the pool's size and brightness are its level; motes rise slowly, and fast while you drink. Surge: 8 notches in the rim, lit by level (drinking) or by cooldown progress (recharging, the next one pulsing), and a burst (pool overshoot, motes thrown high, a big ripple) when it comes back. Trickle: a small stone spout 1.1 cells up; a drop forms under it over the 10 s wait, then falls every 0.7 s while refilling (every 4 s when full), each with a ripple (`WELL` in `wells.js`) | on the maps a small circle, filled by its level |
| Stamina | a thin pink bar under the lamp's meter, redder below 35%, pulsing while something drains it; a dark violet vignette closes in as it falls | |
| Beyond a lock | a faint gold warmth on the floor, "beyond a lock" in the caption, a gold outline on the maps | |
| Sigil | a seeded star polygon (pentagram, hexagram, {7/3}, {8/3}) in a double ring with glyph marks, drawn additively | stage 0 a faint violet trace; 1 a dim glow; 2 brighter and flickering; 3 pulsing gold. A +1 max shows as a gold-edged ninth charge slot |
| Ghost effects | full-screen pass (only while active; 8-bit sRGB target, no MSAA, CSS-pixel resolution that adapts down to half if the effect slows frames): wobble = layered sine warp plus slight colour split; glitch = torn slices, purple static, scanlines, wide colour split | wobble rises with nearness (within ~4 cells). Contact: a full-strength glitch flash that fades in 0.35 s, settling to a quarter-strength glitch while in contact. Each holds 1.2–1.5 s after, then decays |
| Lamp HUD | bottom left: a lantern icon (92 px; 64 on phones) in the lamp's colour, its flame scaled to 100 / 80 / 62 / 45% by stage; a fluid meter of 6 sections (32 × 20 px; more with sigils), the burning one dimmer; the stamina bar (and relight words when the lamp is off). The icon shimmers gold by a sconce, violet at a well; tap it to cover or relight | violet liquid, gold for a sigil's extra sections |
| Dust | a light-grey (`DUST.color`) instanced quad per layer of each dusted half-cell, the first 0.014 world units above its surface and each next one 0.018 cells higher (`layerGap`), so the layers shift against each other as you move; Lambert (lamp, pool bands and shadows fall on it). Each pixel of a world-space 4×4 Bayer pattern plus a little hash, 0.036 cells across (`pixel`), belongs to one layer's band of thresholds (1 layer about 38% covered, 3 about 82%, `cover`), so the layers never double up; a layer coming off thins over 0.2 s; brightness varies a little per pixel. A second pass lays a 10% film (`film`) over the rest of each layer. Built out with its room: each quad is drawn in toward its floor tile's centre as the tile scales up. Dev-panel changes show at once | |
| Dust clouds | per half-cell cleared, 5 puffs (`puffs`, fewer as it thins): 0.42 cells across growing ×1.9 over about 2.2 s (`cloudSize`, `cloudGrow`, `cloudLife`), drifting out and up, their pixels dithered (2-px screen blocks) by alpha; each breaks into 2 motes (`motes`), single bright pixels 0.047 cells across (`moteSize`) drifting about 9 s (`moteLife`). Both lit on the CPU from your lamp's pool and any entropy light's pool, so they catch the light; motes twinkle in it | |
| Lamp streams | motes flowing in an arc into the lamp from what feeds it: a lit sconce's flame (warm) while it shelters you, a well's pool (its colour) while you drink (`STREAM` in `lamp.js`, 16/s, 0.6 s each) | |
| Lamp | the held sphere goes yellow → orange → red → grey with the fuel (full at 3 charges). Unrest by fuel (`UNREST` in `lamp.js`, blended): flicker depth 0.03 at full, 0.08 at 2, 0.38 at 1, then settling to 0.02 at empty while a slow irregular fade grows to 0.5; dying, a brightness swell of up to 35% while you move. Halo (`HALO`): flat, hard-edged, see-through, about 4x the lamp across at full, shrinking to 40%, wobbling with the flicker and fade (it can exceed its average), opacity 0.3 down to 0.12, until the lamp is out. Light (`LIGHT`): intensity 25%–100%, falloff reach 18%–100%, colour following the lamp toward red. Its pool (light.js): 3.2 cells from you at full (3 charges or more), down to 0.9 at empty (`poolFull`, `poolEmpty`, `poolCurve` 1), steady (`breathe` 0: the flicker doesn't move it). Creepers read its edge (`lightRadius()`). Embers (`EMBER`): walking, up to 22/s spraying (0.35–0.75 s); standing, 9/s in a swaying column (0.9–1.6 s); dying, 0.7/s, red. Covered or out: the light eases to nothing, no halo or embers | |
| Entropy popup | "+◆" (one diamond per shard's worth, up to three) floats up over the head in violet; "−◆" greyer when a block takes its charge back | |
| Ghost markers | on a ring around the figure, radius 42% of the shorter screen side | idle ghosts: a faint ghost icon, violet border |
| Camera | fixed 3/4 top-down view from the south (`camera.js`). Follows on a critically damped spring (0.15 s): it gathers speed as you start and settles without overshooting or swinging back. It leads where you're moving, up to 0.7 cells at walking speed and 1.3 running, but the lead is built by travelling: each cell you walk adds or swings at most 0.5 cells of it, so a slow walk pushes the view on slowly and turning on the spot doesn't swing it. The lead holds at the most it reached when you slow or stop; heading more than 50° away from it starts a new one. Its height follows the ground you stand on, not your jump (`rise`: 0 keeps it level). The right stick peeks up to 2 cells, springing back on release (6/s). All in `CAMERA`, tunable in the dev panel; its `debug` switch draws the camera's workings over the game (you, your velocity, the followed spot, the lead and its goal, the turn cone, the peek, the screen's centre, and a readout) | W is always north on screen and on the chart |
| Occlusion | screen-door dither on east–west walls south of the figure (a world-position test): up to 92% inside a soft circle around it (27% of the screen), and a light 30% across the whole wall within 2.5 cells. The wall around a doorway dithers like the rest; door panels never dither (the figure's silhouette shows through them) | side (north–south) walls never dither |
| Light | the lantern is a shadow-casting point light at the held lamp (ahead and to the right of the body, which gives it direction); on the floor it shows only inside its pool (light.js, the Lamp row); ambient is almost zero | the lamp has its own collision: a ray from the body stops it 0.14 cells short of any wall, closed door or taller block, so it never lights through a wall. Plus a faint, short-range cool fill so nearby wall faces read. Shadow bias is small (−0.0008, normal bias 0.02) |
| Pickups | violet octahedron (shard) | bob and turn; lit by the lantern, so they hide in the dark too |
| Tools lying | a chalk stick on its side, a doorstone on its back (doorway inset up), a gold key flat, at a seeded angle | still; walking within pickup range collects one (on the floor, not from a block) |
| Reveal | floor tiles appear outward from the door, then the walls rise, over about 1 s | collapse plays it in reverse, deepest rooms first |
| Captions | a short typewriter-style log line when you enter a space | e.g. "s7 · chamber · damp · depth 3" (the Navidson Record feel) |
| Waypoint pin | a violet square with a "?" and a glow, on both maps; off the map, a smaller one on the edge in its direction | |
| Waystone | a half-cell block, one unit tall, of dark glass (Phong, a cool specular); a seeded star in a ring ({5–8/2–3}) on each side, drawn additively: a faint etching while dormant, violet while awake (paler for a pixie), pulsing slowly; the two awake stones nearest you get a violet point light (`GLOW` in `waystones.js`, pooled, no shadows) | on the maps, a small slab, glowing when awake |
| Save lantern | a dark stone plinth 0.36 cells square and 2 units tall on the west half of the hall's centre cell, with an iron-capped lantern on top: glass glowing red, a small flame; a dim red point light (the two lanterns nearest you get one, `SAVE_LANTERN` in `lanterns.js`, pooled) that flickers slowly and unevenly, and a light pool of 1.8 cells; saving flares it (brightness 9, pool 2.6) and it eases back over 1.4 s | on the maps, a small red flame, brighter where you'd wake |
| Pack | a cloth bundle with a knot, and beside it a little lantern whose glass and soft glow are the lamp's colour at the fuel it holds; the nearest pack gets a real light like your lamp's at that fuel (`W.lampLightAt`: same brightness, reach, colour and pool), 0.35 cells up, no shadows, at least as bright as half a charge (`PACK_LIGHT` in `packs.js`) | on the maps, a flickering flame, dimmer on a dimmed path |
| Choice | a panel over what you're acting on: a title, the icons of what's at stake, the options side by side (the picked one outlined, red when it would lose things; unavailable ones struck through, with why), and a hint line | |
| Ley lines | between awake waystones on both maps: dashed and faint, solid and brighter on the travel map; the route to the stone under the pointer glows; fares in ◆ by each stone's id | |
| Surface door | weathered pale panel with a daylight-white seam | white on the maps |
| Push block | the whole block in its colour; home, it glows; stacked, it rests at 1 or 2 units (`lv` in `run.objects`); lifted, it arcs up over the head in 0.6 s (a crate 0.38 s; eased, rising a little above the straight line) and back down the same way | |
| Crate | a wooden crate, a half-cell cube one unit tall: boards in a lighter frame, a diagonal brace | |
| Passing out | the lamp fades out and the world goes black over ~1 s; HUD and captions stay | |

## Light pools

The lights themselves are plain three.js point lights and look as they
always did: your lamp (`LIGHT`, `lamp.js`), lit sconces (`SCONCE_LIGHT`,
`restore.js`), awake waystones (`GLOW`), sigils. Walls are lit as usual.

Some lights also own a **pool**, a steady circle on the floor
(`app/walk/light.js`): your lamp (its radius from the fuel) and lit
sconces (`SCONCE_LIGHT.pool`, 2 cells). The pool is the look and the
gameplay at once:

- **On the floor** (any face turned up), pooled lights show only inside
  the pools: the light as it is in the core, then `POOL.bands` (3) steps
  of `bandWidth` (0.32 cells) down to `floor` (20%) at the edge, then
  dark.
- **Pools share one ground layer.** Each floor point takes the strongest
  pool covering it, so overlapping pools merge into one shape with only
  those few values, never an interference pattern. It's drawn for your
  lamp and the 3 sconces that have real lights (the nearest lit ones).
- **The game reads the pools.** A spot is lit by a pool when it's inside
  the circle and nothing blocks the way from that light (`lightReaches`,
  standing in for shadows). A ghost notices you inside your pool; a
  creeper keeps to its edge (`lightRadius()`) and is dazed inside it;
  pixies flee any pool they're in; ghosts and creepers are pushed out of
  a lit sconce's pool; and you're sheltered while you stand in one.
  Ecology rules about lights have no range: the pool is the range.
- The flicker only touches the light's look, never a pool (`LIGHT.breathe`
  can add some back).
- **Lights without a pool** light the floor as usual and mean nothing to
  creatures: waystones (their own kind of light; an area effect could hook
  in later through their `waystone` presence), sigils, and your cool fill.

## Game parameters

All in `RULES` (`app/play-rules.js`) or at the top of `app/walk/core.js` (ghost tunables are in `GHOST`, in `app/walk/ghosts.js`).

| Parameter | Value |
| --- | --- |
| Move | WASD / arrows (Shift runs at 4 cells/s instead of 2.4); touch: drag for a stick |
| Open a door | a tap of E (or the E prompt), within 0.6 cells of its middle and facing it (within 60°); the same to close it, or open it again, from either side. Walking into one doesn't open it |
| Hold to act | `HOLD` in `actions.js`: wipe 0.4, light / snuff / save 0.5, grab 0.4, reroll 1.0 at a closed door into a provisional room or at a lost path's door (× 2, `rerollLoseFactor`, with something of yours there); with `lostDoorChoice` on, a lost path's door 0.7 (`lostDoorHold`) brings up a choice, confirmed in 0.8 (`choiceHold`); a hold with a tap of its own shows its ring after 0.15 s (`TAP_GRACE`); anything else on E is a tap |
| Entropy | a fluid amount in charges (`run.fuel`): start with 2, hold up to 6 (`chargesMax`, was 8); a shard is a third of a charge |
| Shard | in 30% of chambers, 15% of corridors, 20% of dead ends; chambers of 20+ cells can hold a second |
| Push block | 25% roll per room at depth 1+, kept if a straight push fits (about 1 room in 5); halls always try for 3, in different colours; home = 2 shards (`restoreCharges`, was 1 charge); off its mark takes back what it paid (never below 0.05) |
| Crate | each single, one-unit prop block: 40% (`crateChance`, its own `'crate'` stream, one draw per such block); about 0.27 per room |
| Sconce | 35% of rooms at depth 1+ (chambers: 40% chance of a second; halls: always one, 50% a second), never on south walls; lighting one costs 1 shard, snuffing it gives the shard back; the lamp doesn't burn within one tile of it (3x3, same room) |
| Lamp | burns a shard's worth every 18 s (`lampSeconds`, was 12), continuously, except by a lit sconce; any gain holds it 3 s (`lampGrace`); looks full at 3 charges (`lampFullCharges`), danger at 1 (`lampDanger`); out: dark, and stamina drains |
| Lamp stages | uneasy at 2 charges (`lampUneasy`), danger at 1 (`lampDanger`), dying at 0.5 (`lampDying`) |
| Relight / cover | R or tapping the lamp icon; relight costs 1 shard (`relightShards`); covering is free; out of fuel, the lamp stays out until relit; covered, it doesn't burn |
| Stamina | 0..1 (`run.stamina`); a ghost's touch: −0.15 once (`staminaHit`), then 0.2/s (`staminaDrain`) while in its reach; the dark: 0.08/s (`staminaDarkDrain`); refills 0.12/s (`staminaRegen`) after 1.5 s undrained (`staminaRegenDelay`); empty: pass out, wake by the lantern you last saved at with full stamina and 2 charges (`wakeCharges`); every room opened since that save becomes a lost path, and what you carried (and your fuel) becomes a pack where you fell; nothing else changes |
| Wells | 1/20 of rooms at depth 1+ (`wellChance`, `'well'` stream; 4+ cells; not on door, item, sigil or waystone cells; blocks keep off); half surge, half trickle (`wellSurge`); 1 charge each (`wellCapacity`), poured at 0.6/s (`wellRate`) while you stand within 0.42 cells of its centre; surge: full again 90 s after the last draw (`wellSurgeCooldown`); trickle: refills from 10 s after (`wellTrickleDelay`), a full well per 120 s (`wellTrickleTime`); saved as `run.wells`; an empty jar in your hands stops the pour, and a swipe takes a full well's charge into the jar |
| Pixies | 1/10 of rooms at depth 1+ (`pixieChance`, `'pixie'` stream), rolled once per room; wander 0.6 cells/s in their room, pausing 0.6–2 s; flee at up to 1.5 cells/s (`PIXIE` in `pixies.js`); caught within 0.75 cells |
| Ecology | `ECOLOGY.rules` in `ecology.js`: ghost seeks pixie (90%, orbit 0.3–0.75 cells, within 12 cells and 1 room; held within 2.5 cells, pausing 0.3–1 s, at 0.55 cells/s); ghost flees steady light (1.6 cells, backing off at 0.6 cells/s, `GHOST.shySpeed`); pixie flees ghost (2.2) and light (2.5); pixie seeks well (50%, orbit 0.15–0.6, own room). A held ghost leans 0.35 rad toward what holds it (`GHOST.lean`); a jarred pixie flares within 2.5 cells of a ghost |
| Halls | starter: 6–8 cells a side; waypoints: 7–9; unmarked: 6–8, 1% of rooms at depth 3+ (`params.hallChance`, own `'hall'` stream; was 2.5%, which older records keep); corners notched (65% each, 1–2 cells). Halls: 3 push blocks, 1–2 sconces, a save lantern (west half of the centre cell), and their waystone: on the centre cell's north-east quarter with odds 0.5 (`hallStoneChance`, `'waystone'` stream; always, for the starter), else in the first room grown within two rooms (`run.stonePaid`; a free half-cell on the room's `'waystone-spot'` stream); loot as a chamber |
| Waypoints | the start: two near (25–35 cells centre to centre), one far (45–60), all round the root. The first save at a hall's lantern: 0–3 (`waypointOdds`), near/far/near, fanned outward. A free ring around each footprint; pin within ±2 cells of the centre |
| Waystones | loose objects (`kind: 'waystone'` in `run.objects`, `holds`: null, `'entropy'` or `'pixie'`); wake with F: a charge from your lamp (`waystoneCharges`) or a full jar, once; travel (a tap of E): awake to awake only, picked on the big map, along ley lines worked out from where the awake stones stand (each joins its 2 nearest, `leyNeighbours`, plus a spanning tree), the fewest lines first, then the shortest; 1 shard per line (`travelShardsPerHop`) |
| Key | 25% of rooms (depth 1+) can hold one; it shows only while unopened locks outnumber keys held + lying |
| Locked door | 4.5% of unresolved exits on rooms at depth 3, +0.75% per level deeper, up to 9% |
| Crouch | C (L3 on a pad) or the button toggles; crawl at 1.1 cells/s; hidden within 0.2 cells of a block rising 0.38+ above your feet |
| Jump | Space (A on a pad; a button on touch). Take-off 5 cells/s; gravity 20 cells/s² while held and rising, 30 otherwise; letting go cuts the rise to 0.5 cells/s. Held: about 1.4 units up, peaking just after you clear a one-unit block's lip, so you come down on it; a tap: a hop. Forgiveness: 0.1 s after walking off an edge, a press 0.12 s before landing, and a block top up to 0.1 cells above your feet catches you (the figure eases up the difference, 18/s, instead of popping). You stand on a block while your footprint (0.17 cells around your center) is over it, so you step off once your body has cleared the edge, without being shoved. The round shadow is a hard-edged disc cut out of the light, straight down onto every upward-facing surface below your feet (floor, block tops, crates), so it lands right across an edge: inside it your lamp's light is taken away (`opacity`, 0.85) and other lights (the fill, sconces) still reach, so it vanishes where the lamp's light is already blocked or when the lamp is out; smaller and fainter the farther down (`SHADOW` in `figure.js`, patched into three's Lambert and Phong shaders). Never stand above one unit (taller blocks and vessels are walls). Carrying or dragging a block, or a press let go before landing: a hop (2.2 cells/s). `JUMP` in `core.js`, `fall()` in `figure.js` |
| Blocks | 0.32 placement attempts per chamber cell, 0.12 per corridor cell (corridors: singles only). Chamber shapes: single 30%, double 18%, 2×2 30%, row of 3–6 singles 22% (40% of rows have a gap). Height: 1 unit 55%, 2 units 30%, column 15% (rows: 1–2). Never on a cell with a door or an item; kept only if every free half-cell stays reachable |
| Collision radius | 0.2 cells, so a half-cell gap is a real (tight) passage |
| Hash ghosts | spawn 1/14 per room (seeded, `'ghost'` stream); cracked rooms +0.1 +0.3 × cracked share, max 0.4. Wander 0.35 cells/s; paths on the half-cell grid around blocks taller than 1.5 units and hovers 0.45 above lower ones. "?" after 0.25 s lit (light: a 3D ray from the lamp, range 4.5 cells, blocked by walls, closed doors and blocks), then a 0.8 s pause; the ring fills over 3 s of light, drains over 2.5 s without, and the ghost returns to wandering 1.2 s after the ring empties. Chase 0.5 cells/s; give up after 2 s unlit or with a room between you; contact within 0.34 cells, swelling to 0.8 while it touches you and shrinking back over 1 s (`swell`, `swellShrink`). No catching; a room with a ghost in it can't be rerolled |
| Reroll price | 1 charge; only a provisional room (no door out of it ever opened) |
| Checkpoint | written when you save at a lantern: where you wake, and which rooms were standing. A faint makes every room opened since a lost path; it rolls nothing back (doors carved since stay, and a retraced path comes back as you left it, its ghosts, pixies and creepers rolled again) |
| Pack | `run.packs`: [{ id, spaceId, seed, x, y, fuel, keys, doorstones, jars, chalks }]; follows its room (`packStatus`: here, lost, dim, or gone) |
| Lost paths | a faint's rooms, grouped by the door they start from; retrace: a shard per room, at least 1 charge (`retracePerRoom`, `retraceMin`), F with a charged hourglass in hand, which spends its pixie; reroll: E held at the door (the path turns to corruption); `lostDoorChoice`: a choice between the two instead; unchosen: dim at the next faint, fade at the one after |
| Dust | by room mood (`dustMood`): dusty 70% of free half-cells up to 3 layers; still, hollow 35% / 2; warm 30% / 2; echoing, tilted 15% / 1; humming 12% / 1; damp, cold, breathing none. On the floor and the tops of 1- and 2-unit blocks (not crates), in noise patches `dustScale` (3) half-cells across, block tops +0.15 (`dustTops`), thickest in a patch's middle; never on a sigil, well, waystone or save lantern cell, a tool's cell, or under a loose object's start, mark or a vessel. Seeded on the `'dust'` stream (`DP.dust`); saved as `run.dust` (layers taken off, per room and half-cell) |
| Duster | equipment, in your bag from the start for now, hotbar slot 1; F (RT on a pad): one press, one swing (no sooner than 0.18 s, `DUST.swingEvery`). Hits every dusted half-cell whose centre is within 0.75 cells in front (a ±70° arc, `reach`, `arc`; within 0.32 any way you face), 0.5 below to 0.55 above your feet (`reachDown`, `reachUp`: a one-unit block's top from the floor, a two-unit one in a jump), and a crusted crystal the same way; one layer off each |
| Chits | per layer taken off: 45% one chit, 10% a second (`chit`, `chitTwo`); after 3 swings in a row that hit dust and threw none, the next throws one (`pity`). Violet diamonds (points) 0.15 cells across (`chitSize`), thrown out at 1.78 cells/s (`launch`) and bouncing (`bounce` 0.42); within 0.9 cells (`magnet`) they drift to you, gathered within 0.28, each with a 0.32 s dithered violet flash over the figure (seen through anything). Saved where they lie (`run.chits`) |
| Pre-pool | 6 chits (`perShard`) pour a shard into the lamp (the gain that starts `lampGrace`); full with no room in the lamp, it waits, and chits stay on the floor. Six pips under the lamp meter, shown once you've gathered one. A faint leaves it in your pack (`run.dustPool`) |
| Crusted crystals | 80% of shards in a room with dust (`dustCrust`, drawn first on the `'dust'` stream) lie crusted over: today's shard, dull and tilted, half sunk among grey lumps, its cell dusted at least 2 layers deep; a glint every 1.7 s (`glintEvery`) where your lamp's pool reaches it. 3 swipes (`crustLayers`) wake it: the crust falls away, a violet flash, and it rises as an ordinary shard pickup. Saved as `run.crust` |
| Hourglass | 1 room in 20 at depth 3+ (`hourglassChance`, `hourglassMinDepth`, last on the loot stream; loot id still `thread`), one per run; equipment: kept for the rest of the run, never in your pack, pixie and all; holds one pixie (F: catch one, pour into / take from a vessel of pixies, or retrace a lost path at its door); a hotbar slot, an hourglass glyph with the lower bulb lit when charged; in the world, two glass bulbs in a wooden frame, a pixie glowing in the lower one when charged |
| Doorstones | 4.5% of rooms at depth 2+ (seeded on the loot stream); F (doorstone selected) facing a bare wall within 0.4 cells, standing on the floor; never locked |
| Jars | 1/15 of rooms at depth 1+ (seeded on the loot stream, drawn after chalk); a tool, collected by walking over it; holds one pixie or one charge |
| Vessels | 1/10 of rooms at depth 1+, not dead ends (`vesselChance`, own `'vessel'` stream; a free half-cell, off doors, items, sigils, wells, waystones, props and push blocks' starts and marks); up to 3 of one kind (`vesselCapacity`); a loose object in `run.objects` |
| Chalk | start with one silver stick (3 strokes); 1/12 of rooms at depth 1+ hold a stick (seeded on the loot stream, after jars; colour from silver/gold/crimson/teal/violet); F draws on the nearest free quarter ahead (floor or a one-unit block's top, not under a jar, not on another mark); E facing a mark within 0.7 cells wipes it |
| Beyond a lock | `DP.pastLock(exp, space)`: the room's entry door was generated locked (`lockedBySeed`, ignoring that it's since been opened) |
| Sigils | about 1/25 of rooms (seeded `'sigil'` stream; depth 1+, 4+ cells, not on door or item cells; blocks keep off it); up to 4 vessels (one per quarter); a vessel of pixies wakes it fully; each pixie in them = entropy max +1, stacking across sigils |
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

## Dev panel

`` ` `` (backquote, above Tab) opens a dev panel on the right
(`app/walk/dev.js`). The game keeps running under it, so you can walk
with WASD while you tune.

- **Give**: any item or tool, straight into the run. A crate, block or
  vessel lands in your hands (E sets it down as usual). There are also
  fill/empty lamp and full stamina buttons.
- **Spawn**: a ghost, pixie or creeper about a cell in front of you, or
  clear every creature.
- **Teleport**: to any waystone (✦ marks awake ones), or tick "click the
  big map" and click a floor cell on the big map (Tab).
- **Tuning**: one collapsible group per tuning table on `DungeonPlay.walk`,
  built from the tables themselves: numbers get a slider plus a box, on/off
  switches a checkbox, colours a colour picker. Changes apply at once.
  Gold names are changed values; double-click a name to reset it, or use
  a table's reset or "reset all". `RULES` chances (loot, locks, creatures)
  only affect rooms generated after the change. A few numbers that size
  pools at startup are shown but fixed.
- Tweaks stay across reloads in their own storage key (never the save),
  and a "dev tweaks · N" chip shows while any are active. **Copy changes**
  copies them as JSON, to paste to Claude as new defaults.

A table shows up by being exported on `DungeonPlay.walk` and listed in
`TABLES` in `dev.js`. Cheats change the run you're in, and it saves as
usual.

Not yet: regenerating rooms from here to try new generation numbers
(today they only reach rooms generated after the change), a test level,
hand-authored rooms.

## Determinism

Loot uses `deriveRng(space.seed, 'loot')`. A lock uses
`deriveRng(space.seed, 'lock|' + exit.index)`. Neither consumes the layout
stream, so a replayed expedition holds identical shards, keys and locks. A
collapsed-and-regenerated room has a new seed and so new loot. A collected
item is remembered as `spaceId:seed:itemId`.

Props use `deriveRng(space.seed, 'props')` (floor detail uses `'detail'`),
and each placement attempt draws a fixed run of numbers whether or not it
lands. Which single blocks are crates comes from `'crate'`, one draw per
single block, so the layout itself never shifts. The layout only sees a room's original doors. A door added later (a
loop, or one drawn with chalk) just clears any block on its own cell, so it
can never reshuffle the room or drop a block onto the figure. As a
safety net, a figure found inside a block steps out of its nearest side.

A retraced room is the same room (same id and seed), so its loot is the
same, and anything the run keyed to it (`spaceId:seed`) still applies. After
a faint the run has rolled back, so its items lie there again.

Whether a key-capable room actually shows its key depends on the run (were
there locks waiting?), so it's run state (`run.keyRooms`), not seed state.
Traces are engine state, rebuilt by replay from the history's reverts.

A room's mood and hue come from `deriveRng(space.seed, 'meta')`, then the
mood-region decision (keep the parent's mood or start a new one) from
`'region'`. The knobs (`DungeonEngine.MOOD_REGIONS`) are copied into a new
expedition's params, so a replay uses the values it was made with, and
records from before regions keep their old moods. See GAME-DESIGN §18.

Whether a room starts with a hash ghost is seeded (`'ghost'` stream, plus
the room's imprint, which is fixed once the room exists). Where ghosts drift
afterwards is run state: their positions are saved with the run, and each
room's roll happens once (`run.ghostSeen`).

## Playtest notes, 2026-10-24 (shadow creepers, second pass)

Addressed the same day.

- **The drain range was far too big** (3 cells): now a quarter of that.
- **A solid disc, not a ring** (like the lamp's halo, not the edge of its
  reach), shown much less: only while it hunts. Tiers of drain show as
  bands (overlapping discs), handy as a dev view too (`debugBands`).
- **Afraid, it shouldn't drain at all.** Bold, a very faint, short pull.
  Hunting dashes hit harder.

## Playtest notes, 2026-10-24 (shadow creepers, first pass)

Addressed the same day.

- **Structure:** creepers should be their own type, not hang off ghosts.
  We don't yet know the full cast (hostile, helpful like pixies, neutral),
  so no class hierarchy yet: the shared parts (getting around, the light
  check) moved into a creature kit (`creatures.js`) that each type uses,
  alongside the shared off-screen markers (`markers.js`) and screen
  effects (`fx.js` profiles).
- **It hovered like a ghost.** It should be a living thing on the ground:
  now it hops (dip, arc, landing squish, nervous pause) with a contact
  shadow, and walks around every block.
- **Jittery, bouncing between spots.** It re-picked the best shadow every
  third of a second and flipped sides. Now it keeps its spot until your
  light reaches it or you walk off past its edge.
- **It moved closer to get into a new shadow.** It's afraid of the light,
  so closer is always bad while the lamp is lit: it now only waits at or
  past the light's edge and never steps inside it, and only comes closer
  because the light shrank (bold too, with a thinner margin).
- **Hunting, it homed straight in and stopped on you.** Now it skitters
  about you in quick hops, and winds up and dashes at you now and then.
  You can outwalk it; its dashes catch you up in bursts.
- **Too fast by default.** Its hops average well under walking pace.
- **Blinks:** keep them, add quick doubles and triples, and a burst when
  your light hits it (it flinches, blinks off the daze and dashes away).
- **No sign it was draining you, or how far it reaches.** A thin ring on
  the floor at its drain range (hidden while it's afraid, faint when bold,
  full when hunting), and a subtle red glitch that fades in as it drains
  you and stacks with several. The glitch is the ghost's post-process made
  general: each creature kind has a profile (tear, split, static, tint).

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

From the 2026-10-26 jump chat (after playing Voidigo): **movement and
positioning should be a much bigger part of the game**, more expressive and
more yours. Jump is the first step. Not built yet:

- **Hazards you clear or route around.** Tiles, spills, and entities that
  drain entropy or psychic stamina while you're on or near them. Jumping
  over them, crossing on block tops, or finding another way is the play.
- **Trip hazards** (idea, 2026-10-26; not built). Not new geometry: a kind
  of floor feature with no collision. Run across one and you stumble: a
  moment without control, slowed, maybe dropping what you carry, maybe a
  burst of noise. Walking carefully or crouching steps over it, and
  jumping clears it. It rewards moving with intent, fits "running is
  loud", and would be the noise system's first event. A natural first
  hazard, before the draining ones, and the way to get "something to trip
  over" without smaller blocks.
- **A movement design conversation**, started 2026-10-26. Decided so far:
  - **Dash: likely.** It was going to be RT, but since 2026-10-27 RT
    uses the item in hand and LT alone runs; Y and B are free in the
    world, so one of those. A plain dash first; then upgrades, some costing entropy
    or psychic stamina. One idea: a **phase dash** that passes through a
    wall without carving a door.
  - **Movement makes noise** (decided, parked until something listens; see
    `EMERGENCE.md`, step 3). Crawling or moving very slowly is silent,
    walking is quiet (most things won't notice), running and jumping are
    loud.
  - **Falling costs nothing**, for now. There's little height in the game,
    and there may never be much more.
  - **Routes:** rooms generated with traversal in mind. Noted as a possible
    procgen feature in `DESIGN.md`.

  - **Blocks stay on today's grain** (decided 2026-10-26; may revisit): a
    half cell across, one-unit steps, and you stand at most one unit up.
    There's plenty to tune with what's here before adding complexity. More
    heights would want taller rooms (the ceiling is close), muddy the
    "taller than you crouched" hiding rule, and make one jump height serve
    many steps. Smaller blocks would bring back edge catching at the
    figure's size, be hard to read from the camera, and touch the
    generator, saves and push blocks, which all assume the half-cell grid.
    Trip hazards (above) give the "something underfoot" without it.

  Still open:
  - What makes moving feel good here? Acceleration and stopping, and turn
    speed. (The camera got a first pass: `camera.js`.)
  - What do hazards do to the lamp, and what does the lamp do to them?

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
