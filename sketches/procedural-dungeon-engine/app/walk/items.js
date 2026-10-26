// Walk mode: what you carry and leave behind. The hotbar, chalk marks,
// jars and sigil tiles.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, DP, RULES, THREE, $, S, RADIUS, PICKUP_RANGE, scene, state, CHALK, el, savePlayer,
    geo, doorMat, passable } = W;

  // ---------------------------------------------------------------------------
  // Inventory: the hotbar, chalk marks, jars and sigils
  //
  // E interacts with the world (doors, climbing, lifting a jar, wiping a
  // chalk mark you face): one focused thing (actionNear in actions.js).
  // F uses what's in your hand, the item selected on the hotbar. Slot 1 is
  // always the lantern (empty hands): F covers or relights it. Otherwise:
  // draw a chalk mark, set a jar down, press a doorstone to a wall. 1-9 or
  // the wheel select. A slot can hold a group of variants (chalk colours):
  // click it again, or press and hold, to open its picker; its number key
  // again cycles. F with an empty jar near a pixie catches it (pixies.js);
  // a pixie jar set down draws ghosts to it, and on a sigil tile it powers
  // the sigil: +1 entropy max per pixie jar on it.

  const JAR_H = 0.38; // cells
  const STROKES = 3;  // chalk marks per stick

  function maxCharges() { return RULES.chargesMax + state.buff; }

  // ---------------------------------------------------------------------------
  // Item kinds. Every item in a room's loot belongs to one of three classes,
  // and the class decides how it lives in the world and in your hands:
  //
  //   pickup  floats and turns where it lies; walk into it to collect it.
  //           Counted on the HUD, never on the hotbar.
  //   tool    lies flat on the floor; walk over it to collect it. Carried on
  //           the hotbar and used up with F (a key too: F at a locked door),
  //           never put back. Collected, it goes in the bag, never into
  //           your hands.
  //   object  a thing in the world as itself (crates, push blocks and
  //           vessels, restore.js). Never in the bag: hold E to lift it,
  //           E again to set it down.
  //
  // `take(run, item)` adds a pickup or tool to the run and returns its caption.
  const ITEMS = {
    shard: {
      cls: 'pickup',
      take(run) {
        run.shardsFound++;
        // A shard is a third of a charge, poured straight into the lamp.
        return W.gainFuel(1 / RULES.shardsPerCharge) > 0 ? 'a shard · your lamp takes it' : 'a shard · your entropy is full';
      },
    },
    key: {
      cls: 'tool',
      take(run) {
        run.keys++;
        run.keysFound++;
        return `a key · ${W.verbF} with it in hand at a locked door unlocks it`;
      },
    },
    doorstone: {
      cls: 'tool',
      take(run) {
        run.doorstones++;
        return `a doorstone · ${W.verbF} at a bare wall to open a door there`;
      },
    },
    chalk: {
      cls: 'tool',
      take(run, item) {
        const color = item.color || 'silver';
        run.chalks[color] = (run.chalks[color] || 0) + STROKES;
        run.chalkFound++;
        return `a stick of ${color} chalk · ${W.verbF} to draw a ${CHALK[color].name}`;
      },
    },
    thread: {
      cls: 'pickup',
      take(run) {
        run.thread = true;
        return 'a spool of thread · now a path lost to a faint can be retraced, at its door';
      },
    },
    jar: {
      cls: 'tool',
      take(run) {
        run.jars.push({ id: 'j' + (++run.jarSeq), holds: null });
        return `an empty jar · ${W.verbF} swipes it: catch a pixie, fill it at a well, pour it into a vessel`;
      },
    },
  };

  const shardMat = new THREE.MeshLambertMaterial({ color: 0xb59cff, emissive: 0x2c1a66 });
  const keyMat = new THREE.MeshLambertMaterial({ color: 0xe2b84a, emissive: 0x3a2606 });
  const chalkMat = new THREE.MeshLambertMaterial({ color: 0xf2efe6, emissive: 0x3a3a3a });
  const threadMat = new THREE.MeshLambertMaterial({ color: 0xcdbcff, emissive: 0x3a2a7a });
  const threadGeo = new THREE.TorusGeometry(0.07 * S, 0.035 * S, 8, 16);

  /**
   * A pickup's or tool's mesh, centred on its spot. Pickups float (see
   * updateItems); tools lie on the floor at a seeded angle.
   */
  function itemMesh(item, key) {
    const mesh = new THREE.Group();
    if (item.kind === 'shard') {
      mesh.add(new THREE.Mesh(geo.shard, shardMat));
    } else if (item.kind === 'key') {
      const flat = new THREE.Group(); // lying on its side
      const ring = new THREE.Mesh(geo.keyRing, keyMat);
      ring.position.x = -0.1 * S;
      const shaft = new THREE.Mesh(geo.keyShaft, keyMat);
      shaft.position.x = 0.04 * S;
      flat.add(ring, shaft);
      flat.rotation.x = -Math.PI / 2;
      flat.position.y = 0.02 * S;
      mesh.add(flat);
    } else if (item.kind === 'doorstone') {
      const flat = new THREE.Group(); // the slab laid on its back, inset facing up
      const slab = new THREE.Mesh(geo.doorstone, chalkMat);
      const inset = new THREE.Mesh(geo.doorstoneInset, doorMat);
      inset.position.set(0, -0.015 * S, 0.026 * S);
      flat.add(slab, inset);
      flat.rotation.x = -Math.PI / 2;
      flat.position.y = 0.025 * S;
      mesh.add(flat);
    } else if (item.kind === 'jar') {
      const jar = makeJarMesh();
      jar.scale.setScalar(0.55);
      mesh.add(jar);
    } else if (item.kind === 'thread') {
      const spool = new THREE.Mesh(threadGeo, threadMat); // a coil, standing on its edge
      mesh.add(spool);
    } else if (item.kind === 'chalk') {
      const stick = new THREE.Mesh(geo.chalk, new THREE.MeshLambertMaterial({
        color: (CHALK[item.color] || CHALK.silver).hex, emissive: 0x2a2a2a,
      }));
      stick.rotation.z = Math.PI / 2; // lying on its side
      stick.position.y = 0.03 * S;
      mesh.add(stick);
    }
    for (const m of mesh.children) m.castShadow = true;
    if (ITEMS[item.kind].cls === 'tool') mesh.rotation.y = parseInt(DE.hash(key, 'yaw').slice(-4), 16) / 65536 * Math.PI * 2;
    return mesh;
  }

  /** Pickups bob and turn; everything lying in a room grows and shrinks with its tile. */
  function updateItems() {
    for (const it of state.items.values()) {
      const r = it.tile ? it.tile.scale.x : 1;
      it.mesh.scale.setScalar(Math.max(0.001, r));
      if (ITEMS[it.item.kind].cls !== 'pickup') continue;
      it.mesh.rotation.y = state.time * 1.6;
      it.mesh.position.y = (0.45 + 0.05 * Math.sin(state.time * 2.4 + it.item.cell.x)) * S;
    }
  }

  /** Walking into a pickup or over a tool collects it. */
  function collectPickups(p) {
    if (p.z > 0.05) return;
    for (const [k, it] of state.items) {
      if (ITEMS[it.item.kind].cls === 'object') continue;
      const dx = p.x - (it.item.cell.x + 0.5), dy = p.y - (it.item.cell.y + 0.5);
      if (dx * dx + dy * dy <= PICKUP_RANGE * PICKUP_RANGE) takeItem(k, it);
    }
  }

  function takeItem(k, it) {
    state.run.collected.push(k);
    it.mesh.parent.remove(it.mesh);
    state.items.delete(k);
    W.showCaption(ITEMS[it.item.kind].take(state.run, it.item));
    savePlayer();
    W.refreshHud();
  }

  /**
   * The hotbar's slots, built from the run's tools and objects (pickups are
   * counters on the HUD). A slot with `variants` is a group (one slot,
   * several kinds); `cur` is the variant in use, remembered per group in
   * state.variant.
   */
  function slots() {
    const run = state.run, out = [{ key: 'lantern', kind: 'lantern' }]; // empty hands
    if (run.jars.length) {
      // One slot for every jar, grouped by what it holds: empty, a pixie, a
      // charge of entropy. The group you pick is the jar in your hands.
      const variants = [];
      for (const holds of JAR_HOLDS) {
        const count = run.jars.filter((j) => (j.holds || null) === holds).length;
        if (count) variants.push({ id: holds || 'empty', holds, count });
      }
      const cur = variants.find((v) => v.id === state.variant.jar) || variants[0];
      out.push({ key: 'jar', kind: 'jar', variants, cur, count: run.jars.length });
    }
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
    if (state.carry) { shakeHotbar(); return; } // set the block down first
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
    W.showCaption(slot.kind === 'jar' ? `jars · ${jarVariantName(v)}` : `${v.color} chalk · ${CHALK[v.color].name}`);
    refreshHotbar();
  }

  const ICON = { jar: '⚱', doorstone: '⌂', key: '⚷' };
  const NAME = {
    lantern: 'your lantern (empty hands): F covers or relights it',
    doorstone: 'doorstone: F at a bare wall opens a door',
    key: 'key: F at a locked door unlocks it',
  };
  // The lantern slot's icon: a small copy of the lamp HUD's lantern.
  const LANTERN_SVG = '<svg viewBox="0 0 24 32" width="15" height="20"><path d="M8 6 a4 4 0 0 1 8 0" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
    '<rect x="6" y="6" width="12" height="3" rx="1" fill="currentColor"/><rect x="7" y="9" width="10" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
    '<path d="M12 12 C15 16 15 19 12 22 C9 19 9 16 12 12 Z" fill="#ffc27a"/><rect x="6" y="25" width="12" height="3" rx="1" fill="currentColor"/></svg>';
  const JAR_HOLDS = [null, 'pixie', 'entropy'];
  /** "empty jar", "pixie jar", "jar of entropy". */
  const jarName = (j) => (j.holds === 'pixie' ? 'pixie jar' : j.holds === 'entropy' ? 'jar of entropy' : 'empty jar');
  const jarVariantName = (v) => `${jarName(v)} · ${v.count} jar${v.count === 1 ? '' : 's'}`;

  /** A jar group's icon: what it holds and how many. */
  function jarIcon(v) {
    const w = el('span', 'jaric');
    w.append(el('span', 'ic', ICON.jar));
    const pips = el('span', 'fill');
    pips.append(el('i', v.holds === 'pixie' ? 'on' : v.holds === 'entropy' ? 'ent' : ''));
    w.append(pips);
    if (v.count > 1) w.append(el('span', 'ct', '×' + v.count));
    return w;
  }
  const variantIcon = (kind, v) => (kind === 'jar' ? jarIcon(v) : chalkIcon(v));
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
    updateHeld(cur);
    s.forEach((slot, i) => {
      const b = el('button', 'slot' + (cur && slot.key === cur.key ? ' on' : '') + ' ' + slot.kind);
      b.type = 'button';
      b.append(el('span', 'n', String(i + 1)));
      if (slot.kind === 'chalk') {
        b.title = `chalk (${slot.variants.length} colour${slot.variants.length === 1 ? '' : 's'}): F draws a mark, E on one wipes it; click again or hold to pick a colour`;
      } else if (slot.kind === 'jar') {
        b.title = `jars (${slot.count}): E sets the one in your hands down, F swipes it (a pixie, a full well) or pours it; ${jarVariantName(slot.cur)}` +
          (slot.variants.length > 1 ? '; click again or hold to choose' : '');
      } else if (slot.kind === 'lantern') {
        b.title = NAME.lantern;
        const ic = el('span', 'ic');
        ic.innerHTML = LANTERN_SVG;
        b.append(ic);
      } else {
        b.title = NAME[slot.kind];
        b.append(el('span', 'ic', ICON[slot.kind]));
        b.append(el('span', 'ct', String(slot.count)));
      }
      if (slot.variants) {
        b.append(variantIcon(slot.kind, slot.cur));
        if (slot.variants.length > 1) b.append(el('span', 'more', '▴'));
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
        if (state.carry) { shakeHotbar(); return; } // set the block down first
        if (slot.variants && state.sel === slot.key) state.expanded = state.expanded === slot.key ? null : slot.key;
        else { state.sel = slot.key; state.expanded = null; }
        refreshHotbar();
      });
      if (slot.variants && state.expanded === slot.key) {
        const pop = el('div', 'picker');
        for (const v of slot.variants) {
          const vb = el('button', 'pick' + (v.id === slot.cur.id ? ' on' : ''));
          vb.type = 'button';
          vb.title = slot.kind === 'jar' ? jarVariantName(v)
            : `${v.color} chalk · ${CHALK[v.color].name} · ${v.strokes} stroke${v.strokes === 1 ? '' : 's'}`;
          vb.append(variantIcon(slot.kind, v));
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
      if (bl.jar || bl.push || bl.units !== 1 || !(bl.x0 <= x0 && bl.x1 >= x1 && bl.y0 <= y0 && bl.y1 >= y1)) return null;
      base = Math.max(base, bl.top);
    }
    return base;
  }

  /**
   * The free quarter nearest a point just ahead of you, among those in
   * front; `ok(sx, sy, base)` filters. `surface(sx, sy)` is the height
   * something would rest at there, or null (quarterSurface by default).
   */
  function quarterAhead(p, ok, surface = quarterSurface) {
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
      const base = surface(c.sx, c.sy);
      if (base !== null && ok(c.sx, c.sy, base)) return { sx: c.sx, sy: c.sy, base };
    }
    return null;
  }

  function markSpot(p) {
    return quarterAhead(p, (sx, sy) => !state.marks.some((m) => m.sx === sx && m.sy === sy));
  }

  /** E at a mark you're facing, close by (or underfoot and ahead): wipe it. */
  const MARK_REACH = 0.7; // cells, to the mark's centre
  function markNear(p) {
    const fx = Math.sin(p.angle), fy = Math.cos(p.angle);
    let best = null, bestD = MARK_REACH;
    for (const m of state.marks) {
      if (Math.abs((m.base || 0) - p.z) > 0.2 || !quarterReachable(m.sx, m.sy, p)) continue;
      const dx = m.sx / 2 + 0.25 - p.x, dy = m.sy / 2 + 0.25 - p.y, d = Math.hypot(dx, dy);
      if (d >= bestD || (d > 0.1 && (dx * fx + dy * fy) / d < 0.3)) continue;
      bestD = d;
      best = { action: 'erase', mark: m };
    }
    return best;
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
  const jarWispMat = new THREE.MeshBasicMaterial({ color: 0xd9b3ff, transparent: true, opacity: 0.95 }); // a pixie inside
  const jarLiquidMat = new THREE.MeshBasicMaterial({ color: 0x9a63ff, transparent: true, opacity: 0.75 }); // a charge of entropy
  jarGeo.liquid = new THREE.CylinderGeometry(0.145 * S, 0.17 * S, 0.2 * S, 18);

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
    const liquid = new THREE.Mesh(jarGeo.liquid, jarLiquidMat);
    liquid.position.y = 0.11 * S;
    liquid.visible = false;
    g.add(liquid);
    g.userData.liquid = liquid;
    g.userData.wisps = [0, 1, 2].map(() => {
      const w = new THREE.Mesh(jarGeo.wisp, jarWispMat);
      w.visible = false;
      g.add(w);
      return w;
    });
    return g;
  }

  /** Is quarter (sx, sy) in a doorway's mouth (one of the two quarters at a door's edge)? */
  function inDoorMouth(sx, sy) {
    const cx = Math.floor(sx / 2), cy = Math.floor(sy / 2);
    const sp = state.exp.spaces[state.exp.registry[DE.key(cx, cy)]];
    const qx = sx - cx * 2, qy = sy - cy * 2;
    for (const e of sp ? sp.exits : []) {
      if (e.cell.x !== cx || e.cell.y !== cy) continue;
      if ((e.facing === 'N' && qy === 0) || (e.facing === 'S' && qy === 1) ||
          (e.facing === 'W' && qx === 0) || (e.facing === 'E' && qx === 1)) return true;
    }
    return false;
  }

  /** The jar in your hands (one of the selected group's), or null. */
  function heldJar() {
    const slot = selectedSlot();
    if (!slot || slot.kind !== 'jar' || state.carry) return null;
    return state.run.jars.find((j) => (j.holds || null) === slot.cur.holds) || null;
  }

  /** What F would do right now with the selected item, or null. */
  function useNear(p) {
    const slot = selectedSlot();
    if (!slot || state.paused || state.climb || state.carry) return null; // a block fills your hands
    // An unpowered waystone right in front of you comes first: your lamp's
    // flame (a charge) or a full jar (its entropy or its pixie) wakes it.
    const st = stoneAhead(p);
    if (st && slot.kind === 'lantern') return { action: 'powerlamp', slot, stone: st };
    if (st && slot.kind === 'jar') {
      const jar = heldJar();
      if (jar && jar.holds) return { action: 'power', slot, jar, stone: st };
    }
    if (slot.kind === 'lantern') return { action: 'lamp', slot };
    if (slot.kind === 'key') {
      const door = W.doorNear(p);
      return door && door.action === 'locked' ? { action: 'unlock', slot, door } : null;
    }
    if (slot.kind === 'jar') {
      // F swipes the jar in your hands (setting it down is E). Empty, it
      // catches a pixie close by, or scoops a full well you stand in; with
      // entropy in it, it pours into your lamp. Anything else: a swipe at air.
      const jar = heldJar();
      if (!jar) return null;
      // A vessel right in front of you comes first: pour the jar in, or take one out.
      const v = vesselAhead(p);
      if (v) {
        const room = !v.n || (v.holds === jar.holds && v.n < RULES.vesselCapacity);
        if (jar.holds && room) return { action: 'deposit', slot, jar, vessel: v };
        if (!jar.holds && v.n) return { action: 'withdraw', slot, jar, vessel: v };
        return { action: 'vesselno', slot, jar, vessel: v };
      }
      if (jar.holds === 'entropy') return { action: 'pour', slot, jar };
      if (jar.holds) return { action: 'swipe', slot, jar };
      const px = W.pixieNear(p);
      if (px) return { action: 'catch', slot, pixie: px, jar };
      const w = W.wellHere();
      if (w) return { action: 'scoop', slot, jar, well: w, full: W.wellLevel(w) >= RULES.wellCapacity - 1e-3 };
      return { action: 'swipe', slot, jar };
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
    if (!u && state.carry) W.showCaption('your hands are full · E to set it down');
    if (!u) { shakeHotbar(); return; } // "that didn't work"
    if (u.action === 'lamp') { W.toggleLamp(); return; }
    if (u.action === 'powerlamp') { W.powerStone(u.stone, null); return; }
    if (u.action === 'power') {
      swipeAt = state.time;
      W.powerStone(u.stone, u.jar);
      state.variant.jar = 'empty';
      W.refreshHotbar();
      return;
    }
    if (u.action === 'unlock') { W.unlockDoor(u.door); return; }
    if (u.slot && u.slot.kind === 'jar') { // every jar action is a swipe of it
      swipeAt = state.time;
      if (u.action === 'catch') W.catchPixie(u.pixie, u.jar);
      else if (u.action === 'scoop') {
        if (u.full) W.scoopWell(u.well, u.jar);
        else W.showCaption('the well isn\'t full enough to fill a jar');
      } else if (u.action === 'pour') pourJar(u.jar);
      else if (u.action === 'deposit') deposit(u.jar, u.vessel);
      else if (u.action === 'withdraw') withdraw(u.jar, u.vessel);
      else if (u.action === 'vesselno') W.showCaption(u.vessel.n >= RULES.vesselCapacity ? 'the vessel is full'
        : `the vessel holds ${u.vessel.holds === 'pixie' ? 'pixies' : 'entropy'}, not ${u.jar.holds === 'pixie' ? 'a pixie' : 'entropy'}`);
      state.variant.jar = u.jar.holds || 'empty'; // the same jar stays in your hands
      savePlayer();
      W.refreshHud();
      return;
    }
    if (u.action === 'carve') {
      W.carveDoor(u);
      return;
    } else if (u.action === 'mark') {
      drawMark(u);
    }
    savePlayer();
    W.refreshHud();
  }

  // --- vessels: loose objects (restore.js) that hold up to
  // RULES.vesselCapacity of one kind. A jar pours into one, or takes one out.

  /** A vessel right in front of you, in reach (your level or one up). */
  function vesselAhead(p) { return objectAhead(p, (b) => b.vessel); }
  /** An unpowered waystone right in front of you, in reach. */
  function stoneAhead(p) { return objectAhead(p, (b) => b.waystone && !b.holds); }
  function objectAhead(p, want) {
    const fx = Math.sin(p.angle), fy = Math.cos(p.angle), mine = Math.round(p.z / W.UNIT);
    let best = null, bestD = RADIUS + 0.35;
    for (const b of state.pushBlocks) {
      if (!want(b) || b.carried || b.anim) continue;
      const lv = Math.round((b.base || 0) / W.UNIT);
      if (lv !== mine && lv !== mine + 1) continue;
      const qx = THREE.MathUtils.clamp(p.x, b.x0, b.x1), qy = THREE.MathUtils.clamp(p.y, b.y0, b.y1);
      const d = Math.hypot(qx - p.x, qy - p.y);
      const cx = (b.x0 + b.x1) / 2 - p.x, cy = (b.y0 + b.y1) / 2 - p.y;
      if (d >= bestD || (cx * fx + cy * fy) / (Math.hypot(cx, cy) || 1) < 0.3) continue;
      bestD = d;
      best = b;
    }
    return best;
  }
  const holdsName = (h, n) => (h === 'pixie' ? (n === 1 ? 'a pixie' : n + ' pixies') : (n === 1 ? 'a charge of entropy' : n + ' charges of entropy'));
  function deposit(jar, v) {
    v.holds = jar.holds;
    v.n = (v.n || 0) + 1;
    jar.holds = null;
    W.saveObject(v);
    W.showCaption(`you pour the jar into the vessel · it holds ${holdsName(v.holds, v.n)}`);
  }
  function withdraw(jar, v) {
    jar.holds = v.holds;
    v.n--;
    if (!v.n) v.holds = null;
    W.saveObject(v);
    W.showCaption(v.n ? `you take ${jar.holds === 'pixie' ? 'a pixie' : 'a charge'} back out · ${holdsName(v.holds, v.n)} left` : 'you take the last one out · the vessel is empty');
  }

  // A vessel: a squat clay urn. What's inside shows at its mouth: pixies
  // flit above it, entropy glows in it, brighter the more there is.
  const vesselGeo = {
    body: new THREE.CylinderGeometry(0.15 * S, 0.12 * S, 0.24 * S, 16),
    belly: new THREE.SphereGeometry(0.17 * S, 16, 10),
    rim: new THREE.TorusGeometry(0.1 * S, 0.025 * S, 6, 16),
    mouth: new THREE.CircleGeometry(0.09 * S, 16),
  };
  const clayMat = new THREE.MeshLambertMaterial({ color: 0x8a5a3c, emissive: 0x1a0c06 });
  function makeVesselMesh() {
    const g = new THREE.Group();
    const belly = new THREE.Mesh(vesselGeo.belly, clayMat);
    belly.scale.y = 0.85;
    belly.position.y = 0.15 * S;
    const neck = new THREE.Mesh(vesselGeo.body, clayMat);
    neck.scale.set(0.75, 0.5, 0.75);
    neck.position.y = 0.3 * S;
    const rim = new THREE.Mesh(vesselGeo.rim, clayMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.36 * S;
    for (const m of [belly, neck, rim]) { m.castShadow = true; m.receiveShadow = true; }
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x9a63ff, transparent: true, opacity: 0, depthWrite: false });
    const glow = new THREE.Mesh(vesselGeo.mouth, glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.355 * S;
    g.add(belly, neck, rim, glow);
    g.userData.glow = glow;
    g.userData.wisps = [0, 1, 2].map(() => {
      const w = new THREE.Mesh(jarGeo.wisp, jarWispMat);
      w.visible = false;
      g.add(w);
      return w;
    });
    return g;
  }

  /** Pour a jar of entropy into your lamp: all or nothing, the jar is empty after either way. */
  function pourJar(jar) {
    const got = W.gainFuel(1);
    jar.holds = null;
    W.showCaption(got > 0.99 ? 'you pour the jar into your lamp · +1 charge'
      : got > 0 ? `you pour the jar into your lamp · it takes ${W.chargeText(got)}, the rest is lost` : 'you pour the jar out · your lamp was full');
  }
  /** How much of a charge the lamp could take right now. */
  const lampRoom = () => Math.max(0, maxCharges() - state.run.fuel);

  // --- what's in your hand, shown on the figure: a tool at its left side
  // (the lantern is in the right), an object (a jar) held over its head.

  const heldRig = new THREE.Group();
  W.bodyRig.add(heldRig);
  let heldSig = null;
  function resetHeld() { heldRig.clear(); heldSig = null; }
  function updateHeld(slot) {
    const sig = state.carry ? (state.carry.anim ? '' : 'carry:' + state.carry.key) // mid-arc: not in your hands yet
      : !slot || slot.kind === 'lantern' ? '' : slot.kind + ':' + (slot.cur ? slot.cur.id : '');
    if (sig === heldSig) return;
    heldSig = sig;
    heldRig.clear();
    if (!sig) return;
    let m;
    if (state.carry) { // a block over your head
      m = state.carry.mesh;
      m.scale.setScalar(1);
      m.position.set(0, 0.6 * S, 0);
    } else if (slot.kind === 'jar') { // a tool now: in the left hand, at its size on the floor
      m = makeJarMesh();
      m.userData.wisps.forEach((w, i) => { w.visible = i === 0 && slot.cur.holds === 'pixie'; w.position.y = 0.15 * S; });
      m.userData.liquid.visible = slot.cur.holds === 'entropy';
      m.scale.setScalar(0.55);
      m.position.set(-0.17 * S, 0.2 * S, 0.1 * S);
    } else {
      const item = slot.kind === 'chalk' ? { kind: 'chalk', color: slot.cur.color } : { kind: slot.kind };
      m = itemMesh(item, 'held');
      m.rotation.set(-0.5, 0, 0.35); // tilted up in the hand
      m.position.set(-0.15 * S, 0.27 * S, 0.1 * S);
    }
    // What you hold casts no shadow: the lantern is right beside it, and
    // its shadow would sweep the whole room.
    m.traverse((o) => { o.castShadow = false; });
    heldRig.add(m);
  }

  // The set-down preview: a faint box where E would put what you carry.
  const previewMat = new THREE.MeshBasicMaterial({ color: 0xe8935f, transparent: true, opacity: 0.22, depthWrite: false });
  const preview = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), previewMat);
  preview.visible = false;
  scene.add(preview);
  function updatePreview(near) {
    const b = near && near.spot && near.box;
    preview.visible = !!b;
    if (!b) return;
    preview.scale.set((b.x1 - b.x0) * S * 0.96, (b.z1 - b.z0) * S, (b.y1 - b.y0) * S * 0.96);
    preview.position.set((b.x0 + b.x1) / 2 * S, (b.z0 + b.z1) / 2 * S, (b.y0 + b.y1) / 2 * S);
  }

  /** A ghost undone by a collapse. Kept as a tally and a short log; no use yet. */
  function noteUnmade(ghostId, room) {
    const u = state.run.unmade;
    u.count++;
    u.log.push({ ghost: ghostId, room, at: Math.round(state.run.walked) });
    if (u.log.length > 50) u.log.shift();
  }

  /**
   * Pixies in a vessel flit above its mouth. With a ghost drawn close
   * (within JAR_FLARE cells), they flare: bigger, and faster. Entropy in
   * one glows at the mouth, brighter the more there is.
   */
  const JAR_FLARE = 2.5;
  const SWIPE = 0.32; // s: the held jar sweeps forward and down, and back
  let swipeAt = -9;
  function updateJars() {
    const k = (state.time - swipeAt) / SWIPE;
    const sw = k >= 0 && k < 1 ? Math.sin(k * Math.PI) : 0;
    heldRig.rotation.x = sw * 1.1;
    heldRig.position.z = sw * 0.12 * S;
    for (const v of state.pushBlocks) {
      if (!v.vessel) continue;
      const ud = v.mesh.userData, n = v.n || 0;
      ud.glow.material.opacity = v.holds === 'entropy' ? (0.35 + 0.2 * n) * (0.85 + 0.15 * Math.sin(state.time * 3 + v.sx)) : 0;
      const vx = (v.x0 + v.x1) / 2, vy = (v.y0 + v.y1) / 2;
      const near = v.holds === 'pixie' && !v.carried ? state.ghosts.reduce((m, g) => Math.min(m, Math.hypot(g.x - vx, g.y - vy)), Infinity) : Infinity;
      const flare = Math.max(0, 1 - near / JAR_FLARE);
      ud.wisps.forEach((w, i) => {
        w.visible = v.holds === 'pixie' && i < n;
        const a = state.time * (2.6 + 5 * flare) + i * 2.1, r = 0.07 + 0.05 * flare;
        w.position.set(Math.cos(a) * r * S, (0.45 + Math.sin(a * 1.7) * 0.05) * S, Math.sin(a * 1.3) * r * S);
        w.scale.setScalar(1 + flare * (0.7 + 0.3 * Math.sin(state.time * 14)));
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
   * A sigil takes up to four vessels, one per quarter of its tile. A vessel
   * of pixies on it wakes it fully (stage 3; stages 1-2 were for jars of
   * 1-2 ghosts), and every pixie in them is +1 entropy max.
   */
  function updateSigils(dt) {
    let powered = 0;
    const lit = [];
    for (const sg of state.sigils.values()) {
      let stage = 0, full = 0;
      for (const v of state.pushBlocks) {
        if (!v.vessel || v.carried || v.holds !== 'pixie' || !v.n) continue;
        if (Math.floor(v.sx / 2) !== sg.cell.x || Math.floor(v.sy / 2) !== sg.cell.y) continue;
        stage = 3;
        full += v.n;
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

  Object.assign(W, { STROKES, maxCharges, ITEMS, itemMesh, updateItems, collectPickups,
    takeItem, selectedSlot, heldRig, resetHeld, quarterAhead, quarterReachable, updatePreview, JAR_H, heldJar, jarName, lampRoom, makeVesselMesh, inDoorMouth, slots, select, refreshHotbar, addMarkToWorld,
    removeMarkFromWorld, clearMarks, markNear, wipeMarksIn,
    useNear, useSelected, noteUnmade,
    updateJars, addSigil, updateSigils });
})(window);
