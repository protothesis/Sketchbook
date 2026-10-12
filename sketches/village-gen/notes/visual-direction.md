# Visual direction: the "board" look

**Started:** 2026-10-12. **Status:** agreed direction, not built yet. The
style system that will carry it is specced in
[`style-system.md`](style-system.md).

The current map is drawn "naturally": an elevation colour ramp, hillshade,
soft contours, every tree a circle, buildings coloured by category, and a
transparency vignette at the edge. It works, but the goal is something more
graphic and deliberate, in the manner of landscape-architecture and
urban-design presentation boards. Today's look stays available as the
`natural` view type.

## References

Twelve images, kept **outside the repo** in a local reference folder
(`Sketchbook Reference/map aesthetic`, next to the repo checkout). They are
other people's published work, so they are not committed, copied into a
worktree, or linked from here. They're referred to by the first four
characters of their filenames.

| Ref | What it is | What to take from it |
|---|---|---|
| `c0dd` | Fjord site plan inside a circle, on grained grey paper | Dark slate water; white buildings with a small shadow; hairline contours; tiny spaced caps labels; coastline line carrying on past the colour |
| `d1fc` | Riverside figure-ground plan | Near-black water; buildings in one value; streets as the gaps between things; one district picked out in an ochre hatch |
| `bc18` | "Natural analysis" plan | Pattern says use: stipple for grass, waves for wetland, lines for woodland; one building highlighted in pink; context buildings flat grey |
| `8c35` | Black-and-white land-use plan with a pattern legend | A full pattern vocabulary for land use; the most generative-friendly reference |
| `a7d1` | Park plan with its palette printed as swatches | A deliberately chosen ~12-colour palette that unifies the whole sheet |
| `3332` | Riverfront zone analysis | Context in pale grey; one accent colour for the network; edge arrows where routes leave the map |
| `01a0` | Regional diagram | Hard-edged dashed region boundary; red accent routes ending in arrows; soft bands for hills; nodes as circles |
| `1b33` | Creek corridor plan and abstract diagram | Wide-tracked uppercase sans labels on leader lines; abstract rings as symbols |
| `6346` | Stream corridor with a radial diagram | Trees as dark dots; subject strip coloured, surrounding blocks grey |
| `04f0` | Lush park plan in a grey city | Subject in colour, context as light grey outlines |
| `8e83` | Watercolour site board | Subject/context split done with washes |
| `2e9b` | Journal figure: aerial collage plus GPS lines | The fade staged as photo, then outline only, then a single line |

Watercolour washes (`8e83`, `01a0`) and lush rendering (`04f0`, `1b33`,
`a7d1`) are **not** the target. What they share with the crisp boards is
what we want: bold areas of graphic colour against a neutral ground.

## What the references have in common

1. **Subject versus context.** One area is in colour, with a hard edge that
   means something (site, parcel, municipal limit, coast). Around it the
   context is still drawn, just stepped down: colour, then grey, then line
   only, then nothing. The fade comes from losing emphasis, not from
   transparency.
2. **Lines run past the fill.** Coastlines and roads carry on out onto bare
   paper, often ending in arrows. That's why a hard-edged area doesn't read
   as a crop.
3. **Big flat fills from a small palette.** About 4–6 muted hues plus one
   accent. Colour marks zones, not objects.
4. **Water is often the darkest value on the sheet.** It gives the map its
   overall shape before any detail is read.
5. **Buildings in a single value.** Category is shown by highlighting, not
   by colouring every roof.
6. **Roads as negative space.** Streets are the gaps between fills and
   buildings. Only main routes get a casing.
7. **Pattern instead of colour for use.** Stipple, hatch, waves, dot grids.
8. **Hairline line language.** Thin grey contours with no hillshade, dashes
   and dots that carry meaning, and at most one heavy accent line.
9. **Quiet type.** Small, widely spaced uppercase sans. Labels are sparse,
   and the calm background means they don't need halos.
10. **Detail follows attention.** Full detail inside the subject area,
    outlines outside it. This is a second level-of-detail axis, **focus**,
    on top of zoom.

## Decisions (2026-10-12)

**Family:** crisp boards. No watercolour texture or lush rendering.

**Palette:** a fixed set of about ten named colours per style, in the
spirit of `a7d1`. Every fill comes from it. Draft for the board style:

| Name | Hex | Used for |
|---|---|---|
| paper | `#f5f3ee` | background |
| context | `#dddcd6` | context fills, bands |
| line | `#a9aaa3` | hairlines, context outlines |
| ink | `#22262a` | text, the few dark marks |
| water | `#34565c` | water bodies, river |
| shallow | `#9fb8b8` | shallow water, wetland base |
| forest | `#4b5a3a` | tree crowns in the forest pattern |
| sage | `#a7b18c` | forest ground, pasture family |
| wheat | `#cdb980` | arable family |
| blush | `#e9cfc6` | accent: highlights, selection fills |

