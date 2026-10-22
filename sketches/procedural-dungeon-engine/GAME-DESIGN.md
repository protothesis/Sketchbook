# Game design: entropy, order and seeds

The direction for walk mode, settled in two design discussions. The first
(2026-10-21) set up entropy, committing and restoration: sections 1–6 and
the first slice, now built. The second (2026-10-22) gave the game a goal and
a clock: sections 7–11 and the second slice. This guides the buildout and is
the reference for why things work the way they do. Unlike
[`CLOSING-THOUGHTS.md`](CLOSING-THOUGHTS.md), this **is** a plan. The
slices near the end say what gets built and when; everything after them is
direction, to be designed in more detail when its turn comes.

For what exists today and its tuning, see [`PLAY.md`](PLAY.md). For engine
decisions, see [`NOTES.md`](NOTES.md).

## The loop

1. **Set out from a waystone** toward a waypoint: a "?" on the map, near or
   far. Something in the ether is pulling you there.
2. **Open a door and look.** A new room is provisional. Walk in, scout it,
   take what's there, and decide.
3. **Keep it or reroll it.** Rerolling steers you toward the waypoint, and
   costs entropy. Every reroll in the same spot leaves the floor more
   cracked.
4. **Commit** by opening any door out of the room. From then on it's fixed.
5. **Your lamp burns entropy** in dark rooms. It's the same pool rerolls
   draw from, so every reroll shortens how far you can go.
6. **Restore** the dungeon on the way: put things back where they belong,
   light what was dark. Push blocks pay entropy; a lit room stops draining
   your lamp.
7. **Arrive.** The waypoint is a setpiece, a big hall. Arriving reveals the
   next set of waypoints. Wake its waystone and it joins your fast-travel
   network.
8. **If the lamp runs out,** you wake at the last waystone you used.
   Everything you did stays done.
9. **Harvest and plant seeds** (later) to shape the map with a scarcer
   resource than entropy.

Entropy is the energy, and now also the light. Order is how you earn it.
Waypoints are where you're going. Waystones are how you get back. Seeds are
how you get agency over what the dungeon grows.

The ethos runs against the usual dungeon crawler: **leave it better than you
found it.** Smashing and looting everything is the wrong instinct here;
mending, tidying and returning things is the right one.

## 1. Committing and rerolling

**A room is provisional until you open a door out of it.** Opening any door
other than the one you came in by commits the room. That includes a loop
door into a room that already exists. A committed room can't be rerolled.

- It's derived, not stored: a room is committed if the expedition history
  has ever recorded a door opened from it, or if a loop has opened a door
  into it. History matters here. Rerolling the room beyond a committed room
  closes that room's only door out again, and a rule that only looked at
  open doors would quietly un-commit it, letting you peel the map back one
  room at a time. Carving a door with a doorstone doesn't commit until that
  door is opened. The root room is always committed.
- **A provisional room never has rooms beyond it.** You can only open a
  room's doors from inside it, and opening one commits it. So a reroll only
  ever touches **one room**, and its price is always the same. There's no
  "you just erased fifteen rooms" surprise, and no price preview to read.
- **Rerolling** happens from the door you came through, as collapsing does
  now: close it, the room dissolves, and reopening it rolls a fresh room.
