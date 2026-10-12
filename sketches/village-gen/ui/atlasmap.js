// The atlas as a subway map: places as stations, walked roads as lines.
// There are no distances in the atlas, only the bearing each road leaves at,
// so the layout dead-reckons: every road is one unit long, pointing the way
// it leaves (snapped to 45° for a transit-map look; north is up), then nodes
// are nudged apart where branches collide. Separate journeys (atlas places
// you started from scratch) sit side by side, each starting at a square.
//
// Ferry crossings are dashed blue lines. Unexplored roads out of the current
// town are drawn as dashed stubs. Click
// a station to go there, a stub to travel along it. Drag to pan, scroll to
// zoom, double-click to fit.
(function (global) {
  'use strict';
  var VG = (global.VillageGen = global.VillageGen || {});

  var ENV_COLORS = {
    valley: '#7fae6a', plains: '#cbb465', coast: '#5f9fc4', highlands: '#9b8c7b',
    forest: '#4d8a52', lakeside: '#62aeb5', island: '#4f95cf', arid: '#d99b55'
  };
  var SNAP = Math.PI / 4;

  function unit(bearing, snap) {
    var a = bearing * Math.PI / 180;
    if (snap) a = Math.round(a / SNAP) * SNAP;
    return [Math.sin(a), -Math.cos(a)];
  }

  /** { id: [x, y] } in road units, plus which journey each place is in. */
  function layout(A) {
    var ids = Object.keys(A.places), adj = {}, pos = {}, comp = {}, comps = [];
    ids.forEach(function (id) { adj[id] = []; });
    A.links.forEach(function (l) { if (adj[l.from] && A.places[l.to]) adj[l.from].push(l); });
    // Roots: journey starts first (in the order they were walked), then anything left.
    var order = A.trail.concat(ids).filter(function (id, i, arr) { return A.places[id] && arr.indexOf(id) === i; });
    order.sort(function (a, b) { return (A.places[a].from ? 1 : 0) - (A.places[b].from ? 1 : 0); });
    order.forEach(function (root) {
      if (pos[root]) return;
      var members = [root], q = [root], c = comps.length;
      pos[root] = [0, 0]; comp[root] = c;
      while (q.length) {
        var u = q.shift();
        adj[u].forEach(function (l) {
          if (pos[l.to]) return;
          var d = unit(l.bearing, true);
          pos[l.to] = [pos[u][0] + d[0], pos[u][1] + d[1]]; comp[l.to] = c;
          members.push(l.to); q.push(l.to);
        });
      }
      comps.push(members);
    });
    // Relax: keep stations apart, pull each road back toward its bearing.
    for (var it = 0; it < 120; it++) {
      comps.forEach(function (m) {
        for (var i = 0; i < m.length; i++) for (var j = i + 1; j < m.length; j++) {
          var p = pos[m[i]], q2 = pos[m[j]], dx = q2[0] - p[0], dy = q2[1] - p[1], d = Math.hypot(dx, dy);
          if (d < 0.75) {
            if (d < 1e-6) { dx = 0.01 * (j - i); dy = 0.013; d = Math.hypot(dx, dy); }
            var push = (0.75 - d) * 0.25 / d;
            p[0] -= dx * push; p[1] -= dy * push; q2[0] += dx * push; q2[1] += dy * push;
          }
        }
      });
      A.links.forEach(function (l) {
        var a = pos[l.from], b = pos[l.to];
        if (!a || !b || l.from > l.to) return; // each road once
        var u = unit(l.bearing, true), tx = a[0] + u[0], ty = a[1] + u[1];
        b[0] += (tx - b[0]) * 0.08; b[1] += (ty - b[1]) * 0.08;
        a[0] -= (tx - b[0]) * 0.08; a[1] -= (ty - b[1]) * 0.08;
      });
    }
    // Journeys side by side, left to right.
    var x = 0;
    comps.forEach(function (m) {
      var b = [Infinity, Infinity, -Infinity, -Infinity];
      m.forEach(function (id) { var p = pos[id]; b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); });
      m.forEach(function (id) { pos[id][0] += x - b[0]; pos[id][1] -= (b[1] + b[3]) / 2; });
      x += b[2] - b[0] + 1.6;
    });
    return { pos: pos, comp: comp, journeys: comps.length };
  }

  function AtlasMap(canvas, onPick) {
    this.canvas = canvas;
    this.onPick = onPick;
    this.A = null; this.here = null; this.stubs = []; this.L = null; this.sig = '';
    this.view = null; // { k, ox, oy } when the user has panned or zoomed
    this.hover = null;
    this.hits = [];
    this._bind();
  }

  /** atlas, current place id (or null), unexplored roads [{ destination, bearing, way }]. */
  AtlasMap.prototype.set = function (A, here, stubs) {
    this.A = A; this.here = here; this.stubs = stubs || [];
    var sig = A ? Object.keys(A.places).length + '|' + A.links.length : '';
    if (sig !== this.sig) { this.sig = sig; this.L = A ? layout(A) : null; this.view = null; }
    this.draw();
  };

  AtlasMap.prototype.fit = function (w, h) {
    var P = this.L.pos, b = [Infinity, Infinity, -Infinity, -Infinity], self = this;
    Object.keys(P).forEach(function (id) { var p = P[id]; b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); });
    if (this.here && P[this.here]) this.stubs.forEach(function (s) {
      var u = unit(s.bearing, true), p = P[self.here];
      b[0] = Math.min(b[0], p[0] + u[0] * 0.5); b[2] = Math.max(b[2], p[0] + u[0] * 0.5);
      b[1] = Math.min(b[1], p[1] + u[1] * 0.5); b[3] = Math.max(b[3], p[1] + u[1] * 0.5);
    });
    // Wider at the sides: names sit beside the stations.
    var px = Math.min(70, w * 0.14), py = 26;
    var k = Math.min((w - px * 2) / Math.max(0.5, b[2] - b[0]), (h - py * 2) / Math.max(0.5, b[3] - b[1]), 70);
    return { k: k, ox: w / 2 - (b[0] + b[2]) / 2 * k, oy: h / 2 - (b[1] + b[3]) / 2 * k };
  };

  AtlasMap.prototype.draw = function () {
    var cv = this.canvas, r = cv.getBoundingClientRect();
    if (!r.width) return;
    var dpr = Math.min(global.devicePixelRatio || 1, 2.5), w = r.width, h = r.height;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    var ctx = cv.getContext('2d'), css = getComputedStyle(document.documentElement);
    var ink = css.getPropertyValue('--text').trim() || '#231f1a', muted = css.getPropertyValue('--text-muted').trim() || '#6f685d';
    var accent = css.getPropertyValue('--accent').trim() || '#2f7d62', sel = css.getPropertyValue('--select').trim() || '#1f6feb';
    var bg = css.getPropertyValue('--surface').trim() || '#fff';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    this.hits = [];
    var A = this.A;
    if (!A || !this.L || !Object.keys(A.places).length) {
      ctx.fillStyle = muted; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Travel along a road to start the map.', w / 2, h / 2);
      return;
    }
    var v = this.view || this.fit(w, h), P = this.L.pos, self = this;
    function S(p) { return [v.ox + p[0] * v.k, v.oy + p[1] * v.k]; }
    var unitPx = v.k;

    // Lines (each road once).
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = muted; ctx.globalAlpha = 0.7;
    ctx.lineWidth = Math.max(2, Math.min(5, unitPx * 0.07));
    function lines(ferry) {
      ctx.beginPath();
      A.links.forEach(function (l) {
        if (l.from > l.to || !P[l.from] || !P[l.to] || !!l.ferry !== ferry) return;
        var a = S(P[l.from]), b = S(P[l.to]);
        ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      });
      ctx.stroke();
    }
    lines(false);
    // Ferry crossings: dashed, in water blue.
    ctx.strokeStyle = '#4f95cf'; ctx.setLineDash([5, 4]);
    lines(true);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Roads out of here that nobody has walked yet.
    var hereP = this.here && P[this.here] ? S(P[this.here]) : null;
    if (hereP) {
      ctx.setLineDash([3, 3]); ctx.strokeStyle = accent; ctx.lineWidth = 2;
      this.stubs.forEach(function (s) {
        var u = unit(s.bearing, false), len = Math.max(18, unitPx * 0.42), e = [hereP[0] + u[0] * len, hereP[1] + u[1] * len];
        ctx.beginPath(); ctx.moveTo(hereP[0], hereP[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
        self.hits.push({ kind: 'road', item: s, x: e[0], y: e[1], r: 9, label: 'Travel to ' + s.destination });
      });
      ctx.setLineDash([]);
      this.stubs.forEach(function (s) {
        var u = unit(s.bearing, false), len = Math.max(18, unitPx * 0.42), e = [hereP[0] + u[0] * len, hereP[1] + u[1] * len];
        ctx.beginPath(); ctx.arc(e[0], e[1], 3, 0, Math.PI * 2);
        ctx.fillStyle = bg; ctx.fill(); ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke();
      });
    }

    // Stations.
    var ids = Object.keys(P);
    function radius(id) {
      var p = A.places[id], st = p.locked && p.settings ? p.settings : p.base, c = VG.classify ? VG.classify(st.population) : 1;
      return [3.5, 4.5, 6, 7.5][c] * Math.min(1.4, Math.max(0.85, unitPx / 45));
    }
    ids.forEach(function (id) {
      var p = A.places[id], s = S(P[id]), rr = radius(id), st = p.locked && p.settings ? p.settings : p.base;
      // Where a journey started is a square, every other place a circle.
      ctx.beginPath();
      if (p.from) ctx.arc(s[0], s[1], rr, 0, Math.PI * 2); else ctx.rect(s[0] - rr, s[1] - rr, rr * 2, rr * 2);
      ctx.fillStyle = ENV_COLORS[st.environment] || '#aaa'; ctx.fill();
      ctx.lineWidth = p.locked ? 2.2 : 1.2; ctx.strokeStyle = p.locked ? accent : ink; ctx.stroke();
      if (id === self.here) {
        ctx.beginPath(); ctx.arc(s[0], s[1], rr + 4, 0, Math.PI * 2);
        ctx.lineWidth = 2.2; ctx.strokeStyle = sel; ctx.stroke();
      }
      self.hits.push({ kind: 'place', item: id, x: s[0], y: s[1], r: Math.max(8, rr + 3), label: p.name });
    });

    // Names, most important first, skipping any that would overlap.
    var neigh = {};
    if (this.here) A.links.forEach(function (l) { if (l.from === self.here) neigh[l.to] = 1; });
    var rank = ids.map(function (id) {
      var p = A.places[id], st = p.locked && p.settings ? p.settings : p.base;
      var score = (id === self.here ? 1e6 : 0) + (id === self.hover ? 2e6 : 0) + (neigh[id] ? 1e5 : 0) + (p.locked ? 5e4 : 0) + (p.from ? 0 : 2e4) + st.population;
      return [id, score];
    }).sort(function (a, b) { return b[1] - a[1]; });
    var boxes = [];
    ids.forEach(function (id) { var s = S(P[id]), rr = radius(id); boxes.push([s[0] - rr, s[1] - rr, s[0] + rr, s[1] + rr]); });
    ctx.textBaseline = 'middle';
    rank.forEach(function (rk) {
      var id = rk[0], p = A.places[id], s = S(P[id]), rr = radius(id);
      var bold = id === self.here || id === self.hover;
      ctx.font = (bold ? '600 ' : '') + '11px system-ui, sans-serif';
      var tw = ctx.measureText(p.name).width;
      // Try right, left, above, below.
      var spots = [[s[0] + rr + 4, s[1], 'left'], [s[0] - rr - 4 - tw, s[1], 'left'], [s[0] - tw / 2, s[1] - rr - 9, 'left'], [s[0] - tw / 2, s[1] + rr + 9, 'left']];
      for (var i = 0; i < spots.length; i++) {
        var x0 = spots[i][0], y0 = spots[i][1], bx = [x0 - 1, y0 - 7, x0 + tw + 1, y0 + 7];
        if (bx[0] < 0 || bx[2] > w || bx[1] < 0 || bx[3] > h) continue;
        var clash = boxes.some(function (o) { return o[0] < bx[2] && o[2] > bx[0] && o[1] < bx[3] && o[3] > bx[1]; });
        if (clash && !bold) continue;
        boxes.push(bx);
        ctx.textAlign = 'left';
        ctx.lineWidth = 3; ctx.strokeStyle = bg; ctx.strokeText(p.name, x0, y0);
        ctx.fillStyle = bold ? ink : muted; ctx.fillText(p.name, x0, y0);
        break;
      }
    });
  };

  AtlasMap.prototype.hitAt = function (x, y) {
    var best = null, bd = Infinity;
    this.hits.forEach(function (h) {
      var d = Math.hypot(h.x - x, h.y - y);
      if (d <= h.r && d < bd) { bd = d; best = h; }
    });
    return best;
  };

  AtlasMap.prototype._bind = function () {
    var self = this, cv = this.canvas, drag = null;
    function pos(e) { var r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    function current() {
      if (!self.view) { var r = cv.getBoundingClientRect(); self.view = self.fit(r.width, r.height); }
      return self.view;
    }
    cv.addEventListener('pointerdown', function (e) {
      if (!self.L) return;
      drag = { p: pos(e), moved: 0 };
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', function (e) {
      var p = pos(e);
      if (drag) {
        var dx = p[0] - drag.p[0], dy = p[1] - drag.p[1];
        drag.moved += Math.abs(dx) + Math.abs(dy);
        if (drag.moved > 4) { var v = current(); v.ox += dx; v.oy += dy; self.draw(); }
        drag.p = p;
        return;
      }
      var h = self.hitAt(p[0], p[1]), id = h && h.kind === 'place' ? h.item : null;
      cv.style.cursor = h ? 'pointer' : 'grab';
      cv.title = h ? h.label : '';
      if (id !== self.hover) { self.hover = id; self.draw(); }
    });
    cv.addEventListener('pointerup', function (e) {
      var d = drag;
      drag = null;
      if (!d || d.moved > 4) return;
      var p = pos(e), h = self.hitAt(p[0], p[1]);
      if (h && self.onPick) self.onPick(h.kind, h.item);
    });
    cv.addEventListener('pointerleave', function () { if (self.hover) { self.hover = null; self.draw(); } });
    cv.addEventListener('wheel', function (e) {
      if (!self.L) return;
      e.preventDefault();
      var p = pos(e), v = current(), f = Math.exp(-(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY) * 0.0016);
      v.ox = p[0] - (p[0] - v.ox) * f; v.oy = p[1] - (p[1] - v.oy) * f; v.k *= f;
      self.draw();
    }, { passive: false });
    cv.addEventListener('dblclick', function () { self.view = null; self.draw(); });
  };

  VG.AtlasMap = AtlasMap;
  VG.atlasLayout = layout;
  VG.ENV_COLORS = ENV_COLORS;
})(window);
