# Procedural Dungeon Engine

**Started:** 2026-10-04
**Status:** prototype

A procedural dungeon where exploring *is* generating. Space only exists once
you open a door into it. Each new space's seed is hash-chained from its
parent's seed, the door used, and fresh entropy, and the finished map is the
record of the expedition. The tone is *House of Leaves*: an endless,
shape-shifting interior you can still chart.

```
seed_child = H(seed_parent || exitIndex || entropy)
```

Fresh entropy means an unopened door is genuinely unknown, and you can
reroll what's behind it. Recording that entropy on accept means anything
committed can be replayed exactly from the root seed.

The full brief is in [`DESIGN.md`](DESIGN.md), copied from the original
design doc. Implementation decisions, including where this build departs from
the brief, are in [`NOTES.md`](NOTES.md).

## Try it

Open `index.html` directly. It needs no server or build step. Tap an orange
doorway to see a ghosted preview of the space beyond, then **Accept** or
**Reroll**. Select a leaf space to **Revert** it. Drag to pan, and scroll or
pinch to zoom. Export an expedition as JSON, then re-import it to replay it
cell-for-cell. The current expedition autosaves in your browser.

Headless engine check: `node stress-test.js [expansions] [runs]`.

## Structure

```
engine/          pure data + logic, no DOM; also loads under Node
  rng.js           cyrb53 hash, sfc32 PRNG, derived streams, entropy
  shapes.js        grid helpers + chamber / corridor / stub generators
  expedition.js    createExpedition, expand, commit, revert, setCaps,
                   replay, exportRecord, importRecord, stats
app/             the prototype renderer, one possible client of the engine
  renderer.js      Canvas 2D top-down map, hit-testing, pan/zoom
  app.js           controls, inspector, pointer input, autosave
  styles.css
stress-test.js   headless milestone checks (Node)
DESIGN.md        the design brief
NOTES.md         implementation decisions
```

## Milestones (from the brief)

1. Seeds and PRNG: done
2. Spaces and registry: done
3. Expand / reroll / commit, with fallbacks and dead ends: done. 500
   random expansions run with no overlaps.
4. Minimal renderer: done
5. Record and replay: done. Export → import is verified identical.
6. Revert (leaf-only) and caps: done
7. Simple loops: done. Dense runs show many cycles.

## Next steps

- Loop-seeking corridors and depth "pressure"
- Organic shape generators on the same cell-set model
- Exit kinds (risky, locked, one-way) via `Exit.kind` and `tags`
- A styled, printable map renderer, separate from this debug one
- A compact shareable expedition string
