# Procedural Dungeon Engine — Prototype Design Doc

> Copied from the original design doc (Claude Docs, 2026-10-03, rev 11) so the
> sketch carries its own brief. Implementation decisions and deviations live in
> [`NOTES.md`](NOTES.md). The main one: the doc suggests Vite + TypeScript,
> but this repo needs sketches to run from a `file://` double-click with no
> build step, so the engine is plain classic-script JS with the TS shapes
> kept as JSDoc.

## Vision and intent

Build a procedural generation engine where exploring *is* generating: space only exists once someone opens a door into it, and the resulting map is the record of that expedition.

The tone comes from *House of Leaves* and the Navidson Record: an impossible, shape-shifting interior that is endless but documentable. Being able to chart the unknowable is the point. The finished map should be an artifact worth keeping, printed or digital.

The project has two layers, and this prototype is only about the first:

- **Engine** — a self-contained generation system with a clean API, independent of any game rules or rendering. It should be robust and interesting on its own terms.
- **Application layer** (later) — things built on the engine: a meditative mapping experience, a tabletop/DM map tool, a roguelike survival game (resources, risk, finding a relic and getting back out), a printable art-map generator.

Design the engine so several applications could consume the same data. Do not bend engine logic to serve an unbuilt gameplay idea.

"Dungeon" is used loosely: a cathedral, warehouse, cave system or ant hill all count. Engine code should use neutral terms (see Core concepts).

## Prototype scope

The first pass proves the engine: rectangular spaces, a seed chain, a spatial registry, and a plain renderer to click through. No gameplay.

**In scope**

- Grid of square cells; every space is a set of cells
- Rectangular spaces only for generation (the data model must not assume rectangles)
- One exit type, functionally
- Lazy generation: a space is created only when the user goes through an exit
- Per-step seed chain with fresh entropy, plus reroll / accept / revert
- Spatial registry from day one; placement must never overlap existing cells
- Data model supports loops (graph, not tree), even if loop-making generation is basic or deferred
- Export/import of an expedition record (JSON) that rebuilds the exact map
- Minimal top-down renderer with pan and zoom

**Out of scope for now**

- Gameplay: resources, health, risk, win/lose
- Organic or irregular shapes, internal walls
- Multiple functional exit types
- Final visual style, print/export art output
- Audio or other seed-driven media

## Core concepts and terminology

The engine uses neutral names so any application can relabel them (chamber, cavern, hall, tunnel).

| Term | Meaning |
| --- | --- |
| Cell | One square on an integer grid, addressed by (x, y) |
| Space | A connected set of floor cells with at least one way in. Replaces "room" in engine code |
| Exit | An opening on a space's boundary cell, facing outward. Unresolved until someone goes through it |
| Connection | A bidirectional edge linking two exits on two spaces |
| Spatial registry | Global map of every occupied cell and which space owns it |
| Seed chain | Each space's seed, derived from its parent's seed plus fresh randomness |
| Expedition | One session's full record: root seed, spaces, connections, history |
| Commit | Accepting a generated space into the chain. Before commit it can be rerolled |

**Deterministic vs stochastic, as used here.** A deterministic system gives the same output for the same input; a stochastic one injects randomness. This engine is a hybrid: each generation step injects fresh entropy (stochastic), and that entropy is recorded so every committed space can be rebuilt exactly (deterministic replay).

**Compass directions** are a display and placement convention on the grid. Exits store a facing (N/E/S/W) because placement needs it, but the concept of an exit is direction-agnostic.

## Data model

All engine state is plain, serializable data. The renderer only reads it. Suggested TypeScript shapes, to be refined during implementation:

```typescript
type CellKey = string; // "x,y"
type Facing = 'N' | 'E' | 'S' | 'W';

interface Exit {
  id: string;            // stable within its space, e.g. "e0"
  index: number;         // used in seed derivation
  cell: { x: number; y: number }; // boundary cell it sits on
  facing: Facing;
  kind: string;          // 'standard' for now; reserved for door types later
  connectionId: string | null;    // null = unresolved potential
  tags?: Record<string, unknown>; // pre-resolution metadata for app layers
}

interface Space {
  id: string;
  seed: string;          // this space's committed seed
  parentId: string | null;
  viaExitId: string | null;       // exit on the parent it was opened from
  entropy: string | null;         // fresh random value used at creation
  archetype: string;     // 'chamber' | 'corridor' for now
  cells: CellKey[];      // floor cells, world coordinates
  exits: Exit[];
  depth: number;         // steps from root
  meta: Record<string, unknown>;  // seed-derived extras (palette, mood, etc.)
}

interface Connection {
  id: string;
  a: { spaceId: string; exitId: string };
  b: { spaceId: string; exitId: string };
}

interface Expedition {
  version: 1;
  rootSeed: string;
  params: GenerationParams;       // set from root seed and/or user constraints
  spaces: Record<string, Space>;
  connections: Record<string, Connection>;
  registry: Record<CellKey, string>; // cell -> spaceId (rebuildable from spaces)
  history: HistoryEvent[];        // commits, rerolls, reverts, in order
}
```

