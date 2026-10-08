// Terrain: a heightfield shaped per environment, an optional river carved
// into it, and fast lookups (height, slope, water, distance to water).
//
// Heights are normalised (water level `wl` somewhere around 0.1–0.3). All
// noise runs in map-normalised coordinates (x / W), so a city-sized map and
// a hamlet-sized map have the same overall shape; relief scales with W so
// slopes in metres-per-metre stay comparable.
(function (global) {
  'use strict';
  var VG = (global.VillageGen = global.VillageGen || {});
  var G = VG.geom, R = VG.rng;

  // reliefPerKm: metres of relief per km of map width.
  // river: chance of a river when River is "auto".
  // forest: base woodland cover. fields: how farmable the land feels.
  var ENVIRONMENTS = {
    valley:    { label: 'River valley',      reliefPerKm: 48, river: 1,    forest: 0.45, fields: 1.0, palette: 'temperate' },
    plains:    { label: 'Open plains',       reliefPerKm: 30,  river: 0.5,  forest: 0.2,  fields: 1.2, palette: 'temperate' },
    coast:     { label: 'Coast',             reliefPerKm: 55,  river: 0.45, forest: 0.3,  fields: 0.9, palette: 'temperate' },
    highlands: { label: 'Highlands',         reliefPerKm: 60, river: 0.6,  forest: 0.35, fields: 0.55, palette: 'highland', maxSlope: 0.3 },
    forest:    { label: 'Forest clearing',   reliefPerKm: 40,  river: 0.45, forest: 0.85, fields: 0.6, palette: 'temperate' },
    lakeside:  { label: 'Lakeside',          reliefPerKm: 50,  river: 0.35, forest: 0.4,  fields: 0.9, palette: 'temperate' },
    island:    { label: 'Island',            reliefPerKm: 60, river: 0,    forest: 0.3,  fields: 0.8, palette: 'temperate' },
    arid:      { label: 'Arid oasis',        reliefPerKm: 35,  river: 0.4,  forest: 0.06, fields: 0.5, palette: 'arid' }
  };

  var RES = 257;

  function buildTerrain(o) {
    var W = o.W, env = ENVIRONMENTS[o.environment] || ENVIRONMENTS.valley;
    var rand = R.createRng(o.seed, 'terrain');
    var nA = R.makeNoise2(rand), nB = R.makeNoise2(rand), nC = R.makeNoise2(rand);
    var ox = rand() * 100, oy = rand() * 100;
    var axisA = rand() * Math.PI, ax = Math.cos(axisA), ay = Math.sin(axisA);
    var coastA = rand() * Math.PI * 2, cx = Math.cos(coastA), cy = Math.sin(coastA);
    var lakeA = rand() * Math.PI * 2, lakeD = o.environment === 'arid' ? rand() * 0.06 : 0.1 + rand() * 0.06;
    var lake = [Math.cos(lakeA) * lakeD, Math.sin(lakeA) * lakeD];
    var wl = { valley: 0.1, plains: 0.1, coast: 0.3, highlands: 0.08, forest: 0.1, lakeside: 0.24, island: 0.3, arid: 0.06 }[o.environment] || 0.1;

    var heights = new Float32Array(RES * RES);
    for (var j = 0; j < RES; j++) {
      for (var i = 0; i < RES; i++) {
        var u = i / (RES - 1) - 0.5, v = j / (RES - 1) - 0.5;
        var n = R.fbm(nA, u * 3 + ox, v * 3 + oy, 6);
        var m = R.fbm(nB, u * 2 + oy, v * 2 + ox, 3);
        var h, d;
        switch (o.environment) {
          case 'plains':
            h = 0.38 + 0.2 * n + 0.06 * m; break;
          case 'coast':
            d = u * cx + v * cy + 0.08 * m;
            h = wl + 1.0 * (d + 0.17) + 0.15 * n; break;
          case 'highlands':
            var r = 1 - Math.abs(R.fbm(nB, u * 2.4 + ox, v * 2.4 + oy, 4));
            h = 0.12 + 0.6 * r * r + 0.22 * (n * 0.5 + 0.5); break;
          case 'forest':
            h = 0.36 + 0.24 * n; break;
          case 'lakeside':
            d = Math.hypot(u - lake[0], v - lake[1]) + 0.05 * m;
            h = 0.17 + 0.48 * G.smoothstep(0.04, 0.42, d) + 0.16 * n; break;
          case 'island':
            d = Math.hypot(u, v) * 2 + 0.16 * m;
            h = 0.62 - 0.55 * d * d + 0.2 * n; break;
          case 'arid':
            d = Math.hypot(u - lake[0], v - lake[1]) + 0.01 * m;
            h = 0.34 + 0.14 * n + 0.08 * (1 - Math.abs(nC(u * 9, v * 9))) - 0.36 * (1 - G.smoothstep(0.01, 0.045, d));
            break;
          default: // valley
            d = Math.abs(-ay * u + ax * v + 0.07 * m);
            h = 0.17 + 0.6 * G.smoothstep(0.02, 0.42, d) + 0.22 * n;
        }
        heights[j * RES + i] = h;
      }
    }

    // --- River -------------------------------------------------------------
    var wantRiver = o.river === 'yes' || (o.river !== 'no' && rand() < env.river);
    var river = null;
    if (wantRiver) {
      var a, b, perpX, perpY, off = (rand() - 0.5) * 0.16;
      if (o.environment === 'valley') {
        a = [-ax * 0.62 - ay * off, -ay * 0.62 + ax * off];
        b = [ax * 0.62 - ay * off * 0.5, ay * 0.62 + ax * off * 0.5];
      } else if (o.environment === 'coast') {
        var ia = coastA + (rand() - 0.5) * 1.2;
        a = [Math.cos(ia) * 0.62, Math.sin(ia) * 0.62];
        b = [-cx * 0.42, -cy * 0.42];
      } else if (o.environment === 'lakeside') {
        var la = lakeA + Math.PI * (0.6 + rand() * 0.8);
        a = [Math.cos(la) * 0.62, Math.sin(la) * 0.62];
        b = [lake[0], lake[1]];
      } else {
        var ra = rand() * Math.PI * 2;
        perpX = -Math.sin(ra); perpY = Math.cos(ra);
        a = [Math.cos(ra) * 0.62 + perpX * off, Math.sin(ra) * 0.62 + perpY * off];
        b = [-Math.cos(ra) * 0.62 + perpX * off * 0.3, -Math.sin(ra) * 0.62 + perpY * off * 0.3];
      }
      var pts = meander([a, b], rand, o.environment === 'highlands' ? 0.12 : 0.17);
      var halfW = G.clamp(W * 0.004, 2.5, 30) * (0.8 + rand() * 0.5);
      river = { points: pts.map(function (p) { return [p[0] * W, p[1] * W]; }), halfWidth: halfW };
      carveRiver(heights, river, W, wl, o.environment === 'valley' ? 0.06 : 0.035);
    }

    return finishTerrain({
      W: W, res: RES, cell: W / (RES - 1), heights: heights, wl: wl,
      relief: env.reliefPerKm * W / 1000, reliefPerKm: env.reliefPerKm,
      environment: o.environment, env: env, river: river,
      noise: { forest: nC, ox: ox, oy: oy }
    });
  }

  // Midpoint displacement + Chaikin smoothing → a meandering polyline.
  function meander(pts, rand, amp) {
    for (var level = 0; level < 6; level++) {
      var out = [pts[0]];
      for (var i = 1; i < pts.length; i++) {
        var p = pts[i - 1], q = pts[i];
        var dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
        var k = (rand() - 0.5) * 2 * amp * len * Math.pow(0.8, level);
        out.push([(p[0] + q[0]) / 2 - (dy / len) * k, (p[1] + q[1]) / 2 + (dx / len) * k], q);
      }
      pts = out;
    }
    for (var s = 0; s < 3; s++) {
      var sm = [pts[0]];
      for (var t = 0; t < pts.length - 1; t++) {
        var p0 = pts[t], p1 = pts[t + 1];
        sm.push([0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]],
                [0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]]);
      }
      sm.push(pts[pts.length - 1]);
      pts = sm;
    }
    return pts;
  }

  function carveRiver(heights, river, W, wl, plainFrac) {
    var pts = river.points, hw = river.halfWidth, plain = Math.max(hw * 3, W * plainFrac);
    var hash = new G.SpatialHash(plain);
    for (var k = 1; k < pts.length; k++) {
      var sg = [pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]];
      hash.insert(sg, Math.min(sg[0], sg[2]), Math.min(sg[1], sg[3]), Math.max(sg[0], sg[2]), Math.max(sg[1], sg[3]));
    }
    for (var j = 0; j < RES; j++) {
      for (var i = 0; i < RES; i++) {
        var x = (i / (RES - 1) - 0.5) * W, y = (j / (RES - 1) - 0.5) * W, d = Infinity;
        hash.query(x - plain, y - plain, x + plain, y + plain, function (q) {
          var dd = G.distToSeg(x, y, q[0], q[1], q[2], q[3]);
          if (dd < d) d = dd;
        });
        var idx = j * RES + i, h = heights[idx];
        // The channel itself is drawn (and tested) from the vector polyline;
        // the grid only carries the valley floor, just above the water line.
        if (d < hw) h = Math.min(h, wl + 0.004);
        else if (d < plain && h > wl) h = wl + 0.012 + (h - wl - 0.012) * G.smoothstep(hw, plain, d);
        heights[idx] = Math.min(heights[idx], h);
      }
    }
  }

  function finishTerrain(T) {
    var W = T.W, res = T.res, H = T.heights;

    T.heightAt = function (x, y) {
      var gx = G.clamp((x / W + 0.5) * (res - 1), 0, res - 1.0001);
      var gy = G.clamp((y / W + 0.5) * (res - 1), 0, res - 1.0001);
      var i = gx | 0, j = gy | 0, fx = gx - i, fy = gy - j, k = j * res + i;
      return (H[k] * (1 - fx) + H[k + 1] * fx) * (1 - fy) + (H[k + res] * (1 - fx) + H[k + res + 1] * fx) * fy;
    };
    /** Metres above the water line. */
    T.elevationAt = function (x, y) { return (T.heightAt(x, y) - T.wl) * T.relief; };
    /** Gradient magnitude in metres per metre. */
    T.slopeAt = function (x, y) {
      var e = T.cell * 0.75;
      var gx = (T.heightAt(x + e, y) - T.heightAt(x - e, y)) / (2 * e);
      var gy = (T.heightAt(x, y + e) - T.heightAt(x, y - e)) / (2 * e);
      return Math.hypot(gx, gy) * T.relief;
    };

    // River segment hash for fast distance lookups.
    var rh = null;
    if (T.river) {
      rh = new G.SpatialHash(Math.max(40, T.river.halfWidth * 4));
      var p = T.river.points;
      for (var k = 1; k < p.length; k++) {
        var s = [p[k - 1][0], p[k - 1][1], p[k][0], p[k][1]];
        rh.insert(s, Math.min(s[0], s[2]), Math.min(s[1], s[3]), Math.max(s[0], s[2]), Math.max(s[1], s[3]));
      }
    }
    T.riverDist = function (x, y, maxR) {
      if (!rh) return Infinity;
      var best = Infinity, r = maxR || T.river.halfWidth * 3;
      rh.query(x - r, y - r, x + r, y + r, function (s) {
        var d = G.distToSeg(x, y, s[0], s[1], s[2], s[3]);
        if (d < best) best = d;
      });
      return best;
    };
    T.isRiver = function (x, y) { return !!rh && T.riverDist(x, y) < T.river.halfWidth; };
    /** Standing water (sea, lake, pond), as opposed to the river. */
    T.isWaterBody = function (x, y) {
      return T.heightAt(x, y) < T.wl && (!rh || T.riverDist(x, y, T.river.halfWidth + T.cell * 2) > T.river.halfWidth + T.cell * 1.5);
    };
    T.isWater = function (x, y) { return T.heightAt(x, y) < T.wl || T.isRiver(x, y); };

    // Distance to any water, in metres, via a two-pass chamfer transform.
    var D = new Float32Array(res * res), BIG = 1e9, c = T.cell, c2 = c * Math.SQRT2;
    for (var j = 0; j < res; j++) {
      for (var i = 0; i < res; i++) {
        var x = (i / (res - 1) - 0.5) * W, y = (j / (res - 1) - 0.5) * W;
        D[j * res + i] = H[j * res + i] < T.wl || (rh && T.riverDist(x, y, c) < Math.max(T.river.halfWidth, c * 0.5)) ? 0 : BIG;
      }
    }
    var at = function (i, j) { return D[j * res + i]; };
    for (j = 0; j < res; j++) for (i = 0; i < res; i++) {
      var v = at(i, j);
      if (i > 0) v = Math.min(v, at(i - 1, j) + c);
      if (j > 0) v = Math.min(v, at(i, j - 1) + c);
      if (i > 0 && j > 0) v = Math.min(v, at(i - 1, j - 1) + c2);
      if (i < res - 1 && j > 0) v = Math.min(v, at(i + 1, j - 1) + c2);
      D[j * res + i] = v;
    }
    for (j = res - 1; j >= 0; j--) for (i = res - 1; i >= 0; i--) {
      v = at(i, j);
      if (i < res - 1) v = Math.min(v, at(i + 1, j) + c);
      if (j < res - 1) v = Math.min(v, at(i, j + 1) + c);
      if (i < res - 1 && j < res - 1) v = Math.min(v, at(i + 1, j + 1) + c2);
      if (i > 0 && j < res - 1) v = Math.min(v, at(i - 1, j + 1) + c2);
      D[j * res + i] = v;
    }
    T.waterDist = D;
    T.waterDistAt = function (x, y) {
      var gi = Math.round(G.clamp((x / W + 0.5) * (res - 1), 0, res - 1));
      var gj = Math.round(G.clamp((y / W + 0.5) * (res - 1), 0, res - 1));
      return D[gj * res + gi];
    };
    return T;
  }

  VG.ENVIRONMENTS = ENVIRONMENTS;
  VG.terrain = { build: buildTerrain };
})(typeof window !== 'undefined' ? window : globalThis);
