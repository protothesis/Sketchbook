// Walk mode: the creature kit. What every creature shares, whatever kind
// it is: getting around (half-cell paths around blocks and through open
// doors, drifting toward a point without passing walls) and the lantern's
// light (does it reach a point?). Ghosts (ghosts.js) and shadow creepers
// (creepers.js) are their own types and use these; so can creatures to come.
// A creature is any object with { x, y } in cells; for paths it also keeps
// { next, pathT }, and it can set its own `tall` (cells: blocks taller than
// this are in its way; 0 for a walker, so every block is) and `radius`.
// Other shared pieces live with what they serve: off-screen markers
// (markers.js), screen effects (fx.js), the ecology's rules (ecology.js).
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, THREE, UNIT, state, passable } = W;

  const CREATURE = {
    tall: 1.5 * UNIT,    // default: blocks taller than this are obstacles; lower ones it floats over
    radius: 0.14,        // kept this far from the sides of blocks in its way
    lightRange: 4.5,     // cells: lightReaches' default range, when no light is involved (a creeper's line of sight to you)
  };

  const blocksAt = (cx, cy) => state.blockAt.get(DE.key(cx, cy)) || [];

  /**
   * Is this half-cell taken by a block too tall to float over? `tall`
   * (cells) defaults to CREATURE.tall; 0 counts every block (walkers go
   * around them all).
   */
  function subBlocked(sx, sy, tall = CREATURE.tall) {
    const x = (sx + 0.5) / 2, y = (sy + 0.5) / 2;
    for (const b of blocksAt(Math.floor(x), Math.floor(y))) {
      if (!b.jar && b.top > tall && x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1) return true;
    }
    return false;
  }

  /** Top of the highest low block under a point (what a ghost floats over). */
  function lowBlockTop(x, y) {
    let top = 0;
    for (const b of blocksAt(Math.floor(x), Math.floor(y))) {
      if (b.top <= CREATURE.tall && x > b.x0 - 0.1 && x < b.x1 + 0.1 && y > b.y0 - 0.1 && y < b.y1 + 0.1) top = Math.max(top, b.top);
    }
    return top;
  }

  /** Does a ray (from f to t, both {x, y, h} in cells) pass through block b? */
  function rayHitsBlock(f, t, b) {
    let t0 = 0, t1 = 1;
    const axes = [[f.x, t.x - f.x, b.x0, b.x1], [f.y, t.y - f.y, b.y0, b.y1], [f.h, t.h - f.h, 0, b.top]];
    for (const [o, d, lo, hi] of axes) {
      if (Math.abs(d) < 1e-9) { if (o <= lo || o >= hi) return false; continue; }
      let a = (lo - o) / d, c = (hi - o) / d;
      if (a > c) { const s2 = a; a = c; c = s2; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, c);
      if (t0 >= t1) return false;
    }
    return t1 > 0.01 && t0 < 0.99;
  }

  /**
   * Does the lantern's light reach a point? A 3D ray from the lamp (its real
   * position and height, so crouching lowers it) to the target: in range,
   * not through a wall or closed door, and not through any block. This is
   * the same light that casts the shadows you see, so in shadow = unseen.
   * `range` (cells) defaults to CREATURE.lightRange.
   */
  function lightReaches(f, t, range) {
    const d = Math.hypot(t.x - f.x, t.y - f.y);
    if (d > (range || CREATURE.lightRange)) return false;
    const n = Math.max(1, Math.ceil(d / 0.08));
    let cx = Math.floor(f.x), cy = Math.floor(f.y);
    const cells = [[cx, cy]];
    for (let i = 1; i <= n; i++) {
      const nx = Math.floor(f.x + (t.x - f.x) * i / n), ny = Math.floor(f.y + (t.y - f.y) * i / n);
      if (nx === cx && ny === cy) continue;
      if (nx !== cx && ny !== cy) {
        if (!((passable(cx, cy, nx, cy) && passable(nx, cy, nx, ny)) ||
              (passable(cx, cy, cx, ny) && passable(cx, ny, nx, ny)))) return false;
        cells.push([nx, cy], [cx, ny]);
      } else if (!passable(cx, cy, nx, ny)) return false;
      cells.push([nx, ny]);
      cx = nx; cy = ny;
    }
    const seen = new Set();
    for (const [x, y] of cells) {
      for (const b of blocksAt(x, y)) {
        if (seen.has(b)) continue;
        seen.add(b);
        if (rayHitsBlock(f, t, b)) return false;
      }
    }
    return true;
  }

  /** Next half-cell on a shortest floating path (around blocks taller than `tall`, through open doors). */
  function nextSubToward(fsx, fsy, tsx, tsy, limit, tall) {
    const start = fsx + ',' + fsy, goal = tsx + ',' + tsy;
    if (start === goal) return null;
    const prev = new Map([[start, null]]);
    const q = [[fsx, fsy]];
    for (let h = 0; h < q.length && prev.size < limit; h++) {
      const [x, y] = q[h];
      const cx = Math.floor(x / 2), cy = Math.floor(y / 2);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
        if (prev.has(k)) continue;
        const ncx = Math.floor(nx / 2), ncy = Math.floor(ny / 2);
        if ((ncx !== cx || ncy !== cy) && !passable(cx, cy, ncx, ncy)) continue;
        if (ncx === cx && ncy === cy && state.exp.registry[DE.key(cx, cy)] === undefined) continue;
        if (subBlocked(nx, ny, tall) && k !== goal) continue;
        prev.set(k, x + ',' + y);
        if (k === goal) {
          let c = k;
          while (prev.get(c) !== start) c = prev.get(c);
          const [sx, sy] = c.split(',').map(Number);
          return { x: sx, y: sy };
        }
        q.push([nx, ny]);
      }
    }
    return undefined;
  }

  /**
   * Drift toward a point: only into cells it can float between and never
   * into a tall block (and kept a little clear of their sides). True on arrival.
   * A creature with its own `tall` (cells) treats blocks above that as tall.
   */
  function driftToward(g, tx, ty, speed, dt) {
    const tall = g.tall == null ? CREATURE.tall : g.tall;
    const radius = g.radius == null ? CREATURE.radius : g.radius;
    const dx = tx - g.x, dy = ty - g.y, d = Math.hypot(dx, dy);
    if (d < 0.02) return true;
    const step = Math.min(d, speed * dt);
    const nx = g.x + dx / d * step, ny = g.y + dy / d * step;
    const ox = Math.floor(g.x), oy = Math.floor(g.y);
    const ok = (x, y) => {
      const cx = Math.floor(x), cy = Math.floor(y);
      const cellOk = (cx === ox && cy === oy) || (Math.abs(cx - ox) + Math.abs(cy - oy) === 1 && passable(ox, oy, cx, cy));
      return cellOk && !subBlocked(Math.floor(x * 2), Math.floor(y * 2), tall);
    };
    if (ok(nx, ny)) { g.x = nx; g.y = ny; } else if (ok(nx, g.y)) g.x = nx; else if (ok(g.x, ny)) g.y = ny;
    // Keep the body off the sides of tall blocks.
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      for (const b of blocksAt(Math.floor(g.x) + i, Math.floor(g.y) + j)) {
        if (b.top <= tall) continue;
        const qx = THREE.MathUtils.clamp(g.x, b.x0, b.x1), qy = THREE.MathUtils.clamp(g.y, b.y0, b.y1);
        const ex = g.x - qx, ey = g.y - qy, e = Math.hypot(ex, ey);
        if (e > 1e-6 && e < radius) { g.x += ex / e * (radius - e); g.y += ey / e * (radius - e); }
      }
    }
    return d <= step + 0.02;
  }

  /** Steer half-cell by half-cell (around blocks, through doors), then straight to the goal. */
  function followPath(g, gx, gy, speed, dt) {
    g.pathT -= dt;
    const sx = Math.floor(g.x * 2), sy = Math.floor(g.y * 2);
    if (g.pathT <= 0 || (g.next && g.next.x === sx && g.next.y === sy)) {
      g.next = nextSubToward(sx, sy, Math.floor(gx * 2), Math.floor(gy * 2), 2400, g.tall == null ? CREATURE.tall : g.tall);
      g.pathT = 0.3;
    }
    if (g.next === undefined) return true; // no way through: give up on this goal
    if (g.next === null) return driftToward(g, gx, gy, speed, dt);
    driftToward(g, (g.next.x + 0.5) / 2, (g.next.y + 0.5) / 2, speed, dt);
    return false;
  }


  Object.assign(W, { CREATURE, blocksAt, subBlocked, lowBlockTop, lightReaches, nextSubToward, driftToward, followPath });
})(window);