Key rules:

- A space is a cell set, not a rectangle. Rectangles are just the first shape generator.
- Connections are graph edges, so one space may connect to many, including already-explored spaces (loops).
- The registry is derived data and can always be rebuilt from `spaces`.
- Exit `kind` and `tags` exist now so later door types (risky, locked, one-way) need no schema change.

## Seed chain specification

Every space gets its own seed from its parent's seed, the exit used, and a fresh random value. The same door can lead somewhere different each time it is opened, yet anything committed is exactly reproducible.

```
seed_child = H(seed_parent || exitIndex || entropy)
```

- **Root:** the expedition starts from a root seed (user-entered or random). It sets global parameters (size ranges, archetype weights, exit-count bias) and generates space 0.
- **H:** a fast non-cryptographic hash (e.g. a 32-bit mix such as murmur-style or xmur3/cyrb53). SHA-256 is unnecessary.
- **Entropy:** a fresh random value drawn at generation time from a non-seeded source (e.g. `crypto.getRandomValues`). This is what keeps unopened doors genuinely unknown.
- **Per-space PRNG:** a space's seed initializes a seeded PRNG (e.g. mulberry32 or sfc32). All of that space's choices (size, exits, archetype, meta) come from it in a fixed order, so the same seed always yields the same space.
- **Derived streams:** other systems (palette, mood, later audio) should derive sub-seeds such as `H(seed || "palette")`, so adding a new consumer never changes existing layouts.

**Lifecycle of a door**

1. User picks an unresolved exit.
2. Engine draws entropy, derives a candidate seed, generates a **candidate** space. Nothing is committed.
3. User can **reroll** (discard, new entropy, new candidate) any number of times.
4. User **accepts**: the space, its connection and its cells are written to the expedition and registry. This is the meaningful act where later apps can attach a cost.
5. **Revert** removes a committed leaf space (and optionally its subtree), freeing its cells and returning the parent exit to unresolved.

**Reconstruction.** The expedition record stores each committed space's `entropy` and `viaExitId`. Replaying from the root recomputes every seed and regenerates the identical map. Losing the record loses that dungeon — by design.

**Version-control framing.** Revert and branching map onto ideas like git: reverting a commit, exploring a branch, discarding it. For the prototype, revert is free (creative mode). Costs belong to the application layer.

## Generation pipeline

One core call does the work: `expand(expedition, spaceId, exitId) -> Candidate`, which proposes a new space that fits against existing cells without committing it.

1. **Derive seed** from parent seed, exit index and fresh entropy; create the space's PRNG.
2. **Pick archetype** (chamber or corridor) from weights in `params`.
3. **Generate shape** in local coordinates. Chambers: random width and height within ranges. Corridors: 1 cell wide, straight or with one bend.
4. **Choose an entry cell** on the new shape whose facing is opposite the parent exit, and translate the shape so the entry sits directly beyond the parent exit.
5. **Check the registry.** If any cell overlaps, try alternatives in a seeded order: other entry positions, shrink the shape, swap archetype. Bound the attempts (e.g. 20).
6. **Fallback** if nothing fits: produce a short dead-end stub, or (later) a loop connection into the adjacent existing space.
7. **Place exits** on free boundary cells, count drawn from the PRNG; skip spots that face directly into occupied cells.
8. **Return the candidate** for preview. `commit(candidate)` writes it to spaces, connections and registry.

**Loops.** The spatial registry is what makes loops possible: when a new exit faces an existing space's wall, or a placement is blocked by one, the engine can connect into it instead of avoiding it. The prototype should keep loops in the data model and implement at least the simple case: an exit opening directly onto an existing space's boundary creates a connection (and an exit there) instead of a new space. Smarter loop-seeking corridors are a later milestone.

**Determinism rule.** Given the same seed and the same registry state, `expand` must return the same candidate. Placement depends on what already exists, so replay must commit spaces in the original order (the history log provides it).

