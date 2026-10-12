# Village Generator

**Started:** 2026-10-08
**Status:** prototype

Seeded, organic human settlements, from a hamlet of a dozen people to a city
of 15,000. Each one sits on hillshaded terrain that fades out into paper at
the edge of the map. You can pan and zoom it like a very small Google Maps,
click any building, field or street to see its data, and export the whole
thing as JSON for a simulation to use (Psyche Town first).

Open `index.html` directly. There's no build step or server.

## The idea

Most procedural towns look procedural because they start from a plan. Real
villages grow outward: roads come first and follow the land, houses line the
roads, and the oldest buildings sit at the crossroads. This generator works
the same way, so the build order doubles as a believable history. Press
**Play** under *Growth* to watch a town grow from its founding.

## How it works

Each stage gets its own seeded random stream, so the same seed and settings
always give the same place.

1. **Terrain** (`engine/terrain.js`): fractal noise shaped per setting (a
   valley axis, a coastline, a lake bowl, an island falloff, ridged
   highlands, dunes with an oasis), plus an optional meandering river with a
   flood plain. Lookups: height, slope, water, distance to water.
2. **Site**: flat, dry ground near (not in) water, close to the middle of the
   map. The founding reason ("a ford on the river", "a sheltered landing on
   the coast") comes from this choice.
3. **Approach roads** (`engine/network.js`): A* from the map edge to the
   centre over a cost grid. Slope is expensive, rivers need a bridge, and
   existing road is cheap, so later roads merge into earlier ones like real
   converging roads. Each one is labelled with the (made-up) town it leads to.
4. **Streets**: branch off existing roads, or keep going from dead ends. They
   steer toward flatter ground, snap onto nearby junctions, and T into roads
   they approach, which is what makes the irregular blocks and loops.
   **Planning** straightens them and pulls them toward a shared grid angle;
   **Density** sets how close parallel streets may run. Farm tracks wander
   out into the countryside.
5. **Buildings** (`engine/buildings.js`): services are placed first (chapel
   or church, inn, smithy, market hall, town hall, mill by the river or a
   windmill on a rise, manor on high ground…), scaled by population. Homes
   are proposed along both sides of every way and accepted from the centre
   outward: terraces and shop-houses in a city core, detached houses further
   out, farmsteads (farmhouse plus barn) in the countryside. If there isn't
   room, streets grow further out and placement runs again.
6. **Countryside** (`engine/fields.js`): strip-field furlongs along roads and
   tracks, then a patchwork grown off their sides. Crops depend on the
   setting. Woodland comes from noise, cleared around the town; hedgerow
   trees sit on field edges and garden trees behind houses.
7. **Names and history**: settlement, street, family, inn and shrine names;
   a founding year; and a build year per building from its place in the
   growth order.

### Settlement classes

| Class    | People        | Character |
|----------|---------------|-----------|
| Hamlet   | 5–40          | 2 roads in, no square, ~45% live on farms |
| Village  | 40–400        | 3 roads, a green, chapel, inn, smithy |
| Township | 400–3,000     | 4 roads, a paved square, terraces in the core, town hall, market |
| City     | 3,000–15,000  | 5+ roads, dense terraced core, small squares, cathedral, guildhalls, barracks |

Household size, the share of people on farms and the service mix all follow
the class. Population density (people per hectare of built-up area) is
reported in the overview.

## Travelling: the atlas

The "to Ashby →" tabs at the map's edge are roads out. Click one (or select
the road and press **Travel to Ashby** in the inspector) and you arrive in
Ashby, on a road that leads back to where you came from, entering from the
opposite side of the map. The atlas (`engine/atlas.js`) records each place
and road:

- A destination's seed is the world seed (the first town's land seed) plus
  its name, so the same name is always the same town, however you reach it.
- A new place's settings are discovered once, from that seed and the place
  you came from: it usually shares its neighbour's setting, or moves to a
  plausible neighbouring one (valley to plains, forest, lakeside or
  highlands…), and a name like "Lynport" puts it on the coast. Its sliders
  wander from its neighbour's but drift back toward typical values, so a
  long road changes character without running away. The atlas remembers
  them.
- Every road you've walked is held as a constraint when its towns are
  generated, so going back gives exactly the same place.
- **Lock place** saves the current settings: revisits use them. Change a
  locked place and **Save changes** / **Revert** appear. Unlocked places
  forget tweaks when you leave. Locking a town you haven't left yet adds it
  to the atlas.
- **New seed** reshapes the current town in place: same name, same roads,
  a tweak like any other. **Random** steps off the atlas to a brand-new
  town; travelling from it starts a separate journey in the same atlas.

The **atlas map** under *Atlas* shows every place and road as a subway map
(⤢ or M opens it big over the main map). There are no distances in the
atlas, so it's laid out by dead reckoning: each road is one step in the
direction it leaves, snapped to 45°, with north up. Squares are where a
journey started, colours are settings, dashed stubs are roads out of the
current town you haven't taken. Click a place to go there or a stub to
travel along it.

**← Back** (B) walks back along your trail, and browser Back/Forward work
too. The atlas is saved in this browser automatically; **Export atlas**
writes it as JSON and **Import atlas** loads one, which is the reliable way
to keep or move it. It's topological: it knows which towns connect and in
which direction, not distances or the land between them.

