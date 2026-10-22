// Walk mode: the HUD. Prompts, captions, counters, notices, the minimap and
// big map, and the expedition record screen.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, DP, RULES, THREE, $, state, isLockedNow, CHALK, chargeText, el, savePlayer,
    edgeEnds, maxCharges, refreshHotbar, openDoor, keys, promptEl } = W;

  // ---------------------------------------------------------------------------
  // HUD

  const touchUi = global.matchMedia && global.matchMedia('(hover: none)').matches;
  const verb = touchUi ? 'tap' : 'E';
  const verbF = touchUi ? 'tap' : 'F';

  let lastPrompt = '';
  function updatePrompt(near) {
    let text = '', cls = '';
    if (near) {
      const run = state.run;
      if (near.action === 'carve') {
        cls = 'chalk';
        text = `a bare wall · ${verbF} to open a door here (${state.run.doorstones} doorstone${state.run.doorstones === 1 ? '' : 's'})`;
      } else if (near.action === 'place' || near.action === 'mark') {
        text = ''; // setting a jar down or drawing a mark never prompts
      } else if (near.action === 'erase') {
        cls = 'chalk';
        text = `a ${near.mark.color} chalk mark · ${verb} to wipe it`;
      } else if (near.action === 'pickjar') {
        cls = 'jar';
        text = `a jar (${near.jar.fill}/${RULES.jarCapacity}) · ${verb} to lift it`;
      } else if (near.action === 'climb') {
        text = state.push.key ? 'climbing…' : `a block · push, or ${verb} to climb`;
      } else if (near.action === 'open') {
        text = state.push.key ? 'opening…' : `a closed door · push, or ${verb}`;
      } else if (near.action === 'locked') {
        cls = 'lock';
        text = run.keys > 0 ? `a locked door · ${verb} to unlock (1 key)` : 'a locked door · you need a key';
      } else if (near.action === 'collapse') {
        const pr = near.price;
        const rooms = `${pr.rooms} room${pr.rooms === 1 ? '' : 's'}`;
        cls = near.affordable ? 'collapse' : 'blocked';
        text = near.affordable
          ? `close & collapse ${rooms} · ${chargeText(pr.charges)} · ${verb}`
          : `too much lies beyond · ${rooms}, ${chargeText(pr.charges)}`;
      }
    }
    const sig = text + '|' + cls;
    if (sig === lastPrompt) return;
    lastPrompt = sig;
    promptEl.hidden = !text;
    promptEl.textContent = text;
    promptEl.className = 'prompt ' + cls;
  }

  let captionTimer = null;
  function showCaption(text) {
    const el = $('caption');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(captionTimer);
    captionTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // HUD writes tolerate a missing element: a stale cached play.html paired
  // with a newer play.js once froze the game when a new counter was missing.
  const stanceEl = $('stance') || document.createElement('span');
  const setText = (id, v) => { const e = $(id); if (e) e.textContent = v; };

  function refreshHud() {
    const s = DE.stats(state.exp);
    const run = state.run;
    setText('stats', `seed ${state.exp.rootSeed} · ${s.spaces} rooms · ${s.openExits} closed doors`);
    const charges = $('charges');
    if (charges) {
      charges.innerHTML = '';
      for (let i = 0; i < maxCharges(); i++) {
        charges.append(el('span', (i < run.charges ? 'charge on' : 'charge') + (i >= RULES.chargesMax ? ' buff' : '')));
      }
      charges.parentElement.title = `${run.charges} of ${maxCharges()} charges · ${run.shards}/${RULES.shardsPerCharge} shards toward the next`;
    }
    const shards = $('shard-pips');
    if (shards) {
      shards.innerHTML = '';
      for (let i = 0; i < RULES.shardsPerCharge; i++) shards.append(el('span', i < run.shards ? 'pip on' : 'pip'));
    }
    refreshHotbar();
  }

  /** A small notice on screen (dismissable), for errors and stale files. */
  function notice(text, kind) {
    let n = $('notice');
    if (!n) {
      n = document.createElement('div');
      n.id = 'notice';
      n.className = 'notice';
      n.addEventListener('click', () => n.remove());
      document.body.append(n);
    }
    n.dataset.kind = kind || 'info';
    n.textContent = text + '  (tap to dismiss)';
  }
  const REFRESH_HINT = 'Hard-refresh to load the latest files: Ctrl+Shift+R (Cmd+Shift+R on a Mac).';

  /**
   * Draw the chart (traces, rooms, doors, figure) into a 2D canvas, with
   * grid cell (cx, cy) at the canvas center and `px` pixels per cell. Used
   * by the minimap (centered on the figure) and the enlarged map.
   */
  function drawChart(cv, ctx, cx, cy, px) {
    const dpr = Math.min(global.devicePixelRatio || 1, 2);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const p = state.player;
    const exp = state.exp;
    const ox = w / 2 - cx * px, oy = h / 2 - cy * px;
    const visible = (c) => ox + (c.x + 1) * px > 0 && ox + c.x * px < w && oy + (c.y + 1) * px > 0 && oy + c.y * px < h;
    const gap = px > 4 ? 1 : 0;
    const cell = (c) => ctx.fillRect(ox + c.x * px + gap / 2, oy + c.y * px + gap / 2, px - gap, px - gap);
    // Traces of collapsed rooms: greyed, under everything live.
    ctx.fillStyle = 'rgba(150, 146, 160, 0.22)';
    for (const id in exp.traces || {}) {
      for (const k of exp.traces[id].cells) { const c = DE.parseKey(k); if (visible(c)) cell(c); }
    }
    for (const id in exp.spaces) {
      const sp = exp.spaces[id];
      ctx.fillStyle = `hsla(${sp.meta.hue}, 18%, ${id === p.spaceId ? 46 : 30}%, 0.95)`;
      for (const k of sp.cells) { const c = DE.parseKey(k); if (visible(c)) cell(c); }
    }
    // Rooms past a locked door: a gold outline.
    ctx.strokeStyle = 'rgba(232, 193, 90, 0.9)';
    ctx.lineWidth = Math.max(1, px * 0.1);
    for (const id in exp.spaces) {
      const sp = exp.spaces[id];
      if (!DP.pastLock(exp, sp)) continue;
      const own = new Set(sp.cells);
      ctx.beginPath();
      for (const k of sp.cells) {
        const c = DE.parseKey(k);
        if (!visible(c)) continue;
        for (const f of DE.FACINGS) {
          const n = DE.step(c, f);
          if (own.has(DE.key(n.x, n.y))) continue;
          const [ax, ay, bx, by] = edgeEnds(c.x, c.y, f);
          ctx.moveTo(ox + ax * px, oy + ay * px);
          ctx.lineTo(ox + bx * px, oy + by * px);
        }
      }
      ctx.stroke();
    }
    // Live cells standing on a trace: a violet tick (the imprint).
    if (px >= 5) {
      ctx.strokeStyle = 'rgba(181, 156, 255, 0.7)';
      ctx.lineWidth = Math.max(1, px * 0.08);
      ctx.beginPath();
      for (const id in exp.spaces) for (const k of exp.spaces[id].cells) {
        if (!DE.imprintAt(exp, k).length) continue;
        const c = DE.parseKey(k);
        if (!visible(c)) continue;
        ctx.moveTo(ox + (c.x + 0.3) * px, oy + (c.y + 0.7) * px);
        ctx.lineTo(ox + (c.x + 0.7) * px, oy + (c.y + 0.3) * px);
      }
      ctx.stroke();
    }
    // Doors: unopened orange, locked blue, opened green.
    const t = Math.max(1.5, px * 0.12);
    for (const id in exp.spaces) {
      const sp = exp.spaces[id];
      for (const ex of sp.exits) {
        ctx.fillStyle = ex.connectionId ? '#5fbf7a' : isLockedNow(sp, ex) ? '#6fa8d8' : '#c4502a';
        const [ax, ay, bx, by] = edgeEnds(ex.cell.x, ex.cell.y, ex.facing);
        ctx.fillRect(ox + Math.min(ax, bx) * px - t, oy + Math.min(ay, by) * px - t,
          Math.abs(bx - ax) * px + 2 * t, Math.abs(by - ay) * px + 2 * t);
      }
    }
    // Chalk marks: a dot in the chalk's colour (its symbol when zoomed in).
    for (const m of state.marks) {
      const mx = ox + (m.sx / 2 + 0.25) * px, my = oy + (m.sy / 2 + 0.25) * px;
      if (px >= 22) {
        ctx.font = `bold ${Math.round(px * 0.34)}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(10, 8, 14, 0.8)';
        ctx.fillText(CHALK[m.color].sym, mx + 1, my + 1);
        ctx.fillStyle = CHALK[m.color].css;
        ctx.fillText(CHALK[m.color].sym, mx, my);
      } else {
        const r = Math.max(2, px * 0.13);
        ctx.beginPath();
        ctx.arc(mx, my, r, 0, Math.PI * 2);
        ctx.fillStyle = CHALK[m.color].css;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(10, 8, 14, 0.85)';
        ctx.stroke();
      }
    }
    // Hash ghosts watching you (amber) or following you (magenta).
    for (const g of state.ghosts) {
      if (g.mode === 'wander') continue;
      ctx.fillStyle = g.mode === 'chase' ? 'rgba(214, 120, 255, 0.95)' : 'rgba(255, 195, 90, 0.95)';
      ctx.beginPath();
      ctx.arc(ox + g.x * px, oy + g.y * px, Math.max(2.5, px * 0.28), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(ox + p.x * px, oy + p.y * px);
    ctx.rotate(-p.angle);
    ctx.fillStyle = '#f3ecdc';
    const a = Math.max(px, 7);
    ctx.beginPath();
    ctx.moveTo(0, a * 0.55);
    ctx.lineTo(a * 0.32, -a * 0.3);
    ctx.lineTo(-a * 0.32, -a * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  const mm = $('minimap');
  const mmCtx = mm.getContext('2d');
  function drawMinimap() {
    if (state.bigmap) return;
    drawChart(mm, mmCtx, state.player.x, state.player.y, mm.clientWidth / 26);
  }
  mm.addEventListener('click', () => openBigMap());

  // The enlarged map: M (or tapping the minimap) opens it; drag to pan,
  // wheel or pinch to zoom. Walking pauses while it's open.
  const bm = $('bigmap-canvas');
  const bmCtx = bm.getContext('2d');
  // Zoom limits for the big map; it opens two wheel steps back from the closest.
  const BIGMAP_MAX_PX = 60, WHEEL_STEP = Math.exp(-100 * 0.0015);
  function openBigMap() {
    if (state.paused) return;
    keys.clear();
    state.bigmap = { cx: state.player.x, cy: state.player.y, px: BIGMAP_MAX_PX * WHEEL_STEP * WHEEL_STEP };
    $('bigmap').hidden = false;
    mm.classList.add('hidden');
  }
  function closeBigMap() {
    state.bigmap = null;
    $('bigmap').hidden = true;
    mm.classList.remove('hidden');
  }
  function drawBigMap() {
    if (!state.bigmap) return;
    drawChart(bm, bmCtx, state.bigmap.cx, state.bigmap.cy, state.bigmap.px);
  }
  function zoomBigMap(f, sx, sy) {
    const v = state.bigmap;
    const npx = THREE.MathUtils.clamp(v.px * f, 2.5, BIGMAP_MAX_PX);
    // Keep the cell under (sx, sy) fixed while zooming.
    const r = bm.getBoundingClientRect();
    const dx = sx - r.left - r.width / 2, dy = sy - r.top - r.height / 2;
    v.cx += dx / v.px - dx / npx;
    v.cy += dy / v.px - dy / npx;
    v.px = npx;
  }
  const bmPointers = new Map();
  let pinchDist = 0;
  let bmTap = null; // a press that hasn't moved: a click on the map
  bm.addEventListener('pointerdown', (e) => {
    bm.setPointerCapture(e.pointerId);
    bmPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    bmTap = bmPointers.size === 1 ? { x: e.clientX, y: e.clientY } : null;
    if (bmPointers.size === 2) {
      const [a, b] = Array.from(bmPointers.values());
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  bm.addEventListener('pointermove', (e) => {
    const prev = bmPointers.get(e.pointerId);
    if (!prev || !state.bigmap) return;
    const cur = { x: e.clientX, y: e.clientY };
    bmPointers.set(e.pointerId, cur);
    if (bmTap && Math.hypot(cur.x - bmTap.x, cur.y - bmTap.y) > 6) bmTap = null;
    if (bmPointers.size === 1) {
      state.bigmap.cx -= (cur.x - prev.x) / state.bigmap.px;
      state.bigmap.cy -= (cur.y - prev.y) / state.bigmap.px;
    } else if (bmPointers.size === 2) {
      const [a, b] = Array.from(bmPointers.values());
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) zoomBigMap(d / pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinchDist = d;
    }
  });
  const bmUp = (e) => {
    bmTap = null;
    bmPointers.delete(e.pointerId);
    pinchDist = 0;
  };
  bm.addEventListener('pointerup', bmUp);
  bm.addEventListener('pointercancel', bmUp);
  bm.addEventListener('wheel', (e) => {
    if (!state.bigmap) return;
    e.preventDefault();
    zoomBigMap(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  }, { passive: false });
  $('bigmap-center').addEventListener('click', () => {
    if (state.bigmap) { state.bigmap.cx = state.player.x; state.bigmap.cy = state.player.y; }
  });
  $('bigmap-close').addEventListener('click', closeBigMap);

  // ---------------------------------------------------------------------------
  // The expedition record: the seed chain from the root to a locked door.
  // Unlocking one is a checkpoint (continue down, or leave the dungeon);
  // leaving ends the run on the same record.

  const short = (h) => (h ? h.slice(0, 8) : '');

  let recordDoor = null;   // { spaceId, exitId }

  function showRecord(spaceId, exitId, mode) {
    const exp = state.exp;
    const run = state.run;
    if (!exp.spaces[spaceId]) return;
    state.recordMode = mode;
    recordDoor = { spaceId, exitId };
    const s = DE.stats(exp);
    const chain = DP.seedChain(exp, spaceId);
    const generated = exp.history.filter((ev) => ev.type === 'commit' && !ev.loop).length + 1;
    let deepest = 0;
    for (const id in exp.spaces) deepest = Math.max(deepest, exp.spaces[id].depth);

    const out = mode === 'extracted';
    $('done-kicker').textContent = out ? 'expedition record' : 'checkpoint';
    $('done-title').textContent = out ? 'You left the dungeon.' : 'The locked door gives.';
    $('done-lede').textContent = out
      ? 'What you charted stays charted.'
      : 'Beyond it the dungeon goes on. Continue down, or leave with what you have charted.';
    $('done-seed').textContent = exp.rootSeed;
    const list = $('done-chain');
    list.innerHTML = '';
    for (const step of chain) {
      const li = el('li');
      li.append(el('span', 'sid', step.id));
      const formula = step.parentSeed
        ? `H(${short(step.parentSeed)} | ${step.exitIndex} | ${short(step.entropy)})`
        : `H(${exp.rootSeed} | root)`;
      li.append(el('span', 'hash', `${formula} → ${short(step.seed)}`));
      li.append(el('span', 'what', `${step.archetype} · ${step.mood}`));
      list.append(li);
    }
    const last = el('li', 'door');
    last.append(el('span', 'sid', '⟶'),
      el('span', 'hash', `locked door ${spaceId}/${exitId}, unlocked${out ? '. left the dungeon here' : ''}`));
    list.append(last);

    const mins = Math.floor(run.walked / 60), secs = Math.floor(run.walked % 60);
    const rows = [
      ['rooms standing', s.spaces], ['rooms ever opened', generated], ['loops', s.cycles],
      ['cells charted', s.cells], ['deepest', deepest], ['chain length', chain.length],
      ['shards found', run.shardsFound], ['keys found', run.keysFound], ['checkpoints', run.keysUsed], ['doors drawn', run.chalkUsed],
      ['collapses', run.collapses], ['rooms collapsed', run.roomsCollapsed], ['charges spent', run.chargesSpent],
      ['charges left', `${run.charges} + ${run.shards}/${RULES.shardsPerCharge}`],
      ['time walked', `${mins}:${String(secs).padStart(2, '0')}`],
    ];
    const dl = $('done-stats');
    dl.innerHTML = '';
    for (const [k, v] of rows) {
      const cell = el('div');
      cell.append(el('dt', null, k), el('dd', null, String(v)));
      dl.append(cell);
    }

    for (const id of ['done-continue', 'done-leave']) $(id).hidden = out;
    for (const id of ['done-new', 'done-chart']) $(id).hidden = !out;
    state.paused = true;
    keys.clear();
    $('done').hidden = false;
  }

  function hideRecord() {
    state.recordMode = null;
    state.paused = false;
    $('done').hidden = true;
  }

  $('done-continue').addEventListener('click', () => {
    const d = recordDoor;
    hideRecord();
    if (d && state.exp.spaces[d.spaceId]) openDoor(d.spaceId, d.exitId);
  });
  $('done-leave').addEventListener('click', () => {
    state.run.extracted = Object.assign({}, recordDoor);
    savePlayer();
    showRecord(recordDoor.spaceId, recordDoor.exitId, 'extracted');
  });
  $('done-new').addEventListener('click', () => W.newExpedition());
  $('done-export').addEventListener('click', () => {
    const blob = new Blob([DE.exportRecord(state.exp)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `expedition-${state.exp.rootSeed}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  Object.assign(W, { verbF, updatePrompt, showCaption, stanceEl, refreshHud, notice,
    REFRESH_HINT, drawMinimap, openBigMap, closeBigMap, drawBigMap, showRecord,
    hideRecord });
})(window);
