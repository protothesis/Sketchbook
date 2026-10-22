# Implementation notes

Decisions made while building the first pass, per the design doc's request.
Each one is a default that can change.

## Stack

- **Classic-script JS, not Vite + TypeScript.** The repo requires every sketch
  to open from `file://` with no build step. The engine/app split from the doc
  is kept: `engine/` has no DOM access, attaches to `window.DungeonEngine`
  (or `globalThis` under Node) and is loaded by `stress-test.js` as-is.
  `app/` attaches to `window.DungeonApp` and only calls the engine API.
- **No Vitest.** `node stress-test.js` covers milestones 1–3 and 5–7
  headlessly (overlaps, registry rebuild, exact replay, cycles).

## Seeds

- `H` = cyrb53 over the parts joined with `|`, as a 14-hex-char string.
  `seed_child = H(parent.seed | exit.index | entropy)`.
- Per-space PRNG = sfc32 seeded from four salted cyrb53 hashes of the seed.
- Entropy = 64 bits from `crypto.getRandomValues`, stored as hex.
- Root: space 0's seed is `H(rootSeed | "root")`. Global params come from
  `H(rootSeed | "params")`: chamber size range, corridor length range,
  corridor weight, exit bias, loop chance.
- `meta` (hue, mood) comes from `H(seed | "meta")`, so it never shifts layouts.

## Placement

- Shapes are generated in a **travel frame** (u = the direction you walked
  through the door, v = your right), with the entry cell at (0, 0). A chamber's
  entry offset along its near wall is the "entry position" the doc mentions.
- Fallback order (≤20 attempts, all drawn from the space's PRNG): the base shape,
  then other entry offsets, then progressively smaller shapes, then the other
  archetype. If nothing fits, the result is a one-cell dead-end **stub**.
- New spaces may sit wall-to-wall against existing ones. That adjacency is what
  makes loops possible.

## Loops

- Expanding an exit whose beyond-cell is already occupied gives a
  `type: 'loop'` candidate: accepting it connects into that space, creating an
  exit there (`loopMade: true`) or reusing a matching unconnected one. This
  answers the open question: yes, a loop can **create** an exit on the target.
- During exit placement, slots that face an occupied cell are kept with
  probability `params.loopChance` (a seeded per-expedition value from 0.25 to 0.5)
  instead of always being skipped. This deliberately departs from pipeline
  step 7, so that loops actually show up.
- Loop candidates have no entropy, so there is nothing to reroll.

## History / replay

- `history` holds `commit` (parentId, viaExitId, entropy, loop?), `revert`
  (spaceId) and `caps` events. **Rerolls are not recorded.** Rejected
  candidates leave no trace.
- Replay starts from `rootSeed` plus the stored params (with caps cleared), then
  re-applies history in order. Space and connection ids come from counters,
  so they replay identically. `importRecord` diffs the replay against the
  file's stored spaces and reports any mismatch.
- The UI autosaves the record to `localStorage` and restores it on load by
  replaying it. If storage is unavailable it just starts fresh.

## Revert

- **Leaf-only.** A space can be reverted when it isn't the root and no other
  space has it as `parentId`. Its connections are removed. Loop exits it had
  created on other spaces are deleted, and any other exit it was connected to
  becomes unresolved again.
- A re-opened exit **draws new entropy** next time it's opened. It doesn't
  remember the old result.
- **Traces** (added 2026-10-20 for walk mode's "rerolls leave a mark"). The
  reverted space is copied into `exp.traces[id]` (seed, cells, parent, exit,
  entropy, depth, meta, and `revertedAt` = its history index). Traces are
  derived state, like the registry: replay rebuilds them, and they never
  block placement. `imprintAt(exp, key)` indexes them per cell (cached
  outside the export and cleared on every revert). An application decides
  what an imprint means; the engine only remembers.

## Carving exits

- `carve(exp, spaceId, cell, facing)` adds an unresolved exit to an
  existing space's wall, tagged `carved`, and records a
  `{ type: 'carve', spaceId, cell, facing }` event that replay re-applies.
  `canCarve` requires the cell to be in the space, the edge to be a wall
  (not open to the space's own floor), no exit already on that edge, and no
  unopened exit on the far side facing back.
- A carved exit then behaves like any generated one. Expanding it seeds a
  new space from `H(seed | index | entropy)` with the next exit index, or
  makes a loop if the far cell is already occupied. Walk mode uses it for
  door chalk; the engine stays rule-free.

## Halls, reserves and the surface exit

Added 2026-10-22 for walk mode's waypoints (see `GAME-DESIGN.md`).

- **Halls** (`hallCells`) aren't grown from a door. They're placed whole, in
  plain grid coordinates: a rectangle with notched corners. New
  expeditions' root is one (`params.starter: 'hall'`, centred on the
  origin). Records without `starter` replay with their root chamber, so old
  saves are unchanged.
- **Reserves** claim cells ahead of time: `reserve(exp, { seed, kind,
  cells, ...data })` records a `reserve` history event; extra fields (walk
  mode's `pin` and `tier`) are kept as-is. `reservedAt` indexes waiting
  reserves per cell (non-enumerable cache, like imprints).
  - `fits` treats waiting reserve cells as taken, so nothing grows into
    them.
  - `expand` into a waiting reserve builds that space from the reserve's
    own seed and cells, whatever door you came by. No entropy, so the
    commit event has `entropy: null`, and replay lands in the same branch.
  - `exitSlotOk` always keeps a door facing a reserve, and `buildSpace`
    adds one door into each reserve a new space touches (no draws, so
    spaces away from reserves are unchanged).
  - Reverting a reserved space puts the reserve back to waiting.
- **The surface exit** is an `Exit` with `kind: 'surface'`, on a north
  wall of the root hall. `expand` refuses it, `stats` doesn't count it as
  open, and the chart view neither draws it as openable nor lets you click
  it. Nothing keeps rooms from being built on its far side (it never
  opens, so that's harmless).

## Caps

- `maxSpaces`, `maxArea` (cells) and `maxDepth`. Once one is reached, every
  new door opens onto a dead-end stub. Caps changes are history events, so
  replay applies them at the right point.
- The doors still open at the moment a cap is hit each resolve to one-cell
  stubs. So the final space count can go past `maxSpaces` by the number of
  doors that were open then. Each overflow space is one cell with no new exits.
