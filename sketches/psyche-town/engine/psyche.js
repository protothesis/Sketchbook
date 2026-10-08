// The psyche as a little orrery. The ego is the sun. Each archetype the
// person carries is a planet on its own slightly eccentric orbit, with its
// own period and its own "breath" (a slow swelling and shrinking of mass).
//
//   mass  = resting size x breath + charge from life events
//   pull  = mass / (distance^2 + softening)   ...charge also drags the orbit in
//
// The ego keeps the wheel while its hold (Enneagram baseline, worn down by
// fatigue and night, firmed up by company and care, drawn as the persona
// shield) beats every planet's pull. When a pull wins, that planet captures
// the sun. Aspects between planets (conjunction, square, trine, opposition)
// make "weather" that changes how charge flows between them.
(function () {
  var PT = (window.PsycheTown = window.PsycheTown || {});
  var TAU = Math.PI * 2;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(r, rand) { return r[0] + (r[1] - r[0]) * rand(); }
  function typeOf(n) { return PT.ENNEAGRAM[n - 1]; }
  // The town's Care setting makes these archetypes both commoner and heavier.
  var CARING = { caretaker: true, martyr: true, sage: true };

  var WEATHER_BY_KEY = {};
  PT.WEATHER.forEach(function (w) {
    WEATHER_BY_KEY[w.a + "|" + w.b + "|" + w.aspect] = w;
    WEATHER_BY_KEY[w.b + "|" + w.a + "|" + w.aspect] = w;
  });
  var WEATHER_BY_ID = {};
  PT.WEATHER.forEach(function (w) { WEATHER_BY_ID[w.id] = w; });
  var ASPECT_BY_ID = {};
  PT.ASPECTS.forEach(function (a) { ASPECT_BY_ID[a.id] = a; });

  // opts: { type (1-9), size (3-12 incl. Shadow), care (0-1) }
  function create(rand, opts) {
    opts = opts || {};
    var n = opts.type || 1 + Math.floor(rand() * 9);
    var type = typeOf(n);
    var size = opts.size || 3 + Math.floor(Math.pow(rand(), 1.3) * 10);
    var care = opts.care == null ? 0.5 : opts.care;
    var close = {};
    type.close.forEach(function (id) { close[id] = true; });

    // Weighted draw without replacement; the Shadow is universal.
    var pool = PT.ARCHETYPES.filter(function (a) { return !a.universal; }).map(function (a) {
      var w = close[a.id] ? 3 : 1;
      if (CARING[a.id]) w *= 0.6 + care * 1.2;
      return { a: a, w: w };
    });
    var chosen = PT.ARCHETYPES.filter(function (a) { return a.universal; });
    while (chosen.length < size && pool.length) {
      var total = pool.reduce(function (s, x) { return s + x.w; }, 0), r = rand() * total, i = 0;
      for (; i < pool.length - 1; i++) { r -= pool[i].w; if (r <= 0) break; }
      chosen.push(pool[i].a);
      pool.splice(i, 1);
    }

    var planets = chosen.map(function (a) {
      var isClose = !!close[a.id];
      return {
        id: a.id,
        a: lerp(a.orbit, rand) * (isClose ? 0.85 : 1),
        e: 0.05 + rand() * 0.15,
        w: rand() * TAU,
        period: lerp(a.period, rand),
        phase: rand() * TAU,
        breathPeriod: lerp(a.breath, rand),
        breathPhase: rand() * TAU,
        breathAmp: 0.2 + rand() * 0.4,
        base: lerp(a.base, rand) * (isClose ? 1.2 : 1) * (CARING[a.id] ? 0.7 + care * 0.9 : 1),
        charge: 0,
      };
    });
    var p = {
      type: n,
      holdBase: clamp(type.hold + (rand() - 0.5) * 0.12, 0.4, 0.85),
      fatigue: 0.1 + rand() * 0.15,
      planets: planets,
      t: rand() * 500, // start orbits somewhere arbitrary
      ruler: "ego",
      lean: null,
      calmT: 0,
      weather: [],
      careMult: 1,
    };
    p.view = view(p);
    return p;
  }

  function planetOf(p, id) {
    for (var i = 0; i < p.planets.length; i++) if (p.planets[i].id === id) return p.planets[i];
    return null;
  }
  function has(p, id) { return !!planetOf(p, id); }

  // Where every planet is right now, how heavy, and how hard it pulls.
  function view(p) {
    return p.planets.map(function (pl) {
      var theta = pl.phase + (TAU * p.t) / pl.period;
      var r0 = pl.a * (1 - pl.e * Math.cos(theta - pl.w));
      var r = r0 * (1 - 0.4 * Math.min(pl.charge, 1));
      var breath = Math.sin(pl.breathPhase + (TAU * p.t) / pl.breathPeriod);
      var mass = pl.base * (1 + pl.breathAmp * breath) + pl.charge;
      return { id: pl.id, theta: theta, r: r, r0: r0, mass: mass, breath: breath, pull: (mass * 0.45) / (r * r + 0.15) };
    });
  }

  function hold(p, ctx) {
    ctx = ctx || {};
    var h = p.holdBase * (1 - 0.45 * p.fatigue);
    if (ctx.cared) h += 0.15 * p.careMult;
    if (ctx.inPublic) h += 0.04;
    if (ctx.night) h -= 0.07;
    if (p.lean === "growth") h += 0.05;
    return clamp(h, 0.2, 0.95);
  }

  function aspectsOf(v) {
    var out = [];
    for (var i = 0; i < v.length; i++) {
      for (var j = i + 1; j < v.length; j++) {
        var A = v[i], B = v[j];
        if (Math.max(A.mass, B.mass) < 0.25 || Math.min(A.mass, B.mass) < 0.12) continue;
        var sep = Math.abs(((A.theta - B.theta) % TAU + TAU) % TAU);
        if (sep > Math.PI) sep = TAU - sep;
        var deg = (sep * 180) / Math.PI;
        for (var k = 0; k < PT.ASPECTS.length; k++) {
          var asp = PT.ASPECTS[k];
          var off = Math.abs(deg - asp.angle);
          if (off <= asp.orb) {
            var rule = WEATHER_BY_KEY[A.id + "|" + B.id + "|" + asp.id];
            out.push({ a: A.id, b: B.id, aspect: asp.id, rule: rule ? rule.id : null, exact: 1 - off / asp.orb });
            break;
          }
        }
      }
    }
    return out;
  }

  // ctx: { night, inPublic, atHome, cared }
  // Returns { from, to } when the ruler changes this step, else null.
  function step(p, dt, ctx) {
    ctx = ctx || {};
    p.t += dt;
    var v = view(p), m = {}, c = {}, d = {};
    v.forEach(function (s) { m[s.id] = s.mass; });
    p.planets.forEach(function (pl) { c[pl.id] = pl.charge; d[pl.id] = -pl.charge * 0.07; });

    PT.LINKS.forEach(function (l) {
      if (!(l[0] in m) || !(l[1] in d)) return;
      var s = m[l[0]] - 0.35;
      if (s > 0) d[l[1]] += l[2] * s * 2;
    });

    p.weather = aspectsOf(v);
    p.careMult = 1;
    p.weather.forEach(function (asp) {
      var rule = asp.rule && WEATHER_BY_ID[asp.rule];
      if (rule) {
        (rule.leak || []).forEach(function (l) { if (l[0] in m && l[1] in d) d[l[1]] += l[2] * m[l[0]]; });
        (rule.drain || []).forEach(function (l) { if (l[0] in d) d[l[0]] -= l[1] * c[l[0]]; });
        if (rule.calm) p.planets.forEach(function (pl) { if (PT.ARCH[pl.id].tone === "dark") d[pl.id] -= rule.calm * pl.charge; });
        if (rule.careMult) p.careMult = Math.min(p.careMult, rule.careMult);
        return;
      }
      var strong = m[asp.a] >= m[asp.b] ? asp.a : asp.b, weak = strong === asp.a ? asp.b : asp.a;
      if (asp.aspect === "conjunction") d[weak] += 0.02 * Math.max(0, m[strong] - m[weak]);
      else if (asp.aspect === "square") d[weak] += 0.02 * m[strong];
      else if (asp.aspect === "opposition" && m[asp.a] > 0.3 && m[asp.b] > 0.3) { d[asp.a] += 0.01; d[asp.b] += 0.01; }
      else if (asp.aspect === "trine") { d[asp.a] -= 0.03 * c[asp.a]; d[asp.b] -= 0.03 * c[asp.b]; }
    });

    if (p.ruler !== "ego") d[p.ruler] += 0.01; // a grip feeds on itself
    if (ctx.cared) {
      p.planets.forEach(function (pl) { if (PT.ARCH[pl.id].tone === "dark") d[pl.id] -= 0.05 * p.careMult; });
    }
    p.planets.forEach(function (pl) { pl.charge = clamp(pl.charge + d[pl.id] * dt, 0, 1); });

    var tone = p.ruler === "ego" ? "light" : PT.ARCH[p.ruler].tone;
    if (p.ruler === "hermit") p.fatigue -= 0.05 * dt;
    else if (p.ruler === "martyr") p.fatigue += 0.012 * dt;
    else if (tone !== "light") p.fatigue += 0.008 * dt;
    else if (ctx.atHome && ctx.night) p.fatigue -= 0.04 * dt;
    else p.fatigue -= 0.004 * dt;
    p.fatigue = clamp(p.fatigue, 0, 1);

    var h = hold(p, ctx);
    p.calmT = p.ruler === "ego" ? p.calmT + dt : 0;
    p.lean = h < 0.45 || tone === "dark" ? "stress" : p.fatigue < 0.2 && p.calmT > 20 ? "growth" : null;

    p.view = view(p);
    var top = null, tp = -1, cur = 0;
    p.view.forEach(function (s) {
      if (s.pull > tp) { tp = s.pull; top = s.id; }
      if (s.id === p.ruler) cur = s.pull;
    });
    var prev = p.ruler;
    if (prev !== "ego") {
      if (cur < h - 0.08) p.ruler = tp > h ? top : "ego";
      else if (top !== prev && tp > cur + 0.15) p.ruler = top;
    } else if (tp > h) {
      p.ruler = top;
    }
    return p.ruler !== prev ? { from: prev, to: p.ruler } : null;
  }

  // How much harder this event lands given the ego's type (and the type it
  // leans toward under stress).
  function vulnerability(p, evId) {
    var t = typeOf(p.type);
    if (t.vulnerable.indexOf(evId) >= 0) return 1.5;
    if (p.lean === "stress" && typeOf(t.stress).vulnerable.indexOf(evId) >= 0) return 1.25;
    return 1;
  }

  function applyEvent(p, ev) {
    var mult = vulnerability(p, ev.id);
    if (ev.fx) for (var k in ev.fx) {
      var pl = planetOf(p, k);
      if (pl) pl.charge = clamp(pl.charge + (ev.fx[k] > 0 ? ev.fx[k] * mult : ev.fx[k]), 0, 1);
    }
    if (ev.fatigue) p.fatigue = clamp(p.fatigue + ev.fatigue * mult, 0, 1);
    if (ev.amplify) {
      var top = strongest(p), tp = planetOf(p, top);
      tp.charge = clamp(tp.charge + ev.amplify * mult, 0, 1);
    }
    p.view = view(p);
    return mult;
  }

  function addCharge(p, id, v) {
    var pl = planetOf(p, id);
    if (pl) pl.charge = clamp(pl.charge + v, 0, 1);
  }
  function chargeOf(p, id) { var pl = planetOf(p, id); return pl ? pl.charge : 0; }

  function strongest(p) {
    var best = null, bp = -1;
    (p.view || view(p)).forEach(function (s) { if (s.pull > bp) { bp = s.pull; best = s.id; } });
    return best;
  }

  // If left alone and safe with nothing new happening, how long until the
  // current grip lets go? (Sim seconds, capped at 600.)
  function timeToRelease(p) {
    if (p.ruler === "ego") return 0;
    var q = JSON.parse(JSON.stringify(p));
    var ctx = { atHome: true };
    for (var t = 0; t < 600; t += 0.5) {
      step(q, 0.5, ctx);
      if (q.ruler === "ego") return t;
    }
    return 600;
  }

  PT.clamp = clamp;
  PT.WEATHER_BY_ID = WEATHER_BY_ID;
  PT.ASPECT_BY_ID = ASPECT_BY_ID;
  PT.psyche = {
    create: create,
    step: step,
    view: view,
    hold: hold,
    has: has,
    planetOf: planetOf,
    chargeOf: chargeOf,
    addCharge: addCharge,
    applyEvent: applyEvent,
    vulnerability: vulnerability,
    strongest: strongest,
    timeToRelease: timeToRelease,
    typeOf: typeOf,
  };
})();
