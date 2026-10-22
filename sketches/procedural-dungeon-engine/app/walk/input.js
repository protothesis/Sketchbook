// Walk mode: keyboard, the touch stick and the on-screen buttons.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { $, canvas, state, toggleCrouch, slots, select, refreshHotbar, useSelected, actionNear,
    act } = W;

  // ---------------------------------------------------------------------------
  // Input

  const keys = new Set();
  const stick = { active: false, id: null, ox: 0, oy: 0, vx: 0, vy: 0 };

  global.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (state.paused) {
      if (k === 'escape' && state.recordMode === 'checkpoint') W.hideRecord();
      return;
    }
    if (state.bigmap) {
      if ((k === 'tab' && !e.repeat) || k === 'escape') W.closeBigMap();
      if (k === 'tab') e.preventDefault();
      return;
    }
    if (k === 'escape' && state.expanded) { state.expanded = null; refreshHotbar(); return; }
    keys.add(k);
    if (k === 'e') {
      if (!e.repeat) act(actionNear(state.player));
      e.preventDefault();
    } else if (k === 'f') {
      if (!e.repeat) useSelected();
    } else if (k >= '1' && k <= '9' && k.length === 1) {
      select(+k - 1);
    } else if (k === ' ') {
      if (!e.repeat) toggleCrouch();
      e.preventDefault(); // don't also "click" a focused button or scroll
    } else if (k === 'tab') { // the map, under the left hand with WASD
      if (!e.repeat) W.openBigMap();
      e.preventDefault(); // not a focus change
    } else if (k === 'n') {
      requestNewMap();
    }
    if (k.startsWith('arrow')) e.preventDefault();
  });
  global.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  global.addEventListener('blur', () => keys.clear());

  const promptEl = $('prompt');
  promptEl.addEventListener('click', (e) => {
    const near = actionNear(state.player);
    if (near) act(near); else useSelected();
    promptEl.blur();
    e.preventDefault();
  });
  canvas.addEventListener('wheel', (e) => {
    if (state.bigmap || state.paused) return;
    const s = slots(), i = s.findIndex((x) => x.key === state.sel);
    select(i + (e.deltaY > 0 ? 1 : -1));
  }, { passive: true });

  // New map needs a second tap/press within a few seconds; window.confirm()
  // is unreliable (some embedded and in-app viewers block it silently).
  const newBtn = $('new-btn');
  let newArmedUntil = 0;
  function requestNewMap() {
    if (performance.now() < newArmedUntil) {
      newArmedUntil = 0;
      newBtn.classList.remove('armed');
      newBtn.textContent = 'New map';
      W.newExpedition();
      return;
    }
    newArmedUntil = performance.now() + 3000;
    newBtn.classList.add('armed');
    newBtn.textContent = 'Replace this map?';
    W.showCaption('press again to replace this expedition in both views');
    setTimeout(() => {
      if (performance.now() >= newArmedUntil) {
        newBtn.classList.remove('armed');
        newBtn.textContent = 'New map';
      }
    }, 3100);
  }
  newBtn.addEventListener('click', (e) => { requestNewMap(); newBtn.blur(); e.preventDefault(); });

  const stickEl = $('stick');
  const knob = stickEl.querySelector('.knob');
  const STICK_R = 50;
  canvas.addEventListener('pointerdown', (e) => {
    if (stick.active || state.paused) return;
    stick.active = true;
    stick.id = e.pointerId;
    stick.ox = e.clientX; stick.oy = e.clientY;
    stick.vx = stick.vy = 0;
    stickEl.style.left = e.clientX + 'px';
    stickEl.style.top = e.clientY + 'px';
    knob.style.transform = '';
    stickEl.hidden = false;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!stick.active || e.pointerId !== stick.id) return;
    let dx = e.clientX - stick.ox, dy = e.clientY - stick.oy;
    const d = Math.hypot(dx, dy);
    if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d; }
    stick.vx = dx / STICK_R; stick.vy = dy / STICK_R;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  });
  const endStick = (e) => {
    if (e.pointerId !== stick.id) return;
    stick.active = false;
    stick.vx = stick.vy = 0;
    stickEl.hidden = true;
  };
  canvas.addEventListener('pointerup', endStick);
  canvas.addEventListener('pointercancel', endStick);

  $('crouch-btn').addEventListener('click', (e) => { toggleCrouch(); e.currentTarget.blur(); });
  const useBtn = $('use-btn');
  if (useBtn) useBtn.addEventListener('click', (e) => { useSelected(); e.currentTarget.blur(); });

  function readInput() {
    if (state.paused || state.bigmap) return { x: 0, y: 0, mag: 0 };
    let x = 0, y = 0;
    if (keys.has('w') || keys.has('arrowup')) y -= 1;
    if (keys.has('s') || keys.has('arrowdown')) y += 1;
    if (keys.has('a') || keys.has('arrowleft')) x -= 1;
    if (keys.has('d') || keys.has('arrowright')) x += 1;
    let mag = Math.hypot(x, y);
    if (mag > 0) { x /= mag; y /= mag; mag = 1; } else if (stick.active) {
      mag = Math.hypot(stick.vx, stick.vy);
      if (mag < 0.15) return { x: 0, y: 0, mag: 0 };
      x = stick.vx / mag; y = stick.vy / mag;
    }
    return { x, y, mag: Math.min(1, mag), run: keys.has('shift') || (stick.active && mag > 0.95) };
  }

  Object.assign(W, { keys, promptEl, readInput });
})(window);
