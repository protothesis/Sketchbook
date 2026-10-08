// Map renderer: an elevation-tinted, hillshaded terrain raster with vector
// contours underneath vector fields, roads, buildings and trees. Detail
// fades in with zoom (field furrows, street names, door notches, then room
// plans). Everything is drawn in world metres through one transform.
(function (global) {
  'use strict';
  var VG = (global.VillageGen = global.VillageGen || {});
  var G = VG.geom;

  var HYPSO = {
    temperate: [[0, [176, 201, 138]], [0.12, [196, 213, 150]], [0.3, [221, 222, 166]], [0.48, [230, 212, 160]],
      [0.66, [214, 186, 142]], [0.82, [190, 160, 128]], [0.93, [176, 166, 158]], [1, [236, 232, 226]]],
    highland: [[0, [168, 196, 140]], [0.2, [190, 205, 150]], [0.4, [207, 200, 150]], [0.6, [190, 172, 134]],
      [0.78, [168, 150, 128]], [0.9, [160, 156, 152]], [1, [240, 238, 234]]],
    arid: [[0, [222, 206, 158]], [0.25, [232, 212, 160]], [0.5, [224, 190, 138]], [0.75, [204, 164, 118]],
      [0.9, [184, 146, 112]], [1, [214, 196, 176]]]
  };
  var WATER_SHALLOW = [140, 188, 210], WATER_DEEP = [84, 138, 175];

  var CROP_COLORS = {
    wheat: '#e2c56e', barley: '#e9d993', oats: '#d6cd8d', rye: '#cdb46c', flax: '#aab7d4', fallow: '#c7a37f',
    pasture: '#a6c88a', meadow: '#bad697', vegetables: '#8db36e', orchard: '#a2c486', vineyard: '#b9a868',
    millet: '#d9b96e', dates: '#a9b37c', olives: '#aab590'
  };
  var CAT_COLORS = {
    residential: '#d4876a', commercial: '#d8a24e', craft: '#b9875d', civic: '#7d8fba', religious: '#9b80bb',
    agricultural: '#a88c5c', industrial: '#8d939b'
  };
  var CAT_LABELS = {
    residential: 'Homes', commercial: 'Shops & inns', craft: 'Crafts', civic: 'Civic', religious: 'Religious',
    agricultural: 'Farm buildings', industrial: 'Mills & stores'
  };
  var ROAD_STYLE = {
    road:   { fill: '#fbf5e6', casing: '#9a8a72' },
    street: { fill: '#f8f0dd', casing: '#a39276' },
    lane:   { fill: '#f1e6cd', casing: '#ad9c80' },
    track:  { fill: '#b89b72', casing: null }
  };
  var TREE_COLORS = ['#6a9656', '#5a8650', '#8ea35f', '#78a862'];
  var TREE_EDGE = ['#4f7a40', '#466f3e', '#6f8546', '#5a8b48'];

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
  function bakeTerrain(S, palette) {
    var T = S._.terrain, W = T.W, size = 1024, cv = makeCanvas(size, size), ctx = cv.getContext('2d');
    var img = ctx.createImageData(size, size), d = img.data;
    var maxH = 0;
    for (var k = 0; k < T.heights.length; k++) if (T.heights[k] > maxH) maxH = T.heights[k];
    var span = Math.max(0.05, maxH - T.wl), stops = HYPSO[palette] || HYPSO.temperate;
    var px = W / size, exag = 1.7 / (1 + T.reliefPerKm / 60);
    var L = [-0.55, -0.65, 0.52], Ll = Math.hypot(L[0], L[1], L[2]);
    L = [L[0] / Ll, L[1] / Ll, L[2] / Ll];
    for (var j = 0; j < size; j++) {
      var y = (j + 0.5) * px - W / 2;
      for (var i = 0; i < size; i++) {
        var x = (i + 0.5) * px - W / 2, h = T.heightAt(x, y), c, o = (j * size + i) * 4;
        if (h < T.wl) {
          var dep = G.clamp((T.wl - h) / 0.12, 0, 1);
          c = [WATER_SHALLOW[0] + (WATER_DEEP[0] - WATER_SHALLOW[0]) * dep,
            WATER_SHALLOW[1] + (WATER_DEEP[1] - WATER_SHALLOW[1]) * dep,
            WATER_SHALLOW[2] + (WATER_DEEP[2] - WATER_SHALLOW[2]) * dep];
        } else {
          c = lerpColor(stops, (h - T.wl) / span);
          var e = Math.max(px, T.cell * 0.9); // span a full grid cell: no faceting
          var dx = (T.heightAt(x + e, y) - T.heightAt(x - e, y)) / (2 * e) * T.relief * exag;
          var dy = (T.heightAt(x, y + e) - T.heightAt(x, y - e)) / (2 * e) * T.relief * exag;
          var nl = Math.hypot(dx, dy, 1), lam = (-dx * L[0] - dy * L[1] + L[2]) / nl;
          var f = G.clamp(1 + (lam - L[2]) * 1.15, 0.74, 1.14);
          // A soft shoreline glow.
          var shore = 1 - G.smoothstep(0, 0.012, h - T.wl);
          c = [c[0] * f + shore * 20, c[1] * f + shore * 18, c[2] * f + shore * 8];
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
  function bakeTrees(S) {
    var W = S.bounds.size, size = 2048, cv = makeCanvas(size, size), ctx = cv.getContext('2d'), k = size / W;
    S.trees.forEach(function (t) {
      ctx.fillStyle = TREE_COLORS[t[3]];
      ctx.beginPath();
      ctx.arc((t[0] + W / 2) * k, (t[1] + W / 2) * k, Math.max(0.7, t[2] * k), 0, Math.PI * 2);
      ctx.fill();
    });
    return cv;
  }

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

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.S = null;
    this.layers = { contours: true, trees: true, fields: true, labels: true, interiors: true };
    this.history = 1;
    this.selected = null;
    this.hover = null;
    this.highlightCat = null;
  }

  Renderer.prototype.setSettlement = function (S, palette) {
    this.S = S;
    this.palette = palette;
    this.terrainImg = bakeTerrain(S, palette);
    this.contours = buildContours(S);
    this.treeImg = bakeTrees(S);
    this.trees = treeGrid(S);
    this.selected = null;
    this.hover = null;
  };

  Renderer.prototype.draw = function (view, paper) {
    var S = this.S, ctx = this.ctx, cv = this.canvas, dpr = view.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, cv.width, cv.height);
    if (!S) return;
    var sc = view.scale, W = S.bounds.size, t = this.history;
    var setWorld = function () {
      ctx.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * (view.w / 2 - view.cx * sc), dpr * (view.h / 2 - view.cy * sc));
    };
    setWorld();
    var vb = view.bounds(), px = 1 / sc; // one screen pixel in metres

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.terrainImg, -W / 2, -W / 2, W, W);

    if (this.layers.contours) {
      ctx.lineWidth = px * 0.8;
      ctx.strokeStyle = 'rgba(110, 86, 60, 0.22)';
      ctx.stroke(this.contours.minor);
      ctx.lineWidth = px * 1.3;
      ctx.strokeStyle = 'rgba(110, 86, 60, 0.36)';
      ctx.stroke(this.contours.major);
    }

    var T = S.terrain;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (T.river) {
      ctx.beginPath();
      T.river.points.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
      ctx.strokeStyle = 'rgb(140, 188, 210)';
      ctx.lineWidth = Math.max(T.river.halfWidth * 2, px * 2.2);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(70, 120, 150, 0.55)';
    ctx.lineWidth = px * 1.2;
    ctx.stroke(this.contours.shore);

    if (this.layers.fields) this.drawFields(ctx, vb, sc, px, t);
    this.drawPlazas(ctx, px);
    this.drawRoads(ctx, vb, sc, px, t);

    var vectorTrees = sc > 0.9;
    if (this.layers.trees && !vectorTrees) ctx.drawImage(this.treeImg, -W / 2, -W / 2, W, W);
    this.drawBuildings(ctx, vb, sc, px, t);
    if (this.layers.trees && vectorTrees) this.drawTrees(ctx, vb, sc);

    // Vignette: the land dissolves into paper at the map's edge.
    var g = ctx.createRadialGradient(0, 0, W * 0.34, 0, 0, W * 0.5);
    g.addColorStop(0, hexA(paper, 0));
    g.addColorStop(0.7, hexA(paper, 0.55));
    g.addColorStop(1, hexA(paper, 1));
    ctx.fillStyle = g;
    ctx.fillRect(vb[0] - 10, vb[1] - 10, vb[2] - vb[0] + 20, vb[3] - vb[1] + 20);

    this.drawSelection(ctx, sc, px);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.layers.labels) this.drawLabels(ctx, view, t);
    this.drawScaleBar(ctx, view);
  };

  function hexA(color, a) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim());
    if (!m) return color;
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')';
  }

  function inView(vb, b, pad) {
    return b[2] >= vb[0] - pad && b[0] <= vb[2] + pad && b[3] >= vb[1] - pad && b[1] <= vb[3] + pad;
  }

  function polyPath(ctx, poly) {
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (var i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
    ctx.closePath();
  }

  Renderer.prototype.drawFields = function (ctx, vb, sc, px, t) {
    var S = this.S, furrows = sc > 0.9, sel = this.selected;
    S.fields.forEach(function (f) {
      if (f.epoch > t) return;
      if (!f._b) f._b = G.polyBounds(f.polygon);
      if (!inView(vb, f._b, 0)) return;
      ctx.beginPath();
      polyPath(ctx, f.polygon);
      ctx.fillStyle = CROP_COLORS[f.crop] || '#c8c08a';
      ctx.globalAlpha = 0.92;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (sc > 0.25) {
        ctx.strokeStyle = 'rgba(96, 120, 70, 0.55)';
        ctx.lineWidth = Math.max(px, 0.8);
        ctx.stroke();
      }
      if (furrows) {
        var p = f.polygon, n = Math.max(2, Math.floor(f.width / (f.crop === 'vineyard' ? 2.2 : 3.2)));
        var pasture = f.crop === 'pasture' || f.crop === 'meadow';
        if (VG.CROPS[f.crop].trees) {
          // Orchards and groves: a grid of little trees.
          ctx.fillStyle = f.crop === 'olives' ? '#7f9466' : '#6f9b55';
          var rows = Math.max(2, Math.floor(f.length / 7)), cols = Math.max(1, Math.floor(f.width / 7));
          for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
            var u = (c + 0.5) / cols, v = (r + 0.5) / rows;
            var x = p[0][0] + (p[1][0] - p[0][0]) * u + (p[3][0] - p[0][0]) * v;
            var y = p[0][1] + (p[1][1] - p[0][1]) * u + (p[3][1] - p[0][1]) * v;
            ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
          }
        } else if (!pasture) {
          ctx.strokeStyle = 'rgba(120, 92, 50, 0.22)';
          ctx.lineWidth = Math.max(px * 0.8, 0.35);
          ctx.beginPath();
          for (var k = 1; k < n; k++) {
            var q = k / n;
            ctx.moveTo(p[0][0] + (p[1][0] - p[0][0]) * q, p[0][1] + (p[1][1] - p[0][1]) * q);
            ctx.lineTo(p[3][0] + (p[2][0] - p[3][0]) * q, p[3][1] + (p[2][1] - p[3][1]) * q);
          }
          ctx.stroke();
        }
      }
      if (sel && sel.kind === 'field' && sel.item === f) {
        ctx.beginPath(); polyPath(ctx, f.polygon);
        ctx.strokeStyle = '#1f6feb'; ctx.lineWidth = px * 2.5; ctx.stroke();
      }
    });
  };

  Renderer.prototype.drawPlazas = function (ctx, px) {
    var S = this.S;
    S.plazas.forEach(function (p) {
      ctx.beginPath();
      for (var i = 0; i <= 18; i++) {
        var a = (i / 18) * Math.PI * 2, r = p.r * (1 + 0.12 * Math.sin(a * 3 + p.x) + 0.06 * Math.cos(a * 5 + p.y));
        if (i) ctx.lineTo(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r); else ctx.moveTo(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fillStyle = p.kind === 'green' ? '#b5d293' : '#ece0c6';
      ctx.fill();
      ctx.strokeStyle = p.kind === 'green' ? 'rgba(90,120,60,0.5)' : 'rgba(150,130,100,0.6)';
      ctx.lineWidth = Math.max(px, 0.4);
      ctx.stroke();
    });
    S.landmarks.forEach(function (l) {
      ctx.beginPath();
      ctx.arc(l.x, l.y, l.type === 'pond' ? 3.2 : 1.4, 0, Math.PI * 2);
      ctx.fillStyle = l.type === 'pond' ? '#8fbcd6' : '#6d7d8a';
      ctx.fill();
      ctx.strokeStyle = '#4b5a66'; ctx.lineWidth = Math.max(px, 0.3); ctx.stroke();
    });
  };

  Renderer.prototype.drawRoads = function (ctx, vb, sc, px, t) {
    var S = this.S, N = S.network.nodes, ways = S.network.ways, K = VG.ROAD_KINDS;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    var order = ['track', 'lane', 'street', 'road'];
    var visible = ways.filter(function (w) {
      if (w.epoch > t) return false;
      if (!w._b) {
        var b = [Infinity, Infinity, -Infinity, -Infinity];
        w.nodes.forEach(function (id) { var n = N[id]; b[0] = Math.min(b[0], n.x); b[1] = Math.min(b[1], n.y); b[2] = Math.max(b[2], n.x); b[3] = Math.max(b[3], n.y); });
        w._b = b;
      }
      return inView(vb, w._b, 10);
    });
    function trace(w) {
      ctx.moveTo(N[w.nodes[0]].x, N[w.nodes[0]].y);
      for (var i = 1; i < w.nodes.length; i++) ctx.lineTo(N[w.nodes[i]].x, N[w.nodes[i]].y);
    }
    function minPx(kind) { return { road: 2.6, street: 1.8, lane: 1.2, track: 0.9 }[kind]; }
    // Casings first (all kinds), then fills, so junctions merge cleanly.
    order.forEach(function (kind) {
      var st = ROAD_STYLE[kind];
      if (!st.casing) return;
      ctx.beginPath();
      visible.forEach(function (w) { if (w.kind === kind) trace(w); });
      ctx.strokeStyle = st.casing;
      ctx.lineWidth = Math.max(K[kind].width + 1.4, (minPx(kind) + 1.2) * px);
      ctx.stroke();
    });
    // Bridges get a darker, wider deck.
    ctx.beginPath();
    S.network.edges.forEach(function (e) {
      if (!e.bridge || S.network.ways[e.way].epoch > t) return;
      ctx.moveTo(N[e.a].x, N[e.a].y); ctx.lineTo(N[e.b].x, N[e.b].y);
    });
    ctx.strokeStyle = '#6b625a';
    ctx.lineWidth = Math.max(8.5, 4 * px);
    ctx.stroke();
    order.forEach(function (kind) {
      var st = ROAD_STYLE[kind];
      ctx.beginPath();
      visible.forEach(function (w) { if (w.kind === kind) trace(w); });
      ctx.strokeStyle = st.fill;
      if (kind === 'track') ctx.setLineDash([Math.max(3, 4 * px), Math.max(2.5, 3 * px)]);
      ctx.lineWidth = Math.max(K[kind].width, minPx(kind) * px);
      ctx.stroke();
      ctx.setLineDash([]);
    });
    var sel = this.selected;
    if (sel && sel.kind === 'way') {
      ctx.beginPath(); trace(sel.item);
      ctx.strokeStyle = 'rgba(31, 111, 235, 0.55)';
      ctx.lineWidth = Math.max(K[sel.item.kind].width + 2, 5 * px);
      ctx.stroke();
    }
  };

  Renderer.prototype.drawBuildings = function (ctx, vb, sc, px, t) {
    var S = this.S, self = this, arid = this.palette === 'arid';
    var rooms = this.layers.interiors && sc >= 7, ridges = sc >= 1.1 && !arid, hl = this.highlightCat;
    S.buildings.forEach(function (b) {
      if (b.epoch > t) return;
      if (!b._b) b._b = G.polyBounds(b.polygon);
      if (!inView(vb, b._b, 2)) return;
      var p = b.polygon, open = rooms || (self.selected && self.selected.item === b && sc >= 3 && self.layers.interiors);
      ctx.beginPath();
      polyPath(ctx, p);
      var col = CAT_COLORS[b.category];
      if (arid && b.category === 'residential') col = '#dcb68e';
      ctx.fillStyle = open ? '#f4ead7' : col;
      ctx.globalAlpha = hl && hl !== b.category ? 0.25 : 1;
      ctx.fill();
      ctx.strokeStyle = open ? '#4a3a2c' : 'rgba(70, 50, 36, 0.75)';
      ctx.lineWidth = open ? Math.max(0.35, px * 1.4) : Math.max(px * 0.9, 0.18);
      ctx.stroke();
      if (open) self.drawRooms(ctx, b, sc, px);
      else if (ridges) {
        // Roof ridge along the long axis: a cheap hint of gables.
        var long = b.width >= b.depth;
        var a = long ? mid(p[0], p[3]) : mid(p[0], p[1]), c = long ? mid(p[1], p[2]) : mid(p[3], p[2]);
        var inset = 0.12;
        ctx.beginPath();
        ctx.moveTo(a[0] + (c[0] - a[0]) * inset, a[1] + (c[1] - a[1]) * inset);
        ctx.lineTo(c[0] - (c[0] - a[0]) * inset, c[1] - (c[1] - a[1]) * inset);
        ctx.strokeStyle = 'rgba(255, 240, 220, 0.45)';
        ctx.lineWidth = Math.max(px, 0.25);
        ctx.stroke();
      }
      if (b.tags.indexOf('windmill') >= 0 && sc > 0.8) {
        var r = Math.max(b.width, b.depth) * 0.9;
        ctx.beginPath();
        ctx.moveTo(b.x - r, b.y - r); ctx.lineTo(b.x + r, b.y + r);
        ctx.moveTo(b.x + r, b.y - r); ctx.lineTo(b.x - r, b.y + r);
        ctx.strokeStyle = '#5d4b3b'; ctx.lineWidth = Math.max(0.6, px * 1.5); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (sc >= 4) {
        ctx.fillStyle = '#5a3d2a';
        var e = b.entrance, fx = b.front[0], fy = b.front[1];
        ctx.beginPath();
        ctx.moveTo(e.x - fy * 0.6, e.y + fx * 0.6); ctx.lineTo(e.x + fy * 0.6, e.y - fx * 0.6);
        ctx.lineTo(e.x + fy * 0.6 - fx * 0.5, e.y - fx * 0.6 - fy * 0.5); ctx.lineTo(e.x - fy * 0.6 - fx * 0.5, e.y + fx * 0.6 - fy * 0.5);
        ctx.fill();
      }
    });
  };

  function mid(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }

  /** Local floor-plan coords (x along frontage, y from front wall) → world. */
  function localToWorld(b, x, y) {
    var tx = Math.cos(b.angle), ty = Math.sin(b.angle), fx = b.front[0], fy = b.front[1];
    var u = x - b.width / 2, v = b.depth / 2 - y;
    return [b.x + tx * u + fx * v, b.y + ty * u + fy * v];
  }

  Renderer.prototype.drawRooms = function (ctx, b, sc, px) {
    ctx.strokeStyle = '#6b5644';
    ctx.lineWidth = Math.max(0.15, px * 1);
    b.rooms.forEach(function (r) {
      var c = [localToWorld(b, r.x, r.y), localToWorld(b, r.x + r.w, r.y), localToWorld(b, r.x + r.w, r.y + r.d), localToWorld(b, r.x, r.y + r.d)];
      ctx.beginPath(); polyPath(ctx, c); ctx.stroke();
    });
    if (sc < 11) return;
    var ang = b.angle;
    if (Math.cos(ang) < 0) ang += Math.PI;
    ctx.fillStyle = '#5b4636';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    b.rooms.forEach(function (r) {
      var c = localToWorld(b, r.x + r.w / 2, r.y + r.d / 2), fs = Math.min(r.w, r.d) * 0.16;
      if (fs * sc < 7) return;
      ctx.save();
      ctx.translate(c[0], c[1]); ctx.rotate(ang);
      ctx.font = '500 ' + Math.min(fs, 1.1) + 'px system-ui, sans-serif';
      ctx.fillText(r.name, 0, 0);
      ctx.restore();
    });
  };

  Renderer.prototype.drawTrees = function (ctx, vb, sc) {
    var g = this.trees, cell = g.cell;
    var shadow = sc > 2;
    for (var ix = Math.floor(vb[0] / cell) - 1; ix <= Math.floor(vb[2] / cell) + 1; ix++) {
      for (var iy = Math.floor(vb[1] / cell) - 1; iy <= Math.floor(vb[3] / cell) + 1; iy++) {
        var b = g.map.get(ix * 100003 + iy);
        if (!b) continue;
        for (var i = 0; i < b.length; i++) {
          var t = b[i];
          if (shadow) {
            ctx.fillStyle = 'rgba(40, 50, 30, 0.18)';
            ctx.beginPath(); ctx.arc(t[0] + t[2] * 0.3, t[1] + t[2] * 0.35, t[2], 0, Math.PI * 2); ctx.fill();
          }
          ctx.fillStyle = TREE_COLORS[t[3]];
          ctx.beginPath(); ctx.arc(t[0], t[1], t[2], 0, Math.PI * 2); ctx.fill();
          if (shadow) {
            ctx.strokeStyle = TREE_EDGE[t[3]]; ctx.lineWidth = t[2] * 0.12; ctx.stroke();
          }
        }
      }
    }
  };

  Renderer.prototype.drawSelection = function (ctx, sc, px) {
    var sel = this.selected, hov = this.hover;
    [hov, sel].forEach(function (s, i) {
      if (!s || s.kind !== 'building') return;
      ctx.beginPath(); polyPath(ctx, s.item.polygon);
      ctx.strokeStyle = i ? '#1f6feb' : 'rgba(31, 111, 235, 0.6)';
      ctx.lineWidth = px * (i ? 3 : 2);
      ctx.stroke();
    });
    if (sel && sel.path) {
      var N = this.S.network.nodes;
      ctx.beginPath();
      sel.path.nodes.forEach(function (id, k) { var n = N[id]; if (k) ctx.lineTo(n.x, n.y); else ctx.moveTo(n.x, n.y); });
      ctx.strokeStyle = 'rgba(31, 111, 235, 0.85)';
      ctx.setLineDash([px * 6, px * 4]);
      ctx.lineWidth = px * 3;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  };

  Renderer.prototype.drawLabels = function (ctx, view, t) {
    var S = this.S, sc = view.scale, N = S.network.nodes;
    function screen(x, y) { return [(x - view.cx) * sc + view.w / 2, (y - view.cy) * sc + view.h / 2]; }
    function halo(text, x, y, font, fill) {
      ctx.font = font;
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(250, 246, 236, 0.9)'; ctx.lineJoin = 'round';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = fill; ctx.fillText(text, x, y);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    // Where the roads go.
    S.network.ways.forEach(function (w) {
      if (!w.destination || !w.rim) return;
      var r = Math.hypot(w.rim.x, w.rim.y) || 1, k = Math.min(1, (S.bounds.size * 0.4) / r);
      var p = screen(w.rim.x * k, w.rim.y * k);
      if (p[0] < -50 || p[1] < -20 || p[0] > view.w + 50 || p[1] > view.h + 20) return;
      halo('to ' + w.destination, p[0], p[1], 'italic 12px Georgia, serif', '#6b5a48');
    });

    // Street names along their middle segment.
    if (sc > 1.4) {
      S.network.ways.forEach(function (w) {
        if (!w.name || w.epoch > t || w.length < 40) return;
        var m = w.nodes.length >> 1, a = N[w.nodes[Math.max(0, m - 1)]], b = N[w.nodes[Math.min(w.nodes.length - 1, m + 1)]];
        var p = screen((a.x + b.x) / 2, (a.y + b.y) / 2);
        if (p[0] < -80 || p[1] < -20 || p[0] > view.w + 80 || p[1] > view.h + 20) return;
        var ang = Math.atan2(b.y - a.y, b.x - a.x);
        if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
        ctx.save();
        ctx.translate(p[0], p[1]); ctx.rotate(ang);
        halo(w.name, 0, 0, '500 11px system-ui, sans-serif', '#5b4a3a');
        ctx.restore();
      });
    }

    // Named buildings.
    if (sc > 1.1) {
      S.buildings.forEach(function (b) {
        if (!b.name || b.epoch > t || !(b.category === 'religious' || b.category === 'civic' || b.type === 'inn' || b.type === 'manor' || b.type === 'mill' || (sc > 3 && b.type === 'tavern') || sc > 5)) return;
        var p = screen(b.x, b.y);
        if (p[0] < -60 || p[1] < -20 || p[0] > view.w + 60 || p[1] > view.h + 20) return;
        halo(b.name, p[0], p[1] - Math.max(b.width, b.depth) * sc * 0.5 - 9, '600 11.5px system-ui, sans-serif', '#3b2f25');
      });
    }

    // Settlement name when zoomed out.
    if (sc < 1.6) {
      var c = screen(S.center.x, S.center.y - S.radius * 1.1);
      var alpha = G.clamp((1.6 - sc) / 0.8, 0, 1);
      ctx.globalAlpha = alpha;
      halo(S.name, c[0], Math.max(30, c[1]), '600 24px Georgia, "Times New Roman", serif', '#2e2620');
      halo(S.size.label + ' · pop. ' + S.stats.population.toLocaleString(), c[0], Math.max(30, c[1]) + 22, 'italic 13px Georgia, serif', '#5b4a3a');
      ctx.globalAlpha = 1;
    }
  };

  Renderer.prototype.drawScaleBar = function (ctx, view) {
    var target = 110 / view.scale, len = niceStep(target);
    if (len / target > 1.4) len /= 2;
    var w = len * view.scale, x = 14, y = view.h - 16;
    ctx.fillStyle = 'rgba(250, 246, 236, 0.85)';
    ctx.fillRect(x - 6, y - 18, w + 12 + 40, 26);
    ctx.strokeStyle = '#3b2f25'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y - 4); ctx.stroke();
    ctx.fillStyle = '#3b2f25'; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(len >= 1000 ? len / 1000 + ' km' : len + ' m', x + w + 6, y);
  };

  VG.render = {
    Renderer: Renderer, CAT_COLORS: CAT_COLORS, CAT_LABELS: CAT_LABELS, CROP_COLORS: CROP_COLORS,
    localToWorld: localToWorld
  };
})(window);
