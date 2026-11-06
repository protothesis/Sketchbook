// Walk mode: the HUD. Prompts, captions, counters, notices, the minimap and
// big map, and the expedition record screen.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, DP, RULES, THREE, $, S, ekey, state, isLockedNow, CHALK, chargeText, el, savePlayer,
    edgeEnds, maxCharges, refreshHotbar, openDoor, keys, promptEl } = W;

  // ---------------------------------------------------------------------------
  // HUD

  const touchUi = global.matchMedia && global.matchMedia('(hover: none)').matches;
  // A pad in use (gamepad.js) prompts like a keyboard, with its glyphs.
  const touch = () => touchUi && !W.padMode();
  Object.defineProperty(W, 'verbF', { get: () => (touch() ? 'tap' : W.glyph('F')), configurable: true });

  // Two prompt lines: what E would do (the focused thing) and what F would
  // do with the item in hand. Each starts with its key (on touch, tap the
  // line). A line that can't be done right now has no key and reads muted.
  const promptF = $('prompt-f') || document.createElement('button');

  /** "crate", "block", "vessel" (with what's in it). */
  const objName = (b) => (b.chest ? 'chest' : b.crate ? 'crate' : b.waystone ? (b.holds ? 'waystone' : 'dormant waystone') : !b.vessel ? 'block'
    : !b.n ? 'empty vessel' : `vessel (${b.n} ${b.holds === 'pixie' ? (b.n === 1 ? 'pixie' : 'pixies') : (b.n === 1 ? 'charge' : 'charges')})`);

  /** E's line for the focused thing: { text, cls }. */
  function eLine(near) {
    const run = state.run;
    switch (near.action) {
      case 'erase': return { cls: 'chalk', text: `wipe the ${near.mark.color} chalk mark` };
      case 'light': return { text: `light the sconce from your lantern · ${RULES.sconceCost} shard` };
      case 'snuff': return { text: `snuff the sconce · its shard back to your lamp` };
      case 'close': return { text: 'close the door' };
      case 'reopen': return { text: 'open the door' + (near.why ? ' · ' + near.why : '') };
      case 'reroll': return { cls: near.lose ? 'lose' : 'collapse',
        text: `open the door · hold: reroll ${near.child.id} · ${chargeText(near.price.charges)}${near.lose ? ' · what\'s yours in it goes too' : ''}` };
      case 'save': return { cls: 'save', text: 'save at the lantern · you\'ll wake here' };
      case 'choose': return near.opt.off ? { cls: 'blocked', text: `${near.opt.label} · ${near.opt.off}` }
        : { cls: near.opt.lose ? 'lose' : 'collapse', text: `${near.opt.label} · ${near.opt.detail || ''}` };
      case 'surface': return { cls: 'surface', text: 'the door up to the surface' };
      case 'lift': return near.block.waystone && near.block.holds ? { cls: 'collapse', text: 'tap: travel from the waystone · hold: grab it' }
        : near.block.waystone ? { cls: 'collapse', text: `tap: wake the waystone from your lamp · ${chargeText(RULES.waystoneCharges)} · hold: grab it` }
        : near.block.chest ? { cls: 'jar', text: 'tap: open the chest · hold: grab it' }
        : { cls: 'jar', text: `grab the ${objName(near.block)}${near.block.done ? ' · lifting it off its mark takes its entropy back' : ''}` };
      case 'grabbed': return { cls: 'jar', text: state.grab && state.grab.moved
        ? `pushing or pulling the ${objName(near.block)} · let go of E to let go`
        : `holding the ${objName(near.block)} · let go of E to lift it · move to push or pull` };
      case 'setblock': return near.spot ? { cls: 'jar', text: `set the ${objName(near.block)} down` }
        : { cls: 'blocked', text: `no room to set it down here${near.block.spaceId !== state.exp.registry[DE.key(Math.floor(state.player.x), Math.floor(state.player.y))] ? ' · it belongs in its own room' : ''}` };
      case 'open': return { text: 'open the door' };
      case 'letgo': {
        // Retracing is the hourglass's (F with it in hand), shown on its own line.
        const n = near.path.traces.length;
        return { cls: 'lose', text: `hold: reroll your lost path · ${n} room${n === 1 ? '' : 's'} · the path is gone` +
          (near.things.length > 1 ? ` · what's yours on it goes too` : '') +
          (near.charged && state.sel !== 'hourglass' ? ' · or your hourglass in hand to retrace it' : '') };
      }
      case 'lostdoor': {
        const n = near.path.traces.length;
        return { cls: 'collapse', text: `your lost path · ${n} room${n === 1 ? '' : 's'} · retrace or reroll` };
      }
      case 'locked':
        return { cls: 'blocked', text: run.keys > 0 ? 'a locked door · a key in hand unlocks it' : 'a locked door · you need a key' };
    }
    return null;
  }

  /** F's line for the item in hand; setting a jar down or drawing a mark never prompts. */
  function fLine(near) {
    if (near.line) return near.line; // an item kind with its own prompt (hourglass.js)
    if (near.action === 'carve') {
      const n = state.run.doorstones;
      return { cls: 'chalk', text: `open a door in this wall · ${n} doorstone${n === 1 ? '' : 's'}` };
    }
    if (near.action === 'catch') return { cls: 'jar', text: 'swipe the jar to catch the pixie' };
    if (near.action === 'scoop') {
      return near.full ? { cls: 'jar', text: 'swipe the well into the jar · 1 charge' }
        : { cls: 'blocked', text: 'the well isn\'t full enough to fill a jar' };
    }
    if (near.action === 'deposit') return { cls: 'jar', text: `pour the jar into the vessel (${near.vessel.n}/${RULES.vesselCapacity})` };
    if (near.action === 'withdraw') return { cls: 'jar', text: `take ${near.vessel.holds === 'pixie' ? 'a pixie' : 'a charge'} out of the vessel into the jar` };
    if (near.action === 'vesselno') return { cls: 'blocked', text: near.vessel.n >= RULES.vesselCapacity ? 'the vessel is full' : 'the vessel holds something else' };
    if (near.action === 'pour') return { cls: 'collapse', text: `pour the jar into your lamp · 1 charge${W.lampRoom() < 0.99 ? ' (your lamp takes only ' + chargeText(W.lampRoom()) + ')' : ''}` };
    if (near.action === 'power') return { cls: 'jar', text: `pour the jar into the waystone · its ${near.jar.holds === 'pixie' ? 'pixie' : 'entropy'} wakes it` };
    if (near.action === 'unlock') return { cls: 'lock', text: `unlock the door · 1 of ${state.run.keys} key${state.run.keys === 1 ? '' : 's'}` };
    return null;
  }

  const lastLine = new Map();
  function showLine(btn, key, line) {
    const cap = touch() ? '' : W.glyph(key);
    const sig = line ? line.text + '|' + (line.cls || '') + '|' + cap : '';
    if (lastLine.get(btn) === sig) return;
    lastLine.set(btn, sig);
    btn.hidden = !line;
    btn.textContent = '';
    if (!line) return;
    if (cap && line.cls !== 'blocked') btn.append(el('kbd', 'key', cap));
    btn.append(line.text);
    btn.className = 'prompt ' + (key === 'F' ? 'f ' : '') + (line.cls || '');
  }

  function updatePrompt(nearE, nearF, dt = 0) {
    // E has no prompt on a keyboard (fewer callouts; the hold ring is its
    // feedback), except where holding it loses something: a lost path's
    // door, or a reroll that takes what's yours. On touch the E line stays:
    // it's the only E button.
    const warn = nearE && (nearE.path || (nearE.action === 'reroll' && nearE.lose));
    const e = (touch() || warn) && nearE && eLine(nearE);
    if (e && W.holdTime(nearE) && !nearE.refuse && !/^hold|· hold:/.test(e.text)) e.text += ' · hold';
    showLine(promptEl, 'E', e);
    showLine(promptF, 'F', null); // what Y would do shows as its button over the thing (updateMarker), never as text
    promptF.classList.toggle('alone', !e);
    updateFocus(nearE);
    W.updatePreview(nearE);
    updateRing(state.hold.ring);
    updateMarker(nearE, nearE && eLine(nearE), nearF);
    updateFlash(nearE || (!touch() && !state.carry ? yFocus(nearF) : null), dt);
    W.updateChoice(focusRect);
    // What it costs, on the lamp's meter: E's action, else F's.
    const ce = nearE && costOf(nearE), cf = !ce && nearF && costOf(nearF);
    W.previewCost(ce || cf || 0, ce && state.hold.ring ? state.hold.ring.v : 0);
  }

  /** Entropy (charges) an action would spend, negative for what it gives back; 0 if none. */
  function costOf(near) {
    const shard = 1 / RULES.shardsPerCharge;
    switch (near.action) {
      case 'light': return RULES.sconceCost * shard;
      case 'snuff': return -RULES.sconceCost * shard;
      case 'reroll': return near.price ? near.price.charges : 0;
      case 'choose': return near.opt.cost || 0;
      case 'lift': return near.block.waystone && !near.block.holds ? RULES.waystoneCharges : 0;
      default: return 0;
    }
  }

  // The hold ring: like a ghost's, a circle that fills clockwise with the
  // action's icon inside, just above what you're acting on. The E prompt's
  // key fills with it.
  const RING_R = 15, RING_C = 2 * Math.PI * RING_R;
  // Above it, the icons of anything of yours at stake (choice.js), red and
  // crossed out when the action would lose them.
  const ringEl = el('div', 'holdring');
  ringEl.innerHTML = `<svg viewBox="0 0 36 36"><circle class="bg" cx="18" cy="18" r="${RING_R}"/>` +
    `<circle class="fg" cx="18" cy="18" r="${RING_R}" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}"/></svg><span></span>`;
  ringEl.hidden = true;
  const ringThings = el('div', 'things');
  ringEl.append(ringThings);
  document.body.append(ringEl);
  const ringFg = ringEl.querySelector('.fg'), ringIcon = ringEl.querySelector('span');
  function updateRing(ring) {
    const on = !!(ring && (ring.v > 0.02 || ring.idle) && focusRect);
    ringEl.hidden = !on;
    ringEl.classList.toggle('idle', !!(on && ring.idle));
    ringEl.classList.toggle('refused', !!(on && ring.refused));
    promptEl.style.setProperty('--p', on ? ring.v.toFixed(3) : 0);
    if (!on) return;
    ringFg.setAttribute('stroke-dashoffset', (RING_C * (1 - ring.v)).toFixed(2));
    if (ringIcon.textContent !== ring.icon) ringIcon.textContent = ring.icon;
    W.iconRow(ringThings, ring.things || [], ring.lose);
    ringEl.style.left = (focusRect.x0 + focusRect.x1) / 2 + 'px';
    ringEl.style.top = focusRect.y0 + 'px';
  }

  // Where the focused thing is on screen (its box, projected each frame,
  // after the camera has moved): the hold ring sits just above it.
  let focusRect = null;
  const corner = new THREE.Vector3();
  /** Box b's bounds on screen, or null if any corner is behind the camera. */
  function boxRect(b) {
    const rect = W.canvas.getBoundingClientRect();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      corner.set((i & 1 ? b.x1 : b.x0) * S, (i & 2 ? b.z1 : b.z0) * S, (i & 4 ? b.y1 : b.y0) * S).project(W.camera);
      if (corner.z > 1) return null;
      const sx = rect.left + (corner.x + 1) / 2 * rect.width, sy = rect.top + (1 - corner.y) / 2 * rect.height;
      x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
    }
    return { x0, y0: y0 - 6, x1, y1 };
  }
  /** The point just over the middle of box b's top, on screen ([x, y]), or null. */
  function overTop(b) {
    const rect = W.canvas.getBoundingClientRect();
    corner.set((b.x0 + b.x1) / 2 * S, (b.z1 + 0.06) * S, (b.y0 + b.y1) / 2 * S).project(W.camera);
    return corner.z > 1 ? null : [rect.left + (corner.x + 1) / 2 * rect.width, rect.top + (1 - corner.y) / 2 * rect.height];
  }
  function updateFocus(near) {
    W.camera.updateMatrixWorld(); // this frame's camera, not the last render's
    const b = near && near.box;
    focusRect = b ? boxRect(b) : null;
  }

  // The focus markers (HANDS-PLAN.md): a button floating just over the
  // thing it would act on. X / E for the one focused thing; Y / F only when
  // what's in your hand would act on a particular thing in the world (yBox
  // says which), never for a swing at the air, a spill, a mark on the floor.
  // Each fades out when its target goes, still tracking it on screen as the
  // camera moves. X wears a faint ring when its action is a hold, and gives
  // way to the hold ring while you hold. On one thing at once, the two sit
  // side by side, and a muted X gives way to Y. (Brackets round the target's
  // box were tried on 2026-11-05 and dropped: not the look. So was a line of
  // text for what Y would do.)
  const MARK_FADE = 0.25; // s, a little over the CSS fade
  function makeBadge(cls) {
    const b = { el: el('div', 'focusbadge ' + cls), key: el('kbd', '', ''), box: null, off: 0 };
    b.el.append(b.key);
    document.body.append(b.el);
    return b;
  }
  const xBadge = makeBadge('x'), yBadge = makeBadge('y');
  /** Show (box set) or fade a badge; returns the point it's at, or null. */
  function placeBadge(b, box, glyph, shift) {
    const on = !!box;
    b.el.classList.toggle('on', on);
    if (on) {
      b.box = box;
      b.off = 0;
      if (b.key.textContent !== glyph) b.key.textContent = glyph;
    } else if (b.box && !b.off) b.off = state.time;
    if (b.box && b.off && state.time - b.off > MARK_FADE) b.box = null;
    const pt = b.box && overTop(b.box);
    if (!pt) return;
    b.el.style.left = (pt[0] + shift).toFixed(1) + 'px';
    b.el.style.top = pt[1].toFixed(1) + 'px';
  }
  const blockBox = (b) => ({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, z0: b.base || 0, z1: b.top });
  const doorBox = (cell, facing) => W.focusBox({ exit: { cell, facing } });
  /** The thing Y would act on, as a box (and whether it can't, right now), or null. */
  function yBox(u) {
    if (!u) return null;
    const p = state.player;
    switch (u.action) {
      case 'unlock': return { box: doorBox(u.door.exit.cell, u.door.exit.facing) };
      case 'carve': return { box: doorBox(u.cell, u.facing) };
      case 'withdraw': return { box: blockBox(u.vessel) };
      case 'catch': {
        const h = W.PIXIE ? W.PIXIE.height : 0.62;
        return { box: { x0: u.pixie.x - 0.06, x1: u.pixie.x + 0.06, y0: u.pixie.y - 0.06, y1: u.pixie.y + 0.06, z0: h - 0.06, z1: h + 0.06 } };
      }
      case 'release': {
        const hg = u.slot && u.slot.kind === 'hourglass', from = hg ? state.run.equipment.hourglass : u.jar;
        const t = from && from.holds && W.acceptorAt(p, from.holds, from, hg ? 'hourglass' : 'jar');
        if (!t) return null; // a spill, or a pixie let go: nothing in particular takes it
        const box = t.door ? doorBox(t.door.exit.cell, t.door.exit.facing) : t.stone ? blockBox(t.stone) : t.vessel ? blockBox(t.vessel) : null;
        return box && { box, blocked: !!t.blocked };
      }
    }
    return null;
  }
  /** Y's target as an X-style focus (for the flash), or null. */
  function yFocus(u) {
    if (!u) return null;
    if (u.action === 'unlock') return u.door;
    if (u.action === 'withdraw') return { action: 'lift', block: u.vessel };
    if (u.action === 'catch') return { action: 'pixie', pixie: u.pixie };
    if (u.action === 'release') {
      const hg = u.slot && u.slot.kind === 'hourglass', from = hg ? state.run.equipment.hourglass : u.jar;
      const t = from && from.holds && W.acceptorAt(state.player, from.holds, from, hg ? 'hourglass' : 'jar');
      if (!t) return null;
      return t.door ? t.door : t.stone ? { action: 'lift', block: t.stone } : t.vessel ? { action: 'lift', block: t.vessel } : null;
    }
    return null;
  }
  const sameBox = (a, b) => !!(a && b) && Math.abs((a.x0 + a.x1) - (b.x0 + b.x1)) < 0.1 && Math.abs((a.y0 + a.y1) - (b.y0 + b.y1)) < 0.1;
  function updateMarker(near, line, nearF) {
    const ring = state.hold.ring, ringOn = !!(ring && ring.v > 0.02 && !ring.idle);
    const pad = !touch();
    const xOn = !!(pad && near && near.box && !state.choice && !ringOn && near.action !== 'grabbed' && near.action !== 'setblock'); // not while you hold or carry something
    const xBlocked = xOn && (!!(line && line.cls === 'blocked') || near.action === 'locked');
    const y = pad && !state.choice && !state.carry ? yBox(nearF) : null;
    const same = xOn && y && sameBox(near.box, y.box);
    const showX = xOn && !(same && xBlocked);
    xBadge.el.classList.toggle('blocked', xBlocked);
    xBadge.el.classList.toggle('hold', xOn && !xBlocked && !!W.holdTime(near) && !near.refuse);
    yBadge.el.classList.toggle('blocked', !!(y && y.blocked));
    const both = showX && same;
    placeBadge(xBadge, showX ? near.box : null, W.glyph('E'), both ? -17 : 0);
    placeBadge(yBadge, y ? y.box : null, W.glyph('F'), both ? 17 : 0);
  }

  // The focus flash: when something comes into reach, the thing itself
  // flashes once in a chunky warm dither (like the figure's flash, laid over
  // its own surfaces) and fades fast, so you see which thing the button is
  // for. A copy of each of its meshes rides along as a child, drawn on top.
  // A door flashes through anything in front of it (a side wall seen edge
  // on), like the figure's silhouette, and its arrows flash with it.
  const FLASH = { peak: 0.8, dur: 0.45, color: 0xffc27a };
  function ditherFlash(key, through) {
    const m = new THREE.MeshBasicMaterial({
      color: FLASH.color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      depthTest: !through, depthFunc: THREE.LessEqualDepth, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
      side: through ? THREE.DoubleSide : THREE.FrontSide,
    });
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\nif (mod(floor(gl_FragCoord.x / 2.0) + floor(gl_FragCoord.y / 2.0), 2.0) < 0.5) discard;');
    };
    m.customProgramCacheKey = () => key;
    return m;
  }
  const flashMat = ditherFlash('focus-flash', false);
  const flashThroughMat = ditherFlash('focus-flash-through', true);
  let flashOf = null, flashCopies = [], flashT = 0;
  /** The door (world.js's record) a focused door action is about, from either side. */
  function doorOf(near) {
    const d = state.doors.get(near.space.id + '/' + near.exit.id);
    if (d) return d;
    // Built from the room on the other side: the door whose seam (it stays
    // in the doorway while the panel swings) is here.
    const b = near.box, mx = (b.x0 + b.x1) / 2 * S, my = (b.y0 + b.y1) / 2 * S, v = new THREE.Vector3();
    for (const o of state.doors.values()) {
      o.seam.getWorldPosition(v);
      if (Math.hypot(v.x - mx, v.z - my) < 0.3 * S) return o;
    }
    return null;
  }
  /** What the focused action is about, in the world: { key, objs: [Object3D], through }, or null. */
  function flashTarget(near) {
    const one = (o) => (o ? { key: o, objs: [o], through: false } : null);
    switch (near.action) {
      case 'lift': return one(near.block.mesh);
      case 'light': case 'snuff': return one(near.sconce.flame.parent);
      case 'save': return one(near.lantern.group);
      case 'erase': return one(near.mark.mesh);
      case 'pixie': return one(near.pixie.mesh);
      case 'grabbed': case 'setblock': case 'choose': return null;
    }
    if (!near.exit) return null;
    const d = doorOf(near);
    if (!d) return null;
    return { key: d, objs: [d.pivot, d.seam, d.arrow].filter((o) => o.visible), through: true };
  }
  function clearFlash() {
    for (const c of flashCopies) if (c.parent) c.parent.remove(c);
    flashCopies = [];
  }
  function updateFlash(near, dt) {
    const t = near && !state.choice ? flashTarget(near) : null;
    const key = t ? t.key : null;
    if (key !== flashOf) {
      flashOf = key;
      clearFlash();
      if (t) {
        const mat = t.through ? flashThroughMat : flashMat, meshes = [];
        for (const o of t.objs) o.traverse((m) => {
          if (m.isMesh && !m.isInstancedMesh && m.visible && m.material !== flashMat && m.material !== flashThroughMat) meshes.push(m);
        });
        for (const m of meshes) {
          const c = new THREE.Mesh(m.geometry, mat);
          c.renderOrder = 12;
          c.raycast = () => {};
          m.add(c);
          flashCopies.push(c);
        }
        flashT = 0;
      }
    }
    if (!flashCopies.length) return;
    flashT += dt;
    const k = Math.min(1, flashT / FLASH.dur);
    flashMat.opacity = flashThroughMat.opacity = FLASH.peak * (1 - k) * (1 - k);
    if (k >= 1) clearFlash();
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
    // The run's stats show on the pause screen (game.js); game state lives
    // in its own elements (the lamp, the hotbar).
    setText('stats', `seed ${state.exp.rootSeed} · ${s.spaces} room${s.spaces === 1 ? '' : 's'} · ${s.openExits} closed door${s.openExits === 1 ? '' : 's'}`);
    W.updateLampHud(true);
    // Keys are a tool on the hotbar now, and the hourglass is on it too.
    const keyEl = $('keys');
    if (keyEl) keyEl.hidden = true;
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
    // Traces of collapsed rooms: greyed, under everything live. Faded ones
    // not at all. Lost paths (a faint's, waiting) are drawn after, below.
    for (const id in exp.traces || {}) {
      const t = exp.traces[id];
      if (t.cause === 'faded' || t.cause === 'lost' || t.cause === 'lost-dim' || exp.spaces[t.id]) continue;
      ctx.fillStyle = 'rgba(150, 146, 160, 0.22)';
      for (const k of t.cells) { const c = DE.parseKey(k); if (visible(c)) cell(c); }
    }
    drawLostPaths(ctx, ox, oy, px, visible, cell);
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
        if (conn && W.rerollThrough(exp, id, ex)) {
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
        // A door to a lost path (its own, or one onto ground it holds): violet, like its seam.
        ctx.fillStyle = conn ? (W.isClosed(ex.connectionId) ? '#c4502a' : '#5fbf7a') : ex.kind === 'surface' ? '#dcebff'
          : isLockedNow(sp, ex) ? '#6fa8d8' : W.lostPathAt(id, ex.id) ? '#b59cff' : '#c4502a';
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
    // Entropy wells: a small basin, its colour by kind, filled by its level.
    for (const w of state.wells) {
      if (!visible(w.cell)) continue;
      const mx = ox + (w.cell.x + 0.5) * px, my = oy + (w.cell.y + 0.5) * px, r = Math.max(3, px * 0.3);
      const k = W.wellLevel(w) / RULES.wellCapacity;
      const col = w.kind === 'surge' ? '160, 112, 255' : '79, 216, 196';
      ctx.beginPath();
      ctx.arc(mx, my, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${col}, ${0.15 + 0.75 * k})`;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(${col}, 0.9)`;
      ctx.stroke();
    }
    // Ley lines between awake waystones: faint always, bright on the travel
    // map, where the way to the stone under your finger lights up.
    const travel = cv === bm && state.bigmap && state.bigmap.travel;
    const ctr = (st) => [ox + (st.ws.x0 + st.ws.x1) / 2 * px, oy + (st.ws.y0 + st.ws.y1) / 2 * px];
    ctx.save();
    ctx.lineWidth = travel ? 2 : 1.25;
    ctx.strokeStyle = travel ? 'rgba(170, 160, 255, 0.55)' : 'rgba(150, 140, 255, 0.3)';
    ctx.setLineDash(travel ? [] : [4, 4]);
    ctx.beginPath();
    for (const [a, b] of W.leyLines()) {
      const [ax, ay] = ctr(a), [bx, by] = ctr(b);
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
    }
    ctx.stroke();
    const hover = travel && state.bigmap.hover && W.leyRoute(travel, state.bigmap.hover);
    if (hover) {
      ctx.setLineDash([]);
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(220, 210, 255, 0.95)';
      ctx.shadowColor = 'rgba(165, 140, 255, 0.9)';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      hover.path.forEach((st, i) => { const [x, y] = ctr(st); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
    }
    ctx.restore();
    // Waystones: a small slab, glowing when awake. On the travel map, the
    // ones you can go to pulse in a ring, with their room's id and the fare.
    for (const st of state.waystones) {
      const mx = ox + (st.ws.x0 + st.ws.x1) / 2 * px, my = oy + (st.ws.y0 + st.ws.y1) / 2 * px;
      const sw = Math.max(4, px * 0.32), sh = Math.max(7, px * 0.62);
      ctx.save();
      if (st.awake) { ctx.shadowColor = 'rgba(165, 140, 255, 0.9)'; ctx.shadowBlur = 8; }
      ctx.fillStyle = st.awake ? '#cdbfff' : '#7d7888';
      ctx.fillRect(mx - sw / 2, my - sh / 2, sw, sh);
      if (travel && st.awake) {
        const here = st === travel;
        const pulse = here ? 0 : 0.5 + 0.5 * Math.sin(state.time * 4);
        ctx.shadowBlur = here ? 0 : 12;
        ctx.strokeStyle = here ? 'rgba(243, 236, 220, 0.6)' : `rgba(205, 191, 255, ${0.6 + 0.4 * pulse})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(mx, my, 14 + 3 * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
        const route = !here && W.leyRoute(travel, st);
        const fare = route ? route.shards / RULES.shardsPerCharge : 0;
        const short = route && fare > state.run.fuel + 1e-6;
        ctx.fillStyle = here ? 'rgba(243, 236, 220, 0.75)' : short ? '#9a8fae' : '#e6deff';
        ctx.font = '12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(here ? 'you are here' : route ? `${st.spaceId} · ${'◆'.repeat(Math.min(route.shards, 6))}${route.shards > 6 ? '×' + route.shards : ''}` : st.spaceId, mx, my - 22);
      }
      ctx.restore();
    }
    // Save lanterns (a small red flame, brighter where you'd wake) and your
    // packs (a flame where each lies, as long as its path is there).
    W.drawLanternMarks(ctx, ox, oy, px);
    W.drawPackMarks(ctx, ox, oy, px);
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

  // Lost paths, by stage. Waiting since your last faint ('lost'): a violet
  // fill that breathes, close hatching, and a solid glowing edge. Dimmed by
  // a second faint ('lost-dim', it fades at the next): fainter, sparse
  // hatching, a dashed edge, a slower breath. Hatching is pinned to the map.
  const HATCH = {};
  function hatch(ctx, gap, alpha) {
    const k = gap + ':' + alpha;
    if (!HATCH[k]) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = gap;
      const g = cv.getContext('2d');
      g.strokeStyle = `rgba(200, 180, 255, ${alpha})`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(-1, gap + 1); g.lineTo(gap + 1, -1); // one stroke per tile, so the tiles join into diagonals
      g.moveTo(-1, 1); g.lineTo(1, -1);
      g.moveTo(gap - 1, gap + 1); g.lineTo(gap + 1, gap - 1);
      g.stroke();
      HATCH[k] = cv;
    }
    return ctx.createPattern(HATCH[k], 'repeat');
  }
  const LOST_STAGE = {
    lost: { fill: [0.22, 0.4], hz: 2.2, gap: 6, hatch: 0.55, edge: [0.55, 0.95], dash: [] },
    'lost-dim': { fill: [0.08, 0.16], hz: 1.1, gap: 11, hatch: 0.35, edge: [0.25, 0.45], dash: [3, 3] },
  };
  function drawLostPaths(ctx, ox, oy, px, visible, cell) {
    const exp = state.exp;
    for (const cause of ['lost-dim', 'lost']) {
      const st = LOST_STAGE[cause];
      const cells = new Set();
      for (const id in exp.traces || {}) {
        const t = exp.traces[id];
        if (t.cause === cause && !exp.spaces[t.id]) for (const k of t.cells) cells.add(k);
      }
      if (!cells.size) continue;
      const b = 0.5 + 0.5 * Math.sin(state.time * st.hz);
      ctx.save();
      ctx.fillStyle = `rgba(165, 140, 255, ${st.fill[0] + (st.fill[1] - st.fill[0]) * b})`;
      for (const k of cells) { const c = DE.parseKey(k); if (visible(c)) cell(c); }
      const pat = hatch(ctx, st.gap, st.hatch);
      if (pat.setTransform && global.DOMMatrix) pat.setTransform(new DOMMatrix().translateSelf(ox % st.gap, oy % st.gap));
      ctx.fillStyle = pat;
      for (const k of cells) { const c = DE.parseKey(k); if (visible(c)) ctx.fillRect(ox + c.x * px, oy + c.y * px, px, px); }
      // The edge: every side of a lost cell that isn't another lost cell.
      ctx.strokeStyle = `rgba(190, 165, 255, ${st.edge[0] + (st.edge[1] - st.edge[0]) * b})`;
      ctx.shadowColor = 'rgba(165, 140, 255, 0.9)';
      ctx.shadowBlur = cause === 'lost' ? 6 * b : 0;
      ctx.lineWidth = Math.max(1, px * 0.08);
      ctx.setLineDash(st.dash);
      ctx.beginPath();
      for (const k of cells) {
        const c = DE.parseKey(k);
        if (!visible(c)) continue;
        for (const f of DE.FACINGS) {
          const n = DE.step(c, f);
          if (cells.has(DE.key(n.x, n.y))) continue;
          const [ax, ay, bx, by] = edgeEnds(c.x, c.y, f);
          ctx.moveTo(ox + ax * px, oy + ay * px);
          ctx.lineTo(ox + bx * px, oy + by * px);
        }
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  const mm = $('minimap');
  const mmCtx = mm.getContext('2d');
  function drawMinimap() {
    if (state.bigmap) return;
    drawChart(mm, mmCtx, state.player.x, state.player.y, mm.clientWidth / 26);
  }
  mm.addEventListener('click', () => openBigMap({ tab: 'map' }));

  // The enlarged map: M (or tapping the minimap) opens it; drag to pan,
  // wheel or pinch to zoom. Walking pauses while it's open.
  const bm = $('bigmap-canvas');
  const bmCtx = bm.getContext('2d');
  // Zoom limits for the big map; it opens two wheel steps back from the closest.
  const BIGMAP_MAX_PX = 60, WHEEL_STEP = Math.exp(-100 * 0.0015);
  /**
   * Open the menu (menu.js): the big map is its first tab, and state.bigmap
   * stays set while any tab is up (walking pauses). `tab`: which tab
   * ('map', 'inv', 'coll'; else the last one open); `chest`: a chest's key,
   * for its take-and-give screen. With `travelFrom` (a waystone), it's the
   * travel picker, no tabs: framed on every awake waystone, which glow; tap
   * one to go there.
   */
  let lastTab = 'map';
  function openBigMap(opts) {
    if (state.paused) return;
    keys.clear();
    const from = opts && opts.travelFrom;
    const tab = from ? 'map' : (opts && opts.chest) ? 'chest' : (opts && opts.tab) || lastTab;
    state.bigmap = { cx: state.player.x, cy: state.player.y, px: BIGMAP_MAX_PX * WHEEL_STEP * WHEEL_STEP, travel: null,
      tab, chest: (opts && opts.chest) || null, cur: null, pick: null, sub: null };
    if (from) {
      const pts = state.waystones.filter((o) => o.awake).map((o) => o.ws.wake);
      const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const r = bm.getBoundingClientRect();
      const w = r.width || global.innerWidth, h = (r.height || global.innerHeight) - 60;
      Object.assign(state.bigmap, {
        travel: from, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2,
        px: THREE.MathUtils.clamp(Math.min(w / (x1 - x0 + 10), h / (y1 - y0 + 10)), 2.5, BIGMAP_MAX_PX * WHEEL_STEP),
      });
    }
    $('bigmap-hint').hidden = !from;
    $('bigmap').hidden = false;
    mm.classList.add('hidden');
    W.renderMenu();
  }
  /** Switch the open menu to a tab (menu.js does the rest). */
  function menuTab(tab) {
    const v = state.bigmap;
    if (!v || v.travel || v.chest) return;
    v.tab = lastTab = tab;
    v.cur = null; v.pick = null; v.sub = null;
    W.renderMenu();
  }
  /** The awake waystone (not the one you're at) nearest a screen point on the travel map, if one is close. */
  function travelPick(sx, sy) {
    const v = state.bigmap, r = bm.getBoundingClientRect();
    const gx = v.cx + (sx - r.left - r.width / 2) / v.px, gy = v.cy + (sy - r.top - r.height / 2) / v.px;
    let best = null, bd = Math.max(1.2, 24 / v.px);
    for (const st of state.waystones) {
      if (!st.awake || st === v.travel) continue;
      const d = Math.hypot(st.ws.wake.x - gx, st.ws.wake.y - gy);
      if (d < bd) { bd = d; best = st; }
    }
    return best;
  }
  function closeBigMap() {
    state.bigmap = null;
    $('bigmap').hidden = true;
    $('bigmap-hint').hidden = true;
    mm.classList.remove('hidden');
    W.renderMenu();
  }
  function drawBigMap() {
    if (!state.bigmap || state.bigmap.tab !== 'map') return;
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
    // On the travel map, the stone under the pointer shows its route.
    if (state.bigmap && state.bigmap.travel) state.bigmap.hover = travelPick(e.clientX, e.clientY);
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
    // A tap on the travel map: go to the waystone under it.
    if (bmTap && e.type === 'pointerup' && state.bigmap && state.bigmap.travel) {
      const st = travelPick(e.clientX, e.clientY);
      if (st) {
        const from = state.bigmap.travel;
        closeBigMap();
        W.travelTo(st, from);
      }
    }
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
      ['entropy left', chargeText(run.fuel)],
      ['waystones awake', state.waystones.filter((o) => o.awake).length],
      ['waypoints reached', Object.values(exp.reserves || {}).filter((r) => r.spaceId && r.pin).length],
      ['passed out', run.gutters || 0],
      ['rooms lost to faints', run.roomsLost || 0],
      ['paths retraced', run.retraces || 0],
      ['paths let go', run.pathsLetGo || 0],
      ['pixies caught', run.pixiesCaught || 0],
      ['entropy from wells', chargeText(run.wellDrawn || 0)],
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
    state.paused = !!state.menu; // a dialog over the title screen leaves it up
    $('dialog').hidden = true;
  }
  $('done-leave').addEventListener('click', () => {
    state.run.extracted = Object.assign({}, recordDoor);
    savePlayer();
    showRecord(recordDoor.spaceId, recordDoor.exitId, 'extracted');
  });
  $('done-new').addEventListener('click', () => W.newRun());
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

  Object.assign(W, { updatePrompt, FOCUS_FLASH: FLASH, showCaption, stanceEl, refreshHud, notice,
    REFRESH_HINT, drawMinimap, openBigMap, closeBigMap, menuTab, drawBigMap, zoomBigMap, showRecord,
    hideRecord, openDialog, closeDialog });
})(window);
