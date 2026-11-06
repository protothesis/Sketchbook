// Growing an expedition in bulk: open many doors at once, to see the shape
// a dungeon takes at hundreds of rooms instead of one room at a time.
//
// It is only a loop over the ordinary API: expand + commit, every result
// kept, no rerolls, reverts or faints. So a grown dungeon is an ordinary
// expedition: it saves, replays and exports like one you opened by hand,
// and its rooms are exactly the rooms those doors would have given.
//
// The shape depends mostly on which door is opened next (`order`):
//   random    any open door, all equally likely
//   breadth   the shallowest door first (fills in near the start, bushy)
//   depth     the deepest door first (pushes on, long winding branches)
//
// Deterministic: the doors picked and each door's entropy come from `seed`
// (by default the root seed and the history so far), so the same seed,
// count and order grow the same dungeon.
(function (global) {
  'use strict';

  const DE = (global.DungeonEngine = global.DungeonEngine || {});

  const ORDERS = ['random', 'breadth', 'depth'];

  /** Space ids at or beyond `fromId` in the generation tree (a Set), or null for everywhere. */
  function subtree(exp, fromId) {
    if (!fromId || !exp.spaces[fromId]) return null;
    const kids = {};
    for (const id in exp.spaces) {
      const p = exp.spaces[id].parentId;
      if (p) (kids[p] = kids[p] || []).push(id);
    }
    const out = new Set();
    const q = [fromId];
    while (q.length) { const id = q.pop(); out.add(id); (kids[id] || []).forEach((k) => q.push(k)); }
    return out;
  }

  const num = (id) => parseInt(id.slice(1), 10);

  /**
   * The doors grow can open: unresolved, not the surface door, not one that
   * already failed, and (with `within`) on a space in that set. In a stable
   * order: oldest space first, then exit index.
   */
  function frontier(exp, within, failed) {
    const out = [];
    for (const id in exp.spaces) {
      if (within && !within.has(id)) continue;
      const sp = exp.spaces[id];
      for (const ex of sp.exits) {
        if (ex.connectionId || ex.kind === 'surface' || failed.has(id + '/' + ex.id)) continue;
        out.push({ space: sp, exit: ex });
      }
    }
    return out.sort((a, b) => num(a.space.id) - num(b.space.id) || a.exit.index - b.exit.index);
  }

  /**
   * Open doors until `rooms` new spaces stand (or no door is left).
   *   opts.rooms   new spaces to add (default 100)
   *   opts.order   'random' | 'breadth' | 'depth' (default 'random')
   *   opts.from    a space id: only grow that space's branch
   *   opts.seed    picks doors and entropy (default: root seed + history length)
   * Loops (a door opening onto a space already there) are committed too,
   * but don't count as rooms. Returns { rooms, loops, failed, open }.
   */
  function grow(exp, opts) {
    const o = opts || {};
    const want = o.rooms == null ? 100 : o.rooms;
    const order = ORDERS.includes(o.order) ? o.order : 'random';
    const seed = o.seed != null ? String(o.seed) : DE.hash(exp.rootSeed, 'grow', exp.history.length);
    const rng = DE.createRng(DE.hash(seed, 'pick'));
    let within = subtree(exp, o.from);
    const failed = new Set();
    const res = { rooms: 0, loops: 0, failed: 0, open: 0 };
    let n = 0;
    while (res.rooms < want) {
      const doors = frontier(exp, within, failed);
      if (!doors.length) break;
      let pick;
      if (order === 'random') pick = doors[Math.floor(rng.next() * doors.length)];
      else {
        // The shallowest (breadth) or deepest (depth) space, the oldest or
        // newest of those; then any of its doors, picked at random. (Taking
        // its first door always took a corridor's far tip, so depth-first
        // never turned off down a side door.)
        let best = doors[0].space;
        for (const d of doors) {
          const s = d.space;
          const better = order === 'breadth'
            ? s.depth < best.depth || (s.depth === best.depth && num(s.id) < num(best.id))
            : s.depth > best.depth || (s.depth === best.depth && num(s.id) > num(best.id));
          if (better) best = s;
        }
        const own = doors.filter((d) => d.space === best);
        pick = own[Math.floor(rng.next() * own.length)];
      }
      const tag = pick.space.id + '/' + pick.exit.id;
      let cand = null;
      try { cand = DE.expand(exp, pick.space.id, pick.exit.id, DE.hash(seed, 'door', n++)); } catch (e) { cand = null; }
      if (!cand) { failed.add(tag); res.failed++; continue; }
      const id = DE.commit(exp, cand);
      if (cand.type === 'loop') res.loops++;
      else { res.rooms++; if (within) within.add(id); }
    }
    res.open = frontier(exp, null, new Set()).length;
    return res;
  }

  Object.assign(DE, { GROW_ORDERS: ORDERS, grow, subtree });
})(typeof window !== 'undefined' ? window : globalThis);