**Constraints.** The core is infinite. Optional caps live in `params` and are enforced by the engine: max spaces, max total cell area, max depth. When a cap is reached, new exits are generated as dead ends. Later, "pressure" (higher dead-end odds with depth) can shape how a run tapers.

## Prototype renderer and interaction

The renderer is a debugging and exploration surface, not the final look: plain lines, tiles and colors drawn programmatically.

- **Map navigation** like a web map: drag to pan, scroll/pinch to zoom, recenter button.
- **Drawing:** floor cells as tiles, walls on boundaries, exits as marked gaps. Unresolved exits are visually distinct and clickable.
- **Open a door:** clicking an unresolved exit shows the candidate space as a ghosted preview with **Accept** and **Reroll** controls.
- **Revert:** select a committed leaf space and remove it.
- **Inspector panel:** selected space's id, seed, entropy, depth, archetype, cell count, exits.
- **Expedition controls:** new expedition (enter or randomize root seed), set caps, export JSON, import JSON and replay.
- **Debug toggles:** grid lines, seed labels, show registry occupancy, highlight the path back to the root.

The renderer must only read engine data and call engine functions; no generation logic in UI code.

## Suggested stack and architecture

TypeScript in the browser: a pure engine package with no DOM dependencies, and a thin web renderer on top. This matches a Claude-friendly web-tech prototyping workflow and keeps the engine portable to any later app.

```
applications (this prototype, DM tool, roguelike, art maps)
        │  call
        ▼
engine API  (expand / commit / revert / export / import)
        │
        ▼
engine core (rng, shapes, placement, expedition)   — no UI imports
```

The engine core never imports UI code; every application, including this prototype, goes through the API.

- **Build:** Vite + TypeScript. React optional for panels; the map itself on Canvas 2D (or PixiJS if performance needs it).
- **Tests:** Vitest. Engine logic is pure, so it is easy to test without a browser.
- **Layout:** `src/engine/` (rng, shapes, placement, expedition, api) and `src/app/` (renderer, controls, inspector).
- **No server.** Everything runs client-side; expeditions save as JSON files.
- **Git from day one,** with a repo ready for Claude Code sessions.

## Milestones and acceptance criteria

Build in this order; each milestone should be usable before the next starts.

1. **Seeds and PRNG.** Hash, entropy source, seeded PRNG, derived sub-streams.
   - Same seed produces the same sequence across runs; unit tests cover it.
2. **Spaces and registry.** Data model, rectangle chamber and corridor generators, spatial registry.
   - Placing a space never overlaps existing cells; registry rebuilds identically from spaces.
3. **Expand and commit.** `expand`, `reroll`, `commit` with placement fallbacks and dead ends.
   - 500 automated random expansions run without overlaps or crashes.
4. **Minimal renderer.** Pan/zoom map, clickable exits, ghosted candidate, Accept/Reroll.
   - A user can explore 20+ spaces by clicking alone.
5. **Record and replay.** Export/import JSON; replay rebuilds the map.
   - An exported expedition re-imports to an identical map (cell-for-cell, seed-for-seed).
6. **Revert and caps.** Revert a leaf space; max spaces / area / depth caps.
   - Reverting frees cells and reopens the parent exit; caps produce dead ends.
7. **Simple loops.** An exit opening onto an existing space's wall connects instead of generating.
   - Connection graph shows at least one cycle in a dense test run.

Keep a short `NOTES.md` of decisions made during implementation, since several questions below are still open.

## Future directions and open questions

These are deliberately out of the prototype but should not be designed out of it.

**Future directions**

- Organic shapes (crescent caverns, blobs, internal walls) as new shape generators on the same cell-set model
- Exit types with implications: risky doors, locked doors, one-way passages, using `Exit.kind` and `tags`
- Pre-resolution hints: a door's look suggests what lies beyond without fixing it
- Seed-driven extras per space: palette, lighting mood, ambient or musical parameters
- Loop-seeking corridors and depth "pressure" that makes the dungeon push back
- Application modes: creative (free reroll/revert) vs survival (reroll and revert cost something)
- Branch and merge semantics borrowed from version control
- Art output: styled print and digital maps as finished artifacts
- Shareable expedition records as a compact string

**Open questions**

- How much should the root seed shape the whole expedition (theme, size ranges, archetype mix)?
- Revert scope: leaf-only, or whole subtrees?
- Should a previewed-but-rejected candidate leave any trace in the history?
- Should a re-opened exit after revert draw new entropy, or remember the old one?
- Can a loop connection be made into a space that has no free exit there (creating one), or only into existing exits?
