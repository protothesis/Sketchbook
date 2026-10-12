# Style system: draft spec

**Started:** 2026-10-12. **Status:** draft, agreed in a design session, not
built. The look it should produce first is in
[`visual-direction.md`](visual-direction.md).

## Goal

The same generated data should be able to look very different per region,
planet or profile, and support view types in the manner of Google Maps'
(the current `natural` look, the new `board` look, and later street
detail, parchment or fantasy, black-and-white pattern, satellite-ish). To
get there, **data and presentation are kept separate**:

```
generator  →  S (settlement data, no colours)
                 ↓
            feature types (stable keys: field.wheat, building.civic, way.lane …)
                 ↓
style      →  palette, patterns, fonts, layer list with per-zoom rules
                 ↓
renderer   →  draws each layer with a named draw function
```

Non-goals for now: a style editor UI, user-authored styles, or matching
Mapbox's style spec. The shape borrows the idea (an ordered layer list
with filters and zoom-dependent values) and stays much smaller.

## Where things stand

In today's `ui/render.js`:
- Colours are partly constants at the top (`HYPSO`, `CROP_COLORS`,
  `CAT_COLORS`, `ROAD_STYLE`, `TREE_COLORS`) and partly about 60 inline
  literals in the draw functions.
- Line weights follow a `max(world width, N × px)` rule with a different
  `N` in each function.
- Zoom thresholds are hard-coded per function.
- Draw order is fixed in `draw()`.
- `app.js` reads `CAT_COLORS` and `CROP_COLORS` for the legend.
- `env.palette` is used both by the renderer (which terrain ramp to use)
  and by the engine (`fields.js` crop mix). That has to split: see step 1
  of the migration.

## Feature types

A feature type is a dotted key naming a kind of thing in the data. Styles
match on these, never on engine internals. The first level is the
collection and the second is the attribute that styles care about:

| Key | Source in `S` | Second level |
|---|---|---|
| `terrain` | `S._.terrain` | none (special: raster) |
| `contour.minor`, `contour.major`, `shore` | built from terrain | none |
| `water.river`, `water.lake`, `water.sea` | terrain | none |
| `field.<crop>` | `S.fields` | `wheat`, `pasture`, `orchard`, … |
| `plaza.<kind>` | `S.plazas` | `square`, `green` |
| `landmark.<type>` | `S.landmarks` | `pond`, … |
| `way.<kind>` | `S.network.ways` | `road`, `street`, `lane`, `track` |
| `bridge` | `S.network.edges` with `bridge` | none |
| `building.<category>` | `S.buildings` | `residential`, `civic`, … (`type` available to filters) |
| `room` | `building.rooms` | none |
| `tree` | `S.trees` | none |
| `area.<kind>` | **new**, `S.areas` | `boundary`, `forest`, `settled`, `wetland`, `district` |
| `label.<kind>` | derived | `place`, `street`, `building`, `room`, `destination` |

`area.*` doesn't exist yet. It's the generator work listed under
*Generator needs* in the direction doc. Until it lands, a style that asks
for `area.forest` just draws nothing for it, and the renderer can offer a
stop-gap (for example a boundary computed in the renderer) behind the same
key.

## The style object

A style is plain data plus **names** of draw functions, so it could later
be saved in the atlas or exported as JSON. Functions themselves live in a
registry (see *Draw functions*).

```js
{
  id: 'board',
  label: 'Board',
  extends: null,              // or another style id; shallow-merged per key
  paper: 'theme',             // 'theme' = read CSS --paper (today's behaviour), or a colour
  palette: {                  // the only colours a style uses
    paper: '#f5f3ee', context: '#dddcd6', line: '#a9aaa3', ink: '#22262a',
    water: '#34565c', shallow: '#9fb8b8', forest: '#4b5a3a', sage: '#a7b18c',
    wheat: '#cdb980', blush: '#e9cfc6'
  },
  fonts: {
    label: { family: 'system-ui, sans-serif', weight: 500, caps: true, tracking: 0.12 }
  },
  patterns: {                 // procedural tiles, built once per style into CanvasPatterns
    rows:    { kind: 'lines',  spacing: 3.2, width: 0.35, color: 'wheat', ground: 'wheat~0.55' },
    stipple: { kind: 'dots',   spacing: 4,   radius: 0.45, color: 'sage', ground: 'sage~0.35' },
    crowns:  { kind: 'crowns', spacing: 7,   radius: 3.2,  color: 'forest', ground: 'sage' },
    waves:   { kind: 'waves',  spacing: 4,   width: 0.4,  color: 'water', ground: 'shallow~0.5' }
  },
  focus: { area: 'area.boundary' },   // which area counts as "inside"; omit for none
  layers: [ /* ordered, bottom to top; see below */ ],
  states: {                   // interaction overrides
    highlight: { 'building.*': { fill: '@category', stroke: '#ffffff', width: { px: 1 } } },
    select: { stroke: '#1f6feb' }
  }
}
```

