// UI wiring: controls ↔ generator, map interaction, inspector, export.
(function () {
  'use strict';
  var VG = window.VillageGen, $ = function (id) { return document.getElementById(id); };
  var canvas = $('map'), renderer = new VG.render.Renderer(canvas), S = null, dirty = true;
  var view = new VG.View(canvas, function () { dirty = true; });

  // --- Controls ---------------------------------------------------------------
  var LOG_MAX = Math.log(VG.MAX_POP / VG.MIN_POP);
  function sliderToPop(v) { return Math.round(VG.MIN_POP * Math.exp((v / 1000) * LOG_MAX)); }
  function popToSlider(p) { return Math.round((Math.log(p / VG.MIN_POP) / LOG_MAX) * 1000); }

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

  var params = readHash();
  function readHash() {
    var p = {}, d = VG.DEFAULTS;
    for (var k in d) p[k] = d[k];
    p.seed = VG.rng.randomSeed();
    var q = new URLSearchParams(location.hash.slice(1));
    var map = { s: 'seed', p: 'population', e: 'environment', r: 'river', pl: 'planning', de: 'density', fa: 'farmland', wo: 'woodland' };
    for (var key in map) if (q.has(key)) p[map[key]] = key === 's' || key === 'e' || key === 'r' ? q.get(key) : +q.get(key);
    return p;
  }
  function writeHash() {
    var q = 's=' + encodeURIComponent(params.seed) + '&p=' + params.population + '&e=' + params.environment +
      '&r=' + params.river + '&pl=' + params.planning + '&de=' + params.density + '&fa=' + params.farmland + '&wo=' + params.woodland;
    try { history.replaceState(null, '', '#' + q); } catch (e) { location.hash = q; }
  }
  function syncControls() {
    $('seed').value = params.seed;
    $('pop').value = popToSlider(params.population);
    $('popv').textContent = params.population.toLocaleString();
    $('size').value = VG.classify(params.population);
    $('env').value = params.environment;
    $('river').value = params.river;
    ['planning', 'density', 'farmland', 'woodland'].forEach(function (k) { $(k).value = params[k]; });
  }

  var timer = null;
  function regenSoon(delay) {
    clearTimeout(timer);
    $('busy').classList.add('on');
    timer = setTimeout(regen, delay === undefined ? 180 : delay);
  }

  $('seed').addEventListener('change', function () { params.seed = this.value.trim() || VG.rng.randomSeed(); regenSoon(0); });
  $('reseed').addEventListener('click', reseed);
  function reseed() { params.seed = VG.rng.randomSeed(); syncControls(); regenSoon(0); }
  $('size').addEventListener('change', function () {
    params.population = VG.SIZES[+this.value].def;
    syncControls(); regenSoon(0);
  });
  $('pop').addEventListener('input', function () {
    params.population = sliderToPop(+this.value);
    $('popv').textContent = params.population.toLocaleString();
    $('size').value = VG.classify(params.population);
    regenSoon(params.population > 3000 ? 450 : 220);
  });
  $('env').addEventListener('change', function () { params.environment = this.value; regenSoon(0); });
  $('river').addEventListener('change', function () { params.river = this.value; regenSoon(0); });
  ['planning', 'density', 'farmland', 'woodland'].forEach(function (k) {
    $(k).addEventListener('input', function () { params[k] = +this.value; regenSoon(); });
  });

  function regen() {
    var keepView = S && S.seed === params.seed && S.params.environment === params.environment && S.params.population === params.population;
    var t0 = performance.now();
    S = VG.generate(params);
    var ms = Math.round(performance.now() - t0);
    renderer.setSettlement(S, VG.ENVIRONMENTS[params.environment].palette);
    renderer.history = 1;
    $('hist').value = 1000;
    stopPlay();
    view.minScale = Math.min(view.w, view.h) / (S.bounds.size * 1.15);
    if (!keepView) frameTown(false);
    closeInspector();
    describe();
    writeHash();
    $('status').textContent = S.stats.buildings.toLocaleString() + ' buildings · ' + ms + ' ms';
    $('busy').classList.remove('on');
    dirty = true;
    window.settlement = S; // handy from the console
    window.villageView = view;
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

  view.onHover = function (w, p) {
    var tip = $('tip');
    if (!w || !S) { tip.style.display = 'none'; renderer.hover = null; canvas.classList.remove('pointing'); dirty = true; return; }
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
      if (it.destination) rows.push(['Leads to', it.destination]);
      var n = S.buildings.filter(function (b) { return b.wayId === it.id; }).length;
      rows.push(['Buildings', n]);
    }
    $('iprops').innerHTML = rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + esc(String(r[1])) + '</td></tr>'; }).join('');
    $('iroute').hidden = hit.kind !== 'building';
    drawPlan(hit.kind === 'building' ? it : null);
  }
  function esc(s) { return s.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  function closeInspector() {
    $('inspector').hidden = true;
    renderer.selected = null; dirty = true;
  }
  $('iclose').addEventListener('click', closeInspector);
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
    if (k === 'r' || k === 'R') reseed();
    else if (k === '+' || k === '=') view.zoomAt(1.4, view.w / 2, view.h / 2);
    else if (k === '-' || k === '_') view.zoomAt(1 / 1.4, view.w / 2, view.h / 2);
    else if (k === 'ArrowLeft') { view.cx -= pan; dirty = true; }
    else if (k === 'ArrowRight') { view.cx += pan; dirty = true; }
    else if (k === 'ArrowUp') { view.cy -= pan; dirty = true; }
    else if (k === 'ArrowDown') { view.cy += pan; dirty = true; }
    else if (k === 'Escape') closeInspector();
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
  regen();
  requestAnimationFrame(frame);
})();
