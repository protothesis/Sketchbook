// Buildings: the catalogue of types, lot placement along roads, occupancy
// numbers a simulation can use, and simple ground-floor interiors.
//
// Every building is an oriented rectangle fronting a road. Lots are proposed
// by walking both sides of every way; the frontage, depth, setback and gap
// depend on how far from the heart of the settlement the lot is (dense
// terraces in the core, detached houses further out, farmsteads with barns in
// the countryside). Lots are then accepted centre-outward until the target
// population is housed, so build order doubles as a plausible growth history.
(function (global) {
  'use strict';
  var VG = (global.VillageGen = global.VillageGen || {});
  var G = VG.geom;

  // w: frontage range (m), d: depth range (m), floors: range.
  // rooms: ground-floor room labels, biggest first. upper: what's upstairs.
  var TYPES = {
    cottage:   { label: 'Cottage', cat: 'residential', w: [5, 7], d: [5, 7], floors: [1, 1], rooms: ['Hearth room', 'Sleeping nook'] },
    house:     { label: 'House', cat: 'residential', w: [7, 10], d: [6, 9], floors: [1, 2], rooms: ['Hall', 'Kitchen', 'Bedroom', 'Store'], upper: 'Bedrooms' },
    townhouse: { label: 'Townhouse', cat: 'residential', w: [5, 8], d: [9, 14], floors: [2, 3], rooms: ['Front room', 'Kitchen', 'Parlour', 'Stair'], upper: 'Flats & bedrooms' },
    farmhouse: { label: 'Farmhouse', cat: 'residential', w: [9, 13], d: [7, 10], floors: [1, 2], rooms: ['Hall', 'Kitchen', 'Dairy', 'Bedroom', 'Bedroom'], upper: 'Bedrooms & loft' },
    manor:     { label: 'Manor house', cat: 'residential', w: [16, 24], d: [11, 15], floors: [2, 3], rooms: ['Great hall', 'Kitchen', 'Solar', 'Buttery', 'Chapel', 'Study'], upper: 'Chambers & servants' },
    shophouse: { label: 'Shop-house', cat: 'commercial', w: [6, 9], d: [9, 13], floors: [2, 3], rooms: ['Shop', 'Workroom', 'Kitchen', 'Stair'], upper: 'Family rooms' },
    shop:      { label: 'Shop', cat: 'commercial', w: [6, 9], d: [7, 10], floors: [1, 2], rooms: ['Shop floor', 'Back room', 'Store'], upper: 'Living quarters' },
    workshop:  { label: 'Workshop', cat: 'craft', w: [7, 11], d: [7, 10], floors: [1, 2], rooms: ['Workshop', 'Store', 'Living room'], upper: 'Bedrooms' },
    smithy:    { label: 'Smithy', cat: 'craft', w: [8, 11], d: [7, 9], floors: [1, 1], rooms: ['Forge', 'Anvil floor', 'Store'] },
    bakery:    { label: 'Bakery', cat: 'craft', w: [7, 10], d: [8, 11], floors: [1, 2], rooms: ['Bakehouse', 'Ovens', 'Shop'], upper: 'Living quarters' },
    inn:       { label: 'Inn', cat: 'commercial', w: [12, 18], d: [10, 14], floors: [2, 3], rooms: ['Common room', 'Kitchen', 'Taproom', 'Stair', 'Store'], upper: 'Guest rooms' },
    tavern:    { label: 'Tavern', cat: 'commercial', w: [8, 12], d: [8, 11], floors: [1, 2], rooms: ['Taproom', 'Kitchen', 'Cellar stair'], upper: 'Keeper’s rooms' },
    market:    { label: 'Market hall', cat: 'civic', w: [14, 22], d: [9, 13], floors: [1, 2], rooms: ['Open arcade', 'Weigh house', 'Stalls'], upper: 'Assembly room' },
    townhall:  { label: 'Town hall', cat: 'civic', w: [14, 20], d: [12, 16], floors: [2, 3], rooms: ['Hall', 'Council chamber', 'Records', 'Office'], upper: 'Offices' },
    guildhall: { label: 'Guildhall', cat: 'civic', w: [12, 18], d: [12, 16], floors: [2, 2], rooms: ['Guild hall', 'Strongroom', 'Kitchen'], upper: 'Meeting rooms' },
    school:    { label: 'School', cat: 'civic', w: [10, 15], d: [8, 11], floors: [1, 2], rooms: ['Schoolroom', 'Schoolroom', 'Master’s room'] },
    bathhouse: { label: 'Bathhouse', cat: 'civic', w: [12, 16], d: [12, 16], floors: [1, 1], rooms: ['Hot room', 'Warm room', 'Cold pool', 'Changing'] },
    barracks:  { label: 'Barracks', cat: 'civic', w: [16, 26], d: [9, 12], floors: [2, 2], rooms: ['Mess hall', 'Armoury', 'Bunk room', 'Bunk room'], upper: 'Bunk rooms' },
    chapel:    { label: 'Chapel', cat: 'religious', w: [7, 10], d: [13, 19], floors: [1, 1], rooms: ['Nave', 'Chancel'], long: true },
    church:    { label: 'Church', cat: 'religious', w: [12, 17], d: [24, 36], floors: [1, 1], rooms: ['Nave', 'Chancel', 'Vestry', 'Porch'], long: true },
    cathedral: { label: 'Cathedral', cat: 'religious', w: [22, 30], d: [50, 70], floors: [1, 1], rooms: ['Nave', 'Choir', 'North transept', 'South transept', 'Chapter house'], long: true },
    barn:      { label: 'Barn', cat: 'agricultural', w: [12, 20], d: [8, 12], floors: [1, 1], rooms: ['Threshing floor', 'Stalls', 'Hay bay'] },
    granary:   { label: 'Granary', cat: 'agricultural', w: [9, 14], d: [7, 10], floors: [2, 2], rooms: ['Grain floor', 'Sacks'] },
    mill:      { label: 'Mill', cat: 'industrial', w: [8, 12], d: [8, 11], floors: [2, 3], rooms: ['Millstones', 'Sack floor', 'Miller’s room'] },
    warehouse: { label: 'Warehouse', cat: 'industrial', w: [12, 20], d: [10, 16], floors: [2, 3], rooms: ['Loading floor', 'Bays', 'Office'] }
  };

  var TRADES = {
    workshop: ['Cooper', 'Weaver', 'Carpenter', 'Tanner', 'Potter', 'Cobbler', 'Wheelwright', 'Chandler', 'Rope maker', 'Glassblower', 'Tailor', 'Saddler'],
    shop: ['Grocer', 'Draper', 'Apothecary', 'Butcher', 'Ironmonger', 'Fishmonger', 'Bookbinder', 'Herbalist', 'Spicer', 'Haberdasher'],
    shophouse: ['Grocer', 'Draper', 'Butcher', 'Cobbler', 'Tailor', 'Barber', 'Candle maker', 'Clockmaker', 'Printer', 'Scrivener']
  };
  var CROPS_STORED = ['grain', 'hay', 'wool', 'timber', 'salt', 'cloth', 'wine', 'ale'];

  // Services by population: one per `per` people once pop ≥ min, capped by max.
  // `pref` decides where they like to sit.
  var SERVICES = [
    { type: 'church', min: 700, per: 3500, max: 5, pref: 'centre' },
    { type: 'cathedral', min: 5000, per: 1e9, max: 1, pref: 'centre' },
    { type: 'chapel', min: 35, per: 900, max: 4, pref: 'centre', unless: 'church' },
    { type: 'townhall', min: 600, per: 1e9, max: 1, pref: 'centre' },
    { type: 'market', min: 250, per: 5000, max: 3, pref: 'centre' },
    { type: 'guildhall', min: 2500, per: 4000, max: 3, pref: 'centre' },
    { type: 'inn', min: 70, per: 700, max: 12, pref: 'main' },
    { type: 'tavern', min: 25, per: 220, max: 40, pref: 'main' },
    { type: 'smithy', min: 40, per: 350, max: 20, pref: 'main' },
    { type: 'bakery', min: 90, per: 300, max: 40, pref: 'main' },
    { type: 'shop', min: 160, per: 120, max: 150, pref: 'main' },
    { type: 'workshop', min: 25, per: 70, max: 220, pref: 'any' },
    { type: 'school', min: 350, per: 1500, max: 10, pref: 'any' },
    { type: 'bathhouse', min: 1800, per: 5000, max: 3, pref: 'any' },
    { type: 'granary', min: 120, per: 1800, max: 6, pref: 'edge' },
    { type: 'warehouse', min: 500, per: 700, max: 25, pref: 'water' },
    { type: 'mill', min: 50, per: 900, max: 8, pref: 'mill' },
    { type: 'barracks', min: 3500, per: 6000, max: 3, pref: 'edge' },
    { type: 'manor', min: 90, per: 3000, max: 4, pref: 'high' }
  ];

  function serviceCounts(pop) {
    var out = [], have = {};
    SERVICES.forEach(function (s) {
      if (pop < s.min) return;
      if (s.unless && have[s.unless] && pop > 2000) return;
      var n = Math.min(s.max, Math.max(1, Math.round(pop / s.per)));
      have[s.type] = n;
      out.push({ type: s.type, count: n, pref: s.pref });
    });
    return out;
  }

  // --- Placement ------------------------------------------------------------

  function Placer(S) {
    this.S = S;
    this.T = S.terrain;
    this.net = S.network;
    this.list = [];
    this.hash = new G.SpatialHash(24);
  }

  var segQuadDist = G.segQuadDist;

  /** Can this footprint go here? */
  Placer.prototype.fits = function (poly, x, y, maxSlope) {
    var T = this.T, S = this.S, N = this.net.nodes, KINDS = VG.ROAD_KINDS;
    var lim = T.W * 0.46;
    maxSlope = Math.max(maxSlope, S.buildSlope || 0);
    for (var i = 0; i < 4; i++) {
      var c = poly[i];
      if (Math.hypot(c[0], c[1]) > lim || T.isWater(c[0], c[1])) return false;
    }
    if (T.isWater(x, y) || T.slopeAt(x, y) > maxSlope || T.riverNearPoly(poly, 1)) return false;
    for (i = 0; i < S.plazas.length; i++) {
      var p = S.plazas[i];
      for (var k = 0; k < 4; k++) if (Math.hypot(poly[k][0] - p.x, poly[k][1] - p.y) < p.r) return false;
      if (Math.hypot(x - p.x, y - p.y) < p.r) return false;
    }
    var b = G.polyBounds(poly), pad = 5;
    var hitRoad = this.net.segHash.query(b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad, function (e) {
      if (e.dead) return false;
      var A = N[e.a], B = N[e.b];
      return segQuadDist(A.x, A.y, B.x, B.y, poly) < KINDS[e.kind].width / 2 + 0.4;
    });
    if (hitRoad) return false;
    return !this.hash.query(b[0], b[1], b[2], b[3], function (o) { return G.quadsOverlap(poly, o.polygon); });
  };

  Placer.prototype.add = function (spec) {
    var b = G.polyBounds(spec.polygon);
    spec.id = this.list.length;
    this.list.push(spec);
    this.hash.insert(spec, b[0], b[1], b[2], b[3]);
    return spec;
  };

  /**
   * Pose a footprint against a way at arc length s on `side` (+1 left, -1
   * right). Returns centre, angle and polygon; `front` is the unit vector
   * from the building toward its road.
   */
  function poseOnWay(way, s, side, w, d, setback, net) {
    var pts = way._pts, cum = way._cum, L = cum[cum.length - 1];
    s = G.clamp(s, 0, L);
    var i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    var a = pts[i - 1], b = pts[i], seg = cum[i] - cum[i - 1] || 1, t = (s - cum[i - 1]) / seg;
    var tx = (b[0] - a[0]) / seg, ty = (b[1] - a[1]) / seg;
    var px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t;
    var nx = -ty * side, ny = tx * side;
    var off = VG.ROAD_KINDS[way.kind].width / 2 + setback + d / 2;
    var x = px + nx * off, y = py + ny * off, angle = Math.atan2(ty, tx);
    return {
      x: x, y: y, angle: angle, w: w, d: d, front: [-nx, -ny],
      polygon: G.rectCorners(x, y, w, d, angle),
      door: [px + nx * (off - d / 2), py + ny * (off - d / 2)],
      node: way.nodes[s - cum[i - 1] < cum[i] - s ? i - 1 : i]
    };
  }

  function prepWay(way, net) {
    var pts = net.wayPoints(way), cum = [0];
    for (var i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    way._pts = pts; way._cum = cum;
    return cum[cum.length - 1];
  }

  /** Try to place a special building with a location preference. */
  Placer.prototype.placeSpecial = function (type, pref, rand, ent) {
    var S = this.S, T = this.T, net = this.net, def = TYPES[type], R = S.radius;
    // Farm tracks are never candidates: they're added last and shouldn't
    // move the town's services around.
    var ways = net.ways.filter(function (w) { return w.kind !== 'track'; }), cands = [];
    // The building's own size comes from its key; only its spot is searched.
    var w = ent.rand.range(def.w[0], def.w[1]), d = ent.rand.range(def.d[0], def.d[1]);
    if (def.long && ent.rand() < 0.5) { var tmp = w; w = d; d = tmp; }
    for (var k = 0; k < 260; k++) {
      var way = rand.pick(ways), L = way._cum[way._cum.length - 1];
      if (L < 6) continue;
      if (pref === 'main' && way.kind !== 'road' && way.kind !== 'street') continue;
      var pose = poseOnWay(way, rand() * L, rand() < 0.5 ? 1 : -1, w, d, rand.range(0.8, 3), net);
      var dc = Math.hypot(pose.x - S.center.x, pose.y - S.center.y) / R, score;
      switch (pref) {
        case 'centre': score = dc; break;
        case 'main': score = dc * 0.8 + rand() * 0.4; break;
        case 'edge': score = Math.abs(dc - 1) + rand() * 0.3; break;
        case 'water': score = T.waterDistAt(pose.x, pose.y) / 40 + dc * 0.5; break;
        case 'mill':
          score = S.terrain.river ? T.riverDist(pose.x, pose.y, 200) / 30 + Math.abs(dc - 0.9) * 0.5
            : -T.elevationAt(pose.x, pose.y) / (T.relief * 0.3 + 1) + Math.abs(dc - 1.2);
          break;
        case 'high': score = -T.elevationAt(pose.x, pose.y) / (T.relief * 0.3 + 1) + Math.abs(dc - 1.1) * 1.5; break;
        default: score = dc + rand() * 0.8;
      }
      pose.score = score; pose.way = way;
      cands.push(pose);
    }
    cands.sort(function (a, b) { return a.score - b.score; });
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (this.fits(c.polygon, c.x, c.y, 0.24)) return this.add(makeBuilding(type, c, ent, S));
    }
    return null;
  };

  /** Residential lot templates by zone. z = distance from centre / radius. */
  function lotTemplate(z, sizeIdx, densityMul, rand, onTrack) {
    var t;
    if (onTrack || z > 1.35) {
      t = { type: 'farmhouse', setback: rand.range(5, 14), gap: rand.range(40, 140) };
    } else if (z < (sizeIdx === 3 ? 0.62 : 0.42) && sizeIdx >= 2) {
      t = { type: 'townhouse', setback: rand.range(0.2, 1), gap: rand() < 0.75 ? 0 : rand.range(0.5, 2.5) };
    } else if (z < 0.5 && sizeIdx === 1) {
      t = { type: 'house', setback: rand.range(1, 3), gap: rand.range(1, 4) };
    } else if (z < 1) {
      t = { type: rand() < 0.4 + 0.1 * (1 - sizeIdx) ? 'cottage' : 'house', setback: rand.range(2, 6), gap: rand.range(3, 10) };
    } else {
      t = { type: rand() < 0.6 ? 'cottage' : 'house', setback: rand.range(4, 10), gap: rand.range(10, 35) };
    }
    if (sizeIdx === 0 && t.type !== 'farmhouse') { t.gap += rand.range(4, 12); t.setback += 1.5; }
    t.gap *= densityMul; t.setback *= Math.sqrt(densityMul);
    var def = TYPES[t.type];
    t.w = rand.range(def.w[0], def.w[1]); t.d = rand.range(def.d[0], def.d[1]);
    return t;
  }

  /** Walk every way and propose residential lots on both sides. */
  Placer.prototype.residentialCandidates = function (rand) {
    var S = this.S, net = this.net, out = [], dens = S.params.density;
    var densityMul = G.lerp(2.6, 0.45, dens);
    // Sprawling places build out of order: some families take a plot out on
    // the edge while gaps remain nearer the centre. Compact ones fill in.
    var spread = G.lerp(0.55, 0.05, dens);
    // Two passes with different starting offsets (the second fills gaps the
    // first leaves on bends and at junctions), then farm tracks on their own,
    // last, so adding tracks never shifts the town's lots.
    for (var pass = 0; pass < 3; pass++)
    for (var wi = 0; wi < net.ways.length; wi++) {
      var way = net.ways[wi], L = way._cum[way._cum.length - 1];
      if ((way.kind === 'track') !== (pass === 2)) continue;
      for (var side = -1; side <= 1; side += 2) {
        var s = pass ? rand.range(5, 12) : rand.range(2, 6);
        while (s < L - 3) {
          var pos = poseOnWay(way, s, side, 1, 1, 0, net);
          var z = Math.hypot(pos.x - S.center.x, pos.y - S.center.y) / S.radius;
          var t = lotTemplate(z, S.sizeIdx, densityMul, rand, way.kind === 'track');
          var pose = poseOnWay(way, s + t.w / 2, side, t.w, t.d, t.setback, net);
          pose.way = way; pose.type = t.type; pose.z = z;
          pose.key = z + rand.gauss() * (0.1 + spread * Math.min(1, z)) + (way.kind === 'track' ? 2 : 0) + (pass === 1 ? 0.04 : 0);
          pose.rural = t.type === 'farmhouse';
          out.push(pose);
          s += t.w + t.gap;
        }
      }
    }
    return out;
  };

  /** Farmhouse + barn (and sometimes a second outbuilding) as a farmstead. */
  Placer.prototype.placeFarmstead = function (c, ent, barnEnt) {
    if (!this.fits(c.polygon, c.x, c.y, 0.22)) return null;
    var house = this.add(makeBuilding('farmhouse', c, ent, this.S)), rand = barnEnt.rand;
    var bw = rand.range(12, 20), bd = rand.range(8, 12), ca = Math.cos(c.angle), sa = Math.sin(c.angle);
    var back = [-c.front[0], -c.front[1]];
    var tries = [
      [ca * (c.w / 2 + 4 + bw / 2), sa * (c.w / 2 + 4 + bw / 2), 0],
      [-ca * (c.w / 2 + 4 + bw / 2), -sa * (c.w / 2 + 4 + bw / 2), 0],
      [back[0] * (c.d / 2 + 6 + bw / 2) + ca * 4, back[1] * (c.d / 2 + 6 + bw / 2) + sa * 4, Math.PI / 2]
    ];
    rand.shuffle(tries);
    for (var i = 0; i < tries.length; i++) {
      var x = c.x + tries[i][0], y = c.y + tries[i][1], ang = c.angle + tries[i][2];
      var poly = G.rectCorners(x, y, bw, bd, ang);
      if (this.fits(poly, x, y, 0.25)) {
        var barn = this.add(makeBuilding('barn', { x: x, y: y, angle: ang, w: bw, d: bd, front: c.front, polygon: poly,
          door: c.door, node: c.node, way: c.way }, barnEnt, this.S));
        barn.farmstead = house.id; house.farmstead = house.id;
        break;
      }
    }
    return house;
  };

  // --- Building records -----------------------------------------------------

  /**
   * `ent` is the building's identity: { key, rand, names }. `rand` drives its
   * physical details, `names` its family, trade and name, so the Names part
   * of the seed can be kept while the layout is rerolled (and vice versa).
   */
  function makeBuilding(type, pose, ent, S) {
    var def = TYPES[type], env = S.params.environment, rand = ent.rand, nr = ent.names;
    var floors = rand.int(def.floors[0], def.floors[1]);
    if (type === 'townhouse' && S.sizeIdx === 3 && rand() < 0.5) floors++;
    var area = pose.w * pose.d, floorArea = area * floors;
    var b = {
      id: -1, key: ent.key, type: type, label: def.label, category: def.cat, name: null,
      x: round(pose.x), y: round(pose.y), angle: round(pose.angle, 3),
      width: round(pose.w), depth: round(pose.d),
      polygon: pose.polygon.map(function (p) { return [round(p[0]), round(p[1])]; }),
      area: Math.round(area), floors: floors, floorArea: Math.round(floorArea),
      residents: 0, households: 0, workers: 0, capacity: 0,
      wayId: pose.way ? pose.way.id : null,
      entrance: { x: round(pose.door[0]), y: round(pose.door[1]), node: pose.node },
      front: [round(pose.front[0], 3), round(pose.front[1], 3)],
      elevation: round(S.terrain.elevationAt(pose.x, pose.y), 1),
      tags: []
    };
    occupancy(b, rand, S);
    var family = VG.names.surname(nr, env), trade = TRADES[type] ? nr.pick(TRADES[type]) : null;
    if (b.households) b.family = family;
    if (type === 'inn' || type === 'tavern') b.name = VG.names.inn(nr);
    else if (type === 'chapel') b.name = VG.names.shrine(nr);
    else if (type === 'church' || type === 'cathedral') b.name = VG.names.church(nr);
    else if (type === 'manor') b.name = (b.family || 'The') + ' Hall';
    else if (type === 'mill') b.name = S.terrain.river ? 'Watermill' : 'Windmill';
    if (trade) b.trade = trade;
    if (type === 'workshop' || type === 'shop' || type === 'shophouse' || type === 'smithy' || type === 'bakery') {
      b.name = family + '’s ' + (b.trade || def.label).toLowerCase();
    }
    if (type === 'mill' && !S.terrain.river) b.tags.push('windmill');
    b.rooms = interior(b, def, rand);
    if (def.upper && floors > 1) b.upperFloors = def.upper;
    return b;
  }

  function round(v, k) { var m = Math.pow(10, k === undefined ? 1 : k); return Math.round(v * m) / m; }

  function occupancy(b, rand, S) {
    var t = b.type, fa = b.floorArea, a = b.area;
    var hh = function (lo, hi) { b.households += 1; b.residents += rand.int(lo, hi); };
    switch (t) {
      case 'cottage': hh(1, 4); break;
      case 'house': hh(2, b.floors > 1 ? 8 : 6); break;
      case 'townhouse':
        for (var i = 0; i < Math.max(1, b.floors - 1); i++) hh(1, 6);
        break;
      case 'farmhouse': hh(3, 9); b.workers = rand.int(1, 4); break;
      case 'manor': hh(4, 8); b.residents += rand.int(3, 10); b.workers = rand.int(4, 12); b.tags.push('servants'); break;
      case 'shophouse': hh(2, 6); b.workers = rand.int(1, 3); b.capacity = Math.round(a / 4); break;
      case 'shop': if (rand() < 0.6) hh(1, 5); b.workers = rand.int(1, 3); b.capacity = Math.round(a / 3); break;
      case 'workshop': if (rand() < 0.6) hh(1, 5); b.workers = rand.int(1, 5); b.capacity = b.workers + 2; break;
      case 'smithy': if (rand() < 0.5) hh(1, 5); b.workers = rand.int(1, 3); b.capacity = 6; break;
      case 'bakery': hh(2, 5); b.workers = rand.int(2, 4); b.capacity = Math.round(a / 4); break;
      case 'inn':
        hh(2, 6); b.workers = rand.int(3, 7);
        b.beds = Math.round((b.floors - 1) * a / 9);
        b.capacity = Math.round(a * 0.6 / 1.5) + b.beds; break;
      case 'tavern': hh(1, 4); b.workers = rand.int(1, 3); b.capacity = Math.round(a / 1.6); break;
      case 'market': b.workers = Math.round(a / 12); b.capacity = Math.round(fa / 2.5); b.tags.push('stalls'); break;
      case 'townhall': b.workers = rand.int(3, 10); b.capacity = Math.round(fa / 4); break;
      case 'guildhall': b.workers = rand.int(2, 6); b.capacity = Math.round(a / 2); break;
      case 'school': b.workers = rand.int(1, 4); b.capacity = Math.round(fa / 2.5); b.tags.push('pupils'); break;
      case 'bathhouse': b.workers = rand.int(2, 5); b.capacity = Math.round(a / 3); break;
      case 'barracks': b.residents = Math.round(fa / 9); b.workers = rand.int(2, 6); b.capacity = b.residents; b.tags.push('soldiers'); break;
      case 'chapel': if (rand() < 0.5) hh(1, 2); b.workers = 1; b.capacity = Math.round(a / 1.1); break;
      case 'church': hh(1, 3); b.workers = rand.int(2, 4); b.capacity = Math.round(a / 1); break;
      case 'cathedral': b.workers = rand.int(12, 30); b.capacity = Math.round(a / 0.9); break;
      case 'barn': b.storage = Math.round(a * 6); b.capacity = rand.int(4, 20); b.tags.push('livestock'); break;
      case 'granary': b.storage = Math.round(fa * 3); b.workers = rand.int(1, 3); b.tags.push('grain'); break;
      case 'mill': hh(2, 6); b.workers = rand.int(1, 3); b.capacity = 6; break;
      case 'warehouse': b.storage = Math.round(fa * 3); b.workers = rand.int(2, 6); b.tags.push(rand.pick(CROPS_STORED)); break;
    }
    if (!b.capacity) b.capacity = Math.max(b.residents, Math.round(fa / 6));
  }

  /**
   * Ground floor plan by binary space partition in the building's local
   * frame: x along the frontage (0..width), y from the front wall (0) to the
   * back (depth). The front door is on the y = 0 wall.
   */
  // Long buildings get a fixed front-to-back sequence instead of a BSP.
  var SEQUENCES = {
    chapel: [['Nave', 0.72], ['Chancel', 0.28]],
    church: [['Porch', 0.1], ['Nave', 0.6], ['Chancel', 0.3]],
    cathedral: [['West porch', 0.06], ['Nave', 0.5], ['Crossing', 0.14], ['Choir', 0.2], ['Lady chapel', 0.1]]
  };

  function interior(b, def, rand) {
    var labels = def.rooms.slice(), w = b.width, d = b.depth;
    if (SEQUENCES[b.type]) {
      // Run the sequence along the long axis, whichever way the plot faces.
      var along = w > d, len = along ? w : d, at = 0;
      return SEQUENCES[b.type].map(function (r) {
        var size = r[1] * len, o = along ? { x: at, y: 0, w: size, d: d } : { x: 0, y: at, w: w, d: size };
        at += size;
        return { name: r[0], x: round(o.x), y: round(o.y), w: round(o.w), d: round(o.d), area: Math.round(o.w * o.d) };
      });
    }
    var target = Math.min(labels.length, Math.max(1, Math.floor(w * d / 14)));
    var rects = [{ x: 0, y: 0, w: w, d: d }], guard = 0;
    while (rects.length < target && guard++ < 20) {
      rects.sort(function (p, q) { return q.w * q.d - p.w * p.d; });
      var r = rects.shift(), along = r.w >= r.d, len = along ? r.w : r.d;
      if (len < 4.4) { rects.unshift(r); break; }
      var cut = len * rand.range(0.38, 0.62);
      if (def.long && !along) cut = len * rand.range(0.62, 0.75); // nave + chancel
      if (along) rects.push({ x: r.x, y: r.y, w: cut, d: r.d }, { x: r.x + cut, y: r.y, w: r.w - cut, d: r.d });
      else rects.push({ x: r.x, y: r.y, w: r.w, d: cut }, { x: r.x, y: r.y + cut, w: r.w, d: r.d - cut });
    }
    // Biggest room gets the first label; ties favour the front.
    rects.sort(function (p, q) { return q.w * q.d - p.w * p.d || p.y - q.y; });
    return rects.map(function (r, i) {
      return { name: labels[i] || 'Room', x: round(r.x), y: round(r.y), w: round(r.w), d: round(r.d), area: Math.round(r.w * r.d) };
    });
  }

  VG.BUILDING_TYPES = TYPES;
  VG.buildings = {
    Placer: Placer, serviceCounts: serviceCounts, prepWay: prepWay, poseOnWay: poseOnWay, makeBuilding: makeBuilding
  };
})(typeof window !== 'undefined' ? window : globalThis);
