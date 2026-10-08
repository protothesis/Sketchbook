// Wires the town sim, the canvas, the inspector and the controls together.
(function () {
  var PT = window.PsycheTown;
  var $ = function (id) { return document.getElementById(id); };

  var opts = { population: 26, hardship: 1, care: 0.5, armed: true };
  var world, selected = null, hover = null, paused = false, speed = 1;
  var colors = PT.render.themeColors();
  var townCanvas = $("town"), view;
  var orrery = new PT.Orrery($("orrery"));
  var drawer = new PT.wiki.Drawer("wiki.html");
  $("orrery").addEventListener("click", function (e) { var k = orrery.hit(e); if (k) drawer.open(k); });

  function newTown() {
    world = PT.town.create(opts);
    // Let the town live for a few hours first, so there's already some
    // history to read when you open it.
    for (var t = 0; t < 40; t += 0.05) PT.town.step(world, 0.05);
    selected = null;
    renderPanel(true);
  }

  // --- Controls ---------------------------------------------------------
  $("play").addEventListener("click", function () {
    paused = !paused;
    $("play").textContent = paused ? "Play" : "Pause";
    $("play").setAttribute("aria-pressed", String(paused));
  });
  $("speed").addEventListener("change", function (e) { speed = +e.target.value; });
  $("hardship").addEventListener("input", function (e) { opts.hardship = +e.target.value; });
  $("care").addEventListener("input", function (e) { opts.care = +e.target.value; });
  $("armed").addEventListener("change", function (e) { opts.armed = e.target.checked; });
  $("reset").addEventListener("click", newTown);
  $("close").addEventListener("click", function () { selected = null; renderPanel(true); });
  $("act-sit").addEventListener("click", function () { if (selected != null) PT.town.sitWith(world, world.agents[selected]); renderPanel(true); });
  $("act-confront").addEventListener("click", function () { if (selected != null) PT.town.provoke(world, world.agents[selected]); renderPanel(true); });
  $("act-hard").addEventListener("click", function () { if (selected != null) PT.town.hardDay(world, world.agents[selected]); renderPanel(true); });

  function eventPoint(e) {
    var r = townCanvas.getBoundingClientRect();
    return PT.render.toWorld(view, e.clientX - r.left, e.clientY - r.top);
  }
  townCanvas.addEventListener("pointermove", function (e) {
    if (!view) return;
    var a = PT.render.pick(world, eventPoint(e), 16);
    hover = a ? a.id : null;
    townCanvas.style.cursor = a ? "pointer" : "default";
  });
  townCanvas.addEventListener("pointerleave", function () { hover = null; });
  townCanvas.addEventListener("click", function (e) {
    if (!view) return;
    var a = PT.render.pick(world, eventPoint(e), 22);
    selected = a ? a.id : null;
    renderPanel(true);
    if (a && window.matchMedia("(max-width: 860px)").matches) $("panel").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  var mq = window.matchMedia("(prefers-color-scheme: dark)");
  if (mq.addEventListener) mq.addEventListener("change", function () { colors = PT.render.themeColors(); });

  // --- Panel ------------------------------------------------------------
  function fmtTime(t) {
    var day = Math.floor(t / world.DAY) + 1;
    var h = PT.town.hourOf({ time: t, DAY: world.DAY });
    var hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    return "Day " + day + " · " + String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
  }
  function hoursSince(t) { return Math.max(0, Math.round((world.time - t) / (world.DAY / 24))); }

  var esc = PT.wiki.esc;
  function hrs(secs) { return Math.max(1, Math.round(secs / (world.DAY / 24))) + "h"; }

  function logHtml(items, limit) {
    return items.slice(0, limit).map(function (l) {
      return '<li class="log-' + l.kind + '"><span class="when">' + fmtTime(l.t) + "</span>" + esc(l.text) + "</li>";
    }).join("") || '<li class="empty">Nothing yet.</li>';
  }

  function legendHtml(counts) {
    return PT.ARCHETYPES.map(function (a) {
      var n = counts[a.id] || 0;
      return '<li><a href="#" data-wiki="arch-' + a.id + '"' + (n ? ' class="active"' : "") + '><span class="dot" style="background:' +
        a.color + '"></span>' + esc(a.name) + (n ? '<span class="count">' + n + "</span>" : "") + "</a></li>";
    }).join("");
  }

  // Don't swap panel HTML out from under a press, or the click gets lost.
  var pressing = false;
  document.addEventListener("pointerdown", function () { pressing = true; });
  document.addEventListener("pointerup", function () { setTimeout(function () { pressing = false; }, 0); });

  var lastPanel = 0, lastWeather = "";
  function renderPanel(force) {
    var now = performance.now();
    if (!force && (pressing || now - lastPanel < 250)) return;
    lastPanel = now;
    $("clock").textContent = fmtTime(world.time);

    var counts = {}, alive = 0;
    world.agents.forEach(function (a) {
      if (a.lost) return;
      alive++;
      counts[a.psyche.ruler] = (counts[a.psyche.ruler] || 0) + 1;
    });
    var gripped = alive - (counts.ego || 0);
    var st = world.stats;
    $("tally").innerHTML =
      "<div><b>" + gripped + "</b><span>gripped now</span></div>" +
      "<div><b>" + st.weathered + "</b><span>grips weathered</span></div>" +
      "<div><b>" + st.lost + "</b><span>lives lost</span></div>" +
      "<div><b>" + (opts.armed ? st.defused : st.scuffles) + "</b><span>" + (opts.armed ? "defused" : "fights survived") + "</span></div>";

    if (selected == null) {
      $("overview").hidden = false;
      $("inspector").hidden = true;
      $("legend").innerHTML = legendHtml(counts);
      $("townlog").innerHTML = logHtml(world.log, 30);
      return;
    }
    $("overview").hidden = true;
    $("inspector").hidden = false;
    var a = world.agents[selected], p = a.psyche;
    var hold = PT.psyche.hold(p, { night: PT.town.isNight(world), cared: a.careNear });
    $("who").textContent = a.name;
    $("type").innerHTML = PT.panel.typeHtml(p);
    var state;
    if (a.lost) {
      state = '<span class="pill" style="--c:' + PT.colorOf(a.lost.ruler) + '">Lost</span> ' + esc(a.name) + " " + esc(a.lost.how) + ".";
      if (a.lost.wouldPass < 119) state += " If they'd been kept safe, the grip would likely have passed within about <b>" + Math.max(1, Math.round(a.lost.wouldPass)) + "h</b>.";
    } else {
      state = PT.panel.rulerHtml(p, hrs);
      if (p.ruler !== "ego") state += ' <span class="muted">(' + hoursSince(a.rulerSince) + "h so far)</span>";
    }
    $("state").innerHTML = state;
    $("hold").style.width = Math.round(hold * 100) + "%";
    $("fatigue").style.width = Math.round(p.fatigue * 100) + "%";
    $("tug").innerHTML = PT.panel.tugHtml(p, hold, 6);
    var wx = PT.panel.weatherHtml(p);
    if (wx !== lastWeather) { $("weather").innerHTML = wx; lastWeather = wx; }
    $("chart").textContent = p.planets.length;
    $("grips").textContent = a.gripCount;
    $("story").innerHTML = logHtml(a.story, 20);
    ["act-sit", "act-confront", "act-hard"].forEach(function (id) { $(id).disabled = !!a.lost; });
    $("act-sit").textContent = a.userCare > 0 ? "Sitting with them… (" + Math.ceil(a.userCare / (world.DAY / 24)) + "h)" : "Sit with them";
  }

  // --- Loop -------------------------------------------------------------
  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused) {
      var sim = dt * speed, h = 0.05;
      while (sim > 1e-6) { var s = Math.min(h, sim); PT.town.step(world, s); sim -= s; }
    }
    view = PT.render.fit(townCanvas, world);
    PT.render.draw(townCanvas, world, view, colors, selected, hover);
    if (selected != null) {
      var a = world.agents[selected];
      var hold = PT.psyche.hold(a.psyche, { night: PT.town.isNight(world), cared: a.careNear });
      orrery.draw(a.psyche, hold, colors, dt, { lostRuler: a.lost ? a.lost.ruler : null, compact: true });
    }
    renderPanel(false);
    requestAnimationFrame(frame);
  }

  // Handy for poking at the sim from the devtools console.
  PT.debug = function () { return { world: world, view: view, select: function (id) { selected = id; renderPanel(true); } }; };

  newTown();
  requestAnimationFrame(frame);
})();
