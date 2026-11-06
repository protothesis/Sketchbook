// Walk mode: the controls screen, a page of the title screen (game.js opens
// it). Two drawings: an Xbox-style pad with its buttons called out, and the
// left half of a keyboard with a mouse. Up / down (W / S, the d-pad or the
// stick) switch between them; Esc (B) goes back.
//
// The bindings here are drawn by hand from input.js, gamepad.js and
// menu.js: change a binding there, change it here too.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { $ } = W;

  const NS = 'http://www.w3.org/2000/svg';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  // ---------------------------------------------------------------------------
  // The pad: [glyph, action, detail]. Callout rows on each side, top to bottom.

  const PAD = {
    lt: ['LT', 'run', 'hold · on the map: zoom out'],
    lb: ['LB', 'item in hand ‹', 'in the menu: tab ‹'],
    ls: ['L', 'move', 'click (L3): crouch'],
    dpad: ['✚', 'move in menus', 'and in choices'],
    rt: ['RT', 'use item in hand', 'on the map: zoom in'],
    rb: ['RB', 'item in hand ›', 'in the menu: tab ›'],
    y: ['Y', 'recenter the map', 'in a grid: take in hand'],
    b: ['B', 'put away / take out', 'in menus: back'],
    x: ['X', 'interact', 'hold to fill a ring · grid: drop'],
    a: ['A', 'jump', 'hold: higher · menus: confirm'],
    rs: ['R', 'peek', 'click (R3): lamp'],
    view: ['View', 'map & inventory'],
    menu: ['Menu', 'pause'],
  };

  // The drawing, in its own frame (offset when placed).
  const OX = 150, OY = 70;
  const BODY = 'M380 172 L550 172 C575 172 590 158 620 156 C660 154 690 170 705 200 C730 250 760 360 770 460 ' +
    'C778 530 760 560 720 560 C690 560 670 540 645 505 C620 470 600 450 560 448 L370 448 C330 450 310 470 285 505 ' +
    'C260 540 240 560 210 560 C170 560 152 530 160 460 C170 360 200 250 225 200 C240 170 270 154 310 156 ' +
    'C340 158 355 172 380 172 Z';
  // Where each callout lands, and how big a target it is (r: a circle's edge).
  const AT = {
    lt: { x: 305, y: 128, r: 0 }, lb: { x: 262, y: 168, r: 0 },
    ls: { x: 310, y: 270, r: 38 }, dpad: { x: 356, y: 368, r: 0 },
    rt: { x: 625, y: 128, r: 0 }, rb: { x: 668, y: 168, r: 0 },
    y: { x: 620, y: 232, r: 17 }, b: { x: 658, y: 270, r: 17 }, x: { x: 582, y: 270, r: 17 },
    a: { x: 620, y: 308, r: 17 }, rs: { x: 552, y: 368, r: 38 },
    view: { x: 412, y: 272, r: 11 }, menu: { x: 518, y: 272, r: 11 },
  };
  const LEFT = [['lt', 40], ['lb', 120], ['ls', 260], ['dpad', 400]];
  const RIGHT = [['rt', 40], ['rb', 120], ['y', 230], ['b', 310], ['x', 390], ['a', 470], ['rs', 560]];
  const LX = 262, RX = 968; // where the callout lines start

  function line(pts) {
    return `<polyline class="c-line" points="${pts.map((p) => p.join(',')).join(' ')}" />`;
  }
  /** A line from a label at (sx, y) to a part: level, then slanting in to its edge. */
  function callout(sx, y, t) {
    const tx = t.x + OX, ty = t.y + OY;
    const dir = sx < tx ? 1 : -1;
    let ex = tx - dir * Math.abs(ty - y) * 0.75; // the elbow
    if ((ex - sx) * dir < 0) ex = sx;
    let px = tx, py = ty;
    if (t.r) {
      const dx = ex - tx, dy = y - ty, d = Math.hypot(dx, dy) || 1;
      px = tx + dx / d * (t.r + 4); py = ty + dy / d * (t.r + 4);
    }
    return line([[sx, y], [ex, y], [px, py]]);
  }
  function tag(x, y, glyph) {
    const w = Math.max(30, glyph.length * 11 + 14);
    return `<rect class="c-tag" x="${x - w / 2}" y="${y - 13}" width="${w}" height="26" rx="13" />` +
      `<text class="c-glyph" x="${x}" y="${y + 5}" text-anchor="middle">${esc(glyph)}</text>`;
  }
  function label(x, y, anchor, [, act, sub]) {
    return `<text class="c-act" x="${x}" y="${y + (sub ? -1 : 6)}" text-anchor="${anchor}">${esc(act)}</text>` +
      (sub ? `<text class="c-sub" x="${x}" y="${y + 18}" text-anchor="${anchor}">${esc(sub)}</text>` : '');
  }

  function padSvg() {
    let s = `<svg viewBox="0 0 1240 660" class="controls-svg" role="img" aria-label="Gamepad controls">`;
    s += `<g transform="translate(${OX} ${OY})" class="c-pad">`;
    s += `<path d="${BODY}" />`;
    // Triggers and bumpers, along the shoulders.
    s += '<path d="M268 150 C282 120 340 112 362 142" /><path d="M662 150 C648 120 590 112 568 142" />';
    s += '<path d="M236 190 C250 166 290 154 330 160" /><path d="M694 190 C680 166 640 154 600 160" />';
    s += '<circle cx="310" cy="270" r="38" class="c-hi" /><circle cx="310" cy="270" r="24" />';
    s += '<circle cx="552" cy="368" r="38" class="c-hi" /><circle cx="552" cy="368" r="24" />';
    s += '<path d="M364 334 h28 v20 h20 v28 h-20 v20 h-28 v-20 h-20 v-28 h20 Z" />';
    for (const [k, cx, cy] of [['Y', 620, 232], ['X', 582, 270], ['B', 658, 270], ['A', 620, 308]]) {
      s += `<circle cx="${cx}" cy="${cy}" r="17" /><text class="c-btn" x="${cx}" y="${cy + 5}" text-anchor="middle">${k}</text>`;
    }
    s += '<circle cx="412" cy="272" r="11" /><circle cx="518" cy="272" r="11" /><circle cx="465" cy="222" r="20" />';
    s += '<rect x="451" y="300" width="28" height="11" rx="5.5" />';
    s += '</g>';
    for (const [k, y] of LEFT) {
      s += callout(LX, y, AT[k]) + tag(LX - 26, y, PAD[k][0]) + label(LX - 52, y, 'end', PAD[k]);
    }
    for (const [k, y] of RIGHT) {
      s += callout(RX, y, AT[k]) + tag(RX + 26, y, PAD[k][0]) + label(RX + 52, y, 'start', PAD[k]);
    }
    // View and Menu: up from the middle, labels above the shoulders.
    const v = AT.view, m = AT.menu;
    s += line([[v.x + OX, v.y + OY - 15], [v.x + OX, 22]]) + tag(v.x + OX - 42, 22, 'View');
    s += `<text class="c-act" x="${v.x + OX - 74}" y="28" text-anchor="end">${esc(PAD.view[1])}</text>`;
    s += line([[m.x + OX, m.y + OY - 15], [m.x + OX, 22]]) + tag(m.x + OX + 44, 22, 'Menu');
    s += `<text class="c-act" x="${m.x + OX + 80}" y="28" text-anchor="start">${esc(PAD.menu[1])}</text>`;
    return s + '</svg>';
  }

  const PAD_NOTES = [
    ['In the menu', 'LB / RB switch tabs · d-pad or stick moves the cursor · A picks up and puts down, or opens a bag · Y takes it in hand · X drops one · B backs out'],
    ['On the map', 'the left stick pans · LT / RT zoom · Y recenters on you'],
    ['At a chest', 'A takes or gives one · X the whole stack'],
  ];

  // ---------------------------------------------------------------------------
  // The keyboard: [label on the cap, width in keys, action]. Unbound keys are blank.

  const U = 70, GAP = 6;
  const ROWS = [
    [['Esc', 1, 'pause'], [null, 0.5], ['`', 1, 'dev panel', 'dev'], ['1', 1, 'item ‹'], ['2', 1, 'item ›'], ['3', 1], ['4', 1], ['5', 1]],
    [['Tab', 1.5, 'map & bag'], ['Q', 1, 'equipment', 'dim'], ['W', 1, 'move'], ['E', 1, 'interact'], ['R', 1, 'lamp'], ['T', 1]],
    [['Caps', 1.75], ['A', 1, 'move'], ['S', 1, 'move'], ['D', 1, 'move'], ['F', 1, 'use item'], ['G', 1, 'put away']],
    [['Shift', 2.25, 'run'], ['Z', 1], ['X', 1, 'drop', 'menu'], ['C', 1, 'crouch'], ['V', 1], ['B', 1]],
    [['Ctrl', 1.25], ['Win', 1.25], ['Alt', 1.25], ['Space', 4.5, 'jump']],
  ];

  function cap(x, y, w, [k, , act, kind]) {
    const on = !!act;
    let s = `<rect class="k-cap${on ? ' on' : ''}${kind ? ' ' + kind : ''}" x="${x}" y="${y}" width="${w}" height="${U}" rx="8" />`;
    if (k) s += `<text class="k-key" x="${x + 9}" y="${y + 22}">${esc(k)}</text>`;
    if (act) s += `<text class="k-act${kind ? ' ' + kind : ''}" x="${x + w / 2}" y="${y + U - 12}" text-anchor="middle">${esc(act)}</text>`;
    return s;
  }

  function keysSvg() {
    let s = `<svg viewBox="0 0 1240 400" class="controls-svg" role="img" aria-label="Keyboard and mouse controls">`;
    let y = 10;
    for (const row of ROWS) {
      let x = 10;
      for (const k of row) {
        const w = k[1] * U + (k[1] - 1) * GAP;
        if (k[0] !== null) s += cap(x, y, w, k);
        x += w + GAP;
      }
      y += U + GAP + (row === ROWS[0] ? 8 : 0);
    }
    // The arrows: they move too.
    const ax = 660, ay = 10 + 3 * (U + GAP) + 8;
    s += cap(ax + U + GAP, ay, U, ['↑', 1, 'move']);
    for (const [i, a] of ['←', '↓', '→'].entries()) s += cap(ax + i * (U + GAP), ay + U + GAP, U, [a, 1, 'move']);
    // The mouse.
    const mx = 900, my = 10;
    s += `<g class="c-pad" transform="translate(${mx} ${my})">` +
      '<path d="M60 0 C110 0 120 40 120 90 L120 150 C120 200 95 230 60 230 C25 230 0 200 0 150 L0 90 C0 40 10 0 60 0 Z" />' +
      '<path d="M60 0 L60 80 M0 80 L120 80" /><rect x="52" y="22" width="16" height="34" rx="8" class="c-hi" /></g>';
    s += line([[mx + 70, my + 39], [mx + 150, my + 39]]);
    s += `<text class="c-act" x="${mx + 158}" y="${my + 38}">wheel</text>`;
    s += `<text class="c-sub" x="${mx + 158}" y="${my + 58}">item in hand · map: zoom</text>`;
    s += `<text class="c-act" x="${mx + 60}" y="${my + 268}" text-anchor="middle">click</text>`;
    s += `<text class="c-sub" x="${mx + 60}" y="${my + 288}" text-anchor="middle">the minimap: open the map</text>`;
    s += `<text class="c-sub" x="${mx + 60}" y="${my + 306}" text-anchor="middle">on the map: drag to pan</text>`;
    s += `<text class="c-sub" x="${mx + 60}" y="${my + 324}" text-anchor="middle">buttons and prompts</text>`;
    return s + '</svg>';
  }

  const KEY_NOTES = [
    ['Held', 'E fills a ring for slow actions · Space held jumps higher · Shift runs'],
    ['In the menu', '1 / 2 switch tabs · WASD or arrows move the cursor · Space picks up and puts down, or opens a bag · F takes it in hand · X drops one · Esc backs out · Tab closes'],
    ['At a chest', 'Space takes or gives one · X or E the whole stack'],
    ['Pad only', 'peeking (the right stick); the keyboard has no look key yet · Q is for worn equipment, which nothing uses yet'],
  ];

  // ---------------------------------------------------------------------------
  // The page

  const view = $('controls-view'), hint = $('controls-hint');
  const tabBtns = { pad: $('controls-pad'), keys: $('controls-keys') };
  let tab = 'pad';

  function notes(list) {
    return '<dl class="controls-notes">' + list.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join('') + '</dl>';
  }
  function show(t) {
    tab = t;
    view.innerHTML = t === 'pad' ? padSvg() + notes(PAD_NOTES) : keysSvg() + notes(KEY_NOTES);
    for (const k in tabBtns) {
      tabBtns[k].classList.toggle('primary', k === t);
      tabBtns[k].setAttribute('aria-selected', String(k === t));
    }
  }
  /** Open on the pad if one's in use, else on where you were last. */
  function openControls() {
    $('title-main').hidden = true;
    $('controls').hidden = false;
    $('title').classList.add('wide');
    show(W.padMode() ? 'pad' : tab);
    hint.textContent = W.padMode() ? 'up / down switch · B back' : '↑ / ↓ switch · Esc back';
    tabBtns[tab].focus();
  }
  function closeControls() {
    $('controls').hidden = true;
    $('title-main').hidden = false;
    $('title').classList.remove('wide');
    $('title-controls').focus();
  }
  const controlsOpen = () => !$('controls').hidden;
  /** Up / down: the other page. */
  function controlsSwitch() {
    show(tab === 'pad' ? 'keys' : 'pad');
    tabBtns[tab].focus();
  }

  tabBtns.pad.addEventListener('click', () => show('pad'));
  tabBtns.keys.addEventListener('click', () => show('keys'));
  $('controls-back').addEventListener('click', closeControls);

  Object.assign(W, { openControls, closeControls, controlsOpen, controlsSwitch });
})(window);
