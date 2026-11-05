# Structure types (2026-11-05)

Why this exists: playtests found the map reads as "a big clumped, smashed blob
of rooms". Hallways double back, and you can't retrace a route by eye in 3D or
on the minimap. The generator was purely local: each room knew only its
parent and which cells were taken. It filled every gap, made loops wherever
a door happened to touch a wall, and bent corridors at random. Real
buildings, and even real underground places, have a logic you can lean on.
This note collects that logic as **structure types** for regions
(`engine/regions.js`).

## Vocabulary: what makes a place legible

Kevin Lynch, *The Image of the City* (1960), on why some places are easy to
hold in your head:

- **Paths**: the routes you move along. A legible place has a few main ones
  and a clear hierarchy (main corridor, side passage, closet).
- **Edges**: boundaries you don't cross. Courtyards, chasms and blank walls
  give a place an outline.
- **Districts**: areas with one character. Here: regions.
- **Nodes**: places where paths meet, and where you decide.
- **Landmarks**: unique things you navigate by.

The old generator had weak districts (mood regions) and nothing else. Every
structure type below is a recipe for some of the five.

## Three layers per region

Each region rolls these independently, from its own seed's streams:

| Layer | What it decides | Rolled from |
| --- | --- | --- |
| **Structure** | How rooms are shaped and joined (the types below) | `H(regionSeed, 'type')` |
| **Mood** | Dusty, damp, humming, ... (dust, light, sound, colour) | `H(regionSeed, 'mood')`, sometimes a junction from the previous mood |
| **Size** | A room budget: min + exponential tail, with a rare ×3–4 | `H(regionSeed, 'size')` |

So a two-room damp catacomb and a sixty-room dusty one are both possible, and
two catacombs in one run need not feel alike.

## The catalogue

Built so far: **meander**, **catacomb**, **cloister**. The rest are ideas.

### Meander (built)
- **Reference:** none on purpose. The uncanny, unfamiliar layout: the
  original generator.
- **Rule:** chambers and bent corridors in any direction, frequent
  accidental loops (`params.loopChance`), rare halls.
- **Spine:** none.
- **When blocked:** shrinks, swaps chamber for corridor, ends in a stub.
- **To iterate:** it should stay strange but stop reading as noise. Try a
  drift (a preferred heading that slowly turns), uneven scale, and a few
  deliberately long loops instead of many short ones.

### Catacomb (built)
- **Reference:** the Roman catacombs. Long straight galleries cut through
  rock, *loculi* (niches) along the walls, small *cubicula* (family burial
  rooms) off them, galleries on several levels crossing at near-right
  angles. Paris's ossuary tunnels follow old quarry galleries, which are
  similar.
- **Rule:** galleries carry straight on from their tip (keep heading). Side
  doors only on the region's 2-cell module, opening mostly onto cubicula
  (70%), sometimes a crossing gallery. Very few accidental loops; a gallery
  tip running into another gallery joins it (a crossing, which reads).
- **Spine:** the galleries.
- **When blocked:** shorter gallery, then a cubiculum, then a stub.

### Cloister (built)
- **Reference:** a monastery cloister: a covered walk on four sides of an
  open garth, with the chapter house, refectory and cells off its outside.
  The Pentagon's rings are the same idea, scaled up and nested.
- **Rule:** the first room is the walk on the side you enter, facing the
  courtyard. It claims the other three walks and the courtyard ahead
  (reserves owned by that room). The walks open only outward, onto cells
  (small rooms; now and then a big chapter house). Bigger budgets get
  bigger rings.
- **Spine:** the ring. **Edge:** the courtyard, which nothing may fill and
  no door opens onto.
- **When blocked:** smaller rings, then a U (no far walk), then the region
  is a cluster of cells with no walk.
- **Not yet:** the courtyard is just solid in walk mode. It wants sky,
  light falling in, maybe a well or a tree: a landmark.

### Office / hospital (idea)
- **Reference:** the double-loaded corridor: one long hallway, rooms both
  sides, stairs or a lobby at the ends or the middle.
- **Rule:** a 1–2-wide spine, rooms of nearly one size packed along both
  sides on a module, numbered-feeling repetition; cross-corridors at
  intervals; a lobby node.
- **Uncanny potential:** the corridor that is longer than it should be; the
  room that repeats.
- **When blocked:** a single-loaded corridor (rooms on one side), then a dead
  end.

### Church (idea)
- **Reference:** the cruciform plan: a long nave with aisles, a transept
  crossing it, an apse or chancel at the far end, chapels off the aisles.
- **Rule:** a strong axis from the door you enter by to a unique end room
  (the landmark), with one crossing. Wide, tall, symmetric.
- **When blocked:** nave and apse without the transept; a single long hall.

