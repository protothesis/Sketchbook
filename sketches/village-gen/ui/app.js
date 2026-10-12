// UI wiring: controls ↔ generator, map interaction, inspector, export.
(function () {
  'use strict';
  var VG = window.VillageGen, $ = function (id) { return document.getElementById(id); };
  var canvas = $('map'), renderer = new VG.render.Renderer(canvas), S = null, dirty = true;
  var view = new VG.View(canvas, function () { dirty = true; });

  // --- Controls ---------------------------------------------------------------
  // The Size select sets the population range; the slider moves within it
  // on a log scale, so every class gets the slider's full travel.
  function cls() { return VG.SIZES[VG.classify(params.population)]; }
  function sliderToPop(v, c) {
    // The top of one class is the bottom of the next: stop just short of it.
    var r = c.range, top = c === VG.SIZES[VG.SIZES.length - 1] ? r[1] : r[1] - 1;
    return Math.min(top, Math.round(r[0] * Math.pow(r[1] / r[0], v / 1000)));
  }
  function popToSlider(p, c) { var r = c.range; return Math.round(Math.log(p / r[0]) / Math.log(r[1] / r[0]) * 1000); }
  function randomPop(c) { return sliderToPop(Math.random() * 1000, c); }

  VG.SIZES.forEach(function (s, i) {
    var o = document.createElement('option');
    o.value = i; o.textContent = s.label + ' (' + s.range[0].toLocaleString() + '–' + s.range[1].toLocaleString() + ')';
    $('size').appendChild(o);
  });
  Object.keys(VG.ENVIRONMENTS).forEach(function (k) {
    var o = document.createElement('option');
    o.value = k; o.textContent = VG.ENVIRONMENTS[k].label;
    $('env').appendChild(o);
  });

  // Locks (which settings Random leaves alone) and keeps (which parts of the
  // seed survive New seed and Random). Remembered per browser.
  var SLIDERS = ['planning', 'density', 'farmland', 'woodland'];
  var LOCKABLE = ['size', 'population', 'environment', 'river'].concat(SLIDERS);
  var LAND_HOLDS = ['size', 'environment', 'river'];
  var locks = {}, keeps = { land: false, town: false, names: false };
  try {
    var saved = JSON.parse(localStorage.getItem('village-gen:locks') || '{}');
    if (saved.locks) locks = saved.locks;
    if (saved.keeps) keeps = saved.keeps;
  } catch (e) { /* storage unavailable: start unlocked */ }
  function saveLocks() {
    try { localStorage.setItem('village-gen:locks', JSON.stringify({ locks: locks, keeps: keeps })); } catch (e) { /* ignore */ }
  }
  function held(k) { return !!locks[k] || (keeps.land && LAND_HOLDS.indexOf(k) >= 0); }

  var LOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
    '<path class="shackle" d="M8 11V8a4 4 0 0 1 8 0v3"/><rect x="5" y="11" width="14" height="10" rx="2"/></svg>';
  Array.prototype.forEach.call(document.querySelectorAll('[data-lock]'), function (b) {
    b.innerHTML = LOCK_SVG;
    b.addEventListener('click', function () { locks[b.dataset.lock] = !locks[b.dataset.lock]; saveLocks(); syncLocks(); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-keep]'), function (b) {
    b.addEventListener('click', function () { keeps[b.dataset.keep] = !keeps[b.dataset.keep]; saveLocks(); syncLocks(); });
  });
  function syncLocks() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-lock]'), function (b) {
      var k = b.dataset.lock, byLand = keeps.land && LAND_HOLDS.indexOf(k) >= 0;
      b.setAttribute('aria-pressed', held(k) ? 'true' : 'false');
      b.disabled = byLand;
      b.title = byLand ? 'Held by Keep land' : held(k) ? 'Locked: Random leaves this alone' : 'Unlocked: Random may change this';
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-keep]'), function (b) {
      b.setAttribute('aria-pressed', keeps[b.dataset.keep] ? 'true' : 'false');
    });
    $('reseed').disabled = keeps.land && keeps.town && keeps.names;
  }

  // --- Atlas state -----------------------------------------------------------------
  // `placeId` is the atlas place on screen, or null for a town that isn't in
  // the atlas yet. `linkPlace` is a name and roads carried by a shared link
  // whose place this browser's atlas doesn't know.
  var AT = VG.atlas, atlas = AT.load(), placeId = null, linkPlace = null;
  var pushNext = false, frameNext = false;

  var params = readHash();
  if (!location.hash.slice(1) && atlas && atlas.trail.length) {
    // Pick the journey back up where it was left.
    placeId = atlas.trail[atlas.trail.length - 1];
    params = settingsFrom(AT.optionsFor(atlas, placeId));
  }
  function settingsFrom(o) {
    var p = {};
    for (var k in VG.DEFAULTS) p[k] = o[k] !== undefined ? o[k] : VG.DEFAULTS[k];
    return p;
  }
  function readHash() {
    var p = {}, d = VG.DEFAULTS;
    for (var k in d) p[k] = d[k];
    p.seed = VG.rng.randomSeed();
    var q = new URLSearchParams(location.hash.slice(1));
    var map = { s: 'seed', p: 'population', e: 'environment', r: 'river', pl: 'planning', de: 'density', fa: 'farmland', wo: 'woodland' };
    for (var key in map) if (q.has(key)) p[map[key]] = key === 's' || key === 'e' || key === 'r' ? q.get(key) : +q.get(key);
    placeId = null; linkPlace = null;
    var n = q.get('n'), id = q.get('id');
    if (n) {
      var known = atlas && (id && atlas.places[id] || AT.placeByName(atlas, n));
      if (known) placeId = known.id;
      else linkPlace = { name: n, roads: parseRoads(q.get('rd')) };
    }
    return p;
  }
  function parseRoads(str) {
    return (str || '').split(',').filter(Boolean).map(function (r) {
      var i = r.lastIndexOf('~');
      return { destination: r.slice(0, i), bearing: +r.slice(i + 1) };
    }).filter(function (r) { return r.destination && isFinite(r.bearing); });
  }
  /** The name and roads this town is held to: from the atlas, or from the link. */
  function constraints() {
    if (placeId && atlas && atlas.places[placeId]) return { name: atlas.places[placeId].name, roads: AT.roadsFor(atlas, placeId) };
    return linkPlace;
  }
  function writeHash() {
    var q = 's=' + encodeURIComponent(params.seed).replace(/%2F/g, '/') + '&p=' + params.population + '&e=' + params.environment +
      '&r=' + params.river + '&pl=' + params.planning + '&de=' + params.density + '&fa=' + params.farmland + '&wo=' + params.woodland;
    var c = constraints();
    if (c) {
      q += '&n=' + encodeURIComponent(c.name);
      if (placeId && placeId !== AT.idFor(c.name)) q += '&id=' + placeId;
      if (c.roads.length) q += '&rd=' + c.roads.map(function (r) { return encodeURIComponent(r.destination) + '~' + r.bearing; }).join(',');
    }
    var push = pushNext;
    pushNext = false;
    try { history[push ? 'pushState' : 'replaceState'](null, '', '#' + q); } catch (e) { location.hash = q; }
  }
  function syncControls() {
    var c = cls();
    $('seed').value = params.seed;
    $('size').value = VG.classify(params.population);
    $('pop').value = popToSlider(params.population, c);
    $('popv').textContent = params.population.toLocaleString();
    $('popmin').textContent = c.range[0].toLocaleString();
    $('popmax').textContent = c.range[1].toLocaleString();
    $('env').value = params.environment;
    $('river').value = params.river;
    SLIDERS.forEach(function (k) { $(k).value = params[k]; });
  }

  var timer = null;
  function regenSoon(delay) {
    clearTimeout(timer);
    $('busy').classList.add('on');
    timer = setTimeout(regen, delay === undefined ? 180 : delay);
  }

  /** Fresh seed parts for everything that isn't kept. */
  function rerollSeed() {
    var sd = VG.parseSeed(params.seed), fresh = VG.rng.randomSeed();
    ['land', 'town', 'names'].forEach(function (k) { if (!keeps[k]) sd[k] = fresh; });
    params.seed = VG.formatSeed(sd);
  }
  /** Random and New seed make a new town: step off the atlas place. */
  function leavePlace() { placeId = null; linkPlace = null; }
  function reseed() {
    if (keeps.land && keeps.town && keeps.names) return;
    leavePlace(); rerollSeed(); syncControls(); regenSoon(0);
  }
  /** Random settlement: reroll the seed and every unlocked setting. */
  function randomize() {
    leavePlace(); rerollSeed();
    var r = Math.random, c = cls();
    if (!held('size') && !locks.population) {
      c = VG.SIZES[pickWeighted([0.2, 0.4, 0.26, 0.14])];
    }
    if (!locks.population) params.population = randomPop(c);
    if (!held('environment')) params.environment = pick(Object.keys(VG.ENVIRONMENTS));
    if (!held('river')) params.river = r() < 0.7 ? 'auto' : r() < 0.5 ? 'yes' : 'no';
    if (!locks.planning) params.planning = round2(Math.pow(r(), 1.7));
    if (!locks.density) params.density = round2(0.1 + r() * 0.85);
    if (!locks.farmland) params.farmland = round2(0.15 + r() * 0.85);
    if (!locks.woodland) params.woodland = round2(0.1 + r() * 0.85);
    syncControls(); regenSoon(0);
  }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function pickWeighted(w) {
    var x = Math.random() * w.reduce(function (a, b) { return a + b; }, 0);
    for (var i = 0; i < w.length; i++) { x -= w[i]; if (x <= 0) return i; }
    return w.length - 1;
  }
  function round2(x) { return Math.round(x * 20) / 20; }

  $('random').addEventListener('click', randomize);
  $('reseed').addEventListener('click', reseed);
  $('seed').addEventListener('change', function () {
    params.seed = VG.formatSeed(VG.parseSeed(this.value.trim() || VG.rng.randomSeed()));
    syncControls(); regenSoon(0);
  });
  $('size').addEventListener('change', function () {
    params.population = VG.SIZES[+this.value].def;
    syncControls(); regenSoon(0);
  });
  $('pop').addEventListener('input', function () {
    params.population = sliderToPop(+this.value, cls());
    $('popv').textContent = params.population.toLocaleString();
    regenSoon(params.population > 3000 ? 450 : 220);
  });
  $('env').addEventListener('change', function () { params.environment = this.value; regenSoon(0); });
  $('river').addEventListener('change', function () { params.river = this.value; regenSoon(0); });
  SLIDERS.forEach(function (k) {
    $(k).addEventListener('input', function () { params[k] = +this.value; regenSoon(); });
  });

  /** Same land ⇒ same site, so the camera can stay exactly where it is. */
  function landSignature(p) {
    return [VG.parseSeed(p.seed).land, p.environment, p.river, VG.classify(p.population)].join('|');
  }

  function regen() {
    var keepView = !frameNext && S && landSignature(S.params) === landSignature(params);
    var selKey = !frameNext && renderer.selected && renderer.selected.kind === 'building' ? renderer.selected.item.key : null;
    frameNext = false;
    var opts = {}, c = constraints(), k;
    for (k in params) opts[k] = params[k];
    if (c) { opts.name = c.name; opts.roads = c.roads; }
    var t0 = performance.now();
    S = VG.generate(opts);
    var ms = Math.round(performance.now() - t0);
    renderer.setSettlement(S, VG.ENVIRONMENTS[params.environment].palette);
    renderer.history = 1;
    $('hist').value = 1000;
    stopPlay();
    view.minScale = Math.min(view.w, view.h) / (S.bounds.size * 1.15);
    if (!keepView) frameTown(false);
    closeInspector();
    // Buildings keep their identity across tweaks: follow the selected one.
    if (selKey) {
      var again = S.buildings.filter(function (b) { return b.key === selKey; })[0];
      if (again) inspect({ kind: 'building', item: again });
    }
    describe();
    updatePlace();
    writeHash();
    $('status').textContent = S.stats.buildings.toLocaleString() + ' buildings · ' + ms + ' ms';
    $('busy').classList.remove('on');
    dirty = true;
    window.settlement = S; // handy from the console
    window.villageView = view;
    window.villageRenderer = renderer;
  }

  function frameTown(animate) {
    view.fit(S.center.x, S.center.y, Math.max(260, S.radius * 3.2), animate);
  }

  // --- Overview ---------------------------------------------------------------
  function describe() {
    var st = S.stats;
    $('sname').textContent = S.name;
    $('ssub').textContent = S.size.label + ' · ' + S.environment.label + ' · founded ' + S.founded.year + ' at ' + S.founded.reason;
    $('tiles').innerHTML = [
      [st.population.toLocaleString(), 'people'], [st.households.toLocaleString(), 'households'],
      [st.buildings.toLocaleString(), 'buildings'], [st.densityPerHa, 'people / ha']
    ].map(function (t) { return '<div><b>' + t[0] + '</b><span>' + t[1] + '</span></div>'; }).join('');
    var roads = 0;
    for (var k in st.roadsKm) roads += st.roadsKm[k];
    $('sline').textContent = (Math.round(roads * 10) / 10) + ' km of roads and tracks · ' + st.fieldsHa + ' ha of fields · ' +
      st.trees.toLocaleString() + ' trees · ' + st.workers.toLocaleString() + ' jobs';

    var cats = {}, T = VG.BUILDING_TYPES;
    S.buildings.forEach(function (b) {
      var c = cats[b.category] || (cats[b.category] = { n: 0, types: {} });
      c.n++; c.types[b.type] = (c.types[b.type] || 0) + 1;
    });
    $('legend').innerHTML = Object.keys(VG.render.CAT_COLORS).filter(function (c) { return cats[c]; }).map(function (c) {
      var types = Object.keys(cats[c].types).sort(function (a, b) { return cats[c].types[b] - cats[c].types[a]; })
        .map(function (t) { return T[t].label.toLowerCase() + (cats[c].types[t] > 1 ? ' ×' + cats[c].types[t] : ''); }).join(', ');
      return '<li data-cat="' + c + '"><span class="sw" style="background:' + VG.render.CAT_COLORS[c] + '"></span><span>' +
        VG.render.CAT_LABELS[c] + '<span class="types">' + types + '</span></span><span class="n">' + cats[c].n + '</span></li>';
    }).join('');
    updateYear();
  }

  $('legend').addEventListener('mouseover', function (e) {
    var li = e.target.closest('li');
    renderer.highlightCat = li ? li.dataset.cat : null; dirty = true;
  });
  $('legend').addEventListener('mouseleave', function () { renderer.highlightCat = null; dirty = true; });

  // --- Growth timeline --------------------------------------------------------------
  var playing = null;
  function updateYear() {
    var t = renderer.history, yr = Math.round(S.founded.year + (S.presentYear - S.founded.year) * Math.pow(t, 1.25));
    $('year').textContent = t >= 1 ? S.presentYear + ' (now)' : yr;
  }
  $('hist').addEventListener('input', function () {
    stopPlay();
    renderer.history = +this.value / 1000; updateYear(); dirty = true;
  });
  $('play').addEventListener('click', function () {
    if (playing) { stopPlay(); return; }
    var start = renderer.history >= 1 ? 0 : renderer.history, t0 = performance.now(), dur = 9000 * (1 - start);
    $('play').textContent = '❚❚ Pause';
    function step(now) {
      var t = Math.min(1, start + (now - t0) / 9000);
      renderer.history = t; $('hist').value = Math.round(t * 1000); updateYear(); dirty = true;
      if (t < 1 && playing) playing = requestAnimationFrame(step); else stopPlay();
    }
    playing = requestAnimationFrame(step);
    if (dur <= 0) stopPlay();
  });
  function stopPlay() { if (playing) cancelAnimationFrame(playing); playing = null; $('play').textContent = '▶ Play'; }

  // --- Picking & inspector ------------------------------------------------------
  function pickAt(w) {
    var hit = VG.pick(S, w[0], w[1]);
    if (hit && hit.item.epoch > renderer.history) hit = null;
    if (!hit || hit.kind === 'field') {
      var road = VG.wayAt(S, w[0], w[1], Math.max(4, 6 / view.scale));
      if (road && road.way.epoch <= renderer.history) return { kind: 'way', item: road.way };
    }
    return hit;
  }

  /** A "to Ashby" label under screen point p, or null. */
  function destAt(p) {
    var hits = renderer.destHits || [];
    for (var i = 0; i < hits.length; i++) {
      var h = hits[i];
      if (p[0] >= h.x0 && p[0] <= h.x1 && p[1] >= h.y0 && p[1] <= h.y1) return h.way;
    }
    return null;
  }
  function toScreen(w) { return [(w[0] - view.cx) * view.scale + view.w / 2, (w[1] - view.cy) * view.scale + view.h / 2]; }

  view.onHover = function (w, p) {
    var tip = $('tip');
    if (!w || !S) { tip.style.display = 'none'; renderer.hover = null; renderer.hoverDest = null; canvas.classList.remove('pointing'); dirty = true; return; }
    var dw = destAt(p);
    if (dw !== renderer.hoverDest) { renderer.hoverDest = dw; dirty = true; }
    if (dw) {
      renderer.hover = null;
      canvas.classList.add('pointing');
      tip.textContent = 'Travel to ' + dw.destination + (known(dw.destination) ? ' (in your atlas)' : '');
      tip.style.left = p[0] + 'px'; tip.style.top = p[1] + 'px'; tip.style.display = 'block';
      return;
    }
    var hit = pickAt(w);
    renderer.hover = hit && hit.kind === 'building' ? hit : null;
    canvas.classList.toggle('pointing', !!hit);
    if (hit) {
      tip.textContent = title(hit);
      tip.style.left = p[0] + 'px'; tip.style.top = p[1] + 'px'; tip.style.display = 'block';
    } else tip.style.display = 'none';
    dirty = true;
  };
  view.onTap = function (w) {
    if (!S) return;
    var dw = destAt(toScreen(w));
    if (dw) { travelVia(dw); return; }
    var hit = pickAt(w);
    if (hit) inspect(hit); else closeInspector();
  };

  function title(hit) {
    var it = hit.item;
    if (hit.kind === 'building') return it.name ? it.name + ' · ' + it.label : it.label + (it.family ? ' · ' + it.family : '');
    if (hit.kind === 'field') return it.label + ' · ' + it.hectares + ' ha';
    return (it.name || VG.ROAD_KINDS[it.kind].label) + (it.destination ? ' → ' + it.destination : '');
  }

  var CAT_PILL = VG.render.CAT_COLORS;
  function inspect(hit) {
    renderer.selected = hit; dirty = true;
    var it = hit.item, rows = [], ways = S.network.ways;
    $('inspector').hidden = false;
    $('iname').textContent = hit.kind === 'building' ? (it.name || (it.family ? 'The ' + it.family + ' ' + it.label.toLowerCase() : it.label)) : title(hit);
    var pill = $('ipill');
    if (hit.kind === 'building') {
      pill.textContent = it.label; pill.style.background = CAT_PILL[it.category];
      rows.push(['Category', VG.render.CAT_LABELS[it.category]]);
      if (it.trade) rows.push(['Trade', it.trade]);
      if (it.family) rows.push(['Household', it.family + (it.households > 1 ? ' + ' + (it.households - 1) + ' more' : '')]);
      rows.push(['Footprint', it.width + ' × ' + it.depth + ' m (' + it.area + ' m²)']);
      rows.push(['Floors', it.floors + (it.upperFloors ? ' · upstairs: ' + it.upperFloors.toLowerCase() : '')]);
      rows.push(['Floor area', it.floorArea.toLocaleString() + ' m²']);
      rows.push(['Residents', it.residents + (it.households ? ' in ' + it.households + ' household' + (it.households > 1 ? 's' : '') : '')]);
      if (it.workers) rows.push(['Workers', it.workers]);
      rows.push(['Capacity', it.capacity + ' people at once']);
      if (it.beds) rows.push(['Guest beds', it.beds]);
      if (it.storage) rows.push(['Storage', it.storage.toLocaleString() + ' m³']);
      rows.push(['Built', it.built + ' (' + (S.presentYear - it.built) + ' years ago)']);
      rows.push(['Fronts', ways[it.wayId] ? ways[it.wayId].name || VG.ROAD_KINDS[ways[it.wayId].kind].label : '—']);
      rows.push(['Elevation', it.elevation + ' m']);
      if (it.tags.length) rows.push(['Tags', it.tags.join(', ')]);
      rows.push(['Rooms', it.rooms.map(function (r) { return r.name; }).join(', ')]);
    } else if (hit.kind === 'field') {
      pill.textContent = 'Field'; pill.style.background = '#8aa76a';
      rows.push(['Crop', it.label], ['Size', it.width + ' × ' + it.length + ' m'], ['Area', it.hectares + ' ha'], ['Furlong', '#' + it.furlong]);
    } else {
      pill.textContent = VG.ROAD_KINDS[it.kind].label; pill.style.background = '#9a8a72';
      rows.push(['Length', it.length.toLocaleString() + ' m']);
      if (it.destination) rows.push(['Leads to', it.destination + (known(it.destination) ? ' (in your atlas)' : '')]);
      var n = S.buildings.filter(function (b) { return b.wayId === it.id; }).length;
      rows.push(['Buildings', n]);
    }
    $('iprops').innerHTML = rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + esc(String(r[1])) + '</td></tr>'; }).join('');
    $('iroute').hidden = hit.kind !== 'building';
    var dest = hit.kind === 'way' && it.destination;
    $('itravel').hidden = !dest;
    if (dest) $('itravel').textContent = 'Travel to ' + it.destination + ' →';
    drawPlan(hit.kind === 'building' ? it : null);
  }
  function esc(s) { return s.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  function closeInspector() {
    $('inspector').hidden = true;
    renderer.selected = null; dirty = true;
  }
  $('iclose').addEventListener('click', closeInspector);
  $('itravel').addEventListener('click', function () {
    if (renderer.selected && renderer.selected.kind === 'way') travelVia(renderer.selected.item);
  });
  $('izoom').addEventListener('click', function () {
    var it = renderer.selected && renderer.selected.item;
    if (!it) return;
    if (renderer.selected.kind === 'way') {
      var N = S.network.nodes, a = N[it.nodes[0]], b = N[it.nodes[it.nodes.length - 1]];
      view.fit((a.x + b.x) / 2, (a.y + b.y) / 2, Math.max(80, Math.hypot(a.x - b.x, a.y - b.y) * 1.3), true);
    } else view.fit(it.x, it.y, Math.max(it.width || it.length, it.depth || it.width) * 2.4 + 10, true);
  });
  $('iroute').addEventListener('click', function () {
    var sel = renderer.selected;
    if (!sel || sel.kind !== 'building') return;
    var path = VG.findPath(S, sel.item.entrance.node, 0);
    sel.path = path;
    if (path) {
      var mins = Math.max(1, Math.round(path.length / 1.3 / 60));
      $('iprops').insertAdjacentHTML('beforeend', '<tr><td>Walk to centre</td><td>' + path.length + ' m · ~' + mins + ' min</td></tr>');
    }
    dirty = true;
  });
  $('icopy').addEventListener('click', function () {
    var sel = renderer.selected;
    if (!sel) return;
    var clean = JSON.parse(JSON.stringify(sel.item, function (k, v) { return k.charAt(0) === '_' ? undefined : v; }));
    copy(JSON.stringify(clean, null, 2), this);
  });

  function drawPlan(b) {
    var cv = $('plan');
    cv.hidden = !b;
    if (!b) return;
    var r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    cv.width = r.width * dpr; cv.height = r.height * dpr;
    var ctx = cv.getContext('2d'), pad = 18, W = r.width, H = r.height;
    var k = Math.min((W - pad * 2) / b.width, (H - pad * 2 - 10) / b.depth);
    var ox = (W - b.width * k) / 2, oy = (H - 10 - b.depth * k) / 2;
    var css = getComputedStyle(document.documentElement);
    var ink = css.getPropertyValue('--text').trim(), muted = css.getPropertyValue('--text-muted').trim();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // Front wall (y = 0, facing the road) is drawn at the bottom.
    function P(x, y) { return [ox + x * k, oy + (b.depth - y) * k]; }
    ctx.lineWidth = 1; ctx.strokeStyle = muted; ctx.fillStyle = muted;
    ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    b.rooms.forEach(function (rm) {
      var a = P(rm.x, rm.y + rm.d), c = P(rm.x + rm.w, rm.y);
      ctx.strokeRect(a[0], a[1], c[0] - a[0], c[1] - a[1]);
      var lab = rm.name + ' · ' + rm.area + ' m²';
      var tw = ctx.measureText(lab).width, show = tw < c[0] - a[0] - 4 ? lab : ctx.measureText(rm.name).width < c[0] - a[0] - 4 ? rm.name : '';
      ctx.fillStyle = ink;
      ctx.fillText(show, (a[0] + c[0]) / 2, (a[1] + c[1]) / 2);
    });
    var t0 = P(0, b.depth), t1 = P(b.width, 0);
    ctx.lineWidth = 2.5; ctx.strokeStyle = ink;
    ctx.strokeRect(t0[0], t0[1], t1[0] - t0[0], t1[1] - t0[1]);
    // Door: project the entrance onto the frontage.
    var tx = Math.cos(b.angle), ty = Math.sin(b.angle);
    var u = (b.entrance.x - b.x) * tx + (b.entrance.y - b.y) * ty + b.width / 2, d = P(u, 0);
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
    ctx.fillRect(d[0] - 0.6 * k, d[1] - 2, 1.2 * k, 4);
    ctx.fillStyle = muted;
    ctx.fillText('road ↓  · ' + b.width + ' m frontage', W / 2, H - 8);
  }

  // --- Map buttons, layers, keys -----------------------------------------------------
  $('zin').addEventListener('click', function () { view.zoomAt(1.6, view.w / 2, view.h / 2); });
  $('zout').addEventListener('click', function () { view.zoomAt(1 / 1.6, view.w / 2, view.h / 2); });
  $('ztown').addEventListener('click', function () { frameTown(true); });
  $('zmap').addEventListener('click', function () { view.fit(0, 0, S.bounds.size * 1.02, true); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-layer]'), function (el) {
    el.addEventListener('change', function () { renderer.layers[el.dataset.layer] = el.checked; dirty = true; });
  });
  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' && e.target.type === 'text') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key, pan = 80 / view.scale;
    if (k === 'r' || k === 'R') randomize();
    else if (k === 'n' || k === 'N') reseed();
    else if (k === 'b' || k === 'B') goBack();
    else if (k === '+' || k === '=') view.zoomAt(1.4, view.w / 2, view.h / 2);
    else if (k === '-' || k === '_') view.zoomAt(1 / 1.4, view.w / 2, view.h / 2);
    else if (k === 'ArrowLeft') { view.cx -= pan; dirty = true; }
    else if (k === 'ArrowRight') { view.cx += pan; dirty = true; }
    else if (k === 'ArrowUp') { view.cy -= pan; dirty = true; }
    else if (k === 'ArrowDown') { view.cy += pan; dirty = true; }
    else if (k === 'Escape') { if (!$('amapover').hidden) closeAtlasMap(); else closeInspector(); }
    else if (k === 'm' || k === 'M') { if ($('amapover').hidden) $('amapbig').click(); else closeAtlasMap(); }
    else return;
    if (k.indexOf('Arrow') === 0) e.preventDefault();
  });

  // --- Export ---------------------------------------------------------------------
  $('dl').addEventListener('click', function () {
    var full = $('dlfull').checked;
    var json = JSON.stringify(VG.toJSON(S, { terrain: full, trees: full }), function (k, v) { return k.charAt(0) === '_' ? undefined : v; });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = S.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + S.seed + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });
  $('link').addEventListener('click', function () { copy(location.href, this); });
  function copy(text, btn) {
    var done = function () { var t = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = t; }, 1200); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    else fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
      ta.remove();
    }
  }

  // --- Atlas: travel, back, lock --------------------------------------------------
  function known(name) { return !!(atlas && AT.placeByName(atlas, name)); }
  renderer.isKnown = known;
  function saveAtlas() { AT.save(atlas); }
  function ensureAtlas() { if (!atlas) atlas = AT.create(VG.parseSeed(params.seed).land); }
  function sizeLabel(pop) { return VG.SIZES[VG.classify(pop)].label; }

  /** Show atlas place `id` with its saved (locked) or discovered settings. */
  function go(id) {
    if (!atlas || !atlas.places[id]) return;
    placeId = id; linkPlace = null;
    params = settingsFrom(AT.optionsFor(atlas, id));
    AT.visit(atlas, id); saveAtlas();
    closeInspector();
    pushNext = true; frameNext = true;
    syncControls(); regenSoon(0);
  }

  /** Follow a road off the map edge to the town it leads to. */
  function travelVia(way) {
    if (!way || !way.destination || !S) return;
    ensureAtlas();
    var res = AT.travel(atlas, placeId, S, params, way);
    if (!placeId) { placeId = res.from; writeHash(); } // the start of a journey: this page is now a place
    AT.visit(atlas, res.from);
    go(res.to);
  }

  function backTarget() {
    if (!atlas) return null;
    var t = atlas.trail, i = t.length - 1;
    if (placeId && t[i] === placeId) i--;
    return i >= 0 && atlas.places[t[i]] ? t[i] : null;
  }
  function goBack() {
    var id = backTarget();
    if (!id) return;
    if (placeId && atlas.trail[atlas.trail.length - 1] === placeId) atlas.trail.pop();
    go(id);
  }
  $('back').addEventListener('click', goBack);

  $('placelock').addEventListener('click', function () {
    if (!S) return;
    ensureAtlas();
    var p = placeId && atlas.places[placeId];
    if (!p) {
      // Lock a town that isn't in the atlas yet: it becomes a place.
      p = AT.addPlace(atlas, S.name, params, null, true);
      placeId = p.id; linkPlace = null;
      AT.visit(atlas, p.id);
      AT.lock(atlas, p.id, params);
    } else if (p.locked) AT.unlock(atlas, p.id);
    else AT.lock(atlas, p.id, params);
    saveAtlas(); writeHash(); updatePlace();
  });
  $('placesave').addEventListener('click', function () {
    if (placeId) { AT.lock(atlas, placeId, params); saveAtlas(); updatePlace(); }
  });
  $('placerevert').addEventListener('click', function () {
    var p = placeId && atlas.places[placeId];
    if (!p || !p.settings) return;
    params = settingsFrom(p.settings);
    syncControls(); regenSoon(0);
  });

  /** The journey bar, the note under the name and the atlas list. */
  function updatePlace() {
    var p = placeId && atlas && atlas.places[placeId], notes = [];
    var back = backTarget();
    $('back').hidden = !back;
    if (back) $('back').textContent = '← ' + atlas.places[back].name;
    var lockBtn = $('placelock'), changed = p && !AT.sameSettings(params, p.locked ? p.settings : p.base);
    lockBtn.setAttribute('aria-pressed', p && p.locked ? 'true' : 'false');
    lockBtn.textContent = p && p.locked ? 'Locked' : 'Lock place';
    lockBtn.title = p && p.locked ? 'Locked: revisits use the saved settings. Click to unlock.' :
      'Keep this place’s current settings in the atlas, so revisits look exactly like this';
    $('placesave').hidden = $('placerevert').hidden = !(p && p.locked && changed);
    if (!p) {
      notes.push(linkPlace ? 'Opened from a link; not in your atlas.' :
        'Not in the atlas yet. Click a “to …” road label at the map’s edge to travel; this town becomes the start of the journey.');
    } else {
      if (p.from && atlas.places[p.from]) notes.push('First reached from ' + atlas.places[p.from].name + '.');
      if (p.locked && changed) notes.push('Changed since it was locked.');
      else if (changed) notes.push('Unlocked, so these changes are forgotten when you leave. Lock to keep them.');
      if (p.locked && p.generator !== VG.GENERATOR_VERSION) notes.push('Locked with generator v' + p.generator + '; this is v' + VG.GENERATOR_VERSION + ', so it may look different.');
    }
    $('placenote').textContent = notes.join(' ');

    drawAtlasMaps();
    if (!atlas || !Object.keys(atlas.places).length) {
      $('atlasline').textContent = 'Empty. Travel along a road or lock a place to start one. Saved in this browser; export it to keep it safe.';
      $('places').innerHTML = '';
    } else {
      var ids = Object.keys(atlas.places), nRoads = atlas.links.length / 2;
      $('atlasline').textContent = ids.length + ' place' + (ids.length > 1 ? 's' : '') + ' · ' + nRoads + ' road' + (nRoads === 1 ? '' : 's') +
        ' · world seed ' + atlas.world + '. Saved in this browser; export it to keep it safe.';
      $('places').innerHTML = ids.sort(function (a, b) { return atlas.places[a].name.localeCompare(atlas.places[b].name); }).map(function (id) {
        var q = atlas.places[id], st = q.locked ? q.settings : q.base;
        var to = AT.linksFrom(atlas, id).map(function (l) { return atlas.places[l.to].name; });
        return '<li data-place="' + esc(id) + '"' + (id === placeId ? ' class="here"' : '') + '><span>' + (q.locked ? '🔒 ' : '') + esc(q.name) +
          (to.length ? ' <span class="via">→ ' + esc(to.join(', ')) + '</span>' : '') + '</span><span class="n">' + sizeLabel(st.population) + '</span></li>';
      }).join('');
    }
    dirty = true;
  }
  // The atlas as a subway map, in the panel and (bigger) over the map.
  function pickOnMap(kind, item) {
    if (kind === 'place') { if (item !== placeId) { closeAtlasMap(); go(item); } }
    else if (kind === 'road') { closeAtlasMap(); travelVia(item.way); }
  }
  var amap = new VG.AtlasMap($('amap'), pickOnMap), amap2 = new VG.AtlasMap($('amap2'), pickOnMap);
  function drawAtlasMaps() {
    // Roads out of here that don't lead anywhere in the atlas yet.
    var stubs = !S || !placeId ? [] : S.network.ways.filter(function (w) { return w.destination && w.rim && !known(w.destination); })
      .map(function (w) { return { destination: w.destination, bearing: w.bearing, way: w }; });
    amap.set(atlas, placeId, stubs);
    if (!$('amapover').hidden) amap2.set(atlas, placeId, stubs);
    var used = {};
    if (atlas) Object.keys(atlas.places).forEach(function (id) { var p = atlas.places[id]; used[(p.locked && p.settings ? p.settings : p.base).environment] = 1; });
    var journeys = amap.L ? amap.L.journeys : 0;
    $('amapkey').innerHTML = Object.keys(VG.ENV_COLORS).filter(function (e) { return used[e]; }).map(function (e) {
      return '<span><i style="background:' + VG.ENV_COLORS[e] + '"></i>' + esc(VG.ENVIRONMENTS[e].label) + '</span>';
    }).join('') + (journeys > 1 ? '<span>· ' + journeys + ' separate journeys</span>' : '');
  }
  function closeAtlasMap() { $('amapover').hidden = true; }
  $('amapbig').addEventListener('click', function () {
    $('amapover').hidden = false;
    amap2.view = null;
    drawAtlasMaps();
  });
  $('amapclose').addEventListener('click', closeAtlasMap);
  window.addEventListener('resize', function () { amap.draw(); if (!$('amapover').hidden) amap2.draw(); });

  $('places').addEventListener('click', function (e) {
    var li = e.target.closest('li');
    if (li && li.dataset.place !== placeId) go(li.dataset.place);
  });

  function atlasMsg(t) {
    $('atlasmsg').textContent = t;
    if (t) setTimeout(function () { if ($('atlasmsg').textContent === t) $('atlasmsg').textContent = ''; }, 6000);
  }
  $('atlasexport').addEventListener('click', function () {
    if (!atlas) { atlasMsg('Nothing to export yet.'); return; }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([AT.toJSON(atlas)], { type: 'application/json' }));
    a.download = 'village-atlas-' + atlas.world.replace(/[^a-z0-9]+/gi, '-') + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });
  $('atlasimport').addEventListener('click', function () { $('atlasfile').click(); });
  $('atlasfile').addEventListener('change', function () {
    var f = this.files && this.files[0];
    this.value = '';
    if (!f) return;
    var fr = new FileReader();
    fr.onload = function () { importAtlas(String(fr.result)); };
    fr.onerror = function () { atlasMsg('Couldn’t read that file.'); };
    fr.readAsText(f);
  });
  /** Replace the atlas with one from JSON text and go to where it left off. */
  function importAtlas(text) {
    try { atlas = AT.fromJSON(text); } catch (e) { atlasMsg('Not imported: ' + e.message); return false; }
    saveAtlas();
    var n = Object.keys(atlas.places).length;
    atlasMsg('Imported ' + n + ' place' + (n === 1 ? '' : 's') + '.');
    var id = atlas.trail[atlas.trail.length - 1] || Object.keys(atlas.places)[0];
    if (id) go(id); else { leavePlace(); updatePlace(); }
    return true;
  }
  $('atlasclear').addEventListener('click', function () {
    var n = atlas ? Object.keys(atlas.places).length : 0;
    if (n && !window.confirm('Forget all ' + n + ' places in the atlas? Export it first if you want to keep it.')) return;
    AT.clear(); atlas = null; leavePlace(); writeHash(); updatePlace();
  });

  // Browser back/forward walks the same journey.
  window.addEventListener('popstate', function () {
    params = readHash(); closeInspector(); frameNext = true;
    syncControls(); regenSoon(0);
  });
  // Handy from the console.
  window.villageAtlas = {
    get: function () { return atlas; },
    importText: importAtlas,
    travel: function (name) {
      var w = S && S.network.ways.filter(function (x) { return x.destination === name; })[0];
      if (w) travelVia(w);
      return !!w;
    }
  };

  // --- Loop -------------------------------------------------------------------
  function paper() { return getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || '#efe8d8'; }
  var paperColor = paper();
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onScheme = function () { paperColor = paper(); dirty = true; };
    if (mq.addEventListener) mq.addEventListener('change', onScheme);
  }
  function frame() {
    if (dirty) { dirty = false; renderer.draw(view, paperColor); }
    requestAnimationFrame(frame);
  }
  window.addEventListener('resize', function () { view.resize(); });
  view.resize();
  syncControls();
  syncLocks();
  regen();
  requestAnimationFrame(frame);
})();