- **The cost** is one entropy charge (today's per-room price) plus
  **corruption**. The collapsed room leaves its footprint (a trace), and a
  new room over a footprint has cracked tiles and a higher ghost chance.
  Footprints stack, so rerolling the same door again and again wears that
  spot of the dungeon thin. That cost already exists. Build on it.
- **Bigger rerolls are earned.** Collapsing two rooms at once, then three,
  is a power that grows over a run (or across runs). It needs more than
  entropy: a level, an ability or a relic. This is where today's "collapse
  a whole branch" goes: rare, deliberate, late.

**Scouting is allowed.** Walking into a provisional room, taking its loot
and then rerolling it is a legitimate way to find things.

> **Watch for: loot farming.** If one room's loot is ever worth more than a
> reroll, rerolling a single door repeatedly becomes an infinite source of
> entropy. Not a problem to solve yet. If it shows up, the first lever is
> letting footprints thin out a room's loot as well as cracking it ("the
> dungeon is exhausted here"). The second is committing a room when you
> take something from it.

## 2. Entropy

What it's for: rerolling rooms. Later, perhaps more abilities and growing
seeds.

Where it comes from, in rough order of importance:

1. **Restoration** (next section): one-time payouts for setting things
   right. This becomes the main source.
2. **Pickups:** shards as today, but **rarer**. Free entropy lying around
   stays, as a supplement rather than the economy.
3. **Slow sources:** things that pay out while they last, such as a lit
   candle. Anything that pays over time must **run out** (candles burn
   down), or it becomes a farm.

The balance between these is a tuning question for playtesting, not a
design question.

## 3. Restoration

The dungeon is a dilapidated ruin, and the player brings order back to it.
Setting something right pays out entropy, once.

**How it's built.** Each room's seed places its restoration tasks on their
own named stream, like loot, props and sigils today. Replay stays exact, and
adding a new kind of task never shifts anything that exists. A task is a
**socket** (where something belongs, or something waiting to be done) plus,
for some kinds, the **thing** that goes in it.

**Kinds of task**, roughly in the order they're worth building:

- **Push blocks.** A variant of the 1x1 block, styled differently, that
  slides across the floor when you push it. A floor tile in a matching
  colour marks where it belongs. Self-contained in one room, and familiar
  from adventure games.
- **Sconces.** Mounted on walls, unlit. Light one with your lantern for
  entropy. The lantern's light ray already exists.
- **Candles.** Carried and placed anywhere in a room. They pay while lit,
  and they burn down.
- **Lanterns.** Placed on a specific spot, then lit.
- **Things that belong somewhere else**, often in another room, much later:
  - books back to a library's shelves
  - specimens to an empty specimen table
  - a statue's head back on its body
  - furniture back in place, fallen lamps set upright
  - the water turned back on
  - dusting and sweeping, once you've found the broom

**Cross-room tasks don't have to be solvable.** An empty specimen table is a
want you carry, like a journal entry. Specimens deeper down are seeded with a
type that may or may not match it. An unfilled socket is part of the
dungeon's history, not a broken puzzle. That avoids having to guarantee
that every task can be completed.

**Sets and combinations** come later: a dish rack filled with dishes of one
kind pays a bonus, and things combine in surprising ways. There's room for a
lot of this. It's where the variety of collectables lives.

## 4. Seeds

The random seed under all procedural generation, made into a thing you
hold, carry and plant.

**How generation works today.** A new room's seed is
`H(parent seed | exit index | entropy)`, where entropy is 64 random bits
drawn when the door opens. Everything about the room comes from that seed,
each on its own stream: archetype and shape, loot, props, sigil, ghost roll,
mood and colour. The shape is built relative to the door you came through,
then placed. If it doesn't fit beside existing rooms, the engine tries other
entry points, then smaller shapes, then the other archetype, and finally
falls back to a one-cell dead end.

**What follows from that:**

- The same entropy at the same door, with the same surroundings, gives
  exactly the same room. Replay depends on this.
- The same entropy at a **different** door gives an unrelated room, because
  the seed also includes the parent and the exit. So planting a room
  somewhere else means planting its **seed**, not its entropy. That needs one
  engine addition: opening a door with an explicit seed, recorded in history
  so replay holds.
- A planted room keeps its archetype, mood, loot table and props. It's
  **turned to face the new door** (free, because shapes are built relative
  to the door). It may come up **a different shape** if it doesn't fit
  there: a seed is a strong suggestion, not a guarantee. A seed planted
  somewhere cramped comes up stunted.
- **Loot duplication:** loot is tracked by room id plus seed, and a
  transplanted room gets a new id. Either a transplanted room comes up
  already emptied, or loot is tracked by seed alone. Decide this when seeds
  are built.

**Harvesting and planting:**

- **Harvesting** needs a **seed vessel**, a scarce item. You take the seed
  of a provisional room, which collapses it, and the door it was behind is
  **sealed**. A sealed door can't be opened again until a seed is planted
  in it.
- **Planting** puts a held seed into a sealed or unopened door. The vessel
  is used up.
- Seeds can also be **found**, not only harvested.

That separates two economies. **Rerolling** costs entropy, which renews. The
door stays live and gets a fresh random room. **Harvesting** costs a vessel,
which is scarce. You keep that exact room, and the door waits for you.
Sealed doors become a pacing and routing tool, and a choice you can see on
the map.

**Varieties, cultivation and crossing** come later, as a separate layer
with its own pace. They need generation split in two:

- a **genome**: a small explicit record of traits, such as archetype
  weights, size range, mood palette and feature biases
- the **layout**, rolled from genome plus entropy

Then:

| Idea | What it is |
| --- | --- |
| A wild door | the genome is decoded from the hash, as now (nothing changes for normal play) |
| An exact copy | genome plus the same layout roll |
| A cultivar's offspring | the genome, a small mutation, and fresh entropy: variations on a room |
| Crossing | mixing two genomes trait by trait, which can bring out new properties |
| A generic blend ("birdseed") | a broad genome that mostly grows ordinary rooms, with the occasional outlier |

Every seed keeps a random element: an oak seed doesn't always grow the same
oak. This is the biggest engine change on the list. Build it once seeds have
proved themselves in play.

## 5. Door connections: pressed doors, loops, one-way doors and layers

**No change for now.** The door code stays as it is, inconsistency
included. This section keeps the context and the ideas for when it's
picked up.

**What happens today.** Sometimes a room B is generated against a wall where
room A already has an unopened door (a "pressed door"). A shows a door; B
shows solid wall and has no record of it. Opening it makes a **loop**: B
gets a matching door and the two rooms are connected. This is tracked
cleanly. Replay reproduces it, a loop never makes B part of A's branch, and
reverting either room undoes the loop correctly. With the commit rule, a
loop also commits both rooms.

It happens two ways:

1. **On purpose:** when a room is generated, a door facing an existing room
   is sometimes kept, to create loops.
2. **By accident:** A's door faced empty space, and B was placed there
   later. Placement checks only that cells are free, not what's in front of
   other rooms' doors.

**The known gap:** before it's opened, the two sides disagree. In walk mode,
A's door panel has B's wall behind it. On the maps, a door points into a
wall. That's accepted for now. If it's fixed later, B would show the door
from its side as an outline pressed into its wall, and the maps would mark
these doors distinctly.

**What a pressed door could lead to.** These could all exist side by side,
granted by items, abilities or energy, with **one default** so the rule
stays learnable.

### Loops (today's behaviour)

A normal two-way passage between two rooms that already exist. Loops still
have a place: they make the map a network instead of a tree, and finding
that "this door opens onto a room I've been in" is a good House of Leaves
beat. They're also the natural fallback for every other outcome.

### One-way passages

A connection with only one end. You pass from A into B, and B's side stays
wall. Go back around to A and the door is still open onto B, but stepping
through B's side again meets a wall.

- It's easy to build on the engine: a connection that only one room knows
  about, which collision and ghost pathing respect in one direction.
- It needs its own visual language, because green arrows already mean "the
  way this door rerolls".

### Layers ("impossible space")

Opening the door leads into a room that overlaps the rooms around it, but
exists in another layer: a branch of reality that joins the first only at
that threshold. It can happen again from inside a layer, going deeper.

- **How it maps onto the engine:** the registry (which room owns each cell)
  is a flat grid today. Make the layer a third coordinate. A door whose far
  cell is taken in layer 0 opens into layer 1, where that cell is free, and
  the room there generates normally.
- **Shared layer, not private pockets.** If layer 1 is one shared space, two
  doors into it from far-apart parts of layer 0 grow rooms that can meet and
  loop inside it. That gives shortcuts between distant points of the real
  map, for free. This is the "connect two points of layer 1 while walking in
  layer 2" idea. Going deeper (layer 2 out of layer 1) works the same way.
  Private pockets per door are simpler, but each is a dead-end branch.
- **Styling:** each layer looks different, and only your current layer is
  drawn (other layers perhaps faintly).
- **Cost:** everything that looks up a cell needs the layer: collision, the
  maps, rendering, ghosts, footprints. Each change is mechanical, but there
  are many of them. It's comparable in size to seed genomes.

### Other outcomes

- **Older doors win.** A's door was there first, so B was placed illegally.
  Opening A's door makes a provisional B reroll out of the way.
- **The space inside the wall.** The door opens into a narrow passage
  between A and B, the House of Leaves hallway. It could be a layer that
  only ever holds corridors.
- **False doors.** The door is sealed: a promise that couldn't be kept. A
  doorstone or another tool forces it.

## 6. Entities and pushback

- **Hash ghosts stay passive for now.** They're one of what will be many
  entities, and they haven't been tested enough to change much. They keep
  their current behaviour: notice, follow, wobble, get caught in jars.
- **What pushes back is still open.** It's the next big design question
  after the first slice. Ideas noted so far:
  - an entity that undoes restoration (knocks things over, blows out
    candles)
  - depth making the dungeon stranger and darker
  - entropy draining over time
  - doors past a lock that can't be undone
  - a second, actually threatening entity

## 7. Why play: the problem the second discussion solved

After the first slice, exploring was satisfying but had no purpose. Three
reasons:

- **The economy only fed itself.** Restoration earned entropy, entropy paid
  for rerolls, rerolls made new rooms with more restoration in them. Nothing
  outside that cycle wanted anything from it.
- **A reroll had no target.** Standing at a provisional door, there was
  nothing in particular to hope for, so there was no reason to prefer one
  room over another.
- **Everything behind you was spent.** Restoration paid once, and a
  committed room had nothing left to give. The game pushed you forward and
  never back.

A clock (stamina, a timer, the lamp) fixes pacing but not purpose. The
answer is a **want** first (waypoints, section 8), then a **limit** that
gives it tension (the lamp, section 10), and a reason to **come back**
(waystones, section 9).

**The shape: a persistent world, bounded expeditions.** Not a fresh seed per
run, and not one endless walk either. The dungeon persists, and each trip
into it is limited by the lamp and anchored at waystones. That isn't a
roguelike (a fresh world each run, with permadeath) or a roguelite (runs
reset, some progress carries over). It's closer to a procedural Hollow
Knight, with Minit's short pushes and Death Stranding's building.
Games worth looking at for each piece:

| Piece | Who does it well |
| --- | --- |
| Persistent world, bounded runs | Minit, Outer Wilds, Loop Hero |
| Light as a clock | Darkest Dungeon, Don't Starve |
| Lit rooms are safe rooms | Dungeon of the Endless |
| Your building makes later trips easier | Death Stranding |
| Checkpoints and hub-to-hub travel | Hollow Knight (benches, stag stations), Dark Souls |
| Putting things where they belong | Unpacking, PowerWash Simulator, Wilmot's Warehouse |
| Unknown nodes you choose to go to | Slay the Spire's "?" rooms |
| Secrets in a dense map | Animal Well, Tunic |

**A rule carried over from earlier games: never force backtracking, reward
it.** The main thread never makes you retrace your steps. Going back should
be fast and safe when you choose to (waystones, lit rooms). Cross-room fetch
tasks, when they come, are the one place you're asked to go back, so they
can't arrive before fast travel is solid.

## 8. Waypoints

**A set of three "?" pins on the map: two near, one farther.** Each marks a
place the dungeon will grow a setpiece. Pick one; the far one is the
push-your-luck option.

- **A pin is the pull.** It gives rerolls a target: a room whose doors all
  lead away from where you're going is worth rerolling.
- **The footprint is reserved in the engine,** not just marked. The
  setpiece's cells are claimed when the set is made, so ordinary rooms grow
  around it and can't crowd it out. A door that runs into the footprint
  opens into the setpiece, the way a loop opens into an existing room. Any
  room built against the footprint always gets at least one door into it.
- **The footprint isn't shown.** The pin sits somewhere in or around it,
  not at its centre, so you know roughly where, not exactly.
- **Arriving reveals the next set.** Opening the setpiece's door places
  three more pins, out past it (away from the start).
- Reservations are history events, so replay, export and the chart view all
  keep them.

**Later:**

- **What's there varies.** Not always a setpiece: sometimes a false flag
  (an ordinary room, or nothing much), sometimes a threat. A category of
  points of interest, with some chance to it.
- **Setpieces in ordinary generation too,** without a pin, as a rare find.
- **Chapters.** Group waypoints into sets that, when finished, reveal the
  next set farther out or deeper. Arcs without a size cap. (Today every
  arrival adds a set, so unvisited pins pile up. Chapters would tidy that.)

**Caveats:**

- A footprint can still get boxed in, by rooms that touched it before it
  was reserved (they have no door toward it). Doorstones are the backstop.
  Watch for it in play.
- An endless map is fine for now. Revisit a cap or a resource limit if it
  stops being fun or fast.

## 9. Setpieces, the starter hall and waystones

**Halls** are a new room archetype: large (7–9 cells a side for setpieces,
6–8 for the starter), a rectangle with notched corners so it reads
differently from a chamber.

- **The starter hall** replaces the root chamber in new expeditions. It's
  the first waypoint, in effect: always at least two ordinary doors, one
  **surface door** (below) and an awake waystone.
- **A setpiece hall** always has three push blocks, at least one sconce and
  a dormant waystone, plus whatever else any room can hold (loot, props,
  sigils, ghosts). Setpieces are committed the moment you arrive: no
  rerolling them.
- **Later:** setpieces ask for things from elsewhere (books, dishes,
  paintings, a statue's head), turning section 3's cross-room tasks into a
  shopping list. Fully restoring one earns a reward still to be decided.
  Restoring isn't what wakes the waystone: a multistage restoration would
  be too much to ask before you can travel.

**Waystones** are small monoliths, half a cell wide and about 2.5 block
units tall, covered in arcane markings.

- **Waking one costs a little entropy** (one charge). An awake waystone's
  markings glow.
- **Fast travel goes waystone to waystone,** never from anywhere. E at an
  awake waystone lists the others. Travel is free for now.
- The last waystone you woke or travelled through is where you wake if your
  lamp runs out (section 10).
- A room with an awake waystone counts as lit.

**The surface door** is a placeholder exit from the game loop. Opening it
asks "Up to the surface (quit game)?" Going up saves and shows the
expedition record. It's the bridge to something above the dungeon later: a
town, a place where seeds are cultivated, whatever happens between
expeditions.

## 10. The lamp

**One pool of entropy is both your light and your rerolls.** That's the
"spend to get" the economy was missing: every reroll toward a waypoint burns
fuel you need to get there.

- **The lamp burns entropy in dark rooms,** a shard every few seconds. In a
  lit room (a lit sconce, or an awake waystone) it doesn't burn.
- **Lighting a sconce costs you a shard** (you give it some of your flame)
  instead of paying one. In return that room never drains your lamp again.
  Restoration becomes an investment in the way back, not a one-time payout.
- **Push blocks still pay a charge.** A setpiece's three blocks make it an
  oasis.
- **Running low dims the lamp.** On the last charge, the light shrinks and
  flickers.
- **Running out:** the lamp gutters, and you wake at your last waystone
  with the starting entropy. Everything else stays: the map, what you
  carry, what you restored. **You lose only your position.** Start gentle;
  add bite (dropped items, a corpse run) only if it's too soft.

**Later:** cover the lantern on purpose (to slip past hash ghosts, which are
drawn to light) at the price of relighting it. That pairs with a second
kind of threat that lives in the dark (section 6), so light and dark each
have dangers and which one you want depends on the room.

## 11. Walked paths stay alive (later)

"Everything behind you is spent" has a second answer, held for later: the
routes you actually use stay lit and swept, and branches you leave alone
slowly dim and gather dust. Planners call these desire paths.

- It's a **bonus for use, never a tax for neglect.** Nothing you restored is
  taken back, and nothing has to be maintained. A dimmed room just costs
  lamp fuel to cross again.
- Hold it until the lamp, waypoints and waystones have proved themselves.
  Decay is invisible complexity, and a maintenance game isn't the goal.

## First slice (built 2026-10-21)

Built as planned; kept for the record.

1. **Commit on exit.** A room becomes fixed when you open any door out of it
   (derived from its doors, so no new save state). Closing the door you came
   through rerolls a provisional room, for one charge. A committed room's
   doors offer no collapse. The prompt and the green arrows say which rooms
   are still provisional.
2. **Push blocks.** A pushable block variant that slides cell by cell, with
   a matching coloured floor mark where it belongs. Seeded per room on a new
   stream. Placing it pays entropy once.
3. **Sconces.** Unlit wall sconces, seeded per room on a new stream. Light
   one by holding your lantern to it. Lighting pays entropy once, and it
   stays lit (saved with the run).
4. **Retune entropy.** Fewer shards. Restoration becomes the main income.
   Tune by playing.

**Not in this slice:** candles, cross-room tasks, multi-room rerolls, seeds,
any door-connection changes, pushback. They're all described above for when their turn comes.

## Second slice (2026-10-22)

Built together, since none of it means much alone. Programmer art is fine
throughout.

1. **Push blocks in solid colour.** The whole block takes its colour
   instead of a coloured decal on top.
2. **Halls.** The archetype, the starter hall for new expeditions (older
   saves keep their root chamber) and the surface door.
3. **Waypoints.** Reserved footprints in the engine, three pins per set, a
   door into every footprint you build against, a setpiece on arrival, and
   the next set when you arrive.
4. **Waystones.** Wake one for a charge; travel between awake ones.
5. **The lamp.** Burns a shard every few seconds in dark rooms; sconces cost
   a shard to light and stop the drain; dims when low; gutters and wakes
   you at your last waystone.

**Next, after playtesting it:** what's at a waypoint varies (false flags,
threats); setpieces ask for things from elsewhere; setpieces in ordinary
generation; a reward for fully restoring one.

**Later:** walked paths stay alive (section 11); covering the lantern and a
threat in the dark; chapters of waypoints; seeds (section 4); secrets.

## Open questions

- How is the power for bigger rerolls earned: a level, an ability, a relic?
- What does fully restoring a setpiece earn? (Waking its waystone is
  separate and cheap.)
- Where does cultivation happen? Perhaps on the surface, past the surface
  door.
- How do secrets work in a procedural map? Animal Well and Tunic hide them
  in a hand-made one. Pressed doors, false walls and rules you learn (not
  places you memorise) are candidates.
- Does the lamp's drain rate feel like tension or like a nag? Tune by
  playing.
