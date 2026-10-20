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
    entropyStart: 30,
    entropyMax: 100,
    shardEntropy: 10,
    shardChance: { chamber: 0.3, corridor: 0.12, stub: 0.25 },
    keyChance: 1 / 30,
    keyMinDepth: 3,
    lockChance: 0.1,
    lockMinDepth: 4,          // depth of the space the locked door leads out of
    collapsePerCell: 1,
    collapsePerSpace: 2,
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
    if (r.chance(chance)) items.push({ id: 'shard', kind: 'shard', cell: spots[0] });
    if (space.depth >= RULES.keyMinDepth && r.chance(RULES.keyChance)) {
      items.push({ id: 'key', kind: 'key', cell: spots[1 % spots.length] });
    }
    return items;
  }

  /** Is this unresolved exit a locked door? Seeded per exit, never the entry. */
  function isLocked(space, exit) {
    if (exit.connectionId || exit.index === 0 && space.parentId) return false;
    if (space.depth < RULES.lockMinDepth) return false;
    return DE.deriveRng(space.seed, 'lock|' + exit.index).chance(RULES.lockChance);
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
    return { rooms: spaces.length, cells, cost: cells * RULES.collapsePerCell + spaces.length * RULES.collapsePerSpace };
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

  Object.assign(DP, { RULES, loot, isLocked, childThrough, branch, collapseCost, collapse, seedChain });
})(typeof window !== 'undefined' ? window : globalThis);
