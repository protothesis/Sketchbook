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
//                nextExitIndex, regionId, role, heading?, reserveId? }
//                (archetype is the room's shape; role is its part in its
//                region's structure: see regions.js)
//   Region     { id, seed, type, mood, hue, size, parentId, anchor:{x,y},
//                originId, plan? }   (regions.js; never removed, so a
//                restored room finds its region again)
//   Connection { id, a:{spaceId,exitId}, b:{spaceId,exitId}, loop }
//   Trace      { id, seed, parentId, viaExitId, entropy, archetype, cells,
//                depth, deadEnd, meta, revertedAt, cause?, quiet?, reserveId?,
//                exits, nextExitIndex }
//                (a reverted space; cause is the application's tag, and a
//                quiet trace leaves no imprint; exits are its own doors, as
//                they stood, so a restored room comes back with them)
//   Reserve    { id, seed, kind, cells: "x,y"[], spaceId|null, ...data }
//                (cells claimed ahead of time for a space that isn't there
//                yet; extra fields are the application's, kept as-is.
//                A region's claims also carry regionId, role, part,
//                ownerId; kind 'void' is ground nothing is ever built on)
//   Expedition { version:1, build, rootSeed, params, spaces, connections,
//                registry: { "x,y": spaceId }, history: Event[], counters,
//                traces: { spaceId: Trace }, reserves: { id: Reserve },
//                regions: { id: Region } }
//   Event      { type:'commit', parentId, viaExitId, entropy, loop?, restore? }
//            | { type:'revert', spaceId, cause?, quiet? }
//            | { type:'tag', ids, cause, quiet }   (traces re-tagged)
//            | { type:'caps', caps }
//            | { type:'carve', spaceId, cell:{x,y}, facing }   (an exit cut into a wall)
//            | { type:'uncarve', spaceId, exitId }   (a carved exit walled up again)
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
// id and cell exactly, within one BUILD.
//
// Versioning (NOTES.md, "Versioning"): every record carries `build`. A
// record from another build isn't replayed (importRecord refuses it): the
// generator may have changed. Bump BUILD whenever a change alters what a
// history builds, and don't keep old behaviour around behind params. To
// look at an old record, check out the commit of its build and open it
// there.
//
// Traces: a reverted space is gone from the map, but never forgotten. Its
// seed and cells stay in `traces` (a branch that existed but wasn't kept).
// Traces never block placement; clients read them per cell via imprintAt()
// to show cracks, corruption, ghosts. Replay rebuilds them from history.
//
// Restoring: a trace can be built again, as the same space (same id, seed
// and cells), through its parent's exit with its recorded entropy, while
// its footprint is free (restorable / restore). The commit records
// `restore: id`, and the trace is used up (removed from `traces`), so it no
// longer cracks its own floor. Reverting the space again leaves a fresh
// trace. Traces carry an application's tag (`cause`), and a `quiet` trace
// leaves no imprint; tagTraces changes both, in history.
(function (global) {
  'use strict';

  const DE = (global.DungeonEngine = global.DungeonEngine || {});
  const { hash, createRng, deriveRng, drawEntropy } = DE;
  const { OPPOSITE, key, parseKey, step } = DE;

  /**
   * The generator's build: stamped on every record (`exp.build`) and every
   * walk-mode save. Bump it (and BUILD_DATE) whenever a change alters what
   * a history builds. See the versioning note at the top of this file.
   */
  const BUILD = 3;
  const BUILD_DATE = '2026-11-05';

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
      // Meander regions only; structured regions set their own (loopChanceFor).
      loopChance: +r.range(0.25, 0.5).toFixed(3),
      maxAttempts: 20,
      maxSpaces: null,
      maxArea: null,
      maxDepth: null,
      // A rare meander room is a hall, from this depth on. Rare, so
      // waypoint halls stay special.
      hallChance: 0.01,
      hallMinDepth: 3,
    };
  }

  function createExpedition(rootSeed, caps, paramsOverride) {
    const exp = {
      version: 1,
      build: BUILD,
      rootSeed: String(rootSeed),
      params: paramsOverride ? Object.assign({}, paramsOverride) : deriveParams(rootSeed),
      spaces: {},
      connections: {},
      registry: {},
      history: [],
      counters: { space: 0, connection: 0, reserve: 0, region: 0 },
      traces: {},
      reserves: {},
      regions: {},
    };
    // Space 0 at the origin, seeded straight from the root seed: a hall,
    // with a door up to the surface, in the root region.
    const seed = hash(exp.rootSeed, 'root');
    const rng = createRng(seed);
    const region = DE.rollRegion(hash(exp.rootSeed, 'region'), null, { x: 0, y: 0 });
    region.id = 'g0';
    region.originId = 's0';
    exp.regions.g0 = region;
    exp.counters.region = 1;
    const h = DE.hallCells(rng, 6, 8);
    const ox = Math.floor(h.w / 2), oy = Math.floor(h.d / 2);
    const placed = { archetype: 'hall', cells: h.cells.map((c) => ({ x: c.x - ox, y: c.y - oy })), end: null };
    const space = buildSpace(exp, rng, {
      id: 's0', seed, parentId: null, viaExitId: null, entropy: null, depth: 0,
      placed, entry: null, deadEnd: false, minExits: 2, region, role: 'hall',
    });
    // The surface door: on a north wall, where the camera sees it.
    const used = new Set(space.exits.map((e) => key(e.cell.x, e.cell.y)));
    const north = DE.boundarySlots(space.cells).filter((s) => s.facing === 'N' && !used.has(key(s.cell.x, s.cell.y)));
    const slot = north[Math.floor(rng.next() * north.length)];
    space.exits.push({
      id: 'e' + space.nextExitIndex, index: space.nextExitIndex,
      cell: { x: slot.cell.x, y: slot.cell.y }, facing: 'N', kind: 'surface', connectionId: null,
    });
    space.nextExitIndex++;
    writeSpace(exp, space);
    exp.counters.space = 1;
    // Caps go through history so replay sees them change at the right moment.
    if (caps && (caps.maxSpaces || caps.maxArea || caps.maxDepth)) setCaps(exp, caps);
    return exp;
  }

  // ---------------------------------------------------------------------------
  // Space construction

  /** The claim on a cell: a reserve, or one of the candidate's own claims not yet written (`o.pending`). */
  function claimAt(exp, o, k) {
    return (o && o.pending && o.pending[k]) || reservedAt(exp, k);
  }

  function exitSlotOk(exp, rng, ownSet, slot, forbidKey, o, loopChance) {
    const b = step(slot.cell, slot.facing);
    const bk = key(b.x, b.y);
    if (ownSet.has(bk) || bk === forbidKey) return false;
    const claim = claimAt(exp, o, bk);
    if (claim) return claim.kind !== 'void'; // a way into a reserved footprint (never into a courtyard)
    if (heldVoidAt(exp, bk)) return false; // nor into a lost cloister's courtyard, held while it's gone
    // Facing into an existing space, or ground a lost path holds: keep it
    // only sometimes, as a loop door. (A room coming back is built as it
    // first was, when that ground was free: held ground doesn't count.)
    if (exp.registry[bk] !== undefined || (!o.restoring && heldAt(exp, bk))) return rng.chance(loopChance);
    return true;
  }

  function buildSpace(exp, rng, o) {
    const cells = o.placed.cells.map((c) => key(c.x, c.y));
    const ownSet = new Set(cells);
    const role = o.deadEnd ? 'stub' : o.role || 'room';
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
      regionId: o.region.id,
      role,
    };
    // The role its region asked for, when the room fell back to another
    // (a gallery with no room becomes a cubicle): what a restore asks again.
    if (o.askedRole && o.askedRole !== role) space.askedRole = o.askedRole;
    if (o.heading) space.heading = o.heading;
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
      const region = o.region;
      const tryAdd = (slot, loop) => {
        if (usedCells.has(key(slot.cell.x, slot.cell.y))) return false;
        if (!exitSlotOk(exp, rng, ownSet, slot, forbid, o, loop)) return false;
        addExit(slot.cell, slot.facing);
        return true;
      };
      // Corridors carry on from their far tip.
      if (o.placed.end) tryAdd(o.placed.end, DE.loopChanceFor(exp.params, role, true));
      const loop = DE.loopChanceFor(exp.params, role, false);
      if (role === 'gallery' || role === 'walk') {
        // Doors along the run on the region's 2-cell module. A cloister walk
        // opens only outward: never onto its courtyard or along its own ring.
        const outward = (s) => {
          if (role !== 'walk') return true;
          const b = step(s.cell, s.facing);
          const c = claimAt(exp, o, key(b.x, b.y));
          return !(c && c.regionId === region.id);
        };
        const slots = rng.shuffle(DE.boundarySlots(cells).filter((s) => outward(s) && DE.onModule(s, region)));
        let count = role === 'walk' ? 1 + Math.floor(rng.next() * 3) : 4;
        const chance = role === 'walk' ? 0.6 : 0.32;
        for (const slot of slots) {
          if (count <= 0) break;
          if (!rng.chance(chance)) continue;
          if (tryAdd(slot, loop)) count--;
        }
      } else {
        let count;
        if (role === 'threshold') count = 0;
        else if (role === 'cubicle') count = rng.chance(0.25) ? 1 : 0;
        else if (role === 'cell') count = rng.chance(0.3) ? 1 : 0;
        else if (space.archetype === 'chamber') count = 1 + Math.floor(rng.next() * exp.params.exitBias * 1.5);
        else if (space.archetype === 'corridor') count = rng.chance(0.2) ? 1 : 0;
        else if (space.archetype === 'hall') count = 2 + Math.floor(rng.next() * 2);
        else count = 0;
        if (o.minExits) count = Math.max(count, o.minExits);
        for (const slot of rng.shuffle(DE.boundarySlots(cells))) {
          if (count <= 0) break;
          if (tryAdd(slot, loop)) count--;
        }
      }
      // Keep the dungeon open: when few doors are left unopened anywhere,
      // a room gets at least `minExits` onward (expand decides; the root
      // always gets two).
      const onward = () => space.exits.length - (o.entry ? 1 : 0);
      if (o.minExits && onward() < o.minExits) {
        for (const slot of rng.shuffle(DE.boundarySlots(cells))) {
          if (onward() >= o.minExits) break;
          tryAdd(slot, 0);
        }
      }
      // Built against a reserved footprint: always at least one door into
      // it (never into a courtyard). No draws, so spaces nowhere near a
      // reserve are unchanged.
      const into = (ex) => {
        const b = step(ex.cell, ex.facing);
        const c = claimAt(exp, o, key(b.x, b.y));
        return c && c.kind !== 'void' ? c : null;
      };
      for (const slot of DE.boundarySlots(cells)) {
        const res = into(slot);
        if (!res || usedCells.has(key(slot.cell.x, slot.cell.y))) continue;
        if (space.exits.some((ex) => into(ex) === res)) continue;
        addExit(slot.cell, slot.facing);
      }
    }

    // Seed-derived extras on their own stream, so they never shift layouts.
    // A room takes its region's mood; a waypoint (`ownMeta`) keeps its own
    // roll, so it's the same whichever door reaches it. Either way the hue is
    // the mood's (DE.MOOD_TONES), drifted a little, so a colour means a mood.
    const m = deriveRng(space.seed, 'meta');
    m.int(0, 359); // was a free hue; still drawn so the mood roll below stays put
    const ownMood = m.pick(DE.MOODS);
    const mood = o.ownMeta ? ownMood : o.region.mood;
    const d = DE.REGION_TUNING.hueDrift;
    space.meta = { hue: (((DE.MOOD_TONES[mood].hue + m.int(-d, d)) % 360) + 360) % 360, mood };
    return space;
  }

  function writeSpace(exp, space) {
    exp.spaces[space.id] = space;
    for (const k of space.cells) exp.registry[k] = space.id;
  }

  // ---------------------------------------------------------------------------
  // Placement

  /** Can these cells be built on? Not on a space, a reserve, or ground a lost path holds (but its own, `ownTrace`). */
  function fits(exp, placed, ownTrace) {
    for (const c of placed.cells) {
      const k = key(c.x, c.y);
      if (exp.registry[k] !== undefined || reservedAt(exp, k)) return false;
      const h = heldAt(exp, k);
      if (h && h.id !== ownTrace) return false;
    }
    return true;
  }

  /**
   * The lost path's trace holding this cell, or null. A room lost to a
   * faint (a trace tagged 'lost' or 'lost-dim', not standing again) keeps
   * its ground while it waits: nothing else is built there, so it can come
   * back. That ground includes what the room claimed ahead (a cloister
   * walk's ring and courtyard, dormant while it's gone), since it needs
   * those to come back as it was. Only once `params.holdLost` is on (a
   * 'hold' event in the history, so older records replay as they were).
   * Cached by history length.
   */
  function heldAt(exp, cellKey) {
    if (!exp.params.holdLost) return null;
    const n = exp.history.length;
    if (!exp._held || exp._held.n !== n) {
      const idx = {}, voids = new Set();
      const lost = (t) => t && (t.cause === 'lost' || t.cause === 'lost-dim') && !exp.spaces[t.id];
      // Claims first, so a room's own cells win where the two meet.
      for (const id in exp.reserves || {}) {
        const r = exp.reserves[id];
        const owner = r.dormant && r.ownerId && exp.traces && exp.traces[r.ownerId];
        if (lost(owner)) for (const k of r.cells) { idx[k] = owner; if (r.kind === 'void') voids.add(k); }
      }
      for (const id in exp.traces || {}) {
        const t = exp.traces[id];
        if (lost(t)) for (const k of t.cells) idx[k] = t;
      }
      Object.defineProperty(exp, '_held', { value: { n, idx, voids }, writable: true, configurable: true, enumerable: false });
    }
    return exp._held.idx[cellKey] || null;
  }

  /** Is this cell a held courtyard (open air a lost cloister walk claimed)? No door may face it. */
  function heldVoidAt(exp, cellKey) {
    return !!heldAt(exp, cellKey) && exp._held.voids.has(cellKey);
  }

  /** From now on, lost paths hold their ground (see heldAt). Recorded in history. */
  function holdLostPaths(exp) {
    if (exp.params.holdLost) return;
    exp.params.holdLost = true;
    exp.history.push({ type: 'hold' });
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
        if (!r.spaceId && !r.dormant) for (const k of r.cells) idx[k] = r;
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

  /**
   * The doorsteps (the cell just beyond) of a space's other unopened doors,
   * as "x,y" keys. A room opened through one door mustn't cover these, or
   * two doors side by side would both open into the same room. It can share
   * a wall with the next one, turn away, or be a one-cell closet if nothing
   * else fits.
   */
  function doorstepsOf(exp, space, exit) {
    const out = new Set();
    const b0 = step(exit.cell, exit.facing);
    const own = key(b0.x, b0.y);
    for (const e of space.exits) {
      if (e === exit || e.connectionId) continue;
      const b = step(e.cell, e.facing);
      const k = key(b.x, b.y);
      if (k !== own) out.add(k); // two doors onto one notch cell: nothing to keep clear
    }
    return out;
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
  /**
   * A room coming back gets the doors it had (its trace's `exits`), not
   * doors drawn again: what's built around it since can shift those draws,
   * and a door in another place would no longer lead to its children's
   * ground. Every door comes back unopened.
   */
  function withTraceExits(space, restore) {
    if (!restore || !restore.exits) return space;
    space.exits = restore.exits.map((e) => {
      const ex = { id: e.id, index: e.index, cell: { x: e.cell.x, y: e.cell.y }, facing: e.facing, kind: e.kind, connectionId: null };
      if (e.tags) ex.tags = e.tags.slice();
      return ex;
    });
    space.nextExitIndex = restore.nextExitIndex;
    return space;
  }

  function expand(exp, spaceId, exitId, entropy, restore) {
    const parent = exp.spaces[spaceId];
    if (!parent) throw new Error('No space ' + spaceId);
    const exit = parent.exits.find((e) => e.id === exitId);
    if (!exit) throw new Error('No exit ' + exitId + ' on ' + spaceId);
    if (exit.connectionId) throw new Error('Exit ' + spaceId + '/' + exitId + ' is already resolved');
    if (exit.kind === 'surface') throw new Error('Exit ' + spaceId + '/' + exitId + ' leads out of the dungeon');

    const beyond = step(exit.cell, exit.facing);
    const bk = key(beyond.x, beyond.y);
    const facingBack = OPPOSITE[exit.facing];

    // Ground a lost path holds: only that room itself, coming back. Checked
    // before reserves: a lost room may have stood on one (a cloister walk),
    // and its reserve, waiting again, mustn't be built by another door.
    const held = heldAt(exp, bk);
    if (held && !(restore && restore.id === held.id)) throw new Error('A lost path holds that ground');

    // Into a reserved footprint: the reserved space itself, from its own seed
    // (restoring one built there: the same space, under its old id).
    const res = reservedAt(exp, bk);
    if (res && res.kind === 'void') throw new Error('That wall backs onto open air');
    if (restore && (exp.registry[bk] !== undefined || (res && res.id !== restore.reserveId))) return null;
    if (restore && restore.reserveId && !res) return null;
    if (res) {
      // A region's claim (a cloister walk) is that region's; a waypoint
      // belongs to the region you reach it from, but keeps its own mood.
      const region = (res.regionId && exp.regions[res.regionId]) || exp.regions[parent.regionId];
      const space = buildSpace(exp, createRng(res.seed), {
        id: restore ? restore.id : 's' + exp.counters.space, seed: res.seed, parentId: spaceId, viaExitId: exitId,
        entropy: null, depth: parent.depth + 1, deadEnd: false, reserveId: res.id, restoring: !!restore,
        placed: { archetype: res.kind, cells: res.cells.map(parseKey), end: null },
        entry: { cell: beyond, facing: facingBack },
        region, role: res.role || (res.kind === 'hall' ? 'hall' : 'room'), ownMeta: !res.regionId,
      });
      withTraceExits(space, restore);
      const rc = { type: 'space', parentId: spaceId, viaExitId: exitId, entropy: null, space, reserveId: res.id };
      if (restore) rc.restore = restore.id;
      return rc;
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

    const ent = restore ? restore.entropy : entropy || drawEntropy();
    const seed = hash(parent.seed, exit.index, ent);
    // Restoring (`restore`, a trace): only the trace's own footprint will
    // do. The rng draws the same either way, so its doors come out the same
    // when its neighbours are.
    const want = restore && restore.cells.slice().sort().join(';');
    // A room coming back keeps its old footprint, doorsteps or not.
    const steps = restore ? new Set() : doorstepsOf(exp, parent, exit);
    const ok = (candidate) => fits(exp, candidate, restore && restore.id) &&
      (!steps.size || !candidate.cells.some((c) => steps.has(key(c.x, c.y)))) &&
      (!want || candidate.cells.map((c) => key(c.x, c.y)).sort().join(';') === want);
    // Cells a region claims ahead (a cloister's ring and courtyard) must be
    // free too, and clear of the parent's doorsteps.
    const okKeys = (keys) => keys.every((k) => exp.registry[k] === undefined && !reservedAt(exp, k) &&
      (!heldAt(exp, k) || heldAt(exp, k).id === (restore && restore.id)) && !steps.has(k));
    // A courtyard may not cover any unopened door's doorstep, anywhere: that
    // door would open onto nothing.
    let doorsteps = null;
    const okVoid = (keys) => {
      if (!doorsteps) {
        doorsteps = new Set();
        for (const sid in exp.spaces) for (const e of exp.spaces[sid].exits) {
          if (e.connectionId || (sid === spaceId && e.id === exitId)) continue;
          const b = step(e.cell, e.facing);
          doorsteps.add(key(b.x, b.y));
        }
      }
      return keys.every((k) => !doorsteps.has(k));
    };
    const okPart = (pt) => okKeys(pt.cells) && (pt.kind !== 'void' || okVoid(pt.cells));
    const rng = createRng(seed);
    const depth = parent.depth + 1;
    const p = exp.params;
    const id = restore ? restore.id : 's' + exp.counters.space;

    // Which region, and what part of it: the trace's own when coming back,
    // else rolled (regions.js). A stub stays in its parent's region.
    let ctx;
    if (restore) ctx = { region: exp.regions[restore.regionId], role: restore.role, isNew: false };
    else if (capsReached(exp, depth)) ctx = { region: exp.regions[parent.regionId], role: 'stub', isNew: false };
    else ctx = DE.resolveRegion(exp, parent, exit, seed, beyond);
    const region = ctx.region;
    let role = ctx.role;

    let placed = null;
    let deadEnd = false;
    let plan = null, claims = [], wake = [];
    if ((restore && restore.deadEnd) || role === 'stub') {
      placed = DE.placeShape(DE.stubShape(), beyond, exit.facing);
      deadEnd = true;
      if (restore && !ok(placed)) return null;
    } else {
      if (role === 'walk') {
        // A cloister's first walk: the side you enter on, built now, with
        // the rest of the ring and the courtyard claimed ahead. Coming back,
        // it's the plan it made, and it claims again what it lost.
        if (restore) {
          if (region.plan && region.originId === restore.id) {
            // Its dormant claims wake. Ground a lost walk of its own holds
            // is still its own.
            wake = Object.values(exp.reserves).filter((r) => r.ownerId === id && r.dormant);
            const free = (r) => r.cells.every((k) => exp.registry[k] === undefined && !reservedAt(exp, k) &&
              (!heldAt(exp, k) || heldAt(exp, k).id === id || heldAt(exp, k).reserveId === r.id));
            if (!wake.every((r) => free(r) && (r.kind !== 'void' || okVoid(r.cells)))) return null;
            placed = { archetype: 'corridor', cells: region.plan.near.map(parseKey), end: null };
            if (!ok(placed)) return null;
          }
        } else {
          for (const pl of DE.cloisterPlans(region, beyond, exit.facing)) {
            if (okKeys(pl.near) && pl.parts.every(okPart)) { plan = pl; break; }
          }
          if (plan) {
            placed = { archetype: 'corridor', cells: plan.near.map(parseKey), end: null };
            claims = DE.planClaims(region, plan, id);
          }
        }
        if (!placed) role = 'cell'; // the ring won't fit: a cloister without its walk
      }
      if (!placed && role === 'room') {
        // Meander: the original generator. A rare hall, decided and shaped
        // on its own stream so the usual draws below are untouched; if it
        // doesn't fit, the room is ordinary.
        if (p.hallChance && depth >= p.hallMinDepth) {
          const hr = deriveRng(seed, 'hall');
          if (hr.chance(p.hallChance)) {
            for (let i = 0; i < 3 && !placed; i++) {
              const candidate = DE.placeShape(DE.hallShape(hr, 6, 8), beyond, exit.facing);
              if (ok(candidate)) placed = candidate;
            }
          }
        }
        const archetype = rng.chance(p.corridorWeight) ? 'corridor' : 'chamber';
        for (const shape of placed ? [] : attemptShapes(rng, p, archetype)) {
          const candidate = DE.placeShape(shape, beyond, exit.facing);
          if (ok(candidate)) { placed = candidate; break; }
        }
      } else if (!placed) {
        for (const t of DE.roleTries(rng, p, role)) {
          const candidate = DE.placeShape(t.shape, beyond, exit.facing);
          if (ok(candidate)) { placed = candidate; role = t.role; break; }
        }
      }
      if (!placed && restore) return null; // its footprint is taken: it can't come back
      if (!placed) {
        // Nothing fits: a one-cell dead end (the beyond cell is known free).
        placed = DE.placeShape(DE.stubShape(), beyond, exit.facing);
        deadEnd = true;
      }
    }

    const pending = {};
    for (const c of claims.concat(wake)) for (const k of c.cells) pending[k] = c;
    // Few doors left unopened anywhere (structured regions have few): this
    // room keeps the way on open.
    let open = 0;
    for (const sid in exp.spaces) for (const e of exp.spaces[sid].exits) {
      if (!e.connectionId && e.kind !== 'surface' && !(sid === spaceId && e.id === exitId)) open++;
    }
    const minExits = deadEnd || open >= 3 ? 0 : open === 0 ? 2 : 1;
    const space = buildSpace(exp, rng, {
      id, seed, parentId: spaceId, viaExitId: exitId,
      entropy: ent, depth, placed, deadEnd, restoring: !!restore,
      entry: { cell: beyond, facing: facingBack },
      region, role, askedRole: ctx.role, pending, minExits, heading: role === 'gallery' || role === 'threshold' ? exit.facing : null,
    });
    withTraceExits(space, restore);
    const cand = { type: 'space', parentId: spaceId, viaExitId: exitId, entropy: ent, space };
    if (ctx.isNew) cand.region = region;
    if (plan) cand.plan = plan;
    if (claims.length) cand.claims = claims;
    if (wake.length) cand.wake = wake.map((r) => r.id);
    if (restore) cand.restore = restore.id;
    return cand;
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
    if (cand.restore) {
      if (!exp.traces[cand.restore] || exp.spaces[space.id]) throw new Error('Stale candidate: nothing to restore');
    } else if (space.id !== 's' + exp.counters.space) throw new Error('Stale candidate: expedition changed');
    for (const k of space.cells) {
      if (exp.registry[k] !== undefined) throw new Error('Stale candidate: cell ' + k + ' now occupied');
    }
    if (cand.region && cand.region.id !== 'g' + exp.counters.region) throw new Error('Stale candidate: expedition changed');
    for (const c of cand.claims || []) if (!canReserve(exp, c.cells)) throw new Error('Stale candidate: claimed ground now taken');
    // A new region, and what it claims ahead, are written with the room
    // that opened them (so a reroll leaves nothing). No events of their own:
    // replay's expand makes them again.
    if (cand.region) {
      cand.region.originId = space.id;
      exp.regions[cand.region.id] = cand.region;
      exp.counters.region++;
    }
    if (cand.plan) {
      const region = exp.regions[space.regionId];
      region.plan = { shape: cand.plan.shape, w: cand.plan.w, d: cand.plan.d, near: cand.plan.near.slice(),
        parts: cand.plan.parts.map((pt) => ({ part: pt.part, kind: pt.kind, role: pt.role, cells: pt.cells.slice() })) };
      region.originId = space.id;
    }
    for (const c of cand.claims || []) {
      const r = Object.assign({}, c, { id: 'r' + exp.counters.reserve++, cells: c.cells.slice(), spaceId: null });
      exp.reserves[r.id] = r;
    }
    for (const rid of cand.wake || []) if (exp.reserves[rid]) delete exp.reserves[rid].dormant;
    if (cand.claims || cand.wake) clearReserved(exp);
    writeSpace(exp, space);
    if (cand.restore) { delete exp.traces[cand.restore]; if (exp._imprints) exp._imprints = null; }
    else exp.counters.space++;
    if (space.reserveId) { exp.reserves[space.reserveId].spaceId = space.id; clearReserved(exp); }
    const cid = connect(exp,
      { spaceId: cand.parentId, exitId: cand.viaExitId },
      { spaceId: space.id, exitId: space.exits[0].id }, false);
    parentExit.connectionId = cid;
    space.exits[0].connectionId = cid;
    const ev = { type: 'commit', parentId: cand.parentId, viaExitId: cand.viaExitId, entropy: cand.entropy };
    if (cand.restore) ev.restore = cand.restore;
    exp.history.push(ev);
    return space.id;
  }

  /** A space can be reverted if it isn't the root and has no child spaces. */
  function canRevert(exp, spaceId) {
    if (!exp.spaces[spaceId] || exp.spaces[spaceId].parentId === null) return false;
    for (const id in exp.spaces) if (exp.spaces[id].parentId === spaceId) return false;
    return true;
  }

  /**
   * Remove a leaf space: frees its cells and reopens the parent exit.
   * `cause` is an optional tag kept on the event and the trace (walk mode
   * marks rooms lost to a faint), and a `quiet` trace leaves no imprint.
   */
  function revert(exp, spaceId, cause, quiet) {
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
    // A reserved space goes back to waiting (its door would rebuild it as
    // is), or dormant if the room that claimed it is gone too.
    if (space.reserveId && exp.reserves[space.reserveId]) {
      const r = exp.reserves[space.reserveId];
      r.spaceId = null;
      if (r.ownerId && !exp.spaces[r.ownerId]) r.dormant = true;
      clearReserved(exp);
    }
    // What it claimed ahead and nothing stands on goes dormant: it no
    // longer claims the ground, but keeps its id, and wakes if the room
    // comes back. Its region stays, for that.
    for (const rid in exp.reserves) {
      const r = exp.reserves[rid];
      if (r.ownerId === spaceId && !r.spaceId) { r.dormant = true; clearReserved(exp); }
    }
    const ev = { type: 'revert', spaceId };
    if (cause) ev.cause = cause;
    if (quiet) ev.quiet = true;
    exp.history.push(ev);
    if (!exp.traces) exp.traces = {};
    const trace = {
      id: space.id, seed: space.seed, parentId: space.parentId, viaExitId: space.viaExitId,
      entropy: space.entropy, archetype: space.archetype, cells: space.cells.slice(),
      depth: space.depth, deadEnd: space.deadEnd, meta: space.meta, revertedAt: exp.history.length - 1,
      regionId: space.regionId, role: space.askedRole || space.role,
      // Its own doors (not ones a loop from elsewhere made, which go with it).
      exits: space.exits.filter((e) => !e.loopMade).map((e) => {
        const ex = { id: e.id, index: e.index, cell: { x: e.cell.x, y: e.cell.y }, facing: e.facing, kind: e.kind };
        if (e.tags) ex.tags = e.tags.slice();
        return ex;
      }),
      nextExitIndex: space.nextExitIndex,
    };
    if (cause) trace.cause = cause;
    if (quiet) trace.quiet = true;
    if (space.reserveId) trace.reserveId = space.reserveId;
    exp.traces[spaceId] = trace;
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
    const claim = reservedAt(exp, key(n.x, n.y));
    if (claim && claim.kind === 'void') return false; // a courtyard: nothing opens into it
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

  /**
   * Wall a carved exit up again (walk mode: a faint takes back doors cut
   * since the checkpoint). If it opened onto a space (a loop), that
   * connection goes too: a door the loop made on the far side is removed,
   * any other far door becomes unresolved again. A space opened through it
   * must be reverted first. Recorded in history.
   */
  function uncarve(exp, spaceId, exitId) {
    const sp = exp.spaces[spaceId];
    const ex = sp && sp.exits.find((e) => e.id === exitId);
    if (!ex || !(ex.tags || []).includes('carved')) throw new Error('No carved exit ' + spaceId + '/' + exitId);
    if (ex.connectionId) {
      const conn = exp.connections[ex.connectionId];
      if (!conn.loop) throw new Error('Revert the space beyond ' + spaceId + '/' + exitId + ' first');
      const other = conn.a.spaceId === spaceId && conn.a.exitId === exitId ? conn.b : conn.a;
      const os = exp.spaces[other.spaceId];
      const oe = os && os.exits.find((e) => e.id === other.exitId);
      if (oe && oe.loopMade) os.exits = os.exits.filter((e) => e !== oe);
      else if (oe) oe.connectionId = null;
      delete exp.connections[conn.id];
    }
    sp.exits = sp.exits.filter((e) => e !== ex);
    exp.history.push({ type: 'uncarve', spaceId, exitId });
  }

  /**
   * Could this trace stand again as the same space? Its parent must stand,
   * with the exit it was opened through still unopened, and its footprint
   * must be free. Returns a candidate ready for commit(), or null.
   */
  function restorable(exp, traceId) {
    const t = exp.traces && exp.traces[traceId];
    if (!t || exp.spaces[t.id] || !exp.spaces[t.parentId]) return null;
    if (!t.entropy && !t.reserveId) return null;
    const ex = getExit(exp, t.parentId, t.viaExitId);
    if (!ex || ex.connectionId || ex.kind === 'surface') return null;
    return expand(exp, t.parentId, t.viaExitId, null, t);
  }

  /** Build a trace again (see restorable). Returns the space id. */
  function restore(exp, traceId) {
    const cand = restorable(exp, traceId);
    if (!cand) throw new Error('Cannot restore ' + traceId);
    return commit(exp, cand);
  }

  /** Re-tag traces (cause, quiet). Recorded in history. */
  function tagTraces(exp, ids, cause, quiet) {
    const list = ids.filter((id) => exp.traces && exp.traces[id]);
    if (!list.length) return;
    for (const id of list) {
      const t = exp.traces[id];
      if (cause) t.cause = cause; else delete t.cause;
      if (quiet) t.quiet = true; else delete t.quiet;
    }
    exp.history.push({ type: 'tag', ids: list, cause: cause || null, quiet: !!quiet });
    if (exp._imprints) exp._imprints = null;
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
    delete p.holdLost; // switched on by its 'hold' event, where it happened
    return p;
  }

  /** Rebuild an expedition from its root seed + history alone. */
  function replay(record) {
    const exp = createExpedition(record.rootSeed, null, initialParams(record));
    for (const ev of record.history) {
      if (ev.type === 'commit') {
        const trace = ev.restore ? exp.traces[ev.restore] : undefined;
        if (ev.restore && !trace) throw new Error('Replay diverged: no trace ' + ev.restore);
        const cand = expand(exp, ev.parentId, ev.viaExitId, ev.entropy || undefined, trace);
        if (!cand || !!ev.loop !== (cand.type === 'loop')) throw new Error('Replay diverged at ' + ev.parentId + '/' + ev.viaExitId);
        commit(exp, cand);
      } else if (ev.type === 'revert') {
        revert(exp, ev.spaceId, ev.cause, ev.quiet);
      } else if (ev.type === 'tag') {
        tagTraces(exp, ev.ids, ev.cause, ev.quiet);
      } else if (ev.type === 'carve') {
        carve(exp, ev.spaceId, ev.cell, ev.facing);
      } else if (ev.type === 'uncarve') {
        uncarve(exp, ev.spaceId, ev.exitId);
      } else if (ev.type === 'caps') {
        setCaps(exp, ev.caps);
      } else if (ev.type === 'reserve') {
        reserve(exp, ev.reserve);
      } else if (ev.type === 'hold') {
        holdLostPaths(exp);
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
    if (record.build !== BUILD) {
      throw new Error('This record was made by build ' + (record.build || 1) + ' of the generator; this is build ' + BUILD +
        '. To see it, open it in a checkout of that build (NOTES.md, "Versioning").');
    }
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
   * Quiet traces leave no imprint. Cached per expedition; any revert,
   * restore or re-tag clears the cache.
   */
  function imprintAt(exp, cellKey) {
    if (!exp._imprints) {
      const idx = {};
      const traces = Object.values(exp.traces || {}).filter((t) => !t.quiet).sort((a, b) => a.revertedAt - b.revertedAt);
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
      regions: Object.keys(exp.regions || {}).length,
    };
  }

  Object.assign(DE, {
    BUILD, BUILD_DATE, deriveParams, createExpedition, expand, commit, canRevert, revert, setCaps,
    canCarve, carve, uncarve, restorable, restore, tagTraces, replay, exportRecord, importRecord, rebuildRegistry,
    pathToRoot, cycleCount, stats, parseKey, imprintAt, reservedAt, heldAt, holdLostPaths, canReserve, reserve,
  });
})(typeof window !== 'undefined' ? window : globalThis);
