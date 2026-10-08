// The orchestrator: `VillageGen.generate(options)` → one settlement as plain
// data, plus small query helpers a simulation can use (pathfinding over the
// road graph, picking, JSON export).
//
// Stages, each with its own PRNG stream:
//   terrain → site → approach roads → streets (+ farm tracks)
//   → buildings (services, farmsteads, homes) → fields → trees → names/history
// If the first pass can't house the target population, streets grow further
// out and buildings are placed again.
(function (global) {
  'use strict';
  var VG = (global.VillageGen = global.VillageGen || {});
  var G = VG.geom, R = VG.rng;

  // Settlement classes. Population ranges are what the class name means;
  // the rest sets character: how many roads lead in, how big the central
  // square is, what share of people live out on farms, street segment
  // length, and the household size used to estimate how many homes to build.
  var SIZES = [
    { id: 'hamlet',   label: 'Hamlet',   range: [5, 40],       def: 16,   approach: 2, plazaR: 0,  rural: 0.45, step: 12, hh: 4.2 },
    { id: 'village',  label: 'Village',  range: [40, 400],     def: 160,  approach: 3, plazaR: 11, rural: 0.22, step: 13, hh: 4.4 },
    { id: 'township', label: 'Township', range: [400, 3000],   def: 1200, approach: 4, plazaR: 20, rural: 0.1,  step: 14, hh: 6 },
    { id: 'city',     label: 'City',     range: [3000, 15000], def: 5000, approach: 5, plazaR: 32, rural: 0.04, step: 16, hh: 7.5 }
  ];
  var MAX_POP = 15000, MIN_POP = 5;

  function classify(pop) {
    for (var i = SIZES.length - 1; i >= 0; i--) if (pop >= SIZES[i].range[0]) return i;
    return 0;
  }

  var DEFAULTS = {
    seed: 'meadow', population: 160, environment: 'valley', river: 'auto',
    planning: 0.15, density: 0.5, farmland: 0.6, woodland: 0.5
  };

  function now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

  function generate(options) {
    var P = {}, k;
    for (k in DEFAULTS) P[k] = options && options[k] !== undefined ? options[k] : DEFAULTS[k];
    P.seed = String(P.seed);
    P.population = Math.round(G.clamp(+P.population || DEFAULTS.population, MIN_POP, MAX_POP));
    if (!VG.ENVIRONMENTS[P.environment]) P.environment = DEFAULTS.environment;
    ['planning', 'density', 'farmland', 'woodland'].forEach(function (key) { P[key] = G.clamp(+P[key], 0, 1); });

    var timings = {}, t0 = now(), tt = t0;
    function lap(name) { var t = now(); timings[name] = Math.round(t - tt); tt = t; }

    var sizeIdx = classify(P.population), size = SIZES[sizeIdx], pop = P.population;
    var W = Math.round(G.clamp((560 + 70 * Math.sqrt(pop)) * G.lerp(1.2, 0.85, P.density), 600, 12000));
    var T = VG.terrain.build({ W: W, seed: P.seed, environment: P.environment, river: P.river });
    var env = VG.ENVIRONMENTS[P.environment];
    lap('terrain');

    var S = {
      version: 1, generator: 'village-gen', seed: P.seed, params: P,
      size: { id: size.id, label: size.label }, sizeIdx: sizeIdx,
      environment: { id: P.environment, label: env.label }, env: env,
      units: 'metres', bounds: { size: W, minX: -W / 2, minY: -W / 2, maxX: W / 2, maxY: W / 2 },
      terrain: T, plazas: [], landmarks: [], buildSlope: (env.maxSlope || 0.2) + 0.02
    };

    // --- Site --------------------------------------------------------------
    var rs = R.createRng(P.seed, 'site'), best = null;
    for (var i = 0; i < 500; i++) {
      var rr = Math.sqrt(rs()) * 0.17 * W, a = rs() * Math.PI * 2;
      var x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (T.isWater(x, y)) continue;
      var e = 0.02 * W, sl = 0;
      for (var q = 0; q < 5; q++) sl += T.slopeAt(x + (q === 1 ? e : q === 2 ? -e : 0), y + (q === 3 ? e : q === 4 ? -e : 0));
      var wd = T.waterDistAt(x, y), ideal = 0.03 * W + 15;
      var waterTerm = wd > 0.25 * W ? 0.4 : Math.min(Math.abs(wd - ideal) / (0.05 * W), 1.5);
      var el = T.elevationAt(x, y) / Math.max(1, T.relief);
      var elTerm = P.environment === 'highlands' ? Math.abs(el - 0.25) : el * 0.6;
      var score = sl / 5 * 8 + waterTerm + elTerm + rr / (0.17 * W) * 0.35 + rs() * 0.05;
      if (!best || score < best.score) best = { x: x, y: y, score: score, wd: wd };
    }
    if (!best) best = { x: 0, y: 0, wd: Infinity };
    S.center = { x: Math.round(best.x * 10) / 10, y: Math.round(best.y * 10) / 10 };
    lap('site');

    // --- Approach roads ----------------------------------------------------
    var net = new VG.network.Network(T);
    S.network = net;
    var hub = net.addNode(best.x, best.y);
    var rr2 = R.createRng(P.seed, 'roads');
    var grid = VG.network.makeCostGrid(T, 129);
    var nApproach = size.approach + (rr2() < 0.4 ? 1 : 0), base = rr2() * Math.PI * 2;
    var approaches = [];
    for (i = 0; i < nApproach; i++) {
      var ang = base + (i + (rr2() - 0.5) * 0.7) * (Math.PI * 2 / nApproach);
      var way = net.routeApproach(grid, hub, ang, size.step);
      if (way) approaches.push(way);
    }
    lap('approach');

    // --- Size estimate -------------------------------------------------------
    var services = VG.buildings.serviceCounts(pop), nServices = 0;
    services.forEach(function (s) { nServices += s.count; });
    var townPop = pop * (1 - size.rural);
    var homes = townPop / size.hh;
    var lotArea = G.lerp(520, 170, P.density) * (sizeIdx === 0 ? 1.8 : 1) * (sizeIdx >= 2 ? 0.75 : 1);
    S.radius = Math.sqrt((homes + nServices) * lotArea / Math.PI) * 1.1 + 30;
    if (size.plazaR) S.plazas.push({ x: hub.x, y: hub.y, r: size.plazaR, kind: sizeIdx === 1 ? 'green' : 'square', main: true });

    var GP = {
      step: size.step, planning: P.planning, gridAngle: rr2() * Math.PI / 2,
      wiggle: (1 - P.planning) * 0.14 + 0.01, steer: G.lerp(0.32, 0.08, P.planning),
      maxSlope: env.maxSlope || 0.2, clearance: G.lerp(32, 19, P.density) * (sizeIdx === 0 ? 1.3 : 1),
      junctionGap: size.step * 1.5, minSteps: 2,
      minLen: G.lerp(35, 90, P.planning), maxLen: G.lerp(150, 380, P.planning) * (1 + sizeIdx * 0.25),
      cx: hub.x, cy: hub.y, maxR: S.radius, order: 1
    };
    var streetKinds = {
      parents: ['road', 'street', 'lane'],
      child: function (kind, rand, z) {
        if (kind === 'road') return sizeIdx >= 2 || rand() < 0.55 ? 'street' : 'lane';
        if (kind === 'street') return rand() < (sizeIdx >= 2 ? 0.6 : 0.4) * (1 - z * 0.5) ? 'street' : 'lane';
        return 'lane';
      }
    };

    // --- Grow, place, repeat until everyone has a home -----------------------
    var placer, round = 0;
    for (round = 0; round < 6; round++) {
      var inner = net.totalLength(function (e) {
        var A = net.nodes[e.a];
        return Math.hypot(A.x - hub.x, A.y - hub.y) < GP.maxR;
      });
      var need = (homes + nServices) * 13 * G.lerp(1.5, 0.75, P.density) * (sizeIdx === 0 ? 0.6 : 1) - inner;
      if (round > 0) need = Math.max(need, (homes + nServices) * 3);
      if (need > 0) net.growStreets(need, GP, rr2, streetKinds);
      if (round === 0) growTracks(S, net, rr2, GP, size, sizeIdx, P);
      lap('streets' + round);

      placer = placeBuildings(S, services, R.createRng(P.seed, 'build' + round), size);
      lap('buildings' + round);
      if (placer.residents >= pop * 0.97 && placer.spill <= pop * 0.04 + 10) break;
      GP.maxR *= 1.15; S.radius *= 1.1;
    }
    S._placer = placer;
    S.buildings = placer.list;

    // --- Countryside -----------------------------------------------------------
    S.fields = VG.fields.layFields(S, R.createRng(P.seed, 'fields'));
    lap('fields');
    S.trees = VG.fields.plantTrees(S, R.createRng(P.seed, 'trees'));
    lap('trees');

    // --- Names and history -------------------------------------------------------
    var rn = R.createRng(P.seed, 'names');
    S.name = VG.names.settlement(rn, P.environment, size.id);
    nameWays(S, approaches, rn);
    history(S, rn, best);
    S.stats = stats(S);
    timings.total = Math.round(now() - t0);
    S.timings = timings;
    S.rounds = round + 1;
    finalize(S);
    return S;
  }

  function growTracks(S, net, rand, GP, size, sizeIdx, P) {
    var T = S.terrain, reach = S.radius * 1.3 + P.farmland * T.W * 0.3;
    var TP = {};
    for (var k in GP) TP[k] = GP[k];
    TP.maxR = reach; TP.minLen = 120; TP.maxLen = 520 * Math.sqrt(T.W / 1500);
    TP.wiggle = 0.12; TP.steer = 0.3; TP.planning = P.planning * 0.5; TP.clearance = 45; TP.maxSlope = 0.26;
    TP.junctionGap = 60;
    var count = Math.round(G.lerp(2, 9, P.farmland) * (1 + sizeIdx * 0.6) * (S.env.fields || 1));
    var cands = net.nodes.filter(function (n) {
      var d = Math.hypot(n.x - GP.cx, n.y - GP.cy);
      return net.degree(n) === 2 && d > S.radius * 0.9 && d < reach * 0.8;
    });
    for (var i = 0; i < count * 3 && count > 0 && cands.length; i++) {
      var n = rand.pick(cands), t = net.tangentAt(n), side = rand() < 0.5 ? 1 : -1;
      var heading = Math.atan2(t[1], t[0]) + side * Math.PI / 2 + rand.gauss() * 0.3;
      var w = net.growWay(n, heading, 'track', Math.round(rand.range(TP.minLen, TP.maxLen) / TP.step), TP, rand);
      if (w && --count <= 0) break;
    }
  }

  function placeBuildings(S, services, rand, size) {
    var net = S.network, B = VG.buildings, pop = S.params.population;
    net.ways.forEach(function (w) { B.prepWay(w, net); });
    // Small squares at busy junctions in bigger places.
    S.plazas = S.plazas.filter(function (p) { return p.main; });
    if (S.sizeIdx >= 2) {
      net.nodes.forEach(function (n) {
        var d = Math.hypot(n.x - S.center.x, n.y - S.center.y);
        if (net.degree(n) >= 4 && d < S.radius * 0.7 && d > size.plazaR * 3 && rand() < 0.5) {
          var clash = S.plazas.some(function (p) { return Math.hypot(p.x - n.x, p.y - n.y) < p.r * 3 + 20; });
          if (!clash) S.plazas.push({ x: n.x, y: n.y, r: rand.range(7, 12), kind: 'square' });
        }
      });
    }

    var placer = new B.Placer(S), residents = 0;
    var order = { centre: 0, main: 1, mill: 2, water: 2, high: 2, edge: 3, any: 4 };
    services.slice().sort(function (a, b) { return order[a.pref] - order[b.pref]; }).forEach(function (s) {
      for (var i = 0; i < s.count; i++) {
        var b = placer.placeSpecial(s.type, s.pref, rand);
        if (b) residents += b.residents;
      }
    });

    var cands = placer.residentialCandidates(rand);
    var rural = cands.filter(function (c) { return c.rural; });
    var town = cands.filter(function (c) { return !c.rural; }).sort(function (a, b) { return a.key - b.key; });
    rand.shuffle(rural);
    var ruralTarget = pop * size.rural, ri = 0;
    while (residents < ruralTarget && ri < rural.length) {
      var h = placer.placeFarmstead(rural[ri++], rand);
      if (h) residents += h.residents;
    }
    for (var i = 0; i < town.length && residents < pop; i++) {
      var c = town[i];
      if (!placer.fits(c.polygon, c.x, c.y, 0.22)) continue;
      var type = c.type;
      if (type === 'townhouse' && c.way.kind !== 'lane' && rand() < 0.3) type = 'shophouse';
      residents += placer.add(B.makeBuilding(type, c, rand, S)).residents;
    }
    // Town lots ran out: spill onto farms (and tell the caller to grow more).
    var spill = 0;
    while (residents < pop && ri < rural.length) {
      var h2 = placer.placeFarmstead(rural[ri++], rand);
      if (h2) { residents += h2.residents; spill += h2.residents; }
    }
    placer.residents = residents;
    placer.spill = spill;
    if (S.plazas.length && S.plazas[0].main) S.landmarks = [{ type: S.sizeIdx === 1 ? 'pond' : 'well', x: S.center.x + S.plazas[0].r * 0.35, y: S.center.y - S.plazas[0].r * 0.2 }];
    return placer;
  }

  // --- Names ---------------------------------------------------------------

  var STREET_BY_TYPE = {
    church: 'Church Street', chapel: 'Chapel Lane', cathedral: 'Minster Street', mill: 'Mill Lane',
    smithy: 'Smithy Row', market: 'Market Street', school: 'School Lane', warehouse: 'Wharf Street',
    inn: 'Coaching Lane', bakery: 'Bakehouse Row', granary: 'Granary Lane', manor: 'Hall Lane',
    guildhall: 'Guild Street', barracks: 'Garrison Row', bathhouse: 'Bath Street', townhall: 'Hall Street'
  };
  var SUFFIX = ['Lane', 'Row', 'Street', 'Close', 'Walk', 'Way', 'Yard', 'Gate'];

  function nameWays(S, approaches, rand) {
    var net = S.network, T = S.terrain, used = {};
    function claim(n) {
      if (!n) return null;
      if (!used[n]) { used[n] = 1; return n; }
      var alt = rand.pick(['Upper ', 'Lower ', 'Back ', 'Little ', 'Old ', 'New ']) + n;
      if (!used[alt]) { used[alt] = 1; return alt; }
      return null;
    }
    approaches.forEach(function (w, i) {
      w.destination = VG.names.neighbour(rand, S.params.environment);
      w.name = claim(i === 0 && S.sizeIdx >= 1 ? 'High Street' : w.destination + ' Road');
    });
    var byWay = {};
    S.buildings.forEach(function (b) { if (b.wayId !== null) (byWay[b.wayId] = byWay[b.wayId] || []).push(b); });
    net.ways.forEach(function (w) {
      if (w.name || w.kind === 'road') return;
      if (w.kind === 'track') { w.name = null; return; }
      var bs = byWay[w.id] || [], named = null;
      for (var i = 0; i < bs.length && !named; i++) if (STREET_BY_TYPE[bs[i].type]) named = claim(STREET_BY_TYPE[bs[i].type]);
      if (!named) {
        var mid = net.nodes[w.nodes[w.nodes.length >> 1]];
        if (T.waterDistAt(mid.x, mid.y) < 35) named = claim(rand() < 0.5 ? 'Water Lane' : 'Bridge Street');
      }
      if (!named && T.slopeAt(net.nodes[w.nodes[0]].x, net.nodes[w.nodes[0]].y) > 0.1) named = claim(rand.pick(['Steep', 'Stony', 'Windy', 'Crook']) + ' Hill');
      if (!named) {
        var head = rand() < 0.55 ? VG.names.surname(rand, S.params.environment) : VG.names.tree(rand);
        named = claim(head + ' ' + (w.kind === 'lane' ? rand.pick(SUFFIX) : rand.pick(['Street', 'Street', 'Row', 'Gate'])));
      }
      w.name = named;
    });
  }

  // --- History: build order → epoch and year --------------------------------

  var FOUNDING = {
    river: ['a ford on the river', 'a bridging point on the river', 'the dry bank above the river'],
    coast: ['a sheltered landing on the coast', 'a fishing beach below the headland'],
    lakeside: ['the lake shore', 'a landing on the lake'],
    island: ['the island’s one good harbour', 'a spring above the island’s cove'],
    arid: ['a spring at the oasis', 'the last well before the dunes'],
    highlands: ['a sheltered shelf between the fells', 'a pass between the hills'],
    forest: ['a clearing cut from the old wood', 'a charcoal-burners’ clearing'],
    plains: ['a crossroads on the open plain', 'a market place for scattered farms'],
    valley: ['the valley floor', 'a meeting of valley roads']
  };

  function history(S, rand, site) {
    var age = Math.round(rand.range(70, 180) + S.sizeIdx * rand.range(110, 260));
    var founded = rand.int(780, 1500);
    var reasonKey = S.params.environment;
    if (S.terrain.river && site.wd < 120 && ['valley', 'plains', 'forest', 'highlands'].indexOf(reasonKey) >= 0) reasonKey = 'river';
    S.founded = { year: founded, reason: rand.pick(FOUNDING[reasonKey] || FOUNDING.valley) };
    S.presentYear = founded + age;

    var R0 = S.radius, c = S.center;
    var keyed = S.buildings.map(function (b) {
      var z = Math.hypot(b.x - c.x, b.y - c.y) / R0, key = z + rand.gauss() * 0.12;
      if (b.type === 'chapel' || b.type === 'church' || b.type === 'manor' || b.type === 'mill') key *= 0.4;
      if (b.type === 'cathedral' || b.type === 'townhall' || b.type === 'guildhall') key = key * 0.6 + 0.35;
      if (b.type === 'farmhouse' || b.type === 'barn') key = key * 0.4 + rand() * 0.6;
      if (b.type === 'school' || b.type === 'bathhouse' || b.type === 'warehouse') key += 0.4;
      return [b, key];
    }).sort(function (a, b) { return a[1] - b[1]; });
    var n = Math.max(1, keyed.length - 1);
    keyed.forEach(function (kb, i) {
      kb[0].epoch = Math.round((i / n) * 1000) / 1000;
      kb[0].built = Math.round(founded + age * Math.pow(kb[0].epoch, 1.25) * 0.97);
    });
    // Farmsteads: the barn goes up with its house.
    S.buildings.forEach(function (b) {
      if (b.type === 'barn' && b.farmstead !== undefined) {
        var h = S.buildings[b.farmstead];
        b.epoch = h.epoch; b.built = h.built + rand.int(0, 25);
      }
    });

    var net = S.network, byWay = {};
    S.buildings.forEach(function (b) {
      if (b.wayId === null) return;
      byWay[b.wayId] = Math.min(byWay[b.wayId] === undefined ? 1 : byWay[b.wayId], b.epoch);
    });
    net.ways.forEach(function (w) {
      if (w.kind === 'road') w.epoch = 0;
      else if (byWay[w.id] !== undefined) w.epoch = Math.max(0, byWay[w.id] - 0.02);
      else {
        var n0 = net.nodes[w.nodes[0]];
        w.epoch = w.kind === 'track' ? 0.15 : G.clamp(Math.hypot(n0.x - c.x, n0.y - c.y) / R0, 0, 1);
      }
      w.epoch = Math.round(w.epoch * 1000) / 1000;
    });
    var reach = 0;
    S.fields.forEach(function (f) { reach = Math.max(reach, Math.hypot(f.x - c.x, f.y - c.y)); });
    S.fields.forEach(function (f) {
      f.epoch = Math.round(G.clamp(Math.hypot(f.x - c.x, f.y - c.y) / (reach || 1) * 0.8 + rand() * 0.2 - 0.1, 0, 1) * 1000) / 1000;
    });
  }

  function stats(S) {
    var out = { population: 0, households: 0, buildings: S.buildings.length, byType: {}, byCategory: {},
      workers: 0, roadsKm: {}, fieldsHa: 0, trees: S.trees.length };
    S.buildings.forEach(function (b) {
      out.population += b.residents; out.households += b.households; out.workers += b.workers;
      out.byType[b.type] = (out.byType[b.type] || 0) + 1;
      out.byCategory[b.category] = (out.byCategory[b.category] || 0) + 1;
    });
    var net = S.network;
    Object.keys(VG.ROAD_KINDS).forEach(function (kind) {
      out.roadsKm[kind] = Math.round(net.totalLength(function (e) { return e.kind === kind; }) / 100) / 10;
    });
    S.fields.forEach(function (f) { out.fieldsHa += f.area / 10000; });
    out.fieldsHa = Math.round(out.fieldsHa);
    var builtHa = Math.PI * S.radius * S.radius / 10000;
    out.builtUpHa = Math.round(builtHa * 10) / 10;
    out.densityPerHa = Math.round(out.population / Math.max(0.1, builtHa) * 10) / 10;
    return out;
  }

  /**
   * Turn engine internals into the published shape: compact edge ids,
   * plain arrays, and private helpers tucked under a non-enumerable `_`.
   */
  function finalize(S) {
    var net = S.network, T = S.terrain;
    var live = net.liveEdges(), remap = {};
    var edges = live.map(function (e, i) {
      remap[e.id] = i;
      var A = net.nodes[e.a], B = net.nodes[e.b];
      return { id: i, a: e.a, b: e.b, way: e.way, kind: e.kind, bridge: e.bridge,
        length: Math.round(Math.hypot(A.x - B.x, A.y - B.y) * 10) / 10 };
    });
    var nodes = net.nodes.map(function (n) {
      return { id: n.id, x: Math.round(n.x * 10) / 10, y: Math.round(n.y * 10) / 10,
        edges: n.edges.filter(function (id) { return remap[id] !== undefined; }).map(function (id) { return remap[id]; }) };
    });
    var ways = net.ways.map(function (w) {
      var len = 0;
      for (var i = 1; i < w.nodes.length; i++) {
        var A = net.nodes[w.nodes[i - 1]], B = net.nodes[w.nodes[i]];
        len += Math.hypot(A.x - B.x, A.y - B.y);
      }
      var o = { id: w.id, kind: w.kind, name: w.name, nodes: w.nodes.slice(), length: Math.round(len), epoch: w.epoch };
      if (w.destination) o.destination = w.destination;
      if (w.rim) o.rim = { x: Math.round(w.rim.x), y: Math.round(w.rim.y) };
      return o;
    });
    var hidden = { terrain: T, net: net, placer: S._placer, fieldHash: S.fieldHash };
    delete S._placer; delete S.fieldHash; delete S.env; delete S.sizeIdx; delete S.buildSlope;
    S.network = { nodes: nodes, edges: edges, ways: ways };
    S.terrain = {
      res: T.res, cell: T.cell, waterLevel: T.wl, relief: Math.round(T.relief), heights: T.heights,
      river: T.river ? { points: T.river.points.map(function (p) { return [Math.round(p[0]), Math.round(p[1])]; }), halfWidth: Math.round(T.river.halfWidth * 10) / 10 } : null
    };
    S.radius = Math.round(S.radius);
    Object.defineProperty(S, '_', { value: hidden, enumerable: false });
  }

  // --- Query helpers for simulations ------------------------------------------

  function elevationAt(S, x, y) { return S._.terrain.elevationAt(x, y); }
  function isWater(S, x, y) { return S._.terrain.isWater(x, y); }

  function nearestNode(S, x, y) {
    var best = null, bd = Infinity;
    S.network.nodes.forEach(function (n) {
      if (!n.edges.length) return;
      var d = Math.hypot(n.x - x, n.y - y);
      if (d < bd) { bd = d; best = n; }
    });
    return best;
  }

  /** Shortest route along roads (Dijkstra) → { nodes: [ids], length } or null. */
  function findPath(S, from, to) {
    var N = S.network.nodes, E = S.network.edges, n = N.length;
    var dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    var open = [from];
    dist[from] = 0;
    while (open.length) {
      var bi = 0;
      for (var i = 1; i < open.length; i++) if (dist[open[i]] < dist[open[bi]]) bi = i;
      var u = open[bi];
      open[bi] = open[open.length - 1]; open.pop();
      if (done[u]) continue;
      done[u] = 1;
      if (u === to) break;
      var es = N[u].edges;
      for (var k = 0; k < es.length; k++) {
        var e = E[es[k]], v = e.a === u ? e.b : e.a, nd = dist[u] + e.length;
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; open.push(v); }
      }
    }
    if (!isFinite(dist[to])) return null;
    var path = [], p = to;
    while (p !== -1) { path.push(p); p = prev[p]; }
    return { nodes: path.reverse(), length: Math.round(dist[to]) };
  }

  /** What's at a world point: a building, else a field, else null. */
  function pick(S, x, y) {
    var hit = null;
    S._.placer.hash.query(x, y, x, y, function (b) { if (G.pointInPoly(x, y, b.polygon)) { hit = { kind: 'building', item: b }; return true; } });
    if (hit) return hit;
    S._.fieldHash.query(x, y, x, y, function (f) { if (G.pointInPoly(x, y, f.polygon)) { hit = { kind: 'field', item: f }; return true; } });
    return hit;
  }

  /** Nearest way within r metres of a point → { way, d } or null. */
  function wayAt(S, x, y, r) {
    var net = S._.net, hit = net.nearestEdge(x, y, r);
    return hit ? { way: S.network.ways[hit.edge.way], d: hit.d } : null;
  }

  /** Plain JSON-ready object. Terrain heights and trees are optional (big). */
  function toJSON(S, opts) {
    opts = opts || {};
    var out = {};
    Object.keys(S).forEach(function (k) { out[k] = S[k]; });
    out.terrain = {};
    Object.keys(S.terrain).forEach(function (k) { out.terrain[k] = S.terrain[k]; });
    if (opts.terrain) out.terrain.heights = Array.prototype.map.call(S.terrain.heights, function (h) { return Math.round(h * 1000) / 1000; });
    else delete out.terrain.heights;
    if (!opts.trees) { out.trees = undefined; out.treeCount = S.trees.length; }
    delete out.timings;
    return out;
  }

  VG.SIZES = SIZES;
  VG.MAX_POP = MAX_POP;
  VG.MIN_POP = MIN_POP;
  VG.DEFAULTS = DEFAULTS;
  VG.classify = classify;
  VG.generate = generate;
  VG.elevationAt = elevationAt;
  VG.isWater = isWater;
  VG.nearestNode = nearestNode;
  VG.findPath = findPath;
  VG.pick = pick;
  VG.wayAt = wayAt;
  VG.toJSON = toJSON;
})(typeof window !== 'undefined' ? window : globalThis);
