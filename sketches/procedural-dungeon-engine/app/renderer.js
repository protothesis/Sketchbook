// Top-down Canvas 2D renderer. Reads engine data only; no generation logic.
// Lives on its own `DungeonApp` global so the engine never depends on it.
(function (global) {
  'use strict';

  const DE = global.DungeonEngine;
  const CELL = 24; // px per cell at scale 1

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
          if (ex.connectionId) continue;
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
          ctx.fillStyle = colors.open;
          ctx.beginPath();
          ctx.arc(X(m.x), Y(m.y), r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      };

      for (const id in exp.spaces) drawSpace(exp.spaces[id], false);

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

    function centerOn(x, y) { view.x = x; view.y = y; }

    /** Zoom by `factor`, keeping the world point under (sx, sy) fixed. */
    function zoomAt(sx, sy, factor) {
      const before = screenToWorld(sx, sy);
      view.scale = Math.min(6, Math.max(0.08, view.scale * factor));
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
      view.x = (minX + maxX) / 2;
      view.y = (minY + maxY) / 2;
      const sx = r.width / ((maxX - minX + 4) * CELL), sy = r.height / ((maxY - minY + 4) * CELL);
      view.scale = Math.min(2, Math.max(0.08, Math.min(sx, sy)));
    }

    return { view, resize, draw, hitTest, screenToWorld, centerOn, zoomAt, panBy, fit, readColors };
  }

  global.DungeonApp = global.DungeonApp || {};
  global.DungeonApp.createRenderer = createRenderer;
})(window);
