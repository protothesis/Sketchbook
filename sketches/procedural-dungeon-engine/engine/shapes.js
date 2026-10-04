// Grid primitives and shape generators.
//
// A space is a set of cells, never "a rectangle" — rectangles (chambers) and
// 1-wide corridors are just the first two generators. Generators work in a
// travel frame: u runs in the direction you walked through the door, v runs to
// your right, and the entry cell is always (0, 0). placeShape() rotates that
// frame into world coordinates so the entry sits just beyond the parent exit.
(function (global) {
  'use strict';

  const DIRS = {
    N: { x: 0, y: -1 },
    E: { x: 1, y: 0 },
    S: { x: 0, y: 1 },
    W: { x: -1, y: 0 },
  };
  const FACINGS = ['N', 'E', 'S', 'W'];
  const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };
  const RIGHT_OF = { N: 'E', E: 'S', S: 'W', W: 'N' };

  function key(x, y) { return x + ',' + y; }
  function parseKey(k) {
    const i = k.indexOf(',');
    return { x: +k.slice(0, i), y: +k.slice(i + 1) };
  }
  function step(cell, facing) {
    const d = DIRS[facing];
    return { x: cell.x + d.x, y: cell.y + d.y };
  }

  /** Chamber: w (across) x d (deep) rectangle, entry somewhere on the near wall. */
  function chamberShape(rng, params, overrides) {
    const o = overrides || {};
    const w = o.w || rng.int(params.chamberMin, params.chamberMax);
    const d = o.d || rng.int(params.chamberMin, params.chamberMax);
    const offset = o.offset != null ? o.offset : rng.int(0, w - 1);
    const cells = [];
    for (let u = 0; u < d; u++) {
      for (let v = -offset; v < w - offset; v++) cells.push({ u, v });
    }
    return { archetype: 'chamber', cells, dims: { w, d, offset }, end: null };
  }

  /** Corridor: 1 wide, straight or with one bend. `end` is its far tip. */
  function corridorShape(rng, params, overrides) {
    const o = overrides || {};
    const len = o.len || rng.int(params.corridorMin, params.corridorMax);
    const bend = o.bend != null ? o.bend : (rng.chance(0.45) ? rng.int(1, len - 2) : 0);
    const side = o.side || (rng.chance(0.5) ? 1 : -1);
    const cells = [];
    let end;
    if (bend > 0 && len >= 3) {
      for (let u = 0; u <= bend; u++) cells.push({ u, v: 0 });
      for (let i = 1; i < len - bend; i++) cells.push({ u: bend, v: side * i });
      end = { u: bend, v: side * (len - bend - 1), turn: side };
    } else {
      for (let u = 0; u < len; u++) cells.push({ u, v: 0 });
      end = { u: len - 1, v: 0, turn: 0 };
    }
    return { archetype: 'corridor', cells, dims: { len, bend, side }, end };
  }

  function stubShape() {
    return { archetype: 'stub', cells: [{ u: 0, v: 0 }], dims: {}, end: null };
  }

  /** Rotate a travel-frame point into world coordinates. */
  function toWorld(origin, travel, p) {
    const f = DIRS[travel];
    const r = DIRS[RIGHT_OF[travel]];
    return { x: origin.x + p.u * f.x + p.v * r.x, y: origin.y + p.u * f.y + p.v * r.y };
  }

  /** Facing of the corridor's far end, in world terms. */
  function endFacing(travel, turn) {
    if (turn === 0) return travel;
    return turn > 0 ? RIGHT_OF[travel] : OPPOSITE[RIGHT_OF[travel]];
  }

  /** Place a travel-frame shape so (0,0) lands on `origin`. */
  function placeShape(shape, origin, travel) {
    const cells = shape.cells.map((p) => toWorld(origin, travel, p));
    let end = null;
    if (shape.end) {
      const c = toWorld(origin, travel, shape.end);
      end = { cell: c, facing: endFacing(travel, shape.end.turn) };
    }
    return { archetype: shape.archetype, dims: shape.dims, cells, end };
  }

  /** Every (cell, facing) on a cell set's boundary, in a stable order. */
  function boundarySlots(cellKeys) {
    const set = new Set(cellKeys);
    const slots = [];
    for (const k of cellKeys) {
      const c = parseKey(k);
      for (const f of FACINGS) {
        const n = step(c, f);
        if (!set.has(key(n.x, n.y))) slots.push({ cell: c, facing: f });
      }
    }
    return slots;
  }

  const DE = (global.DungeonEngine = global.DungeonEngine || {});
  Object.assign(DE, {
    DIRS, FACINGS, OPPOSITE, RIGHT_OF,
    key, parseKey, step,
    chamberShape, corridorShape, stubShape,
    placeShape, boundarySlots,
  });
})(typeof window !== 'undefined' ? window : globalThis);
