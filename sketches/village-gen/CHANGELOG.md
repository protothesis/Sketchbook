# Changelog

All notable changes to this sketch are logged here, per
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- 2026-10-12: **Atlas** (`engine/atlas.js`): the road labels at the map's
  edge ("to Ashby →") are clickable and take you to that town. Its seed comes
  from the world seed plus its name, so a name is always the same town, and
  it always has a road back to where you came from, entering from the
  opposite side. **← Back** (B), browser Back/Forward and the place list
  retrace the journey, and every place comes back exactly as it was.
  **Lock place** keeps a place's current settings for every revisit;
  unlocked places show the settings they were discovered with. The atlas is
  saved in the browser, with **Export / Import atlas** JSON as the reliable
  save. The URL hash carries the place's name and roads.
- 2026-10-12: `generate()` accepts constraints from a parent: `name` and
  `roads: [{ destination, bearing }]` (roads that must leave towards those
  places). Output ways gain `bearing` (compass degrees) and `forced`.
  `VillageGen.GENERATOR_VERSION` (and `generatorVersion` on each settlement)
  records which rules made a place. Without constraints the output is
  unchanged.

- 2026-10-12: **Random settlement** button (R) that rerolls every unlocked
  setting; a padlock on each setting; **Keep** chips for the three parts of
  the seed (land / layout / names, written `land/layout/names`). Every
  building has a stable `key` and the inspector follows it across tweaks.

### Changed

- 2026-10-12: Level-of-detail rendering. Zoomed out, fields and buildings
  are drawn from images baked once per settlement (for places with 400+
  buildings), and everything else that shares a colour is drawn a few
  hundred shapes per path instead of one canvas call each. City of 15,000,
  1040×858 canvas, Intel UHD GPU: whole map 67 → 17 ms per frame, town view
  96 → 46 ms, zoom 0.95 84 → 54 ms; close-ups unchanged (zoom 8: 12.5 ms
  both). Zoomed out, buildings show their colours instead of merging into a
  dark mass.
- 2026-10-12: Destinations that don't collide: a road's made-up destination
  is redrawn if it repeats another road's or the town's own name.

- 2026-10-12: Map size is fixed per size class, so Population and Density no
  longer redraw the terrain or move the camera. Population slider spans the
  selected class's range. Density spreads sprawling towns out along their
  roads. Farm tracks, names and building details use their own random
  streams, so Woodland and Farmland leave the town alone and Planning,
  Density and Population keep buildings' names and families.

### Fixed

- 2026-10-12: Fields and buildings no longer sit on rivers or lake edges;
  rivers stop at lakes and the sea instead of being drawn across them.

### Added

- 2026-10-08: Initial sketch created. Seeded terrain for eight settings
  (valley, plains, coast, highlands, forest clearing, lakeside, island, arid
  oasis) with an optional meandering river; site selection; approach roads
  routed by A* over the terrain; organic street growth with T-junctions,
  loops and a planning slider; centre-outward lot placement with services
  scaled to population, farmsteads, townhouses and shop-houses; per-building
  occupancy, capacity, build year and ground-floor plans; strip-field
  furlongs, woodland, hedgerows and garden trees; street, inn, shrine and
  family names. Pan/zoom map with hillshade, contours, edge vignette,
  inspector with floor plans and walking routes, growth timeline, JSON
  export and shareable seed links.
