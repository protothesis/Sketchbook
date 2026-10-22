// Walk mode: the HUD. Prompts, captions, counters, notices, the minimap and
// big map, and the expedition record screen.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, DP, RULES, THREE, $, ekey, state, isLockedNow, CHALK, chargeText, el, savePlayer,
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
      } else if (near.action === 'take') {
        const it = near.it.item;
        cls = 'chalk';
        text = `${it.kind === 'chalk' ? `a stick of ${it.color || 'silver'} chalk` : 'a doorstone'} · ${verb} to take it`;
      } else if (near.action === 'light') {
        text = `an unlit sconce · ${verb} to light it from your lantern (${RULES.sconceCost} shard)`;
      } else if (near.action === 'wake') {
        cls = 'collapse';
        text = `a dormant waystone · ${verb} to wake it (${chargeText(RULES.waystoneCharges)})`;
      } else if (near.action === 'travel') {
        cls = 'collapse';
        text = `a waystone · ${verb} to travel`;
      } else if (near.action === 'surface') {
        cls = 'surface';
        text = `a door up to the surface · ${verb}`;
      } else if (near.action === 'pull') {
        cls = 'jar';
        text = `a block out of place · push it home, or ${verb} to pull`;
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
        // Only a provisional room (one with no door out opened yet) offers this.
        const pr = near.price;
        cls = near.affordable ? 'collapse' : 'blocked';
        text = near.affordable
          ? `close & reroll ${near.child.id} · ${chargeText(pr.charges)} · ${verb}`
          : `not enough entropy to reroll · ${chargeText(pr.charges)}`;
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
    // Keys are counted here, not carried on the hotbar: a locked door takes one by itself.
    const keyEl = $('keys');
    if (keyEl) {
      keyEl.hidden = run.keys <= 0;
      keyEl.textContent = '⚷ ' + run.keys;
      keyEl.title = `${run.keys} key${run.keys === 1 ? '' : 's'} · a locked door uses one when you open it`;
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
    // Walls: every cell edge that doesn't lead into the same room, so rooms
    // built wall to wall still read as separate.
    ctx.strokeStyle = '#18171b'; // near-black, solid: just apart from the background
    ctx.lineWidth = Math.max(1.5, px * 0.1);
    ctx.beginPath();
    for (const id in exp.spaces) {
      for (const k of exp.spaces[id].cells) {
        const c = DE.parseKey(k);
        if (!visible(c)) continue;
        for (const f of DE.FACINGS) {
          const n = DE.step(c, f);
          if (exp.registry[DE.key(n.x, n.y)] === id || state.exitAt.has(ekey(c.x, c.y, f))) continue; // doors draw below
          const [ax, ay, bx, by] = edgeEnds(c.x, c.y, f);
          ctx.moveTo(ox + ax * px, oy + ay * px);
          ctx.lineTo(ox + bx * px, oy + by * px);
        }
      }
    }
    ctx.stroke();
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
    // Doors, one tile wide. Unopened (orange) and locked (blue) doors are a
    // bar with a point on the outside, toward where they'd open. An opened
    // door into a room that's still provisional is a green arrow pointing
    // into it (close it to reroll the room). Other opened doors, including
    // loops, are a plain green bar, drawn from the side that opened them.
    const t = Math.max(1, px * 0.08); // half the line's thickness
    for (const id in exp.spaces) {
      const sp = exp.spaces[id];
      for (const ex of sp.exits) {
        const [ax, ay, bx, by] = edgeEnds(ex.cell.x, ex.cell.y, ex.facing);
        if (!visible(ex.cell)) continue;
        const conn = ex.connectionId && exp.connections[ex.connectionId];
        if (conn && DP.rerollThrough(exp, id, ex)) {
          const d = DE.DIRS[ex.facing], mx = (ax + bx) / 2, my = (ay + by) / 2;
          const hx = (bx - ax) * 0.4, hy = (by - ay) * 0.4; // half the base
          ctx.fillStyle = '#5fbf7a';
          ctx.beginPath();
          ctx.moveTo(ox + (mx - hx) * px, oy + (my - hy) * px);
          ctx.lineTo(ox + (mx + hx) * px, oy + (my + hy) * px);
          ctx.lineTo(ox + (mx + d.x * 0.35) * px, oy + (my + d.y * 0.35) * px);
          ctx.closePath();
          ctx.fill();
          continue;
        }
        if (conn && !conn.loop && !DP.childThrough(exp, id, ex)) continue; // the side that opened it draws it
        ctx.fillStyle = conn ? '#5fbf7a' : ex.kind === 'surface' ? '#dcebff' : isLockedNow(sp, ex) ? '#6fa8d8' : '#c4502a';
        ctx.fillRect(ox + Math.min(ax, bx) * px - (ay === by ? 0 : t), oy + Math.min(ay, by) * px - (ay === by ? t : 0),
          Math.abs(bx - ax) * px + (ay === by ? 0 : 2 * t), Math.abs(by - ay) * px + (ay === by ? 2 * t : 0));
        if (!conn) {
          // Base on the bar's outer edge, point out from there.
          const d = DE.DIRS[ex.facing];
          const mx = ox + (ax + bx) / 2 * px + d.x * t, my = oy + (ay + by) / 2 * px + d.y * t;
          const hx = (bx - ax) * 0.3 * px, hy = (by - ay) * 0.3 * px;
          ctx.beginPath();
          ctx.moveTo(mx - hx, my - hy);
          ctx.lineTo(mx + hx, my + hy);
          ctx.lineTo(mx + d.x * 0.3 * px, my + d.y * 0.3 * px);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
    // Chalk marks: a dot in the chalk's colour, big enough to read at any zoom.
    for (const m of state.marks) {
      const mx = ox + (m.sx / 2 + 0.25) * px, my = oy + (m.sy / 2 + 0.25) * px;
      ctx.beginPath();
      ctx.arc(mx, my, Math.max(3.5, px * 0.24), 0, Math.PI * 2);
      ctx.fillStyle = CHALK[m.color].css;
      ctx.fill();
      ctx.lineWidth = Math.max(1, px * 0.05);
      ctx.strokeStyle = 'rgba(10, 8, 14, 0.85)';
      ctx.stroke();
    }
    // Waystones: a small slab, glowing when awake.
    for (const st of state.waystones) {
      const mx = ox + (st.ws.x0 + st.ws.x1) / 2 * px, my = oy + (st.ws.y0 + st.ws.y1) / 2 * px;
      const sw = Math.max(4, px * 0.32), sh = Math.max(7, px * 0.62);
      ctx.save();
      if (st.awake) { ctx.shadowColor = 'rgba(165, 140, 255, 0.9)'; ctx.shadowBlur = 8; }
      ctx.fillStyle = st.awake ? '#cdbfff' : '#7d7888';
      ctx.fillRect(mx - sw / 2, my - sh / 2, sw, sh);
      ctx.restore();
    }
    // Waypoints still waiting: a glowing violet "?", pinned to the edge
    // when it's off the map so you always know which way to go.
    for (const r of W.waitingPins()) {
      let mx = ox + r.pin.x * px, my = oy + r.pin.y * px;
      const m = 12, off = mx < m || mx > w - m || my < m || my > h - m;
      if (off) {
        // Slide toward the centre along the line from it, to the edge.
        const dx = mx - w / 2, dy = my - h / 2;
        const k = Math.min((w / 2 - m) / Math.abs(dx || 1e-6), (h / 2 - m) / Math.abs(dy || 1e-6));
        mx = w / 2 + dx * k; my = h / 2 + dy * k;
      }
      const s = off ? 13 : Math.max(16, px * 1.1);
      ctx.save();
      ctx.globalAlpha = off ? 0.75 : 1;
      ctx.shadowColor = 'rgba(176, 120, 255, 0.95)';
      ctx.shadowBlur = 12;
      ctx.fillStyle = 'rgba(122, 70, 220, 0.9)';
      ctx.fillRect(mx - s / 2, my - s / 2, s, s);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#d9c8ff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(mx - s / 2, my - s / 2, s, s);
      ctx.fillStyle = '#f4eeff';
      ctx.font = `bold ${Math.round(s * 0.7)}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', mx, my + 1);
      ctx.restore();
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

    const out = mode === 'extracted', up = mode === 'surface';
    $('done-kicker').textContent = out || up ? 'expedition record' : 'checkpoint';
    $('done-title').textContent = up ? 'You climbed back to the surface.' : out ? 'You left the dungeon.' : 'The locked door gives.';
    $('done-lede').textContent = up
      ? 'The dungeon will be here when you go back down. What you charted stays charted.'
      : out
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
      el('span', 'hash', up ? `the surface door ${spaceId}/${exitId}. up to the surface`
        : `locked door ${spaceId}/${exitId}, unlocked${out ? '. left the dungeon here' : ''}`));
    list.append(last);

    const mins = Math.floor(run.walked / 60), secs = Math.floor(run.walked % 60);
    const rows = [
      ['rooms standing', s.spaces], ['rooms ever opened', generated], ['loops', s.cycles],
      ['cells charted', s.cells], ['deepest', deepest], ['chain length', chain.length],
      ['shards found', run.shardsFound], ['keys found', run.keysFound], ['checkpoints', run.keysUsed], ['doors drawn', run.chalkUsed],
      ['collapses', run.collapses], ['rooms collapsed', run.roomsCollapsed], ['charges spent', run.chargesSpent],
      ['charges left', `${run.charges} + ${run.shards}/${RULES.shardsPerCharge}`],
      ['waystones awake', state.waystones.filter((o) => o.awake).length],
      ['waypoints reached', Object.values(exp.reserves || {}).filter((r) => r.spaceId).length],
      ['lamp gutters', run.gutters || 0],
      ['time walked', `${mins}:${String(secs).padStart(2, '0')}`],
    ];
    const dl = $('done-stats');
    dl.innerHTML = '';
    for (const [k, v] of rows) {
      const cell = el('div');
      cell.append(el('dt', null, k), el('dd', null, String(v)));
      dl.append(cell);
    }

    $('done-continue').hidden = out;
    $('done-continue').textContent = up ? 'Go back down' : 'Continue down';
    $('done-leave').hidden = out || up;
    for (const id of ['done-new', 'done-chart']) $(id).hidden = !(out || up);
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
    if (state.recordMode === 'surface') { // back down the stairs, into the starter hall
      state.run.surfaced = false;
      savePlayer();
      hideRecord();
      return;
    }
    hideRecord();
    if (d && state.exp.spaces[d.spaceId]) openDoor(d.spaceId, d.exitId);
  });

  // ---------------------------------------------------------------------------
  // A small modal: a question and a few buttons (the surface door, waystone
  // travel). Walking pauses while it's open; Escape closes it.

  function openDialog(o) {
    $('dialog-kicker').textContent = o.kicker || '';
    $('dialog-title').textContent = o.title;
    $('dialog-text').textContent = o.text || '';
    const box = $('dialog-buttons');
    box.innerHTML = '';
    for (const b of o.buttons) {
      const btn = el('button', 'btn' + (b.primary ? ' primary' : '') + (b.quiet ? ' quiet' : ''), b.label);
      btn.type = 'button';
      btn.addEventListener('click', () => { closeDialog(); if (b.onClick) b.onClick(); });
      box.append(btn);
    }
    state.dialog = true;
    state.paused = true;
    keys.clear();
    $('dialog').hidden = false;
    const first = box.querySelector('button');
    if (first) first.focus();
  }
  function closeDialog() {
    if (!state.dialog) return;
    state.dialog = false;
    state.paused = false;
    $('dialog').hidden = true;
  }
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
    hideRecord, openDialog, closeDialog });
})(window);
