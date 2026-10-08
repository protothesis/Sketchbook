// The Psyche Lab: one person's orrery, full size, with life events to throw
// at them and knobs for care, rest, night and company.
(function () {
  var PT = window.PsycheTown, P = PT.psyche;
  var $ = function (id) { return document.getElementById(id); };
  var NAMES = ["Ada", "Basil", "Cass", "Dov", "Esme", "Femi", "Gus", "Hana", "Ines", "Jory", "Kit", "Lio",
    "Mara", "Nico", "Odile", "Pax", "Quin", "Rosa", "Sol", "Tamsin", "Ugo", "Vera", "Wren", "Yara"];
  var HOUR = 5; // sim seconds per in-world hour (same clock as the town)

  var p, name, log = [], cared = 0, night = false, company = false;
  var paused = false, speed = 1, clock = 0;
  var colors = PT.render.themeColors();
  var orrery = new PT.Orrery($("orrery"));
  var drawer = new PT.wiki.Drawer("wiki.html");

  PT.ENNEAGRAM.forEach(function (t) {
    var o = document.createElement("option"); o.value = t.n; o.textContent = t.n + " · " + t.name; $("pick-type").appendChild(o);
  });
  for (var n = 3; n <= 12; n++) {
    var o = document.createElement("option"); o.value = n; o.textContent = n; $("pick-size").appendChild(o);
  }

  function hrs(secs) { var h = Math.max(1, Math.round(secs / HOUR)); return h + "h"; }
  function fmt(t) {
    var h = (t / HOUR + 8) % 24, d = Math.floor((t / HOUR + 8) / 24) + 1;
    return "Day " + d + " · " + String(Math.floor(h)).padStart(2, "0") + ":" + String(Math.floor((h % 1) * 60)).padStart(2, "0");
  }
  function note(text, kind) {
    log.unshift({ t: clock, text: text, kind: kind || "info" });
    if (log.length > 60) log.length = 60;
    renderLog();
  }

  function reroll() {
    var opts = {};
    if ($("pick-type").value) opts.type = +$("pick-type").value;
    if ($("pick-size").value) opts.size = +$("pick-size").value;
    p = P.create(Math.random, opts);
    name = NAMES[(Math.random() * NAMES.length) | 0];
    log = [];
    clock = 0;
    cared = 0;
    var t = P.typeOf(p.type);
    note(name + " arrives: Type " + t.n + " (" + t.name + ") carrying " + p.planets.length + " archetypes: " +
      p.planets.map(function (pl) { return PT.ARCH[pl.id].name; }).join(", ") + ".");
    render(true);
  }

  // Events
  PT.EVENTS.concat([PT.BREAKIN]).forEach(function (ev) {
    var b = document.createElement("button");
    b.textContent = ev.label;
    b.title = ev.text.replace("{other}", "someone");
    if (ev.kind) b.className = "kind";
    b.addEventListener("click", function () {
      var mult = P.applyEvent(p, ev);
      var missing = ev.fx && Object.keys(ev.fx).every(function (k) { return !P.has(p, k); });
      note(name + " " + ev.text.replace("{other}", "someone") + "." +
        (mult > 1 ? " It cuts deep for a " + P.typeOf(p.type).name + " (×" + mult + ")." : "") +
        (missing ? " None of the archetypes it touches are in their chart, so it barely registers." : ""),
        ev.kind ? "good" : "event");
      render(true);
    });
    $("events").appendChild(b);
  });

  $("reroll").addEventListener("click", reroll);
  $("pick-type").addEventListener("change", reroll);
  $("pick-size").addEventListener("change", reroll);
  $("play").addEventListener("click", function () { paused = !paused; $("play").textContent = paused ? "Play" : "Pause"; });
  $("speed").addEventListener("change", function (e) { speed = +e.target.value; });
  $("sit").addEventListener("click", function () { cared = 25; note("You sit with " + name + " for a while.", "good"); });
  $("rest").addEventListener("click", function () { p.fatigue = Math.max(0, p.fatigue - 0.35); note(name + " gets a proper night's sleep.", "good"); render(true); });
  $("night").addEventListener("click", function () { night = !night; $("night").classList.toggle("on", night); });
  $("company").addEventListener("click", function () { company = !company; $("company").classList.toggle("on", company); });
  $("orrery").addEventListener("click", function (e) { var k = orrery.hit(e); if (k) drawer.open(k); });

  var mq = window.matchMedia("(prefers-color-scheme: dark)");
  if (mq.addEventListener) mq.addEventListener("change", function () { colors = PT.render.themeColors(); });

  function ctx() { return { night: night, inPublic: company, atHome: !company, cared: cared > 0 }; }

  function renderLog() {
    $("log").innerHTML = log.slice(0, 30).map(function (l) {
      return '<li class="log-' + l.kind + '"><span class="when">' + fmt(l.t) + "</span>" + PT.wiki.esc(l.text) + "</li>";
    }).join("");
  }

  // Don't swap panel HTML out from under a press, or the click gets lost.
  var pressing = false;
  document.addEventListener("pointerdown", function () { pressing = true; });
  document.addEventListener("pointerup", function () { setTimeout(function () { pressing = false; }, 0); });

  var last = 0, lastWeather = "";
  function render(force) {
    var now = performance.now();
    if (!force && (pressing || now - last < 250)) return;
    last = now;
    var h = P.hold(p, ctx());
    $("name").textContent = name;
    $("type").innerHTML = PT.panel.typeHtml(p);
    $("state").innerHTML = PT.panel.rulerHtml(p, hrs);
    $("hold").style.width = Math.round(h * 100) + "%";
    $("fatigue").style.width = Math.round(p.fatigue * 100) + "%";
    $("tug").innerHTML = PT.panel.tugHtml(p, h);
    var wx = PT.panel.weatherHtml(p);
    if (wx !== lastWeather) { $("weather").innerHTML = wx; lastWeather = wx; }
    $("clock").textContent = fmt(clock);
    $("sit").textContent = cared > 0 ? "Sitting with them… (" + hrs(cared) + ")" : "Sit with them";
    $("sit").classList.toggle("on", cared > 0);
  }

  var prevFrame = performance.now();
  function frame(now) {
    var dt = Math.min(0.1, (now - prevFrame) / 1000);
    prevFrame = now;
    if (!paused) {
      var sim = dt * speed;
      while (sim > 1e-6) {
        var s = Math.min(0.05, sim);
        var seen = {};
        p.weather.forEach(function (w) { if (w.rule) seen[w.rule] = true; });
        var change = P.step(p, s, ctx());
        clock += s;
        if (cared > 0) cared = Math.max(0, cared - s);
        p.weather.forEach(function (w) {
          if (w.rule && !seen[w.rule]) note("Weather: " + PT.WEATHER_BY_ID[w.rule].name + " (" + PT.ARCH[w.a].name + " " + PT.ASPECT_BY_ID[w.aspect].glyph + " " + PT.ARCH[w.b].name + ").", "info");
        });
        if (change) {
          if (change.to !== "ego") note("The " + PT.nameOf(change.to) + " captures the ego.", "grip");
          else note(name + " comes back to themselves; the " + PT.nameOf(change.from) + " lets go.", "good");
        }
        sim -= s;
      }
    }
    orrery.draw(p, P.hold(p, ctx()), colors, dt);
    render(false);
    requestAnimationFrame(frame);
  }

  reroll();
  requestAnimationFrame(frame);
})();
