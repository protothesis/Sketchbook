// Walk mode's dev panel: ` (backquote, above Tab) opens it. Give yourself
// things, jump around, drop creatures in, and tune the numbers live.
//
// The sliders are built from the tuning tables on DungeonPlay.walk
// (TABLES below), so a new number in one of them shows up here by itself.
// Where each one goes (tab, section) and what it means (the hover tooltip)
// comes from dev-meta.js; a number it doesn't know lands under "Other".
// They write straight into the tables, which the game reads every frame,
// so a change takes effect at once. A few numbers are only read when
// something is made (a new room, a new run); dev-meta.js marks those.
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
  const TABLES = ['PLAYER', 'RULES', 'POOL', 'LIGHT', 'HALO', 'UNREST', 'EMBER', 'STREAM', 'DRIP', 'FEED_GLOW', 'CREEPER', 'GHOST', 'PIXIE', 'CREATURE',
    'ECOLOGY', 'WELL', 'DUST', 'SLASH', 'GLOW', 'SCONCE_LIGHT', 'SAVE_LANTERN', 'PACK_LIGHT', 'JUMP', 'CAMERA', 'SHADOW', 'SETDOWN', 'SHADOW_FADE', 'PSYCHE'];
  const META = W.DEV_META || { TABS: [], DOCS: {} };
  // Numbers that size arrays or pools when the game starts: changing them live breaks things.
  const FIXED = new Set(Object.keys(META.DOCS).filter((k) => Array.isArray(META.DOCS[k]) && META.DOCS[k][1].when === 'fixed'));

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
  #dev-panel { position: fixed; top: 8px; right: 8px; bottom: 8px; width: min(440px, calc(100vw - 16px)); z-index: 60;
    background: rgba(14, 12, 20, 0.95); color: #ddd6ea; font: 12px/1.35 ui-monospace, Menlo, Consolas, monospace;
    border: 1px solid #3b3450; border-radius: 8px; display: flex; flex-direction: column; }
  #dev-panel[hidden] { display: none; }
  #dev-panel header { display: flex; gap: 6px; align-items: center; padding: 8px 8px 6px; }
  #dev-panel header b { flex: 1; color: #b9a6ff; }
  #dev-panel .find { display: flex; gap: 8px; align-items: center; padding: 0 8px 6px; }
  #dev-panel .find input[type=search] { flex: 1; background: #1c1828; color: inherit; border: 1px solid #3b3450;
    border-radius: 4px; font: inherit; padding: 3px 6px; }
  #dev-panel .tabs { display: flex; flex-wrap: wrap; gap: 2px; padding: 0 8px; border-bottom: 1px solid #3b3450; }
  #dev-panel .tabs button { border: 1px solid transparent; border-bottom: 0; border-radius: 4px 4px 0 0; background: none; color: #9c93b4; }
  #dev-panel .tabs button.on { background: #2a2438; border-color: #463d60; color: #ddd6ea; }
  #dev-panel .tabs button .n { color: #ffd27a; margin-left: 3px; }
  #dev-panel .tabs[hidden] { display: none; }
  #dev-panel .body { overflow-y: auto; padding: 4px 8px 12px; flex: 1; }
  #dev-panel .pane[hidden], #dev-panel .row[hidden], #dev-panel details[hidden], #dev-panel .cheat[hidden] { display: none; }
  #dev-panel .pane > h3 { margin: 10px 0 2px; font-size: 11px; color: #8a829e; text-transform: uppercase; letter-spacing: 0.08em; }
  #dev-panel details { border-bottom: 1px solid #2a2438; padding: 4px 0; }
  #dev-panel summary { cursor: pointer; color: #b9a6ff; padding: 2px 0; }
  #dev-panel .badge { font-size: 10px; color: #8a829e; border: 1px solid #3b3450; border-radius: 3px; padding: 0 4px; margin-left: 6px; }
  #dev-panel .btns { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 0; }
  #dev-panel button { background: #2a2438; color: #ddd6ea; border: 1px solid #463d60; border-radius: 4px;
    font: inherit; padding: 3px 7px; cursor: pointer; }
  #dev-panel button:hover { background: #3a3150; }
  #dev-panel button.small { padding: 0 5px; font-size: 10px; float: right; }
  #dev-panel .row { display: grid; grid-template-columns: 1fr 110px 62px 52px; gap: 4px; align-items: center; padding: 1px 0; }
  #dev-panel .row.changed label { color: #ffd27a; }
  #dev-panel .row label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: help; }
  #dev-panel .row label.nodoc { color: #8a829e; font-style: italic; }
  #dev-panel .row .unit { color: #6f6886; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #dev-panel .row .pair { grid-column: 2 / 4; display: flex; gap: 4px; }
  #dev-panel .row input[type=range] { width: 100%; }
  #dev-panel .row input[type=number] { width: 100%; min-width: 0; background: #1c1828; color: inherit; border: 1px solid #3b3450; font: inherit; }
  #dev-panel .tools { display: flex; gap: 4px; align-items: center; padding: 4px 0; }
  #dev-panel .note { color: #8a829e; padding: 2px 0; }
  #dev-panel textarea { width: 100%; height: 160px; background: #1c1828; color: #ffd27a; border: 1px solid #3b3450; font: inherit; }
  #dev-tip { position: fixed; z-index: 61; width: 260px; pointer-events: none; background: #1c1828; color: #ddd6ea;
    font: 12px/1.4 ui-monospace, Menlo, Consolas, monospace; border: 1px solid #463d60; border-radius: 6px; padding: 7px 9px; }
  #dev-tip[hidden] { display: none; }
  #dev-tip b { color: #b9a6ff; }
  #dev-tip .meta { color: #8a829e; margin-top: 5px; font-size: 11px; }
  #dev-tip .when { color: #ffd27a; margin-top: 4px; font-size: 11px; }
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
  const button = (label, fn, cls) => el('button', { type: 'button', class: cls || '', onclick: (e) => { fn(); e.currentTarget.blur(); } }, label);
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

  // --- what each number is (dev-meta.js)

  const WHEN = { room: 'applies to rooms grown after the change', run: 'applies when a new run starts', fixed: 'fixed at start' };
  const BADGE = { room: 'new rooms', run: 'new runs', fixed: 'fixed' };
  const wild = Object.keys(META.DOCS).filter((k) => k.includes('*'))
    .map((k) => [new RegExp('^' + k.replace(/\./g, '\\.').replace(/\*/g, '[^.]+') + '$'), META.DOCS[k]]);

  /** { unit, text, opts } for a path, or null. */
  function docFor(key) {
    let d = META.DOCS[key];
    if (d === undefined) { const w = wild.find(([re]) => re.test(key)); d = w ? w[1] : undefined; }
    if (d === undefined) return null;
    const [s, opts] = Array.isArray(d) ? d : [d, {}];
    const i = s.indexOf('|');
    return i < 0 ? { unit: '', text: s, opts } : { unit: s.slice(0, i).trim(), text: s.slice(i + 1).trim(), opts };
  }

  /** The section a path belongs to: [tab, section], or null (it goes under Other). */
  const takes = (p, key) => (p.includes('.') ? key.startsWith(p) : key === p || key.startsWith(p + '.'));
  function placeOf(key) {
    for (const tab of META.TABS) for (const s of tab.sections) if (s.prefixes.some((p) => takes(p, key))) return [tab, s];
    return null;
  }

  const human = (k) => String(k).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  /** A row's label: its path inside the table, in words ("hops · lurk · len"). */
  function labelOf(name, path) {
    const out = [];
    let obj = W[name];
    for (const k of path) {
      const v = obj[k];
      out.push(Array.isArray(obj) && v && typeof v === 'object' && v.who ? `${v.who} ${v.does}s ${v.what}` : human(k));
      obj = v;
    }
    return out.join(' · ') || human(name);
  }

  // --- the tooltip: next to the panel, so it never covers the sliders

  const tip = el('div', { id: 'dev-tip', hidden: true });
  function showTip(row, r) {
    const d = r.doc, def = getAt(defaults[r.name], r.path);
    const fmt = (v) => (Array.isArray(v) ? v.map(fmt).join(' – ') : typeof v === 'number' ? String(+v.toFixed(4)) : String(v));
    const when = r.when && WHEN[r.when];
    tip.replaceChildren(...[
      el('b', null, r.label),
      el('div', null, d ? d.text : 'No description yet: add one to dev-meta.js.'),
      when ? el('div', { class: 'when' }, when) : null,
      el('div', { class: 'meta' }, r.key + (d && d.unit ? ' · ' + d.unit : '') + ' · default ' + fmt(def)),
    ].filter(Boolean));
    tip.hidden = false;
    const b = row.getBoundingClientRect(), pb = panel.getBoundingClientRect();
    const x = pb.left - tip.offsetWidth - 8;
    tip.style.left = Math.max(8, x) + 'px';
    tip.style.top = Math.min(innerHeight - tip.offsetHeight - 8, Math.max(8, b.top - 4)) + 'px';
    if (x < 8) tip.style.top = Math.min(innerHeight - tip.offsetHeight - 8, b.bottom + 4) + 'px'; // a narrow screen: under the row
  }

  // --- a row per number (a slider), switch (a checkbox) or pair of numbers (a range)

  const rows = []; // { key, name, path, label, doc, when, el, sync(), text }

  function makeRow(name, path, when) {
    const key = [name].concat(path).join('.');
    const def = getAt(defaults[name], path);
    const doc = docFor(key);
    if (doc && 'when' in doc.opts) when = doc.opts.when;
    const r = { key, name, path, label: (doc && doc.opts.label) || labelOf(name, path), doc, when };
    r.text = (r.label + ' ' + key + ' ' + (doc ? doc.text : '')).toLowerCase();
    const row = el('div', { class: 'row' });
    const lab = el('label', { class: doc ? '' : 'nodoc' }, r.label);
    lab.addEventListener('pointerenter', () => showTip(lab, r));
    lab.addEventListener('pointerleave', () => { tip.hidden = true; });
    const unit = el('span', { class: 'unit' }, doc ? doc.unit : '');
    const isChanged = () => JSON.stringify(getAt(W[name], path)) !== JSON.stringify(def);
    const set = (sub, v) => { setAt(W[name], path.concat(sub), v); r.sync(); changed(); };
    let sync;
    if (FIXED.has(key)) {
      row.append(lab, el('span', { class: 'note' }, 'fixed at start'), el('span', null, String(def)), unit);
      sync = () => {};
    } else if (Array.isArray(def)) {
      const nums = def.map((d, i) => {
        const n = el('input', { type: 'number', step: 'any' });
        n.addEventListener('change', () => { if (Number.isFinite(+n.value)) set([i], +n.value); });
        return n;
      });
      row.append(lab, el('span', { class: 'pair' }, ...nums), unit);
      sync = () => { getAt(W[name], path).forEach((v, i) => { nums[i].value = +v.toFixed(4); }); };
      lab.addEventListener('dblclick', () => { def.forEach((v, i) => setAt(W[name], path.concat(i), v)); r.sync(); changed(); });
    } else if (typeof def === 'boolean') {
      const box = el('input', { type: 'checkbox' });
      box.addEventListener('change', () => set([], box.checked));
      row.append(lab, box, el('span'), unit);
      sync = () => { box.checked = getAt(W[name], path); };
    } else if (doc && doc.unit === 'colour' || /colou?r/i.test(r.label) || def > 0xffff) {
      const input = el('input', { type: 'color' }), num = el('span');
      const hex = (v) => '#' + (v >>> 0).toString(16).padStart(6, '0');
      input.addEventListener('input', () => set([], parseInt(input.value.slice(1), 16)));
      row.append(lab, input, num, unit);
      sync = () => { const v = getAt(W[name], path); input.value = hex(v); num.textContent = hex(v); };
      lab.addEventListener('dblclick', () => set([], def));
    } else {
      const o = (doc && doc.opts) || {};
      const unitIs = (u) => doc && doc.unit === u;
      const share = unitIs('chance') || unitIs('share') || unitIs('opacity');
      const int = Number.isInteger(def) && Math.abs(def) >= 1 && !share;
      const span = def === 0 ? 1 : Math.abs(def) * 2;
      const lo = o.min !== undefined ? o.min : def < 0 ? -span : 0;
      const hi = o.max !== undefined ? o.max : share ? Math.max(1, def) : int ? Math.max(span, def + 4) : span;
      const step = int ? 1 : Math.pow(10, Math.floor(Math.log10((hi - lo) / 100))); // a round step: 0.01, 0.001, ...
      const input = el('input', { type: 'range', min: lo, max: hi, step });
      const num = el('input', { type: 'number', step: int ? 1 : 'any' });
      input.addEventListener('input', () => set([], +input.value));
      num.addEventListener('change', () => { if (Number.isFinite(+num.value)) set([], +num.value); });
      lab.addEventListener('dblclick', () => set([], def)); // double-click a name: back to its default
      row.append(lab, input, num, unit);
      sync = () => {
        const v = getAt(W[name], path);
        if (v < +input.min) input.min = v;
        if (v > +input.max) input.max = v;
        input.value = v; num.value = +v.toFixed(4);
      };
    }
    r.el = row;
    r.changed = isChanged;
    r.sync = () => { sync(); row.classList.toggle('changed', isChanged()); };
    r.sync();
    rows.push(r);
    return r;
  }

  /** Every tunable leaf of a table: [path, ...]. A short all-number array is one leaf (a range or stop). */
  function leaves(name) {
    const out = [];
    const walk = (v, path) => {
      if (Array.isArray(v) && v.length && v.length <= 4 && v.every((x) => typeof x === 'number')) out.push(path);
      else if (typeof v === 'number' || typeof v === 'boolean') out.push(path);
      else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], path.concat(k));
    };
    walk(W[name], []);
    return out;
  }

  // --- tabs of sections

  const OTHER = { id: 'other', label: 'Other', sections: [{ title: 'Not in dev-meta.js yet', when: null, prefixes: [] }] };
  const tabs = META.TABS.concat(OTHER).map((t) => ({ t, sections: t.sections.map((s) => ({ s, rows: [] })) }));
  const tabOf = new Map(tabs.map((x) => [x.t, x]));
  for (const name of Object.keys(defaults)) {
    for (const path of leaves(name)) {
      const key = [name].concat(path).join('.');
      const at = placeOf(key);
      const tab = at ? tabOf.get(at[0]) : tabs[tabs.length - 1];
      const s = at ? tab.sections[at[0].sections.indexOf(at[1])] : tab.sections[0];
      s.rows.push(makeRow(name, path, s.s.when));
    }
  }

  function sectionEl(x) {
    const reset = button('reset', () => {
      for (const r of x.rows) {
        const def = getAt(defaults[r.name], r.path);
        if (Array.isArray(def)) putDefaults(getAt(W[r.name], r.path), def); // in place: the game may hold the array
        else setAt(W[r.name], r.path, def);
      }
      for (const r of x.rows) r.sync();
      changed();
    }, 'small');
    const summary = el('summary', null, x.s.title, x.s.when ? el('span', { class: 'badge', title: WHEN[x.s.when] }, BADGE[x.s.when]) : null, reset);
    x.el = el('details', { open: true }, summary, ...x.rows.map((r) => r.el));
    return x.el;
  }

  const cheats = el('div', { class: 'cheat' },
    section('give', true, el('div', { class: 'btns' }, ...GIVE.map(([l, fn]) => button(l, fn)))),
    section('spawn (in front of you)', true, el('div', { class: 'btns' }, ...SPAWN.map(([l, fn]) => button(l, fn)))),
    section('teleport', true,
      el('div', { class: 'tools' }, el('label', null, mapBox, ' click the big map (Tab) to go there')),
      el('div', { class: 'note' }, 'to a waystone (✦ awake):'), stoneBox));
  const changesPane = el('div', { class: 'pane cheat' },
    el('div', { class: 'note' }, 'Every number that differs from its default, kept across reloads. Copy it and paste it to Claude to make them the new defaults.'),
    el('div', { class: 'tools' }, button('copy changes', copyChanges), button('reset all', resetAll)),
    changesBox);

  for (const x of tabs) {
    x.heading = el('h3', null, x.t.label);
    x.pane = el('div', { class: 'pane' }, x.heading, x.t.id === 'cheats' ? cheats : null, ...x.sections.filter((s) => s.rows.length).map(sectionEl));
    x.tabBtn = button(x.t.label, () => pick(x.t.id));
  }
  const CHANGES = { t: { id: 'changes', label: 'Changes' }, pane: changesPane };
  CHANGES.tabBtn = button('Changes', () => pick('changes'));
  const allTabs = tabs.filter((x) => x.t !== OTHER || x.sections[0].rows.length).concat(CHANGES);

  const TAB_KEY = 'dungeon-engine:dev-tab';
  let current = 'cheats';
  try { current = global.localStorage.getItem(TAB_KEY) || current; } catch (e) { /* storage blocked */ }
  function pick(id) {
    current = allTabs.some((x) => x.t.id === id) ? id : 'cheats';
    try { global.localStorage.setItem(TAB_KEY, current); } catch (e) { /* storage blocked */ }
    filter();
  }

  // --- search, and "changed only": both show matches from every tab at once

  const search = el('input', { type: 'search', placeholder: 'search every tab: name, path or description' });
  const onlyBox = el('input', { type: 'checkbox' });
  search.addEventListener('input', filter);
  onlyBox.addEventListener('change', filter);
  search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { search.value = ''; filter(); search.blur(); } });

  function filter() {
    const q = search.value.trim().toLowerCase(), only = onlyBox.checked, finding = !!q || only;
    tabBar.hidden = finding;
    for (const x of allTabs) {
      const isCur = x.t.id === current;
      x.tabBtn.classList.toggle('on', isCur);
      if (x === CHANGES) { x.pane.hidden = finding || !isCur; continue; }
      let shown = 0;
      for (const s of x.sections) {
        if (!s.el) continue;
        let n = 0;
        for (const r of s.rows) {
          const hit = (!q || r.text.includes(q)) && (!only || r.changed());
          r.el.hidden = finding && !hit;
          if (!r.el.hidden) n++;
        }
        s.el.hidden = finding && !n;
        if (finding && n) s.el.open = true;
        shown += n;
      }
      x.heading.hidden = !finding;
      if (x.t.id === 'cheats') cheats.hidden = finding;
      x.pane.hidden = finding ? !shown : !isCur;
    }
    countTabs();
  }

  /** Each tab's count of changed numbers, by its name. */
  function countTabs() {
    for (const x of allTabs) {
      if (x === CHANGES) continue;
      const n = x.sections.reduce((a, s) => a + s.rows.filter((r) => r.changed()).length, 0);
      x.tabBtn.replaceChildren(x.t.label, ...(n ? [el('span', { class: 'n' }, String(n))] : []));
    }
  }

  function changed() {
    const c = changes(), n = Object.keys(c).length;
    changesBox.value = n ? JSON.stringify(c, null, 1) : '';
    chip.hidden = !n || !panel.hidden;
    chip.textContent = `dev tweaks · ${n}`;
    CHANGES.tabBtn.replaceChildren('Changes', ...(n ? [el('span', { class: 'n' }, String(n))] : []));
    if (onlyBox.checked) filter(); else countTabs();
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

  const tabBar = el('div', { class: 'tabs' }, ...allTabs.map((x) => x.tabBtn));
  panel.append(
    el('header', null, el('b', null, 'dev'), button('copy changes', copyChanges), button('reset all', resetAll),
      button('close `', () => toggle(false))),
    el('div', { class: 'find' }, search, el('label', { title: 'show only numbers that differ from their defaults' }, onlyBox, ' changed only')),
    tabBar,
    el('div', { class: 'body' }, ...allTabs.map((x) => x.pane)));
  panel.addEventListener('scroll', () => { tip.hidden = true; }, true);
  document.body.append(panel, chip, tip);

  function toggle(open = panel.hidden) {
    panel.hidden = !open;
    if (!open) tip.hidden = true;
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

  pick(current);
  changed();
  W.dev = { toggle, changes, resetAll, teleport, TABLES };
})(window);
