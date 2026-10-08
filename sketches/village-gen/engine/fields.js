// Countryside: strip fields in furlongs along roads and tracks, then trees
// (woodland, hedgerow and garden trees) in whatever space is left.
(function (global) {
  'use strict';
  var VG = (global.VillageGen = global.VillageGen || {});
  var G = VG.geom;

  var CROPS = {
    wheat:     { label: 'Wheat' },
    barley:    { label: 'Barley' },
    oats:      { label: 'Oats' },
    rye:       { label: 'Rye' },
    flax:      { label: 'Flax' },
    fallow:    { label: 'Fallow' },
    pasture:   { label: 'Pasture', livestock: true },
    meadow:    { label: 'Hay meadow' },
    vegetables:{ label: 'Market garden' },
    orchard:   { label: 'Orchard', trees: true },
    vineyard:  { label: 'Vineyard' },
    millet:    { label: 'Millet' },
    dates:     { label: 'Date grove', trees: true },
    olives:    { label: 'Olive grove', trees: true }
  };
  var CROP_MIX = {
    temperate: { wheat: 4, barley: 3, oats: 2, rye: 1, flax: 0.7, fallow: 2, pasture: 3, meadow: 2, vegetables: 0.8, orchard: 0.8 },
    highland:  { oats: 3, barley: 2, rye: 1.5, fallow: 1, pasture: 6, meadow: 3, orchard: 0.3 },
    arid:      { millet: 3, barley: 2, wheat: 1, fallow: 1.5, vegetables: 1.5, dates: 2.5, olives: 2, vineyard: 1 }
  };

  function pickCrop(rand, palette, slope) {
    var mix = CROP_MIX[palette] || CROP_MIX.temperate, keys = Object.keys(mix);
    if (slope > 0.12 && palette !== 'highland' && rand() < 0.5) return rand() < 0.5 ? 'vineyard' : 'pasture';
    return rand.weighted(keys, function (k) { return mix[k]; });
  }

  function layFields(S, rand) {
    var T = S.terrain, net = S.network, P = S.params, R = S.radius, fields = [];
    var hash = new G.SpatialHash(60), placer = S._placer, N = net.nodes;
    var scale = G.clamp(Math.sqrt(T.W / 1500), 0.8, 1.7), lim = T.W * 0.44;
    var maxSlope = (S.env.maxSlope || 0.2) + 0.12;
    var reach = R * 1.2 + P.farmland * T.W * 0.32 * (S.env.fields || 1);
    var furlong = 0;

    function fieldFits(poly, cx, cy) {
      for (var i = 0; i < 4; i++) {
        var c = poly[i];
        if (Math.hypot(c[0], c[1]) > lim || T.isWater(c[0], c[1]) || T.slopeAt(c[0], c[1]) > maxSlope) return false;
        if (Math.hypot(c[0] - S.center.x, c[1] - S.center.y) < R * 0.75) return false;
      }
      if (T.isWater(cx, cy)) return false;
      var b = G.polyBounds(poly);
      if (hash.query(b[0], b[1], b[2], b[3], function (f) { return G.quadsOverlap(poly, f.polygon); })) return false;
      if (placer.hash.query(b[0] - 3, b[1] - 3, b[2] + 3, b[3] + 3, function (o) { return G.quadsOverlap(poly, o.polygon); })) return false;
      return !net.segHash.query(b[0], b[1], b[2], b[3], function (e) {
        if (e.dead) return false;
        var A = N[e.a], B = N[e.b];
        return G.pointInPoly((A.x + B.x) / 2, (A.y + B.y) / 2, poly) || G.pointInPoly(A.x, A.y, poly) ||
          !!G.segIntersect(A.x, A.y, B.x, B.y, poly[0][0], poly[0][1], poly[2][0], poly[2][1]) ||
          !!G.segIntersect(A.x, A.y, B.x, B.y, poly[1][0], poly[1][1], poly[3][0], poly[3][1]);
      });
    }

    /** A furlong: a block of parallel strips, long axis along `dir`. */
    function furlongAt(ox, oy, dir, length, depth, crop, rot) {
      var tx = Math.cos(dir), ty = Math.sin(dir), nx = -ty, ny = tx;
      var stripW = rand.range(9, 22) * scale, n = Math.max(1, Math.round(length / stripW));
      var id = furlong++, placed = 0;
      for (var i = 0; i < n; i++) {
        var along = (i - (n - 1) / 2) * stripW;
        var cx = ox + tx * along + nx * depth / 2, cy = oy + ty * along + ny * depth / 2;
        var dep = depth * rand.range(0.85, 1.1);
        // Strips run *away* from the road: long axis along the normal.
        var poly = G.rectCorners(cx, cy, stripW * 0.97, dep, dir + (rot || 0));
        var c = rand() < 0.25 ? pickCrop(rand, S.env.palette, T.slopeAt(cx, cy)) : crop;
        if (!fieldFits(poly, cx, cy)) continue;
        var f = {
          id: fields.length, furlong: id, crop: c, label: CROPS[c].label,
          x: Math.round(cx), y: Math.round(cy), angle: Math.round((dir + (rot || 0)) * 1000) / 1000,
          width: Math.round(stripW), length: Math.round(dep),
          polygon: poly.map(function (p) { return [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]; }),
          area: Math.round(stripW * dep), hectares: Math.round(stripW * dep / 100) / 100
        };
        fields.push(f);
        var b = G.polyBounds(poly);
        hash.insert(f, b[0], b[1], b[2], b[3]);
        placed++;
      }
      return placed;
    }

    for (var wi = 0; wi < net.ways.length; wi++) {
      var way = net.ways[wi], L = way._cum[way._cum.length - 1];
      if (way.kind === 'street') continue;
      var s = rand.range(0, 30);
      while (s < L) {
        var chunk = rand.range(50, 140) * scale;
        for (var side = -1; side <= 1; side += 2) {
          var pose = VG.buildings.poseOnWay(way, s + chunk / 2, side, chunk, 1, 3, net);
          var dc = Math.hypot(pose.x - S.center.x, pose.y - S.center.y);
          if (dc < R * 0.8 || dc > reach || rand() > 0.35 + P.farmland * 0.6) continue;
          var dir = pose.angle + rand.gauss() * 0.06, depth = rand.range(50, 140) * scale;
          var crop = pickCrop(rand, S.env.palette, T.slopeAt(pose.x, pose.y));
          var ox = pose.x - pose.front[0] * 1, oy = pose.y - pose.front[1] * 1;
          var nx = -pose.front[0], ny = -pose.front[1];
          // The furlong's base line sits on the road edge; strips extend away.
          var ang = Math.atan2(ny, nx) - Math.PI / 2;
          if (furlongAt(ox, oy, ang, chunk, depth, crop, 0) && rand() < 0.65) {
            // A second furlong behind, turned 90° → patchwork.
            var bx = ox + nx * (depth + 6), by = oy + ny * (depth + 6);
            furlongAt(bx, by, ang + Math.PI / 2 * (rand() < 0.5 ? 1 : -1), depth * rand.range(0.8, 1.4),
              chunk * rand.range(0.6, 1.1), pickCrop(rand, S.env.palette, T.slopeAt(bx, by)), 0);
          }
        }
        s += chunk + rand.range(5, 40) * scale;
      }
    }
    // Patchwork: grow more furlongs off the sides of existing ones, so the
    // farmland fills out between the roads instead of lining them.
    var target = Math.round(furlong * (0.6 + P.farmland * 2.2)), guard = 0;
    while (fields.length && furlong < target && guard++ < target * 12) {
      var f = rand.pick(fields), ang = f.angle + (rand() < 0.5 ? 0 : Math.PI / 2) + rand.gauss() * 0.08;
      var e = rand.int(0, 3), p0 = f.polygon[e], p1 = f.polygon[(e + 1) & 3];
      var mx = (p0[0] + p1[0]) / 2 - f.x, my = (p0[1] + p1[1]) / 2 - f.y, ml = Math.hypot(mx, my) || 1;
      var gap = rand.range(3, 8);
      var bx = f.x + mx / ml * (ml + gap), by = f.y + my / ml * (ml + gap);
      var dcf = Math.hypot(bx - S.center.x, by - S.center.y);
      if (dcf > reach || dcf < R * 0.8) continue;
      // Make the new block's base line face away from the parent field.
      var tx = Math.cos(ang), ty = Math.sin(ang);
      if (-ty * mx + tx * my < 0) ang += Math.PI;
      furlongAt(bx, by, ang, rand.range(40, 130) * scale, rand.range(45, 130) * scale,
        pickCrop(rand, S.env.palette, T.slopeAt(bx, by)), 0);
    }
    S.fieldHash = hash;
    return fields;
  }

  /** Trees: woodland by noise, hedgerows on field edges, garden trees. */
  function plantTrees(S, rand) {
    var T = S.terrain, net = S.network, N = net.nodes, R = S.radius, cx = S.center.x, cy = S.center.y;
    var nz = T.noise.forest, ox = T.noise.ox, oy = T.noise.oy, W = T.W, lim = W * 0.47;
    var spacing = Math.max(6, W / 340), trees = [];
    var cover = G.clamp((S.env.forest || 0.3) * (0.4 + S.params.woodland * 1.2), 0, 1);
    var arid = S.env.palette === 'arid';

    function blocked(x, y, r) {
      if (T.isWater(x, y)) return true;
      if (S._placer.hash.query(x - r, y - r, x + r, y + r, function (o) { return G.pointInPoly(x, y, o.polygon); })) return true;
      if (S.fieldHash.query(x, y, x, y, function (f) { return !VG.CROPS[f.crop].trees && G.pointInPoly(x, y, f.polygon); })) return true;
      for (var i = 0; i < S.plazas.length; i++) if (Math.hypot(x - S.plazas[i].x, y - S.plazas[i].y) < S.plazas[i].r + r) return true;
      return net.segHash.query(x - 6, y - 6, x + 6, y + 6, function (e) {
        if (e.dead) return false;
        return G.distToSeg(x, y, N[e.a].x, N[e.a].y, N[e.b].x, N[e.b].y) < VG.ROAD_KINDS[e.kind].width / 2 + r + 0.5;
      });
    }

    var n = Math.floor(W / spacing);
    for (var j = 0; j < n; j++) {
      for (var i = 0; i < n; i++) {
        var x = (i + rand()) * spacing - W / 2, y = (j + rand()) * spacing - W / 2;
        var rr = Math.hypot(x, y);
        if (rr > lim) continue;
        var u = x / W, v = y / W;
        var f = 0.5 + 0.8 * VG.rng.fbm(nz, u * 4.5 + ox, v * 4.5 + oy, 4) + (cover - 0.5) * 1.1;
        var wd = T.waterDistAt(x, y);
        f += (arid ? 0.9 : 0.15) * (1 - G.smoothstep(0, arid ? 40 : 90, wd));
        var dc = Math.hypot(x - cx, y - cy);
        f -= 0.9 * (1 - G.smoothstep(R * 0.9, R * 2 + 60, dc)) * (1 - cover * 0.5);
        f -= T.elevationAt(x, y) > T.relief * 0.7 ? 0.4 : 0;
        if (rand() > G.smoothstep(0.38, 0.66, f)) continue;
        var r = spacing * rand.range(0.35, 0.65);
        if (blocked(x, y, r * 0.5)) continue;
        trees.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(r * 10) / 10, arid ? 2 : rand() < 0.2 ? 1 : 0]);
      }
    }

    // Hedgerow / boundary trees along field edges.
    var fields = S.fields;
    for (var k = 0; k < fields.length; k++) {
      if (rand() > 0.35 * (arid ? 0.3 : 1)) continue;
      var p = fields[k].polygon, e = rand.int(0, 3), a = p[e], b = p[(e + 1) & 3];
      var len = Math.hypot(b[0] - a[0], b[1] - a[1]), m = Math.floor(len / rand.range(8, 18));
      for (var t = 0; t < m; t++) {
        if (rand() < 0.4) continue;
        var q = (t + rand()) / m, hx = a[0] + (b[0] - a[0]) * q, hy = a[1] + (b[1] - a[1]) * q;
        if (blocked(hx, hy, 1)) continue;
        trees.push([Math.round(hx * 10) / 10, Math.round(hy * 10) / 10, Math.round(rand.range(2, 4.5) * 10) / 10, 1]);
      }
    }

    // Garden trees behind houses outside the dense core.
    S.buildings.forEach(function (bld) {
      if (bld.category !== 'residential' || rand() > 0.5) return;
      var dist = Math.hypot(bld.x - cx, bld.y - cy) / R;
      if (dist < 0.45) return;
      var k = rand.int(1, 2);
      for (var g = 0; g < k; g++) {
        var off = bld.depth / 2 + rand.range(3, 9), side = rand.range(-0.5, 0.5) * bld.width;
        var gx = bld.x - bld.front[0] * off + bld.front[1] * side, gy = bld.y - bld.front[1] * off - bld.front[0] * side;
        if (blocked(gx, gy, 1.5)) continue;
        trees.push([Math.round(gx * 10) / 10, Math.round(gy * 10) / 10, Math.round(rand.range(1.8, 3.5) * 10) / 10, 3]);
      }
    });
    return trees;
  }

  VG.CROPS = CROPS;
  VG.fields = { layFields: layFields, plantTrees: plantTrees };
})(typeof window !== 'undefined' ? window : globalThis);
