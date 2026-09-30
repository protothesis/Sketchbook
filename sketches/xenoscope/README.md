# Xenoscope

**Started:** 2026-09-30
**Status:** prototype

A procedural-generation engine for exoplanet systems, paired with an
invented astrological reading of whatever it generates — casting a
"horoscope" not for Earth's sky, but for a sky that only exists because you
seeded it.

## The idea

1. **Generate** a plausible star + N planets (+ moons) from a seed: orbital
   radius, period, composition, size — all deterministic, so the same seed
   always reproduces the same system.
2. **Assign meaning**: each planet gets an archetype (a title, a glyph, a
   handful of keywords) derived from its own traits — orbital position,
   composition, moon count. There's no reused Earth zodiac here; alien
   systems don't have one, so the symbolic vocabulary is built from what the
   procgen actually produced.
3. **Query a moment**: given a system and a point in fictional time
   ("cycle"), compute every body's current position — instantly, without
   simulating the time in between, since orbits are simplified to circular
   and coplanar for this first pass.
4. **Read the relationships**: angular separation between planets at a given
   moment classifies into aspects (conjunction, sextile, square, trine,
   opposition) — the same vocabulary real astrology uses for angles, applied
   here to a genuinely alien configuration of bodies.

## Structure

```
engine/       pure data + math, no DOM or rendering — embeddable anywhere
  rng.js        seeded PRNG (string seed -> deterministic stream)
  names.js      procedural name generator for stars/planets/moons
  symbols.js    archetype/glyph assignment (the esoteric layer)
  generate.js   generateSystem(seed, options) -> system data
  ephemeris.js  getPositions(system, t) -> body positions at time t
  aspects.js    computeAspects(positions) -> active aspect list
  index.js      public API re-exports
ui/           the reference web client (this sketch's demo)
  app.js        wires controls + animation loop to the engine
  scene3d.js    three.js "orrery" — compressed-scale 3D orbit view
  chart.js      SVG aspect wheel — planets + aspect lines by longitude
  styles.css
index.html    entry point (also the GitHub Pages demo)
```

The `engine/` folder is intentionally dependency-free and DOM-free — the
goal is that it can be dropped into a game (as the source of truth for a
fictional sky) or run headless on a server, with this web UI as just one
possible client.

## Try it

Open `index.html` in a browser (or visit the sketch's entry in the repo's
GitHub Pages gallery). Type a seed and hit Generate, or hit Random. Drag to
orbit the 3D view, scrub the speed slider to fast-forward the sky.

## Open questions / next steps

- Orbits are circular/coplanar for now — real eccentricity and inclination
  would make the orrery and the chart both more interesting, at the cost of
  generation complexity.
- The archetype system is deliberately small (7 planet kinds x position x
  moon count). Worth expanding once it's clear which combinations actually
  produce compelling "readings."
- No persistence yet — every reload forgets the seed unless you save it
  yourself. A shareable link (`?seed=...`) would be a small, high-value add.
- Not yet tried as an embedded module inside an actual game — the `engine/`
  API is designed for that, but unverified in practice.
