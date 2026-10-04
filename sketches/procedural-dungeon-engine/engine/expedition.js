// The engine core: expeditions, expand / commit / revert, replay.
//
// All state is plain serializable data (see the JSDoc shapes below); the
// renderer only reads it and calls these functions. Shapes, as in the design
// doc:
//
//   Exit       { id, index, cell:{x,y}, facing:'N'|'E'|'S'|'W', kind,
//                connectionId|null, loopMade?, tags? }
//   Space      { id, seed, parentId, viaExitId, entropy, archetype,
//                cells: "x,y"[], exits: Exit[], depth, deadEnd, meta,
//                nextExitIndex }
//   Connection { id, a:{spaceId,exitId}, b:{spaceId,exitId}, loop }
//   Expedition { version:1, rootSeed, params, spaces, connections,
//                registry: { "x,y": spaceId }, history: Event[], counters }
//   Event      { type:'commit', parentId, viaExitId, entropy, loop? }
//            | { type:'revert', spaceId }
//            | { type:'caps', caps }
//
// Determinism rule: same seed + same registry state => same candidate. Replay
// re-applies `history` in order from the root, which reproduces every seed,
// id and cell exactly.
(function (global) {
  'use strict';

  const DE = (global.DungeonEngine = global.DungeonEngine || {});
  const { hash, createRng, deriveRng, drawEntropy } = DE;
  const { OPPOSITE, key, parseKey, step } = DE;

  const MOODS = ['still', 'damp', 'humming', 'cold', 'echoing', 'dusty', 'breathing', 'tilted', 'warm', 'hollow'];

  /** Global generation parameters, set by the root seed (caps by the user). */
  function deriveParams(rootSeed) {
    const r = deriveRng(rootSeed, 'params');
    return {
      chamberMin: r.int(2, 3),
      chamberMax: r.int(5, 8),
      corridorMin: 3,
      corridorMax: r.int(6, 10),
      corridorWeight: +r.range(0.3, 0.55).toFixed(3),
      exitBias: +r.range(1.2, 2.6).toFixed(3),
      loopChance: +r.range(0.25, 0.5).toFixed(3),
      maxAttempts: 20,
      maxSpaces: null,
      maxArea: null,
      maxDepth: null,
    };
  }

  function createExpedition(rootSeed, caps, paramsOverride) {
    const exp = {
      version: 1,
      rootSeed: String(rootSeed),
      params: paramsOverride ? Object.assign({}, paramsOverride) : deriveParams(rootSeed),
      spaces: {},
      connections: {},
      registry: {},
      history: [],
      counters: { space: 0, connection: 0 },
    };
    // Space 0: a chamber at the origin, seeded straight from the root seed.
    const seed = hash(exp.rootSeed, 'root');
    const rng = createRng(seed);
    const shape = DE.chamberShape(rng, exp.params);
    const placed = DE.placeShape(shape, { x: 0, y: 0 }, 'N');
    const space = buildSpace(exp, rng, {
      id: 's0', seed, parentId: null, viaExitId: null, entropy: null, depth: 0,
      placed, entry: null, deadEnd: false, minExits: 2,
    });
    writeSpace(exp, space);
    exp.counters.space = 1;
    // Caps go through history so replay sees them change at the right moment.
    if (caps && (caps.maxSpaces || caps.maxArea || caps.maxDepth)) setCaps(exp, caps);
    return exp;
  }

  // ---------------------------------------------------------------------------
  // Space construction

  function exitSlotOk(exp, rng, ownSet, slot, forbidKey) {
    const b = step(slot.cell, slot.facing);
    const bk = key(b.x, b.y);
    if (ownSet.has(bk) || bk === forbidKey) return false;
    // Facing into an existing space: keep it only sometimes, as a loop door.
    if (exp.registry[bk] !== undefined) return rng.chance(exp.params.loopChance);
    return true;
  }

  function buildSpace(exp, rng, o) {
    const cells = o.placed.cells.map((c) => key(c.x, c.y));
    const ownSet = new Set(cells);
    const space = {
      id: o.id,
      seed: o.seed,
      parentId: o.parentId,
      viaExitId: o.viaExitId,
      entropy: o.entropy,
      archetype: o.placed.archetype,
      cells,
      exits: [],
      depth: o.depth,
      deadEnd: !!o.deadEnd,
      meta: {},
      nextExitIndex: 0,
    };
    const usedCells = new Set();
    const addExit = (cell, facing) => {
      const ex = {
        id: 'e' + space.nextExitIndex,
        index: space.nextExitIndex,
        cell: { x: cell.x, y: cell.y },
        facing,
        kind: 'standard',
        connectionId: null,
      };
      space.nextExitIndex++;
      space.exits.push(ex);
      usedCells.add(key(cell.x, cell.y));
      return ex;
    };

    // Entry exit (e0) faces back at the parent exit it was opened from.
    let forbid = null;
    if (o.entry) {
      addExit(o.entry.cell, o.entry.facing);
      const back = step(o.entry.cell, o.entry.facing);
      forbid = key(back.x, back.y);
    }

    if (!space.deadEnd) {
      // Corridors carry on from their far tip.
      if (o.placed.end) {
        const slot = o.placed.end;
        if (!usedCells.has(key(slot.cell.x, slot.cell.y)) &&
            exitSlotOk(exp, rng, ownSet, slot, forbid)) {
          addExit(slot.cell, slot.facing);
        }
      }
      let count;
      if (space.archetype === 'chamber') {
        count = 1 + Math.floor(rng.next() * exp.params.exitBias * 1.5);
      } else if (space.archetype === 'corridor') {
        count = rng.chance(0.2) ? 1 : 0;
      } else {
        count = 0;
      }
      if (o.minExits) count = Math.max(count, o.minExits);
      const slots = rng.shuffle(DE.boundarySlots(cells));
      for (const slot of slots) {
        if (count <= 0) break;
        if (usedCells.has(key(slot.cell.x, slot.cell.y))) continue;
        if (!exitSlotOk(exp, rng, ownSet, slot, forbid)) continue;
        addExit(slot.cell, slot.facing);
        count--;
      }
    }

    // Seed-derived extras on their own stream, so they never shift layouts.
    const m = deriveRng(space.seed, 'meta');
    space.meta = { hue: m.int(0, 359), mood: m.pick(MOODS) };
    return space;
  }

  function writeSpace(exp, space) {
    exp.spaces[space.id] = space;
    for (const k of space.cells) exp.registry[k] = space.id;
  }

  // ---------------------------------------------------------------------------
  // Placement

  function fits(exp, placed) {
    for (const c of placed.cells) {
      if (exp.registry[key(c.x, c.y)] !== undefined) return false;
    }
    return true;
  }

  /** Seeded sequence of alternative shapes to try when the first overlaps. */
  function attemptShapes(rng, params, archetype) {
    const out = [];
    const max = params.maxAttempts;
    const chamberTries = (w, d) => {
      const offsets = rng.shuffle(Array.from({ length: w }, (_, i) => i));
      for (const offset of offsets.slice(0, 3)) out.push(DE.chamberShape(rng, params, { w, d, offset }));
    };
    const corridorTries = (len) => {
      const bendMax = Math.max(0, len - 2);
      out.push(DE.corridorShape(rng, params, { len, bend: 0 }));
      if (bendMax >= 1) {
        const bend = rng.int(1, bendMax);
        out.push(DE.corridorShape(rng, params, { len, bend, side: 1 }));
        out.push(DE.corridorShape(rng, params, { len, bend, side: -1 }));
      }
    };
    if (archetype === 'chamber') {
      const base = DE.chamberShape(rng, params);
      out.push(base);
      let { w, d } = base.dims;
      chamberTries(w, d);
      while (out.length < max - 4 && (w > 2 || d > 2)) {
        if (w >= d) w--; else d--;
        chamberTries(w, d);
      }
      corridorTries(params.corridorMin);
    } else {
      const base = DE.corridorShape(rng, params);
      out.push(base);
      let len = base.dims.len;
      while (out.length < max - 3 && len >= params.corridorMin) {
        corridorTries(len);
        len -= 2;
      }
      chamberTries(2, 2);
    }
    return out.slice(0, max);
  }

  function capsReached(exp, depth) {
    const p = exp.params;
    if (p.maxSpaces && Object.keys(exp.spaces).length >= p.maxSpaces) return true;
    if (p.maxDepth && depth > p.maxDepth) return true;
    if (p.maxArea && Object.keys(exp.registry).length >= p.maxArea) return true;
    return false;
  }

  // ---------------------------------------------------------------------------
  // Public API

  /**
   * Propose what lies beyond an unresolved exit, without committing it.
   * Returns { type:'space', ... } or, when the exit opens straight onto an
   * existing space, { type:'loop', ... }.
   */
  function expand(exp, spaceId, exitId, entropy) {
    const parent = exp.spaces[spaceId];
    if (!parent) throw new Error('No space ' + spaceId);
    const exit = parent.exits.find((e) => e.id === exitId);
    if (!exit) throw new Error('No exit ' + exitId + ' on ' + spaceId);
    if (exit.connectionId) throw new Error('Exit ' + spaceId + '/' + exitId + ' is already resolved');

    const beyond = step(exit.cell, exit.facing);
    const bk = key(beyond.x, beyond.y);
    const facingBack = OPPOSITE[exit.facing];

    const occupant = exp.registry[bk];
    if (occupant !== undefined) {
      const target = exp.spaces[occupant];
      const existing = target.exits.find((e) =>
        !e.connectionId && e.facing === facingBack && e.cell.x === beyond.x && e.cell.y === beyond.y);
      return {
        type: 'loop', parentId: spaceId, viaExitId: exitId, entropy: null,
        targetId: occupant, cell: beyond, facing: facingBack,
        existingExitId: existing ? existing.id : null,
      };
    }

    const ent = entropy || drawEntropy();
    const seed = hash(parent.seed, exit.index, ent);
    const rng = createRng(seed);
    const depth = parent.depth + 1;
    const p = exp.params;

    let placed = null;
    let deadEnd = false;
    if (capsReached(exp, depth)) {
      placed = DE.placeShape(DE.stubShape(), beyond, exit.facing);
      deadEnd = true;
    } else {
      const archetype = rng.chance(p.corridorWeight) ? 'corridor' : 'chamber';
      for (const shape of attemptShapes(rng, p, archetype)) {
        const candidate = DE.placeShape(shape, beyond, exit.facing);
        if (fits(exp, candidate)) { placed = candidate; break; }
      }
      if (!placed) {
        // Nothing fits: a one-cell dead end (the beyond cell is known free).
        placed = DE.placeShape(DE.stubShape(), beyond, exit.facing);
        deadEnd = true;
      }
    }

    const space = buildSpace(exp, rng, {
      id: 's' + exp.counters.space, seed, parentId: spaceId, viaExitId: exitId,
      entropy: ent, depth, placed, deadEnd,
      entry: { cell: beyond, facing: facingBack },
    });
    return { type: 'space', parentId: spaceId, viaExitId: exitId, entropy: ent, space };
  }

  function connect(exp, a, b, loop) {
    const id = 'c' + exp.counters.connection++;
    exp.connections[id] = { id, a, b, loop: !!loop };
    return id;
  }

  function getExit(exp, spaceId, exitId) {
    const s = exp.spaces[spaceId];
    return s && s.exits.find((e) => e.id === exitId);
  }

  /** Accept a candidate: write it to spaces, connections, registry, history. */
  function commit(exp, cand) {
    const parentExit = getExit(exp, cand.parentId, cand.viaExitId);
    if (!parentExit || parentExit.connectionId) throw new Error('Stale candidate: exit no longer open');

    if (cand.type === 'loop') {
      const target = exp.spaces[cand.targetId];
      let tExit = cand.existingExitId && target.exits.find((e) => e.id === cand.existingExitId);
      if (!tExit) {
        tExit = {
          id: 'e' + target.nextExitIndex, index: target.nextExitIndex,
          cell: { x: cand.cell.x, y: cand.cell.y }, facing: cand.facing,
          kind: 'standard', connectionId: null, loopMade: true,
        };
        target.nextExitIndex++;
        target.exits.push(tExit);
      }
      const cid = connect(exp,
        { spaceId: cand.parentId, exitId: cand.viaExitId },
        { spaceId: target.id, exitId: tExit.id }, true);
      parentExit.connectionId = cid;
      tExit.connectionId = cid;
      exp.history.push({ type: 'commit', parentId: cand.parentId, viaExitId: cand.viaExitId, entropy: null, loop: true });
      return null;
    }

    const space = cand.space;
    if (space.id !== 's' + exp.counters.space) throw new Error('Stale candidate: expedition changed');
    for (const k of space.cells) {
      if (exp.registry[k] !== undefined) throw new Error('Stale candidate: cell ' + k + ' now occupied');
    }
    writeSpace(exp, space);
    exp.counters.space++;
    const cid = connect(exp,
      { spaceId: cand.parentId, exitId: cand.viaExitId },
      { spaceId: space.id, exitId: space.exits[0].id }, false);
    parentExit.connectionId = cid;
    space.exits[0].connectionId = cid;
    exp.history.push({ type: 'commit', parentId: cand.parentId, viaExitId: cand.viaExitId, entropy: cand.entropy });
    return space.id;
  }

  /** A space can be reverted if it isn't the root and has no child spaces. */
  function canRevert(exp, spaceId) {
    if (!exp.spaces[spaceId] || exp.spaces[spaceId].parentId === null) return false;
    for (const id in exp.spaces) if (exp.spaces[id].parentId === spaceId) return false;
    return true;
  }

  /** Remove a leaf space: frees its cells and reopens the parent exit. */
  function revert(exp, spaceId) {
    if (!canRevert(exp, spaceId)) throw new Error('Cannot revert ' + spaceId);
    const space = exp.spaces[spaceId];
    for (const ex of space.exits) {
      if (!ex.connectionId) continue;
      const conn = exp.connections[ex.connectionId];
      const other = conn.a.spaceId === spaceId ? conn.b : conn.a;
      const os = exp.spaces[other.spaceId];
      if (os) {
        const oe = os.exits.find((e) => e.id === other.exitId);
        if (oe.loopMade) os.exits = os.exits.filter((e) => e !== oe);
        else oe.connectionId = null;
      }
      delete exp.connections[conn.id];
    }
    for (const k of space.cells) delete exp.registry[k];
    delete exp.spaces[spaceId];
    exp.history.push({ type: 'revert', spaceId });
  }

  function setCaps(exp, caps) {
    exp.params.maxSpaces = caps.maxSpaces || null;
    exp.params.maxArea = caps.maxArea || null;
    exp.params.maxDepth = caps.maxDepth || null;
    exp.history.push({ type: 'caps', caps: { maxSpaces: exp.params.maxSpaces, maxArea: exp.params.maxArea, maxDepth: exp.params.maxDepth } });
  }

  // ---------------------------------------------------------------------------
  // Record and replay

  function rebuildRegistry(exp) {
    const reg = {};
    for (const id in exp.spaces) for (const k of exp.spaces[id].cells) reg[k] = id;
    return reg;
  }

  function initialParams(record) {
    // Params as they were at the start; caps are re-applied from history.
    const p = Object.assign({}, record.params);
    p.maxSpaces = null; p.maxArea = null; p.maxDepth = null;
    return p;
  }

  /** Rebuild an expedition from its root seed + history alone. */
  function replay(record) {
    const exp = createExpedition(record.rootSeed, null, initialParams(record));
    for (const ev of record.history) {
      if (ev.type === 'commit') {
        const cand = expand(exp, ev.parentId, ev.viaExitId, ev.entropy || undefined);
        if (!!ev.loop !== (cand.type === 'loop')) throw new Error('Replay diverged at ' + ev.parentId + '/' + ev.viaExitId);
        commit(exp, cand);
      } else if (ev.type === 'revert') {
        revert(exp, ev.spaceId);
      } else if (ev.type === 'caps') {
        setCaps(exp, ev.caps);
      }
    }
    return exp;
  }

  function exportRecord(exp) {
    return JSON.stringify(exp, null, 2);
  }

  /** Parse + replay an exported record, and check it matches cell-for-cell. */
  function importRecord(json) {
    const record = typeof json === 'string' ? JSON.parse(json) : json;
    if (record.version !== 1) throw new Error('Unsupported expedition version ' + record.version);
    const exp = replay(record);
    const mismatches = [];
    if (record.spaces) {
      const ids = new Set(Object.keys(record.spaces).concat(Object.keys(exp.spaces)));
      for (const id of ids) {
        const a = record.spaces[id];
        const b = exp.spaces[id];
        if (!a || !b) { mismatches.push(id + ': missing'); continue; }
        if (a.seed !== b.seed) mismatches.push(id + ': seed');
        if (a.cells.join(';') !== b.cells.join(';')) mismatches.push(id + ': cells');
        if (a.exits.length !== b.exits.length) mismatches.push(id + ': exits');
      }
    }
    return { expedition: exp, verified: mismatches.length === 0, mismatches };
  }

  // ---------------------------------------------------------------------------
  // Queries

  function pathToRoot(exp, spaceId) {
    const path = [];
    let s = exp.spaces[spaceId];
    while (s) { path.push(s.id); s = s.parentId ? exp.spaces[s.parentId] : null; }
    return path;
  }

  /** Independent cycles in the connection graph (E - V + components). */
  function cycleCount(exp) {
    const ids = Object.keys(exp.spaces);
    const parent = {};
    ids.forEach((id) => { parent[id] = id; });
    const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    let comps = ids.length;
    const conns = Object.values(exp.connections);
    for (const c of conns) {
      const ra = find(c.a.spaceId), rb = find(c.b.spaceId);
      if (ra !== rb) { parent[ra] = rb; comps--; }
    }
    return conns.length - ids.length + comps;
  }

  function stats(exp) {
    let open = 0;
    for (const id in exp.spaces) for (const e of exp.spaces[id].exits) if (!e.connectionId) open++;
    return {
      spaces: Object.keys(exp.spaces).length,
      cells: Object.keys(exp.registry).length,
      connections: Object.keys(exp.connections).length,
      openExits: open,
      cycles: cycleCount(exp),
    };
  }

  Object.assign(DE, {
    deriveParams, createExpedition, expand, commit, canRevert, revert, setCaps,
    replay, exportRecord, importRecord, rebuildRegistry,
    pathToRoot, cycleCount, stats, parseKey,
  });
})(typeof window !== 'undefined' ? window : globalThis);