Tints of these (lighter mixes toward paper) are allowed. New hues are not.

**Land use = colour family + pattern** (combining `8c35` and `a7d1`).
Colour gives the broad family (growing land, wild land, water, settled
ground) and pattern tells the uses within a family apart, so the palette
stays small:

| Use | Fill | Pattern |
|---|---|---|
| Water | water, flat | none |
| Wetland | shallow tint | waves |
| Forest | sage | tiled stylised crowns in forest green |
| Orchard | pale sage | dot grid |
| Pasture, meadow | pale sage | stipple |
| Arable (wheat, barley, oats, rye…) | wheat tint | row hatch, aligned with each field |
| Vineyard | wheat tint | fine rows |
| Fallow | pale wheat | sparse dashes |
| Common, village green | sage tint | flat |
| Settled ground (inside the town) | pale beige | flat |

A style can swap any pattern for a flat fill. A pure black-and-white
pattern view in the manner of `8c35` is a possible later view type, not
the default.

**Forests as pattern, not objects.** The forest tile is drawn as stylised
crowns so it still reads as trees. Individual tree objects only appear up
close, and then only at woodland edges and for lone trees. (This needs
forest areas as polygons: see *Generator needs*.)

**Topography:** very faint stepped bands (a flat tint per contour
interval, so the value changes sharply at each contour rather than
smoothly), plus hairline contours with every fifth line slightly heavier.
No hillshade in the board style.

**The boundary (the "fade"):**
- Inside the boundary: full colour and pattern.
- Outside: context treatment. Grey hairlines, buildings as outlines only,
  no land-use colour.
- The edge is **fill only, with no outline stroke**. The colour simply
  stops.
- Where it comes from: the **farmed extent** (outer edge of the fields
  plus a margin), pulled toward a nearby **contour** so it follows the
  land. It's cut by the coast and rivers.
- Roads, rivers and the coastline keep going past the edge onto the paper.

**Buildings:**
- Inside the boundary: **white fill, no outline**, on the settled-ground
  beige.
- "What's here" highlight: the category colour (from the palette) with a
  **white outline**.
- Outside the boundary (context): a simple grey outline, no fill.
- Category colours are no longer shown by default.

**Roads:** negative space. Streets and lanes are paper-white gaps. Main
roads get a thin ink casing at closer zooms. Tracks are a dashed hairline.

**Labels:** small, widely spaced uppercase sans for everything (town name,
streets, buildings, the "to X →" destinations). No halos where the
background is calm enough.

**Destinations:** the "to Ashby →" tabs become edge arrows plus caps
labels, as in `01a0` and `3332`. They still need to be clearly clickable.

**Dark mode:** no change. The map surround keeps following the theme's
`--paper` as it does today. The board palette is tuned for light paper
only, and that's accepted for now.

## Board style by zoom

Rough thresholds in `view.scale` (screen pixels per metre), to be tuned
in the browser:

| Zoom | What shows |
|---|---|
| < 0.25 (whole territory) | Paper, water, the boundary area with flat land-use fills (patterns too small to read), settled-ground mass, main roads, town name in caps |
| 0.25–0.9 | Patterns appear; buildings as white shapes; streets as gaps; hairline contours and bands |
| 0.9–3 | Field hatches aligned per field; edge and lone trees as objects; street names; cased main roads |
| > 3 | Doors, then room plans (≥ 7), in palette colours |

A pattern that would come out finer than a few screen pixels falls back to
its flat fill.

## Generator needs

The board look is built from **areas**, and the generator mostly makes
**objects**. Missing today:

- **Settlement boundary:** farmed extent plus contour, as above.
- **Forest polygons:** from the terrain's forest field or tree density.
- **Settled-ground area:** the built-up footprint.
- **Districts / land-use zones:** derived from building categories.
  Optional at first.
- **Wetland:** if the terrain makes any.

These belong in the engine's output (likely a new `S.areas`), not in the
renderer, because later consumers will want them too: region maps, Psyche
Town, any analysis. Every area polygon should have a stable ID.

## Open questions

- Will it be too busy with everything showing? Try it, then thin out.
  Patterns are the likeliest thing to cut.
- How far past the boundary should the context drawing go before plain
  paper: the whole terrain tile, or a margin?
- How do the destination arrows stay obviously clickable without becoming
  UI-ish pills again?
- Should the boundary come from the atlas once neighbours exist (a
  territory shared with the next town), so the village and region views
  agree?
- Paper grain, as in `c0dd`: skipped for now as texture; revisit.
