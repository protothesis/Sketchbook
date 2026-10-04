// The town: homes, a few shared places, and the townspeople moving between
// them. Whoever rules a person's psyche decides where they walk. Gripped
// people also radiate: the Shadow frightens its neighbours, fear calls out the
// Caretaker in others, and the Caretaker soothes everyone close by.
(function () {
  var PT = (window.PsycheTown = window.PsycheTown || {});
  var P = PT.psyche, clamp = PT.clamp;

  var W = 900, H = 600;
  var DAY = 120; // sim seconds per in-world day
  var NAMES = ["Ada", "Basil", "Cass", "Dov", "Esme", "Femi", "Gus", "Hana", "Ines", "Jory",
    "Kit", "Lio", "Mara", "Nico", "Odile", "Pax", "Quin", "Rosa", "Sol", "Tamsin", "Ugo",
    "Vera", "Wren", "Xavi", "Yara", "Zeke", "Abel", "Bree", "Cyrus", "Dara", "Eli", "Faye",
    "Gil", "Hollis", "Ivo", "Juno", "Kai", "Lena", "Milo", "Noor"];

  var PLACES = {
    plaza: { name: "Plaza", kind: "circle", x: 450, y: 300, r: 70 },
    works: { name: "Works", kind: "rect", x: 600, y: 70, w: 230, h: 100 },
    park: { name: "Park", kind: "rect", x: 70, y: 400, w: 200, h: 130 },
    market: { name: "Market", kind: "rect", x: 110, y: 90, w: 170, h: 80 },
  };

  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pointIn(place, rand) {
    if (place.kind === "circle") {
      var a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * place.r * 0.85;
      return { x: place.x + Math.cos(a) * r, y: place.y + Math.sin(a) * r };
    }
    return { x: place.x + 12 + rand() * (place.w - 24), y: place.y + 12 + rand() * (place.h - 24) };
  }

  function homeSlots() {
    var slots = [];
    for (var x = 40; x <= W - 40; x += 60) { slots.push({ x: x, y: 36 }); slots.push({ x: x, y: H - 36 }); }
    for (var y = 100; y <= H - 100; y += 60) { slots.push({ x: 36, y: y }); slots.push({ x: W - 36, y: y }); }
    return slots;
  }

  function create(opts) {
    var seed = opts.seed != null ? opts.seed : (Math.random() * 1e9) | 0;
    var rand = rng(seed);
    var slots = homeSlots();
    for (var i = slots.length - 1; i > 0; i--) {
      var j = (rand() * (i + 1)) | 0, t = slots[i]; slots[i] = slots[j]; slots[j] = t;
    }
    var n = Math.min(opts.population || 26, slots.length, NAMES.length);
    var agents = [];
    for (var k = 0; k < n; k++) {
      var home = slots[k];
      agents.push({
        id: k,
        name: NAMES[k],
        home: home,
        x: home.x + (rand() - 0.5) * 10,
        y: home.y + (home.y < H / 2 ? 16 : -16),
        target: null,
        wait: rand() * 4,
        psyche: P.create(rand, opts.care),
        rulerSince: 0,
        grievance: null,
        threat: null,
        brokeInto: {},
        abyssT: 0,
        encounter: null,
        careNear: false,
        userCare: 0,
        lost: null,
        story: [],
        gripCount: 0,
      });
    }
    return {
      W: W, H: H, DAY: DAY, seed: seed, rand: rand,
      places: PLACES,
      agents: agents,
      time: 0,
      opts: opts,
      stats: { weathered: 0, lost: 0, defused: 0, scuffles: 0, longestGrip: 0 },
      log: [],
      flashes: [],
    };
  }

  function hourOf(world) { return ((world.time / DAY) * 24 + 8) % 24; }
  function isNight(world) { var h = hourOf(world); return h < 6 || h >= 21; }

  function note(world, text, kind, who) {
    world.log.unshift({ t: world.time, text: text, kind: kind || "info" });
    if (world.log.length > 80) world.log.length = 80;
    (who || []).forEach(function (a) {
      a.story.unshift({ t: world.time, text: text, kind: kind || "info" });
      if (a.story.length > 40) a.story.length = 40;
    });
  }

  function flash(world, x, y, color, big) {
    world.flashes.push({ x: x, y: y, color: color, t: 0, life: big ? 2.4 : 1.2, big: !!big });
  }

  function dist(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }

  function nearest(a, world, filter, maxD) {
    var best = null, bd = maxD || Infinity;
    world.agents.forEach(function (b) {
      if (b === a || b.lost || !filter(b)) return;
      var d = dist(a, b);
      if (d < bd) { bd = d; best = b; }
    });
    return best;
  }

  function routineTarget(a, world) {
    var h = hourOf(world), r = world.rand();
    var place;
    if (h >= 21 || h < 6) return { x: a.home.x, y: a.home.y + (a.home.y < H / 2 ? 14 : -14) };
    if (h < 9) place = r < 0.5 ? null : r < 0.8 ? "market" : "works";
    else if (h < 17) place = r < 0.55 ? "works" : r < 0.75 ? "market" : r < 0.9 ? "plaza" : null;
    else place = r < 0.4 ? "plaza" : r < 0.65 ? "park" : r < 0.8 ? "market" : null;
    if (!place) return { x: a.home.x, y: a.home.y + (a.home.y < H / 2 ? 14 : -14) };
    return pointIn(PLACES[place], world.rand);
  }

  function doorstep(a) { return { x: a.home.x, y: a.home.y + (a.home.y < H / 2 ? 14 : -14) }; }

  function inPlace(a) {
    for (var k in PLACES) {
      var p = PLACES[k];
      if (p.kind === "circle" ? Math.hypot(a.x - p.x, a.y - p.y) < p.r : a.x > p.x && a.x < p.x + p.w && a.y > p.y && a.y < p.y + p.h) return k;
    }
    return null;
  }

  // Where does whoever is in charge want this body to go?
  function steer(a, world) {
    var r = a.psyche.ruler;
    if (r === "shadow") {
      var g = a.grievance != null ? world.agents[a.grievance] : null;
      if (g && !g.lost) return { pt: doorstep(g), speed: 48 };
      var prey = nearest(a, world, function (b) { return b.psyche.ruler === "ego"; }, 260);
      if (prey) return { pt: prey, speed: 44 };
      return { pt: a.target || routineTarget(a, world), speed: 40 };
    }
    if (r === "child") return { pt: doorstep(a), speed: 55 };
    if (r === "abyss") {
      if (!a.edgeSpot) {
        var side = world.rand();
        a.edgeSpot = side < 0.5
          ? { x: 80 + world.rand() * (W - 160), y: side < 0.25 ? 70 : H - 70 }
          : { x: side < 0.75 ? 70 : W - 70, y: 120 + world.rand() * (H - 240) };
      }
      return { pt: a.edgeSpot, speed: 14 };
    }
    if (r === "guardian") {
      var t = a.threat != null ? world.agents[a.threat] : null;
      if (t && !t.lost && t.psyche.ruler === "shadow" && dist(a, t) < 160) return { pt: t, speed: 46 };
      var any = nearest(a, world, function (b) { return b.psyche.ruler === "shadow"; }, 110);
      if (any) return { pt: any, speed: 42 };
      return { pt: doorstep(a), speed: 40 };
    }
    if (r === "caretaker") {
      var fight = nearest(a, world, function (b) { return !!b.encounter; }, 300);
      if (fight) return { pt: fight, speed: 50, stopShort: 12 };
      var hurt = nearest(a, world, function (b) {
        var br = b.psyche.ruler;
        return br !== "ego" && br !== "caretaker";
      }, 240);
      if (hurt) return { pt: hurt, speed: 38, stopShort: 14 };
    }
    if (!a.target || a.arrived && a.wait <= 0) {
      a.target = routineTarget(a, world);
      a.arrived = false;
    }
    return { pt: a.target, speed: 30 };
  }

  function move(a, world, dt) {
    var s = steer(a, world);
    var dx = s.pt.x - a.x, dy = s.pt.y - a.y, d = Math.sqrt(dx * dx + dy * dy);
    var stop = s.stopShort || 3;
    if (d > stop) {
      var v = Math.min(s.speed * dt, d - stop);
      a.x += (dx / d) * v;
      a.y += (dy / d) * v;
    } else if (s.pt === a.target) {
      if (!a.arrived) { a.arrived = true; a.wait = 3 + world.rand() * 8; }
      a.wait -= dt;
    }
    if (a.psyche.ruler === "child") { a.x += (world.rand() - 0.5) * 1.2; a.y += (world.rand() - 0.5) * 1.2; }
    // Soft separation so people don't stack.
    world.agents.forEach(function (b) {
      if (b === a || b.lost) return;
      var ex = a.x - b.x, ey = a.y - b.y, e = Math.sqrt(ex * ex + ey * ey);
      if (e > 0 && e < 10) { a.x += (ex / e) * (10 - e) * 0.5; a.y += (ey / e) * (10 - e) * 0.5; }
    });
    a.x = clamp(a.x, 8, W - 8);
    a.y = clamp(a.y, 8, H - 8);
  }

  function lifeEvent(a, world) {
    var evs = PT.EVENTS, total = 0;
    var care = world.opts.care;
    evs.forEach(function (e) { total += e.kind ? e.w * (0.4 + care * 1.6) : e.w; });
    var r = world.rand() * total, ev = evs[0];
    for (var i = 0; i < evs.length; i++) {
      r -= evs[i].kind ? evs[i].w * (0.4 + care * 1.6) : evs[i].w;
      if (r <= 0) { ev = evs[i]; break; }
    }
    var text = ev.text;
    if (ev.grievance) {
      var others = world.agents.filter(function (b) { return b !== a && !b.lost; });
      if (!others.length) return;
      var o = others[(world.rand() * others.length) | 0];
      text = text.replace("{other}", o.name);
      a.grievance = o.id;
    }
    P.applyEvent(a.psyche, ev);
    note(world, a.name + " " + text + ".", ev.kind ? "good" : "event", [a]);
  }

  function lose(world, a, how, others) {
    var secs = P.timeToRelease(a.psyche);
    var hours = secs / (DAY / 24);
    a.lost = { t: world.time, how: how, ruler: a.psyche.ruler, wouldPass: hours };
    world.stats.lost++;
    flash(world, a.x, a.y, PT.COMPLEX[a.psyche.ruler].color, true);
    var passTxt = hours >= 119 ? "" : " Left alone and safe, this grip would likely have released within ~" +
      Math.max(1, Math.round(hours)) + " hour" + (Math.round(hours) === 1 ? "" : "s") + ".";
    note(world, a.name + " " + how + "." + passTxt, "loss", [a].concat(others || []));
  }

  function interact(world, dt) {
    var agents = world.agents, opts = world.opts;
    agents.forEach(function (a) { a.careNear = a.userCare > 0; });

    for (var i = 0; i < agents.length; i++) {
      var a = agents[i];
      if (a.lost) continue;
      for (var j = 0; j < agents.length; j++) {
        if (i === j) continue;
        var b = agents[j];
        if (b.lost) continue;
        var d = dist(a, b);
        if (d > 90) continue;
        var prox = 1 - d / 90;
        var ar = a.psyche.ruler, bc = b.psyche.charge;
        if (ar === "shadow") {
          bc.child = clamp(bc.child + 0.05 * prox * dt, 0, 1);
          var nearHome = dist(b, b.home) < 50 ? 1.8 : 1;
          bc.guardian = clamp(bc.guardian + 0.05 * prox * nearHome * dt, 0, 1);
          if (b.threat == null || bc.guardian > 0.5) b.threat = a.id;
        } else if (ar === "caretaker") {
          var k = 0.06 * prox * (0.5 + opts.care) * dt;
          bc.shadow = clamp(bc.shadow - k, 0, 1);
          bc.child = clamp(bc.child - k, 0, 1);
          bc.abyss = clamp(bc.abyss - k, 0, 1);
          if (d < 80) b.careNear = true;
        } else if ((ar === "child" || ar === "abyss") && b.psyche.ruler === "ego") {
          // Suffering moves those already inclined to tend.
          bc.caretaker = clamp(bc.caretaker + 0.05 * prox * b.psyche.base.caretaker * (0.5 + opts.care) * dt * 3, 0, 1);
        }
      }
    }

    // Break-ins: a Shadow-gripped person reaching their grievance's door.
    agents.forEach(function (a) {
      if (a.lost || a.psyche.ruler !== "shadow" || a.grievance == null) return;
      var g = agents[a.grievance];
      if (g.lost || a.brokeInto[g.id]) return;
      if (dist(a, doorstep(g)) < 16) {
        a.brokeInto[g.id] = true;
        P.applyEvent(g.psyche, { fx: { guardian: 0.5, child: 0.3 } });
        g.threat = a.id;
        flash(world, g.home.x, g.home.y, PT.COMPLEX.shadow.color);
        note(world, a.name + ", gripped by the Shadow, broke into " + g.name + "'s home.", "event", [a, g]);
      }
    });

    // Confrontations: a Guardian meeting a Shadow up close.
    agents.forEach(function (s) {
      if (s.lost) return;
      if (s.psyche.ruler !== "shadow") { s.encounter = null; return; }
      var g = nearest(s, world, function (b) { return b.psyche.ruler === "guardian"; }, 20);
      if (!g) { if (s.encounter) s.encounter.t = Math.max(0, s.encounter.t - dt); return; }
      if (!s.encounter || s.encounter.with !== g.id) {
        s.encounter = { with: g.id, t: 0 };
        note(world, g.name + " (Guardian) confronted " + s.name + " (Shadow).", "event", [s, g]);
      }
      var sc = s.psyche.charge, gc = g.psyche.charge;
      var helper = nearest(s, world, function (b) { return b !== g && b.psyche.ruler === "caretaker"; }, 90);
      if (helper || s.userCare > 0 || g.userCare > 0) {
        sc.shadow = clamp(sc.shadow - 0.3 * dt, 0, 1);
        gc.guardian = clamp(gc.guardian - 0.3 * dt, 0, 1);
        s.encounter.t = Math.max(0, s.encounter.t - 2 * dt);
        if (!s.encounter.helped) {
          s.encounter.helped = true;
          world.stats.defused++;
          var who = helper ? helper.name : "You";
          note(world, who + " stepped between " + g.name + " and " + s.name + ".", "good", [s, g].concat(helper ? [helper] : []));
        }
        return;
      }
      sc.shadow = clamp(sc.shadow + 0.1 * dt, 0, 1);
      gc.guardian = clamp(gc.guardian + 0.1 * dt, 0, 1);
      s.encounter.t += dt;
      if (s.encounter.t > 4) {
        if (opts.armed) {
          lose(world, s, "was killed by " + g.name + " while gripped by the Shadow", [g]);
          P.applyEvent(g.psyche, { fx: { abyss: 0.5, child: 0.3, guardian: -0.3 } });
          g.threat = null;
          note(world, g.name + " will carry this for the rest of their life.", "event", [g]);
        } else {
          world.stats.scuffles++;
          P.applyEvent(s.psyche, { fx: { shadow: -0.35, abyss: 0.25 } });
          P.applyEvent(g.psyche, { fx: { guardian: -0.25, child: 0.1 } });
          var ax = s.x - g.x, ay = s.y - g.y, m = Math.hypot(ax, ay) || 1;
          s.x += (ax / m) * 30; s.y += (ay / m) * 30;
          flash(world, s.x, s.y, PT.COMPLEX.guardian.color);
          note(world, g.name + " and " + s.name + " fought. It was ugly, but both lived.", "event", [s, g]);
          s.encounter = null;
        }
      }
    });

    // The Abyss, unanswered for long enough.
    agents.forEach(function (a) {
      if (a.lost) return;
      var alone = !nearest(a, world, function () { return true; }, 70);
      if (a.psyche.ruler === "abyss" && alone && !a.careNear) a.abyssT += dt;
      else a.abyssT = Math.max(0, a.abyssT - 2 * dt);
      if (a.abyssT > 20 && a.psyche.charge.abyss > 0.6) lose(world, a, "was lost to the Abyss, alone", []);
    });
  }

  function step(world, dt) {
    world.time += dt;
    var night = isNight(world);
    var opts = world.opts;

    interact(world, dt);

    world.agents.forEach(function (a) {
      if (a.lost) return;
      if (a.userCare > 0) a.userCare = Math.max(0, a.userCare - dt);
      if (world.rand() < opts.hardship * 0.011 * dt) lifeEvent(a, world);

      var place = inPlace(a);
      var change = P.step(a.psyche, dt, {
        night: night,
        inPublic: !!place,
        atHome: dist(a, a.home) < 30,
        cared: a.careNear,
      });
      if (change) {
        var to = change.to, from = change.from;
        if (to !== "ego") {
          if (from === "ego") { a.rulerSince = world.time; a.gripCount++; }
          a.edgeSpot = null;
          note(world, a.name + " is in the grip of the " + PT.COMPLEX[to].name + ".", "grip", [a]);
        } else {
          var dur = world.time - a.rulerSince;
          var hrs = Math.max(1, Math.round(dur / (DAY / 24)));
          if (from !== "caretaker") {
            world.stats.weathered++;
            world.stats.longestGrip = Math.max(world.stats.longestGrip, hrs);
          }
          a.brokeInto = {};
          a.edgeSpot = null;
          if (from === "shadow") a.grievance = null;
          if (from === "guardian") a.threat = null;
          note(world, a.name + " came back to themselves after ~" + hrs + "h in the grip of the " + PT.COMPLEX[from].name + ".", from === "caretaker" ? "info" : "good", [a]);
        }
      }
      move(a, world, dt);
    });

    world.flashes = world.flashes.filter(function (f) { f.t += dt; return f.t < f.life; });
  }

  function provoke(world, a) {
    if (a.lost) return;
    P.applyEvent(a.psyche, { fx: { shadow: 0.3, child: 0.15, guardian: 0.15 } });
    note(world, "You confronted " + a.name + ".", "event", [a]);
  }
  function sitWith(world, a) {
    if (a.lost) return;
    a.userCare = 25;
    note(world, "You sat with " + a.name + " for a while.", "good", [a]);
  }
  function hardDay(world, a) {
    if (a.lost) return;
    lifeEvent(a, world);
  }

  PT.town = {
    create: create,
    step: step,
    hourOf: hourOf,
    isNight: isNight,
    provoke: provoke,
    sitWith: sitWith,
    hardDay: hardDay,
    doorstep: doorstep,
  };
})();
