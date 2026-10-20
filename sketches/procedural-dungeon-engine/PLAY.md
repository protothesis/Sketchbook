# Walk mode: design brief

A small 3D client for the engine (`play.html`). You walk one figure around
the expedition with WASD. Opening a door is what generates the space behind
it. This is the engine's "exploring *is* generating" idea, felt first-hand
instead of clicked on a chart.

This is still an engine client, not a game. There are no resources, risk or
win state yet. The aim is to find out whether walking it is fun before
adding any of those.

## Pillars

1. **The door is the moment.** Every unresolved exit is a closed door, and
   nothing exists behind it until you push it open. The new space then
   assembles itself outward from the threshold. That reveal is the main
   thing worth polishing.
2. **Darkness, not fog of war.** You carry the only light. Spaces you've
   already opened stay in the world, but they fall into the dark beyond the
   lantern's reach. The minimap is your chart.
3. **Same expedition, two views.** Walk mode reads and writes the map view's
   autosave, so you can walk for a while, then open `index.html` to see
   the chart you made (or the reverse).

## Visual parameters

| Parameter | Value | Notes |
| --- | --- | --- |
| Scale | 1 cell = 2 world units | the figure is about half a cell tall |
| Walls | 1.3 cells tall, thin, flat-shaded | tinted by the space's seeded `meta.hue`, with low saturation |
| Floor | one tile per cell, with a dark gap between tiles | the gaps make the grid you're walking on visible |
| Doorways | 0.6 cells wide, 1.0 tall, with a lintel above | |
| Closed door | dark panel with a warm seam of light under it | the seam is the same orange as the map view's open doorways |
| Camera | fixed 3/4 top-down view from the south, smooth follow | no camera rotation, so W is always north on screen and on the chart |
| Cutaway | walls just south of you sink to knee height | so they never hide the figure |
| Light | a warm point light (the lantern) plus a faint cool ambient | the black fog starts just past the lantern's reach |
| Figure | a capsule body, head, lantern and blob shadow | bone-colored; bobs while walking |
| Palette | near-black background, desaturated hue-tinted stone, warm lantern | |
| Captions | a short typewriter-style log line when you enter a space | e.g. "s7 · chamber · damp · depth 3" (the Navidson Record feel) |

## Game parameters

| Parameter | Value |
| --- | --- |
| Move | WASD / arrow keys, relative to the screen (W = north) |
| Speed | 2.4 cells/s, or 4 cells/s with Shift held |
| Collision | a circle (radius 0.22 cells) against wall and door edges, sliding along walls |
| Open a door | walk into it for 0.35 s, or press E / Space next to it |
| Generation | opening a door calls `expand` + `commit` straight away, with fresh entropy and no preview |
| Loops | a door that opens onto a space you know just connects to it, and the caption says so |
| Dead ends | caps and failed placement still give one-cell alcoves, as in the engine |
| Reveal | floor tiles appear outward from the door, then the walls rise, over about 1 s |
| Touch | drag anywhere to use a virtual stick; pushing into a door opens it |
| Other keys | M toggles the minimap; N starts a new expedition (after a confirm) |
| Persistence | uses the map view's expedition autosave; the figure's position is saved separately |

## Out of scope for this pass

- Reroll in walk mode. The map view still has it. An option for later: you
  could reroll a just-opened space as long as you haven't stepped into it.
- Combat, items, resources, health, or a relic to find.
- Locked, risky or one-way doors (the engine doesn't have them yet either).
- Ceilings, first-person view, and camera rotation.
- Performance work: one mesh per tile and per wall is fine at a few hundred
  spaces.

## Open questions

- Should rooms you've seen stay lit (a "memory glow") or stay dark?
- Does instant commit feel right, or should a held door show a ghost first,
  with accept/reroll the way the map view does it?
- Is the minimap enough of a chart, or should walking draw the map as you
  go?
