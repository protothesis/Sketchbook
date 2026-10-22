// The engine core: expeditions, expand / commit / revert, replay.
//
// All state is plain serializable data (see the JSDoc shapes below); the
// renderer only reads it and calls these functions. Shapes, as in the design
// doc:
//
//   Exit       { id, index, cell:{x,y}, facing:'N'|'E'|'S'|'W', kind,
//                connectionId|null, loopMade?, tags? }
//                kind: 'standard', or 'surface' (leads out of the dungeon;
//                never expands)
//   Space      { id, seed, parentId, viaExitId, entropy, archetype,
//                cells: "x,y"[], exits: Exit[], depth, deadEnd, meta,
//                nextExitIndex, reserveId? }
//   Connection { id, a:{spaceId,exitId}, b:{spaceId,exitId}, loop }
//   Trace      { id, seed, parentId, viaExitId, entropy, archetype, cells,
//                depth, deadEnd, meta, revertedAt }   (a reverted space)
//   Reserve    { id, seed, kind, cells: "x,y"[], spaceId|null, ...data }
//                (cells claimed ahead of time for a space that isn't there
//                yet; extra fields are the application's, kept as-is)
//   Expedition { version:1, rootSeed, params, spaces, connections,
//                registry: { "x,y": spaceId }, history: Event[], counters,
//                traces: { spaceId: Trace }, reserves: { id: Reserve } }
//   Event      { type:'commit', parentId, viaExitId, entropy, loop? }
//            | { type:'revert', spaceId }
//            | { type:'caps', caps }
//            | { type:'carve', spaceId, cell:{x,y}, facing }   (an exit cut into a wall)
//            | { type:'reserve', reserve }   (a footprint claimed ahead of time)
//
// Reserves: an application can claim a footprint before anything stands
// there (walk mode's waypoints). Ordinary spaces never grow into it. A door
// whose far cell is reserved opens into the reserved space itself, built
// from the reserve's own seed and cells (so it's the same whichever door
// you reach it by), and any space built against a footprint gets a door
// into it.
//
// Determinism rule: same seed + same registry state => same candidate. Replay
// re-applies `history` in order from the root, which reproduces every seed,
// id and cell exactly.
//
// Traces: a reverted space is gone from the map, but never forgotten. Its
// seed and cells stay in `traces` (a branch that existed but wasn't kept).
// Traces never block placement; clients read them per cell via imprintAt()
// to show cracks, corruption, ghosts. Replay rebuilds them from history.
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
      // The root room. Records from before halls have no `starter`, so
      // their replays keep the root chamber they were made with.
      starter: 'hall',
      // A rare ordinary room is a hall, from this depth on. Records from
      // before random halls have no `hallChance`, so their rooms don't change.
      // Rare, so waypoint halls stay special: 1 in 100 (was 1 in 40, which
      // older records keep).
      hallChance: 0.01,
      hallMinDepth: 3,
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
      counters: { space: 0, connection: 0, reserve: 0 },
      traces: {},
      reserves: {},
    };
    // Space 0 at the origin, seeded straight from the root seed: a hall
    // (with a door up to the surface), or a chamber in older records.
    const seed = hash(exp.rootSeed, 'root');
    const rng = createRng(seed);
    let placed;
    if (exp.params.starter === 'hall') {
      const h = DE.hallCells(rng, 6, 8);
      const ox = Math.floor(h.w / 2), oy = Math.floor(h.d / 2);
      placed = { archetype: 'hall', cells: h.cells.map((c) => ({ x: c.x - ox, y: c.y - oy })), end: null };
    } else {
      placed = DE.placeShape(DE.chamberShape(rng, exp.params), { x: 0, y: 0 }, 'N');
    }
    const space = buildSpace(exp, rng, {
      id: 's0', seed, parentId: null, viaExitId: null, entropy: null, depth: 0,
      placed, entry: null, deadEnd: false, minExits: 2,
    });
    if (exp.params.starter === 'hall') {
      // The surface door: on a north wall, where the camera sees it.
      const used = new Set(space.exits.map((e) => key(e.cell.x, e.cell.y)));
      const north = DE.boundarySlots(space.cells).filter((s) => s.facing === 'N' && !used.has(key(s.cell.x, s.cell.y)));
      const slot = north[Math.floor(rng.next() * north.length)];
      space.exits.push({
        id: 'e' + space.nextExitIndex, index: space.nextExitIndex,
        cell: { x: slot.cell.x, y: slot.cell.y }, facing: 'N', kind: 'surface', connectionId: null,
      });
      space.nextExitIndex++;
    }
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
    if (reservedAt(exp, bk)) return true; // a way into a reserved footprint
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
    if (o.reserveId) space.reserveId = o.reserveId;
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
      } else if (space.archetype === 'hall') {
        count = 2 + Math.floor(rng.next() * 2);
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
      // Built against a reserved footprint: always at least one door into
      // it. No draws, so spaces nowhere near a reserve are unchanged.
      const into = (ex) => { const b = step(ex.cell, ex.facing); return reservedAt(exp, key(b.x, b.y)); };
      for (const slot of DE.boundarySlots(cells)) {
        const res = into(slot);
        if (!res || usedCells.has(key(slot.cell.x, slot.cell.y))) continue;
        if (space.exits.some((ex) => into(ex) === res)) continue;
        addExit(slot.cell, slot.facing);
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
      const k = key(c.x, c.y);
      if (exp.registry[k] !== undefined || reservedAt(exp, k)) return false;
    }
    return true;
  }

  /**
   * The reserve still waiting on this cell (nothing built there yet), or
   * null. Indexed per expedition; reserving, committing a reserved space
   * and reverting one clear the index.
   */
  function reservedAt(exp, cellKey) {
    if (!exp.reserves) return null;
    if (!exp._reserved) {
      const idx = {};
      for (const id in exp.reserves) {
        const r = exp.reserves[id];
        if (!r.spaceId) for (const k of r.cells) idx[k] = r;
      }
      Object.defineProperty(exp, '_reserved', { value: idx, writable: true, configurable: true, enumerable: false });
    }
    return exp._reserved[cellKey] || null;
  }
  function clearReserved(exp) { if (exp._reserved) exp._reserved = null; }

  /** Could these cells be reserved? None built on or already reserved. */
  function canReserve(exp, cells) {
    return cells.length > 0 && cells.every((k) => exp.registry[k] === undefined && !reservedAt(exp, k));
  }

  /**
   * Claim a footprint for a space that isn't there yet. `r` needs `seed`,
   * `kind` (the archetype it will be built as) and `cells` ("x,y" keys);
   * any other fields are the application's, kept as-is. Returns the reserve.
   */
  function reserve(exp, r) {
    if (!canReserve(exp, r.cells)) throw new Error('Cannot reserve: cells taken');
    if (!exp.reserves) exp.reserves = {};
    if (exp.counters.reserve == null) exp.counters.reserve = 0;
    const res = Object.assign({}, r, { id: 'r' + exp.counters.reserve++, cells: r.cells.slice(), spaceId: null });
    exp.reserves[res.id] = res;
    clearReserved(exp);
    const ev = Object.assign({}, res);
    delete ev.id; delete ev.spaceId;
    exp.history.push({ type: 'reserve', reserve: ev });
    return res;
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
    if (exit.kind === 'surface') throw new Error('Exit ' + spaceId + '/' + exitId + ' leads out of the dungeon');

    const beyond = step(exit.cell, exit.facing);
    const bk = key(beyond.x, beyond.y);
    const facingBack = OPPOSITE[exit.facing];

    // Into a reserved footprint: the reserved space itself, from its own seed.
    const res = reservedAt(exp, bk);
    if (res) {
      const space = buildSpace(exp, createRng(res.seed), {
        id: 's' + exp.counters.space, seed: res.seed, parentId: spaceId, viaExitId: exitId,
        entropy: null, depth: parent.depth + 1, deadEnd: false, reserveId: res.id,
        placed: { archetype: res.kind, cells: res.cells.map(parseKey), end: null },
        entry: { cell: beyond, facing: facingBack },
      });
      return { type: 'space', parentId: spaceId, viaExitId: exitId, entropy: null, space, reserveId: res.id };
    }

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
      // A rare hall, decided and shaped on its own stream so the usual
      // draws below are untouched; if it doesn't fit, the room is ordinary.
      if (p.hallChance && depth >= p.hallMinDepth) {
        const hr = deriveRng(seed, 'hall');
        if (hr.chance(p.hallChance)) {
          for (let i = 0; i < 3 && !placed; i++) {
            const candidate = DE.placeShape(DE.hallShape(hr, 6, 8), beyond, exit.facing);
            if (fits(exp, candidate)) placed = candidate;
          }
        }
      }
      const archetype = rng.chance(p.corridorWeight) ? 'corridor' : 'chamber';
      for (const shape of placed ? [] : attemptShapes(rng, p, archetype)) {
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
    if (space.reserveId) { exp.reserves[space.reserveId].spaceId = space.id; clearReserved(exp); }
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
    // A reserved space goes back to waiting (its door would rebuild it as is).
    if (space.reserveId && exp.reserves[space.reserveId]) { exp.reserves[space.reserveId].spaceId = null; clearReserved(exp); }
    exp.history.push({ type: 'revert', spaceId });
    if (!exp.traces) exp.traces = {};
    exp.traces[spaceId] = {
      id: space.id, seed: space.seed, parentId: space.parentId, viaExitId: space.viaExitId,
      entropy: space.entropy, archetype: space.archetype, cells: space.cells.slice(),
      depth: space.depth, deadEnd: space.deadEnd, meta: space.meta, revertedAt: exp.history.length - 1,
    };
    if (exp._imprints) exp._imprints = null; // keeps it non-enumerable (not exported)
  }

  /**
   * Can a new exit be cut into this space's wall at (cell, facing)? The cell
   * must belong to the space, the edge must be a wall (not open to its own
   * floor), with no exit there already, and no unopened door on the far side
   * facing back (open that one instead).
   */
  function canCarve(exp, spaceId, cell, facing) {
    const sp = exp.spaces[spaceId];
    if (!sp || exp.registry[key(cell.x, cell.y)] !== spaceId) return false;
    const n = step(cell, facing);
    const other = exp.registry[key(n.x, n.y)];
    if (other === spaceId) return false;
    if (sp.exits.some((e) => e.cell.x === cell.x && e.cell.y === cell.y && e.facing === facing)) return false;
    if (other !== undefined && exp.spaces[other].exits.some((e) =>
      e.cell.x === n.x && e.cell.y === n.y && e.facing === OPPOSITE[facing])) return false;
    return true;
  }

  /**
   * Cut a new, unresolved exit into a space's wall: a tool for applications
   * (walk mode's door chalk). It behaves like any generated exit: expanding
   * it generates a space (or a loop, if the far side is already a space).
   * Recorded in history, so replay reproduces it.
   */
  function carve(exp, spaceId, cell, facing) {
    if (!canCarve(exp, spaceId, cell, facing)) throw new Error('Cannot carve an exit at ' + spaceId + ' ' + key(cell.x, cell.y) + facing);
    const sp = exp.spaces[spaceId];
    const ex = {
      id: 'e' + sp.nextExitIndex, index: sp.nextExitIndex,
      cell: { x: cell.x, y: cell.y }, facing, kind: 'standard', connectionId: null, tags: ['carved'],
    };
    sp.nextExitIndex++;
    sp.exits.push(ex);
    exp.history.push({ type: 'carve', spaceId, cell: { x: cell.x, y: cell.y }, facing });
    return ex;
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
      } else if (ev.type === 'carve') {
        carve(exp, ev.spaceId, ev.cell, ev.facing);
      } else if (ev.type === 'caps') {
        setCaps(exp, ev.caps);
      } else if (ev.type === 'reserve') {
        reserve(exp, ev.reserve);
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

  /**
   * Every trace lying under a cell, oldest first: [{ id, seed, depth, ... }].
   * Cached per expedition; any revert clears the cache.
   */
  function imprintAt(exp, cellKey) {
    if (!exp._imprints) {
      const idx = {};
      const traces = Object.values(exp.traces || {}).sort((a, b) => a.revertedAt - b.revertedAt);
      for (const t of traces) for (const k of t.cells) (idx[k] = idx[k] || []).push(t);
      Object.defineProperty(exp, '_imprints', { value: idx, writable: true, configurable: true, enumerable: false });
    }
    return exp._imprints[cellKey] || [];
  }

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
    for (const id in exp.spaces) for (const e of exp.spaces[id].exits) if (!e.connectionId && e.kind !== 'surface') open++;
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
    canCarve, carve, replay, exportRecord, importRecord, rebuildRegistry,
    pathToRoot, cycleCount, stats, parseKey, imprintAt, reservedAt, canReserve, reserve,
  });
})(typeof window !== 'undefined' ? window : globalThis);
