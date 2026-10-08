// The in-app wiki. Every archetype, Enneagram type, named weather, aspect and
// core concept gets an entry generated from engine/archetypes.js, so the
// wiki can't drift from what the sim actually does.
//
// Entries render in two modes: "drawer" (links open other entries in the
// side drawer) and "page" (links are #anchors on wiki.html).
(function () {
  var PT = (window.PsycheTown = window.PsycheTown || {});

  var VERBS = {
    prowl: "Heads for the door of whoever wronged them (a break-in), or prowls toward people nearby.",
    flee: "Runs home and stays there, trembling.",
    withdraw: "Goes home slowly and sits still.",
    isolate: "Drifts to the edge of town, away from everyone.",
    guard: "Holds the doorstep and confronts any Shadow that comes close.",
    confront: "Seeks out Shadows anywhere in town and confronts them (never lethally).",
    tend: "Goes to fights and to whoever is suffering.",
    approach: "Walks up to people and looms over them.",
    roam: "Wanders restlessly between the plaza and the market.",
    crowd: "Seeks the busiest place: the plaza.",
    agitate: "Goes to the plaza and stirs things up.",
    market: "Returns to the market again and again.",
    retreat: "Withdraws to the park to be alone and recover.",
    linger: "Walks very slowly in the park.",
    wander: "Wanders slowly anywhere at all.",
    routine: "Keeps to a strict loop between work and home.",
  };

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function link(key, label, mode) {
    return mode === "page"
      ? '<a class="wl" href="#' + key + '">' + esc(label) + "</a>"
      : '<a href="#" data-wiki="' + key + '">' + esc(label) + "</a>";
  }
  function archLink(id, mode) {
    var a = PT.ARCH[id];
    return '<span class="dot" style="background:' + a.color + '"></span> ' + link("arch-" + id, a.name, mode);
  }
  function typeTitle(t) { return "Type " + t.n + ": The " + t.name; }

  function head(kind, title, color) {
    return '<div class="kind">' + esc(kind) + "</div><h3>" +
      (color ? '<span class="dot" style="background:' + color + '"></span>' : "") + esc(title) + "</h3>";
  }
  function list(items) { return items.length ? "<ul>" + items.map(function (i) { return "<li>" + i + "</li>"; }).join("") + "</ul>" : '<p class="muted">None.</p>'; }

  function archEntry(a, mode) {
    var weather = PT.WEATHER.filter(function (w) { return w.a === a.id || w.b === a.id; }).map(function (w) {
      var other = w.a === a.id ? w.b : w.a, asp = PT.ASPECT_BY_ID[w.aspect];
      return link("weather-" + w.id, w.name, mode) + " · " + asp.glyph + " " + esc(PT.ARCH[other].name);
    });
    var feeds = PT.LINKS.filter(function (l) { return l[0] === a.id; }).map(function (l) {
      return (l[2] > 0 ? "Feeds " : "Soothes ") + archLink(l[1], mode);
    });
    var fedBy = PT.LINKS.filter(function (l) { return l[1] === a.id; }).map(function (l) {
      return (l[2] > 0 ? "Fed by " : "Soothed by ") + archLink(l[0], mode);
    });
    var aura = Object.keys(a.aura).map(function (k) {
      return (a.aura[k] > 0 ? "Stirs up " : "Calms ") + archLink(k, mode) + " in people nearby";
    });
    var events = PT.EVENTS.concat([PT.BREAKIN]).filter(function (e) { return e.fx && e.fx[a.id] > 0; }).map(function (e) { return esc(e.label); });
    var types = PT.ENNEAGRAM.filter(function (t) { return t.close.indexOf(a.id) >= 0; }).map(function (t) {
      return link("type-" + t.n, typeTitle(t), mode);
    });
    var tone = { dark: "a distressing force", fierce: "a fierce, outward force", light: "a benign force" }[a.tone];
    return head("Archetype · " + tone, a.name, a.color) +
      "<h4>What it stands for</h4><p>" + esc(a.stands) + "</p>" +
      "<h4>In the simulation</h4><p>" + esc(a.inSim) + "</p>" +
      "<p><b>In town:</b> " + esc(VERBS[a.verb]) + (a.universal ? " <b>Everyone carries one.</b>" : "") + "</p>" +
      "<h4>Named weather</h4>" + list(weather) +
      "<h4>Inner currents</h4>" + list(feeds.concat(fedBy)) +
      "<h4>Effect on others</h4>" + list(aura) +
      "<h4>Charged by</h4><p>" + (events.join(", ") || '<span class="muted">Nothing directly; it charges through its links and its own breath.</span>') + "</p>" +
      "<h4>Kept close by</h4>" + list(types);
  }

  function typeEntry(t, mode) {
    var st = PT.ENNEAGRAM[t.stress - 1], gr = PT.ENNEAGRAM[t.growth - 1];
    var ev = t.vulnerable.map(function (id) {
      var e = PT.EVENTS.concat([PT.BREAKIN]).filter(function (x) { return x.id === id; })[0];
      return e ? esc(e.label) : id;
    });
    return head("Enneagram type · shapes the ego", typeTitle(t), PT.EGO.color) +
      "<p><b>Core desire:</b> " + esc(t.desire) + ".<br><b>Core fear:</b> " + esc(t.fear) + ".</p>" +
      "<h4>In the simulation</h4><p>" + esc(t.inSim) + "</p>" +
      "<p><b>Baseline hold:</b> " + Math.round(t.hold * 100) + "%. <b>Cuts deepest:</b> " + ev.join(", ") + " (×1.5).</p>" +
      "<h4>Planets kept close</h4>" + list(t.close.map(function (id) { return archLink(id, mode); })) +
      "<h4>Under stress</h4><p>Leans toward " + link("type-" + st.n, typeTitle(st), mode) +
      ". When the ego's hold drops low or something dark rules, that type's sore spots start to hurt too (×1.25).</p>" +
      "<h4>At ease</h4><p>Leans toward " + link("type-" + gr.n, typeTitle(gr), mode) +
      ". After a long calm stretch with low fatigue, the ego's hold gets a little firmer.</p>" +
      '<p class="muted">The Enneagram is a personality map, not a validated science. Here it\'s used as a way to give each ego a distinct shape.</p>';
  }

  function weatherEntry(w, mode) {
    var asp = PT.ASPECT_BY_ID[w.aspect];
    return head("Weather · " + asp.name + " " + asp.glyph, w.name, asp.color) +
      "<p>" + archLink(w.a, mode) + " " + asp.glyph + " " + archLink(w.b, mode) + "</p>" +
      "<h4>What it feels like</h4><p>" + esc(w.blurb) + "</p>" +
      "<p class=\"muted\">Only forms when both archetypes are in the person's chart, the angle is right, and at least one of them carries real weight. See " +
      link("aspect-" + w.aspect, asp.name, mode) + ".</p>";
  }

  function aspectEntry(a, mode) {
    var named = PT.WEATHER.filter(function (w) { return w.aspect === a.id; }).map(function (w) {
      return link("weather-" + w.id, w.name, mode) + " (" + esc(PT.ARCH[w.a].name) + " & " + esc(PT.ARCH[w.b].name) + ")";
    });
    return head("Aspect · " + a.angle + "° ± " + a.orb + "°", a.name + " " + a.glyph, a.color) +
      "<p>" + esc(a.blurb) + "</p>" +
      "<h4>Named weather of this kind</h4>" + list(named) +
      "<p class=\"muted\">Any other pair in this aspect gets the generic effect above. See " + link("concept-aspects", "Aspects and weather", mode) + ".</p>";
  }

  function conceptEntry(c, mode) {
    var related = {
      ego: ["concept-shield", "concept-pull", "type-1"],
      shield: ["concept-ego", "concept-pull"],
      pull: ["concept-ego", "concept-aspects"],
      aspects: ["aspect-conjunction", "aspect-square", "aspect-trine", "aspect-opposition"],
      chart: ["arch-shadow", "concept-ego"],
    }[c.id] || [];
    return head("Concept", c.name, c.id === "shield" ? "var(--shield)" : c.id === "ego" ? PT.EGO.color : null) +
      "<p>" + esc(c.stands) + "</p><h4>In the simulation</h4><p>" + esc(c.inSim) + "</p>" +
      (related.length ? "<h4>See also</h4>" + list(related.map(function (k) { return link(k, titleOf(k), mode); })) : "");
  }

  // key -> { title, group, color, render(mode) }
  var ENTRIES = {}, ORDER = [];
  function add(key, group, title, color, render) {
    ENTRIES[key] = { key: key, group: group, title: title, color: color, render: render };
    ORDER.push(key);
  }
  PT.CONCEPTS.forEach(function (c) { add("concept-" + c.id, "Concepts", c.name, null, function (m) { return conceptEntry(c, m); }); });
  PT.ARCHETYPES.forEach(function (a) { add("arch-" + a.id, "Archetypes", a.name, a.color, function (m) { return archEntry(a, m); }); });
  PT.ENNEAGRAM.forEach(function (t) { add("type-" + t.n, "Enneagram", t.n + " · " + t.name, PT.EGO.color, function (m) { return typeEntry(t, m); }); });
  PT.WEATHER.forEach(function (w) { add("weather-" + w.id, "Weather", w.name, PT.ASPECT_BY_ID[w.aspect].color, function (m) { return weatherEntry(w, m); }); });
  PT.ASPECTS.forEach(function (a) { add("aspect-" + a.id, "Aspects", a.name + " " + a.glyph, a.color, function (m) { return aspectEntry(a, m); }); });

  function titleOf(key) { return ENTRIES[key] ? ENTRIES[key].title : key; }
  function render(key, mode) {
    var e = ENTRIES[key];
    return e ? '<article class="entry">' + e.render(mode) + "</article>" : "<p>Not found.</p>";
  }

  // Side drawer with its own back stack. `wikiHref` is the path to wiki.html.
  function Drawer(wikiHref) {
    var el = document.createElement("aside");
    el.className = "drawer";
    el.setAttribute("aria-label", "Wiki");
    el.innerHTML = '<div class="dbar"><button data-act="back" aria-label="Back">←</button>' +
      '<span class="grow"></span><a data-act="full" href="' + wikiHref + '">Open in wiki ↗</a>' +
      '<button data-act="close" aria-label="Close">✕</button></div><div class="dbody"></div>';
    document.body.appendChild(el);
    this.el = el;
    this.body = el.querySelector(".dbody");
    this.stack = [];
    this.wikiHref = wikiHref;
    var self = this;
    el.querySelector('[data-act="close"]').addEventListener("click", function () { self.close(); });
    el.querySelector('[data-act="back"]').addEventListener("click", function () {
      self.stack.pop();
      if (self.stack.length) self.show(self.stack[self.stack.length - 1]); else self.close();
    });
    // Any [data-wiki] link anywhere on the page opens the drawer.
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("[data-wiki]");
      if (!a) return;
      e.preventDefault();
      self.open(a.getAttribute("data-wiki"));
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") self.close(); });
  }
  Drawer.prototype.open = function (key) {
    if (!ENTRIES[key]) return;
    if (this.stack[this.stack.length - 1] !== key) this.stack.push(key);
    this.show(key);
    this.el.classList.add("open");
  };
  Drawer.prototype.show = function (key) {
    this.body.innerHTML = render(key, "drawer");
    this.body.scrollTop = 0;
    this.el.querySelector('[data-act="full"]').href = this.wikiHref + "#" + key;
  };
  Drawer.prototype.close = function () { this.el.classList.remove("open"); this.stack = []; };

  PT.wiki = {
    ENTRIES: ENTRIES,
    ORDER: ORDER,
    render: render,
    titleOf: titleOf,
    link: link,
    archLink: archLink,
    Drawer: Drawer,
    esc: esc,
  };
})();
