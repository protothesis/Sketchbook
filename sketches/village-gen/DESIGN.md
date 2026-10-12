# Design: procedural places, from village to world

**Started:** 2026-10-12. **Status:** living document, expected to change as
we build.

This covers the system the village generator is the first piece of: linked
settlements, regions, eventually worlds and planets, plus aesthetic and
feature layers on top. It's about high-level structure and decisions.
Implementation details live in each sketch's code and README.

## Source

The original intent is in the brainstorm transcript,
[`notes/village-generator-voice-memo.md`](notes/village-generator-voice-memo.md)
(voice memo, 2026-10-11). **That file is a record and is never edited.** This
document can drift from it as ideas change; when it does, the transcript is
where to go back for what was originally meant. Section references below look
like *(memo: Linking villages by road)*.

## What we're building toward

A procedural map-making and exploration tool. Start from one settlement, walk
its roads to neighbouring ones, zoom out to the region they sit in, and
eventually out to continents, planets and star systems, each level generated
from a seed. On top of the geography, swappable layers change what gets built:
era, culture, fantastical features.

Current focus is generation and exploration. Games and simulations (Psyche
Town first) are future consumers of the data, not the driver.

## Principles

1. **The seed is the save file.** Generation is deterministic, so a place is
   stored as its seed plus settings plus any edits, not as its generated
   output. A settlement is about 130 bytes saved, 2–5 MB while open (see
   *Data and performance*).
2. **Bigger levels decide; smaller levels fill in.** A region decides where
   towns are, which roads join them, and what the land does. A settlement
   generator receives those as constraints instead of inventing them. This is
   what keeps seams consistent between neighbouring maps.
3. **Generate what you're looking at.** Nothing below the current zoom level
   exists until you zoom in, and it can be thrown away and rebuilt identically
   once you leave.
4. **Child seeds derive from parent seeds.** A child's seed is a hash of its
   parent's seed plus a stable ID (name, grid cell, index). The village
   generator already does this one level down: each stage has its own stream
   (`createRng(seed, 'roads')`).
5. **Draw at the detail the zoom needs.** At distance, draw outlines, blocks
   or baked images, not every tree and building.
6. **Works from `file://`.** The repo-wide rule: no server, no build, no
   modules, no fetch. Saves use browser storage plus JSON export and import.

## The scale ladder

| Level | What it holds | Where it lives | State |
|---|---|---|---|
| Settlement | Streets, buildings, fields, interiors | `sketches/village-gen` | Exists (prototype) |
| Linked settlements (atlas) | Which towns connect to which | `village-gen` for now | In progress |
| Region | Land, rivers, coasts, towns as points, roads between them | New sketch | Next |
| World / continent | Regions, oceans, climate bands | Later | Idea |
| Planet / star system | Planets, each with its own generation rules | Could connect to `sketches/xenoscope` | Idea |

Each level talks to the one below through a **parent-to-child contract**. The
parent passes down:

- the land shape (a terrain sampler or height patch)
- the roads entering, with their bearings and destinations
- a population or size class
- a profile
- any feature instances that overlap the child

The child generates within those limits. Today `VillageGen.generate()`
invents all of this itself. Making it accept these from a parent is the main
structural change the region work needs. *(memo: Regional fantasy maps; A
whole world, built as you explore; Zooming out to planets)*

## Three modes: procedural, authored, hybrid

The same engine serves both a tool and a game. The difference is an
**override layer** on top of procedural output:

- **Procedural:** no overrides. Whatever the rules produce is the place. This
  is the game case, so the rules alone have to produce satisfying results.
- **Authored:** a map builder tweaks a place and locks it. A campaign setting
  is the example: "make this a concrete place".
- **Hybrid:** a few pinned places, everything else procedural until someone
  visits. This is the expected normal case, and how games like Minecraft and
  No Man's Sky mix hand-made content into generated worlds.

Rules for the override layer:

- Overrides are keyed by **stable IDs**, so they survive regeneration.
- Overrides start as settings (seed, sliders, class, environment). Hand edits
  (moving or deleting a building) are a later, separate edits layer.
- Every locked place records the **generator version** it was made with.
  Improving the generator changes every place that's only stored as a seed;
  locking is a promise that a place won't change. When the version changes,
  a locked place either regenerates with the old rules or falls back to a
  stored snapshot. (Undecided: see *Open questions*.)

Better rules improve all three modes. The override layer only matters for
authoring.

## The atlas

A small world-level record of which places exist and how they connect.
*(memo: Linking villages by road)*

- **Places:** ID, name, seed, settings, locked flag, generator version.
- **Links:** from, to, and the direction the road leaves in.
- About a few hundred bytes per place.

It's **topological, not geometric**: a subway map, not a real map. It knows
that Ashby is east of Millford along the Ashby Road, not how far away it is
or what the land in between looks like.

What's real in the first version:

- A destination's seed comes from the world seed plus its name, so the same
  name is the same town however you reach it.
- An arrived-at town is forced to have a road back to the town you came from,
  entering from the opposite side.
- Going back reloads the original exactly.
- Locked settings persist.

What's faked: distance, terrain continuity between towns, and loops (1→2→3
gives no guarantee that town 3 has a road to town 1).

**As built (2026-10-12):** `engine/atlas.js` plus `generate({ name, roads })`.
Every walked road is stored both ways and passed back as a `roads`
constraint, which is what makes revisits exact. A forced road takes over
the nearest approach-road slot (one within 1° is left untouched). New
places' settings are discovered once (seeded by world + name, leaning on
the origin's setting and sliders, or a setting the name implies) and
remembered as `base`; **Lock** stores `settings` plus the generator
version. The world seed is the first town's land seed. Arriving at a known
place by a new road adds a road to it, which can shift its layout, even
when locked (see *Open questions*).