### Palace enfilade (idea)
- **Reference:** baroque state apartments: rooms in a straight line with
  their doors aligned, so you see through them all, plus a hidden servants'
  corridor alongside.
- **Rule:** a chain of rooms, doors on one axis; a parallel 1-wide service
  corridor with doors into some of them.
- **When blocked:** the chain bends once, or stops.

### Prison / hub and spoke (idea)
- **Reference:** radial prisons (Eastern State Penitentiary), panopticon
  plans: a central hall, wings radiating, cells along each wing.
- **Rule:** a hall node, 3–6 straight wings off it, cells along the wings.
  Always know which way the centre is.
- **When blocked:** fewer wings.

### Sewers (idea)
- **Reference:** gravity drainage: small pipes join larger ones, larger
  ones join a trunk. Size tells you which way "main" is.
- **Rule:** a branching tree with a size hierarchy (1-wide feeders, 2-wide
  mains, 3-wide trunk), joins at angles, few loops. Overflow chambers as
  nodes.
- **When blocked:** the branch ends at a grate (a stub).

### Caves (idea)
- **Reference:** solution caves follow water and the bedding of the rock:
  long branching passages along one dominant direction, chambers where
  passages meet, squeezes between.
- **Rule:** a dominant heading per region; passages wander but trend along
  it; chambers at junctions; irregular shapes (needs organic shape
  generators).
- **When blocked:** a squeeze (a 1-cell passage) or a collapse.

### Hub, lock and shortcut (idea)
- **Reference:** game dungeons, not real ones (Zelda-style): a central hub,
  spokes behind locks, and late shortcuts that loop back to the hub.
- **Rule:** a hub room; spokes that each return to the hub through a
  one-way door or shortcut near their end. Loops are few but long and
  deliberate, so getting back is a reward.
- **Fits:** walk mode's keys and locks, and the fast-travel ideas.

## Tuning knobs (regions.js)

- `REGION_TYPES[type]`: `weight` (how often), `size` (`min`, `scale`, `huge`,
  `hugeMul`), `entry` role, `threshold` chance.
- `REGION_TUNING`: `sameType` (weight multiplier for repeating the previous
  type), `leaveBase` and `leaveRamp` (chance a door leaves a region with
  budget left: base + ramp × (spent/size)²), `junction` (mood junction
  chance), `hueDrift`, `maxSize`.
- `childRole`: catacomb 70% cubiculum off a gallery's side.
- `roleTries`: gallery length 5–11, cubiculum 2–3, cell 2–4 × 2–3 (15% a
  4–5 chapter house), threshold 2–3.
- `cloisterPlans`: ring 7–9 cells a side, +2 over 10 rooms of budget, +4
  over 24.
- `loopChanceFor`: 0.5 for a gallery tip, 0.05 for other structured roles,
  `params.loopChance` for meander.
- Door counts per role: `buildSpace` in `expedition.js`.

## Known weak spots

- Regions turn over fast: a typical 300-room run has ~60 regions, since
  each new region's doors can leave early. If districts feel too small, lower
  `leaveBase` or raise the size minimums.
- Catacomb galleries fan out fast (up to four side doors each) and can
  dominate a map.
- Cloister courtyards are invisible in walk mode (solid), so the edge only
  reads on the map.
- Meander is unchanged, so meander regions still blob.

## Planned: seeded region sequences (shareable runs)

**Status: planned, not built.**

The engine makes the dungeon depend on the player. A room's seed includes
fresh entropy drawn when its door opens, so the same root seed gives
different dungeons. That's what makes rerolls meaningful, and it clashes
with sharing a dungeon.

Spelunky is the opposite: one seed builds the whole level before you see
it (a 4×4 grid of room slots, a guaranteed path, hand-made room templates
with random tiles), so a seed is shareable and the same for everyone.

The middle path we plan to take is **a shared region sequence, with
player-rolled rooms inside it**:

- A "shared run" mode where a region's seed comes from the run seed and the
  region's place in the sequence (`H(rootSeed, 'regions', n)` for the nth
  region entered), not from the door's entropy. Everyone on that seed meets
  the same sequence of regions: "a dusty cloister, then a huge damp
  catacomb, then...". Type, mood and size match; the rooms inside don't.
- Rerolling inside a region stays free and personal. Rerolling the door
  that starts a region would draw the *same* region again in shared mode
  (or advance to the next one in the sequence, a design choice to make
  then).
- Variants to consider then: sequence by depth instead of by order entered;
  a few branches (the sequence is a tree, picked by which kind of door you
  take); shared runs as daily seeds.

What that needs from the code: `resolveRegion` already rolls new regions
through one function (`rollRegion(seed, parent, anchor)`). Shared mode only
changes where that seed comes from, plus a counter of regions entered,
which is in history already (`counters.region`). So the switch is small,
and it should be a param recorded with the expedition.
