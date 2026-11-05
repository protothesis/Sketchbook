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
    show: { creatures: false, push: false, features: false, locks: false, items: false, props: false },
  };

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
      ['mood', `${sp.meta.mood}, hue ${sp.meta.hue}`],
      ['region', regionText(exp, sp)],
    ] : [['', 'Tap a space to inspect it.']];
    for (const [k, v] of rows) {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = String(v);
      dl.append(dt, dd);
    }
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
      `${n.sigil} sigils, ${n.well} wells, ${n.chest} chests, ${n.vessel} vessels, ${n.sconce} sconces · ${n.items} items · ${n.props} props, ${n.crates} crates`;
  }

  /** "g3 catacomb · damp · 4/12 rooms · gallery" for the inspector. */
  function regionText(exp, sp) {
    const g = exp.regions[sp.regionId];
    if (!g) return '—';
    return `${g.id} ${g.type} · ${g.mood} · ${DE.regionSpent(exp, g.id)}/${g.size} rooms · ${sp.role}`;
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
    return { rooms: n > 0 ? Math.min(n, 5000) : 400, order: $('grow-order').value };
  }

  /** Grow the current expedition (from `from`'s branch, or anywhere). */
  function growMap(from) {
    if (state.candidate) state.candidate = null;
    const o = growOpts();
    o.from = from || null;
    const t = performance.now();
    const r = DE.grow(state.exp, o);
    const ms = Math.round(performance.now() - t);
    renderer.fit(state.exp);
    const saved = save();
    refreshPanels();
    setStatus(`Grew ${r.rooms} room${r.rooms === 1 ? '' : 's'}${from ? ' from ' + from : ''} (${o.order}), ${r.loops} loops, in ${ms} ms.` +
      (r.rooms < o.rooms ? (from ? ` No unopened doors left in ${from}'s branch.` : ' No unopened doors left.') : '') +
      (saved ? '' : ' Too big to autosave: use Export JSON to keep it.'));
  }

  /** One click: a fresh seed, grown to the chosen size. */
  function newDungeon() {
    const seed = DE.randomRootSeed();
    setExpedition(DE.createExpedition(seed, readCaps()), '');
    growMap(null);
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
      refreshPanels();
    } else {
      state.selectedId = null;
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
  $('grow-btn').onclick = () => growMap(null);
  $('grow-here-btn').onclick = () => { if (state.selectedId) growMap(state.selectedId); };

  for (const t in state.show) {
    const el = $('c-' + t);
    el.checked = state.show[t];
    el.onchange = () => { state.show[t] = el.checked; refreshPanels(); };
  }

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
