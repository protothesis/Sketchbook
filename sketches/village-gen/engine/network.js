// The road network: a planar graph of nodes and edges grouped into "ways"
// (one named road = one way = an ordered chain of nodes).
//
// Growth happens in two phases:
//   1. Approach roads are routed from the map edge to the settlement's heart
//      with A* over the terrain (slope is expensive, rivers need bridges,
//      existing road is cheap). Later roads merge into earlier ones, which
//      gives the converging, tree-like shape of real villages.
//   2. Streets and lanes branch off existing roads and wander outward,
//      steering around steep ground, snapping onto nearby junctions and
//      forming T-junctions when they reach another road, which is where loops
//      and irregular blocks come from. "Planning" straightens them and pulls
//      their headings toward a shared grid angle.
(function (global) {
  'use strict';
  var VG = (global.VillageGen = global.VillageGen || {});
  var G = VG.geom;

  var KINDS = {
    road:   { width: 6.5, label: 'Road' },
    street: { width: 5,   label: 'Street' },
    lane:   { width: 3.4, label: 'Lane' },
    track:  { width: 2.6, label: 'Track' }
  };

  function Network(T) {
    this.T = T;
    this.nodes = [];
    this.edges = [];
    this.ways = [];
    this.nodeHash = new G.SpatialHash(30);
    this.segHash = new G.SpatialHash(30);
  }

  Network.prototype.addNode = function (x, y) {
    var n = { id: this.nodes.length, x: x, y: y, edges: [] };
    this.nodes.push(n);
    this.nodeHash.insert(n, x, y, x, y);
    return n;
  };

  Network.prototype.addEdge = function (a, b, way) {
    var A = this.nodes[a], B = this.nodes[b];
    var mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
    var e = { id: this.edges.length, a: a, b: b, way: way.id, kind: way.kind, dead: false,
      bridge: this.T.isWater(mx, my) };
    this.edges.push(e);
    A.edges.push(e.id); B.edges.push(e.id);
    this.segHash.insert(e, Math.min(A.x, B.x), Math.min(A.y, B.y), Math.max(A.x, B.x), Math.max(A.y, B.y));
    return e;
  };

  Network.prototype.addWay = function (kind, nodeIds, epochHint) {
    var w = { id: this.ways.length, kind: kind, nodes: nodeIds.slice(), name: null, order: epochHint };
    this.ways.push(w);
    for (var i = 1; i < nodeIds.length; i++) this.addEdge(nodeIds[i - 1], nodeIds[i], w);
    return w;
  };

  Network.prototype.degree = function (n) {
    var d = 0, E = this.edges;
    for (var i = 0; i < n.edges.length; i++) if (!E[n.edges[i]].dead) d++;
    return d;
  };

  /** Split edge e at (x, y); returns the new node. */
  Network.prototype.splitEdge = function (e, x, y) {
    var n = this.addNode(x, y), w = this.ways[e.way];
    e.dead = true;
    var A = this.nodes[e.a], B = this.nodes[e.b];
    A.edges = A.edges.filter(function (id) { return id !== e.id; });
    B.edges = B.edges.filter(function (id) { return id !== e.id; });
    this.addEdge(e.a, n.id, w).bridge = e.bridge;
    this.addEdge(n.id, e.b, w).bridge = e.bridge;
    for (var i = 1; i < w.nodes.length; i++) {
      var p = w.nodes[i - 1], q = w.nodes[i];
      if ((p === e.a && q === e.b) || (p === e.b && q === e.a)) { w.nodes.splice(i, 0, n.id); break; }
    }
    return n;
  };

  Network.prototype.nearestNode = function (x, y, r, skip) {
    var best = null, bd = r;
    this.nodeHash.query(x - r, y - r, x + r, y + r, function (n) {
      if (skip && skip(n)) return;
      var d = Math.hypot(n.x - x, n.y - y);
      if (d < bd) { bd = d; best = n; }
    });
    return best;
  };

  /** Nearest live edge within r → {edge, d, x, y} (closest point on edge). */
  Network.prototype.nearestEdge = function (x, y, r, skip) {
    var best = null, N = this.nodes;
    this.segHash.query(x - r, y - r, x + r, y + r, function (e) {
      if (e.dead || (skip && skip(e))) return;
      var A = N[e.a], B = N[e.b];
      var dx = B.x - A.x, dy = B.y - A.y, l2 = dx * dx + dy * dy || 1;
      var t = G.clamp(((x - A.x) * dx + (y - A.y) * dy) / l2, 0, 1);
      var px = A.x + dx * t, py = A.y + dy * t, d = Math.hypot(px - x, py - y);
      if (d < r && (!best || d < best.d)) best = { edge: e, d: d, x: px, y: py, t: t };
    });
    return best;
  };

  Network.prototype.firstCrossing = function (ax, ay, bx, by, skip) {
    var best = null, N = this.nodes;
    this.segHash.query(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by), function (e) {
      if (e.dead || (skip && skip(e))) return;
      var A = N[e.a], B = N[e.b];
      var hit = G.segIntersect(ax, ay, bx, by, A.x, A.y, B.x, B.y);
      if (hit && (!best || hit.t < best.t)) { hit.edge = e; best = hit; }
    });
    return best;
  };

  // --- Phase 1: approach roads via A* ---------------------------------------

  function Heap() { this.a = []; }
  Heap.prototype.push = function (k, v) {
    var a = this.a; a.push([k, v]);
    var i = a.length - 1;
    while (i > 0) { var p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; var t = a[p]; a[p] = a[i]; a[i] = t; i = p; }
  };
  Heap.prototype.pop = function () {
    var a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      var i = 0;
      for (;;) {
        var l = 2 * i + 1, r = l + 1, m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        var t = a[m]; a[m] = a[i]; a[i] = t; i = m;
      }
    }
    return top;
  };

  /** Cost grid for routing roads across the land. */
  function makeCostGrid(T, res) {
    var cost = new Float32Array(res * res), W = T.W;
    for (var j = 0; j < res; j++) {
      for (var i = 0; i < res; i++) {
        var x = (i / (res - 1) - 0.5) * W, y = (j / (res - 1) - 0.5) * W, c;
        if (T.isWaterBody(x, y)) c = Infinity;
        else if (T.isRiver(x, y) || T.heightAt(x, y) < T.wl) c = 25; // a bridge
        else { var s = T.slopeAt(x, y); c = 1 + s * s * 140 + s * 6; }
        var rr = Math.hypot(x, y) / W;
        if (rr > 0.49) c = Infinity;
        cost[j * res + i] = c;
      }
    }
    return { res: res, cost: cost, roadMul: new Float32Array(res * res).fill(1) };
  }

  function astar(grid, si, sj, ti, tj) {
    var res = grid.res, cost = grid.cost, mul = grid.roadMul, N = res * res;
    var g = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1);
    var heap = new Heap(), start = sj * res + si, goal = tj * res + ti;
    g[start] = 0; heap.push(0, start);
    var D8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
    while (heap.a.length) {
      var top = heap.pop(), cur = top[1];
      if (cur === goal) break;
      if (top[0] > g[cur] + Math.hypot((cur % res) - ti, ((cur / res) | 0) - tj) * 0.35 + 1e-6) continue;
      var ci = cur % res, cj = (cur / res) | 0;
      for (var k = 0; k < 8; k++) {
        var ni = ci + D8[k][0], nj = cj + D8[k][1];
        if (ni < 0 || nj < 0 || ni >= res || nj >= res) continue;
        var nk = nj * res + ni, c = cost[nk];
        if (c === Infinity && nk !== goal) continue;
        var ng = g[cur] + D8[k][2] * (c === Infinity ? 1 : c) * mul[nk];
        if (ng < g[nk]) {
          g[nk] = ng; from[nk] = cur;
          heap.push(ng + Math.hypot(ni - ti, nj - tj) * 0.35, nk);
        }
      }
    }
    if (from[goal] < 0) return null;
    var path = [], p = goal;
    while (p !== -1) { path.push(p); p = from[p]; }
    return path.reverse();
  }

  function chaikin(pts, iters) {
    for (var s = 0; s < iters; s++) {
      var out = [pts[0]];
      for (var i = 0; i < pts.length - 1; i++) {
        var a = pts[i], b = pts[i + 1];
        out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
      }
      out.push(pts[pts.length - 1]);
      pts = out;
    }
    return pts;
  }

  function resample(pts, step) {
    var out = [pts[0]], carry = 0;
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]), d = step - carry;
      while (d <= len) {
        var t = d / len;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        d += step;
      }
      carry = len - (d - step);
    }
    var last = pts[pts.length - 1], tail = out[out.length - 1];
    if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.4) out.push(last);
    else out[out.length - 1] = last;
    return out;
  }

  /**
   * Route an approach road from the map edge at `angle` into `hub`. Returns
   * the way, plus the edge point it set out from (for "to Ashford" labels).
   */
  Network.prototype.routeApproach = function (grid, hub, angle, step) {
    var T = this.T, W = T.W, res = grid.res, self = this;
    // Walk inward from the rim until we hit routable land.
    var sx, sy, si, sj, found = false;
    for (var r = 0.47; r > 0.08; r -= 0.01) {
      sx = Math.cos(angle) * r * W; sy = Math.sin(angle) * r * W;
      si = Math.round((sx / W + 0.5) * (res - 1)); sj = Math.round((sy / W + 0.5) * (res - 1));
      if (grid.cost[sj * res + si] < 20) { found = true; break; }
    }
    if (!found) return null;
    var ti = Math.round((hub.x / W + 0.5) * (res - 1)), tj = Math.round((hub.y / W + 0.5) * (res - 1));
    var path = astar(grid, si, sj, ti, tj);
    if (!path || path.length < 3) return null;
    for (var k = 0; k < path.length; k++) grid.roadMul[path[k]] = 0.3;

    var pts = path.map(function (c) { return [((c % res) / (res - 1) - 0.5) * W, (((c / res) | 0) / (res - 1) - 0.5) * W]; });
    pts[pts.length - 1] = [hub.x, hub.y];
    // Drop every other grid point first so diagonal stair-steps smooth out.
    pts = pts.filter(function (p, i) { return i % 2 === 0 || i === pts.length - 1; });
    pts = resample(chaikin(pts, 3), step);

    // Lay it down from the rim inward, merging into any road it meets.
    var ids = [self.addNode(pts[0][0], pts[0][1]).id], joined = false;
    for (var i = 1; i < pts.length; i++) {
      var p = pts[i], prev = self.nodes[ids[ids.length - 1]];
      var isLast = i === pts.length - 1;
      var snap = isLast ? hub : self.nearestNode(p[0], p[1], step * 0.7, function (n) { return ids.indexOf(n.id) >= 0; });
      if (snap) { ids.push(snap.id); joined = true; break; }
      var hit = self.firstCrossing(prev.x, prev.y, p[0], p[1]);
      if (hit) { ids.push(-1 - hit.edge.id); ids.hitX = hit.x; ids.hitY = hit.y; joined = true; break; }
      ids.push(self.addNode(p[0], p[1]).id);
    }
    if (!joined) return null;
    var lastId = ids[ids.length - 1];
    if (lastId < 0) ids[ids.length - 1] = self.splitEdge(self.edges[-1 - lastId], ids.hitX, ids.hitY).id;
    // Ways run from the settlement outward: reads better for naming/epochs.
    ids.reverse();
    var w = self.addWay('road', ids, 0);
    w.rim = { x: pts[0][0], y: pts[0][1] };
    return w;
  };

  // --- Phase 2: organic street growth ---------------------------------------

  /**
   * Grow one way from node `start` along `heading`. Steers toward flatter
   * ground; ends by snapping to a junction, T-ing into a road it approaches,
   * or stopping at water / steep ground / the growth radius.
   */
  Network.prototype.growWay = function (start, heading, kind, maxSteps, P, rand) {
    var T = this.T, self = this, step = P.step;
    var pts = [], px = start.x, py = start.y, end = null;
    var clearance = P.clearance * (kind === 'track' ? 1.6 : 1);
    var startEdges = start.edges.slice(), startWay = startEdges.length ? this.edges[startEdges[0]].way : -1;
    var skipStart = function (e) { return e.a === start.id || e.b === start.id; };
    var maxR = P.maxR;

    for (var k = 0; k < maxSteps; k++) {
      // Wander, then pick the flattest of three probe headings.
      heading += rand.gauss() * P.wiggle;
      if (P.planning > 0) {
        var q = Math.PI / 2, rel = heading - P.gridAngle;
        var snapTo = Math.round(rel / q) * q + P.gridAngle;
        heading += (snapTo - heading) * P.planning * 0.5;
      }
      var bestH = heading, bestC = Infinity;
      for (var c = -1; c <= 1; c++) {
        var h = heading + c * P.steer, tx = px + Math.cos(h) * step, ty = py + Math.sin(h) * step;
        var cost = T.slopeAt(tx, ty) * 10 + Math.abs(c) * (0.08 + P.planning * 0.6) + rand() * 0.05;
        if (T.isWater(tx, ty)) cost += 100;
        if (cost < bestC) { bestC = cost; bestH = h; }
      }
      heading = bestH;
      var nx = px + Math.cos(heading) * step, ny = py + Math.sin(heading) * step;
      var dc = Math.hypot(nx - P.cx, ny - P.cy);
      if (dc > maxR || Math.hypot(nx, ny) > T.W * 0.45) break;
      if (T.isWater(nx, ny) || T.isWater((px + nx) / 2, (py + ny) / 2)) break;
      if (T.slopeAt(nx, ny) > P.maxSlope) break;

      var snap = this.nearestNode(nx, ny, step * 0.75, function (n) { return n.id === start.id; });
      if (snap && !(k === 0 && this.areNeighbours(start, snap))) { end = { node: snap }; break; }

      var hit = this.firstCrossing(px, py, nx, ny, k === 0 ? skipStart : null);
      if (hit) { end = { edge: hit.edge, x: hit.x, y: hit.y }; break; }

      // Too close to another road? Join it if we're heading into it,
      // otherwise stop (keeps room for building lots between roads).
      var near = this.nearestEdge(nx, ny, clearance, function (e) {
        return skipStart(e) || (e.way === startWay && k < 3);
      });
      if (near) {
        var A = this.nodes[near.edge.a], B = this.nodes[near.edge.b];
        var ex = B.x - A.x, ey = B.y - A.y, el = Math.hypot(ex, ey) || 1;
        var cosang = Math.abs((ex * Math.cos(heading) + ey * Math.sin(heading)) / el);
        if (cosang < 0.75 && k > 0) {
          var nearEnd = near.t < 0.2 ? A : near.t > 0.8 ? B : null;
          end = nearEnd ? { node: nearEnd } : { edge: near.edge, x: near.x, y: near.y };
        }
        break;
      }
      pts.push([nx, ny]); px = nx; py = ny;
    }

    if (pts.length < (end ? 1 : P.minSteps)) return null;
    var ids = [start.id];
    for (var i = 0; i < pts.length; i++) ids.push(this.addNode(pts[i][0], pts[i][1]).id);
    if (end) {
      var target = end.node || (end.edge.dead ? null : this.splitEdge(end.edge, end.x, end.y));
      if (target && target.id !== ids[ids.length - 1]) ids.push(target.id);
    }
    return this.addWay(kind, ids, P.order);
  };

  Network.prototype.areNeighbours = function (a, b) {
    var E = this.edges;
    for (var i = 0; i < a.edges.length; i++) {
      var e = E[a.edges[i]];
      if (!e.dead && (e.a === b.id || e.b === b.id)) return true;
    }
    return false;
  };

  /** Tangent at a node along its way (unit vector). */
  Network.prototype.tangentAt = function (n) {
    var E = this.edges, N = this.nodes, tx = 0, ty = 0;
    for (var i = 0; i < n.edges.length; i++) {
      var e = E[n.edges[i]];
      if (e.dead) continue;
      var o = N[e.a === n.id ? e.b : e.a], dx = o.x - n.x, dy = o.y - n.y, l = Math.hypot(dx, dy) || 1;
      // Align to the first direction so opposite edges reinforce.
      if (tx * dx + ty * dy < 0) { dx = -dx; dy = -dy; }
      tx += dx / l; ty += dy / l;
    }
    var L = Math.hypot(tx, ty) || 1;
    return [tx / L, ty / L];
  };

  /**
   * Grow streets until there is roughly `targetLength` metres of street
   * within `P.maxR` of the centre. Branch points favour the centre and
   * favour busier roads.
   */
  Network.prototype.growStreets = function (targetLength, P, rand, kinds) {
    var self = this, N = this.nodes, E = this.edges, grown = 0, attempts = 0;
    var maxAttempts = 80 + targetLength / P.step * 4;
    var cands = [], weights = 0, i;
    // Weighted pick of a branch point: a mid-chain node (side street) or a
    // dead end (carry the street on). Favour the centre and busy roads. The
    // candidate list is rebuilt every few attempts rather than every time.
    function collect() {
      cands = []; weights = 0;
      for (var i = 0; i < N.length; i++) {
        var n = N[i], deg = self.degree(n);
        if (deg !== 2 && deg !== 1) continue;
        var d = Math.hypot(n.x - P.cx, n.y - P.cy);
        if (d > P.maxR * 0.95) continue;
        var e0 = null;
        for (var k = 0; k < n.edges.length; k++) if (!E[n.edges[k]].dead) { e0 = E[n.edges[k]]; break; }
        if (kinds.parents.indexOf(e0.kind) < 0 || (deg === 1 && e0.kind === 'road')) continue;
        var w = Math.exp(-Math.pow(d / (P.maxR * 0.6), 2)) * (e0.kind === 'road' ? 1.6 : e0.kind === 'street' ? 1.2 : 0.8);
        if (deg === 1) w *= 0.9;
        cands.push([n, w, e0, deg]); weights += w;
      }
    }
    while (grown < targetLength && attempts++ < maxAttempts) {
      if (attempts % 24 === 1) collect();
      if (!cands.length) break;
      var x = rand() * weights, pick = cands[cands.length - 1];
      for (i = 0; i < cands.length; i++) { x -= cands[i][1]; if (x <= 0) { pick = cands[i]; break; } }
      var node = pick[0], parent = pick[2], heading, kind;
      if (parent.dead || self.degree(node) !== pick[3]) continue;
      if (pick[3] === 1) {
        // Dead end: keep going roughly the way the street was heading.
        var o = N[parent.a === node.id ? parent.b : parent.a];
        heading = Math.atan2(node.y - o.y, node.x - o.x) + rand.gauss() * 0.25;
        kind = parent.kind;
      } else {
        var crowded = self.nodeHash.query(node.x - P.junctionGap, node.y - P.junctionGap, node.x + P.junctionGap, node.y + P.junctionGap, function (m) {
          return m !== node && self.degree(m) >= 3 && Math.hypot(m.x - node.x, m.y - node.y) < P.junctionGap;
        });
        if (crowded) continue;
        var t = self.tangentAt(node), side = rand() < 0.5 ? 1 : -1;
        heading = Math.atan2(t[1], t[0]) + side * Math.PI / 2 + rand.gauss() * (1 - P.planning) * 0.45;
        kind = kinds.child(parent.kind, rand, Math.hypot(node.x - P.cx, node.y - P.cy) / P.maxR);
      }
      var steps = Math.round(rand.range(P.minLen, P.maxLen) / P.step);
      var w2 = self.growWay(node, heading, kind, steps, P, rand);
      if (!w2) continue;
      grown += (w2.nodes.length - 1) * P.step;
      if (pick[3] === 1) self.mergeInto(self.ways[parent.way], w2, node.id);
    }
    return grown;
  };

  /** Append `extra` (which starts at `at`, an end of `way`) onto `way`. */
  Network.prototype.mergeInto = function (way, extra, at) {
    if (extra.id !== this.ways.length - 1) return;
    var tail = extra.nodes.slice(1);
    if (way.nodes[way.nodes.length - 1] === at) way.nodes = way.nodes.concat(tail);
    else if (way.nodes[0] === at) way.nodes = tail.reverse().concat(way.nodes);
    else return;
    for (var i = 0; i < this.edges.length; i++) {
      var e = this.edges[i];
      if (e.way === extra.id) { e.way = way.id; e.kind = way.kind; }
    }
    this.ways.pop();
  };

  /** Ordered polyline for a way: [[x,y], ...]. */
  Network.prototype.wayPoints = function (w) {
    var N = this.nodes;
    return w.nodes.map(function (id) { return [N[id].x, N[id].y]; });
  };

  Network.prototype.liveEdges = function () {
    return this.edges.filter(function (e) { return !e.dead; });
  };

  Network.prototype.totalLength = function (filter) {
    var N = this.nodes, sum = 0;
    for (var i = 0; i < this.edges.length; i++) {
      var e = this.edges[i];
      if (e.dead || (filter && !filter(e))) continue;
      sum += Math.hypot(N[e.a].x - N[e.b].x, N[e.a].y - N[e.b].y);
    }
    return sum;
  };

  VG.ROAD_KINDS = KINDS;
  VG.network = { Network: Network, makeCostGrid: makeCostGrid };
})(typeof window !== 'undefined' ? window : globalThis);
