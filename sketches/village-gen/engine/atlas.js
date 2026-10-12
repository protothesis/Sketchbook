// The atlas: the world layer above single settlements. A small record of
// which places exist and which roads join them. Topological, not geometric:
// it knows Ashby lies along the road leaving Millford at bearing 80°, not how
// far away it is or what the land between looks like.
//
// A place is stored as its name, seed and settings, never as generated
// output: generation is deterministic, so that is enough to rebuild it.
//   place: { id, name, seed, base, settings, locked, generator, from, found }
//     base      settings it was discovered with (what it shows when unlocked)
//     settings  the locked settings (null unless locked)
//   link:  { from, to, bearing } a road leaving `from` at a compass bearing.
//          Every road is stored both ways.
// A place's links become the `roads` constraint when it is generated, so a
// road you walked always leads back.
(function (global) {
  'use strict';
  var VG = (global.VillageGen = global.VillageGen || {});
  var R = VG.rng, G = VG.geom;

  var FORMAT = 'village-gen-atlas', FORMAT_VERSION = 1, STORE_KEY = 'village-gen:atlas';
  var SETTINGS = ['seed', 'population', 'environment', 'river', 'planning', 'density', 'farmland', 'woodland'];

  function create(world) {
    return { format: FORMAT, version: FORMAT_VERSION, world: String(world || R.randomSeed()), places: {}, links: [], trail: [] };
  }

  function slug(name) { return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'place'; }

  function pickSettings(p) {
    var o = {};
    SETTINGS.forEach(function (k) { if (p[k] !== undefined) o[k] = p[k]; });
    return o;
  }

  function sameSettings(a, b) {
    if (!a || !b) return false;
    return SETTINGS.every(function (k) { return String(a[k]) === String(b[k]); });
  }

  /** The id a name maps to. Same name, same place, however you get there. */
  function idFor(name) { return slug(name); }
  function placeByName(A, name) { return A.places[idFor(name)] || null; }

  /** A destination's seed: the world seed plus its name. Readable, like a random seed. */
  function seedFor(world, name) {
    var rand = R.createRng(String(world), 'place|' + slug(name)), c = 'bcdfghjklmnprstvwz', v = 'aeiou', s = '';
    for (var i = 0; i < 3; i++) s += c[Math.floor(rand() * c.length)] + v[Math.floor(rand() * v.length)];
    return s + Math.floor(rand() * 90 + 10);
  }

  /**
   * Settings for a place seen for the first time, reached from `origin`
   * ({ params, river }). Neighbours tend to share the land they sit in and
   * the way they're built, so the setting and sliders lean on the origin's.
   * The draws come from world + name, so the same first visit always
   * discovers the same town; after that the atlas remembers it.
   */
  function discover(world, name, origin) {
    var rand = R.createRng(String(world), 'discover|' + slug(name)), op = origin && origin.params || VG.DEFAULTS;
    var envs = Object.keys(VG.ENVIRONMENTS).filter(function (e) { return e !== 'island'; });
    var u = rand(), cls = u < 0.3 ? 0 : u < 0.72 ? 1 : u < 0.92 ? 2 : 3, c = VG.SIZES[cls];
    var top = cls === VG.SIZES.length - 1 ? c.range[1] : c.range[1] - 1;
    var pop = Math.min(top, Math.round(c.range[0] * Math.pow(c.range[1] / c.range[0], rand())));
    // The name can say where it is ("Lynport" is on the coast); otherwise
    // it mostly shares its neighbour's land.
    var sameLand = rand() < (op.environment === 'arid' ? 0.9 : 0.6), other = envs[Math.floor(rand() * envs.length)];
    var hint = VG.names.envHint(name), useHint = rand() < 0.6;
    var env = hint && useHint ? hint : sameLand ? op.environment : other;
    sameLand = env === op.environment;
    var riverRoll = rand();
    var river = sameLand && origin && origin.river && riverRoll < 0.7 ? 'yes' : 'auto';
    function near(k) { return Math.round(G.clamp(+op[k] + rand.gauss() * 0.15, 0, 1) * 20) / 20; }
    return {
      seed: seedFor(world, name), population: pop, environment: env, river: river,
      planning: near('planning'), density: near('density'), farmland: near('farmland'), woodland: near('woodland')
    };
  }

  /**
   * Record a place. Returns the existing one if the name is already known,
   * unless `fresh` asks for a new entry (a different town that happens to
   * share a name gets "name-2").
   */
  function addPlace(A, name, settings, from, fresh) {
    var id = idFor(name);
    if (A.places[id] && !fresh) return A.places[id];
    for (var n = 2; A.places[id]; n++) id = idFor(name) + '-' + n;
    var s = pickSettings(settings);
    return (A.places[id] = {
      id: id, name: String(name), seed: s.seed, base: s, settings: null, locked: false,
      generator: VG.GENERATOR_VERSION, from: from || null, found: new Date().toISOString().slice(0, 10)
    });
  }

  function linkBetween(A, from, to) {
    for (var i = 0; i < A.links.length; i++) if (A.links[i].from === from && A.links[i].to === to) return A.links[i];
    return null;
  }

  /**
   * A road from `from` to `to`, leaving `from` at `bearing`. The far end gets
   * a road back from the opposite side, unless it already has one.
   */
  function connect(A, from, to, bearing) {
    var b = Math.round(((+bearing % 360) + 360) % 360);
    // An existing link keeps its bearing even if the road had to swing round
    // water: the bearing is the constraint that reproduces that road.
    if (!linkBetween(A, from, to)) A.links.push({ from: from, to: to, bearing: b });
    if (!linkBetween(A, to, from)) A.links.push({ from: to, to: from, bearing: (b + 180) % 360 });
  }

  function linksFrom(A, id) { return A.links.filter(function (l) { return l.from === id; }); }

  /** What to hand `VillageGen.generate` for a place: settings plus constraints. */
  function optionsFor(A, id) {
    var p = A.places[id], o = pickSettings(p.locked && p.settings ? p.settings : p.base);
    o.name = p.name;
    o.roads = roadsFor(A, id);
    return o;
  }
  function roadsFor(A, id) {
    return linksFrom(A, id).map(function (l) { return { destination: A.places[l.to] ? A.places[l.to].name : l.to, bearing: l.bearing }; });
  }

  /** Lock: keep these settings, and note which generator they were made with. */
  function lock(A, id, params) {
    var p = A.places[id];
    p.locked = true;
    p.settings = pickSettings(params);
    p.generator = VG.GENERATOR_VERSION;
    p.lockedOn = new Date().toISOString().slice(0, 10);
  }
  function unlock(A, id) {
    var p = A.places[id];
    p.locked = false; p.settings = null; delete p.lockedOn;
  }

  /**
   * Take the road `way` out of settlement S. `fromId` is S's place id, or
   * null if S isn't in the atlas yet (the start of a journey), in which case
   * it's added with the settings it has now. The destination is found by
   * name or discovered. Returns { from, to } place ids.
   */
  function travel(A, fromId, S, params, way) {
    var from = fromId && A.places[fromId];
    if (!from) from = addPlace(A, S.name, params, null, true);
    var dest = placeByName(A, way.destination);
    if (!dest) dest = addPlace(A, way.destination, discover(A.world, way.destination, { params: params, river: !!S.terrain.river }), from.id);
    connect(A, from.id, dest.id, way.bearing);
    return { from: from.id, to: dest.id };
  }

  /** Where you've been, newest last; "back" walks it. */
  function visit(A, id) {
    if (A.trail[A.trail.length - 1] !== id) A.trail.push(id);
    if (A.trail.length > 60) A.trail.splice(0, A.trail.length - 60);
  }

  // --- Save / load ------------------------------------------------------------

  function validate(o) {
    if (!o || o.format !== FORMAT || typeof o.places !== 'object' || !Array.isArray(o.links)) throw new Error('Not a village-gen atlas file');
    if (o.version > FORMAT_VERSION) throw new Error('Atlas file is from a newer version (' + o.version + ')');
    var A = create(o.world);
    Object.keys(o.places).forEach(function (id) {
      var p = o.places[id];
      if (!p || !p.name || !p.base) return;
      A.places[id] = {
        id: id, name: String(p.name), seed: String(p.seed || p.base.seed), base: pickSettings(p.base),
        settings: p.settings ? pickSettings(p.settings) : null, locked: !!(p.locked && p.settings),
        generator: +p.generator || 1, from: p.from || null, found: p.found || null
      };
      if (p.lockedOn) A.places[id].lockedOn = p.lockedOn;
    });
    o.links.forEach(function (l) {
      if (l && A.places[l.from] && A.places[l.to] && isFinite(+l.bearing)) A.links.push({ from: l.from, to: l.to, bearing: +l.bearing });
    });
    A.trail = (o.trail || []).filter(function (id) { return A.places[id]; });
    return A;
  }

  function toJSON(A) { return JSON.stringify(A, null, 1); }
  function fromJSON(text) { return validate(JSON.parse(text)); }

  /** From browser storage, or null. Never throws: storage may be off. */
  function load() {
    try {
      var t = global.localStorage && global.localStorage.getItem(STORE_KEY);
      return t ? fromJSON(t) : null;
    } catch (e) { return null; }
  }
  function save(A) {
    try { if (global.localStorage) global.localStorage.setItem(STORE_KEY, JSON.stringify(A)); return true; } catch (e) { return false; }
  }
  function clear() {
    try { if (global.localStorage) global.localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
  }

  VG.atlas = {
    create: create, idFor: idFor, placeByName: placeByName, seedFor: seedFor, discover: discover,
    addPlace: addPlace, connect: connect, travel: travel, linksFrom: linksFrom, linkBetween: linkBetween,
    optionsFor: optionsFor, roadsFor: roadsFor, lock: lock, unlock: unlock, visit: visit,
    pickSettings: pickSettings, sameSettings: sameSettings, SETTINGS: SETTINGS,
    toJSON: toJSON, fromJSON: fromJSON, load: load, save: save, clear: clear
  };
})(typeof window !== 'undefined' ? window : globalThis);
