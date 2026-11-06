// Regions: the seed chain one level up.
//
// Every space belongs to a region (`space.regionId`, `exp.regions`). A region
// is rolled from a seed the first time a door leads into it, and picks three
// things, each from its own stream so they vary independently:
//
//   type   the structure: how its rooms are shaped and joined (REGION_TYPES)
//   material  what it's built of (MATERIALS): its look in walk mode
//   conditions  five axes, each 0..1 in three bands (CONDITIONS):
//          temperature, moisture, air, age, potency. A new region leans
//          on its parent's values. Its `mood` is a name read off them
//          (moodName), so two catacombs in one run can feel nothing alike
//   size   a room budget, long-tailed: mostly small, now and then one that
//          goes on and on
//
// Rooms opened from inside a region spend its budget. Each door has a chance
// (rising as the budget runs out) of leading into a new region instead, and a
// spent region's doors always lead out. A new region's seed comes from the
// door's seed, so rerolling the door that starts a region rerolls the whole
// region. Nothing is planned ahead except what a type needs next (the
// cloister's ring and courtyard), and that claim is part of the candidate: a
// reroll leaves nothing behind.
//
// Within a region each space has a `role` (gallery, cubicle, walk, cell,
// room, threshold, hall). The role picks its shapes and its doors; the
// room-shape `archetype` (chamber / corridor / hall / stub) is unchanged, so
// everything that reads archetypes keeps working.
//
// See notes/structure-types.md for the full catalogue these come from.
(function (global) {
  'use strict';

  const DE = (global.DungeonEngine = global.DungeonEngine || {});
  const { hash, deriveRng, key } = DE;

  /**
   * The conditions: an ecology under every region. Each axis is a value
   * 0..1, read in three bands (low, mid, high: `bands`), so going to five
   * bands later is only new cut-offs. `color` [low, mid, high]: the map's
   * swatches when colouring by that axis.
   */
  const CONDITIONS = {
    temperature: { bands: ['cold', 'mild', 'warm'], color: ['#6aa9e8', '#9aa3ad', '#e0763a'] },
    moisture: { bands: ['dry', 'damp', 'wet'], color: ['#c9a96a', '#5fa08a', '#3a7fc0'] },
    air: { bands: ['still', 'draughty', 'breathing'], color: ['#8f8f9a', '#9ccfd8', '#d0689a'] },
    age: { bands: ['fresh', 'old', 'ancient'], color: ['#c8d0a0', '#a08a6a', '#6a5040'] },
    potency: { bands: ['low', 'mid', 'high'], color: ['#555a66', '#9a86d8', '#e8d65a'] },
  };
  const AXES = Object.keys(CONDITIONS);
  // How a mood name says a high or low band (the mid band says nothing).
  const MOOD_WORDS = { low: 'inert', mid: null, high: 'potent' };

  /** An axis's band index (0, 1, 2) for a value. */
  const bandIndex = (v) => (v < 1 / 3 ? 0 : v < 2 / 3 ? 1 : 2);
  /** An axis's band name for a conditions object: bandOf(cond, 'temperature') -> 'cold'. */
  function bandOf(cond, axis) {
    return CONDITIONS[axis].bands[bandIndex(cond ? cond[axis] : 0.5)];
  }

  /**
   * Conditions from a seed, each axis on its own stream. With a parent's,
   * each axis keeps near the parent's value (`condKeep`, give or take
   * `condJitter`), else rolls fresh, so neighbouring regions shade into
   * each other but now and then something new begins.
   */
  function rollConditions(seed, parentCond) {
    const out = {};
    for (const axis of AXES) {
      const r = deriveRng(seed, 'cond ' + axis);
      const fresh = r.next(), keep = r.chance(REGION_TUNING.condKeep), jit = r.range(-1, 1) * REGION_TUNING.condJitter;
      const v = parentCond && keep ? parentCond[axis] + jit : fresh;
      out[axis] = Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
    }
    return out;
  }

  /**
   * A mood's name, read off the conditions: the two axes furthest from the
   * middle, if they're out of their mid band, in axis order ("cold,
   * ancient"); "mild" if
   * nothing stands out.
   */
  function moodName(cond) {
    const out = AXES.map((a) => ({ a, d: Math.abs(cond[a] - 0.5), i: bandIndex(cond[a]) }))
      .filter((x) => x.i !== 1).sort((x, y) => y.d - x.d).slice(0, 2)
      .sort((x, y) => AXES.indexOf(x.a) - AXES.indexOf(y.a)) // always in axis order, so one pair has one name
      .map((x) => (x.a === 'potency' ? MOOD_WORDS[x.i ? 'high' : 'low'] : CONDITIONS[x.a].bands[x.i]));
    return out.length ? out.join(', ') : 'mild';
  }

  /**
   * What a region is built of: the strongest "you've walked somewhere new"
   * signal (walk mode gives each its own colours, surface texture and
   * floor and wall dressing). Its own roll, so every structure can come in
   * every material; `weight` is how often, and `leans` multiplies it for
   * the structure types it suits. `swatch` is its colour on the map.
   */
  const MATERIALS = {
    stone:    { weight: 1.4, leans: {}, swatch: '#8d8a84' },
    brick:    { weight: 1, leans: { cloister: 2 }, swatch: '#b0583c' },
    timber:   { weight: 0.9, leans: { meander: 2 }, swatch: '#a07646' },
    pearl:    { weight: 0.6, leans: { cloister: 1.6, catacomb: 1.4 }, swatch: '#d8d4e4' },
    obsidian: { weight: 0.5, leans: { catacomb: 1.5 }, swatch: '#3a3048' },
    earth:    { weight: 0.8, leans: { meander: 1.6, catacomb: 1.3 }, swatch: '#7a6040' },
  };

  /** A material for a region of this type, from its own stream (`r`). */
  function pickMaterial(r, type) {
    const names = Object.keys(MATERIALS);
    const w = names.map((n) => MATERIALS[n].weight * (MATERIALS[n].leans[type] || 1));
    let x = r.next() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < names.length; i++) { x -= w[i]; if (x < 0) return names[i]; }
    return names[names.length - 1];
  }

  /**
   * Structure types. `weight`: how often a new region is this type.
   * `size`: the room budget, min + an exponential tail (`scale`), and a
   * `huge` chance of multiplying it by `hugeMul`. `entry`: the role of a
   * region's first room. `threshold`: chance a new region starts with a
   * short plain passage (a threshold) before its structure begins.
   */
  const REGION_TYPES = {
    meander: { weight: 1, size: { min: 3, scale: 6, huge: 0.08, hugeMul: 4 }, entry: 'room', threshold: 0.3 },
    catacomb: { weight: 1, size: { min: 4, scale: 8, huge: 0.1, hugeMul: 4 }, entry: 'gallery', threshold: 0.35 },
    cloister: { weight: 0.8, size: { min: 2, scale: 5, huge: 0.08, hugeMul: 3 }, entry: 'walk', threshold: 0 },
  };

  /** Region-level tuning. */
  const REGION_TUNING = {
    sameType: 0.4,     // weight multiplier for the parent region's own type
    leaveBase: 0.03,   // chance a door leads out of a region that has budget left...
    leaveRamp: 0.35,   // ...plus this times (spent / size)^2
    condKeep: 0.5,     // chance each condition axis keeps near its parent region's...
    condJitter: 0.15,  // ...give or take this
    hueDrift: 14,      // how far a room's hue wanders from its region's
    maxSize: 120,
  };

  /** Rooms that spend a region's budget (not its spine, thresholds or stubs). */
  const SPENDS = { room: 1, gallery: 1, cubicle: 1, cell: 1 };

  // ---------------------------------------------------------------------------
  // Rolling a region

  /** A new region from its seed (no id yet). `parent` is the region it was entered from. */
  function rollRegion(seed, parent, anchor) {
    const types = Object.keys(REGION_TYPES);
    const tr = deriveRng(seed, 'type');
    const weights = types.map((t) => REGION_TYPES[t].weight * (parent && parent.type === t ? REGION_TUNING.sameType : 1));
    let x = tr.next() * weights.reduce((a, b) => a + b, 0);
    let type = types[types.length - 1];
    for (let i = 0; i < types.length; i++) { x -= weights[i]; if (x < 0) { type = types[i]; break; } }

    const cond = rollConditions(seed, parent && parent.cond);
    const mood = moodName(cond);
    const hue = deriveRng(seed, 'hue').int(0, 359);
    const material = pickMaterial(deriveRng(seed, 'material'), type);

    const sz = REGION_TYPES[type].size;
    const sr = deriveRng(seed, 'size');
    let size = sz.min + Math.floor(-Math.log(1 - sr.next()) * sz.scale);
    if (sr.chance(sz.huge)) size *= sz.hugeMul;
    size = Math.min(size, REGION_TUNING.maxSize);

    return { seed, type, cond, mood, material, hue, size, parentId: parent ? parent.id : null, anchor: { x: anchor.x, y: anchor.y } };
  }

  /** Rooms of this region that spend its budget. */
  function regionSpent(exp, regionId) {
    let n = 0;
    for (const id in exp.spaces) {
      const s = exp.spaces[id];
      if (s.regionId === regionId && !s.deadEnd && SPENDS[s.role]) n++;
    }
    return n;
  }

  /**
   * Which region, and which role, a room opened through `exit` of `parent`
   * gets. Draws only from the room seed's 'region' and 'role' streams.
   * Returns { region, role, isNew }; a new region has its id set already
   * (from the counter, like a space's).
   */
  function resolveRegion(exp, parent, exit, seed, beyond) {
    const pr = exp.regions[parent.regionId];
    const r = deriveRng(seed, 'region');
    const spent = regionSpent(exp, pr.id);
    const leave = spent >= pr.size || r.chance(REGION_TUNING.leaveBase + REGION_TUNING.leaveRamp * Math.pow(spent / pr.size, 2));
    if (!leave) return { region: pr, role: childRole(pr, parent, exit, deriveRng(seed, 'role')), isNew: false };
    const region = rollRegion(hash(seed, 'region'), pr, beyond);
    region.id = 'g' + exp.counters.region;
    const t = REGION_TYPES[region.type];
    const role = r.chance(t.threshold) ? 'threshold' : t.entry;
    return { region, role, isNew: true };
  }

  /** The role of a room opened from `parent` (same region). */
  function childRole(region, parent, exit, r) {
    const type = region.type;
    if (type === 'catacomb') {
      // Galleries carry straight on from their tip; side doors open mostly
      // onto small burial rooms, sometimes a crossing gallery.
      if (parent.role === 'gallery' && exit.facing !== parent.heading) return r.chance(0.7) ? 'cubicle' : 'gallery';
      return 'gallery';
    }
    if (type === 'cloister') {
      if (!region.plan && parent.role !== 'cell' && parent.role !== 'walk') return 'walk';
      return 'cell';
    }
    return 'room';
  }

  // ---------------------------------------------------------------------------
  // Shapes per role: an ordered list of { shape, role } to try (travel frame).

  function roleTries(rng, params, role) {
    const out = [];
    const chamber = (w, d, as) => out.push({ shape: DE.chamberShape(rng, params, { w, d, offset: rng.int(0, w - 1) }), role: as });
    const straight = (len, as) => out.push({ shape: DE.corridorShape(rng, params, { len, bend: 0 }), role: as });
    if (role === 'threshold') {
      const len = rng.int(2, 3);
      for (let l = len; l >= 1; l--) straight(l, 'threshold');
    } else if (role === 'gallery') {
      const len = rng.int(5, 11);
      for (let l = len; l >= 2; l -= 2) straight(l, 'gallery');
      chamber(2, 2, 'cubicle');
      chamber(1, 2, 'cubicle');
    } else if (role === 'cubicle') {
      const w = rng.int(2, 3), d = rng.int(2, 3);
      chamber(w, d, 'cubicle');
      chamber(2, 2, 'cubicle');
      chamber(2, 1, 'cubicle');
    } else if (role === 'cell') {
      let w, d;
      if (rng.chance(0.15)) { w = rng.int(4, 5); d = rng.int(4, 5); } // a chapter house
      else { w = rng.int(2, 4); d = rng.int(2, 3); }
      chamber(w, d, 'cell');
      while (w > 2 || d > 2) { if (w >= d) w--; else d--; chamber(w, d, 'cell'); }
      chamber(1, 2, 'cell');
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // The cloister: a ring of walk around a courtyard nothing may fill.

  /**
   * Ring placements to try, from the region seed's 'plan' stream (so the
   * room's own draws are untouched). Each is world-space parts: `near` (the
   * side you enter on, built now) plus far / left / right walk segments and
   * the void, claimed ahead. Bigger budgets get bigger rings. When a full
   * ring won't fit, a U (no far side) is tried.
   */
  function cloisterPlans(region, beyond, travel) {
    const r = deriveRng(region.seed, 'plan');
    const grow = region.size > 24 ? 4 : region.size > 10 ? 2 : 0;
    let W = r.int(7, 9) + grow, D = r.int(7, 9) + grow;
    const right = DE.RIGHT_OF[travel];
    const toW = (u, v) => {
      const f = DE.DIRS[travel], s = DE.DIRS[right];
      return key(beyond.x + u * f.x + v * s.x, beyond.y + u * f.y + v * s.y);
    };
    const plans = [];
    const sizes = [];
    for (; W >= 5 && D >= 5; W -= 2, D -= 2) sizes.push([W, D]);
    for (const shape of ['ring', 'u']) {
      for (const [w, d] of sizes) {
        const offs = r.shuffle(Array.from({ length: w - 2 }, (_, i) => i + 1)).slice(0, 2);
        for (const off of offs) {
          const lo = -off, hi = w - 1 - off;
          const near = [], far = [], left = [], rightSide = [], hole = [];
          for (let v = lo; v <= hi; v++) { near.push(toW(0, v)); far.push(toW(d - 1, v)); }
          const lastSide = shape === 'ring' ? d - 2 : d - 1;
          for (let u = 1; u <= lastSide; u++) { left.push(toW(u, lo)); rightSide.push(toW(u, hi)); }
          for (let u = 1; u <= d - 2; u++) for (let v = lo + 1; v <= hi - 1; v++) hole.push(toW(u, v));
          const parts = [
            { part: 'left', kind: 'corridor', role: 'walk', cells: left },
            { part: 'right', kind: 'corridor', role: 'walk', cells: rightSide },
            { part: 'court', kind: 'void', role: null, cells: hole },
          ];
          if (shape === 'ring') parts.push({ part: 'far', kind: 'corridor', role: 'walk', cells: far });
          plans.push({ shape, w, d, near, parts });
        }
      }
    }
    return plans;
  }

  /** Claims (reserve shapes, no ids) for a plan's parts. */
  function planClaims(region, plan, ownerId) {
    return plan.parts.map((p) => ({
      seed: hash(region.seed, p.part), kind: p.kind, cells: p.cells.slice(), regionId: region.id,
      role: p.role, part: p.part, ownerId, void: p.kind === 'void',
    }));
  }

  // ---------------------------------------------------------------------------
  // Doors per role

  /**
   * Is a door slot on the region's 2-cell module? Its position along the
   * wall it sits in (x for a north or south door, y for east or west) must
   * be even relative to the region's anchor, so rooms off neighbouring runs
   * line up.
   */
  function onModule(slot, region) {
    const along = slot.facing === 'N' || slot.facing === 'S' ? slot.cell.x - region.anchor.x : slot.cell.y - region.anchor.y;
    return ((along % 2) + 2) % 2 === 0;
  }

  /**
   * Loop chance for a door facing an existing space, by role. Structured
   * regions make few accidental loops; a gallery's tip running into another
   * gallery is a crossing, which reads, so it's kept more often.
   */
  function loopChanceFor(params, role, isTip) {
    if (role === 'gallery' && isTip) return 0.5;
    if (role === 'room' || role === 'hall' || !role) return params.loopChance;
    return 0.05;
  }

  Object.assign(DE, {
    CONDITIONS, AXES, bandOf, bandIndex, rollConditions, moodName, MATERIALS, pickMaterial, REGION_TYPES, REGION_TUNING,
    rollRegion, regionSpent, resolveRegion, childRole, roleTries, cloisterPlans, planClaims, onModule, loopChanceFor,
  });
})(typeof window !== 'undefined' ? window : globalThis);
