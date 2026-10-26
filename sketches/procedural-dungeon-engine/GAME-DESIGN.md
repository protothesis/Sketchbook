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
   light what was dark. Push blocks pay entropy; a lit sconce gives the
   lamp a place to rest (snuff it and its shard comes back).
7. **Arrive.** The waypoint is a setpiece, a big hall. Wake its waystone
   and it joins your fast-travel network, and new waypoints may appear.
8. **Using a waystone is a checkpoint.** If you faint (your psychic
   stamina runs out, in the dark or in a ghost's reach), you wake at the
   last waystone you used, and everything opened since becomes a **lost
   path**. Your run (what you carry, what you lit and pushed) goes back
   to how it was there. At a lost path's door you choose once: retrace it
   (with a charged hourglass, for entropy) or let it go (section 17).
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
  from adventure games. Crates are the plain version: loose, no home, no
  reward, just something to move. Both can be carried out of their room;
  what's sitting in a room when it's rerolled is despawned with it (kept
  in a list, for later), and anything elsewhere stays.
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
mood and colour. (Mood and colour also lean on the parent room's: see §18.) The shape is built relative to the door you came through,
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
- **Far apart.** Opening doors costs nothing, so a waypoint has to be a
  journey: two near (25–35 cells) and one far (45–60) to start.
- **Waking a waystone reveals more,** not arriving: 0–3, with 0 and 3
  rare, and never 0 while no pin is left waiting. Arriving at every hall
  and adding three each time filled the map with pins (playtest,
  2026-10-22).
- **Unmarked halls** also turn up as a rare ordinary room (1 in 100), so a
  run of 0s doesn't strand you, and stumbling on a hub is its own small
  event. Rare, because big rooms that weren't waypoints made the real ones
  feel less special (playtest, 2026-10-22).
- Reservations are history events, so replay, export and the chart view all
  keep them.

**Later:**

- **What's there varies.** Not always a setpiece: sometimes a false flag
  (an ordinary room, or nothing much), sometimes a threat. A category of
  points of interest, with some chance to it.
- **Maps as items:** a found object that marks a new waypoint, another way
  to get pins besides waking waystones.
- **Chapters.** Group waypoints into sets that, when finished, reveal the
  next set farther out or deeper. Arcs without a size cap.

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

- **Waking one costs a little entropy** (one charge), and reveals new
  waypoints (section 8). An awake waystone's markings glow.
- **Fast travel goes waystone to waystone,** never from anywhere. E at an
  awake waystone opens the map with the others highlighted; pick one.
- **Ley lines.** Awake waystones form a network. Waking a stone links it
  to its two nearest awake stones, and links stay once made, so the
  network grows in the order you woke them (and later you might re-tune
  it on purpose). You ride the lines,
  not the air: a trip takes the fewest lines, and **each line costs a
  shard**, so crossing a big map costs real fuel and nearby hops stay
  cheap. Free travel let you place yourself anywhere, which skipped over
  everything (playtest, 2026-10-22).
- **An awake waystone shows it:** shining glyphs, a faint shaft of light, a
  violet-blue light on the room.
- The last waystone you woke or travelled through is where you wake if you
  pass out (section 12).
- **Later:** travel as an active act, not a menu: steer along the line, or
  a small rhythm game of taps at spaced marks you see coming. A bad run
  costs more (or, at worst, drops you partway along the line); a perfect
  one refunds some of the fare, so it's a skill reward as much as a
  penalty. Not hard, just enough to make it deliberate. Re-tuning links;
  abilities or items that make travel cheaper or reach farther;
  lines with properties of their own (one-way, free, dormant until
  something is restored); whether waking should cost more than a charge.
- A waystone doesn't shelter the lamp. Only sconces do.

**The surface door** is a placeholder exit from the game loop. Opening it
asks "Up to the surface (quit game)?" Going up saves and shows the
expedition record. It's the bridge to something above the dungeon later: a
town, a place where seeds are cultivated, whatever happens between
expeditions.

## 10. The lamp

**One pool of entropy is both your light and your rerolls.** That's the
"spend to get" the economy was missing: every reroll toward a waypoint burns
fuel you need to get there.

- **The lamp burns entropy steadily,** a shard's worth every 18 seconds,
  everywhere except right by a lit sconce (its tile and the ones around
  it).
- **Entropy is fluid.** The meter is a countdown you can watch drain,
  sectioned into charges. A shard pours in a third of a charge; any gain
  holds the burn for a moment so it isn't gone the instant you earn it.
- **Lighting a sconce costs you a shard** (you give it some of your flame)
  instead of paying one. In return there's a spot by it where the lamp
  rests. Restoration becomes an investment in the way back, not a one-time
  payout.
- **Push blocks pay two shards,** and can be moved again; moving one off
  its mark takes them back. A setpiece's three blocks make it an oasis.
- **A smaller tank** (6 charges). The first lamp made a full meter easy to
  keep, and the game turned into running for resources. The aim is
  something between, leaning slow and careful (playtest, 2026-10-22).
- **You feel it running low** without reading the meter: the lamp's colour
  slides from yellow to red to grey and flickers, its halo shrinks, its
  sparks thin out, and the light gets dimmer and shorter.
- **Three stages you can feel,** tied to the meter: uneasy at 2 charges
  (a little more flicker and wobble), danger at 1 (a clear flicker),
  dying at half a charge (the flicker settles into a slow, irregular fade
  that swells as you move, and the odd red ember). Blended, never stepped.
  The light reddens and its reach shrinks hard.
- **The light has a hard edge** (2026-10-25): a circle around you, there
  at a full lamp too, that shrinks with the fuel. Inside, the light looks
  as it always did; past it, only the dark. You always know how far your
  light goes, and creepers wait just past that edge. Smaller than the old
  falloff, which lit across whole rooms.
- **Light pools** (2026-10-26): the lights look as they always did, walls
  included. Your lamp and lit sconces also own a pool on the floor, the
  circle where their light shows, in bands. Pools merge where they
  overlap, and the pool is exactly what creatures read as light: what
  you see is what they obey. Waystones are their own kind of light, with
  no pool.
- **Running out:** the lamp goes out and stays out until you relight it
  (R, a shard), and the dark drains your psychic stamina (section 12). Find light or entropy in time, or pass out and
  wake at your last waystone. Everything else stays: the map, what you
  carry, what you restored. **You lose only your position.** Start gentle;
  add bite (dropped items, a corpse run) only if it's too soft.

**Covering the lamp** (R, built 2026-10-22): no light, no burn, and
ghosts can't notice you, at the price of the dark wearing on your stamina
and a shard to relight. **Later:** a second kind of threat that lives in
the dark (section 6), so light and dark each have dangers and which one
you want depends on the room.

## 11. Walked paths stay alive (later)

"Everything behind you is spent" has a second answer, held for later: the
routes you actually use stay lit and swept, and branches you leave alone
slowly dim and gather dust. Planners call these desire paths.

- It's a **bonus for use, never a tax for neglect.** Nothing you restored is
  taken back, and nothing has to be maintained. A dimmed room just costs
  lamp fuel to cross again.
- Hold it until the lamp, waypoints and waystones have proved themselves.
  Decay is invisible complexity, and a maintenance game isn't the goal.

## 12. Psychic stamina, and ghosts that stay

**Ghosts stay.** Catching them in jars made a stealth threat into an easy
lure, and they're one of the few things that make you slow down and think
about where you stand. So nothing removes them, and **a room can't be
rerolled while a ghost is in it**. You manage ghosts instead: they're drawn
to pixies (section 14).

**Psychic stamina** is the consequence. A meter that's a health bar in all
but name:

- **A ghost's touch** knocks a chunk off and drains it for as long as you
  stay in reach. Once a ghost has hold of you its reach swells a little,
  so you have to hustle; clear of it, it shrinks back.
- **The dark** drains it more slowly (about 12 s from full): an empty or
  covered lamp, away from a lit sconce.
- **Empty: you pass out** and wake at your last waystone, with only your
  position lost.
- **It comes back** in light, once nothing has drained it for a moment.

**Why a meter, not a respawn on contact:** you can push a door open into a
closet with a ghost in it and have no time to react. A hit you can walk
away from keeps that fair, without a pile of placement rules.

**Later:** different drain rates for ghosts and the dark; things that
restore stamina; covering the lantern on purpose (section 10).

## 13. Entropy wells

A basin in the floor that pours entropy into your lamp while you stand in
it, up to a charge, and then runs dry. A **local, depletable** source:
something to plan a route around, unlike shards (one-off) or the lamp's
own drain (everywhere).

- **Surge wells** come back all at once after a long cooldown.
- **Trickle wells** start refilling soon after you last drew on them, and
  slowly, so there's always a little to come back for.

Both exist, so a room's well is a small decision: a surge well is a big
drink later; a trickle well is a reason to pass by often.

**Each shows its clock in the world.** A surge well's rim has notches that
light one by one through its cooldown, and the pool bursts back when the
last one lights. A trickle well has a drip: a drop slowly forms while it
waits, then drops fall and the pool grows. This is the rule for
everything from here on (section 15).

**A jar carries a well.** Swipe an empty jar through a full well and its
charge goes into the jar instead of your lamp; pour it into the lamp later
(all or nothing). It's how to bank a well you'd otherwise waste on a full
lamp, or bring entropy to where you'll need it. (It cuts against the
*temporary entropy* idea below: if that's built, jarred entropy might be
the one kind that keeps.)

**Later:** *temporary* entropy with a potency that starts draining at once,
so you can fill up but can't carry it across the map; wells you have to
restore before they flow.

## 14. Pixies, jars and the ecology

**Pixies** are a second creature: small winged lights. Catch one in an
empty jar (a tool; a jar holds one), then pour it into a **vessel**, a
clay urn you carry and set down (up to 3 of one kind). A vessel of pixies
does two things, and you have to choose:

- **On a sigil** it powers the sigil (+1 entropy max per pixie).
- **Anywhere else** it draws ghosts. They drift over and circle it, wander
  off and come back, like moths. It's how you move a ghost out of your
  way, never how you get rid of one.

**The ecology** is the first step toward emergent behaviour: creatures
respond to *tags*, through a small table of rules, not to each other by
name. Ghosts seek pixies, pixies flee ghosts, pixies linger at wells. A
jarred pixie is still a pixie, so jars draw ghosts with no jar rule; and
since pixies gather at wells and ghosts at pixies, ghosts come to haunt
wells, which no rule says.

**Light is in the web too.** Your lamp is a presence (`light`, `lamp`,
`player`), and so are lit sconces and awake waystones (`light`,
`steady`). Pixies flee light, so you chase them down, or cover the lamp
and creep up. Ghosts shy from steady light, so restoring a room pushes
them back. And a ghost that comes near a pixie is *held* by it, turning
away even from you: a jar dropped behind you peels a follower off. How to grow this into an ecosystem, and why,
is in [`EMERGENCE.md`](EMERGENCE.md).

## 15. Tell, don't label

Every behaviour (an item's, an interaction's, a creature's) should
telegraph itself in the world, not in a meter or an icon. The wells'
rims and drips are the model; the lamp's stages, the shimmer and stream
when something feeds it, a ghost leaning toward what draws it, a pixie
flaring in its jar. The ghosts' "?", "!!" and rings are dev art to
replace the same way. A general in-world timer (like the surge rim) could
serve anything with a cooldown.

## 16. Darker the farther out (later)

The farther a path runs from a waystone (or the start), the darker and
spookier it should get, until you restore it: the dungeon pushing back,
and restoration as the way you push back. It's the "depth makes it
stranger" idea measured from your anchors instead of from the root.
Candidates: fewer sconces and more ghosts by distance from the nearest
awake waystone; the light shorter; imprints and cracks heavier.

## 17. Saves, checkpoints and fainting

A proper game loop around the run (built 2026-10-24).

**Two save slots.** *Resume* is written all the time (every second, when
the page is hidden, when you quit to the menu): it's how closing the
laptop and coming back works. *Checkpoint* is progress: a full snapshot
written when you use a waystone (wake it, travel from it, or just touch an
awake one). Quitting writes only the resume slot.

The two are different things on purpose: the resume slot is an autosave
(where you are), the checkpoint is your respawn (where you wake). Walking
through a waystone hall doesn't move your respawn; touching the stone
does. The game teaches it in passing: entering a hall with an awake
waystone that isn't your respawn adds "you'd still wake in s3 · touch the
waystone to wake here" to the room's line.

There is one run at a time. New run replaces it (the title warns first,
and offers an export). A picker over several runs can come later.

**A title screen** on load: Continue (the resume slot), New run, and
import / export of a save file (both slots in one file). A **pause menu**
(Esc, or the Menu button for touch): Resume, Quit to main menu.

**A version stamp on every save.** A save from another build isn't
loaded; the title screen says so and offers a new run (and an export, to
keep it). Strict backwards compatibility is no longer a goal: a change to
what a history builds bumps the stamp instead of hiding behind params for
old records. Within one build, replay is still exact.

**Fainting costs progress.** Waking at your last waystone used to be free.
Now every room that wasn't standing at your checkpoint is lost, and so is
every door carved since (the doorstones come back with the run). The run
rolls back to the checkpoint too: inventory, entropy, keys, lit sconces,
pushed blocks, wells, ghosts. Tallies (time walked, faints, collapses)
carry on, and so does your equipment (the hourglass, pixie and all).

**Two kinds of trace.** A reroll is a choice, one room at a time, and its
trace cracks the floor and draws ghosts. A faint is a failure, and loses a
whole path at once. Treating those the same made big dungeons noisy, so
they're apart now:

- **A lost path** is quiet: drawn in violet on the map, no cracks, no
  ghosts. Its door has a violet seam. It waits for your choice.
- **Retrace it** (E at the door): the whole path comes back as you left it
  (same rooms, same ids and seeds), for **a shard per room, at least a
  charge**. Rooms whose footprint has since been taken can't come back,
  and neither can anything beyond them: those turn to corruption. Only
  with a **charged hourglass** (below). Without one, a lost path can only
  be let go.
- **Let it go** (push the door): something new opens, and the whole path
  turns to corruption, loud traces like a reroll's, so the new room grows
  over cracked, haunted ground.
- **Ignore it**, and each later faint dims it; the second one fades it:
  gone, footprint free, no corruption, no choice.

You might not afford a retrace when you wake. That's fine: go and find
the entropy, then come back.

Waypoint distance stays as is (it played well).

**The hourglass (2026-10-26).** Retracing used to need the thread, found
once and kept. It's the hourglass now: part jar, part key. Still a rare
find (1 room in 20, depth 3+, one per run), but it starts empty and holds
one pixie, caught the way an empty jar catches one, or taken from a vessel
of pixies (and poured back into one). Only a charged hourglass retraces,
and the retrace spends the pixie, so every path you bring back costs a
pixie as well as entropy.

It's the first piece of **equipment**, a draft fourth item class beside
pickups, tools and objects: things that are always with you, and so is
what's in them. A faint keeps them, whatever it does with the rest of what
you carry (the coin purse will be equipment too). Code: `hourglass.js`,
with `canRetrace()` and `spendHourglass()` for the door code.

**Next, after the door rework is tested:** *use* the charged hourglass on
a lost path's door to lock in the choice to restore it, the way a key is
used on a locked door (F with it in hand). That spends the pixie, and
still costs entropy. For now the door just checks for a charged hourglass
when you retrace with E.

### Needs a design pass: what a save keeps (open, 2026-10-24)

Found in playtesting, deliberately not fixed yet. Checkpoints, progress and
waystone interactions are tangled, and want thinking through together, in
one place, before anything changes.

**The symptom.** You wake in a waystone hall and the blocks you pushed home
and the sconces you lit there are undone, every time.

**Why.** Restoration lives in the run (`run.pushed`, `run.lit`,
`run.wells`), not in the map. The checkpoint is a snapshot of the run taken
the moment you use the waystone, and a faint rolls the run back to it. The
natural order is to arrive, wake the stone (checkpoint), then tidy the hall,
so the tidying comes after the snapshot and a faint takes it back. Tidy
first and touch the stone after, and it sticks; nothing teaches that, and
it's backwards.

**The wider questions:**

- **What is progress, and what is the run?** Today a faint rolls back
  everything in `run` except tallies and equipment. Restoration (the
  "leave it better than you found it" ethos) arguably belongs to the world,
  not to the run, and shouldn't be undone by failing. Inventory and entropy
  probably should be.
- **Entropy paid for restoration.** A block home pays entropy once. If
  restoration survives a faint but fuel rolls back, the payout is lost for
  good (no farming, but a real loss). Is that the intent?
- **What sets your respawn?** Only touching a waystone (wake, travel, E).
  Passing through a hall doesn't. Should anything else: restoring in a
  hall, resting, lighting its sconces?
- **Autosave vs checkpoint vs respawn** are three ideas sharing two slots
  (resume = where you are; checkpoint = what a faint rolls back to, and
  where you wake). Should "what's kept" and "where you wake" be separate?
- **Lost rooms' restoration.** If restoration is kept, a retraced path
  comes back tidied. Is that right?

Options already on the table: (1) restoration survives faints (pushed,
lit, wells kept; inventory and entropy roll back); (2) restoring inside a
waystone hall writes a checkpoint; (3) keep it and teach "touch the stone
after tidying".

## 18. Mood regions (built 2026-10-25)

The atmosphere is the game's main character, so areas should have one,
not a fresh mood behind every door. A first, simplest step, before moods
do anything:

- A room **inherits its parent's mood** with high odds (`inherit`, 0.8), so
  a branch has stretches of one mood. Its hue stays within `hueDrift`
  (14°) of the parent's, so a region reads as one colour on the map and
  in the walls.
- Otherwise it **starts a new region**: a new mood (with its own hue) that
  then tends to persist in turn. With odds `junction` (0.6) the new mood is
  one the old mood leads into, from a small table: still → hollow, cold,
  dusty; damp → cold, breathing, echoing; humming → warm, breathing,
  tilted; cold → still, damp, echoing; echoing → hollow, damp, still;
  dusty → still, warm, hollow; breathing → damp, humming, warm; tilted →
  humming, hollow, echoing; warm → humming, dusty, breathing; hollow →
  echoing, still, tilted. Else any mood.
- The root, and a waypoint hall (built from its reserve's own seed, so it's
  the same whichever door reaches it), roll their own mood as before.

**Seeds and replay.** The room's own mood and hue are still drawn from
`deriveRng(seed, 'meta')` exactly as before; the region decision is drawn
after, from `deriveRng(seed, 'region')`, and only overrides them. So
layouts, loot and every other seeded thing are identical with regions on
or off. Since a room's mood now depends on its parent's, it's no longer a
property of its seed alone: a planted seed (§4) would take on the mood of
the door it's planted in, unless planting carries the mood with it. Decide
that when seeds are built.

**Tuning and turning it off.** The knobs are `DungeonEngine.MOOD_REGIONS`.
A new expedition copies them into its params (`moodInherit`,
`moodJunction`, `moodHueDrift`), so changing them needs a new expedition,
and a replay always uses what the record was made with. `inherit: 0` is
off: the params then carry no mood keys, and generation is byte for byte
what it was before regions. The junction table isn't copied, so editing it
changes the moods of saved expeditions (not their layouts).

**Next** (not built): moods with mechanics (dust that shows footprints,
damp that dims the lamp), regions of material as well as mood, and
regions that know their size (a region that has run long enough ends).

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

## Second slice (built 2026-10-22)

Built together, since none of it means much alone. Programmer art is fine
throughout. What exists and its tuning is in [`PLAY.md`](PLAY.md).

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

**Revised after the first playtest (2026-10-22):** waypoints much farther
apart and revealed by waking waystones (0–3); rare unmarked halls; only
sconces shelter the lamp, within a tile; travel picked on the map; the lamp
as a fluid meter with a HUD of its own and a lamp you can read at a
glance; push blocks movable again. Notes in [`PLAY.md`](PLAY.md).

## Third slice (built 2026-10-22)

From the voice-memo playtest (notes in [`PLAY.md`](PLAY.md)): ghosts stay
and psychic stamina (section 12); entropy wells (section 13); pixies, jars
and the ecology (section 14); ley lines and a fare for travel (section 9);
slower pacing (section 10); rarer unmarked halls (section 8); the lamp's
halo and embers, and awake waystones that glow.

**Revised after playing it (2026-10-22):** pixies hold ghosts (even off
a chase) and flee light; ghosts shy from steady light; the lamp in three
blended stages, with R to cover and relight it; wells that show their
clocks; ley links that stay once made; a bigger lamp HUD that shows what
feeds it.

**Next, after playtesting that:** what's at a waypoint varies (false flags,
threats); setpieces ask for things from elsewhere; a reward for fully
restoring one; maps as items; more creatures and rules for the ecology.

**Separately, on its own branch:** an engine pass on room generation and
archetypes (more irregular shapes, like the halls').

**Later:** walked paths stay alive (section 11); a threat in the dark;
darker the farther out (section 16); active travel (section 9); chapters
of waypoints; seeds (section 4); secrets.

## Fourth slice (built 2026-10-24)

The game loop (section 17): save slots with a build stamp, a title screen,
a pause menu, waystones as checkpoints, faints that cost every room and
carved door since the checkpoint (and roll the run back), and lost paths
you retrace (with the thread, now a charged hourglass) or let go.

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
  playing. (Slowed once, 2026-10-22.)
- Should the dark and a ghost drain stamina at different rates?
- Should waking a waystone cost more, given travel now costs too?
- With faints costing rooms: does the lamp drain too fast, should sconces
  shelter more? (Waypoint distance felt right, 2026-10-24.) Tune by
  playing.
- Is a shard per room the right retrace price? Is the hourglass too rare
  now that it needs a pixie too, or should retracing become an earned
  ability instead?
- Should touching a waystone stay the only way to move your respawn, or
  should something else (resting? lighting a sconce?) set it too?