## The data

`VillageGen.generate(options)` returns plain data in metres, with the map
centred on (0, 0):

- `buildings[]`: `key` (stable across tweaks), `type`, `category`, `name`, `family`, `trade`, `polygon`,
  `width`/`depth`/`area`, `floors`, `floorArea`, `residents`, `households`,
  `workers`, `capacity`, `beds`, `storage`, `entrance` (point plus the road
  node it opens onto), `wayId`, `elevation`, `built`, `epoch` (0–1 growth
  order), `rooms[]` (ground-floor plan in local coordinates: x along the
  frontage, y from the front wall), `upperFloors`, `tags`.
- `network`: `nodes`, `edges` (with `length`, `kind`, `bridge`), `ways`
  (named roads as node chains; roads off the map also have `destination`,
  `rim` and `bearing` in compass degrees, and `forced` if a constraint asked
  for them). `VillageGen.findPath(s, fromNode, toNode)` gives the shortest
  walking route.
- `generatorVersion`, and `constraints` when it was generated with any.
- `fields[]`: `crop`, `polygon`, `area`, `hectares`, `furlong`.
- `trees[]` as `[x, y, radius, kind]`, `plazas`, `landmarks`, `terrain` (the
  height grid, water level, relief and river polyline), `stats`, `founded`,
  `presentYear`.

A parent (the atlas now, a region later) can constrain a settlement:

```js
VillageGen.generate({ seed: 'ash', population: 300, name: 'Millford',
  roads: [{ destination: 'Ashby', bearing: 80 }] }); // a road must leave east-ish to Ashby
```

Each required road takes over the approach road nearest its bearing (one
within a degree is kept exactly as it was), so the rest of the town barely
moves; if water blocks the bearing it swings round until it finds land.

The atlas JSON (`format: "village-gen-atlas"`) holds `world`, `places`
(`name`, `seed`, `base` settings, `settings` when locked, `locked`,
`generator`, `from`), `links` (`from`, `to`, `bearing`, stored both ways)
and `trail`.

**Download JSON** in the panel exports it. Terrain heights and trees are
optional because they're big. `window.settlement` holds the current one in
the browser console.

To use it from another sketch, load the engine scripts by relative path, in
the same order as `index.html`:

```html
<script src="../village-gen/engine/rng.js"></script>
<!-- terrain, network, names, buildings, fields, settlement, (atlas) -->
<script>
  var town = VillageGen.generate({ seed: 'ash', population: 120, environment: 'valley' });
</script>
```

## Controls

- **🎲 Random settlement** (R) rerolls every setting that isn't locked, and
  every part of the seed you aren't keeping. With nothing locked it's a
  completely fresh place. Lock the size and setting, say, to get endless
  random towns within those conditions.
- **New seed** (N) keeps all the settings and rerolls the seed.
- **Size** picks the class; the **Population** slider moves within that
  class's range (log scale, so the whole travel is usable).
- **Density** goes from *sprawling* (wide gaps, homes scattered out along the
  roads ahead of the infill) to *compact* (tight terraces, a solid core).
- The padlock next to each setting keeps it fixed when you press Random.

Drag to pan; scroll, pinch or double-click to zoom; arrow keys pan; Esc
closes the inspector; B goes back along the journey. Zoomed out, fields and
buildings on big maps are drawn from baked images and switch back to full
detail as you zoom in. The seed and every setting live in the URL hash, so
**Copy link** brings back exactly the same place.

### Seeds, and what stays put

A seed has three parts that can be kept independently with the **Keep**
chips: **Land** (terrain, river, site), **Layout** (roads, lots, fields) and
**Names** (the settlement, families, inns, streets, founding year). One word
like `ash` sets all three; `ash/kova/ash` sets them separately. Keeping Land
also holds the setting, river and size, because those shape the land too.

What each setting is allowed to change:

| Change | Land | Streets & lots | Which buildings, their names & families |
|---|---|---|---|
| Woodland | — | — | — |
| Farmland | — | countryside only | — |
| Planning, Density, Population (within a class) | — | reflows | kept (~95%) |
| Size class, Setting, River | redrawn | reflows | mostly kept |
| New Names seed | — | — | renamed |
| New Layout seed | — | new | kept by key |

This works because every building has a stable `key` (`home:12`,
`svc:inn:0`, `farm:3`) that its own details come from, so it keeps its
character when the streets around it move. The inspector follows the
selected building across tweaks. The map is drawn at a fixed scale per size
class, so changing the population or density no longer redraws the terrain
or moves the camera.

## Possible directions

- Feed Psyche Town: give each resident a home, a workplace and a walking
  route.
- Upper-floor plans and real interiors for inns, halls and churches.
- Town walls with gates for cities, a harbour with quays, bridges as named
  places.
- Districts and wealth: richer streets, a poor quarter by the tannery.
- Population as growth: make a bigger town a strict superset of a smaller
  one with the same seed, so the slider grows the place instead of
  reflowing it.
- Real geography between neighbouring towns (the region sketch), so the
  atlas's subway map gets distances and land.
- History that actually changes the map: fires, a new bridge, a mill closing.
