// Walk mode: the controls screen, a page of the title screen (game.js opens
// it). Two drawings in one frame (the same viewBox, so switching never moves
// anything): an Xbox-style pad with its buttons called out, and the left half
// of a keyboard with the arrows and a mouse. The tabs sit side by side, so
// left / right switch them (A / D, the arrows, 1 / 2; the d-pad, LB / RB);
// Esc (B) goes back.
//
// The bindings here are drawn by hand from input.js, gamepad.js and
// menu.js: change a binding there, change it here too.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { $ } = W;

  const VIEW = '0 0 1600 830'; // both pages
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  // ---------------------------------------------------------------------------
  // The pad. A callout: its glyph, what it does, and the alt (where: what).
  // A stick has a second row for its click: [glyph, action] under it.

  const PAD = {
    lt: { g: 'LT', act: 'run', alt: 'map: zoom out' },
    lb: { g: 'LB', act: 'item ‹', alt: 'menu: tab ‹' },
    ls: { g: 'LS', act: 'move', click: ['L3', 'crouch'] },
    dpad: { g: '✚', act: 'move in menus', alt: 'choices: pick' },
    rt: { g: 'RT', act: 'duster', alt: 'map: zoom in' },
    rb: { g: 'RB', act: 'item ›', alt: 'menu: tab ›' },
    y: { g: 'Y', act: 'item: out, then use', alt: 'grid: take in hand · map: recenter' },
    b: { g: 'B', act: 'put away', alt: 'hold: drop · menus: back' },
    x: { g: 'X', act: 'interact', alt: 'hold: fill ring · grid: drop' },
    a: { g: 'A', act: 'jump', alt: 'hold: higher · menu: confirm' },
    rs: { g: 'RS', act: 'peek', click: ['R3', 'lamp'] },
  };

  // The drawing is in its own frame, placed at (OX, OY).
  const OX = 260, OY = 90;
  const BODY = 'M380 172 L550 172 C575 172 590 158 620 156 C660 154 690 170 705 200 C730 250 760 360 770 460 ' +
    'C778 530 760 560 720 560 C690 560 670 540 645 505 C620 470 600 450 560 448 L370 448 C330 450 310 470 285 505 ' +
    'C260 540 240 560 210 560 C170 560 152 530 160 460 C170 360 200 250 225 200 C240 170 270 154 310 156 ' +
    'C340 158 355 172 380 172 Z';

  // Callout rows: the label's y, then the line's route from its elbow to the
  // part, in page coordinates (a line runs level from the tag to the first
  // point). Routed by hand so no two cross and none runs over a button: X
  // threads the middle of the four buttons, between B and A; the sticks
  // break well outside the body.
  const LTAG = 325, RTAG = 1125; // the tags' centres
  const LEFT = [
    ['lt', 140, [[500, 140], [551, 188]]],
    ['lb', 230, [[460, 230], [493, 257]]],
    ['ls', 330, [[415, 330], [529, 352]]],
    ['dpad', 530, [[570, 530], [620, 486]]],
  ];
  const RIGHT = [
    ['rt', 140, [[950, 140], [899, 188]]],
    ['rb', 230, [[990, 230], [957, 257]]],
    ['y', 322, [[901, 322]]],
    ['b', 400, [[968, 400], [934, 373]]],
    ['x', 480, [[1002, 480], [882, 360], [863, 360]]],
    ['a', 560, [[1042, 560], [895, 413]]],
    ['rs', 700, [[880, 700], [823, 498]]],
  ];
  const ROW2 = 70; // a stick's click row, under its own

  const tagW = (g) => Math.max(48, g.length * 15 + 26);
  function tag(x, y, g, cls) {
    const w = tagW(g);
    return `<g class="c-tagg${cls ? ' ' + cls : ''}"><rect class="c-tag" x="${x - w / 2}" y="${y - 20}" width="${w}" height="40" rx="20" />` +
      `<text class="c-glyph" x="${x}" y="${y + 8}" text-anchor="middle">${esc(g)}</text></g>`;
  }
  const text = (cls, x, y, anchor, s) => `<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${esc(s)}</text>`;
  const line = (pts) => `<polyline class="c-line" points="${pts.map((p) => p.join(',')).join(' ')}" />`;

  /** One callout: tag, words, line (and a stick's click row). */
  function callout(side, key, y, route) {
    const c = PAD[key], w = tagW(c.g), left = side < 0;
    const tx = left ? LTAG : RTAG;
    const wx = left ? tx - w / 2 - 16 : tx + w / 2 + 16, anchor = left ? 'end' : 'start';
    let s = line([[left ? tx + w / 2 : tx - w / 2, y], ...route]) + tag(tx, y, c.g);
    s += text('c-act', wx, c.alt ? y + 4 : y + 13, anchor, c.act);
    if (c.alt) s += text('c-sub', wx, y + 40, anchor, c.alt);
    if (c.click) {
      const y2 = y + ROW2, [g2, act2] = c.click;
      const w2 = tagW(g2);
      s += tag(tx, y2, g2, 'press') + text('c-click', tx, y2 + 40, 'middle', 'click');
      s += text('c-act', left ? tx - w2 / 2 - 16 : tx + w2 / 2 + 16, y2 + 13, anchor, act2);
    }
    return s;
  }

  function padSvg() {
    let s = `<svg viewBox="${VIEW}" class="controls-svg" role="img" aria-label="Gamepad controls">`;
    s += `<g transform="translate(${OX} ${OY})" class="c-pad">`;
    s += `<path d="${BODY}" />`;
    // Triggers (an arch each) and bumpers (a ridge just above the shoulder).
    s += '<path d="M286 140 L286 112 C286 86 328 86 328 112 L328 140" /><path d="M644 140 L644 112 C644 86 602 86 602 112 L602 140" />';
    s += '<path class="c-ridge" d="M230 180 C246 152 286 140 334 145" /><path class="c-ridge" d="M700 180 C684 152 644 140 596 145" />';
    s += '<circle cx="310" cy="270" r="38" class="c-hi" /><circle cx="310" cy="270" r="24" />';
    s += '<circle cx="552" cy="368" r="38" class="c-hi" /><circle cx="552" cy="368" r="24" />';
    s += '<path d="M364 334 h28 v20 h20 v28 h-20 v20 h-28 v-20 h-20 v-28 h20 Z" />';
    for (const [k, cx, cy] of [['Y', 620, 232], ['X', 582, 270], ['B', 658, 270], ['A', 620, 308]]) {
      s += `<circle cx="${cx}" cy="${cy}" r="17" /><text class="c-btn" x="${cx}" y="${cy + 6}" text-anchor="middle">${k}</text>`;
    }
    s += '<circle cx="412" cy="272" r="11" /><circle cx="518" cy="272" r="11" /><circle cx="465" cy="222" r="20" />';
    s += '<rect x="451" y="300" width="28" height="11" rx="5.5" />';
    s += '</g>';
    for (const [k, y, route] of LEFT) s += callout(-1, k, y, route);
    for (const [k, y, route] of RIGHT) s += callout(1, k, y, route);
    // View and Menu: straight up from the middle, to tags above the triggers.
    s += line([[672, 349], [672, 65]]) + tag(672, 45, 'View') + text('c-act', 672 - tagW('View') / 2 - 16, 58, 'end', 'map & inventory');
    s += line([[778, 349], [778, 65]]) + tag(778, 45, 'Menu') + text('c-act', 778 + tagW('Menu') / 2 + 16, 58, 'start', 'pause');
    return s + '</svg>';
  }

  const PAD_NOTES = [
    ['menu', 'LB / RB switch tabs · d-pad or stick moves the cursor · A picks up and puts down, or opens a bag · Y takes it in hand · X drops one · B backs out'],
    ['map', 'left stick pans · LT / RT zoom · Y recenters on you'],
    ['chest', 'A takes or gives one · X the whole stack'],
  ];

  // ---------------------------------------------------------------------------
  // The keyboard: [cap, width in keys, action, kind]. A key with no action is
  // drawn blank. kind: 'menu' (only in the menu), 'dim' (bound, little use).

  const U = 110, GAP = 6, KX = 20, KY = 110;
  const ROWS = [
    [['Esc', 1, 'pause'], [null, 0.5], ['`', 1, 'dev', 'dim'], ['1', 1, 'item ‹'], ['2', 1, 'item ›'], ['3', 1], ['4', 1], ['5', 1]],
    [['Tab', 1.5, 'map & bag'], ['Q', 1, 'duster'], ['W', 1, 'move'], ['E', 1, 'interact'], ['R', 1, 'lamp'], ['T', 1]],
    [['Caps', 1.75], ['A', 1, 'move'], ['S', 1, 'move'], ['D', 1, 'move'], ['F', 1, 'item'], ['G', 1, 'put away']],
    [['Shift', 2.25, 'run'], ['Z', 1], ['X', 1, 'drop', 'menu'], ['C', 1, 'crouch'], ['V', 1], ['B', 1]],
    [['Ctrl', 1.25], ['Win', 1.25], ['Alt', 1.25], ['Space', 4.5, 'jump']],
  ];

  function cap(x, y, w, [k, , act, kind]) {
    const cls = (act ? ' on' : '') + (kind ? ' ' + kind : '');
    let s = `<rect class="k-cap${cls}" x="${x}" y="${y}" width="${w}" height="${U}" rx="10" />`;
    if (k) s += `<text class="k-key" x="${x + 12}" y="${y + 32}">${esc(k)}</text>`;
    if (act) s += text('k-act' + (kind ? ' ' + kind : ''), x + w / 2, y + U - 16, 'middle', act);
    return s;
  }

  function keysSvg() {
    let s = `<svg viewBox="${VIEW}" class="controls-svg" role="img" aria-label="Keyboard and mouse controls">`;
    let y = KY;
    for (const row of ROWS) {
      let x = KX;
      for (const k of row) {
        const w = k[1] * U + (k[1] - 1) * GAP;
        if (k[0] !== null) s += cap(x, y, w, k);
        x += w + GAP;
      }
      y += U + GAP + (row === ROWS[0] ? 8 : 0);
    }
    // The arrows: they move too.
    const ax = 990, ay = KY + 3 * (U + GAP) + 8;
    s += cap(ax + U + GAP, ay, U, ['↑', 1, 'move']);
    for (const [i, a] of ['←', '↓', '→'].entries()) s += cap(ax + i * (U + GAP), ay + U + GAP, U, [a, 1, 'move']);
    // The mouse, its words to its right.
    const mx = 1080, my = KY;
    s += `<g class="c-pad" transform="translate(${mx} ${my}) scale(1.2)">` +
      '<path d="M60 0 C110 0 120 40 120 90 L120 150 C120 200 95 230 60 230 C25 230 0 200 0 150 L0 90 C0 40 10 0 60 0 Z" />' +
      '<path d="M60 0 L60 80 M0 80 L120 80" /><rect x="52" y="22" width="16" height="34" rx="8" class="c-hi" /></g>';
    const lx = mx + 180;
    s += line([[mx + 86, my + 46], [lx - 12, my + 46]]);
    s += text('c-act', lx, my + 58, 'start', 'wheel');
    s += text('c-sub', lx, my + 96, 'start', 'hand: switch item');
    s += text('c-sub', lx, my + 130, 'start', 'map: zoom');
    s += text('c-act', lx, my + 200, 'start', 'click');
    s += text('c-sub', lx, my + 238, 'start', 'minimap: open map');
    s += text('c-sub', lx, my + 272, 'start', 'map: drag to pan');
    return s + '</svg>';
  }

  const KEY_NOTES = [
    ['hold', 'E fills a ring for slow actions · Space jumps higher · Shift runs'],
    ['menu', '1 / 2 switch tabs · WASD or arrows move the cursor · Space picks up and puts down, or opens a bag · F takes it in hand · X drops one · Esc backs out · Tab closes'],
    ['chest', 'Space takes or gives one · X or E the whole stack'],
    ['pad only', 'peeking (the right stick) · Q is for worn equipment, which nothing uses yet'],
  ];

  // ---------------------------------------------------------------------------
  // The page

  const view = $('controls-view'), hint = $('controls-hint');
  const tabBtns = { pad: $('controls-pad'), keys: $('controls-keys') };
  const ORDER = ['pad', 'keys'];
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
    hint.textContent = W.padMode() ? 'LB / RB switch · B back' : '← / → switch · Esc back';
    tabBtns[tab].focus();
  }
  function closeControls() {
    $('controls').hidden = true;
    $('title-main').hidden = false;
    $('title').classList.remove('wide');
    $('title-controls').focus();
  }
  const controlsOpen = () => !$('controls').hidden;
  /** Left (-1) or right (+1): the page that way, if there is one. */
  function controlsSwitch(dir) {
    const i = Math.max(0, Math.min(ORDER.length - 1, ORDER.indexOf(tab) + (dir < 0 ? -1 : 1)));
    if (ORDER[i] !== tab) show(ORDER[i]);
    tabBtns[tab].focus();
  }

  tabBtns.pad.addEventListener('click', () => show('pad'));
  tabBtns.keys.addEventListener('click', () => show('keys'));

  Object.assign(W, { openControls, closeControls, controlsOpen, controlsSwitch });
})(window);
