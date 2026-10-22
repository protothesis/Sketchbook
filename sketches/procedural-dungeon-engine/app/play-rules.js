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
    // Entropy comes in whole charges; 3 shards make one. A collapse costs
    // one charge per room in the branch.
    shardsPerCharge: 3,
    chargesStart: 2,
    chargesMax: 8,
    shardChance: { chamber: 0.75, corridor: 0.4, stub: 0.5 },
    bigChamberCells: 20,      // chambers this large can hold a second shard
    // Locks come first, keys later: a room's seed only makes it able to
    // hold a key; the walk layer shows that key only while there are more
    // unopened locked doors than keys around (see keyNeeded() in walk/actions.js).
    keyChance: 0.25,
    keyMinDepth: 1,
    lockChance: 0.045,        // at lockMinDepth, rising per level of depth
    lockChancePerDepth: 0.0075,
    lockChanceMax: 0.09,
    lockMinDepth: 3,          // depth of the space the locked door leads out of
    // Doorstones: open a door in any bare wall. About as rare as keys turn out.
    chalkChance: 0.045,
    chalkMinDepth: 2,
    // Jars hold up to 3 hash ghosts; sigil tiles power up with a filled jar.
    jarChance: 1 / 15,
    jarMinDepth: 1,
    jarCapacity: 3,
    stickChance: 1 / 12,      // chalk sticks (3 marks each): semi-rare; you start with one silver
    stickMinDepth: 1,
    chalkColors: ['silver', 'gold', 'crimson', 'teal', 'violet'],
    sigilChance: 0.052,       // ~1 room in 25 (small rooms and the root never get one)
    sigilMinDepth: 1,
    chargesPerRoom: 1,        // collapse price: a flat charge per room in the branch
    // Props: blocks on a half-cell subgrid, stacked in half-cell-ish units
    // (3 units = floor to ceiling), plus flat floor detail.
    propAttempts: 0.32,       // placement attempts per chamber cell
    propAttemptsCorridor: 0.12,
    blockUnit: 1.3 / 3,       // one stacked unit (cells); a 1-unit block hides a crouched figure
    climbMaxUnits: 1,         // a single step up at a time
    climbMaxTop: 1,           // units: never stand higher than one block (head room)
    detailChance: 0.35,
    // Hash ghosts: about 1 room in 14; rooms on cracked (imprinted) floor
    // get a boost that grows with how much of the room is cracked.
    ghostChance: 1 / 14,
    ghostImprintBase: 0.1,
    ghostImprintBoost: 0.3,
    ghostChanceMax: 0.4,
  };

  /** Items lying in a space: [{ id, kind: 'shard'|'key'|'chalk'|'jar', cell }]. */
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
    // Drawn last so adding it never shifted the rolls above.
    if (r.chance(RULES.chalkChance) && space.depth >= RULES.chalkMinDepth) {
      items.push({ id: 'chalk', kind: 'doorstone', cell: spots[(n + 2) % spots.length] }); // id kept from 'door chalk'
    }
    // Drawn after chalk, so neither the chalk nor anything above shifted.
    if (r.chance(RULES.jarChance) && space.depth >= RULES.jarMinDepth) {
      items.push({ id: 'jar', kind: 'jar', cell: spots[(n + 3) % spots.length] });
    }
    // Chalk sticks come after jars (same reason). Each has a seeded colour.
    if (r.chance(RULES.stickChance) && space.depth >= RULES.stickMinDepth) {
      items.push({ id: 'pin', kind: 'chalk', color: r.pick(RULES.chalkColors), cell: spots[(n + 4) % spots.length] }); // id kept from 'map pin'
    }
    return items;
  }

  /**
   * A sigil tile in this space, if it has one: { cell, seed }. Seeded on its
   * own stream; never on a door cell or an item's cell.
   */
  function sigil(space) {
    if (!space.parentId || space.depth < RULES.sigilMinDepth || space.cells.length < 4) return null;
    const r = DE.deriveRng(space.seed, 'sigil');
    if (!r.chance(RULES.sigilChance)) return null;
    const doors = new Set(space.exits.map((e) => DE.key(e.cell.x, e.cell.y)));
    const items = new Set(loot(space).map((it) => DE.key(it.cell.x, it.cell.y)));
    const free = space.cells.slice().sort().filter((k) => !doors.has(k) && !items.has(k));
    if (!free.length) return null;
    return { cell: DE.parseKey(free[Math.floor(r.next() * free.length)]), seed: DE.hash(space.seed, 'sigil') };
  }

  /**
   * Props in a space, on a 2x2 subgrid per cell (half-cell units), in
   * absolute grid units:
   *   blocks:  [{ x0, y0, x1, y1, units }]   solid; `units` stacked half-cell
   *            cubes tall (3 = floor to ceiling, a column). Collide, cast
   *            shadows, and (below a column) can be climbed.
   *   details: [{ x0, y0, x1, y1, h, shade }]   flat floor dressing only
   *
   * Shapes: single (1 sub), double (2x1), big (2x2), and in chambers short
   * rows of singles (partitions, sometimes with a gap). Anything may sit
   * against a wall, but nothing goes on a cell with a door or an item.
   * Each placement is kept only if every free sub-cell stays reachable
   * (4-neighbour flood fill), so a 0.5-cell gap is always a real passage.
   * Draws per attempt are fixed, so rerolling a room never shifts another.
   *
   * The layout only ever sees the room's original doors. Doors added later
   * (drawn with chalk, or made by a loop) can't reshuffle it: they just
   * clear any block on their own cell. Removing a block can never trap
   * anyone, while a reshuffle could drop a block onto the figure.
   */
  function props(space) {
    const r = DE.deriveRng(space.seed, 'props');
    const later = (e) => e.loopMade || (e.tags && e.tags.includes('carved'));
    const doorCells = new Set(space.exits.filter((e) => !later(e)).map((e) => DE.key(e.cell.x, e.cell.y)));
    const laterCells = space.exits.filter(later).map((e) => e.cell);
    const lootCells = new Set(loot(space).map((it) => DE.key(it.cell.x, it.cell.y)));
    const sg = sigil(space); // keep a sigil tile clear of blocks
    if (sg) lootCells.add(DE.key(sg.cell.x, sg.cell.y));
    const chamber = space.archetype === 'chamber' && !space.deadEnd;
    const subs = new Set(), reserved = new Set(), blocked = new Set();
    const sk = (x, y) => x + ',' + y;
    for (const k of space.cells) {
      const c = DE.parseKey(k);
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
        const s = sk(c.x * 2 + i, c.y * 2 + j);
        subs.add(s);
        if (doorCells.has(k) || lootCells.has(k)) reserved.add(s);
      }
    }
    const subList = Array.from(subs).sort();
    const start = subList.find((s) => reserved.has(s)) || subList[0];

    const allReachable = () => {
      const seen = new Set([start]);
      const q = [start];
      while (q.length) {
        const [x, y] = q.pop().split(',').map(Number);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = sk(x + dx, y + dy);
          if (subs.has(n) && !blocked.has(n) && !seen.has(n)) { seen.add(n); q.push(n); }
        }
      }
      return seen.size === subs.size - blocked.size;
    };

    const blocks = [];
    const attempts = Math.max(1, Math.round(space.cells.length * (chamber ? RULES.propAttempts : RULES.propAttemptsCorridor)));
    for (let a = 0; a < attempts; a++) {
      // Fixed draws per attempt.
      const kindRoll = r.next(), hRoll = r.next(), pick = r.next(), dirRoll = r.next(), lenRoll = r.next(), gapRoll = r.next();
      const [ax, ay] = subList[Math.floor(pick * subList.length)].split(',').map(Number);
      const horiz = dirRoll < 0.5;
      const kind = !chamber ? 'single'
        : kindRoll < 0.3 ? 'single' : kindRoll < 0.48 ? 'double' : kindRoll < 0.78 ? 'big' : 'row';
      let units = hRoll < 0.55 ? 1 : hRoll < 0.85 ? 2 : 3;
      let shape;
      if (kind === 'single') shape = [[0, 0]];
      else if (kind === 'double') shape = horiz ? [[0, 0], [1, 0]] : [[0, 0], [0, 1]];
      else if (kind === 'big') shape = [[0, 0], [1, 0], [0, 1], [1, 1]];
      else {
        units = hRoll < 0.6 ? 1 : 2;
        const len = 3 + Math.floor(lenRoll * 4);
        const gap = gapRoll < 0.4 ? 1 + Math.floor((gapRoll / 0.4) * (len - 2)) : -1;
        shape = [];
        for (let i = 0; i < len; i++) if (i !== gap) shape.push(horiz ? [i, 0] : [0, i]);
      }
      const cells = shape.map(([dx, dy]) => sk(ax + dx, ay + dy));
      if (cells.some((s) => !subs.has(s) || blocked.has(s) || reserved.has(s))) continue;
      cells.forEach((s) => blocked.add(s));
      if (!allReachable()) { cells.forEach((s) => blocked.delete(s)); continue; }
      const rect = (list) => {
        const xs = list.map((s) => +s.split(',')[0]), ys = list.map((s) => +s.split(',')[1]);
        return { x0: Math.min(...xs) / 2, y0: Math.min(...ys) / 2, x1: (Math.max(...xs) + 1) / 2, y1: (Math.max(...ys) + 1) / 2, units };
      };
      // Rows stay modular (one cube per sub) so they read as built pieces.
      if (kind === 'row') cells.forEach((s) => blocks.push(rect([s])));
      else blocks.push(rect(cells));
    }

    // Clear blocks off cells that gained a door after the room was made.
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if (laterCells.some((c) => b.x0 < c.x + 1 && b.x1 > c.x && b.y0 < c.y + 1 && b.y1 > c.y)) blocks.splice(i, 1);
    }

    // Floor detail on its own stream, skipping blocked sub-cells.
    const d = DE.deriveRng(space.seed, 'detail');
    const details = [];
    for (const k of space.cells.slice().sort()) {
      const c = DE.parseKey(k);
      const n = d.next() < RULES.detailChance ? d.int(1, 3) : 0;
      for (let i = 0; i < 3; i++) {
        const u = d.next(), v = d.next(), dw = d.range(0.08, 0.3), dd = d.range(0.06, 0.22), sh = d.next();
        if (i >= n) continue;
        const x0 = c.x + 0.06 + u * (0.88 - dw), y0 = c.y + 0.06 + v * (0.88 - dd);
        if (blocked.has(sk(Math.floor((x0 + dw / 2) * 2), Math.floor((y0 + dd / 2) * 2)))) continue;
        details.push({ x0, y0, x1: x0 + dw, y1: y0 + dd, h: 0.012 + sh * 0.02, shade: sh });
      }
    }
    return { blocks, details };
  }

  /**
   * Does a hash ghost start in this space? Returns its cell, or null.
   * Seeded per space; a room's imprint is fixed once it exists (traces only
   * ever form where no live room stands), so this is stable for a space.
   */
  function ghostSpawn(space, exp) {
    if (!space.parentId) return null;
    const r = DE.deriveRng(space.seed, 'ghost');
    const roll = r.next(), pick = r.next();
    let cracked = 0;
    for (const k of space.cells) if (DE.imprintAt(exp, k).length) cracked++;
    const p = Math.min(RULES.ghostChanceMax, RULES.ghostChance +
      (cracked ? RULES.ghostImprintBase + RULES.ghostImprintBoost * cracked / space.cells.length : 0));
    if (roll >= p) return null;
    const cells = space.cells.slice().sort();
    return DE.parseKey(cells[Math.floor(pick * cells.length)]);
  }

  /** Is this unresolved exit a locked door? Seeded per exit, never the entry. */
  function isLocked(space, exit) {
    return !exit.connectionId && lockedBySeed(space, exit);
  }

  /** Was this exit generated locked (whether or not it has been opened since)? */
  function lockedBySeed(space, exit) {
    if (exit.index === 0 && space.parentId) return false;
    if (exit.tags && exit.tags.includes('carved')) return false; // drawn doors are never locked
    if (space.depth < RULES.lockMinDepth) return false;
    const p = Math.min(RULES.lockChanceMax,
      RULES.lockChance + (space.depth - RULES.lockMinDepth) * RULES.lockChancePerDepth);
    return DE.deriveRng(space.seed, 'lock|' + exit.index).chance(p);
  }

  /**
   * Is this the first room past a locked door? Worked out from seeds alone
   * (the door it was opened through was generated locked), so any client
   * can tell, and replays agree.
   */
  function pastLock(exp, space) {
    const parent = space.parentId && exp.spaces[space.parentId];
    if (!parent) return false;
    const exit = parent.exits.find((e) => e.id === space.viaExitId);
    return !!exit && lockedBySeed(parent, exit);
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

  /**
   * A room is committed (fixed) once a door out of it has ever been opened,
   * or a loop has opened a door into it. Until then it's provisional and can
   * be rerolled. Committing is for good: rerolling the room beyond doesn't
   * undo it. Derived from the expedition's history (space ids are never
   * reused), so it needs no saved state. The root is always committed.
   */
  const openedFrom = new WeakMap(); // exp -> { n: history length, ids: Set of spaces a door was opened from }
  function committed(exp, space) {
    if (!space.parentId) return true;
    let c = openedFrom.get(exp);
    if (!c || c.n !== exp.history.length) {
      c = { n: exp.history.length, ids: new Set() };
      for (const ev of exp.history) if (ev.type === 'commit') c.ids.add(ev.parentId);
      openedFrom.set(exp, c);
    }
    return c.ids.has(space.id) || space.exits.some((e) => e !== space.exits[0] && e.connectionId);
  }

  /** The provisional room through this door, if closing it would reroll one. */
  function rerollThrough(exp, spaceId, exit) {
    const child = childThrough(exp, spaceId, exit);
    return child && !committed(exp, child) ? child : null;
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
    // Flat: one charge per room in the branch, whatever its size.
    const charges = spaces.length * RULES.chargesPerRoom;
    return { rooms: spaces.length, cells, cost: charges, charges };
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

  Object.assign(DP, { RULES, loot, sigil, props, ghostSpawn, isLocked, lockedBySeed, pastLock, childThrough, committed, rerollThrough, branch, collapseCost, collapse, seedChain });
})(typeof window !== 'undefined' ? window : globalThis);
