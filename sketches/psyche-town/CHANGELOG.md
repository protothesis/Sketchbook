# Changelog

All notable changes to this sketch are logged here, per
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- 2026-10-08: The psyche is now an orrery. The ego is a sun shaped by one of
  the nine Enneagram types; archetypes are planets with their own orbit,
  period and breath (a swell/shrink cycle); pull ≈ mass / distance²
  decides who's in charge (`engine/psyche.js`).
- Pool of 20 archetypes, with each person carrying the Shadow plus a
  weighted random draw for 3–12 in total (`engine/archetypes.js`).
- Aspects as weather: conjunction, square, trine and opposition change how
  charge flows; twelve named weathers (Cornered, The Verdict, Tenderness,
  Integration…).
- Enneagram stress/growth leans: the ego takes on its disintegration
  point's sore spots under stress, and firms up at ease.
- Psyche Lab page (`lab.html`): one psyche full-size, with life-event
  buttons, care/rest/night/company toggles, and type and chart-size
  pickers.
- Wiki: an entry for every archetype, type, weather, aspect and concept,
  generated from the sim data. It opens in a side drawer from anything
  tappable and as a full page at `wiki.html`.
- Tug-of-war bars (each planet's pull against the ego's hold) and weather
  chips in the lab and the town inspector.

### Changed

- The persona is no longer an archetype. It's the shield ring around the
  ego, whose thickness is the ego's hold and which cracks on capture.
- Town behaviour is driven by each archetype's movement verb and aura
  instead of hard-coded rules; Heroes now confront Shadows non-lethally.
- The Care slider also makes caring archetypes (Caretaker, Martyr, Sage)
  commoner and heavier in new towns.
- Shared styles moved to `ui/base.css`.

### Removed

- The force-graph "constellation" inspector (`ui/constellation.js`),
  replaced by the orrery (`ui/orrery.js`).

### Added

- 2026-10-04: Initial sketch created. Psyche model with seven complexes,
  affinity links and ego "hold" (`engine/psyche.js`); town sim with homes,
  shared places, day/night, life events, break-ins, Guardian/Shadow
  confrontations, isolation-driven Abyss losses and Caretaker de-escalation
  (`engine/town.js`); canvas renderer, force-graph constellation inspector,
  per-person story log, interventions (sit with / confront / hard day) and
  Hardship / Care / Armed homes controls.