**Colour references.** Anywhere a colour goes, it can be a palette name
(`'water'`), a tint toward paper (`'wheat~0.55'` = 55% of the way to
paper), a literal (`'#ffffff'`), or `'@category'` (look up
`categoryColors` in the style). Keeping colours as palette references is
what makes a style feel unified, and makes recolouring a style cheap.

**Widths** are `{ m: 0.8, px: 1.2 }`: real width in metres, never thinner
than `px` screen pixels. This is the rule `render.js` already follows,
made explicit. Either part can be omitted.

**Zoom-dependent values.** Any value can be stops over `view.scale`,
linearly interpolated: `{ z: [[0.25, 0], [0.6, 1]] }`. That's enough for
fades and growing widths without an expression language.

### Layers

```js
{
  id: 'fields',
  match: 'field.*',               // feature-type key, '*' allowed at the end
  filter: null,                   // optional: { type: ['inn', 'manor'] }, or a registered predicate name
  draw: 'fill',                   // registered draw function name
  zoom: [0, Infinity],            // min/max view.scale it's visible at
  focus: 'inside',                // 'inside' | 'outside' | 'any'
  paint: { fill: 'wheat~0.6', pattern: null, alpha: 1 },
  byKey: {                        // per-second-level overrides
    pasture: { fill: 'sage~0.5', pattern: 'stipple' },
    orchard: { fill: 'sage~0.6', pattern: 'dots' },
    wheat:   { pattern: 'rows', align: 'field' }
  },
  toggle: 'fields'                // which UI layer checkbox controls it (optional)
}
```

- **Order** is the array order, so a style can reorder layers or add new
  ones.
- **The same feature type can appear in several layers**, which is how
  casing then fill, inside versus outside, and close-zoom-only extras are
  done.
- **`focus`** uses the `focus.area` polygon as a clip: `inside` draws
  clipped to it, and `outside` draws clipped to its complement. That's
  the whole subject/context mechanism. The boundary is drawn as a fill
  with no outline because nothing strokes it.
- **`toggle`** maps layers onto the existing checkboxes (`contours`,
  `trees`, `fields`, `labels`, `interiors`), so the UI keeps working, and
  a style can decide what each checkbox covers.

### Draw functions

A small registry, `VG.render.draw[name] = function (ctx, items, paint, env)`,
where `env` carries `view`, `px`, the resolved palette, patterns, `t`
(growth playback) and the selection and highlight state. Built-ins:

| Name | Does |
|---|---|
| `fill` | Polygons, batched by resolved fill (today's `batched()` path) |
| `stroke` | Polylines and outlines, batched by stroke |
| `casing` | Wider stroke under a later `stroke` layer, for roads |
| `circles` | Points with radius (trees, landmarks) |
| `terrain.hypso` | Today's baked elevation ramp plus hillshade (the `natural` look) |
| `terrain.bands` | Stepped flat bands per contour interval, no hillshade (`board`) |
| `rooms` | Floor plans |
| `labels.*` | Place, street, building, room, destination labels |

A view type that needs a genuinely different technique (satellite-ish
noise texture, parchment ink wobble) registers its own function and names
it in its layers. Most view types should need **no new code**, only a new
style object.

**Raster layers** (`terrain.*`) are baked once per settlement **per
style**, as today. The renderer keeps owning bake and batch thresholds
(`BAKES`, `BATCH`, `BAKE_MIN_BUILDINGS`). Those are performance, not
style, and stay out of the style object. Switching style throws away the
bakes.

### Patterns

- Procedural tile kinds: `lines`, `dots`, `crowns`, `waves`, `dashes`,
  `grid`, each with a small set of parameters, built once per style into
  `CanvasPattern`s. No image files.
- **Patterns are anchored in world metres** (`pattern.setTransform` from
  the view transform), so a hatch belongs to the ground and doesn't swim
  when you pan.
- `align: 'field'` rotates a field's pattern to the field's long axis.
- **A pattern whose spacing would come out under ~3 screen pixels falls
  back to its flat `ground` colour.** That's the zoom rule for patterns.

## How a style gets picked

Most specific wins:

1. **The view-type switcher** in the UI: the user's explicit choice for
   this session, kept in the URL hash like other settings.
2. **A place override:** an authored or locked place can pin a style.
3. **The profile's default:** `profile.style` (medieval → `board` for
   now).
4. **The region's or planet's default,** once those levels exist: a planet
   can carry its own palette (e.g. `extends: 'board'` with only `palette`
   changed).
5. **The fallback:** `natural` until `board` is ready, then `board`.

The terrain ramp's choice by biome (today's `HYPSO.temperate / highland /
arid`) becomes `byKey` on the terrain layer, keyed by the environment's
biome. The engine stops calling it `palette`.

## file:// compatibility

- Each style is a classic script, `ui/styles/<id>.js`, that does
  `VG.styles = VG.styles || {}; VG.styles.board = { … };`. These are
  loaded with plain `<script src>` tags in `index.html`, after
  `render.js`.
