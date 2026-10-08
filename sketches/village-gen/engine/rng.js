// Seeds, the PRNG, and 2D simplex noise.
//
// Classic script (no import/export) so the sketch runs from a plain file://
// double-click. Every engine file is an IIFE that hangs its public pieces off
// the shared `VillageGen` global. The engine never touches the DOM, so the
// same files also load under Node for quick smoke tests.
(function (global) {
  'use strict';
  var VG = (global.VillageGen = global.VillageGen || {});

  function cyrb53(str, salt) {
    var h1 = 0xdeadbeef ^ (salt || 0), h2 = 0x41c6ce57 ^ (salt || 0);
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }

  function sfc32(a, b, c, d) {
    return function () {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
      var t = (a + b) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      d = (d + 1) | 0;
      t = (t + d) | 0;
      c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    };
  }

  /**
   * Seeded PRNG. `createRng(seed, 'roads')` gives an independent stream per
   * stage, so tweaking how one stage consumes randomness doesn't reshuffle
   * every stage after it.
   */
  function createRng(seed, stream) {
    var s = String(seed) + '|' + (stream || '');
    var r = sfc32(cyrb53(s, 1), cyrb53(s, 2), cyrb53(s, 3), cyrb53(s, 4));
    for (var i = 0; i < 12; i++) r();
    r.range = function (a, b) { return a + r() * (b - a); };
    r.int = function (a, b) { return Math.floor(a + r() * (b - a + 1)); };
    r.pick = function (arr) { return arr[Math.floor(r() * arr.length)]; };
    r.chance = function (p) { return r() < p; };
    r.gauss = function () { return (r() + r() + r() - 1.5) * 1.414; }; // ~N(0,1)
    r.weighted = function (items, weightOf) {
      var total = 0, i;
      for (i = 0; i < items.length; i++) total += weightOf(items[i]);
      var x = r() * total;
      for (i = 0; i < items.length; i++) { x -= weightOf(items[i]); if (x <= 0) return items[i]; }
      return items[items.length - 1];
    };
    r.shuffle = function (arr) {
      for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(r() * (i + 1)), t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    };
    return r;
  }

  /** A short, pronounceable-ish random seed for the reseed button. */
  function randomSeed() {
    var c = 'bcdfghjklmnprstvwz', v = 'aeiou', s = '';
    for (var i = 0; i < 3; i++) {
      s += c[Math.floor(Math.random() * c.length)] + v[Math.floor(Math.random() * v.length)];
    }
    return s + Math.floor(Math.random() * 90 + 10);
  }

  // 2D simplex noise (after Stefan Gustavson), seeded by shuffling the
  // permutation table with a PRNG. Output is roughly in [-1, 1].
  var F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  var GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];

  function makeNoise2(rand) {
    var p = new Uint8Array(256), perm = new Uint8Array(512), i;
    for (i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) { var j = Math.floor(rand() * (i + 1)), t = p[i]; p[i] = p[j]; p[j] = t; }
    for (i = 0; i < 512; i++) perm[i] = p[i & 255];
    return function (xin, yin) {
      var s = (xin + yin) * F2, i = Math.floor(xin + s), j = Math.floor(yin + s);
      var t = (i + j) * G2, x0 = xin - (i - t), y0 = yin - (j - t);
      var i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
      var x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
      var ii = i & 255, jj = j & 255, n = 0, g, tt;
      tt = 0.5 - x0 * x0 - y0 * y0;
      if (tt > 0) { g = GRAD[perm[ii + perm[jj]] & 7]; tt *= tt; n += tt * tt * (g[0] * x0 + g[1] * y0); }
      tt = 0.5 - x1 * x1 - y1 * y1;
      if (tt > 0) { g = GRAD[perm[ii + i1 + perm[jj + j1]] & 7]; tt *= tt; n += tt * tt * (g[0] * x1 + g[1] * y1); }
      tt = 0.5 - x2 * x2 - y2 * y2;
      if (tt > 0) { g = GRAD[perm[ii + 1 + perm[jj + 1]] & 7]; tt *= tt; n += tt * tt * (g[0] * x2 + g[1] * y2); }
      return 70 * n;
    };
  }

  /** Fractal Brownian motion over a noise function. */
  function fbm(noise, x, y, octaves, lacunarity, gain) {
    var sum = 0, amp = 1, freq = 1, norm = 0;
    lacunarity = lacunarity || 2; gain = gain || 0.5;
    for (var o = 0; o < octaves; o++) {
      sum += amp * noise(x * freq, y * freq);
      norm += amp; amp *= gain; freq *= lacunarity;
    }
    return sum / norm;
  }

  // Small geometry helpers shared by the engine stages.
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

  /** A uniform-grid spatial hash. Items are inserted by bounding box. */
  function SpatialHash(cell) {
    this.cell = cell;
    this.map = new Map();
  }
  SpatialHash.prototype._key = function (ix, iy) { return (ix + 50000) * 100003 + (iy + 50000); };
  SpatialHash.prototype.insert = function (item, x0, y0, x1, y1) {
    var c = this.cell;
    for (var ix = Math.floor(x0 / c); ix <= Math.floor(x1 / c); ix++) {
      for (var iy = Math.floor(y0 / c); iy <= Math.floor(y1 / c); iy++) {
        var k = this._key(ix, iy), b = this.map.get(k);
        if (!b) { b = []; this.map.set(k, b); }
        b.push(item);
      }
    }
  };
  /** Calls fn(item) for every item whose cells overlap the box (may repeat). */
  SpatialHash.prototype.query = function (x0, y0, x1, y1, fn) {
    var c = this.cell;
    for (var ix = Math.floor(x0 / c); ix <= Math.floor(x1 / c); ix++) {
      for (var iy = Math.floor(y0 / c); iy <= Math.floor(y1 / c); iy++) {
        var b = this.map.get(this._key(ix, iy));
        if (b) for (var i = 0; i < b.length; i++) if (fn(b[i]) === true) return true;
      }
    }
    return false;
  };

  function distToSeg(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    var t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
    var qx = ax + t * dx - px, qy = ay + t * dy - py;
    return Math.sqrt(qx * qx + qy * qy);
  }

  /** Segment intersection; returns {x, y, t, u} or null. */
  function segIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    var rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
    var den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-9) return null;
    var t = ((cx - ax) * sy - (cy - ay) * sx) / den;
    var u = ((cx - ax) * ry - (cy - ay) * rx) / den;
    if (t <= 0 || t >= 1 || u < 0 || u > 1) return null;
    return { x: ax + t * rx, y: ay + t * ry, t: t, u: u };
  }

  /** Oriented rectangle → 4 corners [[x,y],...], centred at (x,y). */
  function rectCorners(x, y, w, d, angle) {
    var c = Math.cos(angle), s = Math.sin(angle), hw = w / 2, hd = d / 2;
    return [
      [x - c * hw + s * hd, y - s * hw - c * hd],
      [x + c * hw + s * hd, y + s * hw - c * hd],
      [x + c * hw - s * hd, y + s * hw + c * hd],
      [x - c * hw - s * hd, y - s * hw + c * hd]
    ];
  }

  /** Separating-axis overlap test for two convex quads. */
  function quadsOverlap(a, b) {
    var polys = [a, b];
    for (var p = 0; p < 2; p++) {
      var poly = polys[p];
      for (var i = 0; i < 4; i++) {
        var j = (i + 1) & 3;
        var nx = poly[j][1] - poly[i][1], ny = poly[i][0] - poly[j][0];
        var minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity, k, v;
        for (k = 0; k < 4; k++) { v = nx * a[k][0] + ny * a[k][1]; if (v < minA) minA = v; if (v > maxA) maxA = v; }
        for (k = 0; k < 4; k++) { v = nx * b[k][0] + ny * b[k][1]; if (v < minB) minB = v; if (v > maxB) maxB = v; }
        if (maxA <= minB || maxB <= minA) return false;
      }
    }
    return true;
  }

  function pointInPoly(x, y, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function polyBounds(poly) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    for (var i = 0; i < poly.length; i++) {
      if (poly[i][0] < b[0]) b[0] = poly[i][0];
      if (poly[i][1] < b[1]) b[1] = poly[i][1];
      if (poly[i][0] > b[2]) b[2] = poly[i][0];
      if (poly[i][1] > b[3]) b[3] = poly[i][1];
    }
    return b;
  }

  VG.rng = { createRng: createRng, randomSeed: randomSeed, hash: cyrb53, makeNoise2: makeNoise2, fbm: fbm };
  VG.geom = {
    clamp: clamp, lerp: lerp, smoothstep: smoothstep, SpatialHash: SpatialHash,
    distToSeg: distToSeg, segIntersect: segIntersect, rectCorners: rectCorners,
    quadsOverlap: quadsOverlap, pointInPoly: pointInPoly, polyBounds: polyBounds
  };
})(typeof window !== 'undefined' ? window : globalThis);
