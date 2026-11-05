// Top-down Canvas 2D renderer. Reads engine data only; no generation logic.
// Lives on its own `DungeonApp` global so the engine never depends on it.
(function (global) {
  'use strict';

  const DE = global.DungeonEngine;
  const CELL = 24; // px per cell at scale 1
  const MIN_SCALE = 0.03; // far enough out to see a thousand rooms at once

  // ---------------------------------------------------------------------------
  // Room contents (engine/contents.js), for the map's overlay and counts.

  // Colours for the overlay: the same in light and dark (mid tones read on both).
  const CONTENT_COLORS = {
    prop: null, crate: '#a0703c',
    shard: '#3fb6c9', key: '#d9a52f', doorstone: '#8d8577', jar: '#7fb0d8', chalk: '#e6e0d2',
    hourglass: '#c9a36a', coin: '#d9a52f', purse: '#b07a46', backpack: '#8b6b4a',
    sigil: '#8f5bd6', well: '#2f7fd1', chest: '#9b6a2f', vessel: '#5fa082', sconce: '#e07a2a', hall: '#efe3c0',
    lock: '#d0392b', ghost: '#9fb4cc', pixie: '#f2cf3a', creeper: '#8e2fa8',
  };

  /**
   * Everything a room holds, from DungeonPlay, cached per room. What a room
   * holds depends only on its seed and doors, so the cache keeps until a
   * door is added; locks (opened or not) and the ghost (which follows
   * imprints) are cheap, and worked out fresh each time.
   */
  const contentCache = new Map();
  function roomContents(exp, sp) {
    const DP = global.DungeonPlay;
    if (!DP) return null;
    const k = sp.seed + '|' + sp.exits.length;
    let c = contentCache.get(sp.id);
    if (!c || c.k !== k) {
      const cells = sp.cells.map(DE.parseKey);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of cells) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + 1); y1 = Math.max(y1, p.y + 1); }
      const hall = sp.archetype === 'hall';
      c = {
        k, box: { x0, y0, x1, y1 },
        props: DP.props(sp).blocks, push: DP.pushBlocks(sp), items: DP.loot(sp),
        sigil: DP.sigil(sp), well: DP.well(sp), chest: DP.chest(sp), vessel: DP.vessel(sp), sconces: DP.sconces(sp),
        hall: hall ? [DP.waystone(sp), DP.saveLantern(sp)].filter(Boolean) : [],
        pixie: DP.pixieSpawn(sp), creeper: DP.creeperSpawn(sp),
      };
      contentCache.set(sp.id, c);
    }
    c.locks = sp.exits.filter((e) => DP.isLocked(sp, e));
    c.ghost = DP.ghostSpawn(sp, exp);
    return c;
  }

  /** Totals across the map: { props, crates, push, items, sigil, ... }. */
  function contentCounts(exp) {
    const n = { props: 0, crates: 0, push: 0, items: 0, chest: 0, vessel: 0, sigil: 0, well: 0, sconce: 0, lock: 0, ghost: 0, pixie: 0, creeper: 0 };
    for (const id in exp.spaces) {
      const c = roomContents(exp, exp.spaces[id]);
      if (!c) return null;
      for (const b of c.props) { if (b.crate) n.crates++; else n.props++; }
      n.push += c.push.length; n.items += c.items.length; n.sconce += c.sconces.length; n.lock += c.locks.length;
      for (const f of ['chest', 'vessel', 'sigil', 'well', 'ghost', 'pixie', 'creeper']) if (c[f]) n[f]++;
    }
    return n;
  }

  function createRenderer(canvas) {
    const ctx = canvas.getContext('2d');
    const view = { x: 0, y: 0, scale: 1 }; // world cell coords at screen center
    let colors = null;

    function readColors() {
      const cs = getComputedStyle(document.documentElement);
      const v = (n) => cs.getPropertyValue(n).trim();
      colors = {
        bg: v('--map-bg'), grid: v('--map-grid'), ink: v('--map-ink'),
        floorL: +v('--floor-l') || 88, floorS: +v('--floor-s') || 18,
        open: v('--exit-open'), ghost: v('--ghost'), select: v('--select'),
        path: v('--path'), label: v('--map-label'),
      };
    }

    function resize() {
      const dpr = global.devicePixelRatio || 1;
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
    }

    function px() { return CELL * view.scale * (global.devicePixelRatio || 1); }

    /** CSS-pixel offset within the canvas -> fractional world cell coords. */
    function screenToWorld(sx, sy) {
      const dpr = global.devicePixelRatio || 1;
      const s = px();
      return { x: view.x + (sx * dpr - canvas.width / 2) / s, y: view.y + (sy * dpr - canvas.height / 2) / s };
    }

    function exitMarker(ex) {
      const d = DE.DIRS[ex.facing];
      return { x: ex.cell.x + 0.5 + d.x * 0.5, y: ex.cell.y + 0.5 + d.y * 0.5 };
    }

    /** What's under a CSS-pixel point: an open exit, else a space, else null. */
    function hitTest(exp, sx, sy) {
      const w = screenToWorld(sx, sy);
      const radius = Math.max(0.45, 14 / (CELL * view.scale)); // stay tappable when zoomed out
      let best = null;
      for (const id in exp.spaces) {
        for (const ex of exp.spaces[id].exits) {
          if (ex.connectionId || ex.kind === 'surface') continue; // the surface door never opens
          const m = exitMarker(ex);
          const dist = Math.hypot(m.x - w.x, m.y - w.y);
          if (dist < radius && (!best || dist < best.dist)) best = { type: 'exit', spaceId: id, exitId: ex.id, dist };
        }
      }
      if (best) return best;
      const owner = exp.registry[DE.key(Math.floor(w.x), Math.floor(w.y))];
      return owner !== undefined ? { type: 'space', spaceId: owner } : null;
    }

    function centroid(space) {
      let x = 0, y = 0;
      for (const k of space.cells) { const c = DE.parseKey(k); x += c.x + 0.5; y += c.y + 0.5; }
      return { x: x / space.cells.length, y: y / space.cells.length };
    }

    function draw(state) {
      if (!colors) readColors();
      const { exp, candidate, selectedId, toggles } = state;
      const s = px();
      const W = canvas.width, H = canvas.height;
      const ox = W / 2 - view.x * s, oy = H / 2 - view.y * s;
      const X = (wx) => ox + wx * s, Y = (wy) => oy + wy * s;

      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, W, H);

      if (toggles.grid && s >= 6) {
        ctx.strokeStyle = colors.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const x0 = Math.floor(view.x - W / 2 / s), x1 = Math.ceil(view.x + W / 2 / s);
        const y0 = Math.floor(view.y - H / 2 / s), y1 = Math.ceil(view.y + H / 2 / s);
        for (let x = x0; x <= x1; x++) { ctx.moveTo(Math.round(X(x)) + 0.5, 0); ctx.lineTo(Math.round(X(x)) + 0.5, H); }
        for (let y = y0; y <= y1; y++) { ctx.moveTo(0, Math.round(Y(y)) + 0.5); ctx.lineTo(W, Math.round(Y(y)) + 0.5); }
        ctx.stroke();
      }

      const drawSpace = (space, ghost) => {
        const set = new Set(space.cells);
        ctx.globalAlpha = ghost ? 0.55 : 1;
        ctx.fillStyle = ghost ? colors.ghost : `hsl(${space.meta.hue}, ${colors.floorS}%, ${colors.floorL}%)`;
        for (const k of space.cells) {
          const c = DE.parseKey(k);
          ctx.fillRect(X(c.x), Y(c.y), s + 0.5, s + 0.5);
        }
        if (toggles.occupancy && !ghost) {
          ctx.fillStyle = `hsla(${(parseInt(space.id.slice(1), 10) * 47) % 360}, 80%, 50%, 0.35)`;
          for (const k of space.cells) { const c = DE.parseKey(k); ctx.fillRect(X(c.x), Y(c.y), s, s); }
        }
        // Walls on every boundary edge, except where an exit sits.
        const exitAt = {};
        for (const ex of space.exits) exitAt[DE.key(ex.cell.x, ex.cell.y) + ex.facing] = ex;
        ctx.strokeStyle = colors.ink;
        ctx.lineWidth = Math.max(1.5, s * 0.12);
        ctx.lineCap = 'square';
        ctx.setLineDash(ghost ? [s * 0.25, s * 0.2] : []);
        ctx.beginPath();
        const edge = (c, f, from, to) => {
          // from/to are 0..1 along the edge, so exits can leave a centered gap.
          const ax = { N: [0, 0, 1, 0], S: [0, 1, 1, 1], W: [0, 0, 0, 1], E: [1, 0, 1, 1] }[f];
          const x0 = c.x + ax[0] + (ax[2] - ax[0]) * from, y0 = c.y + ax[1] + (ax[3] - ax[1]) * from;
          const x1 = c.x + ax[0] + (ax[2] - ax[0]) * to, y1 = c.y + ax[1] + (ax[3] - ax[1]) * to;
          ctx.moveTo(X(x0), Y(y0)); ctx.lineTo(X(x1), Y(y1));
        };
        for (const k of space.cells) {
          const c = DE.parseKey(k);
          for (const f of DE.FACINGS) {
            const n = DE.step(c, f);
            if (set.has(DE.key(n.x, n.y))) continue;
            if (exitAt[k + f]) { edge(c, f, 0, 0.2); edge(c, f, 0.8, 1); } else edge(c, f, 0, 1);
          }
        }
        ctx.stroke();
        ctx.setLineDash([]);
        // Unresolved exits: a marked, clickable doorway.
        for (const ex of space.exits) {
          if (ex.connectionId) continue;
          const m = exitMarker(ex);
          const r = Math.max(3, s * 0.22);
          ctx.fillStyle = ex.kind === 'surface' ? '#dcebff' : colors.open;
          ctx.beginPath();
          ctx.arc(X(m.x), Y(m.y), r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      };

      // Traces of reverted spaces: greyed and dashed, under everything live.
      const traces = Object.values(exp.traces || {}).filter((t) => t.cause !== 'faded');
      if (traces.length) {
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = colors.ghost;
        for (const t of traces) for (const k of t.cells) {
          const c = DE.parseKey(k);
          ctx.fillRect(X(c.x), Y(c.y), s + 0.5, s + 0.5);
        }
        ctx.globalAlpha = 1;
      }

      for (const id in exp.spaces) drawSpace(exp.spaces[id], false);

      // Live cells standing on a trace carry its imprint: a hatch mark.
      if (traces.length && s >= 4) {
        ctx.strokeStyle = colors.ghost;
        ctx.lineWidth = Math.max(1, s * 0.06);
        ctx.beginPath();
        for (const id in exp.spaces) for (const k of exp.spaces[id].cells) {
          if (!DE.imprintAt(exp, k).length) continue;
          const c = DE.parseKey(k);
          ctx.moveTo(X(c.x + 0.25), Y(c.y + 0.75)); ctx.lineTo(X(c.x + 0.75), Y(c.y + 0.25));
        }
        ctx.stroke();
      }

      if (state.show && Object.values(state.show).some(Boolean)) drawContents(exp, state.show, s, X, Y, W, H);

      if (toggles.path && selectedId && exp.spaces[selectedId]) {
        const path = DE.pathToRoot(exp, selectedId).map((id) => centroid(exp.spaces[id]));
        ctx.strokeStyle = colors.path;
        ctx.lineWidth = Math.max(2, s * 0.12);
        ctx.setLineDash([s * 0.3, s * 0.2]);
        ctx.beginPath();
        path.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (selectedId && exp.spaces[selectedId]) {
        const sp = exp.spaces[selectedId];
        ctx.fillStyle = colors.select;
        ctx.globalAlpha = 0.18;
        for (const k of sp.cells) { const c = DE.parseKey(k); ctx.fillRect(X(c.x), Y(c.y), s, s); }
        ctx.globalAlpha = 1;
      }

      if (candidate) {
        if (candidate.type === 'space') {
          drawSpace(candidate.space, true);
        } else {
          // Loop: highlight the doorway it would knock through.
          const c = candidate.cell;
          ctx.strokeStyle = colors.open;
          ctx.lineWidth = Math.max(2, s * 0.15);
          ctx.strokeRect(X(c.x) + 2, Y(c.y) + 2, s - 4, s - 4);
        }
      }

      if (toggles.labels && s >= 14) {
        ctx.fillStyle = colors.label;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${Math.round(Math.min(13 * (global.devicePixelRatio || 1), s * 0.42))}px ui-monospace, Menlo, monospace`;
        for (const id in exp.spaces) {
          const sp = exp.spaces[id];
          const p = centroid(sp);
          ctx.fillText(sp.id, X(p.x), Y(p.y) - s * 0.25);
          ctx.fillText(sp.seed.slice(0, 6), X(p.x), Y(p.y) + s * 0.25);
        }
      }
    }

    /**
     * The contents overlay. Up close, everything where it stands; far out
     * (a few px per cell), only what tells you about the dungeon as a whole
     * (creatures, locks, push blocks, wells, sigils) as dots big enough to see.
     */
    function drawContents(exp, show, s, X, Y, W, H) {
      const C = CONTENT_COLORS;
      const near = s >= 7;
      const dot = (x, y, r, color) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X(x), Y(y), r, 0, Math.PI * 2); ctx.fill(); };
      const rectW = (x0, y0, x1, y1) => ctx.fillRect(X(x0), Y(y0), (x1 - x0) * s, (y1 - y0) * s);
      const minR = 2.2 * (global.devicePixelRatio || 1);
      const big = Math.max(minR, s * 0.28), mid = Math.max(minR * 0.8, s * 0.16), small = Math.max(1, s * 0.1);
      const creatures = [];
      for (const id in exp.spaces) {
        const sp = exp.spaces[id];
        const c = roomContents(exp, sp);
        if (!c) return;
        const b = c.box; // off screen: skip
        if (X(b.x1) < 0 || X(b.x0) > W || Y(b.y1) < 0 || Y(b.y0) > H) continue;

        if (show.props && near) {
          for (const p of c.props) {
            ctx.fillStyle = p.crate ? C.crate : colors.ink;
            ctx.globalAlpha = p.crate ? 0.85 : 0.18 + 0.12 * p.units;
            rectW(p.x0, p.y0, p.x1, p.y1);
          }
          ctx.globalAlpha = 1;
        }
        if (show.push) {
          for (const pb of c.push) {
            const fx = pb.from.sx / 2, fy = pb.from.sy / 2, tx = pb.to.sx / 2, ty = pb.to.sy / 2;
            if (!near) { dot(fx + 0.25, fy + 0.25, mid, pb.color); continue; }
            ctx.strokeStyle = pb.color; ctx.lineWidth = Math.max(1, s * 0.05);
            ctx.setLineDash([s * 0.08, s * 0.08]);
            ctx.beginPath(); ctx.moveTo(X(fx + 0.25), Y(fy + 0.25)); ctx.lineTo(X(tx + 0.25), Y(ty + 0.25)); ctx.stroke();
            ctx.setLineDash([]);
            ctx.strokeRect(X(tx + 0.04), Y(ty + 0.04), s * 0.42, s * 0.42); // its home mark
            ctx.fillStyle = pb.color; rectW(fx + 0.04, fy + 0.04, fx + 0.46, fy + 0.46);
          }
        }
        if (show.items && near) {
          c.items.forEach((it, i) => {
            const col = it.kind === 'chalk' && it.color && C[it.color] ? C[it.color] : C[it.kind] || colors.ink;
            dot(it.cell.x + 0.3 + (i % 3) * 0.2, it.cell.y + 0.35 + Math.floor(i / 3) * 0.3, small * 1.3, col);
          });
        }
        if (show.features) {
          if (c.sigil) { // a diamond
            const x = X(c.sigil.cell.x + 0.5), y = Y(c.sigil.cell.y + 0.5), r = near ? s * 0.32 : mid * 1.2;
            ctx.fillStyle = C.sigil; ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.fill();
          }
          if (c.well) { // a ring
            ctx.strokeStyle = C.well; ctx.lineWidth = Math.max(1.5, s * 0.08);
            ctx.beginPath(); ctx.arc(X(c.well.cell.x + 0.5), Y(c.well.cell.y + 0.5), near ? s * 0.3 : mid, 0, Math.PI * 2); ctx.stroke();
          }
          if (near) {
            if (c.chest) { ctx.fillStyle = C.chest; rectW(c.chest.sx / 2 + 0.05, c.chest.sy / 2 + 0.1, c.chest.sx / 2 + 0.45, c.chest.sy / 2 + 0.4); }
            if (c.vessel) dot(c.vessel.sx / 2 + 0.25, c.vessel.sy / 2 + 0.25, s * 0.15, C.vessel);
            for (const h of c.hall) { ctx.fillStyle = C.hall; rectW(h.x0, h.y0, h.x1, h.y1); }
            ctx.fillStyle = C.sconce;
            for (const sc of c.sconces) {
              const d = DE.DIRS[sc.facing];
              const x = sc.cell.x + 0.5 + d.x * 0.42, y = sc.cell.y + 0.5 + d.y * 0.42;
              rectW(x - 0.08, y - 0.08, x + 0.08, y + 0.08);
            }
          }
        }
        if (show.locks) {
          for (const e of c.locks) {
            const d = DE.DIRS[e.facing];
            const x = X(e.cell.x + 0.5 + d.x * 0.5), y = Y(e.cell.y + 0.5 + d.y * 0.5), r = Math.max(minR * 1.2, s * 0.2);
            ctx.fillStyle = C.lock; ctx.fillRect(x - r, y - r, r * 2, r * 2);
          }
        }
        if (show.creatures) {
          if (c.ghost) creatures.push(['ghost', c.ghost]);
          if (c.pixie) creatures.push(['pixie', c.pixie]);
          if (c.creeper) creatures.push(['creeper', c.creeper]);
        }
      }
      // Creatures last, on top of everything, each where it starts.
      const label = s >= 16;
      if (label) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `bold ${Math.round(s * 0.32)}px ui-monospace, Menlo, monospace`;
      }
      for (const [kind, cell] of creatures) {
        dot(cell.x + 0.5, cell.y + 0.5, big, C[kind]);
        if (label) { ctx.fillStyle = kind === 'pixie' ? '#3a3000' : '#fff'; ctx.fillText(kind[0].toUpperCase(), X(cell.x + 0.5), Y(cell.y + 0.52)); }
      }
    }

    function centerOn(x, y) { view.x = x; view.y = y; }

    /** Zoom by `factor`, keeping the world point under (sx, sy) fixed. */
    function zoomAt(sx, sy, factor) {
      const before = screenToWorld(sx, sy);
      view.scale = Math.min(6, Math.max(MIN_SCALE, view.scale * factor));
      const after = screenToWorld(sx, sy);
      view.x += before.x - after.x;
      view.y += before.y - after.y;
    }

    function panBy(dxCss, dyCss) {
      const s = CELL * view.scale;
      view.x -= dxCss / s;
      view.y -= dyCss / s;
    }

    /** Fit the whole expedition in view. */
    function fit(exp) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const k in exp.registry) {
        const c = DE.parseKey(k);
        minX = Math.min(minX, c.x); minY = Math.min(minY, c.y);
        maxX = Math.max(maxX, c.x + 1); maxY = Math.max(maxY, c.y + 1);
      }
      if (!isFinite(minX)) return;
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return; // not laid out yet (a hidden pane)
      view.x = (minX + maxX) / 2;
      view.y = (minY + maxY) / 2;
      const sx = r.width / ((maxX - minX + 4) * CELL), sy = r.height / ((maxY - minY + 4) * CELL);
      view.scale = Math.min(2, Math.max(MIN_SCALE, Math.min(sx, sy)));
    }

    return { view, resize, draw, hitTest, screenToWorld, centerOn, zoomAt, panBy, fit, readColors };
  }

  global.DungeonApp = global.DungeonApp || {};
  global.DungeonApp.createRenderer = createRenderer;
  global.DungeonApp.roomContents = roomContents;
  global.DungeonApp.contentCounts = contentCounts;
})(window);