- No `fetch`, no JSON files, no modules, no web fonts. Labels use
  `system-ui`. Tracking uses `ctx.letterSpacing` where supported, and is
  simply dropped otherwise.
- Style objects stay JSON-shaped (no functions inside), so a style can
  later be stored in browser storage or exported with the atlas.

## Example: the start of `board`

```js
VG.styles.board = {
  id: 'board', label: 'Board', paper: 'theme',
  palette: { /* as above */ },
  categoryColors: { residential: 'blush', commercial: 'wheat', craft: 'wheat~0.4',
    civic: 'shallow', religious: 'shallow~0.3', agricultural: 'sage', industrial: 'line' },
  fonts: { label: { family: 'system-ui, sans-serif', weight: 500, caps: true, tracking: 0.12 } },
  patterns: { /* as above */ },
  focus: { area: 'area.boundary' },
  layers: [
    { id: 'bands',     match: 'terrain', draw: 'terrain.bands', paint: { fill: 'context', alpha: 0.18 } },
    { id: 'contours',  match: 'contour.*', draw: 'stroke', toggle: 'contours',
      paint: { stroke: 'line', width: { px: 0.6 }, alpha: 0.7 }, byKey: { major: { width: { px: 0.9 } } } },
    { id: 'territory', match: 'area.boundary', draw: 'fill', paint: { fill: 'sage~0.85' } },  // faint ground under everything inside
    { id: 'forest',    match: 'area.forest', draw: 'fill', focus: 'inside', toggle: 'trees',
      paint: { fill: 'sage', pattern: 'crowns' } },
    { id: 'fields',    match: 'field.*', draw: 'fill', focus: 'inside', toggle: 'fields',
      paint: { fill: 'wheat~0.6', pattern: 'rows', align: 'field' },
      byKey: { pasture: { fill: 'sage~0.5', pattern: 'stipple' }, meadow: { fill: 'sage~0.5', pattern: 'stipple' } } },
    { id: 'settled',   match: 'area.settled', draw: 'fill', focus: 'inside', paint: { fill: 'wheat~0.75' } },
    { id: 'water',     match: 'water.*', draw: 'fill', paint: { fill: 'water' } },
    { id: 'roads',     match: 'way.*', draw: 'stroke', paint: { stroke: '#fbfaf7', width: { m: 4, px: 1.2 } },
      byKey: { track: { stroke: 'line', width: { px: 0.8 }, dash: [4, 3] } } },
    { id: 'buildings', match: 'building.*', draw: 'fill', focus: 'inside', paint: { fill: '#ffffff' } },
    { id: 'buildings-context', match: 'building.*', draw: 'stroke', focus: 'outside',
      paint: { stroke: 'line', width: { px: 0.8 } } },
    { id: 'place-label', match: 'label.place', draw: 'labels.place', zoom: [0, 1.6], toggle: 'labels',
      paint: { color: 'ink', size: 15, alpha: { z: [[0.8, 1], [1.6, 0]] } } }
  ],
  states: { highlight: { 'building.*': { fill: '@category', stroke: '#ffffff', width: { px: 1 } } } }
};
```

`natural` is the same shape, holding exactly today's values: `terrain.hypso`,
the `CROP_COLORS` and `CAT_COLORS` fills with dark outlines, cased roads,
circles for trees, and the radial vignette as a layer of its own.

## Migration from today's `render.js`

Each step is shippable on its own:

1. **Split `palette`.** The engine's `env.palette` (used for the crop mix)
   becomes `env.biome`. The renderer gets its terrain-ramp key from the
   biome. No visual change.
2. **Extract `natural`.** Move every constant and inline literal from
   `render.js` into `ui/styles/natural.js` as palette, paint and zoom
   values. The draw functions read them from the active style, while
   keeping their current structure and fixed order. Make `app.js`'s
   legend read the style's category colours. **Check: no visual change**
   (screenshot the same seed at 3–4 zooms before and after).
3. **Layer list drives drawing.** Replace `draw()`'s fixed sequence with a
   loop over `style.layers`, using the draw-function registry. Zoom
   thresholds move into layer `zoom` and paint stops. Again no visual
   change.
4. **Focus clip and patterns.** Add the `focus` clip, with a renderer-side
   stop-gap boundary (farmed extent) until the generator provides one, and
   the procedural pattern builder.
5. **Generator areas.** `S.areas` with `boundary` (farmed extent pulled to
   a contour), `forest` and `settled`, each with stable IDs. This is
   engine work and could be its own session.
6. **`board` style** plus a view-type switcher, then tune it in the
   browser.
7. **Later:** more view types, per-planet palettes, a pattern-only
   black-and-white view.

## Open questions

- Is `extends` (a shallow merge per key) enough for planet variants, or do
  they want palette-only overrides as a separate concept?
- Labels: leave collision avoidance as it is (none), or does the quieter
  board look need simple label thinning?
- Highlight and selection: are they in the style (as drafted) or global
  UI chrome?
- Do style IDs get saved with locked places in the atlas, or is style
  always a view choice?
