// Map renderer. What the map looks like comes from a style (ui/styles/*.js,
// see notes/style-system.md): an ordered list of layers, each naming a draw
// function from the registry below plus the paint, zoom range and checkbox
// it draws with. The renderer owns everything that isn't look: the view
// transform, level of detail, baking and batching. World layers are drawn
// in metres through one transform, labels in screen pixels.
//
// Level of detail: a city has thousands of buildings and fields and tens of
// thousands of trees, and a canvas call per shape is what makes zooming out
// slow. So zoomed out, fields and buildings come from images baked once per
// settlement (like the trees), at a resolution that's sharp down to the zoom
// where the renderer switches back to vectors. Up close nothing changes.
// Shapes that share a colour are also drawn together, a few hundred to a
// path: one path per shape costs GPU time, one giant path costs JS time.
(function (global) {
  'use strict';
  var VG = (global.VillageGen = global.VillageGen || {});
  var G = VG.geom;

  var CAT_LABELS = {
    residential: 'Homes', commercial: 'Shops & inns', craft: 'Crafts', civic: 'Civic', religious: 'Religious',
    agricultural: 'Farm buildings', industrial: 'Mills & stores'
  };

  // --- Style values -----------------------------------------------------------

  /**
   * A colour reference: palette name, 'name~0.4' (40% of the way to paper),
   * or a literal. Tints mix toward the palette's own `paper` if it has one
   * (so they don't change with the theme), else the map's paper.
   */
  function color(style, ref, paper) {
    if (ref == null) return ref;
    var pal = style.palette || {};
    if (pal[ref] !== undefined) return pal[ref];
    var i = ref.indexOf('~');
    if (i > 0 && pal[ref.slice(0, i)] !== undefined) return mix(pal[ref.slice(0, i)], pal.paper || paper, +ref.slice(i + 1));
    return ref;
  }

  function mix(a, b, k) {
    var x = rgb(a), y = rgb(b);
    if (!x || !y) return a;
    return 'rgb(' + [0, 1, 2].map(function (i) { return Math.round(x[i] + (y[i] - x[i]) * k); }).join(', ') + ')';
  }
  function rgb(c) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(c).trim());
    if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
    m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(String(c));
    return m ? [+m[1], +m[2], +m[3]] : null;
  }

  /** A width { m, px }: m metres, never thinner than px screen pixels (px = metres per pixel). */
  function width(w, px) {
    if (w.m == null) return w.px * px;
    if (w.px == null) return w.m;
    return Math.max(w.m, w.px * px);
  }

  /** Zoom range [min, max) of view.scale; none means always. */
  function inZoom(z, sc) { return !z || (sc >= z[0] && sc < z[1]); }

  /** A value, or stops over view.scale ({ z: [[scale, value], …] }) interpolated linearly. */
  function atZoom(v, sc) {
    if (!v || !v.z) return v;
    var s = v.z;
    if (sc <= s[0][0]) return s[0][1];
    for (var i = 1; i < s.length; i++) {
      if (sc <= s[i][0]) return s[i - 1][1] + (s[i][1] - s[i - 1][1]) * (sc - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
    }
    return s[s.length - 1][1];
  }

  /** Resolve any zoom stops in a paint's top-level values. */
  function zoomed(P, sc) {
    var out = null;
    for (var k in P) {
      if (P[k] && P[k].z) { out = out || merge(P, {}); out[k] = atZoom(P[k], sc); }
    }
    return out || P;
  }

  function font(style, name, size) {
    var f = style.fonts[name];
    return (f.style ? f.style + ' ' : '') + (f.weight ? f.weight + ' ' : '') + (size != null ? size : f.size) + 'px ' + f.family;
  }

  function merge(a, b) {
    var o = {}, k;
    for (k in a) o[k] = a[k];
    for (k in b) o[k] = b[k];
    return o;
  }

  // --- Patterns -----------------------------------------------------------------
  // A style's `patterns` are procedural tiles, one period square, built once
  // per style (and paper colour) into CanvasPatterns. Sizes are in metres:
  // a pattern belongs to the ground, so its transform maps a tile period to
  // `spacing` metres in world space, and it doesn't swim when the view pans.

  var PATTERN_TILE = 64;  // tile pixels per period
  var PATTERN_MIN_PX = 3; // finer than this on screen, a pattern shows as its flat ground

  /** Draw one period of a pattern into a tile canvas (k = tile pixels per metre). */
  var TILES = {
    lines: function (c, D, k, T) { var w = D.width * k; c.fillRect(0, T / 2 - w / 2, T, w); },
    grid: function (c, D, k, T) { var w = D.width * k; c.fillRect(0, T / 2 - w / 2, T, w); c.fillRect(T / 2 - w / 2, 0, w, T); },
    dots: function (c, D, k, T) { spots(c, T, D.stagger, function (x, y) { c.moveTo(x + D.radius * k, y); c.arc(x, y, D.radius * k, 0, Math.PI * 2); }); c.fill(); },
    // Overlapping round crowns, each over the last, staggered by default.
    crowns: function (c, D, k, T, col) {
      var edge = D.edge ? col(D.edge) : null;
      c.lineWidth = (D.edgeWidth || 0.3) * k;
      spots(c, T, D.stagger !== false, function (x, y) {
        c.beginPath(); c.arc(x, y, D.radius * k, 0, Math.PI * 2); c.fill();
        if (edge) { c.strokeStyle = edge; c.stroke(); }
      });
    },
    dashes: function (c, D, k, T) {
      var l = (D.length != null ? D.length : D.spacing / 2) * k, w = D.width * k;
      spots(c, T, D.stagger, function (x, y) { c.rect(x - l / 2, y - w / 2, l, w); });
      c.fill();
    },
    waves: function (c, D, k, T) {
      var a = (D.amplitude != null ? D.amplitude : D.spacing * 0.15) * k;
      c.lineWidth = D.width * k; c.lineCap = 'round';
      c.beginPath();
      for (var x = 0; x <= T; x++) c.lineTo(x, T / 2 + a * Math.sin(x / T * Math.PI * 2));
      c.stroke();
    }
  };

  /** Call fn at the tile centre (and the corners when staggered), wrapped so shapes tile seamlessly. */
  function spots(c, T, stagger, fn) {
    var pts = stagger ? [[T / 2, T / 2], [0, 0]] : [[T / 2, T / 2]];
    c.beginPath();
    pts.forEach(function (p) {
      for (var ox = -T; ox <= T; ox += T) for (var oy = -T; oy <= T; oy += T) fn(p[0] + ox, p[1] + oy);
    });
  }

  /**
   * A pattern ready to fill with, anchored in world metres (the fill runs
   * under the world transform): rotated by `angle` (radians) on top of the
   * pattern's own, with a period's corner at (ox, oy). Null when there's no
   * such pattern or it would come out finer than its minPx at this zoom, so
   * the caller falls back to a flat colour.
   */
  function usePattern(set, name, sc, angle, ox, oy) {
    var p = set[name];
    if (!p || p.spacing * sc < p.minPx) return null;
    var s = p.spacing / PATTERN_TILE, a = p.angle + (angle || 0), c = Math.cos(a), n = Math.sin(a);
    if (p.pattern.setTransform) p.pattern.setTransform(new DOMMatrix([c * s, n * s, -n * s, c * s, ox || 0, oy || 0]));
    return p.pattern;
  }

  /** Build a style's patterns: name → { pattern, spacing, angle, ground, minPx }. */
  function buildPatterns(style, paper) {
    var defs = style.patterns || {}, out = {}, col = function (ref) { return color(style, ref, paper); };
    Object.keys(defs).forEach(function (name) {
      var D = defs[name], draw = TILES[D.kind];
      if (!draw || !(D.spacing > 0)) return;
      var T = PATTERN_TILE, cv = makeCanvas(T, T), c = cv.getContext('2d');
      if (D.ground) { c.fillStyle = col(D.ground); c.fillRect(0, 0, T, T); }
      c.fillStyle = c.strokeStyle = col(D.color);
      draw(c, D, T / D.spacing, T, col);
      out[name] = { pattern: c.createPattern(cv, 'repeat'), spacing: D.spacing, angle: (D.angle || 0) * Math.PI / 180,
        ground: D.ground ? col(D.ground) : null, minPx: D.minPx != null ? D.minPx : PATTERN_MIN_PX };
    });
    return out;
  }

  // --- Areas ------------------------------------------------------------------
  // `area.<kind>` features: polygons the generator will provide as S.areas
  // (notes/style-system.md, step 5). Until it does, a few kinds have a
  // renderer-side stop-gap here, behind the same key; anything else simply
  // doesn't exist and draws nothing.

  /**
   * An S.areas entry as rings: an area or a list of them, each with a
   * `polygon` (one ring) or `rings`, or bare rings.
   */
  function areaRings(src) {
    var out = [];
    (Array.isArray(src) && !(src[0] && typeof src[0][0] === 'number') ? src : [src]).forEach(function (a) {
      if (!a) return;
      if (a.rings) out.push.apply(out, a.rings);
      else if (a.polygon) out.push(a.polygon);
      else if (Array.isArray(a) && Array.isArray(a[0]) && Array.isArray(a[0][0])) out.push.apply(out, a);
      else if (Array.isArray(a)) out.push(a);
    });
    return out;
  }

  var STOPGAP_AREAS = {
    /**
     * The settlement's boundary: the farmed extent (fields, buildings and
     * squares) grown by 30 m and smoothed, without holes: unfarmed ground
     * inside the town is still inside it. Not yet pulled to a contour or
     * cut by water; the generator's S.areas.boundary will do that.
     */
    boundary: function (S) {
      return rasterArea(S, { cell: Math.max(6, S.bounds.size / 256), dilate: 30, blur: 30, holes: false }, function (c) {
        S.fields.forEach(function (f) { polyPath(c, f.polygon); });
        S.buildings.forEach(function (b) { polyPath(c, b.polygon); });
        S.plazas.forEach(function (p) { polyPath(c, plazaRing(p)); });
      });
    },
    /**
     * The settlement's territory: a much larger, organic area than the
     * farmed extent, reaching most of the way to the style's frame circle
     * (`r` of the map, 0.47 if it has none). It's the farmed extent grown
     * by 40 m, joined to a disc about three quarters of the frame's size
     * (on the frame's centre, which the town always sits inside), with a
     * seeded noisy edge that pulls in over higher ground. A stand-in for a
     * generator area.
     */
    territory: function (S, R) {
      var W = S.bounds.size, T = S._.terrain, cell = Math.max(6, W / 256), o = { cell: cell, dilate: 40, blur: 40 };
      var v = rasterGrid(S, o, function (c) {
        S.fields.forEach(function (f) { polyPath(c, f.polygon); });
        S.buildings.forEach(function (b) { polyPath(c, b.polygon); });
        S.plazas.forEach(function (p) { polyPath(c, plazaRing(p)); });
      });
      var N = Math.ceil(W / cell) + 2, F = R && R.style.frame, Rf = (F ? F.r : 0.47) * W, Rt = 0.76 * Rf;
      var C = F && F.centre === 'settlement' ? S.center : { x: 0, y: 0 };
      var noise = VG.rng.makeNoise2(VG.rng.createRng((S.seeds && S.seeds.land) || S.name, 'territory')), lam = Rt * 0.5;
      var h0 = T.heightAt(S.center.x, S.center.y), span = Math.max(1e-3, T.relief * 0.4);
      var out = new Float32Array(N * N);
      for (var j = 1; j < N - 1; j++) for (var i = 1; i < N - 1; i++) {
        var x = (i - 0.5) * cell - W / 2, y = (j - 0.5) * cell - W / 2;
        var radial = 1 - 0.5 * Math.hypot(x - C.x, y - C.y) / Rt;
        var hill = G.clamp((T.heightAt(x, y) - h0) * T.relief / span, 0, 1);
        out[j * N + i] = Math.max(v ? v[j * N + i] : 0, radial + 0.13 * VG.rng.fbm(noise, x / lam, y / lam, 3) - 0.18 * hill);
      }
      return traceArea(out, N, { cell: cell, holes: false, minArea: 20000, smooth: 2 }, W);
    },
    /** Settled ground: the built-up footprint, buildings and squares grown by 9 m. */
    settled: function (S) {
      return rasterArea(S, { cell: Math.max(3, S.bounds.size / 640), dilate: 9, blur: 7, holes: true, minArea: 1500 }, function (c) {
        S.buildings.forEach(function (b) { polyPath(c, b.polygon); });
        S.plazas.forEach(function (p) { polyPath(c, plazaRing(p)); });
      });
    },
    /** Woodland: where tree crowns cover most of the ground, so lone trees and hedgerows drop out. */
    forest: function (S) {
      return rasterArea(S, { cell: Math.max(5, S.bounds.size / 400), blur: 12, level: 0.42, soft: true, holes: true, minArea: 4000 }, function (c) {
        S.trees.forEach(function (t) { c.moveTo(t[0] + t[2] * 1.3, t[1]); c.arc(t[0], t[1], t[2] * 1.3, 0, Math.PI * 2); });
      });
    }
  };

  /**
   * An area traced from a raster: `add(ctx)` adds shapes (in metres) to a
   * path, which is filled onto a grid of `cell` metres; covered cells (or,
   * `soft`, their coverage) are dilated by `dilate` metres, box-blurred by
   * `blur`, traced at `level` with marching squares and rounded with
   * Chaikin. `holes: false` keeps outer rings only; rings under `minArea`
   * square metres are dropped. Null if nothing's covered.
   */
  function rasterArea(S, o, add) {
    var v = rasterGrid(S, o, add);
    return v && traceArea(v, Math.ceil(S.bounds.size / o.cell) + 2, o, S.bounds.size);
  }

  /** The raster step of rasterArea: an (n+2)² grid with an empty border, dilated and blurred; null if empty. */
  function rasterGrid(S, o, add) {
    var W = S.bounds.size, cell = o.cell, n = Math.ceil(W / cell);
    var cv = makeCanvas(n, n), c = cv.getContext('2d');
    c.setTransform(1 / cell, 0, 0, 1 / cell, n / 2, n / 2);
    c.beginPath();
    add(c);
    c.fill();
    var px = c.getImageData(0, 0, n, n).data, N = n + 2, v = new Float32Array(N * N), any = false;
    for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) {
      var a = px[(j * n + i) * 4 + 3];
      if (o.soft ? a : a > 64) { v[(j + 1) * N + i + 1] = o.soft ? a / 255 : 1; any = true; }
    }
    if (!any) return null;
    var r;
    if (o.dilate) { r = Math.max(1, Math.round(o.dilate / cell)); v = gridPass(gridPass(v, N, r, true, true), N, r, true, false); }
    if (o.blur) { r = Math.max(1, Math.round(o.blur / cell)); v = gridPass(gridPass(v, N, r, false, true), N, r, false, false); }
    return v;
  }

  /** The tracing step of rasterArea. */
  function traceArea(v, N, o, W) {
    var rings = traceRings(v, N, o.level || 0.5, o.cell, W, o.off);
    if (o.minArea) rings = rings.filter(function (ring) { return Math.abs(ringArea(ring)) >= o.minArea; });
    if (o.holes === false) {
      rings = rings.filter(function (ring) {
        return !rings.some(function (q) { return q !== ring && G.pointInPoly(ring[0][0], ring[0][1], q); });
      });
    }
    return rings.map(o.smooth === 2 ? function (r) { return chaikin(chaikin(r)); } : chaikin);
  }

  function ringArea(ring) {
    var a = 0;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
    return a / 2;
  }

  /** Inside an area's rings (evenodd, so holes count). */
  function inArea(A, x, y) {
    var b = A.bounds, k = 0;
    if (x < b[0] || y < b[1] || x > b[2] || y > b[3]) return false;
    A.rings.forEach(function (r) { if (G.pointInPoly(x, y, r)) k++; });
    return k % 2 === 1;
  }

  /** One separable pass of a max (dilate) or box (blur) filter of radius r over an N×N grid. */
  function gridPass(v, N, r, max, horizontal) {
    var out = new Float32Array(N * N);
    for (var j = 1; j < N - 1; j++) for (var i = 1; i < N - 1; i++) {
      var acc = 0;
      for (var d = -r; d <= r; d++) {
        var ii = horizontal ? i + d : i, jj = horizontal ? j : j + d;
        if (ii < 1 || jj < 1 || ii > N - 2 || jj > N - 2) continue;
        var x = v[jj * N + ii];
        if (max) { if (x > acc) acc = x; } else acc += x;
      }
      out[j * N + i] = max ? acc : acc / (2 * r + 1);
    }
    return out;
  }

  /**
   * Closed rings where grid value crosses `lvl` (the grid has a 1-cell
   * border below it), in world metres. Grid point i sits at
   * (i + off) · cell − W/2: off −0.5 for raster cell centres (the default),
   * −1 for a padded copy of the terrain's own grid.
   */
  function traceRings(v, N, lvl, cell, W, off) {
    var pts = {}, next = {}, o = off == null ? -0.5 : off;
    function P(i, j) { return [(i + o) * cell - W / 2, (j + o) * cell - W / 2]; }
    for (var j = 0; j < N - 1; j++) for (var i = 0; i < N - 1; i++) {
      var a = v[j * N + i], b = v[j * N + i + 1], c = v[(j + 1) * N + i + 1], d = v[(j + 1) * N + i];
      var idx = (a > lvl ? 8 : 0) | (b > lvl ? 4 : 0) | (c > lvl ? 2 : 0) | (d > lvl ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      // Edge ids: horizontal edges even, vertical odd.
      var ids = [(j * N + i) * 2, ((j * N + i + 1) * 2) + 1, (((j + 1) * N + i) * 2), (j * N + i) * 2 + 1];
      var p0 = P(i, j), p1 = P(i + 1, j + 1);
      var at = [
        [p0[0] + (p1[0] - p0[0]) * (lvl - a) / (b - a), p0[1]], [p1[0], p0[1] + (p1[1] - p0[1]) * (lvl - b) / (c - b)],
        [p0[0] + (p1[0] - p0[0]) * (lvl - d) / (c - d), p1[1]], [p0[0], p0[1] + (p1[1] - p0[1]) * (lvl - a) / (d - a)]
      ];
      MS[idx].forEach(function (sg) {
        var e = ids[sg[0]], f = ids[sg[1]];
        pts[e] = at[sg[0]]; pts[f] = at[sg[1]];
        (next[e] = next[e] || []).push(f);
        (next[f] = next[f] || []).push(e);
      });
    }
    var seen = {}, rings = [];
    Object.keys(next).forEach(function (start) {
      if (seen[start]) return;
      var ring = [], prev = null, cur = start;
      while (cur != null && !seen[cur]) {
        seen[cur] = true; ring.push(pts[cur]);
        var nb = next[cur], go = nb[0] == prev && nb.length > 1 ? nb[1] : nb[0];
        prev = cur; cur = String(go);
      }
      if (ring.length > 2) rings.push(ring);
    });
    return rings;
  }

  /** One round of Chaikin corner cutting on a closed ring. */
  function chaikin(ring) {
    var out = [];
    for (var i = 0; i < ring.length; i++) {
      var a = ring[i], b = ring[(i + 1) % ring.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    return out;
  }

  // --- Terrain ----------------------------------------------------------------

  function lerpColor(stops, t) {
    if (t <= stops[0][0]) return stops[0][1];
    for (var i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        var a = stops[i - 1], b = stops[i], k = (t - a[0]) / (b[0] - a[0]);
        return [a[1][0] + (b[1][0] - a[1][0]) * k, a[1][1] + (b[1][1] - a[1][1]) * k, a[1][2] + (b[1][2] - a[1][2]) * k];
      }
    }
    return stops[stops.length - 1][1];
  }

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /** Bake terrain colour + hillshade into an offscreen canvas. */
  function bakeHypso(S, P) {
    var T = S._.terrain, W = T.W, size = 1024, cv = makeCanvas(size, size), ctx = cv.getContext('2d');
    var img = ctx.createImageData(size, size), d = img.data;
    var maxH = 0;
    for (var k = 0; k < T.heights.length; k++) if (T.heights[k] > maxH) maxH = T.heights[k];
    var span = Math.max(0.05, maxH - T.wl), stops = P.ramp, WS = P.waterShallow, WD = P.waterDeep, glow = P.shoreGlow;
    var px = W / size, exag = P.exaggeration / (1 + T.reliefPerKm / P.flatten);
    var L = P.light, Ll = Math.hypot(L[0], L[1], L[2]);
    L = [L[0] / Ll, L[1] / Ll, L[2] / Ll];
    for (var j = 0; j < size; j++) {
      var y = (j + 0.5) * px - W / 2;
      for (var i = 0; i < size; i++) {
        var x = (i + 0.5) * px - W / 2, h = T.heightAt(x, y), c, o = (j * size + i) * 4;
        if (h < T.wl) {
          var dep = G.clamp((T.wl - h) / P.depth, 0, 1);
          c = [WS[0] + (WD[0] - WS[0]) * dep, WS[1] + (WD[1] - WS[1]) * dep, WS[2] + (WD[2] - WS[2]) * dep];
        } else {
          c = lerpColor(stops, (h - T.wl) / span);
          var e = Math.max(px, T.cell * 0.9); // span a full grid cell: no faceting
          var dx = (T.heightAt(x + e, y) - T.heightAt(x - e, y)) / (2 * e) * T.relief * exag;
          var dy = (T.heightAt(x, y + e) - T.heightAt(x, y - e)) / (2 * e) * T.relief * exag;
          var nl = Math.hypot(dx, dy, 1), lam = (-dx * L[0] - dy * L[1] + L[2]) / nl;
          var f = G.clamp(1 + (lam - L[2]) * P.shadeGain, P.shade[0], P.shade[1]);
          // A soft shoreline glow.
          var shore = 1 - G.smoothstep(0, P.shoreSpan, h - T.wl);
          c = [c[0] * f + shore * glow[0], c[1] * f + shore * glow[1], c[2] * f + shore * glow[2]];
        }
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  /** Marching-squares contours → Path2D (minor and major lines). */
  function buildContours(S) {
    var T = S._.terrain, res = T.res, H = T.heights, W = T.W, cell = T.cell;
    var interval = niceStep(T.relief / 14), maxH = 0;
    for (var k = 0; k < H.length; k++) if (H[k] > maxH) maxH = H[k];
    var minor = new Path2D(), major = new Path2D(), count = 0, a, b, c, d, idx, x0, y0, i, j;
    for (var m = interval; T.wl + m / T.relief < maxH; m += interval) {
      var lvl = T.wl + m / T.relief, path = Math.round(m / interval) % 5 === 0 ? major : minor;
      for (j = 0; j < res - 1; j++) {
        for (i = 0; i < res - 1; i++) {
          a = H[j * res + i]; b = H[j * res + i + 1]; c = H[(j + 1) * res + i + 1]; d = H[(j + 1) * res + i];
          idx = (a > lvl ? 8 : 0) | (b > lvl ? 4 : 0) | (c > lvl ? 2 : 0) | (d > lvl ? 1 : 0);
          if (idx === 0 || idx === 15) continue;
          x0 = i * cell - W / 2; y0 = j * cell - W / 2;
          var top = [x0 + cell * (lvl - a) / (b - a), y0], right = [x0 + cell, y0 + cell * (lvl - b) / (c - b)];
          var bottom = [x0 + cell * (lvl - d) / (c - d), y0 + cell], left = [x0, y0 + cell * (lvl - a) / (d - a)];
          var segs = MS[idx];
          for (var s = 0; s < segs.length; s++) {
            var p = [top, right, bottom, left][segs[s][0]], q = [top, right, bottom, left][segs[s][1]];
            path.moveTo(p[0], p[1]); path.lineTo(q[0], q[1]); count++;
          }
        }
      }
    }
    // The shoreline, traced at the water level, keeps coasts crisp when zoomed.
    var shore = new Path2D(), lv = T.wl;
    for (j = 0; j < res - 1; j++) {
      for (i = 0; i < res - 1; i++) {
        a = H[j * res + i]; b = H[j * res + i + 1]; c = H[(j + 1) * res + i + 1]; d = H[(j + 1) * res + i];
        idx = (a > lv ? 8 : 0) | (b > lv ? 4 : 0) | (c > lv ? 2 : 0) | (d > lv ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        x0 = i * cell - W / 2; y0 = j * cell - W / 2;
        var E4 = [[x0 + cell * (lv - a) / (b - a), y0], [x0 + cell, y0 + cell * (lv - b) / (c - b)],
          [x0 + cell * (lv - d) / (c - d), y0 + cell], [x0, y0 + cell * (lv - a) / (d - a)]];
        MS[idx].forEach(function (sg) { shore.moveTo(E4[sg[0]][0], E4[sg[0]][1]); shore.lineTo(E4[sg[1]][0], E4[sg[1]][1]); });
      }
    }
    return { minor: minor, major: major, shore: shore, interval: interval, count: count };
  }
  // Edge pairs per marching-squares case (0 top, 1 right, 2 bottom, 3 left).
  var MS = { 1: [[3, 2]], 2: [[2, 1]], 3: [[3, 1]], 4: [[0, 1]], 5: [[3, 0], [2, 1]], 6: [[0, 2]], 7: [[3, 0]],
    8: [[3, 0]], 9: [[0, 2]], 10: [[0, 1], [3, 2]], 11: [[0, 1]], 12: [[3, 1]], 13: [[2, 1]], 14: [[3, 2]] };

  function niceStep(x) {
    var p = Math.pow(10, Math.floor(Math.log10(Math.max(x, 0.1)))), f = x / p;
    return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
  }

  /** Bake all trees into a big offscreen canvas for zoomed-out views. */
  function bakeTrees(S, P) {
    var W = S.bounds.size, size = 2048, cv = makeCanvas(size, size), ctx = cv.getContext('2d'), k = size / W;
    S.trees.forEach(function (t) {
      ctx.fillStyle = P.colors[t[3]];
      ctx.beginPath();
      ctx.arc((t[0] + W / 2) * k, (t[1] + W / 2) * k, Math.max(P.minRadius, t[2] * k), 0, Math.PI * 2);
      ctx.fill();
    });
    return cv;
  }

  // Baked layers: [image size cap, metres per image pixel, the largest
  // screen-to-image pixel ratio to use it at]. Shown near 1:1 a baked image
  // goes soft, so it's only used once it's being shrunk; closer in, the
  // batched vectors take over. Only worth it for bigger places.
  var BAKES = { fields: [3072, 2.6, 0.9], buildings: [4096, 1.95, 0.75] };
  var BAKE_MIN_BUILDINGS = 400;

  function treeGrid(S) {
    var cell = 80, map = new Map();
    S.trees.forEach(function (t) {
      var key = Math.floor(t[0] / cell) * 100003 + Math.floor(t[1] / cell);
      var b = map.get(key);
      if (!b) map.set(key, (b = []));
      b.push(t);
    });
    return { cell: cell, map: map };
  }

  // --- Renderer ---------------------------------------------------------------

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.S = null;
    this.layers = { contours: true, trees: true, fields: true, labels: true, interiors: true };
    this.history = 1;
    this.selected = null;
    this.hover = null;
    this.highlightCat = null;
    this.setStyle('natural');
  }

  /** Switch style; anything baked from the old one is redrawn. */
  Renderer.prototype.setStyle = function (id) {
    this.style = VG.styles[id] || VG.styles.natural;
    this._paint = {};
    this._patterns = null;
    this._exitFrom = null;
    if (this.S) {
      var sel = this.selected, hov = this.hover;
      this.setSettlement(this.S, this.biome);
      this.selected = sel; this.hover = hov;
    }
  };

  /** The active style's first layer drawn by the named draw function. */
  Renderer.prototype.layerDrawnBy = function (name) {
    var ls = this.style.layers;
    for (var i = 0; i < ls.length; i++) if (ls[i].draw === name) return ls[i];
    return null;
  };

  /**
   * A layer's paint for one feature key (a crop, a road kind…): its paint,
   * then its byBiome entry for this settlement's biome, then its byKey
   * entry. Merged once and cached.
   */
  Renderer.prototype.paint = function (L, key) {
    var id = L.id + '|' + (key || ''), P = this._paint[id];
    if (P) return P;
    P = L.paint || {};
    if (L.byBiome && L.byBiome[this.biome]) P = merge(P, L.byBiome[this.biome]);
    if (key && L.byKey && L.byKey[key]) P = merge(P, L.byKey[key]);
    return (this._paint[id] = P);
  };

  /** The active style's category colours, resolved, in legend order. */
  Renderer.prototype.categoryColors = function () {
    var cc = this.style.categoryColors, out = {}, self = this;
    Object.keys(cc).forEach(function (c) { out[c] = color(self.style, cc[c]); });
    return out;
  };

  Renderer.prototype.setSettlement = function (S, biome) {
    this.S = S;
    this.biome = biome;
    this._paint = {};
    // Rasters are baked once per settlement (and per style).
    var terrain = this.layerDrawnBy('terrain.hypso'), trees = this.layerDrawnBy('trees.baked');
    // A biome the style has no ramp for gets the first one it lists.
    var key = terrain && terrain.byKey && !terrain.byKey[biome] ? Object.keys(terrain.byKey)[0] : biome;
    this.terrainImg = terrain ? bakeHypso(S, this.paint(terrain, key)) : null;
    this.contours = buildContours(S);

    this.treeImg = trees ? bakeTrees(S, this.paint(trees)) : null;
    this.trees = treeGrid(S);
    this.bakes = {};
    this._areas = {};
    this._exitFrom = null;
    this._terrain = null; this._grid = null; this._bandTop = null;
    this.selected = null;
    this.hover = null;
  };

  Renderer.prototype.draw = function (view, paper) {
    var S = this.S, ctx = this.ctx, cv = this.canvas, dpr = view.dpr, self = this;
    // A style with its own paper colour ignores the theme's.
    if (this.style.paper && this.style.paper !== 'theme') paper = color(this.style, this.style.paper, paper);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, cv.width, cv.height);
    if (!S) return;
    var sc = view.scale;
    var env = this.env(view.bounds(), sc, this.history, this.selected, paper);
    env.view = view;
    this.destHits = [];
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    var focus = this.style.focus, frame = this.style.frame ? this.frameCircle() : null;
    function place(fn) {
      if (fn.screen) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      else ctx.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * (view.w / 2 - view.cx * sc), dpr * (view.h / 2 - view.cy * sc));
    }
    // Each layer in order, if its checkbox is on and it's in its zoom range.
    this.style.layers.forEach(function (L) {
      var fn = DRAW[L.draw];
      if (!fn || (L.toggle && !self.layers[L.toggle]) || !inZoom(L.zoom, sc)) return;
      var where = focus && L.focus && L.focus !== 'any' && !fn.unclipped ? L.focus : null;
      var framed = frame && L.frame !== false && !fn.screen && !fn.unclipped;
      if (L.fade) return self.drawFaded(fn, zoomed(self.paint(L), sc), env, view, L);
      if (!where && !framed) {
        place(fn);
        return fn(ctx, zoomed(self.paint(L), sc), env, L);
      }
      // Clipped to the frame circle, then to the focus area or everything outside it.
      ctx.save();
      if (framed) {
        place(fn);
        ctx.beginPath(); ctx.arc(frame.x, frame.y, frame.r, 0, Math.PI * 2); ctx.clip();
      }
      if (where) self.clipFocus(ctx, view, focus, where);
      place(fn);
      var ways = fn.ways && /^way(\.|$)/.test(L.match || '');
      env.wayMode = ways ? 'body' : null;
      fn(ctx, zoomed(self.paint(L), sc), env, L);
      ctx.restore();
      env.lastFont = null; env.ls = null; // restore() put the font and spacing back
      // A road's run on to its exit is drawn outside every clip, except
      // that an 'outside' layer still stays outside the focus area (the
      // layer drawing the inside has already drawn it there).
      if (ways) {
        env.wayMode = 'exit';
        if (where === 'outside') { ctx.save(); self.clipFocus(ctx, view, focus, where); }
        place(fn);
        fn(ctx, zoomed(self.paint(L), sc), env, L);
        if (where === 'outside') { ctx.restore(); env.lastFont = null; env.ls = null; }
      }
      env.wayMode = null;
    });
  };

  /**
   * A layer with `fade: { inner, outer }` (shares of the map's size) is
   * drawn offscreen, then faded out radially from the map's origin between
   * those radii, so it dissolves before the terrain tile's square edge.
   * Focus and frame don't apply to it.
   */
  Renderer.prototype.drawFaded = function (fn, P, env, view, L) {
    var cv = this.canvas, off = this._fadeCanvas || (this._fadeCanvas = makeCanvas(1, 1)), dpr = view.dpr, sc = view.scale;
    if (off.width !== cv.width || off.height !== cv.height) { off.width = cv.width; off.height = cv.height; }
    var c = off.getContext('2d'), F = L.fade, W = this.S.bounds.size, vb = env.vb;
    var world = [dpr * sc, 0, 0, dpr * sc, dpr * (view.w / 2 - view.cx * sc), dpr * (view.h / 2 - view.cy * sc)];
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, off.width, off.height);
    c.lineJoin = 'round'; c.lineCap = 'round';
    if (fn.screen) c.setTransform(dpr, 0, 0, dpr, 0, 0); else c.setTransform.apply(c, world);
    fn(c, P, env, L);
    c.globalCompositeOperation = 'destination-in';
    c.setTransform.apply(c, world);
    var g = c.createRadialGradient(0, 0, F.inner * W, 0, 0, F.outer * W);
    g.addColorStop(0, 'rgba(0, 0, 0, 1)'); g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    c.fillStyle = g;
    c.fillRect(vb[0] - 10, vb[1] - 10, vb[2] - vb[0] + 20, vb[3] - vb[1] + 20);
    c.globalCompositeOperation = 'source-over';
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.drawImage(off, 0, 0);
  };

  /**
   * The style's frame circle in metres: centred on the map's origin or the
   * settlement, radius `r` × the map's size, kept on the terrain tile.
   */
  Renderer.prototype.frameCircle = function () {
    var F = this.style.frame, W = this.S.bounds.size, c = F.centre === 'settlement' ? this.S.center : { x: 0, y: 0 };
    return { x: c.x, y: c.y, r: Math.max(0, Math.min(F.r * W, W / 2 - Math.abs(c.x), W / 2 - Math.abs(c.y))) };
  };

  /**
   * Clip to the style's focus area ('inside') or its complement
   * ('outside'). An area that doesn't exist is empty: nothing is inside it.
   */
  Renderer.prototype.clipFocus = function (ctx, view, focus, where) {
    var sc = view.scale, dpr = view.dpr, A = this.area(focus.area), vb = view.bounds(), pad = 100 / sc;
    ctx.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * (view.w / 2 - view.cx * sc), dpr * (view.h / 2 - view.cy * sc));
    ctx.beginPath();
    if (where === 'outside') ctx.rect(vb[0] - pad, vb[1] - pad, vb[2] - vb[0] + 2 * pad, vb[3] - vb[1] + 2 * pad);
    if (A) A.rings.forEach(function (ring) { polyPath(ctx, ring); });
    ctx.clip('evenodd');
  };

  /**
   * An area feature by key ('area.boundary' or 'boundary') as { rings,
   * bounds }, or null if there's none: S.areas when the generator provides
   * it, else the renderer's stop-gap. Cached per settlement.
   */
  Renderer.prototype.area = function (key) {
    var kind = String(key).replace(/^area\./, ''), S = this.S, c = this._areas;
    if (!S) return null;
    if (kind in c) return c[kind];
    var rings = S.areas && S.areas[kind] ? areaRings(S.areas[kind]) : STOPGAP_AREAS[kind] ? STOPGAP_AREAS[kind](S, this) : null;
    if (!rings || !rings.length) return (c[kind] = null);
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    rings.forEach(function (r) { var rb = G.polyBounds(r); b = [Math.min(b[0], rb[0]), Math.min(b[1], rb[1]), Math.max(b[2], rb[2]), Math.max(b[3], rb[3])]; });
    return (c[kind] = { rings: rings, bounds: b });
  };

  /**
   * Where a way with an exit last leaves the focus area: the index of its
   * last node inside it (0 if none is). From there on it's drawn unclipped.
   */
  Renderer.prototype.exitFrom = function (w) {
    var c = this._exitFrom || (this._exitFrom = new Map());
    if (c.has(w)) return c.get(w);
    var A = this.style.focus ? this.area(this.style.focus.area) : null, N = this.S.network.nodes, i = w.nodes.length - 1;
    while (i > 0 && !(A && inArea(A, N[w.nodes[i]].x, N[w.nodes[i]].y))) i--;
    c.set(w, i);
    return i;
  };

  /**
   * The terrain's height field traced as vector rings, cached per
   * settlement: `which` is 'water' (below the water line) or a band
   * number k (above the k-th contour). The terrain grid is upsampled 2×
   * (bilinear) and the rings rounded once, so edges stay crisp up close.
   */
  Renderer.prototype.terrainRings = function (which) {
    var c = this._terrain || (this._terrain = {});
    if (which in c) return c[which];
    var S = this.S, T = S._.terrain, W = T.W, n = (T.res - 1) * 2 + 1, cell = W / (n - 1), N = n + 2;
    var g = this._grid;
    if (!g) {
      g = this._grid = new Float32Array(N * N);
      for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) g[(j + 1) * N + i + 1] = T.heightAt(i * cell - W / 2, j * cell - W / 2);
    }
    var lvl, v = g, rings;
    if (which === 'water') {
      // Inverted so water is "above"; the border stays dry.
      v = new Float32Array(N * N);
      for (var k = 0; k < N * N; k++) v[k] = -g[k];
      for (var b = 0; b < N; b++) { v[b] = v[(N - 1) * N + b] = v[b * N] = v[b * N + N - 1] = -1e9; }
      lvl = -T.wl;
    } else lvl = T.wl + which * this.contours.interval / T.relief;
    rings = traceRings(v, N, lvl, cell, W, -1).filter(function (r) { return r.length > 3; }).map(chaikin);
    return (c[which] = rings);
  };

  /** The active style's patterns, built once per style and paper colour. */
  Renderer.prototype.patterns = function (paper) {
    if (!this._patterns || this._patterns.paper !== paper) this._patterns = { paper: paper, set: buildPatterns(this.style, paper) };
    return this._patterns.set;
  };

  /** What a draw function gets besides its paint. */
  Renderer.prototype.env = function (vb, sc, t, selected, paper) {
    var self = this, style = this.style;
    return {
      r: this, S: this.S, style: style, vb: vb, sc: sc, px: 1 / sc, t: t, paper: paper,
      selected: selected, hover: this.hover, highlight: this.highlightCat, layers: this.layers,
      color: function (ref) { return color(style, ref, paper); },
      paint: function (L, key) { return self.paint(L, key); },
      pattern: function (name, angle, ox, oy) { return usePattern(self.patterns(paper), name, sc, angle, ox, oy); },
      wayMode: null
    };
  };

  /**
   * The baked image for a layer if it's good enough at this zoom (device
   * pixels per metre), else null. Baked lazily, once per settlement, by
   * `vectors`, showing everything (t = 1) with nothing selected or
   * highlighted, so growth playback and the legend highlight fall back to
   * vectors.
   */
  Renderer.prototype.bakedLayer = function (which, devPerM, env, vectors, P) {
    var S = this.S, cfg = BAKES[which], W = S.bounds.size;
    if (env.t < 1 || this.highlightCat || S.buildings.length < BAKE_MIN_BUILDINGS) return null;
    var size = Math.min(cfg[0], Math.ceil(W / cfg[1])), k = size / W;
    if (devPerM > k * cfg[2]) return null;
    if (this.bakes[which]) return this.bakes[which];
    var cv = makeCanvas(size, size), bctx = cv.getContext('2d');
    bctx.setTransform(k, 0, 0, k, size / 2, size / 2);
    bctx.lineJoin = 'round'; bctx.lineCap = 'round';
    vectors(bctx, P, this.env([-W / 2, -W / 2, W / 2, W / 2], k, 1, null, env.paper));
    return (this.bakes[which] = cv);
  };

  function hexA(color, a) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim());
    if (!m) return color;
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')';
  }

  function inView(vb, b, pad) {
    return b[2] >= vb[0] - pad && b[0] <= vb[2] + pad && b[3] >= vb[1] - pad && b[1] <= vb[3] + pad;
  }

  /**
   * Paint items in batches: `trace(i)` adds item i to the current path,
   * `paint()` fills/strokes it. Items i = 0, step, 2·step… below n.
   */
  var BATCH = 400;
  function batched(ctx, n, step, trace, paint) {
    for (var s = 0; s < n; s += step * BATCH) {
      ctx.beginPath();
      for (var i = s, e = Math.min(n, s + step * BATCH); i < e; i += step) trace(i);
      paint();
    }
  }

  function polyPath(ctx, poly) {
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (var i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
    ctx.closePath();
  }

  /** A plaza's slightly wobbly outline. */
  function plazaRing(p) {
    var ring = [];
    for (var i = 0; i < 18; i++) {
      var a = (i / 18) * Math.PI * 2, r = p.r * (1 + 0.12 * Math.sin(a * 3 + p.x) + 0.06 * Math.cos(a * 5 + p.y));
      ring.push([p.x + Math.cos(a) * r, p.y + Math.sin(a) * r]);
    }
    return ring;
  }

  function mid(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }

  /** Local floor-plan coords (x along frontage, y from front wall) → world. */
  function localToWorld(b, x, y) {
    var tx = Math.cos(b.angle), ty = Math.sin(b.angle), fx = b.front[0], fy = b.front[1];
    var u = x - b.width / 2, v = b.depth / 2 - y;
    return [b.x + tx * u + fx * v, b.y + ty * u + fy * v];
  }

  // --- Draw functions -----------------------------------------------------------
  // DRAW[name](ctx, paint, env, layer), in world metres unless marked
  // `.screen` (then in CSS pixels). `env` carries the settlement (S), view
  // bounds (vb), scale (sc), one screen pixel in metres (px), growth
  // playback (t), the selection and highlight state, the style, and
  // color(ref) and paint(layer, key) to resolve style values.

  var DRAW = {};

  DRAW['terrain.hypso'] = function (ctx, P, env) {
    var W = env.S.bounds.size;
    ctx.imageSmoothingEnabled = true;
    if (env.r.terrainImg) ctx.drawImage(env.r.terrainImg, -W / 2, -W / 2, W, W);
  };

  // Flat stepped bands: each contour interval's ground is tinted by a
  // further `alpha` / bands of `fill`, so the value steps up at each
  // contour line. Vector, so crisp at any zoom; water isn't drawn here.
  DRAW['terrain.bands'] = function (ctx, P, env) {
    var r = env.r, T = env.S._.terrain, maxH = 0, H = T.heights;
    if (!r._bandTop) {
      for (var k = 0; k < H.length; k++) if (H[k] > maxH) maxH = H[k];
      r._bandTop = Math.max(1, Math.floor((maxH - T.wl) * T.relief / r.contours.interval));
    }
    ctx.fillStyle = env.color(P.fill);
    ctx.globalAlpha = P.alpha / r._bandTop;
    for (var b = 1; b <= r._bandTop; b++) {
      ctx.beginPath();
      r.terrainRings(b).forEach(function (ring) { polyPath(ctx, ring); });
      ctx.fill('evenodd');
    }
    ctx.globalAlpha = 1;
  };

  DRAW.contours = function (ctx, P, env, L) {
    var C = env.r.contours;
    ['minor', 'major'].forEach(function (k) {
      var Pk = env.paint(L, k);
      ctx.lineWidth = width(Pk.width, env.px);
      ctx.strokeStyle = env.color(Pk.stroke);
      ctx.stroke(C[k]);
    });
  };

  DRAW.river = function (ctx, P, env) {
    var river = env.S.terrain.river;
    if (!river) return;
    ctx.beginPath();
    (river.runs || [river.points]).forEach(function (run) {
      run.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
    });
    ctx.strokeStyle = env.color(P.stroke);
    ctx.lineWidth = width({ m: river.halfWidth * 2, px: P.width.px }, env.px);
    ctx.stroke();
  };

  DRAW.shore = function (ctx, P, env) {
    ctx.strokeStyle = env.color(P.stroke);
    ctx.lineWidth = width(P.width, env.px);
    ctx.stroke(env.r.contours.shore);
  };

  function outlineSelectedField(ctx, env) {
    var sel = env.selected, st = env.style.states.select;
    ctx.beginPath(); polyPath(ctx, sel.item.polygon);
    ctx.strokeStyle = env.color(st.stroke); ctx.lineWidth = width(st.width, env.px); ctx.stroke();
  }

  DRAW.fields = function (ctx, P, env, L) {
    var W = env.S.bounds.size, sel = env.selected;
    var vectors = function (c, P2, e) { fieldVectors(c, P2, e, L); };
    var img = env.r.bakedLayer('fields', env.sc * env.view.dpr, env, vectors, P);
    if (!img) return vectors(ctx, P, env);
    ctx.drawImage(img, -W / 2, -W / 2, W, W);
    if (sel && sel.kind === 'field') outlineSelectedField(ctx, env);
  };

  function fieldVectors(ctx, P, env, L) {
    var S = env.S, sc = env.sc, px = env.px, t = env.t, vb = env.vb, D = P.detail, sel = env.selected;
    var furrows = inZoom(D.zoom, sc), outline = inZoom(P.outline.zoom, sc);
    var fills = {}, lines = furrows ? [] : null, groves = furrows ? {} : null, crops = {};
    var R = D.treeRadius, step = D.treeSpacing;
    S.fields.forEach(function (f) {
      if (f.epoch > t) return;
      if (!f._b) f._b = G.polyBounds(f.polygon);
      if (!inView(vb, f._b, 0)) return;
      var Pk = crops[f.crop] || (crops[f.crop] = env.paint(L, f.crop));
      var col = env.color(Pk.fill);
      (fills[col] = fills[col] || []).push(f.polygon);
      if (!furrows) return;
      var p = f.polygon, n = Math.max(2, Math.floor(f.width / Pk.spacing));
      if (VG.CROPS[f.crop].trees) {
        // Orchards and groves: a grid of little trees.
        var gc = env.color(Pk.grove), g = groves[gc] = groves[gc] || [];
        var rows = Math.max(2, Math.floor(f.length / step)), cols = Math.max(1, Math.floor(f.width / step));
        for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
          var u = (c + 0.5) / cols, v = (r + 0.5) / rows;
          g.push(p[0][0] + (p[1][0] - p[0][0]) * u + (p[3][0] - p[0][0]) * v, p[0][1] + (p[1][1] - p[0][1]) * u + (p[3][1] - p[0][1]) * v);
        }
      } else if (Pk.rows) {
        for (var k = 1; k < n; k++) {
          var q = k / n;
          lines.push(p[0][0] + (p[1][0] - p[0][0]) * q, p[0][1] + (p[1][1] - p[0][1]) * q,
            p[3][0] + (p[2][0] - p[3][0]) * q, p[3][1] + (p[2][1] - p[3][1]) * q);
        }
      }
    });
    var cols = Object.keys(fills);
    ctx.globalAlpha = P.alpha;
    var fill = function () { ctx.fill(); };
    cols.forEach(function (col) {
      var list = fills[col];
      ctx.fillStyle = col;
      batched(ctx, list.length, 1, function (i) { polyPath(ctx, list[i]); }, fill);
    });
    ctx.globalAlpha = 1;
    if (outline) {
      ctx.strokeStyle = env.color(P.outline.stroke);
      ctx.lineWidth = width(P.outline.width, px);
      cols.forEach(function (col) {
        var list = fills[col];
        batched(ctx, list.length, 1, function (i) { polyPath(ctx, list[i]); }, function () { ctx.stroke(); });
      });
    }
    if (furrows) {
      Object.keys(groves).forEach(function (gc) {
        var g = groves[gc];
        ctx.fillStyle = gc;
        batched(ctx, g.length, 2, function (i) { ctx.moveTo(g[i] + R, g[i + 1]); ctx.arc(g[i], g[i + 1], R, 0, Math.PI * 2); }, fill);
      });
      ctx.strokeStyle = env.color(D.stroke);
      ctx.lineWidth = width(D.width, px);
      batched(ctx, lines.length, 4, function (i) { ctx.moveTo(lines[i], lines[i + 1]); ctx.lineTo(lines[i + 2], lines[i + 3]); }, function () { ctx.stroke(); });
    }
    if (sel && sel.kind === 'field' && sel.item.epoch <= t) outlineSelectedField(ctx, env);
  }

  DRAW.plazas = function (ctx, P, env, L) {
    env.S.plazas.forEach(function (p) {
      var Pk = env.paint(L, p.kind);
      ctx.beginPath();
      polyPath(ctx, plazaRing(p));
      ctx.fillStyle = env.color(Pk.fill);
      ctx.fill();
      ctx.strokeStyle = env.color(Pk.stroke);
      ctx.lineWidth = width(Pk.width, env.px);
      ctx.stroke();
    });
  };

  DRAW.landmarks = function (ctx, P, env, L) {
    env.S.landmarks.forEach(function (l) {
      var Pk = env.paint(L, l.type);
      ctx.beginPath();
      ctx.arc(l.x, l.y, Pk.radius, 0, Math.PI * 2);
      ctx.fillStyle = env.color(Pk.fill);
      ctx.fill();
      ctx.strokeStyle = env.color(Pk.stroke); ctx.lineWidth = width(Pk.width, env.px); ctx.stroke();
    });
  };

  /** The ways in view at this point in the town's growth, found once per frame. */
  function visibleWays(env) {
    if (env.ways) return env.ways;
    var S = env.S, N = S.network.nodes;
    return (env.ways = S.network.ways.filter(function (w) {
      if (w.epoch > env.t) return false;
      if (!w._b) {
        var b = [Infinity, Infinity, -Infinity, -Infinity];
        w.nodes.forEach(function (id) { var n = N[id]; b[0] = Math.min(b[0], n.x); b[1] = Math.min(b[1], n.y); b[2] = Math.max(b[2], n.x); b[3] = Math.max(b[3], n.y); });
        w._b = b;
      }
      return inView(env.vb, w._b, 10);
    }));
  }

  /**
   * A way's path. A road that leads somewhere is always traced on to its
   * exit past the map's edge, so it runs on under the fade instead of
   * stopping: a renderer rule, not a style option. Under a focus clip, a
   * way layer is drawn twice (env.wayMode): 'body' clipped, then 'exit'
   * unclipped. A way with an exit splits where it last leaves the focus
   * area, so its run out of town and on to the exit is never clipped away.
   */
  function traceWay(ctx, N, w, env) {
    var mode = env && env.wayMode, n = w.nodes.length, i0 = 0, i1 = n - 1;
    if (mode) {
      var cut = w.exit ? env.r.exitFrom(w) : n - 1;
      if (mode === 'exit') { if (!w.exit) return; i0 = cut; } else i1 = cut;
    }
    if (i1 > i0 || !w.exit) {
      ctx.moveTo(N[w.nodes[i0]].x, N[w.nodes[i0]].y);
      for (var i = i0 + 1; i <= i1; i++) ctx.lineTo(N[w.nodes[i]].x, N[w.nodes[i]].y);
    } else ctx.moveTo(N[w.nodes[i0]].x, N[w.nodes[i0]].y);
    if (w.exit && mode !== 'body') ctx.lineTo(w.exit.x, w.exit.y);
  }

  // A way's own width (its kind's, in metres) is the `m` of its fill; the
  // casing adds `pad` to both parts.
  DRAW.casing = function (ctx, P, env, L) {
    var N = env.S.network.nodes, K = VG.ROAD_KINDS, visible = visibleWays(env), pad = P.pad;
    P.order.forEach(function (kind) {
      var Pk = env.paint(L, kind);
      if (!Pk.stroke) return;
      ctx.beginPath();
      visible.forEach(function (w) { if (w.kind === kind) traceWay(ctx, N, w, env); });
      ctx.strokeStyle = env.color(Pk.stroke);
      ctx.lineWidth = Math.max(K[kind].width + pad.m, (Pk.px + pad.px) * env.px);
      ctx.stroke();
    });
  };

  DRAW.casing.ways = true;

  DRAW.bridges = function (ctx, P, env) {
    var S = env.S, N = S.network.nodes;
    ctx.beginPath();
    S.network.edges.forEach(function (e) {
      if (!e.bridge || S.network.ways[e.way].epoch > env.t) return;
      ctx.moveTo(N[e.a].x, N[e.a].y); ctx.lineTo(N[e.b].x, N[e.b].y);
    });
    ctx.strokeStyle = env.color(P.stroke);
    ctx.lineWidth = width(P.width, env.px);
    ctx.stroke();
  };

  DRAW.ways = function (ctx, P, env, L) {
    var N = env.S.network.nodes, K = VG.ROAD_KINDS, visible = visibleWays(env), px = env.px;
    P.order.forEach(function (kind) {
      var Pk = env.paint(L, kind);
      ctx.beginPath();
      visible.forEach(function (w) { if (w.kind === kind) traceWay(ctx, N, w, env); });
      ctx.strokeStyle = env.color(Pk.stroke);
      if (Pk.dash) ctx.setLineDash(Pk.dash.map(function (d) { return width(d, px); }));
      ctx.lineWidth = Math.max(K[kind].width, Pk.px * px);
      ctx.stroke();
      ctx.setLineDash([]);
    });
    var sel = env.selected, st = env.style.states.select;
    if (sel && sel.kind === 'way') {
      ctx.beginPath(); traceWay(ctx, N, sel.item, env);
      ctx.strokeStyle = env.color(st.way);
      ctx.lineWidth = Math.max(K[sel.item.kind].width + st.wayWidth.m, st.wayWidth.px * px);
      ctx.stroke();
    }
  };

  DRAW.ways.ways = true;

  DRAW['trees.baked'] = function (ctx, P, env) {
    var W = env.S.bounds.size;
    if (env.r.treeImg) ctx.drawImage(env.r.treeImg, -W / 2, -W / 2, W, W);
  };

  DRAW.buildings = function (ctx, P, env) {
    var W = env.S.bounds.size;
    var img = env.r.bakedLayer('buildings', env.sc * env.view.dpr, env, buildingVectors, P);
    if (img) ctx.drawImage(img, -W / 2, -W / 2, W, W);
    else buildingVectors(ctx, P, env);
  };

  function buildingVectors(ctx, P, env) {
    var S = env.S, sc = env.sc, px = env.px, t = env.t, vb = env.vb, hl = env.highlight, layers = env.layers;
    var fade = env.style.states.highlight.fade, sel = env.selected;
    var cats = env.style.categoryColors, catsHere = P.categoryColors || {};
    var O = P.open, rooms = layers.interiors && inZoom(O.zoom, sc), ridges = P.ridges && inZoom(P.ridges.zoom, sc);
    // Closed buildings are gathered per colour (and per highlight fade) and
    // drawn in one go; only buildings opened up to show rooms go one by one.
    var groups = {}, order = [], openList = [];
    var mills = inZoom(P.mills.zoom, sc) ? [] : null, doors = inZoom(P.doors.zoom, sc) ? [] : null;
    S.buildings.forEach(function (b) {
      if (b.epoch > t) return;
      if (!b._b) b._b = G.polyBounds(b.polygon);
      if (!inView(vb, b._b, 2)) return;
      var open = rooms || (sel && sel.item === b && sc >= O.selected && layers.interiors);
      var faded = hl && hl !== b.category;
      if (open) openList.push(b);
      else {
        var col = env.color(catsHere[b.category] || cats[b.category]);
        var key = col + (faded ? '~' : ''), g = groups[key];
        if (!g) { g = groups[key] = { col: col, faded: faded, list: [] }; order.push(key); }
        g.list.push(b);
      }
      if (mills && b.tags.indexOf('windmill') >= 0) mills.push(b);
      if (doors) doors.push(b);
    });
    var wall = env.color(P.stroke), wallWidth = width(P.width, px);
    order.forEach(function (key) {
      var g = groups[key];
      var list = g.list;
      ctx.globalAlpha = g.faded ? fade : 1;
      ctx.fillStyle = g.col;
      ctx.strokeStyle = wall;
      ctx.lineWidth = wallWidth;
      batched(ctx, list.length, 1, function (i) { polyPath(ctx, list[i].polygon); }, function () { ctx.fill(); ctx.stroke(); });
      if (ridges) {
        // Roof ridge along the long axis: a cheap hint of gables.
        var inset = P.ridges.inset;
        ctx.strokeStyle = env.color(P.ridges.stroke);
        ctx.lineWidth = width(P.ridges.width, px);
        batched(ctx, list.length, 1, function (i) {
          var b = list[i], p = b.polygon, long = b.width >= b.depth;
          var a = long ? mid(p[0], p[3]) : mid(p[0], p[1]), c = long ? mid(p[1], p[2]) : mid(p[3], p[2]);
          ctx.moveTo(a[0] + (c[0] - a[0]) * inset, a[1] + (c[1] - a[1]) * inset);
          ctx.lineTo(c[0] - (c[0] - a[0]) * inset, c[1] - (c[1] - a[1]) * inset);
        }, function () { ctx.stroke(); });
      }
    });
    ctx.globalAlpha = 1;
    openList.forEach(function (b) {
      ctx.globalAlpha = hl && hl !== b.category ? fade : 1;
      ctx.beginPath();
      polyPath(ctx, b.polygon);
      ctx.fillStyle = env.color(O.fill);
      ctx.fill();
      ctx.strokeStyle = env.color(O.stroke);
      ctx.lineWidth = width(O.width, px);
      ctx.stroke();
      drawRooms(ctx, b, P.rooms, env);
      ctx.globalAlpha = 1;
    });
    if (mills && mills.length) {
      var M = P.mills;
      ctx.beginPath();
      mills.forEach(function (b) {
        var r = Math.max(b.width, b.depth) * M.size;
        ctx.moveTo(b.x - r, b.y - r); ctx.lineTo(b.x + r, b.y + r);
        ctx.moveTo(b.x + r, b.y - r); ctx.lineTo(b.x - r, b.y + r);
      });
      ctx.strokeStyle = env.color(M.stroke); ctx.lineWidth = width(M.width, px); ctx.stroke();
    }
    if (doors && doors.length) {
      var hw = P.doors.halfWidth, dd = P.doors.depth;
      ctx.fillStyle = env.color(P.doors.fill);
      batched(ctx, doors.length, 1, function (i) {
        var b = doors[i], e = b.entrance, fx = b.front[0], fy = b.front[1];
        ctx.moveTo(e.x - fy * hw, e.y + fx * hw); ctx.lineTo(e.x + fy * hw, e.y - fx * hw);
        ctx.lineTo(e.x + fy * hw - fx * dd, e.y - fx * hw - fy * dd); ctx.lineTo(e.x - fy * hw - fx * dd, e.y + fx * hw - fy * dd);
        ctx.closePath();
      }, function () { ctx.fill(); });
    }
  }

  function drawRooms(ctx, b, R, env) {
    var sc = env.sc;
    ctx.strokeStyle = env.color(R.stroke);
    ctx.lineWidth = width(R.width, env.px);
    b.rooms.forEach(function (r) {
      var c = [localToWorld(b, r.x, r.y), localToWorld(b, r.x + r.w, r.y), localToWorld(b, r.x + r.w, r.y + r.d), localToWorld(b, r.x, r.y + r.d)];
      ctx.beginPath(); polyPath(ctx, c); ctx.stroke();
    });
    if (!inZoom(R.textZoom, sc)) return;
    var ang = b.angle;
    if (Math.cos(ang) < 0) ang += Math.PI;
    ctx.fillStyle = env.color(R.text);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    b.rooms.forEach(function (r) {
      var c = localToWorld(b, r.x + r.w / 2, r.y + r.d / 2), fs = Math.min(r.w, r.d) * R.textScale;
      if (fs * sc < R.minPx) return;
      ctx.save();
      ctx.translate(c[0], c[1]); ctx.rotate(ang);
      ctx.font = font(env.style, R.font, Math.min(fs, R.maxSize));
      ctx.fillText(r.name, 0, 0);
      ctx.restore();
    });
  }

  DRAW.trees = function (ctx, P, env) {
    var g = env.r.trees, cell = g.cell, vb = env.vb, colors = P.colors;
    if (P.alpha != null) {
      // Fading in: drawn at `alpha`, then put back.
      ctx.globalAlpha = G.clamp(P.alpha, 0, 1);
      DRAW.trees(ctx, merge(P, { alpha: null }), env);
      ctx.globalAlpha = 1;
      return;
    }
    if (!inZoom(P.shadow.zoom, env.sc)) {
      // Mid zoom: no shadows or outlines, so one path per crown colour.
      var lists = colors.map(function () { return []; });
      for (var jx = Math.floor(vb[0] / cell) - 1; jx <= Math.floor(vb[2] / cell) + 1; jx++) {
        for (var jy = Math.floor(vb[1] / cell) - 1; jy <= Math.floor(vb[3] / cell) + 1; jy++) {
          var bk = g.map.get(jx * 100003 + jy);
          if (bk) for (var k = 0; k < bk.length; k++) lists[bk[k][3]].push(bk[k]);
        }
      }
      lists.forEach(function (list, i) {
        ctx.fillStyle = colors[i];
        batched(ctx, list.length, 1, function (j) {
          var tr = list[j];
          ctx.moveTo(tr[0] + tr[2], tr[1]); ctx.arc(tr[0], tr[1], tr[2], 0, Math.PI * 2);
        }, function () { ctx.fill(); });
      });
      return;
    }
    var shade = env.color(P.shadow.fill), off = P.shadow.offset;
    for (var ix = Math.floor(vb[0] / cell) - 1; ix <= Math.floor(vb[2] / cell) + 1; ix++) {
      for (var iy = Math.floor(vb[1] / cell) - 1; iy <= Math.floor(vb[3] / cell) + 1; iy++) {
        var b = g.map.get(ix * 100003 + iy);
        if (!b) continue;
        for (var i = 0; i < b.length; i++) {
          var t = b[i];
          ctx.fillStyle = shade;
          ctx.beginPath(); ctx.arc(t[0] + t[2] * off[0], t[1] + t[2] * off[1], t[2], 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = colors[t[3]];
          ctx.beginPath(); ctx.arc(t[0], t[1], t[2], 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = P.edges[t[3]]; ctx.lineWidth = t[2] * P.edgeWidth; ctx.stroke();
        }
      }
    }
  };

  DRAW.vignette = function (ctx, P, env) {
    var W = env.S.bounds.size, vb = env.vb;
    var g = ctx.createRadialGradient(0, 0, W * P.inner, 0, 0, W * P.outer);
    P.stops.forEach(function (s) { g.addColorStop(s[0], hexA(env.paper, s[1])); });
    ctx.fillStyle = g;
    ctx.fillRect(vb[0] - 10, vb[1] - 10, vb[2] - vb[0] + 20, vb[3] - vb[1] + 20);
  };

  DRAW.selection = function (ctx, P, env) {
    var sel = env.selected, hov = env.hover, st = env.style.states.select, px = env.px;
    [hov, sel].forEach(function (s, i) {
      if (!s || s.kind !== 'building') return;
      ctx.beginPath(); polyPath(ctx, s.item.polygon);
      ctx.strokeStyle = env.color(i ? st.stroke : st.hover);
      ctx.lineWidth = width(i ? st.building : st.hoverWidth, px);
      ctx.stroke();
    });
    if (sel && sel.path) {
      var N = env.S.network.nodes;
      ctx.beginPath();
      sel.path.nodes.forEach(function (id, k) { var n = N[id]; if (k) ctx.lineTo(n.x, n.y); else ctx.moveTo(n.x, n.y); });
      ctx.strokeStyle = env.color(st.path);
      ctx.setLineDash(st.pathDash.map(function (d) { return width(d, px); }));
      ctx.lineWidth = width(st.pathWidth, px);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  };

  // --- Generic draw functions ------------------------------------------------------
  // `fill` and `stroke` draw whatever feature type the layer's `match` names,
  // so most new looks need only a style. (`natural` keeps its purpose-built
  // functions above.) FEATURES[collection](env) lists a collection's items in
  // view at this point in the town's growth, each as { key, item } plus its
  // geometry: `ring` (a closed polygon), `rings` (an area, filled evenodd),
  // `way` (traced on to its exit) or `path` (a prebuilt Path2D).

  var FEATURES = {
    field: function (env) {
      return env.S.fields.filter(function (f) { return f.epoch <= env.t && seen(env, f, f.polygon, 0); })
        .map(function (f) { return { key: f.crop, item: f, ring: f.polygon }; });
    },
    building: function (env) {
      return env.S.buildings.filter(function (b) { return b.epoch <= env.t && seen(env, b, b.polygon, 2); })
        .map(function (b) { return { key: b.category, item: b, ring: b.polygon }; });
    },
    plaza: function (env) {
      return env.S.plazas.map(function (p) { return { key: p.kind, item: p, ring: plazaRing(p) }; });
    },
    way: function (env) {
      return visibleWays(env).map(function (w) { return { key: w.kind, item: w, way: w }; });
    },
    area: function (env, key) {
      // An area exists as a whole or not at all; '*' isn't enumerable yet.
      var A = key && key !== '*' ? env.r.area(key) : null;
      return A && inView(env.vb, A.bounds, 0) ? [{ key: key, item: A, rings: A.rings }] : [];
    },
    // Standing water (sea and lakes) as one item, traced from the terrain.
    water: function (env) { return [{ key: 'body', item: null, rings: env.r.terrainRings('water') }]; },
    contour: function (env) {
      var C = env.r.contours;
      return [{ key: 'minor', path: C.minor }, { key: 'major', path: C.major }];
    },
    shore: function (env) { return [{ key: null, path: env.r.contours.shore }]; }
  };

  function seen(env, o, poly, pad) {
    if (!o._b) o._b = G.polyBounds(poly);
    return inView(env.vb, o._b, pad);
  }

  /**
   * The items a layer draws: its `match` ('field.*', 'area.boundary',
   * 'shore'…) and optional `filter` ({ type: ['inn', 'manor'], landing: true }:
   * every property must equal the value, or be one of a list).
   */
  function features(env, L) {
    var m = String(L.match || ''), i = m.indexOf('.'), coll = i < 0 ? m : m.slice(0, i), key = i < 0 ? null : m.slice(i + 1);
    var get = FEATURES[coll];
    if (!get) return [];
    var items = get(env, key), F = L.filter;
    return items.filter(function (it) {
      if (key && key !== '*' && it.key !== key) return false;
      for (var k in F || {}) {
        var v = it.item && it.item[k];
        if (Array.isArray(F[k]) ? F[k].indexOf(v) < 0 : v !== F[k]) return false;
      }
      return true;
    });
  }

  /** Add an item's geometry to the current path. */
  function traceItem(ctx, it, env) {
    if (it.ring) polyPath(ctx, it.ring);
    else if (it.rings) it.rings.forEach(function (r) { polyPath(ctx, r); });
    else if (it.way) traceWay(ctx, env.S.network.nodes, it.way, env);
  }

  /** The angle of a quad's long axis: field rows run along it. */
  function longAxis(p) {
    var ax = p[1][0] - p[0][0], ay = p[1][1] - p[0][1], bx = p[3][0] - p[0][0], by = p[3][1] - p[0][1];
    return ax * ax + ay * ay >= bx * bx + by * by ? Math.atan2(ay, ax) : Math.atan2(by, bx);
  }

  /**
   * The "what's here" highlight for a layer: items of the highlighted
   * category get the style's `states.highlight[layer.match]` paint on top
   * of their own, where '@category' is the category's colour.
   */
  function highlighter(env, L) {
    var st = env.style.states, H = env.highlight && st && st.highlight && st.highlight[L.match], cache = {};
    if (!H) return function (Pk) { return Pk; };
    return function (Pk, it) {
      var cat = it.item && it.item.category;
      if (cat !== env.highlight) return Pk;
      var id = it.key + '|' + cat;
      if (cache[id]) return cache[id];
      var out = merge(Pk, H), cc = env.style.categoryColors || {};
      ['fill', 'stroke'].forEach(function (k) { if (out[k] === '@category') out[k] = cc[cat]; });
      out.pattern = H.pattern || null;
      return (cache[id] = out);
    };
  }

  /**
   * Paint: { fill, pattern, align, alpha, stroke, width }. A pattern draws
   * its own `ground`, or over `fill` if it has none; too fine to see at this
   * zoom, it falls back to its ground (else `fill`). `align: 'field'` turns
   * each field's pattern to its long axis. An optional `stroke` outlines the
   * same shapes.
   */
  DRAW.fill = function (ctx, P, env, L) {
    var groups = {}, order = [], sc = env.sc, sets = env.r.patterns(env.paper), hl = highlighter(env, L);
    features(env, L).forEach(function (it) {
      if (it.path) return;
      var Pk = hl(zoomed(env.paint(L, it.key), sc), it), pat = Pk.pattern && sets[Pk.pattern];
      var vis = pat && pat.spacing * sc >= pat.minPx;
      var aligned = vis && Pk.align === 'field' && it.ring && it.ring.length === 4;
      var id = aligned ? 'item' + order.length : [Pk.fill, vis ? Pk.pattern : '', Pk.alpha, Pk.stroke, it.rings ? 'eo' : ''].join('|');
      var g = groups[id];
      if (!g) { g = groups[id] = { P: Pk, pat: vis ? Pk.pattern : null, flat: pat && !vis ? pat.ground : null, aligned: aligned, list: [] }; order.push(id); }
      g.list.push(it);
    });
    order.forEach(function (id) {
      var g = groups[id], Pk = g.P, list = g.list, rule = list[0].rings ? 'evenodd' : 'nonzero';
      var fill = function () { ctx.fill(rule); };
      var trace = function (i) { traceItem(ctx, list[i], env); };
      ctx.globalAlpha = Pk.alpha != null ? Pk.alpha : 1;
      if (g.pat) {
        if (Pk.fill && !sets[g.pat].ground) { ctx.fillStyle = env.color(Pk.fill); batched(ctx, list.length, 1, trace, fill); }
        var r0 = list[0].ring;
        ctx.fillStyle = g.aligned ? env.pattern(g.pat, longAxis(r0), r0[0][0], r0[0][1]) : env.pattern(g.pat);
        batched(ctx, list.length, 1, trace, fill);
      } else if (g.flat || Pk.fill) {
        ctx.fillStyle = g.flat || env.color(Pk.fill);
        batched(ctx, list.length, 1, trace, fill);
      }
      if (Pk.stroke) {
        ctx.strokeStyle = env.color(Pk.stroke);
        ctx.lineWidth = width(Pk.width || { px: 1 }, env.px);
        batched(ctx, list.length, 1, trace, function () { ctx.stroke(); });
      }
    });
    ctx.globalAlpha = 1;
  };

  /**
   * Paint: { stroke, width, dash, alpha, pattern }: outlines of polygons,
   * ways (traced on to their exits) and contour lines. Widths and dashes
   * are { m, px }; `pattern` strokes with a pattern instead of a colour.
   */
  DRAW.stroke = function (ctx, P, env, L) {
    var groups = {}, order = [], sc = env.sc, px = env.px;
    features(env, L).forEach(function (it) {
      if (env.wayMode === 'exit' && !(it.way && it.way.exit)) return;
      var Pk = zoomed(env.paint(L, it.key), sc), id = JSON.stringify([Pk.stroke, Pk.width, Pk.dash, Pk.alpha, Pk.pattern]);
      if (!Pk.stroke && !Pk.pattern) return; // stroke: null turns a key off
      var g = groups[id];
      if (!g) { g = groups[id] = { P: Pk, list: [] }; order.push(id); }
      g.list.push(it);
    });
    order.forEach(function (id) {
      var Pk = groups[id].P, list = groups[id].list;
      ctx.globalAlpha = Pk.alpha != null ? Pk.alpha : 1;
      ctx.strokeStyle = (Pk.pattern && env.pattern(Pk.pattern)) || env.color(Pk.stroke);
      ctx.lineWidth = width(Pk.width || { px: 1 }, px);
      if (Pk.dash) ctx.setLineDash(Pk.dash.map(function (d) { return typeof d === 'number' ? d * px : width(d, px); }));
      var paths = list.filter(function (it) { return it.path; }), rest = list.filter(function (it) { return !it.path; });
      paths.forEach(function (it) { ctx.stroke(it.path); });
      batched(ctx, rest.length, 1, function (i) { traceItem(ctx, rest[i], env); }, function () { ctx.stroke(); });
      ctx.setLineDash([]);
    });
    ctx.globalAlpha = 1;
  };
  DRAW.stroke.ways = true;

  // Labels, in screen pixels.

  function screenOf(env) {
    var v = env.view, sc = v.scale;
    return function (x, y) { return [(x - v.cx) * sc + v.w / 2, (y - v.cy) * sc + v.h / 2]; };
  }

  /** Text with a halo. Parsing a font string is slow, so it's only set when it changes. */
  function halo(ctx, env, text, x, y, f, fill, name) {
    var H = env.style.halo, def = name && env.style.fonts[name];
    if (f !== env.lastFont) { ctx.font = f; env.lastFont = f; }
    if (def) { text = caps(def, text); spacing(ctx, env, def); }
    if (H && H.width) {
      ctx.lineWidth = H.width; ctx.strokeStyle = env.color(H.stroke); ctx.lineJoin = 'round';
      ctx.strokeText(text, x, y);
    }
    ctx.fillStyle = fill; ctx.fillText(text, x, y);
  }

  /** A font's `caps: true` sets its labels in capitals. */
  function caps(def, text) { return def && def.caps ? text.toUpperCase() : text; }

  /** A font's `tracking` (in ems) as letter spacing, where the canvas supports it. */
  function spacing(ctx, env, def) {
    var ls = def && def.tracking ? def.tracking * def.size : 0;
    if (ls !== env.ls && 'letterSpacing' in ctx) ctx.letterSpacing = ls + 'px';
    env.ls = ls;
  }

  // Where the roads go: a tab you can click to travel there (places already
  // in the atlas are marked), and a lane down to the water gets a landing
  // mark. A style can restyle these but not drop them.
  DRAW['labels.destination'] = function (ctx, P, env) {
    var S = env.S, view = env.view, r = env.r, screen = screenOf(env), style = env.style;
    var landFont = font(style, P.landing.font), tabFont = font(style, P.font);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    env.lastFont = null;
    var hits = r.destHits;
    S.network.ways.forEach(function (w) {
      if (w.landing && w.rim && w.epoch <= env.t) {
        // A lane down to the water: marked, but it leads nowhere.
        var q = screen(w.rim.x, w.rim.y);
        if (q[0] > -40 && q[1] > -20 && q[0] < view.w + 40 && q[1] < view.h + 20) halo(ctx, env, P.landing.text, q[0], q[1] + P.landing.dy, landFont, env.color(P.landing.color), P.landing.font);
        env.lastFont = null;
        return;
      }
      if (!w.destination || !w.rim) return;
      var rr = Math.hypot(w.rim.x, w.rim.y) || 1, k = Math.min(1, (S.bounds.size * P.reach) / rr);
      var p = screen(w.rim.x * k, w.rim.y * k);
      if (p[0] < -80 || p[1] < -20 || p[0] > view.w + 80 || p[1] > view.h + 20) return;
      var text = caps(style.fonts[P.font], (w.ferry ? '⛴ ferry to ' : 'to ') + w.destination + ' →'), known = r.isKnown && r.isKnown(w.destination), hov = r.hoverDest === w;
      ctx.font = tabFont; env.lastFont = null;
      spacing(ctx, env, style.fonts[P.font]);
      var tw = ctx.measureText(text).width, x0 = p[0] - tw / 2 - P.padX, y0 = p[1] - P.height / 2, bw = tw + P.padX * 2, bh = P.height;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x0, y0, bw, bh, P.radius); else ctx.rect(x0, y0, bw, bh);
      ctx.fillStyle = env.color(hov ? P.fillHover : P.fill);
      ctx.fill();
      ctx.lineWidth = hov ? P.widthHover : P.width;
      ctx.strokeStyle = env.color(known ? P.known : hov ? P.strokeHover : P.stroke);
      ctx.stroke();
      ctx.fillStyle = env.color(known ? P.known : P.color);
      ctx.fillText(text, p[0], p[1] + 0.5);
      hits.push({ way: w, x0: x0, y0: y0, x1: x0 + bw, y1: y0 + bh });
    });
  };
  DRAW['labels.destination'].screen = true;
  DRAW['labels.destination'].unclipped = true; // never clipped away by a focus

  // Street names along their middle segment.
  DRAW['labels.street'] = function (ctx, P, env) {
    var S = env.S, N = S.network.nodes, view = env.view, screen = screenOf(env), f = font(env.style, P.font), fill = env.color(P.color);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // Set outside save/restore, which would otherwise undo it behind the cache.
    ctx.font = env.lastFont = f;
    spacing(ctx, env, env.style.fonts[P.font]);
    S.network.ways.forEach(function (w) {
      if (!w.name || w.epoch > env.t || w.length < P.minLength) return;
      var m = w.nodes.length >> 1, a = N[w.nodes[Math.max(0, m - 1)]], b = N[w.nodes[Math.min(w.nodes.length - 1, m + 1)]];
      var p = screen((a.x + b.x) / 2, (a.y + b.y) / 2);
      if (p[0] < -80 || p[1] < -20 || p[0] > view.w + 80 || p[1] > view.h + 20) return;
      var ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
      ctx.save();
      ctx.translate(p[0], p[1]); ctx.rotate(ang);
      halo(ctx, env, w.name, 0, 0, f, fill, P.font);
      ctx.restore();
    });
  };
  DRAW['labels.street'].screen = true;

  // Named buildings: those in `categories` and `types` always, the types in
  // `more` past their zoom, and everything named past `all`.
  DRAW['labels.building'] = function (ctx, P, env) {
    var S = env.S, sc = env.sc, view = env.view, screen = screenOf(env), f = font(env.style, P.font), fill = env.color(P.color);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    function shown(b) {
      if (P.categories.indexOf(b.category) >= 0 || P.types.indexOf(b.type) >= 0 || sc > P.all) return true;
      for (var i = 0; i < P.more.length; i++) if (sc > P.more[i][0] && P.more[i][1].indexOf(b.type) >= 0) return true;
      return false;
    }
    S.buildings.forEach(function (b) {
      if (!b.name || b.epoch > env.t || !shown(b)) return;
      var p = screen(b.x, b.y);
      if (p[0] < -60 || p[1] < -20 || p[0] > view.w + 60 || p[1] > view.h + 20) return;
      halo(ctx, env, b.name, p[0], p[1] - Math.max(b.width, b.depth) * sc * 0.5 - P.gap, f, fill, P.font);
    });
  };
  DRAW['labels.building'].screen = true;

  // The settlement's name and size, when zoomed out.
  DRAW['labels.place'] = function (ctx, P, env) {
    var S = env.S, c = screenOf(env)(S.center.x, S.center.y - S.radius * P.above), y = Math.max(P.minY, c[1]);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalAlpha = G.clamp(P.alpha, 0, 1);
    halo(ctx, env, S.name, c[0], y, font(env.style, P.font), env.color(P.color), P.font);
    halo(ctx, env, S.size.label + ' · pop. ' + S.stats.population.toLocaleString(), c[0], y + P.sub.dy, font(env.style, P.sub.font), env.color(P.sub.color), P.sub.font);
    ctx.globalAlpha = 1;
  };
  DRAW['labels.place'].screen = true;

  DRAW.scaleBar = function (ctx, P, env) {
    var view = env.view, target = P.target / view.scale, len = niceStep(target), ink = env.color(P.color);
    if (len / target > 1.4) len /= 2;
    var w = len * view.scale, x = 14, y = view.h - 16;
    ctx.fillStyle = env.color(P.ground);
    ctx.fillRect(x - 6, y - 18, w + 12 + 40, 26);
    ctx.strokeStyle = ink; ctx.lineWidth = P.width;
    ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y - 4); ctx.stroke();
    ctx.fillStyle = ink; ctx.font = font(env.style, P.font); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(len >= 1000 ? len / 1000 + ' km' : len + ' m', x + w + 6, y);
  };
  DRAW.scaleBar.screen = true;

  VG.render = {
    Renderer: Renderer, CAT_LABELS: CAT_LABELS, draw: DRAW, features: FEATURES, localToWorld: localToWorld,
    color: color, width: width, atZoom: atZoom
  };
})(window);
