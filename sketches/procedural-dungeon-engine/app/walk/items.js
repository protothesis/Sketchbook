// Walk mode: what you carry and leave behind. The hotbar, chalk marks,
// jars and sigil tiles.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, DP, RULES, THREE, $, S, RADIUS, scene, state, CHALK, el, savePlayer, geo,
    passable } = W;

  // ---------------------------------------------------------------------------
  // Inventory: the hotbar, chalk marks, jars and sigils
  //
  // E interacts with the world (doors, climbing, lifting a jar, wiping the
  // chalk mark you're standing on). F uses the item selected on the hotbar:
  // draw a chalk mark, set a jar down, press a doorstone to a wall. 1-9 or
  // the wheel select. A slot can hold a group of variants (chalk colours):
  // click it again, or press and hold, to open its picker; its number key
  // again cycles. Jars catch hash ghosts that follow you into them; a jar on
  // a sigil tile powers it, one stage per ghost; each full jar on a sigil
  // is +1 entropy max.

  const JAR_H = 0.38; // cells
  const STROKES = 3;  // chalk marks per stick

  function maxCharges() { return RULES.chargesMax + state.buff; }

  /**
   * The hotbar's slots, built from the run's inventory. A slot with
   * `variants` is a group (one slot, several kinds); `cur` is the variant
   * in use, remembered per group in state.variant.
   */
  function slots() {
    const run = state.run, out = [];
    for (const j of run.jars) out.push({ key: 'jar:' + j.id, kind: 'jar', jar: j });
    const colors = Object.keys(CHALK).filter((c) => run.chalks[c] > 0);
    if (colors.length) {
      const variants = colors.map((c) => ({ id: c, color: c, strokes: run.chalks[c] }));
      const cur = variants.find((v) => v.id === state.variant.chalk) || variants[0];
      state.variant.chalk = cur.id;
      out.push({ key: 'chalk', kind: 'chalk', variants, cur });
    }
    if (run.doorstones > 0) out.push({ key: 'doorstone', kind: 'doorstone', count: run.doorstones });
    if (run.keys > 0) out.push({ key: 'key', kind: 'key', count: run.keys });
    return out;
  }
  function selectedSlot() {
    const s = slots();
    return s.find((x) => x.key === state.sel) || s[0] || null;
  }
  function select(i) {
    const s = slots();
    if (!s.length) return;
    const slot = s[((i % s.length) + s.length) % s.length];
    if (slot.key === state.sel && slot.variants && slot.variants.length > 1) { cycleVariant(slot, 1); return; }
    state.sel = slot.key;
    state.expanded = null;
    refreshHotbar();
  }
  function cycleVariant(slot, dir) {
    const i = slot.variants.findIndex((v) => v.id === slot.cur.id);
    const v = slot.variants[(i + dir + slot.variants.length) % slot.variants.length];
    state.variant[slot.kind] = v.id;
    W.showCaption(`${v.color} chalk · ${CHALK[v.color].name}`);
    refreshHotbar();
  }

  const ICON = { jar: '⚱', key: '⚷', doorstone: '⌂' };
  const NAME = { jar: 'jar', key: 'keys', doorstone: 'doorstone: F at a bare wall opens a door', chalk: 'chalk' };
  function shakeHotbar() {
    const bar = $('hotbar');
    if (!bar) return;
    bar.classList.remove('shake');
    void bar.offsetWidth; // restart the animation
    bar.classList.add('shake');
  }

  /** A chalk icon: the colour's symbol over a stick in three segments (strokes left in it). */
  function chalkIcon(v) {
    const w = el('span', 'chalkic');
    const sym = el('span', 'sym', CHALK[v.color].sym);
    sym.style.color = CHALK[v.color].css;
    const stick = el('span', 'segs');
    const inStick = ((v.strokes - 1) % STROKES) + 1;
    for (let k = 0; k < STROKES; k++) {
      const seg = el('i', k < inStick ? 'on' : '');
      if (k < inStick) seg.style.background = CHALK[v.color].css;
      stick.append(seg);
    }
    w.append(sym, stick);
    const sticks = Math.ceil(v.strokes / STROKES);
    if (sticks > 1) w.append(el('span', 'ct', '×' + sticks));
    return w;
  }

  let holdTimer = null, heldOpen = false;
  function refreshHotbar() {
    const bar = $('hotbar');
    if (!bar) return;
    const s = slots();
    const cur = selectedSlot();
    if (cur) state.sel = cur.key;
    bar.innerHTML = '';
    bar.hidden = !s.length;
    s.forEach((slot, i) => {
      const b = el('button', 'slot' + (cur && slot.key === cur.key ? ' on' : '') + ' ' + slot.kind);
      b.type = 'button';
      b.append(el('span', 'n', String(i + 1)));
      if (slot.kind === 'chalk') {
        b.title = `chalk (${slot.variants.length} colour${slot.variants.length === 1 ? '' : 's'}): F draws a mark, E on one wipes it; click again or hold to pick a colour`;
        b.append(chalkIcon(slot.cur));
        if (slot.variants.length > 1) b.append(el('span', 'more', '▴'));
      } else {
        b.title = NAME[slot.kind] + (slot.kind === 'jar' ? ` (${slot.jar.fill}/${RULES.jarCapacity})` : '');
        b.append(el('span', 'ic', ICON[slot.kind]));
        if (slot.kind === 'jar') {
          const pips = el('span', 'fill');
          for (let k = 0; k < RULES.jarCapacity; k++) pips.append(el('i', k < slot.jar.fill ? 'on' : ''));
          b.append(pips);
        } else b.append(el('span', 'ct', String(slot.count)));
      }
      // Click selects; clicking the selected group (or holding it) opens its picker.
      b.addEventListener('pointerdown', () => {
        if (!slot.variants) return;
        clearTimeout(holdTimer);
        holdTimer = setTimeout(() => { state.sel = slot.key; state.expanded = slot.key; heldOpen = true; refreshHotbar(); }, 350);
      });
      b.addEventListener('pointerup', () => clearTimeout(holdTimer));
      b.addEventListener('pointerleave', () => clearTimeout(holdTimer));
      b.addEventListener('click', (e) => {
        e.preventDefault();
        if (heldOpen) { heldOpen = false; return; }
        if (slot.variants && state.sel === slot.key) state.expanded = state.expanded === slot.key ? null : slot.key;
        else { state.sel = slot.key; state.expanded = null; }
        refreshHotbar();
      });
      if (slot.variants && state.expanded === slot.key) {
        const pop = el('div', 'picker');
        for (const v of slot.variants) {
          const vb = el('button', 'pick' + (v.id === slot.cur.id ? ' on' : ''));
          vb.type = 'button';
          vb.title = `${v.color} chalk · ${CHALK[v.color].name} · ${v.strokes} stroke${v.strokes === 1 ? '' : 's'}`;
          vb.append(chalkIcon(v));
          vb.addEventListener('click', (e) => {
            e.stopPropagation();
            state.variant[slot.kind] = v.id;
            state.expanded = null;
            refreshHotbar();
          });
          pop.append(vb);
        }
        b.append(pop);
      }
      bar.append(b);
    });
  }

  // --- chalk marks: drawn on a quarter-tile (floor, or the top of a one-unit
  // block); they show on the maps too. Persist with the run.

  function markTexture(color) {
    const n = 128, cv = document.createElement('canvas');
    cv.width = cv.height = n;
    const g = cv.getContext('2d');
    g.strokeStyle = CHALK[color].css;
    g.lineWidth = n * 0.09;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const c = n / 2, R = n * 0.34;
    g.beginPath();
    if (color === 'silver') { // an arrow, drawn pointing "forward" (rotated to your facing)
      g.moveTo(c, c + R); g.lineTo(c, c - R);
      g.moveTo(c - R * 0.55, c - R * 0.4); g.lineTo(c, c - R); g.lineTo(c + R * 0.55, c - R * 0.4);
    } else if (color === 'gold') {
      g.moveTo(c, c - R); g.lineTo(c + R * 0.9, c + R * 0.65); g.lineTo(c - R * 0.9, c + R * 0.65); g.closePath();
    } else if (color === 'crimson') {
      g.moveTo(c - R * 0.8, c - R * 0.8); g.lineTo(c + R * 0.8, c + R * 0.8);
      g.moveTo(c + R * 0.8, c - R * 0.8); g.lineTo(c - R * 0.8, c + R * 0.8);
    } else if (color === 'teal') {
      for (const oy of [-R * 0.35, R * 0.35]) {
        g.moveTo(c - R, c + oy);
        g.bezierCurveTo(c - R * 0.5, c + oy - R * 0.4, c - R * 0.1, c + oy + R * 0.4, c + R * 0.3, c + oy);
        g.quadraticCurveTo(c + R * 0.65, c + oy - R * 0.3, c + R, c + oy);
      }
    } else { // violet: a crescent
      g.arc(c, c, R, Math.PI * 0.35, Math.PI * 1.65);
      g.quadraticCurveTo(c - R * 0.2, c, c + R * Math.cos(Math.PI * 0.35), c + R * Math.sin(Math.PI * 0.35));
    }
    g.stroke();
    // Chalky: knock little holes out of the stroke.
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(0,0,0,${0.25 + Math.random() * 0.6})`;
      g.fillRect(Math.random() * n, Math.random() * n, 1 + Math.random() * 2.5, 1 + Math.random() * 2.5);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const markMats = {};
  function markMat(color) {
    if (!markMats[color]) {
      const map = markTexture(color);
      markMats[color] = new THREE.MeshLambertMaterial({
        map, transparent: true, depthWrite: false,
        emissive: new THREE.Color(CHALK[color].hex).multiplyScalar(0.25), emissiveMap: map, // a faint glow, like fresh chalk
      });
    }
    return markMats[color];
  }
  geo.mark = new THREE.PlaneGeometry(0.46 * S, 0.46 * S);

  function addMarkToWorld(m) {
    const mesh = new THREE.Mesh(geo.mark, markMat(m.color));
    mesh.rotation.set(-Math.PI / 2, 0, m.rot || 0);
    mesh.position.set((m.sx / 2 + 0.25) * S, m.base ? m.base * S + 0.062 : 0.012, (m.sy / 2 + 0.25) * S);
    mesh.receiveShadow = true;
    scene.add(mesh);
    const rec = Object.assign({}, m, { mesh });
    state.marks.push(rec);
    return rec;
  }
  function removeMarkFromWorld(rec) {
    scene.remove(rec.mesh);
    state.marks = state.marks.filter((o) => o !== rec);
  }
  function clearMarks() { for (const m of state.marks.slice()) removeMarkFromWorld(m); }

  /** Can quarter (sx, sy) be reached from where you stand (same cell, or through an opening)? */
  function quarterReachable(sx, sy, p) {
    const cx = Math.floor(sx / 2), cy = Math.floor(sy / 2);
    if (state.exp.registry[DE.key(cx, cy)] === undefined) return false;
    const pcx = Math.floor(p.x), pcy = Math.floor(p.y);
    const dcx = cx - pcx, dcy = cy - pcy;
    if (Math.abs(dcx) > 1 || Math.abs(dcy) > 1) return false;
    if (dcx && dcy) {
      return (passable(pcx, pcy, cx, pcy) && passable(cx, pcy, cx, cy)) ||
             (passable(pcx, pcy, pcx, cy) && passable(pcx, cy, cx, cy));
    }
    return !(dcx || dcy) || passable(pcx, pcy, cx, cy);
  }

  /** The surface height a quarter offers (floor 0, or a one-unit block's top); null if covered. */
  function quarterSurface(sx, sy) {
    const cx = Math.floor(sx / 2), cy = Math.floor(sy / 2);
    const x0 = sx / 2, y0 = sy / 2, x1 = x0 + 0.5, y1 = y0 + 0.5;
    let base = 0;
    for (const bl of state.blockAt.get(DE.key(cx, cy)) || []) {
      if (!(bl.x0 < x1 && bl.x1 > x0 && bl.y0 < y1 && bl.y1 > y0)) continue;
      if (bl.jar || bl.units !== 1 || !(bl.x0 <= x0 && bl.x1 >= x1 && bl.y0 <= y0 && bl.y1 >= y1)) return null;
      base = Math.max(base, bl.top);
    }
    return base;
  }

  /** The free quarter nearest a point just ahead of you, among those in front; `ok(sx, sy, base)` filters. */
  function quarterAhead(p, ok) {
    const fx = Math.sin(p.angle), fy = Math.cos(p.angle);
    const ax = p.x + fx * (RADIUS + 0.27), ay = p.y + fy * (RADIUS + 0.27);
    const bsx = Math.floor(ax * 2), bsy = Math.floor(ay * 2);
    const cands = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const sx = bsx + dx, sy = bsy + dy;
      const qx = (sx + 0.5) / 2, qy = (sy + 0.5) / 2;
      if ((qx - p.x) * fx + (qy - p.y) * fy <= 0.05) continue; // in front only
      cands.push({ sx, sy, d: Math.hypot(qx - ax, qy - ay) });
    }
    cands.sort((u, v) => u.d - v.d);
    for (const c of cands) {
      if (!quarterReachable(c.sx, c.sy, p)) continue;
      const base = quarterSurface(c.sx, c.sy);
      if (base !== null && ok(c.sx, c.sy, base)) return { sx: c.sx, sy: c.sy, base };
    }
    return null;
  }

  function markSpot(p) {
    return quarterAhead(p, (sx, sy) => !state.marks.some((m) => m.sx === sx && m.sy === sy));
  }

  /** E while standing on a mark: wipe it. */
  function markNear(p) {
    const sx = Math.floor(p.x * 2), sy = Math.floor(p.y * 2);
    const m = state.marks.find((k) => k.sx === sx && k.sy === sy && Math.abs((k.base || 0) - p.z) < 0.2);
    return m ? { action: 'erase', mark: m } : null;
  }

  function drawMark(u) {
    const run = state.run, color = u.slot.cur.color;
    const rot = Math.round((state.player.angle + Math.PI) / (Math.PI / 2)) * (Math.PI / 2); // arrows point the way you faced
    addMarkToWorld({ sx: u.spot.sx, sy: u.spot.sy, color, rot, base: u.spot.base });
    run.chalks[color]--;
    if (run.chalks[color] <= 0) delete run.chalks[color];
  }

  /** Marks in rooms that collapse go with them. */
  function wipeMarksIn(ids) {
    const reg = state.exp.registry;
    for (const m of state.marks.slice()) {
      if (ids.has(reg[DE.key(Math.floor(m.sx / 2), Math.floor(m.sy / 2))])) removeMarkFromWorld(m);
    }
  }

  // --- jars in the world

  const jarGeo = {
    body: new THREE.CylinderGeometry(0.16 * S, 0.19 * S, 0.29 * S, 18),
    neck: new THREE.CylinderGeometry(0.1 * S, 0.13 * S, 0.06 * S, 14),
    lid: new THREE.CylinderGeometry(0.115 * S, 0.115 * S, 0.035 * S, 14),
    wisp: new THREE.SphereGeometry(0.05 * S, 10, 8),
  };
  const jarGlassMat = new THREE.MeshLambertMaterial({ color: 0xa9c3d6, emissive: 0x0e1418, transparent: true, opacity: 0.5, depthWrite: false });
  const jarLidMat = new THREE.MeshLambertMaterial({ color: 0x3a2f28 });
  const jarWispMat = new THREE.MeshBasicMaterial({ color: 0xd2a8ff, transparent: true, opacity: 0.9 });

  function makeJarMesh() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(jarGeo.body, jarGlassMat);
    body.position.y = 0.145 * S;
    body.castShadow = true;
    const neck = new THREE.Mesh(jarGeo.neck, jarGlassMat);
    neck.position.y = 0.32 * S;
    const lid = new THREE.Mesh(jarGeo.lid, jarLidMat);
    lid.position.y = 0.365 * S;
    lid.castShadow = true;
    g.add(body, neck, lid);
    g.userData.wisps = [0, 1, 2].map(() => {
      const w = new THREE.Mesh(jarGeo.wisp, jarWispMat);
      w.visible = false;
      g.add(w);
      return w;
    });
    return g;
  }

  function addJarToWorld(j) {
    const x0 = j.sx / 2, y0 = j.sy / 2;
    // Standing on the floor, or on a one-unit block filling its quarter.
    let base = 0;
    for (const bl of state.blockAt.get(DE.key(Math.floor(x0), Math.floor(y0))) || []) {
      if (!bl.jar && bl.units === 1 && bl.x0 <= x0 && bl.x1 >= x0 + 0.5 && bl.y0 <= y0 && bl.y1 >= y0 + 0.5) base = Math.max(base, bl.top);
    }
    const block = { x0, y0, x1: x0 + 0.5, y1: y0 + 0.5, top: base + JAR_H, base, units: 1, jar: true, spaceId: 'jar:' + j.id };
    const k = DE.key(Math.floor(x0), Math.floor(y0));
    const list = state.blockAt.get(k) || [];
    list.push(block);
    state.blockAt.set(k, list);
    const mesh = makeJarMesh();
    mesh.position.set((x0 + 0.25) * S, base * S, (y0 + 0.25) * S);
    scene.add(mesh);
    const rec = { id: j.id, sx: j.sx, sy: j.sy, fill: j.fill || 0, block, mesh };
    state.jars.push(rec);
    return rec;
  }

  function removeJarFromWorld(rec) {
    scene.remove(rec.mesh);
    const k = DE.key(Math.floor(rec.block.x0), Math.floor(rec.block.y0));
    const keep = (state.blockAt.get(k) || []).filter((b) => b !== rec.block);
    if (keep.length) state.blockAt.set(k, keep); else state.blockAt.delete(k);
    state.jars = state.jars.filter((o) => o !== rec);
  }

  function clearJars() { for (const r of state.jars.slice()) removeJarFromWorld(r); }

  /** Where F would set a jar down: the nearest free quarter ahead, not in a doorway's mouth or on you. */
  function jarSpot(p) {
    return quarterAhead(p, (sx, sy, base) => {
      const cx = Math.floor(sx / 2), cy = Math.floor(sy / 2);
      const sp = state.exp.spaces[state.exp.registry[DE.key(cx, cy)]];
      const qx = sx - cx * 2, qy = sy - cy * 2;
      for (const e of sp.exits) { // keep a doorway's mouth (the two quarters at its edge) clear
        if (e.cell.x !== cx || e.cell.y !== cy) continue;
        if ((e.facing === 'N' && qy === 0) || (e.facing === 'S' && qy === 1) ||
            (e.facing === 'W' && qx === 0) || (e.facing === 'E' && qx === 1)) return false;
      }
      const x0 = sx / 2, y0 = sy / 2;
      const ex = Math.max(x0 - p.x, 0, p.x - x0 - 0.5), ey = Math.max(y0 - p.y, 0, p.y - y0 - 0.5);
      return !(Math.hypot(ex, ey) < RADIUS + 0.02 && Math.abs(base - p.z) < JAR_H); // not onto the figure
    });
  }

  /** A placed jar right in front of you. */
  function jarAhead(p) {
    const fx = Math.sin(p.angle), fy = Math.cos(p.angle);
    let best = null, bestD = RADIUS + 0.32;
    for (const j of state.jars) {
      const b = j.block;
      const qx = THREE.MathUtils.clamp(p.x, b.x0, b.x1), qy = THREE.MathUtils.clamp(p.y, b.y0, b.y1);
      const d = Math.hypot(qx - p.x, qy - p.y);
      if (d >= bestD) continue;
      const cx = (b.x0 + b.x1) / 2 - p.x, cy = (b.y0 + b.y1) / 2 - p.y;
      if ((cx * fx + cy * fy) / (Math.hypot(cx, cy) || 1) < 0.2) continue;
      bestD = d;
      best = j;
    }
    return best;
  }

  /** E at a placed jar: lift it (with whatever's inside) into the hotbar. */
  function jarNear(p) {
    const j = jarAhead(p);
    return j ? { action: 'pickjar', jar: j } : null;
  }

  function pickUpJar(rec) {
    removeJarFromWorld(rec);
    state.run.jars.push({ id: rec.id, fill: rec.fill });
    state.sel = 'jar:' + rec.id;
    W.showCaption(rec.fill ? `you lift the jar · ${rec.fill} hash ghost${rec.fill === 1 ? '' : 's'} inside` : 'you lift the jar');
    savePlayer();
    W.refreshHud();
  }

  /** What F would do right now with the selected item, or null. */
  function useNear(p) {
    const slot = selectedSlot();
    if (!slot || state.paused || state.climb) return null;
    if (slot.kind === 'jar') {
      const spot = jarSpot(p);
      return spot ? { action: 'place', slot, spot } : null;
    }
    if (slot.kind === 'chalk') {
      const spot = markSpot(p);
      return spot ? { action: 'mark', slot, spot } : null;
    }
    if (slot.kind === 'doorstone') {
      const w = W.wallNear(p);
      return w ? Object.assign(w, { slot }) : null;
    }
    return null;
  }

  function useSelected() {
    const run = state.run;
    const u = useNear(state.player);
    if (!u) { shakeHotbar(); return; } // "that didn't work"
    if (u.action === 'place') {
      const j = u.slot.jar;
      run.jars = run.jars.filter((o) => o !== j);
      addJarToWorld({ id: j.id, sx: u.spot.sx, sy: u.spot.sy, fill: j.fill });
    } else if (u.action === 'carve') {
      W.carveDoor(u);
      return;
    } else if (u.action === 'mark') {
      drawMark(u);
    }
    savePlayer();
    W.refreshHud();
  }

  /** A following ghost that drifts into a jar with room is caught in it. */
  function jarCatches(g) {
    for (const j of state.jars) {
      if (j.fill >= RULES.jarCapacity) continue;
      if (Math.hypot(g.x - (j.block.x0 + 0.25), g.y - (j.block.y0 + 0.25)) < 0.38) return j;
    }
    return null;
  }

  /**
   * Jars in rooms about to collapse shatter; any ghosts inside come undone
   * with the room (noted in run.unmade, like ghosts caught in a collapse).
   */
  function shatterJarsIn(ids) {
    const reg = state.exp.registry;
    let ghosts = 0, n = 0;
    for (const j of state.jars.slice()) {
      const room = reg[DE.key(Math.floor(j.block.x0), Math.floor(j.block.y0))];
      if (!ids.has(room)) continue;
      ghosts += j.fill;
      for (let i = 0; i < j.fill; i++) noteUnmade('jar:' + j.id, room);
      n++;
      removeJarFromWorld(j);
    }
    return { n, ghosts };
  }

  /** A ghost undone by a collapse. Kept as a tally and a short log; no use yet. */
  function noteUnmade(ghostId, room) {
    const u = state.run.unmade;
    u.count++;
    u.log.push({ ghost: ghostId, room, at: Math.round(state.run.walked) });
    if (u.log.length > 50) u.log.shift();
  }

  function updateJars() {
    for (const j of state.jars) {
      j.mesh.userData.wisps.forEach((w, i) => {
        w.visible = i < j.fill;
        const a = state.time * 1.3 + i * 2.1;
        w.position.set(Math.cos(a) * 0.06 * S, (0.09 + i * 0.075 + Math.sin(a * 1.7) * 0.02) * S, Math.sin(a) * 0.06 * S);
      });
    }
  }

  // --- sigil tiles

  function sigilTexture(seed) {
    const n = 256, cv = document.createElement('canvas');
    cv.width = cv.height = n;
    const g = cv.getContext('2d');
    const r = DE.createRng(seed);
    const c = n / 2;
    g.strokeStyle = '#fff';
    g.fillStyle = '#fff';
    g.lineCap = 'round';
    g.lineWidth = n * 0.022;
    g.beginPath(); g.arc(c, c, n * 0.44, 0, Math.PI * 2); g.stroke();
    g.lineWidth = n * 0.012;
    g.beginPath(); g.arc(c, c, n * 0.37, 0, Math.PI * 2); g.stroke();
    // A star polygon {k/step}; for six points, a hexagram (two triangles).
    const k = r.int(5, 8), rot = r.next() * Math.PI * 2;
    const pt = (a) => [c + Math.cos(a) * n * 0.37, c + Math.sin(a) * n * 0.37];
    const poly = (count, step, off) => {
      g.beginPath();
      for (let i = 0; i <= count; i++) {
        const [x, y] = pt(rot + off + (i * step % count) / count * Math.PI * 2);
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
    };
    g.lineWidth = n * 0.016;
    if (k === 6) { poly(3, 1, 0); poly(3, 1, Math.PI / 3); }
    else poly(k, k === 5 ? 2 : 3, 0);
    // Glyph marks between the rings, and an eye in the middle.
    const marks = r.int(7, 12);
    g.lineWidth = n * 0.01;
    for (let i = 0; i < marks; i++) {
      const a = i / marks * Math.PI * 2 + rot;
      const x = c + Math.cos(a) * n * 0.405, y = c + Math.sin(a) * n * 0.405;
      g.beginPath();
      const t = r.int(0, 2);
      if (t === 0) { g.arc(x, y, n * 0.012, 0, Math.PI * 2); g.fill(); }
      else if (t === 1) { g.moveTo(x - n * 0.015, y); g.lineTo(x + n * 0.015, y); g.moveTo(x, y - n * 0.015); g.lineTo(x, y + n * 0.015); g.stroke(); }
      else { g.moveTo(x - n * 0.012, y + n * 0.012); g.lineTo(x, y - n * 0.014); g.lineTo(x + n * 0.012, y + n * 0.012); g.stroke(); }
    }
    g.lineWidth = n * 0.014;
    g.beginPath(); g.arc(c, c, n * 0.07, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(c, c, n * 0.025, 0, Math.PI * 2); g.fill();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // Shared bits for the sigils' energy: a beam (an open cylinder with a
  // gradient fading upward), a ground ring, rising motes, a flash, and a
  // small pool of violet lights handed to the strongest sigils near you.
  const fxTex = (() => {
    const beam = document.createElement('canvas');
    beam.width = 4; beam.height = 64;
    let g = beam.getContext('2d');
    let grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = grad; g.fillRect(0, 0, 4, 64);
    const dot = document.createElement('canvas');
    dot.width = dot.height = 32;
    g = dot.getContext('2d');
    grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
    return { beam: new THREE.CanvasTexture(beam), dot: new THREE.CanvasTexture(dot) };
  })();
  const fxGeo = {
    beam: new THREE.CylinderGeometry(1, 1, 1, 24, 1, true),
    ring: new THREE.RingGeometry(0.82, 1, 48),
  };
  const addMat = (color, map) => new THREE.MeshBasicMaterial({
    color, map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const MOTES = 40;
  const sigilLights = [0, 1].map(() => {
    const l = new THREE.PointLight(0xa86bff, 0, 3.6 * S, 1.6); // lights its surroundings; no shadows (cost)
    scene.add(l);
    return l;
  });

  function makeSigilFx() {
    const group = new THREE.Group();
    const outer = new THREE.Mesh(fxGeo.beam, addMat(0x9a63ff, fxTex.beam));
    const core = new THREE.Mesh(fxGeo.beam, addMat(0xf0e2ff, fxTex.beam));
    const ring = new THREE.Mesh(fxGeo.ring, addMat(0xb98aff));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    const pos = new Float32Array(MOTES * 3);
    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const motes = new THREE.Points(pgeo, new THREE.PointsMaterial({
      color: 0xd2b0ff, size: 0.09 * S, map: fxTex.dot, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: fxTex.dot, color: 0xe8d4ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    flash.position.y = 0.4 * S;
    group.add(outer, core, ring, motes, flash);
    group.visible = false;
    scene.add(group);
    const seeds = Array.from({ length: MOTES }, () => [Math.random(), Math.random() * Math.PI * 2, Math.random()]);
    return { group, outer, core, ring, motes, flash, seeds, flashT: 9, full: 0 };
  }

  /** Add a space's sigil (if any) to its tile. Called from buildSpace. */
  function addSigil(space, tileAt) {
    const sg = DP.sigil(space);
    if (!sg) return;
    const tile = tileAt[DE.key(sg.cell.x, sg.cell.y)];
    if (!tile) return;
    const mat = new THREE.MeshBasicMaterial({
      map: sigilTexture(sg.seed), color: 0xb59cff, transparent: true, opacity: 0.22,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo.decal, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.056;
    tile.add(mesh);
    const fx = makeSigilFx();
    fx.group.position.set((sg.cell.x + 0.5) * S, 0, (sg.cell.y + 0.5) * S);
    state.sigils.set(space.id, { cell: sg.cell, mat, stage: -1, phase: Math.random() * 10, fx });
  }

  /** Beams, motes and the floor ring for one sigil, by stage and full jars. */
  function animateSigilFx(sg, stage, full, dt) {
    const f = sg.fx, t = state.time + sg.phase;
    f.group.visible = stage > 0 || f.flashT < 0.8;
    if (!f.group.visible) return;
    if (full > f.full) f.flashT = 0; // a jar just filled (or a full one set down): flash
    f.full = full;
    f.flashT += dt;
    // stage:      0     1      2      3+ (a full jar)
    const R = [0, 0.05, 0.075, 0.2 + 0.04 * Math.max(0, full - 1)][stage];
    const H = [0, 0.9, 1.35, 4][stage];
    const OP = [0, 0.32, 0.45, 0.55][stage];
    const pulse = stage === 3 ? 0.85 + 0.15 * Math.sin(t * 3.2) : 0.92 + 0.08 * Math.sin(t * 7);
    f.outer.scale.set(R * S, H * S, R * S);
    f.outer.position.y = H * S / 2;
    f.outer.material.opacity = OP * pulse;
    f.core.visible = stage >= 2;
    const cr = stage === 3 ? 0.07 : 0.022;
    f.core.scale.set(cr * S, H * S, cr * S);
    f.core.position.y = H * S / 2;
    f.core.material.opacity = (stage === 3 ? 0.95 : 0.55) * pulse;
    // The energy ring radiates outward along the floor once a jar is full.
    f.ring.visible = stage === 3;
    if (f.ring.visible) {
      const k = (t * 0.8) % 1;
      f.ring.scale.setScalar((0.25 + 1.1 * k) * S);
      f.ring.material.opacity = 0.6 * (1 - k);
    }
    // Rising motes: a few at stage 1, more at 2, a fountain at 3.
    const n = [0, 6, 14, MOTES][stage];
    const speed = [0, 0.3, 0.45, 1.1][stage], spread = [0, 0.08, 0.12, 0.38][stage];
    const pos = f.motes.geometry.attributes.position.array;
    for (let i = 0; i < n; i++) {
      const [ph, ang, rr] = f.seeds[i];
      const u = (t * speed * (0.7 + rr * 0.6) + ph) % 1;
      const r = spread * (0.3 + rr * 0.7) * (stage === 3 ? 0.5 + u : 1);
      pos[i * 3] = Math.cos(ang + t * 0.6) * r * S;
      pos[i * 3 + 1] = u * H * 0.9 * S;
      pos[i * 3 + 2] = Math.sin(ang + t * 0.6) * r * S;
    }
    f.motes.geometry.setDrawRange(0, n);
    f.motes.geometry.attributes.position.needsUpdate = true;
    // Flash: a quick bright bloom.
    const ft = f.flashT;
    f.flash.visible = ft < 0.8;
    if (f.flash.visible) {
      f.flash.scale.setScalar((0.6 + ft * 3.2) * S);
      f.flash.material.opacity = Math.max(0, 1 - ft / 0.8);
    }
  }

  /**
   * A sigil takes up to four jars, one per quarter of its tile. Its stage is
   * the fullest jar's fill (0-3); every full jar on it is +1 entropy max.
   */
  function updateSigils(dt) {
    let powered = 0;
    const lit = [];
    for (const sg of state.sigils.values()) {
      let stage = 0, full = 0;
      for (const j of state.jars) {
        if (Math.floor(j.sx / 2) !== sg.cell.x || Math.floor(j.sy / 2) !== sg.cell.y) continue;
        stage = Math.max(stage, Math.min(3, j.fill));
        if (j.fill >= RULES.jarCapacity) full++;
      }
      if (sg.stage !== -1 && stage > sg.stage && stage < 3) W.showCaption(`the sigil stirs · stage ${stage} of 3`);
      if (sg.stage === -1) sg.fx.full = full; // no flash for sigils already lit when the run loads
      sg.stage = stage;
      powered += full;
      const t = state.time + sg.phase;
      const flicker = stage === 0 ? 1 : stage === 1 ? 0.9 + 0.1 * Math.sin(t * 9)
        : stage === 2 ? 0.75 + 0.25 * Math.abs(Math.sin(t * 13) * Math.sin(t * 5.3)) : 0.85 + 0.15 * Math.sin(t * 3);
      sg.mat.opacity = [0.22, 0.45, 0.7, 1][stage] * flicker * (1 + 0.15 * Math.max(0, full - 1));
      sg.mat.color.setHex(stage === 3 ? 0xffd28a : stage === 2 ? 0xd2a8ff : 0xb59cff);
      animateSigilFx(sg, stage, full, dt || 0);
      if (stage === 3 || sg.fx.flashT < 0.8) lit.push(sg);
    }
    // Hand the violet lights to the nearest powered sigils.
    const p = state.player;
    lit.sort((a, b) => Math.hypot(a.cell.x + 0.5 - p.x, a.cell.y + 0.5 - p.y) - Math.hypot(b.cell.x + 0.5 - p.x, b.cell.y + 0.5 - p.y));
    sigilLights.forEach((l, i) => {
      const sg = lit[i];
      if (!sg) { l.intensity = 0; return; }
      l.position.set((sg.cell.x + 0.5) * S, 0.9 * S, (sg.cell.y + 0.5) * S);
      const spike = Math.max(0, 1 - sg.fx.flashT / 0.6) * 14;
      const base = sg.stage === 3 ? 5 + 1.5 * Math.max(0, sg.fx.full - 1) : 0;
      l.intensity = (base * (0.9 + 0.1 * Math.sin(state.time * 6 + i))) + spike;
    });
    if (powered !== state.buff) {
      const up = powered > state.buff;
      state.buff = powered;
      if (state.buffReady) {
        W.showCaption(up ? `the sigil blazes · entropy max ${maxCharges()}` : `a sigil dims · entropy max ${maxCharges()}`);
      }
      W.refreshHud();
    }
    state.buffReady = true;
  }

  Object.assign(W, { STROKES, maxCharges, slots, select, refreshHotbar, addMarkToWorld,
    removeMarkFromWorld, clearMarks, markNear, wipeMarksIn, makeJarMesh, addJarToWorld,
    clearJars, jarNear, pickUpJar, useNear, useSelected, jarCatches, shatterJarsIn, noteUnmade,
    updateJars, addSigil, updateSigils });
})(window);
