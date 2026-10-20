// Walk mode's game rules: loot, locked doors and the cost of collapsing a
// branch. Pure data + engine calls, no DOM or three.js, so it also loads
// under Node.
//
// Everything placed in the world is derived from a space's seed on its own
// named stream (like `meta`), so it never shifts layouts and a replayed
// expedition holds exactly the same shards, keys and locks. The engine
// itself stays rule-free; this layer only reads its data.
(function (global) {
  'use strict';

  const DE = global.DungeonEngine;
  const DP = (global.DungeonPlay = global.DungeonPlay || {});

  // Tunables. PLAY.md has the reasoning ("moderate" pacing).
  const RULES = {
    // Entropy comes in whole charges; 3 shards make one. A collapse spends
    // whole charges (rounded up), so a partial need still burns a charge.
    shardsPerCharge: 3,
    chargeEntropy: 15,        // collapse cost one charge covers
    chargesStart: 2,
    chargesMax: 8,
    shardChance: { chamber: 0.75, corridor: 0.4, stub: 0.5 },
    bigChamberCells: 20,      // chambers this large can hold a second shard
    // Locks come first, keys later: a room's seed only makes it able to
    // hold a key; the walk layer shows that key only while there are more
    // unopened locked doors than keys around (see play.js keyNeeded()).
    keyChance: 0.25,
    keyMinDepth: 1,
    lockChance: 0.045,        // at lockMinDepth, rising per level of depth
    lockChancePerDepth: 0.0075,
    lockChanceMax: 0.09,
    lockMinDepth: 3,          // depth of the space the locked door leads out of
    collapsePerCell: 1,
    collapsePerSpace: 2,
    // Props (cells): solid blocks to hide behind, and flat floor detail.
    fullBlockChance: 0.18,    // interior chamber cells only
    smallBlockChance: 0.16,   // chamber cells against a wall
    smallBlockChanceCorridor: 0.1,
    blockLow: 0.42,           // hides a crouched figure (~0.35 tall), not a standing one
    blockTall: 0.85,
    detailChance: 0.35,
  };

  /** Items lying in a space: [{ id, kind: 'shard'|'key', cell }]. */
  function loot(space) {
    if (!space.parentId) return [];
    const r = DE.deriveRng(space.seed, 'loot');
    const cells = space.cells.map(DE.parseKey);
    const entry = space.exits[0] && space.exits[0].cell;
    const spots = cells.length > 1 && entry
      ? r.shuffle(cells.filter((c) => c.x !== entry.x || c.y !== entry.y))
      : cells.slice();
    const items = [];
    const chance = space.deadEnd ? RULES.shardChance.stub : RULES.shardChance[space.archetype] || 0;
    let n = 0;
    if (r.chance(chance)) n++;
    if (space.cells.length >= RULES.bigChamberCells && r.chance(chance * 0.6)) n++;
    for (let i = 0; i < n; i++) items.push({ id: 'shard' + i, kind: 'shard', cell: spots[i % spots.length] });
    if (space.depth >= RULES.keyMinDepth && r.chance(RULES.keyChance)) {
      items.push({ id: 'key', kind: 'key', cell: spots[n % spots.length] });
    }
    return items;
  }

  /**
   * Props in a space, in absolute grid units:
   *   blocks:  [{ x0, y0, x1, y1, h }]   solid, cast shadows, collide
   *   details: [{ x0, y0, x1, y1, h, shade }]   flat floor dressing only
   *
   * Every cell draws the same fixed run of random numbers whether or not
   * anything gets placed. A constraint that changes later (a loop door
   * appears) can only remove that cell's prop, never shift the others.
   * Full-cell blocks only go on interior cells (all four neighbors in the
   * space), never two side by side, so they can't wall off a doorway or a
   * pocket of floor. Everything else is subgrid and hugs a wall.
   */
  function props(space) {
    const r = DE.deriveRng(space.seed, 'props');
    const own = new Set(space.cells);
    const doorCells = new Set(space.exits.map((e) => DE.key(e.cell.x, e.cell.y)));
    const lootCells = new Set(loot(space).map((it) => DE.key(it.cell.x, it.cell.y)));
    const chamber = space.archetype === 'chamber' && !space.deadEnd;
    const blocks = [], details = [], full = new Set();
    const cells = space.cells.slice().sort();
    for (const k of cells) {
      const c = DE.parseKey(k);
      // Fixed draws per cell.
      const roll = r.next(), roll2 = r.next(), side = r.int(0, 3), along = r.next();
      const w = r.range(0.18, 0.34), d = r.range(0.18, 0.5), tall = r.next() < 0.4;
      const nDetail = r.next() < RULES.detailChance ? r.int(1, 3) : 0;
      const dets = [];
      for (let i = 0; i < 3; i++) dets.push([r.next(), r.next(), r.range(0.08, 0.3), r.range(0.06, 0.22), r.next()]);

      for (let i = 0; i < nDetail; i++) {
        const [u, v, dw, dd, sh] = dets[i];
        const x0 = c.x + 0.06 + u * (0.88 - dw), y0 = c.y + 0.06 + v * (0.88 - dd);
        details.push({ x0, y0, x1: x0 + dw, y1: y0 + dd, h: 0.012 + sh * 0.02, shade: sh });
      }
      if (doorCells.has(k) || lootCells.has(k)) continue;

      const nb = DE.FACINGS.map((f) => { const n = DE.step(c, f); return own.has(DE.key(n.x, n.y)); });
      const interior = nb.every(Boolean);
      const besideFull = DE.FACINGS.some((f) => { const n = DE.step(c, f); return full.has(DE.key(n.x, n.y)); });
      const h = tall ? RULES.blockTall : RULES.blockLow;
      if (chamber && interior && !besideFull && roll < RULES.fullBlockChance) {
        full.add(k);
        const inset = 0.08;
        blocks.push({ x0: c.x + inset, y0: c.y + inset, x1: c.x + 1 - inset, y1: c.y + 1 - inset, h });
        continue;
      }
      const chance = chamber ? RULES.smallBlockChance : RULES.smallBlockChanceCorridor;
      if (roll2 >= chance) continue;
      // Hug one of this cell's outer walls (a side with no neighbor in the space).
      const walls = DE.FACINGS.filter((f, i) => !nb[i]);
      if (!walls.length) continue;
      const f = walls[side % walls.length];
      const t = 0.08; // wall inset
      const a = 0.1 + along * (0.8 - w);
      let b;
      if (f === 'N') b = { x0: c.x + a, y0: c.y + t, x1: c.x + a + w, y1: c.y + t + d };
      else if (f === 'S') b = { x0: c.x + a, y0: c.y + 1 - t - d, x1: c.x + a + w, y1: c.y + 1 - t };
      else if (f === 'W') b = { x0: c.x + t, y0: c.y + a, x1: c.x + t + d, y1: c.y + a + w };
      else b = { x0: c.x + 1 - t - d, y0: c.y + a, x1: c.x + 1 - t, y1: c.y + a + w };
      // Corridors stay passable: keep their props shallow.
      if (!chamber) {
        if (f === 'N' || f === 'S') { if (f === 'N') b.y1 = b.y0 + Math.min(d, 0.24); else b.y0 = b.y1 - Math.min(d, 0.24); }
        else if (f === 'W') b.x1 = b.x0 + Math.min(d, 0.24); else b.x0 = b.x1 - Math.min(d, 0.24);
      }
      b.h = h;
      blocks.push(b);
    }
    return { blocks, details };
  }

  /** Is this unresolved exit a locked door? Seeded per exit, never the entry. */
  function isLocked(space, exit) {
    if (exit.connectionId || exit.index === 0 && space.parentId) return false;
    if (space.depth < RULES.lockMinDepth) return false;
    const p = Math.min(RULES.lockChanceMax,
      RULES.lockChance + (space.depth - RULES.lockMinDepth) * RULES.lockChancePerDepth);
    return DE.deriveRng(space.seed, 'lock|' + exit.index).chance(p);
  }

  /** The space a door opened into, if it is that space's way in from here. */
  function childThrough(exp, spaceId, exit) {
    if (!exit.connectionId) return null;
    const c = exp.connections[exit.connectionId];
    if (c.loop) return null;
    const other = c.a.spaceId === spaceId ? c.b : c.a;
    const sp = exp.spaces[other.spaceId];
    return sp && sp.parentId === spaceId && sp.viaExitId === exit.id ? sp : null;
  }

  /** Every space at or beyond `spaceId` in the generation tree, deepest first. */
  function branch(exp, spaceId) {
    const kids = {};
    for (const id in exp.spaces) {
      const p = exp.spaces[id].parentId;
      if (p) (kids[p] = kids[p] || []).push(id);
    }
    const out = [];
    const walk = (id) => { out.push(exp.spaces[id]); (kids[id] || []).forEach(walk); };
    walk(spaceId);
    return out.sort((a, b) => b.depth - a.depth);
  }

  function collapseCost(spaces) {
    const cells = spaces.reduce((n, s) => n + s.cells.length, 0);
    const cost = cells * RULES.collapsePerCell + spaces.length * RULES.collapsePerSpace;
    return { rooms: spaces.length, cells, cost, charges: Math.ceil(cost / RULES.chargeEntropy) };
  }

  /** Revert a whole branch, deepest first. History records each revert. */
  function collapse(exp, spaceId) {
    const spaces = branch(exp, spaceId);
    for (const s of spaces) DE.revert(exp, s.id);
    return spaces;
  }

  /** Root-to-space seed chain, for the level-complete screen. */
  function seedChain(exp, spaceId) {
    return DE.pathToRoot(exp, spaceId).reverse().map((id) => {
      const s = exp.spaces[id];
      const parent = s.parentId && exp.spaces[s.parentId];
      const exit = parent && parent.exits.find((e) => e.id === s.viaExitId);
      return {
        id, seed: s.seed, depth: s.depth, archetype: s.deadEnd ? 'dead end' : s.archetype,
        mood: s.meta.mood,
        parentSeed: parent ? parent.seed : null, exitIndex: exit ? exit.index : null, entropy: s.entropy,
      };
    });
  }

  Object.assign(DP, { RULES, loot, props, isLocked, childThrough, branch, collapseCost, collapse, seedChain });
})(typeof window !== 'undefined' ? window : globalThis);
