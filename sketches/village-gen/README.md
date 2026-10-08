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

## The data

`VillageGen.generate(options)` returns plain data in metres, with the map
centred on (0, 0):

- `buildings[]`: `type`, `category`, `name`, `family`, `trade`, `polygon`,
  `width`/`depth`/`area`, `floors`, `floorArea`, `residents`, `households`,
  `workers`, `capacity`, `beds`, `storage`, `entrance` (point plus the road
  node it opens onto), `wayId`, `elevation`, `built`, `epoch` (0–1 growth
  order), `rooms[]` (ground-floor plan in local coordinates: x along the
  frontage, y from the front wall), `upperFloors`, `tags`.
- `network`: `nodes`, `edges` (with `length`, `kind`, `bridge`), `ways`
  (named roads as node chains). `VillageGen.findPath(s, fromNode, toNode)`
  gives the shortest walking route.
- `fields[]`: `crop`, `polygon`, `area`, `hectares`, `furlong`.
- `trees[]` as `[x, y, radius, kind]`, `plazas`, `landmarks`, `terrain` (the
  height grid, water level, relief and river polyline), `stats`, `founded`,
  `presentYear`.

**Download JSON** in the panel exports it. Terrain heights and trees are
optional because they're big. `window.settlement` holds the current one in
the browser console.

To use it from another sketch, load the engine scripts by relative path, in
the same order as `index.html`:

```html
<script src="../village-gen/engine/rng.js"></script>
<!-- terrain, network, names, buildings, fields, settlement -->
<script>
  var town = VillageGen.generate({ seed: 'ash', population: 120, environment: 'valley' });
</script>
```

## Controls

Drag to pan; scroll, pinch or double-click to zoom; **R** to reseed; arrow
keys to pan; Esc to close the inspector. The seed and every setting live in
the URL hash, so **Copy link** brings back exactly the same place.

## Possible directions

- Feed Psyche Town: give each resident a home, a workplace and a walking
  route.
- Upper-floor plans and real interiors for inns, halls and churches.
- Town walls with gates for cities, a harbour with quays, bridges as named
  places.
- Districts and wealth: richer streets, a poor quarter by the tannery.
- Neighbouring settlements at the "to …" road ends, so the map can stitch
  into a region.
- History that actually changes the map: fires, a new bridge, a mill closing.
