# Changelog

All notable changes to this sketch are logged here, per
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- 2026-10-12: **Random settlement** button (R) that rerolls every unlocked
  setting; a padlock on each setting; **Keep** chips for the three parts of
  the seed (land / layout / names, written `land/layout/names`). Every
  building has a stable `key` and the inspector follows it across tweaks.

### Changed

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
