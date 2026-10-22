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

**Walk mode:** open `play.html` to walk the same expedition in 3D with
WASD (or drag on touch). Every closed door is unresolved until you push it
open, and the space behind it assembles as the door swings. Spend
**entropy** to close a door you opened and collapse everything beyond it
(reopening rerolls). Shards refill entropy, and a rare key opens a locked
door, which ends the walk on the expedition record. The design and the
tunables are in [`PLAY.md`](PLAY.md). A look back and some loose thoughts on
where to go next: [`CLOSING-THOUGHTS.md`](CLOSING-THOUGHTS.md). The plan
that followed (rerolling, restoration as the way to earn entropy, seeds,
door connections) is in [`GAME-DESIGN.md`](GAME-DESIGN.md).

**Playtesting over the network:** serve the repo with
`python tools/serve.py` (from the repo root; port 8791 by default) and open
`http://<your IP>:8791/sketches/procedural-dungeon-engine/play.html`. It
sends no-cache headers, so every machine always gets the current files.
Plain `python -m http.server` lets browsers keep stale scripts. If a page
still looks wrong, hard-refresh it (Ctrl+Shift+R, Cmd+Shift+R on a Mac).

Headless engine check: `node stress-test.js [expansions] [runs]`.

## Structure

```
engine/          pure data + logic, no DOM; also loads under Node
  rng.js           cyrb53 hash, sfc32 PRNG, derived streams, entropy
  shapes.js        grid helpers + chamber / corridor / stub generators
  expedition.js    createExpedition, expand, commit, revert, setCaps,
                   replay, exportRecord, importRecord, stats
app/             clients of the engine
  renderer.js      Canvas 2D top-down map, hit-testing, pan/zoom
  app.js           controls, inspector, pointer input, autosave
  styles.css
  play-rules.js    walk mode's game rules: seeded loot + locks, collapse cost
  walk/            walk mode, as classic scripts loaded in this order:
    core.js          tunables, renderer/scene/camera, run state, saving
    world.js         dither, materials, building and dissolving spaces
    figure.js        the figure and lantern, collision, climbing, crouch
    items.js         hotbar, chalk marks, jars, sigils
    restore.js       restoration: push blocks and their floor marks
    actions.js       doors: open, unlock, collapse; doorstones
    input.js         keyboard, touch stick, buttons
    ghosts.js        hash ghosts
    fx.js            wobble/glitch post-process, rendering a frame
    hud.js           prompts, captions, minimap, big map, record screen
    main.js          per-frame update, expedition setup, boot
  play.css
vendor/three/    three.js r160 classic build (walk mode only)
stress-test.js   headless milestone checks (Node)
DESIGN.md        the design brief
PLAY.md          walk mode's visual + game design parameters
CLOSING-THOUGHTS.md  a look back at walk mode, and loose thoughts on next steps (not a plan)
GAME-DESIGN.md   the plan from there: entropy, rerolling, restoration, seeds, door connections
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
