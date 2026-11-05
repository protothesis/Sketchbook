// The map's region layer: where each region lies, drawn under the rooms
// (a soft fill one cell past its rooms, so it shows in the gaps), with an
// outline just inside its edge and a label. Reads engine data only.
//
// A region's ground: its rooms' cells, what it has claimed and not built
// yet (cloister walks and courtyards, hatched), and a one-cell margin
// around both that no other region's ground takes.
(function (global) {
  'use strict';

  const DE = global.DungeonEngine;

  // Colours, the same in light and dark (mid tones read on both).
  const TYPE_COLORS = { meander: '#d08a3c', catacomb: '#4f86d6', cloister: '#3fae7a' };
  const MOOD_COLORS = {
    still: '#9aa3ad', damp: '#3f9aa8', humming: '#c9a632', cold: '#6aa9e8', echoing: '#8a76d6',
    dusty: '#b58a5e', breathing: '#d0689a', tilted: '#7fbf4a', warm: '#e0763a', hollow: '#6d7c8f',
  };

  /** A region's colour under a colouring ('type' | 'mood' | 'region'). */
  function colorOf(g, by) {
    if (by === 'mood') return MOOD_COLORS[g.mood] || '#999';
    if (by === 'region') return `hsl(${g.hue}, 55%, 55%)`;
    return TYPE_COLORS[g.type] || '#999';
  }

  const NEAR8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const num = (id) => parseInt(id.slice(1), 10);

  /**
   * Where every region lies, and a few numbers about each. Cached until the
   * expedition's history moves on.
   *   ground:  Map "x,y" -> { regionId, kind: 'room' | 'claim' | 'void' | 'margin' }
   *   regions: { id: { g, rooms, spent, cells, roles, claims, label: {x, y}, box } }
   */
  let cache = null;
  function layout(exp) {
    if (cache && cache.exp === exp && cache.n === exp.history.length) return cache.data;
    const ground = new Map();
    const regions = {};
    const info = (id) => regions[id] || (regions[id] = {
      g: exp.regions[id], rooms: 0, spent: 0, cells: 0, roles: {}, claims: 0,
      sx: 0, sy: 0, box: { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }, roomCells: [],
    });
    const grow = (r, c) => {
      r.box.x0 = Math.min(r.box.x0, c.x); r.box.y0 = Math.min(r.box.y0, c.y);
      r.box.x1 = Math.max(r.box.x1, c.x + 1); r.box.y1 = Math.max(r.box.y1, c.y + 1);
    };
    for (const id in exp.spaces) {
      const sp = exp.spaces[id];
      if (!sp.regionId || !exp.regions[sp.regionId]) continue;
      const r = info(sp.regionId);
      r.rooms++;
      r.roles[sp.role] = (r.roles[sp.role] || 0) + 1;
      for (const k of sp.cells) {
        const c = DE.parseKey(k);
        ground.set(k, { regionId: sp.regionId, kind: 'room' });
        r.cells++; r.sx += c.x + 0.5; r.sy += c.y + 0.5; r.roomCells.push(c); grow(r, c);
      }
    }
    // Claimed and not built (and not dormant): a cloister's walks and courtyard.
    for (const rid in exp.reserves || {}) {
      const res = exp.reserves[rid];
      if (!res.regionId || res.spaceId || res.dormant || !exp.regions[res.regionId]) continue;
      const r = info(res.regionId);
      r.claims++;
      for (const k of res.cells) {
        if (ground.has(k)) continue;
        ground.set(k, { regionId: res.regionId, kind: res.kind === 'void' ? 'void' : 'claim' });
        grow(r, DE.parseKey(k));
      }
    }
    // A one-cell margin, to the oldest region next to it.
    const margin = new Map();
    for (const [k, v] of ground) {
      const c = DE.parseKey(k);
      for (const [dx, dy] of NEAR8) {
        const nk = DE.key(c.x + dx, c.y + dy);
        if (ground.has(nk)) continue;
        const prev = margin.get(nk);
        if (!prev || num(v.regionId) < num(prev)) margin.set(nk, v.regionId);
      }
    }
    for (const [k, id] of margin) ground.set(k, { regionId: id, kind: 'margin' });

    for (const id in regions) {
      const r = regions[id];
      r.spent = DE.regionSpent(exp, id);
      // Label on the room cell nearest the middle of its rooms.
      const mx = r.cells ? r.sx / r.cells : (r.box.x0 + r.box.x1) / 2, my = r.cells ? r.sy / r.cells : (r.box.y0 + r.box.y1) / 2;
      let best = null, bd = Infinity;
      for (const c of r.roomCells) {
        const d = Math.hypot(c.x + 0.5 - mx, c.y + 0.5 - my);
        if (d < bd) { bd = d; best = c; }
      }
      r.label = best ? { x: best.x + 0.5, y: best.y + 0.5 } : { x: mx, y: my };
      delete r.roomCells; delete r.sx; delete r.sy;
    }
    const data = { ground, regions };
    cache = { exp, n: exp.history.length, data };
    return data;
  }

  /** The region whose ground is under this cell, or null. */
  function regionAt(exp, x, y) {
    const v = layout(exp).ground.get(DE.key(x, y));
    return v ? v.regionId : null;
  }

  /** "g3 catacomb · damp · 7/12" */
  function labelOf(r) {
    return `${r.g.id} ${r.g.type} · ${r.g.mood} · ${r.spent}/${r.g.size}`;
  }

  /** Under the rooms: each region's ground, a soft fill (claims hatched). */
  function drawUnder(ctx, exp, by, s, X, Y) {
    const { ground } = layout(exp);
    const alpha = { margin: 0.22, room: 0.3, claim: 0.34, void: 0.2 };
    for (const [k, v] of ground) {
      const c = DE.parseKey(k);
      ctx.globalAlpha = alpha[v.kind];
      ctx.fillStyle = colorOf(exp.regions[v.regionId], by);
      ctx.fillRect(X(c.x), Y(c.y), s + 0.5, s + 0.5);
    }
    // Claimed, unbuilt ground: hatched in its region's colour.
    if (s >= 4) {
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = Math.max(1, s * 0.05);
      for (const [k, v] of ground) {
        if (v.kind !== 'claim' && v.kind !== 'void') continue;
        const c = DE.parseKey(k);
        ctx.strokeStyle = colorOf(exp.regions[v.regionId], by);
        ctx.beginPath();
        for (const t of v.kind === 'void' ? [0.5] : [0.25, 0.75]) {
          ctx.moveTo(X(c.x), Y(c.y + t)); ctx.lineTo(X(c.x + t), Y(c.y));
          ctx.moveTo(X(c.x + t), Y(c.y + 1)); ctx.lineTo(X(c.x + 1), Y(c.y + t));
        }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Over the rooms: each region's outline, just inside its edge, in its
   * colour. `only` (a Set of region ids) draws just those, heavier, with a
   * wash over their ground: the highlight for hovering and selecting.
   */
  function drawOutlines(ctx, exp, by, s, X, Y, only) {
    const { ground } = layout(exp);
    const inset = only ? 0.1 : 0.14;
    ctx.lineWidth = only ? Math.max(2.5, s * 0.16) : Math.max(1.2, s * 0.07);
    ctx.lineCap = 'butt';
    const byRegion = new Map();
    for (const [k, v] of ground) {
      if (only && !only.has(v.regionId)) continue;
      const c = DE.parseKey(k);
      let segs = byRegion.get(v.regionId);
      if (!segs) byRegion.set(v.regionId, (segs = []));
      const other = (dx, dy) => { const n = ground.get(DE.key(c.x + dx, c.y + dy)); return !n || n.regionId !== v.regionId; };
      if (other(0, -1)) segs.push([c.x, c.y + inset, c.x + 1, c.y + inset]);
      if (other(0, 1)) segs.push([c.x, c.y + 1 - inset, c.x + 1, c.y + 1 - inset]);
      if (other(-1, 0)) segs.push([c.x + inset, c.y, c.x + inset, c.y + 1]);
      if (other(1, 0)) segs.push([c.x + 1 - inset, c.y, c.x + 1 - inset, c.y + 1]);
    }
    if (only) { // a wash over the highlighted regions' ground
      ctx.globalAlpha = 0.28;
      for (const [k, v] of ground) {
        if (!only.has(v.regionId)) continue;
        const c = DE.parseKey(k);
        ctx.fillStyle = colorOf(exp.regions[v.regionId], by);
        ctx.fillRect(X(c.x), Y(c.y), s + 0.5, s + 0.5);
      }
    }
    ctx.globalAlpha = only ? 1 : 0.85;
    for (const [id, segs] of byRegion) {
      ctx.strokeStyle = colorOf(exp.regions[id], by);
      ctx.beginPath();
      for (const [x0, y0, x1, y1] of segs) { ctx.moveTo(X(x0), Y(y0)); ctx.lineTo(X(x1), Y(y1)); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * A region's label at a level of detail: far out just its id, then its
   * structure and mood, and close in its budget too.
   */
  function labelText(r, s) {
    if (s < 10) return r.g.id;
    if (s < 20) return `${r.g.id} ${r.g.type} · ${r.g.mood}`;
    return `${labelOf(r)} rooms`;
  }

  /**
   * Labels for the regions in `list` ([{ id, by }], most important first),
   * each pinned just above the top-left corner of its region's ground. A
   * label that would overlap one already drawn is left out, so a crowd of
   * highlighted regions stays readable: zoom in and more of them fit.
   */
  function drawLabels(ctx, exp, list, s, X, Y, dpr) {
    const { regions } = layout(exp);
    const size = Math.round(Math.max(10 * dpr, Math.min(13 * dpr, s * 0.45)));
    ctx.font = `600 ${size}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const placed = [];
    const seen = new Set();
    for (const { id, by } of list) {
      const r = regions[id];
      if (!r || seen.has(id)) continue;
      seen.add(id);
      const text = labelText(r, s);
      const w = ctx.measureText(text).width + size * 1.1, h = size * 1.5;
      const x = X(r.box.x0), y = Y(r.box.y0) - h - 2 * dpr;
      if (placed.some((q) => x < q.x + q.w && x + w > q.x && y < q.y + q.h && y + h > q.y)) continue;
      placed.push({ x, y, w, h });
      ctx.fillStyle = 'rgba(20, 18, 15, 0.86)';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = colorOf(r.g, by);
      ctx.fillRect(x, y, size * 0.3, h);
      ctx.fillStyle = '#f2ede2';
      ctx.fillText(text, x + size * 0.6, y + h / 2);
    }
  }

  /** Numbers for the panel: { count, mean, max, maxId, types: {t: {regions, rooms}}, moods: {m: {regions, rooms}} }. */
  function summary(exp) {
    const { regions } = layout(exp);
    const ids = Object.keys(regions);
    const out = { count: ids.length, mean: 0, max: 0, maxId: null, types: {}, moods: {} };
    for (const id of ids) {
      const r = regions[id];
      out.mean += r.rooms;
      if (r.rooms > out.max) { out.max = r.rooms; out.maxId = id; }
      for (const [bucket, k] of [[out.types, r.g.type], [out.moods, r.g.mood]]) {
        const b = bucket[k] || (bucket[k] = { regions: 0, rooms: 0 });
        b.regions++; b.rooms += r.rooms;
      }
    }
    out.mean = ids.length ? out.mean / ids.length : 0;
    return out;
  }

  global.DungeonApp = global.DungeonApp || {};
  global.DungeonApp.regions = { TYPE_COLORS, MOOD_COLORS, colorOf, layout, regionAt, labelOf, labelText, drawUnder, drawOutlines, drawLabels, summary };
})(window);
