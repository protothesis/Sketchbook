// Walk mode's dev panel: ` (backquote, above Tab) opens it. Give yourself
// things, jump around, drop creatures in, and tune the numbers live.
//
// The sliders are built from the tuning tables on DungeonPlay.walk
// (TABLES below), so a new number in one of them shows up here by itself.
// They write straight into the tables, which the game reads every frame,
// so a change takes effect at once. A few numbers are only read when
// something is made (a new room, a new creature); those take effect then.
//
// Tweaks are kept in localStorage (DEV_KEY, never the save) and come back
// on reload until you reset them. "Copy changes" puts them on the
// clipboard as JSON, to paste back to Claude as new defaults.
//
// Everything else lives here too: the only hooks are the script tag in
// play.html and the tables' exports.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, $, state, RULES } = W;

  if (!W.ECOLOGY && W.ecology) W.ECOLOGY = W.ecology.ECOLOGY;

  const DEV_KEY = 'dungeon-engine:dev';
  // Shown in this order; a table that isn't exported is skipped.
  const TABLES = ['RULES', 'POOL', 'LIGHT', 'HALO', 'UNREST', 'EMBER', 'STREAM', 'DRIP', 'FEED_GLOW', 'CREEPER', 'GHOST', 'PIXIE', 'CREATURE',
    'ECOLOGY', 'WELL', 'GLOW', 'SCONCE_LIGHT', 'SAVE_LANTERN', 'PACK_LIGHT', 'JUMP', 'CAMERA'];
  // Numbers that size arrays or pools when the game starts: changing them live breaks things.
  const FIXED = new Set(['STREAM.count', 'GLOW.lights', 'WELL.motes', 'WELL.notches']);

  // ---------------------------------------------------------------------------
  // Tables: defaults, tweaks, paths

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const defaults = {};
  for (const name of TABLES) if (W[name]) defaults[name] = clone(W[name]);

  function getAt(obj, path) { return path.reduce((o, k) => (o == null ? o : o[k]), obj); }
  function setAt(obj, path, v) { getAt(obj, path.slice(0, -1))[path[path.length - 1]] = v; }

  /** Every leaf that differs from its default: { "CREEPER.hops.hunt.len": 0.6, ... }. */
  function changes() {
    const out = {};
    const walk = (name, cur, def, path) => {
      if (cur && typeof cur === 'object') {
        for (const k in cur) walk(name, cur[k], def ? def[k] : undefined, path.concat(k));
      } else if (cur !== def) out[[name].concat(path).join('.')] = cur;
    };
    for (const name in defaults) walk(name, W[name], defaults[name], []);
    return out;
  }

  function store() {
    try {
      const c = changes();
      if (Object.keys(c).length) global.localStorage.setItem(DEV_KEY, JSON.stringify(c));
      else global.localStorage.removeItem(DEV_KEY);
    } catch (e) { /* storage blocked: tweaks last until reload */ }
  }

  /** Put stored tweaks back (on load). Unknown or retyped paths are dropped. */
  function restore() {
    let c = null;
    try { c = JSON.parse(global.localStorage.getItem(DEV_KEY) || 'null'); } catch (e) { c = null; }
    if (!c) return;
    for (const key in c) {
      const [name, ...path] = key.split('.');
      if (!defaults[name] || FIXED.has(key)) continue;
      const def = getAt(defaults[name], path);
      if (def === undefined || typeof def !== typeof c[key]) continue;
      setAt(W[name], path, c[key]);
    }
  }
  restore();

  // ---------------------------------------------------------------------------
  // Cheats: things, places, creatures

  const p = () => state.player;
  let seq = 0;
  const devId = (kind) => 'dev:' + kind + ':' + Date.now().toString(36) + (++seq);
  const inWorld = (x, y) => state.exp.registry[DE.key(Math.floor(x), Math.floor(y))] !== undefined;

  /** A spot about a cell in front of you, if it's floor; else where you stand. */
  function ahead(dist = 1.2) {
    const q = p(), x = q.x + Math.sin(q.angle) * dist, y = q.y + Math.cos(q.angle) * dist;
    return inWorld(x, y) ? { x, y } : { x: q.x, y: q.y };
  }

  function after(caption) {
    W.savePlayer();
    W.refreshHotbar();
    W.refreshHud();
    if (caption) W.showCaption('dev · ' + caption);
  }

  /** Something carried in your hands, made from nothing (it goes where you set it down). */
  function giveObject(kind, extra) {
    const run = state.run;
    if (state.carry || run.carry) { W.showCaption('dev · set down what you carry first'); return; }
    const q = p(), key = devId(kind);
    run.objects[key] = Object.assign({ kind, sx: Math.floor(q.x * 2), sy: Math.floor(q.y * 2), lv: 0 }, extra);
    run.carry = key;
    W.buildCarried();
    after('a ' + kind + ' in your hands');
  }

  const GIVE = [
    ['shard', () => { W.gainFuel(1 / RULES.shardsPerCharge, true); after('a shard'); }],
    ['fill lamp', () => { state.run.fuel = W.maxCharges(); after('lamp full'); }],
    ['empty lamp', () => { state.run.fuel = 0; after('lamp empty'); }],
    ['stamina', () => { state.run.stamina = 1; after('stamina full'); }],
    ['faint', () => { W.passOut('dev · you faint'); }],
    ['key', () => { state.run.keys++; after('a key'); }],
    ['doorstone', () => { state.run.doorstones++; after('a doorstone'); }],
    ['jar', () => { state.run.jars.push({ id: 'j' + (++state.run.jarSeq), holds: null }); after('an empty jar'); }],
    ['jar: pixie', () => { state.run.jars.push({ id: 'j' + (++state.run.jarSeq), holds: 'pixie' }); after('a jarred pixie'); }],
    ['jar: entropy', () => { state.run.jars.push({ id: 'j' + (++state.run.jarSeq), holds: 'entropy' }); after('a jar of entropy'); }],
    ['hourglass', () => { state.run.equipment.hourglass = { holds: null }; after('an empty hourglass'); }],
    ['hourglass: pixie', () => { state.run.equipment.hourglass = { holds: 'pixie' }; after('a charged hourglass'); }],
    ...RULES.chalkColors.map((c) => [c + ' chalk', () => {
      state.run.chalks[c] = (state.run.chalks[c] || 0) + W.STROKES;
      after('a stick of ' + c + ' chalk');
    }]),
    ['crate', () => giveObject('crate')],
    ['block', () => giveObject('block', { color: RULES.pushColors[seq % RULES.pushColors.length] })],
    ['vessel', () => giveObject('vessel', { holds: null, n: 0 })],
    ['waystone', () => giveObject('waystone', { holds: null })],
    ['waystone: awake', () => giveObject('waystone', { holds: 'entropy' })],
  ];

  const SPAWN = [
    ['ghost', () => { const s = ahead(1.5); W.addGhost({ id: devId('ghost'), x: s.x, y: s.y }); after('a ghost'); }],
    ['pixie', () => { const s = ahead(); W.addPixie({ id: devId('pixie'), x: s.x, y: s.y }); after('a pixie'); }],
    ['creeper', () => { const s = ahead(2); W.addCreeper({ id: devId('creeper'), x: s.x, y: s.y }); after('a creeper'); }],
    ['clear all', () => { W.clearGhosts(); W.clearPixies(); W.clearCreepers(); after('creatures cleared'); }],
  ];

  function teleport(x, y) {
    const q = p();
    Object.assign(q, { x, y, z: 0, vz: 0 });
    W.snapCamera();
    after('teleported to ' + (q.spaceId || '?'));
  }

  // Map teleport: with it on, a click (not a drag) on the big map puts you there.
  let mapTeleport = false;
  const bm = $('bigmap-canvas');
  let tap = null;
  bm.addEventListener('pointerdown', (e) => { tap = { x: e.clientX, y: e.clientY }; });
  bm.addEventListener('pointermove', (e) => { if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 6) tap = null; });
  bm.addEventListener('pointerup', (e) => {
    const v = state.bigmap;
    if (!mapTeleport || !tap || !v || v.travel) { tap = null; return; }
    tap = null;
    const r = bm.getBoundingClientRect();
    const gx = v.cx + (e.clientX - r.left - r.width / 2) / v.px, gy = v.cy + (e.clientY - r.top - r.height / 2) / v.px;
    if (!inWorld(gx, gy)) { W.showCaption('dev · no floor there'); return; }
    W.closeBigMap();
    teleport(gx, gy);
  });

  // ---------------------------------------------------------------------------
  // The panel

  const css = `
  #dev-panel { position: fixed; top: 8px; right: 8px; bottom: 8px; width: min(360px, calc(100vw - 16px)); z-index: 60;
    background: rgba(14, 12, 20, 0.94); color: #ddd6ea; font: 12px/1.35 ui-monospace, Menlo, Consolas, monospace;
    border: 1px solid #3b3450; border-radius: 8px; display: flex; flex-direction: column; }
  #dev-panel[hidden] { display: none; }
  #dev-panel header { display: flex; gap: 6px; align-items: center; padding: 8px; border-bottom: 1px solid #3b3450; }
  #dev-panel header b { flex: 1; color: #b9a6ff; }
  #dev-panel .body { overflow-y: auto; padding: 4px 8px 12px; flex: 1; }
  #dev-panel details { border-bottom: 1px solid #2a2438; padding: 4px 0; }
  #dev-panel summary { cursor: pointer; color: #b9a6ff; padding: 2px 0; }
  #dev-panel details details { margin-left: 8px; border: 0; }
  #dev-panel details details summary { color: #9c93b4; }
  #dev-panel .btns { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 0; }
  #dev-panel button { background: #2a2438; color: #ddd6ea; border: 1px solid #463d60; border-radius: 4px;
    font: inherit; padding: 3px 7px; cursor: pointer; }
  #dev-panel button:hover { background: #3a3150; }
  #dev-panel .row { display: grid; grid-template-columns: 1fr 96px 58px; gap: 4px; align-items: center; padding: 1px 0; }
  #dev-panel .row.changed label { color: #ffd27a; }
  #dev-panel .row label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #dev-panel .row input[type=range] { width: 100%; }
  #dev-panel .row input[type=number] { width: 100%; background: #1c1828; color: inherit; border: 1px solid #3b3450; font: inherit; }
  #dev-panel .tools { display: flex; gap: 4px; align-items: center; padding: 4px 0; }
  #dev-panel .note { color: #8a829e; padding: 2px 0; }
  #dev-panel textarea { width: 100%; height: 70px; background: #1c1828; color: #ffd27a; border: 1px solid #3b3450; font: inherit; }
  #dev-chip { position: fixed; top: 8px; right: 8px; z-index: 59; background: #3a2a10; color: #ffd27a;
    font: 11px ui-monospace, monospace; padding: 2px 6px; border-radius: 4px; pointer-events: auto; cursor: pointer; }
  #dev-chip[hidden] { display: none; }`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const el = (tag, props, ...kids) => {
    const n = document.createElement(tag);
    if (props) for (const k in props) { if (k === 'class') n.className = props[k]; else if (k in n) n[k] = props[k]; else n.setAttribute(k, props[k]); }
    for (const c of kids) if (c != null) n.append(c);
    return n;
  };
  const button = (label, fn) => el('button', { type: 'button', onclick: (e) => { fn(); e.currentTarget.blur(); } }, label);
  const section = (title, open, ...kids) => el('details', { open }, el('summary', null, title), ...kids);

  const panel = el('div', { id: 'dev-panel', hidden: true });
  const chip = el('div', { id: 'dev-chip', hidden: true, title: 'dev tweaks are active (` opens the panel)' }, 'dev tweaks');
  chip.addEventListener('click', () => toggle(true));
  const changesBox = el('textarea', { readOnly: true, placeholder: 'no changes from the defaults' });

  // Lanterns change as you explore, so the list is rebuilt each time the panel opens.
  // (◉: where you'd wake; ✦: its waystone is awake.)
  const stoneBox = el('div', { class: 'btns' });
  function fillStones() {
    const home = W.hearth();
    stoneBox.replaceChildren(...state.lanterns.map((ln) => {
      const st = state.waystones.find((o) => o.spaceId === ln.spaceId);
      return button(ln.spaceId + (ln === home ? ' ◉' : '') + (st && st.awake ? ' ✦' : ''), () => { W.placeAt(ln); after('at the lantern in ' + ln.spaceId); });
    }));
    if (!state.lanterns.length) stoneBox.append(el('span', { class: 'note' }, 'no halls found yet'));
  }
  const mapBox = el('input', { type: 'checkbox', onchange: (e) => { mapTeleport = e.target.checked; } });

  // --- a slider row per number, a checkbox per switch, a group per object

  const rows = []; // { name, path, sync() }: to refresh after a reset

  function numRow(name, path, label) {
    const key = [name].concat(path).join('.');
    const def = getAt(defaults[name], path);
    const isColor = /colou?r/i.test(label) || /colors$/i.test(path[path.length - 2] || '') || def > 0xffff;
    const row = el('div', { class: 'row' });
    const lab = el('label', { title: key }, label);
    let input, num;
    if (FIXED.has(key)) {
      row.append(lab, el('span', { class: 'note' }, 'fixed at start'), el('span', null, String(def)));
      return row;
    }
    if (isColor) {
      input = el('input', { type: 'color' });
      num = el('span');
      const hex = (v) => '#' + (v >>> 0).toString(16).padStart(6, '0');
      const sync = () => { const v = getAt(W[name], path); input.value = hex(v); num.textContent = hex(v); row.classList.toggle('changed', v !== def); };
      input.addEventListener('input', () => { setAt(W[name], path, parseInt(input.value.slice(1), 16)); sync(); changed(); });
      rows.push({ sync });
      sync();
    } else {
      const int = Number.isInteger(def) && Math.abs(def) >= 1;
      const span = def === 0 ? 1 : Math.abs(def) * 2;
      const lo = def < 0 ? -span : 0, hi = int ? Math.max(span, def + 4) : span;
      const step = int ? 1 : Math.pow(10, Math.floor(Math.log10(span / 100))); // a round step: 0.01, 0.001, ...
      input = el('input', { type: 'range', min: lo, max: hi, step });
      num = el('input', { type: 'number', step: int ? 1 : 'any' });
      const sync = () => {
        const v = getAt(W[name], path);
        if (v < +input.min) input.min = v;
        if (v > +input.max) input.max = v;
        input.value = v; num.value = +v.toFixed(4);
        row.classList.toggle('changed', v !== def);
      };
      const set = (v) => { if (!Number.isFinite(v)) return; setAt(W[name], path, v); sync(); changed(); };
      input.addEventListener('input', () => set(+input.value));
      num.addEventListener('change', () => set(+num.value));
      lab.addEventListener('dblclick', () => set(def)); // double-click a name: back to its default
      rows.push({ sync });
      sync();
    }
    row.append(lab, input, num);
    return row;
  }

  function boolRow(name, path, label) {
    const def = getAt(defaults[name], path);
    const box = el('input', { type: 'checkbox' });
    const row = el('div', { class: 'row' }, el('label', { title: [name].concat(path).join('.') }, label), box, el('span'));
    const sync = () => { const v = getAt(W[name], path); box.checked = v; row.classList.toggle('changed', v !== def); };
    box.addEventListener('change', () => { setAt(W[name], path, box.checked); sync(); changed(); });
    rows.push({ sync });
    sync();
    return row;
  }

  /** One table's (or sub-object's) rows: plain leaves first, then nested groups. */
  function tableRows(name, path) {
    const obj = getAt(W[name], path), leaves = [], groups = [];
    for (const k of Object.keys(obj)) {
      const v = obj[k], sub = path.concat(k);
      const label = Array.isArray(obj) && v && typeof v === 'object' && v.who ? `${k}: ${v.who} ${v.does} ${v.what}` : k;
      if (typeof v === 'number') leaves.push(numRow(name, sub, label));
      else if (typeof v === 'boolean') leaves.push(boolRow(name, sub, label));
      else if (v && typeof v === 'object') {
        const kids = tableRows(name, sub);
        if (kids.length) groups.push(section(label, false, ...kids));
      }
    }
    return leaves.concat(groups);
  }

  function tableSection(name) {
    const reset = button('reset', () => { putDefaults(W[name], defaults[name]); for (const r of rows) r.sync(); changed(); });
    return section(name, false, el('div', { class: 'tools' }, reset), ...tableRows(name, []));
  }

  function changed() {
    const c = changes(), n = Object.keys(c).length;
    changesBox.value = n ? JSON.stringify(c, null, 1) : '';
    chip.hidden = !n || !panel.hidden;
    chip.textContent = `dev tweaks · ${n}`;
    store();
  }

  function copyChanges() {
    const text = changesBox.value || '{}';
    const done = () => W.showCaption('dev · changes copied');
    const fallback = () => { changesBox.select(); document.execCommand('copy'); done(); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  /** Back to the defaults, in place: the game holds references to these objects. */
  function putDefaults(cur, def) {
    for (const k in def) {
      if (def[k] && typeof def[k] === 'object') putDefaults(cur[k], def[k]);
      else cur[k] = def[k];
    }
  }

  function resetAll() {
    for (const name in defaults) putDefaults(W[name], defaults[name]);
    for (const r of rows) r.sync();
    changed();
  }

  panel.append(
    el('header', null, el('b', null, 'dev'), button('copy changes', copyChanges), button('reset all', resetAll),
      button('close `', () => toggle(false))),
    el('div', { class: 'body' },
      section('give', true, el('div', { class: 'btns' }, ...GIVE.map(([l, fn]) => button(l, fn)))),
      section('spawn (in front of you)', true, el('div', { class: 'btns' }, ...SPAWN.map(([l, fn]) => button(l, fn)))),
      section('teleport', true,
        el('div', { class: 'tools' }, el('label', null, mapBox, ' click the big map (Tab) to go there')),
        el('div', { class: 'note' }, 'to a waystone (✦ awake):'), stoneBox),
      el('div', { class: 'note' }, 'Tuning: changes apply at once. Gold = changed; double-click a name to reset it. ' +
        'RULES chances apply to rooms generated after the change.'),
      ...Object.keys(defaults).map(tableSection),
      section('changes (kept across reloads)', false, changesBox)));
  document.body.append(panel, chip);

  function toggle(open = panel.hidden) {
    panel.hidden = !open;
    if (open) fillStones();
    changed();
  }

  global.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
    if (e.key !== '`' || e.repeat) return;
    toggle();
    e.preventDefault();
  });
  // Sliders keep focus after a drag: let WASD and the rest go back to the game.
  panel.addEventListener('pointerup', (e) => {
    if (e.target.type === 'range' || e.target.type === 'checkbox') e.target.blur();
  });

  changed();
  W.dev = { toggle, changes, resetAll, teleport, TABLES };
})(window);