**Where it lives:** a separate file inside `village-gen` for now, because it's
small and the village generator is the only thing using it. Conceptually it's
the world layer, not part of the settlement generator. When the region sketch
exists it takes the atlas over and upgrades it: the region lays the graph out
on real terrain, keeping locked towns as fixed points.

## Profiles

Era and culture as data, not code. A profile defines:

- the services and building types
- field and crop types
- road and street style
- naming

Medieval is the first profile, extracted from what's currently hard-coded.
Solarpunk, modern and the user's own world-building settings come after.
*(memo: An aesthetic layer beyond medieval)*

- **Tags** on profiles let higher-level rules mix, cluster and pick them,
  e.g. remote highland villages stay old while river cities modernise.
- **Mixed eras** are normal: a region picks a profile per settlement, and a
  settlement can switch profiles partway through its growth. Buildings
  already carry `epoch` (0–1 growth order) and a build year, which is the
  hook for a **technology timeline**: a medieval core with later layers
  around it. *(memo: Technology timelines and future cities)*
- Modern planning (grids, zoning, cars, suburbs) needs its own street-growth
  mode as well as its own building list.
- "What will cities look like in 300 years" is design research that can
  produce a profile. The generator follows rules; it doesn't predict.

## Feature modules

Terrain features and structures are added as plug-in modules over time, not
built into one base algorithm. *(memo: Megaliths and landmarks; Layers from
my own world-building; Richer buildings and structures)*

A module declares:

- **Where it can appear:** tags for biome, planet type, era, rarity, things
  it pairs with or excludes.
- **Its scale:** region, local or settlement.
- **Hooks**, any of: change the terrain (carve a pit, raise a mineral
  forest); place structures (a geyser cluster, a stone alignment); affect
  settlements (a huge facility pulls in a town to service it).
- **Its own seeded generator**, so it makes a family of variants, not a
  one-off. Clusters of huge CERN-like rings are a module, not a landmark.

Candidate modules, in no order:

- **Earth-like:** canyons and gullies, fjords and sounds (Norway, New
  Zealand), archipelagos, stone alignments (Carnac, Stonehenge).
- **Fantastical:** giant circular pits, floating island archipelagos,
  towers, petrified mineral forests, acid geyser clusters, power plants and
  data centres.

Two notes on terrain:

- Canyons, gullies and fjords are carved by erosion and glaciers. Noise can
  fake some of them, but convincing ones need an erosion simulation over the
  height map.
- Most are larger than a settlement map, so they belong at region scale and
  a settlement sees a slice of them.

**Buildings stay rectangular for now.** Lots, floor plans and collision all
assume rectangles. Unusual building shapes are a later plugin of their own.

## Visual style

Maps will be drawn through a style system (data and presentation kept apart, so
one place can look very different per region, planet or view type). The
first target look is a crisp "presentation board" style. See
[`notes/visual-direction.md`](notes/visual-direction.md) and the draft spec
[`notes/style-system.md`](notes/style-system.md).

## Data and performance

Measured 2026-10-12, seed `ash`, valley, Node, headless:

| Town | Generate | Buildings | Full output | Without terrain grid and trees | Saved as |
|---|---|---|---|---|---|
| 30 people | ~0.1 s | 11 | 2.0 MB | 30 KB | ~130 B |
| 160 | ~0.1 s | 46 | 2.2 MB | 80 KB | ~130 B |
| 1,500 | ~0.2 s | 409 | 2.8 MB | 420 KB | ~130 B |
| 15,000 | ~0.6 s | 3,188 | 5.5 MB | 3 MB | ~130 B |

- Saving is negligible. Holding many generated places in memory at once is
  not, which is why principle 3 matters at world scale.
- Generation time is fine at settlement scale. It will matter at region scale
  if many settlements are generated at once, which they shouldn't be.
- The slowness when zooming out on a big city is **rendering**, which is
  fixed with level of detail (principle 5).

## Roadmap

- **Now:** atlas with "to the next village" click-through; level-of-detail
  rendering for trees and buildings. *(In progress in its own session.)*
- **Next:** region prototype as a new sketch: land, rivers, towns as points,
  roads between them, zoom into a town via village-gen with the
  parent-to-child contract.
- **Soon:** style system (extract today's look as a `natural` style, then
  a `board` style), plus generator **areas** (settlement boundary, forest,
  settled ground) that it and later levels need. (See *Visual style*.)
- **Later, any order:** medieval profile extracted as data; second profile;
  first feature modules; erosion; edits layer; world level; planets.
- **Whenever:** Psyche Town consuming small settlements (hamlet and village
  sizes suit it best).

## Open questions

- What exactly does "lock" capture: settings only, or a full snapshot as a
  fallback against generator changes?
- Generator versioning: keep old rule versions runnable, or snapshot locked
  places and accept that unlocked ones change?
- Name collisions: two different roads to "Ashby" are the same town under
  name-based IDs. Is that a feature or a problem?
- How does an atlas built by walking roads merge into a region generated
  top-down: does the region bend around existing links, or replace them?
- What's the region map's scale and units, and how much of the village's
  terrain should come from the region versus local noise?
- Where does this design doc live once the work spans several sketches?

## Decision log

- **2026-10-12:** Tool, game and hybrid are one engine plus an override
  layer, not separate systems.
- **2026-10-12:** The atlas starts inside `village-gen` as its own file; the
  region sketch takes it over later.
- **2026-10-12:** Region is a new sketch that uses village-gen for zooming
  in.
- **2026-10-12:** Buildings stay rectangular for now.
- **2026-10-12:** The brainstorm transcript is never edited; this document
  references it.
