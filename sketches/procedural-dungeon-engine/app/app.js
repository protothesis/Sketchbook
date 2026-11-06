// Wires the controls, pointer input and inspector to the engine + renderer.
// UI only: every generation decision goes through DungeonEngine's API.
(function (global) {
  'use strict';

  const DE = global.DungeonEngine;
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = 'dungeon-engine:expedition';

  const canvas = $('map');
  const renderer = global.DungeonApp.createRenderer(canvas);

  const state = {
    exp: null,
    candidate: null,
    selectedId: null,
    toggles: { grid: true, labels: false, occupancy: false, path: true },
    // Room contents overlay (renderer.drawContents), by kind.
    show: { creatures: false, push: false, features: false, locks: false, items: false, crates: false, blocks: false },
    // Region layer (regions-view.js): shown or not, coloured by 'type' |
    // 'mood' | 'region', and the selected region (highlighted on the map).
    // `pinned`: regions whose highlight and label stay up (click to pin).
    regions: { show: false, by: 'type', selected: null, pinned: [] },
    // The region under the pointer on the map (regions layer on), or null.
    mapRegion: null,
    // Rooms the last grow added (outlined on the map until the next one).
    grown: null,
    // What a dungeon was grown from, if the map is nothing but that grow
    // ({ seed, rooms, order, route, n }): changing the order or route then
    // grows it again from scratch, so orders can be compared on one seed.
    grownFrom: null,
    // What the pointer is over in the panel, previewed or highlighted on the
    // map: { content: kind } | { region: id } | { type } | { mood } | null.
    hover: null,
  };
  const RV = global.DungeonApp.regions;

  // ---------------------------------------------------------------------------
  // Rendering + panels

  let frameQueued = false;
  function redraw() {
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(() => {
      frameQueued = false;
      renderer.draw(state);
    });
  }

  function setStatus(msg) { $('status').textContent = msg || ''; }

  function refreshPanels() {
    const exp = state.exp;
    const s = DE.stats(exp);
    $('stats').textContent =
      `${s.spaces} spaces · ${s.cells} cells · ${s.connections} connections · ${s.cycles} loops · ${s.openExits} open doors`;

    shapePanel(exp, s);

    const sp = exp.spaces[state.selectedId];
    const dl = $('inspector');
    dl.innerHTML = '';
    const rows = sp ? [
      ['id', sp.id],
      ['seed', sp.seed],
      ['entropy', sp.entropy || '— (root)'],
      ['parent', sp.parentId ? `${sp.parentId} via ${sp.viaExitId}` : '—'],
      ['depth', sp.depth],
      ['archetype', sp.archetype + (sp.deadEnd ? ' (dead end)' : '')],
      ['cells', sp.cells.length],
      ['exits', sp.exits.map((e) => `${e.id}${e.facing}${e.connectionId ? '·' + e.connectionId : '·open'}`).join(' ')],
      ['region', regionText(exp, sp), sp.regionId && { region: sp.regionId }],
      ['structure', exp.regions[sp.regionId] ? `${exp.regions[sp.regionId].type} · ${sp.role}` : '—', exp.regions[sp.regionId] && { type: exp.regions[sp.regionId].type }],
      ['mood', `${sp.meta.mood}, hue ${sp.meta.hue}`, { mood: sp.meta.mood }],
    ] : [['', 'Tap a space to inspect it.']];
    fillRows(dl, rows);
    regionInspector(exp);
    regionsPanel(exp);
    $('revert-btn').disabled = !sp || !DE.canRevert(exp, sp.id) || !!state.candidate;
    $('grow-here-btn').disabled = !sp || !!state.candidate;

    const bar = $('candidate-bar');
    const c = state.candidate;
    bar.hidden = !c;
    if (c) {
      $('candidate-text').textContent = c.type === 'loop'
        ? `Opens into ${c.targetId} — a loop`
        : `${c.space.archetype}${c.space.deadEnd ? ' (dead end)' : ''}, ${c.space.cells.length} cells, ${c.space.exits.length - 1} new door${c.space.exits.length === 2 ? '' : 's'}` +
          (c.region ? ` · a new region: ${c.region.type}, ${c.region.mood}, ${c.region.size} rooms` : ` · ${c.space.role}`);
      $('reroll-btn').disabled = c.type === 'loop';
    }
    redraw();
  }

  /**
   * The dungeon's shape at a glance: rooms at each depth (a bar chart, in
   * buckets when it runs deep), dead ends, the room mix, and what the rooms
   * hold in total (only while the contents overlay is on: it's the slow part).
   */
  function shapePanel(exp, s) {
    const byDepth = [], arch = {};
    let dead = 0;
    for (const id in exp.spaces) {
      const sp = exp.spaces[id];
      byDepth[sp.depth] = (byDepth[sp.depth] || 0) + 1;
      if (sp.deadEnd) dead++;
      else arch[sp.archetype] = (arch[sp.archetype] || 0) + 1;
    }
    const maxDepth = byDepth.length - 1;
    const per = Math.max(1, Math.ceil(byDepth.length / 60));
    const bars = [];
    for (let d = 0; d < byDepth.length; d += per) {
      let n = 0;
      for (let i = d; i < d + per; i++) n += byDepth[i] || 0;
      bars.push({ d, n });
    }
    const top = Math.max(...bars.map((b) => b.n));
    const chart = $('depth-chart');
    chart.innerHTML = '';
    if (s.spaces > 1) {
      for (const b of bars) {
        const el = document.createElement('div');
        el.style.height = Math.max(1, Math.round((b.n / top) * 100)) + '%';
        el.title = `depth ${b.d}${per > 1 ? '–' + (b.d + per - 1) : ''}: ${b.n} room${b.n === 1 ? '' : 's'}`;
        chart.appendChild(el);
      }
    }
    const mix = Object.entries(arch).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}${v === 1 ? '' : 's'}`).join(', ');
    $('shape-stats').textContent = `Rooms by depth, 0–${maxDepth} (deepest ${maxDepth}). ${mix}, ${dead} dead end${dead === 1 ? '' : 's'}. ${s.regions} regions.`;

    const on = Object.values(state.show).some(Boolean);
    const n = on && global.DungeonApp.contentCounts(exp);
    $('contents-stats').textContent = !n ? '' :
      `${n.ghost} ghosts, ${n.pixie} pixies, ${n.creeper} creepers · ${n.push} push blocks · ${n.lock} locked doors · ` +
      `${n.sigil} sigils, ${n.well} wells, ${n.chest} chests, ${n.vessel} vessels, ${n.sconce} sconces · ${n.items} items · ${n.crates} crates, ${n.blocks} static blocks`;
  }

  // ---------------------------------------------------------------------------
  // Regions: the panel's lists and the inspector's region block.

  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  /** A list row: a colour swatch, a label and a count, with data for hovering. */
  function listRow(color, label, count, data) {
    const li = document.createElement('li');
    const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = color;
    const t = document.createElement('span'); t.textContent = label;
    const n = document.createElement('span'); n.className = 'n'; n.textContent = count;
    li.append(sw, t, n);
    for (const k in data) li.dataset[k] = data[k];
    return li;
  }

  /** Region stats, and the lists of types, moods and regions (hover to highlight). */
  function regionsPanel(exp) {
    const sum = RV.summary(exp);
    const { regions } = RV.layout(exp);
    $('region-stats').textContent = sum.count
      ? `${plural(sum.count, 'region')} · ${sum.mean.toFixed(1)} rooms each on average · largest ${sum.max} (${sum.maxId})`
      : '';
    const by = state.regions.by;
    const types = $('region-types'), moods = $('region-moods'), list = $('region-list');
    types.innerHTML = ''; moods.innerHTML = ''; list.innerHTML = '';
    for (const t of Object.keys(sum.types).sort((a, b) => sum.types[b].rooms - sum.types[a].rooms)) {
      const v = sum.types[t];
      types.append(listRow(RV.TYPE_COLORS[t] || '#999', t, `${plural(v.regions, 'region')} · ${plural(v.rooms, 'room')}`, { type: t }));
    }
    for (const m of Object.keys(sum.moods).sort((a, b) => sum.moods[b].rooms - sum.moods[a].rooms)) {
      const v = sum.moods[m];
      moods.append(listRow(RV.MOOD_COLORS[m] || '#999', m, `${plural(v.regions, 'region')} · ${plural(v.rooms, 'room')}`, { mood: m }));
    }
    const ids = Object.keys(regions).sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));
    for (const id of ids) {
      const r = regions[id];
      const li = listRow(RV.colorOf(r.g, by), `${id} ${r.g.type} · ${r.g.mood}`, `${r.spent}/${r.g.size} · ${plural(r.rooms, 'room')}`, { region: id });
      if (id === state.regions.selected || state.regions.pinned.includes(id)) li.classList.add('selected');
      list.append(li);
    }
  }

  /** The selected region's details, under the room's. */
  function regionInspector(exp) {
    const room = exp.spaces[state.selectedId];
    const id = state.regions.selected || (room && room.regionId);
    const g = id && exp.regions[id];
    $('region-inspector-wrap').hidden = !g;
    if (!g) return;
    const r = RV.layout(exp).regions[id];
    const roles = r ? Object.entries(r.roles).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k}`).join(', ') : '—';
    const rows = [
      ['id', g.id + (state.regions.pinned.includes(g.id) ? ' · pinned' : ''), { region: g.id }],
      ['type', g.type, { type: g.type }],
      ['mood', g.mood, { mood: g.mood }],
      ['budget', `${r ? r.spent : 0} of ${g.size} rooms spent${r && r.spent >= g.size ? ' (spent: its doors lead out)' : ''}`],
      ['rooms', r ? `${r.rooms}: ${roles}` : '0'],
      ['cells', r ? r.cells : 0],
      ['claims', r && r.claims ? `${r.claims} unbuilt (hatched)` : '—'],
      ['entered from', g.parentId || '— (the first)'],
      ['first room', g.originId || '—'],
      ['seed', g.seed],
    ];
    fillRows($('region-inspector'), rows);
  }

  /** "g3 · 4/12 rooms spent" for the inspector. */
  function regionText(exp, sp) {
    const g = exp.regions[sp.regionId];
    if (!g) return '—';
    const pin = state.regions.pinned.includes(g.id) ? ' · pinned' : '';
    return `${g.id} · ${DE.regionSpent(exp, g.id)}/${g.size} rooms spent${pin}`;
  }

  /**
   * Fill an inspector list from [label, value, data?] rows. A row with data
   * (region, type or mood) highlights those regions on the map while the
   * pointer is over it; a region row pins its region on a click.
   */
  function fillRows(dl, rows) {
    dl.innerHTML = '';
    for (const [k, v, data] of rows) {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = String(v);
      if (data) {
        for (const key in data) dd.dataset[key] = data[key];
        dd.classList.add('hot');
        dd.title = data.region ? 'Hover to see this region on the map; click to pin it'
          : data.type ? `Hover to see every ${data.type} region` : `Hover to see every ${data.mood} region`;
      }
      dl.append(dt, dd);
    }
  }

  /** Pin a region, or unpin it if it's pinned. */
  function togglePin(id) {
    const pins = state.regions.pinned;
    const i = pins.indexOf(id);
    if (i >= 0) pins.splice(i, 1); else pins.push(id);
    refreshPanels();
  }

  /** Autosave. Returns false if it didn't fit (a few thousand rooms can outgrow localStorage). */
  function save() {
    try { localStorage.setItem(STORAGE_KEY, DE.exportRecord(state.exp)); return true; } catch (e) { return false; }
  }

  function loadCapsInputs() {
    const p = state.exp.params;
    $('cap-spaces').value = p.maxSpaces || '';
    $('cap-area').value = p.maxArea || '';
    $('cap-depth').value = p.maxDepth || '';
  }

  function readCaps() {
    const n = (id) => { const v = parseInt($(id).value, 10); return v > 0 ? v : null; };
    return { maxSpaces: n('cap-spaces'), maxArea: n('cap-area'), maxDepth: n('cap-depth') };
  }

  function setExpedition(exp, msg) {
    state.exp = exp;
    state.candidate = null;
    state.selectedId = 's0';
    state.regions.selected = null;
    state.regions.pinned = [];
    state.mapRegion = null;
    state.hover = null;
    state.grown = null;
    state.grownFrom = null;
    $('seed-input').value = exp.rootSeed;
    loadCapsInputs();
    renderer.fit(exp);
    save();
    refreshPanels();
    setStatus(msg);
  }

  // ---------------------------------------------------------------------------
  // Actions

  function openDoor(spaceId, exitId) {
    try {
      state.candidate = DE.expand(state.exp, spaceId, exitId);
      state.selectedId = spaceId;
      setStatus('');
    } catch (e) { setStatus(e.message); }
    refreshPanels();
  }

  function accept() {
    const c = state.candidate;
    if (!c) return;
    try {
      const id = DE.commit(state.exp, c);
      state.selectedId = id || state.selectedId;
      state.candidate = null;
      save();
    } catch (e) { setStatus(e.message); state.candidate = null; }
    refreshPanels();
  }

  function reroll() {
    const c = state.candidate;
    if (!c || c.type === 'loop') return;
    openDoor(c.parentId, c.viaExitId);
  }

  function cancel() { state.candidate = null; refreshPanels(); }

  function growOpts() {
    const n = parseInt($('grow-rooms').value, 10);
    const route = $('grow-route').value.trim();
    const o = { rooms: n > 0 ? Math.min(n, 5000) : 400, order: $('grow-order').value };
    if (route) o.seed = route;
    return o;
  }

  /**
   * Grow the current expedition (from `from`'s branch, or anywhere). The
   * view stays where it is unless `fit`: you zoom out from where you were.
   * The rooms it adds are outlined until the next grow.
   */
  function growMap(from, fit) {
    if (state.candidate) state.candidate = null;
    const o = growOpts();
    o.from = from || null;
    const before = new Set(Object.keys(state.exp.spaces));
    const branch = from ? DE.subtree(state.exp, from).size : 0;
    const t = performance.now();
    const r = DE.grow(state.exp, o);
    const ms = Math.round(performance.now() - t);
    state.grown = new Set(Object.keys(state.exp.spaces).filter((id) => !before.has(id)));
    if (fit) renderer.fit(state.exp);
    const saved = save();
    refreshPanels();
    const where = from ? ` from ${from}'s branch (${branch} room${branch === 1 ? '' : 's'}: ${from} and every room opened beyond it)` : '';
    setStatus(`Grew ${r.rooms} room${r.rooms === 1 ? '' : 's'}${where}, ${o.order}, ${r.loops} loops, in ${ms} ms. New rooms are outlined.` +
      (r.rooms < o.rooms ? (from ? ` No unopened doors left in ${from}'s branch.` : ' No unopened doors left.') : '') +
      (saved ? '' : ' Too big to autosave: use Export JSON to keep it.'));
    return r;
  }

  /**
   * A dungeon grown from scratch: this root seed (default: the Root seed
   * box), at the chosen size, order and route. Remembered, so changing the
   * order or route grows the same seed again for comparison.
   */
  function growFresh(seed) {
    const root = seed || $('seed-input').value.trim() || DE.randomRootSeed();
    setExpedition(DE.createExpedition(root, readCaps()), '');
    const r = growMap(null, true);
    state.grown = null; // the whole map is new: nothing to pick out
    const o = growOpts();
    setStatus(`Grew ${root} to ${r.rooms} rooms, ${o.order}${o.seed ? ', route ' + o.seed : ''}, ${r.loops} loops.` +
      ' Change the order, size or route to grow it again.');
    state.grownFrom = { seed: root, rooms: o.rooms, order: o.order, route: o.seed || '', n: state.exp.history.length };
    refreshPanels();
  }

  /** One click: a fresh seed, grown to the chosen size. */
  function newDungeon() { growFresh(DE.randomRootSeed()); }

  /** Is the map still exactly a fresh grow (nothing opened, grown or reverted since)? */
  function onlyGrown() {
    return state.grownFrom && state.grownFrom.seed === state.exp.rootSeed && state.grownFrom.n === state.exp.history.length;
  }

  function revertSelected() {
    const id = state.selectedId;
    if (!id || !DE.canRevert(state.exp, id) || state.candidate) return;
    const parent = state.exp.spaces[id].parentId;
    DE.revert(state.exp, id);
    state.selectedId = parent;
    save();
    refreshPanels();
    setStatus(`Reverted ${id}.`);
  }

  // ---------------------------------------------------------------------------
  // Pointer input: drag to pan, pinch / wheel to zoom, tap to act.

  const pointers = new Map();
  let dragMoved = 0;
  let pinchDist = 0;

  function localXY(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, localXY(e));
    if (pointers.size === 1) dragMoved = 0;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      dragMoved = Infinity; // a pinch is never a tap
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = localXY(e);
    if (!pointers.has(e.pointerId)) {
      const hit = state.exp && renderer.hitTest(state.exp, p.x, p.y);
      canvas.classList.toggle('over-exit', !!hit && hit.type === 'exit');
      // With the regions layer on, the region under the pointer lights up.
      let rid = null;
      if (state.exp && state.regions.show) {
        const w = renderer.screenToWorld(p.x, p.y);
        rid = RV.regionAt(state.exp, Math.floor(w.x), Math.floor(w.y));
      }
      if (rid !== state.mapRegion) { state.mapRegion = rid; redraw(); }
      return;
    }
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, p);
    if (pointers.size === 1) {
      dragMoved += Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y);
      if (dragMoved > 5) canvas.classList.add('dragging');
      renderer.panBy(p.x - prev.x, p.y - prev.y);
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) renderer.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinchDist);
      pinchDist = d;
      renderer.panBy((p.x - prev.x) / 2, (p.y - prev.y) / 2);
    }
    redraw();
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    const p = localXY(e);
    pointers.delete(e.pointerId);
    canvas.classList.remove('dragging');
    if (pointers.size === 0 && dragMoved <= 5 && e.type === 'pointerup') tap(p.x, p.y);
    if (pointers.size < 2) pinchDist = 0;
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointerleave', () => { if (state.mapRegion) { state.mapRegion = null; redraw(); } });
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = localXY(e);
    renderer.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
    redraw();
  }, { passive: false });

  function tap(x, y) {
    const hit = renderer.hitTest(state.exp, x, y);
    if (hit && hit.type === 'exit') {
      openDoor(hit.spaceId, hit.exitId);
    } else if (hit && hit.type === 'space') {
      state.selectedId = hit.spaceId;
      state.regions.selected = null;
      // With the regions layer on, clicking a room pins its region too.
      const rid = state.exp.spaces[hit.spaceId].regionId;
      if (state.regions.show && rid && !state.regions.pinned.includes(rid)) state.regions.pinned.push(rid);
      refreshPanels();
    } else if (hit && hit.type === 'region') {
      // A region's margin: select it, and pin or unpin it.
      state.selectedId = null;
      state.regions.selected = hit.regionId;
      togglePin(hit.regionId);
    } else {
      // Empty ground: clear the selection and every pin.
      state.selectedId = null;
      state.regions.selected = null;
      state.regions.pinned = [];
      refreshPanels();
    }
  }

  function zoomCenter(f) {
    const r = canvas.getBoundingClientRect();
    renderer.zoomAt(r.width / 2, r.height / 2, f);
    redraw();
  }

  // ---------------------------------------------------------------------------
  // Controls

  $('accept-btn').onclick = accept;
  $('reroll-btn').onclick = reroll;
  $('cancel-btn').onclick = cancel;
  $('revert-btn').onclick = revertSelected;
  $('fit-btn').onclick = () => { renderer.fit(state.exp); redraw(); };
  $('zoom-in-btn').onclick = () => zoomCenter(1.25);
  $('zoom-out-btn').onclick = () => zoomCenter(0.8);

  $('new-btn').onclick = () => {
    const seed = $('seed-input').value.trim() || DE.randomRootSeed();
    setExpedition(DE.createExpedition(seed, readCaps()), `New expedition from seed “${seed}”.`);
  };
  $('random-btn').onclick = () => {
    const seed = DE.randomRootSeed();
    setExpedition(DE.createExpedition(seed, readCaps()), `New expedition from seed “${seed}”.`);
  };
  $('caps-btn').onclick = () => {
    DE.setCaps(state.exp, readCaps());
    save();
    refreshPanels();
    setStatus('Caps applied — new doors past a cap open onto dead ends.');
  };

  $('export-btn').onclick = () => {
    const blob = new Blob([DE.exportRecord(state.exp)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `expedition-${state.exp.rootSeed}-${Object.keys(state.exp.spaces).length}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  $('import-input').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const res = DE.importRecord(reader.result);
        setExpedition(res.expedition, res.verified
          ? `Replayed ${res.expedition.history.length} events — identical map.`
          : `Replayed, but ${res.mismatches.length} spaces differ from the file: ${res.mismatches.slice(0, 3).join(', ')}`);
      } catch (err) { setStatus('Import failed: ' + err.message); }
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  $('grow-new-btn').onclick = newDungeon;
  $('grow-seed-btn').onclick = () => growFresh(null);
  $('grow-btn').onclick = () => growMap(null);
  $('grow-here-btn').onclick = () => { if (state.selectedId) growMap(state.selectedId); };
  $('grow-route-btn').onclick = () => {
    $('grow-route').value = DE.randomRootSeed();
    growFresh(onlyGrown() ? state.exp.rootSeed : null);
  };
  // On a map that's nothing but a grow, changing the order, size or route
  // grows the same seed again: flip between orders to compare them.
  for (const id of ['grow-order', 'grow-rooms', 'grow-route']) {
    $(id).addEventListener('change', () => { if (onlyGrown()) growFresh(state.exp.rootSeed); });
  }

  for (const t in state.show) {
    const el = $('c-' + t);
    el.checked = state.show[t];
    el.onchange = () => { state.show[t] = el.checked; refreshPanels(); };
  }

  // Hovering in the panel previews or highlights on the map.
  const setHover = (h) => {
    const same = JSON.stringify(h) === JSON.stringify(state.hover);
    state.hover = h;
    if (!same) redraw();
  };
  $('content-toggles').addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-kind]');
    setHover(el ? { content: el.dataset.kind } : null);
  });
  $('content-toggles').addEventListener('mouseleave', () => setHover(null));
  for (const id of ['region-types', 'region-moods', 'region-list']) {
    const ul = $(id);
    ul.addEventListener('mouseover', (e) => {
      const li = e.target.closest('li');
      if (!li) return setHover(null);
      const d = li.dataset;
      setHover(d.region ? { region: d.region } : d.type ? { type: d.type } : d.mood ? { mood: d.mood } : null);
    });
    ul.addEventListener('mouseleave', () => setHover(null));
  }
  $('region-list').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-region]');
    if (!li) return;
    const id = li.dataset.region;
    const pinned = state.regions.pinned.includes(id);
    state.regions.selected = pinned ? null : id;
    if (!pinned) { const r = RV.layout(state.exp).regions[id]; if (r) renderer.centerOn((r.box.x0 + r.box.x1) / 2, (r.box.y0 + r.box.y1) / 2); }
    togglePin(id);
  });
  for (const id of ['inspector', 'region-inspector']) {
    const dl = $(id);
    dl.addEventListener('mouseover', (e) => {
      const dd = e.target.closest('dd.hot');
      if (!dd) return setHover(null);
      const d = dd.dataset;
      setHover(d.region ? { region: d.region } : d.type ? { type: d.type } : d.mood ? { mood: d.mood } : null);
    });
    dl.addEventListener('mouseleave', () => setHover(null));
    dl.addEventListener('click', (e) => {
      const dd = e.target.closest('dd.hot[data-region]');
      if (dd) togglePin(dd.dataset.region);
    });
  }
  $('r-show').checked = state.regions.show;
  $('r-show').onchange = () => {
    state.regions.show = $('r-show').checked;
    if (!state.regions.show) state.mapRegion = null;
    refreshPanels();
  };
  $('r-by').value = state.regions.by;
  $('r-by').onchange = () => { state.regions.by = $('r-by').value; refreshPanels(); };

  for (const t of ['grid', 'labels', 'occupancy', 'path']) {
    const el = $('t-' + t);
    el.checked = state.toggles[t];
    el.onchange = () => { state.toggles[t] = el.checked; redraw(); };
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'Enter') accept();
    else if (e.key === 'r' || e.key === 'R') reroll();
    else if (e.key === 'Escape') cancel();
    else if (e.key === 'Delete' || e.key === 'Backspace') revertSelected();
    else if (e.key === 'f' || e.key === 'F') { renderer.fit(state.exp); redraw(); }
    else return;
    e.preventDefault();
  });

  global.addEventListener('resize', () => { renderer.resize(); redraw(); });
  const mq = global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)');
  if (mq && mq.addEventListener) mq.addEventListener('change', () => { renderer.readColors(); redraw(); });

  // ---------------------------------------------------------------------------
  // Boot: restore the last expedition (replayed from history) or start fresh.

  renderer.resize();
  let restored = null;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) restored = DE.importRecord(saved).expedition;
  } catch (e) { restored = null; }
  if (restored) setExpedition(restored, 'Resumed your last expedition.');
  else setExpedition(DE.createExpedition(DE.randomRootSeed()), 'Tap a glowing doorway to open it.');

  global.DungeonApp.state = state; // handy from the console
  global.DungeonApp.renderer = renderer;
})(window);
