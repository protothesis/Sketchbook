// Walk mode: a gamepad (the standard Gamepad API layout). Polled each
// frame. Most buttons stand in for a key and go through input.js's keydown
// handler, so a pad does what the keyboard does in every state (a choice,
// the map, a dialog). The left stick walks, analog like the touch stick;
// LT held runs. The right stick peeks: it slides the view that
// way, and it springs back when you let go (camera.js).
//
//   A  jump (Space; held for full height)       B  back out of anything (free in the world)
//   X  E (tap to act, hold to fill the ring)     Y  F (use the item in hand); on the map, recenter
//   L3  crouch (C)    R3  the lamp (R)           D-pad ◀ ▶  the variant in a group
//   LB / RB  the hotbar slot left / right        LT  run    RT  the duster (Q)
//   (on the map, LT / RT zoom)
//   View  the map    Menu  pause
//
// In a choice, a dialog or the waystone travel map, the d-pad (and in a
// choice or dialog, the stick) moves between options and A (or, in a
// choice, X) confirms.
// Using a pad switches the prompts and hints to its glyphs (PlayStation
// shapes for a Sony pad); a key or a touch switches them back.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { $, state } = W;

  const DEAD = 0.2;       // radial dead zone for the sticks
  const NAV = 0.5;        // a stick past this is a d-pad press in menus
  const TRIGGER = 0.3;    // a trigger past this is held
  const REPEAT = [0.4, 0.14]; // s: a held direction repeats after, then every
  const PAN = 700;        // px/s the stick pans the map at full tilt
  const ZOOM = 2.2;       // ×/s the triggers zoom the map at full pull

  const B = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, view: 8, menu: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15 };
  const GLYPH = {
    xbox: { E: 'X', F: 'Y', Q: 'RT', R: 'R3', Space: 'A', C: 'L3', Esc: 'B', Tab: 'View', Menu: 'Menu', run: 'LT', bumpers: 'LB/RB' },
    ps: { E: '□', F: '△', Q: 'R2', R: 'R3', Space: '✕', C: 'L3', Esc: '○', Tab: 'Create', Menu: 'Options', run: 'L2', bumpers: 'L1/R1' },
  };

  let pad = false;       // the last input was the pad: prompts show its glyphs
  let style = 'xbox';
  let prev = [];         // last frame's pressed buttons
  let nav = { x: 0, y: 0, t: 0 };
  let move = { x: 0, y: 0, mag: 0, run: false };
  let tilted = false;    // the left stick was off rest last frame
  let aKey = null;       // the key A stood in for when it went down (let go of the same one)
  let last = 0;

  const padMode = () => pad;
  /** A key's label for the hints: the pad's glyph in pad mode, else the key. */
  const glyph = (key) => (pad ? GLYPH[style][key] || key : key);

  const help = document.querySelector('.help');
  const keyHelp = help ? help.innerHTML : '';
  function padHelp() {
    const g = GLYPH[style], k = (s) => `<kbd>${s}</kbd>`;
    return `${k('◖')} move · ${k('◗')} look · ${k(g.run)} run · ${k(g.Space)} jump · ${k(g.C)} crouch · ${k(g.E)} interact · ` +
      `${k(g.F)} use item · ${k(g.Q)} dust · ${k(g.R)} lamp · ${k(g.bumpers)} select · ${k(g.Tab)} map · ${k(g.Menu)} menu`;
  }

  function setPad(on, kind) {
    if (on === pad && (kind || style) === style) return;
    pad = on;
    if (kind) style = kind;
    document.body.classList.toggle('pad', on);
    if (help) help.innerHTML = on ? padHelp() : keyHelp;
    if (state.choice) W.moveChoice(0); // redraw its hint
    if (state.run) W.refreshHotbar(); // the equipment slot's key
  }
  // A real key or touch takes the hints back (the pad's own keys are synthetic).
  for (const ev of ['keydown', 'pointerdown', 'wheel']) {
    global.addEventListener(ev, (e) => { if (e.isTrusted) setPad(false); }, { capture: true, passive: true });
  }

  /** Stand in for a key: input.js's handlers do the rest. */
  const key = (type, k) => global.dispatchEvent(new KeyboardEvent(type, { key: k }));

  /** The open overlay whose buttons the d-pad walks, if any. */
  function overlay() {
    for (const id of ['dialog', 'done', 'title']) {
      const o = $(id);
      if (o && !o.hidden) return o;
    }
    return null;
  }
  function focusStep(o, d) {
    const bs = Array.from(o.querySelectorAll('button, a.btn')).filter((b) => !b.hidden && b.offsetParent);
    if (!bs.length) return;
    const i = bs.indexOf(document.activeElement);
    bs[i < 0 ? 0 : (i + d + bs.length) % bs.length].focus();
  }

  /** The travel map: step to the next awake waystone, which shows its route. */
  function travelStep(d) {
    const v = state.bigmap;
    const sts = state.waystones.filter((st) => st.awake && st !== v.travel)
      .sort((a, b) => a.ws.wake.x - b.ws.wake.x || a.ws.wake.y - b.ws.wake.y);
    if (!sts.length) return;
    const i = sts.indexOf(v.hover);
    v.hover = sts[i < 0 ? (d > 0 ? 0 : sts.length - 1) : (i + d + sts.length) % sts.length];
    v.cx = v.hover.ws.wake.x; v.cy = v.hover.ws.wake.y;
  }

  /** A d-pad (or menu stick) direction, on its first frame and on repeats. */
  function navigate(x, y) {
    if (state.choice) { if (x) W.moveChoice(x); return; }
    const o = state.paused && overlay();
    if (o) { focusStep(o, x || y); return; }
    if (state.bigmap) { if (state.bigmap.travel && x) travelStep(x); return; }
    if (state.paused || state.carry || !x) return;
    const slot = W.selectedSlot();
    if (slot && slot.variants && slot.variants.length > 1) { W.cycleVariant(slot, x); }
  }

  function press(i) {
    const busy = state.paused || state.bigmap || state.choice;
    switch (i) {
      case B.a: {
        const o = state.paused && overlay();
        if (o) {
          if (!o.contains(document.activeElement)) focusStep(o, 0);
          else document.activeElement.click();
        } else if (state.bigmap) {
          const v = state.bigmap;
          if (v.travel && v.hover) { const from = v.travel, to = v.hover; W.closeBigMap(); W.travelTo(to, from); }
        } else {
          aKey = state.choice ? 'e' : ' '; // in a choice, A confirms like X
          key('keydown', aKey);
        }
        return;
      }
      case B.b: if (busy || state.expanded) key('keydown', 'escape'); return;
      case B.x: key('keydown', 'e'); return;
      case B.y:
        if (state.bigmap) { state.bigmap.cx = state.player.x; state.bigmap.cy = state.player.y; } else key('keydown', 'f');
        return;
      case B.l3: key('keydown', 'c'); return;
      case B.rt: if (!state.bigmap) key('keydown', 'q'); return; // on the map it zooms (poll)
      case B.r3: key('keydown', 'r'); return;
      case B.lb: case B.rb: {
        if (busy) return;
        const s = W.slots(), at = s.findIndex((x) => x.key === state.sel);
        W.select(at + (i === B.rb ? 1 : -1));
        return;
      }
      case B.view: if (!state.paused) key('keydown', 'tab'); return;
      case B.menu: key('keydown', 'escape'); return;
    }
  }
  function release(i) {
    if (i === B.x) key('keyup', 'e');
    if (i === B.a && aKey) { key('keyup', aKey); aKey = null; }
  }

  /** The stick, past the dead zone and rescaled to start from 0. */
  function stick(gp, ax) {
    const x = gp.axes[ax] || 0, y = gp.axes[ax + 1] || 0;
    const m = Math.hypot(x, y);
    if (m < DEAD) return { x: 0, y: 0, mag: 0 };
    return { x: x / m, y: y / m, mag: Math.min(1, (m - DEAD) / (1 - DEAD)) };
  }
  const value = (gp, i) => (gp.buttons[i] ? gp.buttons[i].value || (gp.buttons[i].pressed ? 1 : 0) : 0);

  function poll(now) {
    global.requestAnimationFrame(poll);
    const dt = Math.min(0.1, last ? (now - last) / 1000 : 0);
    last = now;
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
    const gp = pads.find((p) => p.mapping === 'standard') || pads[0];
    if (!gp) {
      if (prev[B.x] || aKey) { W.keys.delete('e'); W.releaseE(true); W.releaseJump(); aKey = null; } // unplugged mid-hold: let go, like losing focus
      prev = []; tilted = false; move = { x: 0, y: 0, mag: 0, run: false };
      W.padLook = null;
      return;
    }
    const kind = /054c|playstation|dualsense|dualshock|sony/i.test(gp.id) ? 'ps' : 'xbox';
    if (kind !== style) setPad(pad, kind);

    const down = gp.buttons.map((b, i) => (i === B.lt || i === B.rt ? value(gp, i) > TRIGGER : b.pressed));
    const s = stick(gp, 0);
    // A press, or the stick leaving rest (not a drifting stick), is the pad in use.
    if (down.some((d, i) => d && !prev[i]) || (s.mag > 0 && !tilted)) setPad(true);
    tilted = s.mag > 0;
    for (let i = 0; i < down.length; i++) {
      if (down[i] && !prev[i]) press(i);
      else if (!down[i] && prev[i]) release(i);
    }
    prev = down;

    // Directions for menus: the d-pad, or the stick in a choice or dialog.
    const menuStick = state.choice || (state.paused && overlay());
    let nx = (down[B.right] ? 1 : 0) - (down[B.left] ? 1 : 0), ny = (down[B.down] ? 1 : 0) - (down[B.up] ? 1 : 0);
    if (!nx && !ny && menuStick) {
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      if (Math.abs(ax) > NAV && Math.abs(ax) >= Math.abs(ay)) nx = Math.sign(ax);
      else if (Math.abs(ay) > NAV) ny = Math.sign(ay);
    }
    if (nx !== nav.x || ny !== nav.y) {
      nav = { x: nx, y: ny, t: REPEAT[0] };
      if (nx || ny) navigate(nx, ny);
    } else if (nx || ny) {
      nav.t -= dt;
      if (nav.t <= 0) { nav.t = REPEAT[1]; navigate(nx, ny); }
    }

    // The map: the stick pans, the triggers zoom about the middle.
    const v = state.bigmap;
    if (v) {
      v.cx += s.x * s.mag * PAN * dt / v.px;
      v.cy += s.y * s.mag * PAN * dt / v.px;
      const z = value(gp, B.rt) - value(gp, B.lt);
      if (Math.abs(z) > 0.05) {
        const r = $('bigmap-canvas').getBoundingClientRect();
        W.zoomBigMap(Math.pow(ZOOM, z * dt), r.left + r.width / 2, r.top + r.height / 2);
      }
    }
    move = { x: s.x, y: s.y, mag: s.mag, run: down[B.lt] };
    const r = stick(gp, 2);
    W.padLook = { x: r.x * r.mag, y: r.y * r.mag };
  }
  global.requestAnimationFrame(poll);

  // Walking: the keyboard (or touch stick) wins; else the pad's stick.
  const readKeys = W.readInput;
  function readInput() {
    const k = readKeys();
    if (k.mag > 0 || !move.mag || state.paused || state.bigmap || state.choice) return k;
    return { x: move.x, y: move.y, mag: move.mag, run: !state.carry && move.run }; // no running with a block
  }

  Object.assign(W, { padMode, glyph, readInput });
})(window);
