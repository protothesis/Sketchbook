# Changelog

All notable changes to this sketch are logged here, per
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- 2026-10-12: **Board look** (`ui/styles/board.js`), the first cut of the
  presentation-board style (style system step 6). It has flat stepped
  terrain bands and hairline contours, dark slate water and a hard frame
  circle. Inside the settlement's boundary it has patterned land use
  (row hatches turned along each field, stipple pasture, dotted orchards,
  dashed fallow, crowns for woodland), settled ground with white
  buildings, white streets with grey edges, and spaced capitals for
  labels. Outside the boundary, fields and buildings are grey outlines.
  Roads with a destination and the coastline run on past the frame.
  Hovering the legend colours that category's buildings.
- 2026-10-12: **Look** switcher (under Layers, or V) between Natural and
  Board. It's kept in the URL as `st`. Natural stays the default.
- 2026-10-12: Renderer support for the board look (natural is unchanged):
  - The style `frame` circle, a hard clip that layers opt out of with
    `frame: false`.
  - The `terrain.bands` draw function.
  - Stop-gap `area.settled` (built-up footprint) and `area.forest` (where
    tree crowns cover most of the ground).
  - The "what's here" highlight in the generic `fill`.
  - Font `caps` and `tracking`, and labels without halos when a style's
    halo has no width.
  - Colour tints mix toward the style palette's own `paper` when it has
    one, so board's colours don't change with the theme.

- 2026-10-12: Style system, step 4 (renderer only; no style uses it yet,
  so no visual change):
  - **Focus clip.** A style's `focus: { area: 'area.boundary' }` plus a
    layer's `focus: 'inside' | 'outside'` clips that layer to the area or
    to everything outside it.
  - **Stop-gap boundary.** `area.boundary` is the farmed extent (fields,
    buildings and squares) grown by 30 m and smoothed. It's computed once
    per settlement in the renderer, and `S.areas` replaces it once the
    generator provides one. Other `area.*` kinds don't exist yet and draw
    nothing.
  - **Roads never clipped away.** A road with a destination is drawn
    unclipped from where it last leaves the focus area on to its exit.
    Destination tabs and landing marks ignore the focus.
  - **Procedural patterns.** A style's `patterns` (`lines`, `dots`,
    `crowns`, `waves`, `dashes`, `grid`) are built once per style into
    canvas patterns. They're anchored in world metres so they don't swim
    when panning, `align: 'field'` turns them along each field, and a
    pattern finer than about 3 screen px shows its flat ground colour.
  - **Generic `fill` and `stroke` draw functions.** They draw whatever a
    layer's `match` names (fields, buildings, squares, ways, areas,
    contours, shore), with an optional `filter`. `board` will use them.

- 2026-10-12: The atlas map shows every visited place's roads not taken as
  a short spur (remembered as `roads` on each place when you visit it).
  Hovering a place, or being in it, draws them long and labels where they
  lead; clicking one goes to that place and takes that road.

- 2026-10-12: **Atlas map** (`ui/atlasmap.js`): the atlas drawn as a subway
  map in the panel, and bigger over the main map with ⤢ (or M). Stations
  are coloured by setting and sized by class; a journey's start is a
  square; separate journeys sit side by side. The layout dead-reckons from
  the road bearings (snapped to 45°, north up). Unexplored roads out of the
  current town are dashed stubs. Click a station to go there, a stub to
  travel; drag, scroll and double-click to pan, zoom and fit.

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

- 2026-10-12: Style system, step 3: the renderer draws by looping over
  the style's `layers`, each with its checkbox (`toggle`), zoom range and
  draw function, instead of a fixed sequence. Zoom thresholds live in
  layer `zoom` ranges and paint (the place name's fade is a zoom stop).
  No visual change, except that a renderer's very first frame now strokes
  contours with round caps, like every frame after it already did.

- 2026-10-12: Style system, step 2: today's look is now the `natural`
  style (`ui/styles/natural.js`, a classic script setting
  `VG.styles.natural`). Every colour, width (`{ m, px }`), font and zoom
  threshold moved out of `render.js` into its palette, category colours,
  fonts and per-layer paint; the draw functions (a `VG.render.draw`
  registry) read them from the active style. The legend and inspector pill
  take category colours from the style. No visual change.

- 2026-10-12: Style system, step 1 (see `notes/style-system.md`): the
  environments' `palette` is now `biome`. It sets the crop mix in the
  engine and picks the terrain ramp in the renderer. No visual change.

- 2026-10-12: A new town opens showing the whole map (◎ still frames the
  town). Roads that lead somewhere carry on past the map's edge (`exit` on
  the way) so they run on under the fade instead of visibly stopping.

- 2026-10-12: **New seed** in an atlas town now reshapes that town in place
  (same name and roads) instead of leaving the atlas; **Random** still
  starts a new journey. Discovering new places: a change of setting picks a
  plausible neighbouring one, deserts no longer trap a journey (arid was
  31% of towns with runs of 8 on average, now 9% and 2.3), and sliders
  drift back toward typical values instead of random-walking to extremes.
  Only affects places discovered from now on.

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

- 2026-10-12: Coastal towns run ferries too: a landing facing the open sea
  (not a lake) is a ferry about 60% of the time, so a journey that starts
  inland can reach islands. `GENERATOR_VERSION` 3 (coastal towns only).

- 2026-10-12: Roads and ferries only connect to their own kind. No road
  leads to an island; a ferry only lands on an island or the coast, and
  the way back is a ferry from that town's waterfront (a coastal town's
  landing becomes "ferry to …"). Atlas links record `ferry`, and required
  roads can swing all the way round to find land (or water, for a ferry).
  The atlas map draws ferry crossings as dashed blue lines.

- 2026-10-12: Roads no longer lead "to Bramham" straight into the sea. An
  approach road with open water between it and the map edge is a
  **landing** (⚓, named Quay Road, Harbour Road…) with no destination, so
  no journey continues from it. Roads the atlas requires must reach the
  edge over land and swing round to find it. A town with no land road out
  at all (an island) runs **ferries** from its landings instead, and a
  required road with no land within reach becomes a ferry too. Roads may
  also start in a river at the edge rather than on its bank mid-map.
  `GENERATOR_VERSION` is now 2: coastal and island towns, and atlas places
  whose roads ran into water, can come out differently; others are
  unchanged.

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
