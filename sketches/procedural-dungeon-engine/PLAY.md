# Walk mode: design brief

A small 3D client for the engine (`play.html`). You walk one figure around
the expedition with WASD. Opening a door is what generates the space behind
it, and closing one can un-write it, at a price. This is the engine's
"exploring *is* generating" idea, played instead of clicked on a chart.

The engine stays free of game rules. Everything game-like lives in
`app/play-rules.js`, which only reads engine data, and anything placed in
the world comes from a space's seed on its own named stream (see
Determinism).

## Pillars

1. **The door is the moment.** Every unresolved exit is a closed door, and
   nothing exists behind it until you push it open. The new space then
   assembles itself outward from the threshold.
2. **Darkness is line of sight.** You carry the only light, and walls cast
   real shadows from it. You can't see around a corner until your lantern
   does. Rooms you've left fall back into the dark, and the minimap is your
   memory of them.
3. **Un-writing has a cost.** Closing a door you opened collapses
   everything beyond it, and then the door is unknown again. That costs
   entropy, and once you've gone deep enough you can't afford to undo it.
4. **Same expedition, two views.** Walk mode reads and writes the chart
   view's autosave, and every collapse lands in its history as engine
   reverts.

## The loop (first pass)

- **Explore.** Push doors open. Each one is a fresh, unrerollable draw.
- **Collect.** Rooms sometimes hold a **shard** (+10 entropy) or, rarely, a
  **key**.
- **Collapse.** Stand at a door you opened and press E (or tap the prompt),
  and the door shuts. The whole branch beyond it (that room and every room
  opened from it, deepest first) dissolves. The price is **1 entropy per
  cell plus 2 per room**, shown before you commit. Reopening the door draws
  fresh entropy: that's the reroll. If the price is more than your meter,
  the door stays open: "too much lies beyond."
- **Escape.** Locked doors appear past depth 4. Unlocking one with a key
  ends the walk on the **expedition record**: the seed chain from the root
  to that door (`H(parent | exit | entropy) → seed` per step) and a tally of
  rooms, loops, cells, shards, keys, collapses and entropy spent.

There's no passive regen and no lose state yet. You can always keep walking
forward; collapsing is the only thing entropy buys.

## Visual parameters

| Parameter | Value | Notes |
| --- | --- | --- |
| Scale | 1 cell = 2 world units | the figure is about half a cell tall |
| Walls | 1.3 cells tall, thin, flat-shaded | tinted by the space's seeded `meta.hue` |
| Floor | one tile per cell, with a dark gap between tiles | the gaps make the grid you're walking on visible |
| Doorways | 0.6 cells wide, 1.0 tall, with a lintel above | |
| Closed door | dark panel with a warm orange seam of light under it | the same orange as the chart view's open doorways |
| Locked door | iron-grey panel with two bands and a cold blue seam | also blue on the minimap |
| Camera | fixed 3/4 top-down view from the south, smooth follow | W is always north on screen and on the chart |
| Occlusion | screen-door dither on walls in front of the figure, inside a soft circle around it (17% of the screen) | walls never move; only a "porthole" opens around you |
| Light | the lantern is a shadow-casting point light; ambient is almost zero | plus a faint, short-range cool fill so nearby wall faces read |
| Pickups | violet octahedron (shard), small gold key | bob and turn; lit by the lantern, so they hide in the dark too |
| Reveal | floor tiles appear outward from the door, then the walls rise, over about 1 s | collapse plays it in reverse, deepest rooms first |
| Captions | a short typewriter-style log line when you enter a space | e.g. "s7 · chamber · damp · depth 3" (the Navidson Record feel) |

## Game parameters

All in `RULES` (`app/play-rules.js`) or at the top of `app/play.js`.

| Parameter | Value |
| --- | --- |
| Move | WASD / arrows (Shift runs at 4 cells/s instead of 2.4); touch: drag for a stick |
| Open a door | walk into it for 0.35 s, or press E / tap the prompt |
| Entropy | starts at 30, capped at 100 |
| Shard | +10 entropy; found in 30% of chambers, 12% of corridors, 25% of dead ends |
| Key | 1 in 30 rooms at depth 3 or deeper |
| Locked door | 10% of unresolved exits on rooms at depth 4 or deeper |
| Collapse price | 1 per cell + 2 per room across the whole branch |
| Persistence | the expedition is shared with the chart view; position and run state are saved per root seed |

In a 2,000-room simulation that works out to about 0.2 shards and 0.024 keys
per room. Collapsing one average room (~10 cells) costs about what you find
in 6 rooms of exploring.

## Determinism

Loot uses `deriveRng(space.seed, 'loot')`. A lock uses
`deriveRng(space.seed, 'lock|' + exit.index)`. Neither consumes the layout
stream, so a replayed expedition holds identical shards, keys and locks. A
collapsed-and-regenerated room has a new seed and so new loot. A collected
item is remembered as `spaceId:seed:itemId`.

## Future directions (noted, not built)

From the 2026-10-19 design chat. The meter is the seed of a bigger idea:
undoing gets harder and more consequential the deeper you go.

- **Depth makes it stranger.** The deeper you go, the more uncanny, surreal
  and dangerous things get: mood, geometry, lighting, sound, and what lives
  there. The seed chain already gives depth a natural "distance from the
  root".
- **Points of no return.** Some dangers, once unleashed, can't be undone. If
  you don't have enough entropy to reseed the whole path back past them, you
  have to find another way through. Collapse becomes an escape hatch with a
  horizon.
- **Growing the resource.** Ways to raise the entropy cap, add regen, or
  make collapse cheaper: XP, skills, items you have to find (and maybe
  find again after a collapse).
- **Partial or targeted collapse.** Erase one room, not the whole branch,
  for a different price. Or collapse that leaves "scars" the generator
  remembers.
- **Reroll in place.** Peek at what's behind a door (the chart view's
  ghost) and pay to reroll before ever stepping through.
- **Locked doors that lead somewhere:** a next level, a vault, or the relic
  from the design doc's roguelike idea, instead of ending the walk.

## Out of scope for now

- Combat, health, enemies, and any lose state.
- Exit kinds in the engine itself (locks live in the walk layer for now).
- Ceilings, first-person view, and camera rotation.
- Performance work. One mesh per tile and per wall, plus point-light
  shadows, renders a 130-room map in about 4 ms per frame on a desktop GPU.

## Open questions

- Should entropy regenerate slowly, or only come from shards?
- Is "collapse the whole branch" too blunt once branches loop back into
  rooms you're keeping?
- Should rooms you've lit keep a faint "memory glow" in 3D, or is the
  minimap enough?
- Does a locked door ending the run feel like a win, or like being cut off?
