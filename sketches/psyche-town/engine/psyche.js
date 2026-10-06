// Psyche model: a handful of Jungian-flavoured "complexes" that each carry a
// charge (0..1) and compete for control of a person. The Ego holds the wheel
// only while no autonomous complex's charge exceeds the ego's current "hold"
// (resilience, worn down by fatigue and night, propped up by the Persona and
// by being cared for). Once a complex takes over it feeds on itself a little,
// so a grip has momentum, but charges always decay back toward temperament,
// so almost every grip passes on its own if nothing irreversible happens.
(function () {
  var PT = (window.PsycheTown = window.PsycheTown || {});

  var COMPLEXES = [
    { id: "ego", name: "Ego", color: "#cfc8b8", autonomous: false,
      blurb: "The conscious 'I': the one who believes it's steering." },
    { id: "persona", name: "Persona", color: "#7fa7d6", autonomous: false,
      blurb: "The social mask. Routine, manners, the role you play in public. It quietly props the ego up, and it's the first thing to slip." },
    { id: "shadow", name: "Shadow", color: "#d4473b", autonomous: true, verb: "prowling",
      blurb: "Disowned rage and want. In its grip a person prowls, takes, breaks in, and afterwards may not recognise what they did." },
    { id: "child", name: "Frightened Child", color: "#e8b53a", autonomous: true, verb: "hiding",
      blurb: "Terror of threat and abandonment. It flees home and hides, and fear turns easily into rage or despair." },
    { id: "abyss", name: "Abyss", color: "#8a63c9", autonomous: true, verb: "withdrawing",
      blurb: "Despair that speaks in the voice of reason: 'there is only one way out.' It isolates its host so that no one can argue back." },
    { id: "guardian", name: "Guardian", color: "#e07b2e", autonomous: true, verb: "standing guard",
      blurb: "Protective aggression. It holds the doorway. It's necessary, but armed and frightened it's capable of irreversible things." },
    { id: "caretaker", name: "Caretaker", color: "#3fae84", autonomous: true, verb: "tending",
      blurb: "The urge to tend and hold. It seizes people too, but its grip calms everyone else's." },
  ];
  var BY_ID = {};
  COMPLEXES.forEach(function (c) { BY_ID[c.id] = c; });
  var AUTONOMOUS = COMPLEXES.filter(function (c) { return c.autonomous; }).map(function (c) { return c.id; });

  // [from, to, weight]: charge in `from` above a threshold leaks into `to`.
  // Negative weights soothe.
  var LINKS = [
    ["child", "shadow", 0.04],
    ["child", "abyss", 0.035],
    ["child", "guardian", 0.04],
    ["shadow", "abyss", 0.02],
    ["abyss", "shadow", 0.015],
    ["guardian", "shadow", 0.02],
    ["caretaker", "shadow", -0.08],
    ["caretaker", "child", -0.08],
    ["caretaker", "abyss", -0.08],
  ];
  var LINK_THRESHOLD = 0.4;

  // Life events. `{other}` is filled with another townsperson's name, who then
  // becomes the target of the recipient's grievance.
  var EVENTS = [
    { id: "jobloss", text: "lost their job", fx: { abyss: 0.4, child: 0.2 }, w: 1 },
    { id: "breakup", text: "was left by {other}", fx: { child: 0.4, shadow: 0.3 }, grievance: true, w: 1 },
    { id: "humiliated", text: "was humiliated by {other} in public", fx: { shadow: 0.45, child: 0.1 }, grievance: true, w: 1 },
    { id: "grief", text: "lost someone they loved", fx: { abyss: 0.5, child: 0.15 }, w: 0.8 },
    { id: "eviction", text: "got an eviction notice", fx: { child: 0.35, abyss: 0.2, shadow: 0.15 }, w: 0.8 },
    { id: "diagnosis", text: "got frightening news from a doctor", fx: { child: 0.4, abyss: 0.25 }, w: 0.6 },
    { id: "sleepless", text: "hasn't slept properly in days", fatigue: 0.45, w: 0.9 },
    { id: "oldwound", text: "had an old wound reopened", amplify: 0.3, w: 0.7 },
    { id: "kindness", text: "was shown unexpected kindness", fx: { caretaker: 0.3, shadow: -0.2, child: -0.2, abyss: -0.2 }, w: 0.7, kind: true },
  ];

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function createPsyche(rand, careLevel) {
    var base = {};
    AUTONOMOUS.forEach(function (id) { base[id] = 0.05 + rand() * 0.18; });
    base.caretaker = 0.05 + rand() * 0.25 * (0.5 + careLevel);
    var charge = {};
    for (var k in base) charge[k] = base[k];
    charge.persona = 0.5;
    return {
      base: base,
      charge: charge,
      resilience: 0.5 + rand() * 0.28,
      fatigue: 0.1 + rand() * 0.15,
      ruler: "ego",
    };
  }

  // The ego's current grip on the wheel.
  function hold(p, ctx) {
    var h = p.resilience * (1 - 0.45 * p.fatigue) + 0.12 * p.charge.persona;
    if (ctx.cared) h += 0.15;
    if (ctx.night) h -= 0.07;
    return clamp(h, 0.2, 0.95);
  }

  function strongest(p) {
    var best = null, bv = -1;
    AUTONOMOUS.forEach(function (id) {
      if (p.charge[id] > bv) { bv = p.charge[id]; best = id; }
    });
    return best;
  }

  // ctx: { night, inPublic, atHome, cared }
  // Returns { from, to } if the ruler changed this step, else null.
  function step(p, dt, ctx) {
    var c = p.charge;
    var d = {};
    AUTONOMOUS.forEach(function (id) { d[id] = (p.base[id] - c[id]) * 0.07; });
    LINKS.forEach(function (l) {
      var s = c[l[0]] - LINK_THRESHOLD;
      if (s > 0) d[l[1]] += l[2] * s * 2;
    });
    // A grip feeds on itself.
    if (p.ruler !== "ego") d[p.ruler] += 0.01;
    if (ctx.cared) { d.shadow -= 0.05; d.child -= 0.05; d.abyss -= 0.05; }
    AUTONOMOUS.forEach(function (id) { c[id] = clamp(c[id] + d[id] * dt, 0, 1); });

    // The persona firms up in public and slips when alone or gripped.
    var pTarget = p.ruler !== "ego" && p.ruler !== "caretaker" ? 0.1 : ctx.inPublic ? 0.75 : 0.3;
    c.persona += (pTarget - c.persona) * 0.15 * dt;

    if (p.ruler !== "ego" && p.ruler !== "caretaker") p.fatigue += 0.008 * dt;
    else if (ctx.atHome && ctx.night) p.fatigue -= 0.04 * dt;
    else p.fatigue -= 0.004 * dt;
    p.fatigue = clamp(p.fatigue, 0, 1);

    var h = hold(p, ctx);
    var top = strongest(p);
    var prev = p.ruler;
    if (prev !== "ego") {
      if (c[prev] < h - 0.08) p.ruler = c[top] > h ? top : "ego";
      else if (top !== prev && c[top] > c[prev] + 0.15) p.ruler = top;
    } else if (c[top] > h) {
      p.ruler = top;
    }
    return p.ruler !== prev ? { from: prev, to: p.ruler } : null;
  }

  function applyEvent(p, ev) {
    if (ev.fx) for (var k in ev.fx) p.charge[k] = clamp(p.charge[k] + ev.fx[k], 0, 1);
    if (ev.fatigue) p.fatigue = clamp(p.fatigue + ev.fatigue, 0, 1);
    if (ev.amplify) {
      var top = strongest(p);
      p.charge[top] = clamp(p.charge[top] + ev.amplify, 0, 1);
    }
  }

  // How long would the current grip take to release if the person were simply
  // left alone, safe, with nothing new happening? (Sim seconds, capped.)
  function timeToRelease(p) {
    if (p.ruler === "ego") return 0;
    var q = JSON.parse(JSON.stringify(p));
    var ctx = { night: false, inPublic: false, atHome: true, cared: false };
    for (var t = 0; t < 600; t += 0.5) {
      step(q, 0.5, ctx);
      if (q.ruler === "ego") return t;
    }
    return 600;
  }

  PT.COMPLEXES = COMPLEXES;
  PT.COMPLEX = BY_ID;
  PT.AUTONOMOUS = AUTONOMOUS;
  PT.LINKS = LINKS;
  PT.EVENTS = EVENTS;
  PT.clamp = clamp;
  PT.psyche = {
    create: createPsyche,
    hold: hold,
    step: step,
    applyEvent: applyEvent,
    strongest: strongest,
    timeToRelease: timeToRelease,
  };
})();
