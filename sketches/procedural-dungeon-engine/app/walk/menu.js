// Walk mode: the menu (GAME-DESIGN.md, section 20). Tab (View on a pad, or
// the minimap or the carousel tapped) opens it on the last tab you had:
//
//   Map           the big map (hud.js)
//   Inventory     your items grid (and the backpack's), and your equipment
//   Collectables  coins and curios, and the coin purse's own grid
//
// 1 / 2 (LB / RB) switch tabs. In a grid, WASD or the arrows (the d-pad or
// the stick) move the cursor, and:
//
//   Space (A)   pick up what's under it, then put it down on another cell
//               (swapping); on the purse or the backpack, go to its grid
//   F (Y)       take it in your hand and close the menu
//   X (X)       drop one where you stand
//   Esc (B)     put back what you picked up, else close
//
// A chest (E tapped at one) opens its own screen: its grid on top, yours
// below. Space (A) on one of its cells takes that stack, on one of yours
// gives it; X or E (X) takes everything. state.bigmap holds the menu's
// state while it's open: tab, cur and pick ({ g, i }: a grid and a cell),
// chest (its object's key).
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { $, state, el, ITEMS, INV, savePlayer } = W;

  const TABS = [['map', 'Map'], ['inv', 'Inventory'], ['coll', 'Collectables']];
  const tabsEl = $('menu-tabs'), invEl = $('inv'), mapEls = [$('bigmap-canvas'), $('bigmap-bar')];

  /** Open the menu: on a tab, or a chest's screen (`tab` 'chest' and its key). */
  function openMenu(tab, chestKey) {
    if (state.bigmap) return;
    W.openBigMap(tab === 'chest' ? { chest: chestKey } : tab ? { tab } : undefined);
  }

  // ---------------------------------------------------------------------------
  // The grids on screen, and what's in a cell

  const run = () => state.run;
  /** The cells of grid g, as an array (items: the layout of stack ids; equip: kinds). */
  function cells(g) {
    if (g === 'items') return W.layoutItems(run());
    if (g === 'equip') return W.layoutEquip(run());
    if (g === 'coll') return W.collCells(run());
    if (g === 'purse') return W.purseCells(run()) || [];
    if (g === 'chest') return W.chestCells(state.bigmap.chest) || [];
    return [];
  }
  /** What's in cell i of grid g, as a cell ({ kind, n, ... }), or null. Equipment: { kind, equip: true }. */
  function cellAt(g, i) {
    const x = cells(g)[i];
    if (!x) return null;
    if (g === 'items') return W.itemStacks(run()).get(x) || null;
    if (g === 'equip') return { kind: x, equip: true };
    return x;
  }

  /** The sections on screen now: [{ g, title, from, to (cells i in [from, to)), cols, cap, small }]. */
  function sections() {
    const v = state.bigmap, r = run(), out = [];
    const items = (small) => {
      const cap = W.itemCap(r), n = Math.max(cap, cells('items').length), main = W.invSize('items');
      const bp = !!(r.equipment && r.equipment.backpack);
      out.push({ g: 'items', title: small ? 'Your items' : 'Items', from: 0, to: bp ? main : n, cols: INV.items.cols, cap, small });
      if (bp) out.push({ g: 'items', title: 'Backpack', from: main, to: n, cols: INV.backpack.cols, cap, small });
    };
    const coll = (small) => {
      out.push({ g: 'coll', title: 'Collectables', from: 0, to: Math.max(W.invSize('coll'), cells('coll').length), cols: INV.coll.cols, cap: W.invSize('coll'), small });
      if (W.purseCells(r)) out.push({ g: 'purse', title: 'Coin purse', from: 0, to: Math.max(W.invSize('purse'), cells('purse').length), cols: INV.purse.cols, cap: W.invSize('purse'), small });
    };
    if (v.chest) {
      out.push({ g: 'chest', title: 'Chest', from: 0, to: W.invSize('chest'), cols: INV.chest.cols, cap: W.invSize('chest'), top: true });
      items(true);
      coll(true);
    } else if (v.tab === 'inv') {
      items(false);
      out.push({ g: 'equip', title: 'Equipment', from: 0, to: Math.max(W.invSize('equip'), cells('equip').length), cols: INV.equip.cols, cap: W.invSize('equip') });
    } else if (v.tab === 'coll') coll(false);
    return out;
  }

  function cellIconOf(g, c) {
    if (g === 'equip') return W.equipIcon(c.kind);
    return W.cellIcon(c);
  }
  function cellNameOf(g, c) {
    if (g === 'equip') return W.equipName(c.kind);
    return W.cellName(c);
  }
  /** Is this cell the thing in your hand? */
  function inHand(g, i) {
    const x = cells(g)[i];
    if (!x) return false;
    if (g === 'items' || g === 'equip') return state.sel === x;
    const h = state.handColl;
    return state.sel === 'hand-coll' && !!h && h.grid === g && h.i === i;
  }

  // ---------------------------------------------------------------------------
  // Drawing

  const pad = () => !!(W.padMode && W.padMode());
  const ps = () => W.glyph && W.glyph('E') === '□';
  /** The menu's buttons, as the keyboard or the pad names them. */
  const K = () => (pad()
    ? { a: W.glyph('Space'), x: W.glyph('E'), y: ps() ? '△' : 'Y', b: W.glyph('Esc'), tabs: W.glyph('bumpers') }
    : { a: 'Space', x: 'X', y: 'F', b: 'Esc', tabs: '1/2' });
  let note = null; // a passing line in the info row ("there's no room")

  function renderMenu() {
    const v = state.bigmap;
    tabsEl.hidden = !v || !!v.travel || !!v.chest;
    if (!v) { invEl.hidden = true; note = null; return; }
    const map = v.tab === 'map';
    for (const m of mapEls) m.classList.toggle('off', !map);
    invEl.hidden = map;
    if (!tabsEl.hidden) {
      tabsEl.innerHTML = '';
      const k = K();
      tabsEl.append(el('span', 'tab-key', k.tabs.split('/')[0]));
      for (const [id, name] of TABS) {
        const b = el('button', 'tab' + (v.tab === id ? ' on' : ''), name);
        b.type = 'button';
        b.addEventListener('click', (e) => { e.preventDefault(); b.blur(); W.menuTab(id); });
        tabsEl.append(b);
      }
      tabsEl.append(el('span', 'tab-key', k.tabs.split('/')[1]));
      const close = el('button', 'tab close', '✕');
      close.type = 'button';
      close.title = 'close (Tab)';
      close.addEventListener('click', (e) => { e.preventDefault(); W.closeBigMap(); });
      tabsEl.append(close);
    }
    if (!map) drawGrids();
  }

  function drawGrids() {
    const v = state.bigmap, secs = sections();
    if (!v.cur || !secs.some((s) => s.g === v.cur.g && v.cur.i >= s.from && v.cur.i < s.to)) {
      v.cur = secs.length ? { g: secs[0].g, i: secs[0].from } : null;
    }
    invEl.innerHTML = '';
    invEl.classList.toggle('chest', !!v.chest);
    const body = el('div', 'inv-body');
    let row = null;
    for (const s of secs) {
      if (s.top) { body.append(section(s)); continue; }
      if (!row) { row = el('div', 'inv-row'); body.append(row); }
      // a backpack sits under the items it adds to; the purse under the collectables
      const last = row.lastChild;
      if (last && ((s.g === 'items' && last.dataset.g === 'items') || (s.g === 'purse' && last.dataset.g === 'coll'))) last.append(grid(s, true));
      else row.append(section(s));
    }
    invEl.append(body);
    const c = v.cur && cellAt(v.cur.g, v.cur.i), k = K();
    const info = el('p', 'inv-info');
    if (note) { info.append(el('span', 'note', note)); }
    else if (c) {
      info.append(el('b', '', cellNameOf(v.cur.g, c)));
      const extra = cellExtra(v.cur.g, c);
      if (extra) info.append(document.createTextNode(' · ' + extra));
    } else info.append(el('span', 'dim', v.pick ? 'an empty cell · put it here' : 'an empty cell'));
    invEl.append(info);
    const hint = el('p', 'inv-hint');
    const acts = el('div', 'inv-actions');
    const act = (label, key, fn) => {
      const b = el('button', 'btn', `${label} (${key})`);
      b.type = 'button';
      b.addEventListener('click', (e) => { e.preventDefault(); b.blur(); fn(); });
      acts.append(b);
    };
    if (v.chest) {
      hint.textContent = `${k.a}: take from the chest, or give to it · ${k.x}: take everything · ${k.b}: close`;
      act(v.cur && v.cur.g === 'chest' ? 'Take' : 'Give', k.a, primary);
      act('Take all', k.x, takeAll);
    } else {
      hint.textContent = `${k.a}: ${v.pick ? 'put it here' : 'pick up'} · ${k.y}: hold in hand · ${k.x}: drop one · ${k.tabs}: tabs · ${k.b}: ${v.pick ? 'put back' : 'close'}`;
      act(v.pick ? 'Place' : 'Pick up', k.a, primary);
      act('Hold', k.y, holdCur);
      act('Drop', k.x, dropCur);
    }
    act('Close', k.b, back);
    invEl.append(hint, acts);
  }
  function cellExtra(g, c) {
    if (g === 'equip') {
      if (c.kind === 'purse') return `its own grid of ${W.invSize('purse')} for coins (${K().a} to open)`;
      if (c.kind === 'backpack') return `${W.invSize('backpack')} more cells for tools`;
      return ITEMS[c.kind].slot ? 'take it in hand to use it' : '';
    }
    if (g === 'items') return 'yours to use · in the carousel';
    return c.kind === 'coin' || c.kind === 'curio' ? 'no use; it\'s yours' : '';
  }

  function section(s) {
    const sec = el('section', 'inv-sec' + (s.small ? ' small' : ''));
    sec.dataset.g = s.g;
    sec.append(grid(s, false));
    return sec;
  }
  /** A grid's title and cells. */
  function grid(s, sub) {
    const v = state.bigmap, a = cells(s.g);
    const wrap = el('div', 'inv-grid-wrap' + (sub ? ' sub' : ''));
    const used = a.slice(s.from, Math.min(s.to, s.cap)).filter(Boolean).length;
    const h = el('h3', '', s.title);
    h.append(el('span', 'ct', ` ${used}/${Math.min(s.to, s.cap) - s.from}`));
    const gEl = el('div', 'inv-grid');
    gEl.style.gridTemplateColumns = `repeat(${s.cols}, var(--cell))`;
    for (let i = s.from; i < s.to; i++) {
      const c = cellAt(s.g, i);
      const b = el('button', 'slot cell' + (c ? '' : ' empty') + (i >= s.cap ? ' over' : '') +
        (v.cur && v.cur.g === s.g && v.cur.i === i ? ' cur' : '') + (v.pick && v.pick.g === s.g && v.pick.i === i ? ' picked' : '') +
        (c && inHand(s.g, i) ? ' hand' : ''));
      b.type = 'button';
      b.dataset.g = s.g;
      b.dataset.i = i;
      if (c) { b.append(cellIconOf(s.g, c)); b.title = cellNameOf(s.g, c); }
      b.addEventListener('click', (e) => {
        e.preventDefault();
        b.blur();
        const same = v.cur && v.cur.g === s.g && v.cur.i === i;
        v.cur = { g: s.g, i };
        note = null;
        // A tap on a cell: the first picks up (or, at a chest, moves it); a tap on the cell already picked puts it back.
        if (v.chest || v.pick || same || c) primary();
        else renderMenu();
      });
      gEl.append(b);
    }
    wrap.append(h, gEl);
    return wrap;
  }

  // ---------------------------------------------------------------------------
  // Moving the cursor: to the nearest cell on screen that way

  function menuMove(dx, dy) {
    const v = state.bigmap;
    if (!v || v.tab === 'map') return;
    const all = Array.from(invEl.querySelectorAll('.cell'));
    const cur = all.find((b) => b.classList.contains('cur'));
    if (!cur) { if (all[0]) v.cur = { g: all[0].dataset.g, i: +all[0].dataset.i }; renderMenu(); return; }
    const r0 = cur.getBoundingClientRect(), cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    let best = null, bs = Infinity;
    for (const b of all) {
      if (b === cur) continue;
      const r = b.getBoundingClientRect(), x = r.left + r.width / 2 - cx, y = r.top + r.height / 2 - cy;
      const along = x * dx + y * dy, across = Math.abs(x * dy - y * dx);
      if (along < 4) continue;
      const score = along + across * 2.5;
      if (score < bs) { bs = score; best = b; }
    }
    if (!best) return;
    v.cur = { g: best.dataset.g, i: +best.dataset.i };
    note = null;
    renderMenu();
  }

  // ---------------------------------------------------------------------------
  // What the buttons do

  function changed() {
    savePlayer();
    W.refreshHotbar();
    W.refreshHud();
    renderMenu();
  }
  function say(text) { note = text; renderMenu(); }

  /** Space / A: pick up or put down; at a chest, take or give; on the purse or backpack, go to its grid. */
  function primary() {
    const v = state.bigmap;
    if (!v || !v.cur) return;
    const { g, i } = v.cur, c = cellAt(g, i);
    note = null;
    if (v.chest) {
      if (!c) { renderMenu(); return; }
      if (g === 'chest') {
        const left = W.receive(run(), c);
        const a = W.chestCells(v.chest);
        if (left === (c.n || 1)) { say(`no room for ${W.cellName(c)}`); return; }
        a[i] = left ? Object.assign({}, c, { n: left }) : null;
        if (left) note = 'you take what fits';
      } else {
        const out = W.takeOut(run(), g, i);
        if (!out) return;
        const left = W.giveToChest(v.chest, out);
        if (left) W.receive(run(), Object.assign({}, out, { n: left }), { force: true }); // what didn't fit comes back
        if (left === out.n) { say('the chest is full'); return; }
      }
      changed();
      return;
    }
    if (g === 'equip') {
      if (c && c.kind === 'purse') { W.menuTab('coll'); state.bigmap.cur = { g: 'purse', i: 0 }; renderMenu(); return; }
      if (c && c.kind === 'backpack') { v.cur = { g: 'items', i: W.invSize('items') }; renderMenu(); return; }
      say(c ? 'equipment stays where it is' : 'an empty equipment cell');
      return;
    }
    if (!v.pick) {
      if (c) v.pick = { g, i };
      renderMenu();
      return;
    }
    const p = v.pick;
    v.pick = null;
    if (p.g === g && p.i === i) { renderMenu(); return; }
    if (!place(p, v.cur)) return;
    changed();
  }
  /** Move the stack at `p` onto cell `q`: swap them, or stack them up if they're the same. False if it can't go there. */
  function place(p, q) {
    if (p.g === 'items' || q.g === 'items') {
      if (p.g !== q.g) { say('tools go in the items grid'); return false; }
      const a = W.inv(run()).items;
      while (a.length <= Math.max(p.i, q.i)) a.push(null);
      [a[p.i], a[q.i]] = [a[q.i], a[p.i]];
      return true;
    }
    const A = cells(p.g), B = cells(q.g), x = A[p.i], y = B[q.i];
    if ((q.g === 'purse' && x && x.kind !== 'coin') || (p.g === 'purse' && y && y.kind !== 'coin')) { say('only coins go in the purse'); return false; }
    if (state.handColl) { state.handColl = null; if (state.sel === 'hand-coll') state.sel = 'hands'; } // it's put away as it moves
    if (y && x && y.kind === x.kind && y.type === x.type) {
      const t = Math.min(x.n, (INV.stack[x.kind] || 1) - y.n);
      y.n += t; x.n -= t;
      if (x.n <= 0) A[p.i] = null;
      return true;
    }
    while (B.length <= q.i) B.push(null);
    A[p.i] = y || null;
    B[q.i] = x;
    return true;
  }

  /** F / Y: take it in your hand, and close the menu. */
  function holdCur() {
    const v = state.bigmap;
    if (!v || !v.cur || v.chest) return;
    const { g, i } = v.cur, x = cells(g)[i];
    if (!x) { say('nothing there to hold'); return; }
    if (g === 'equip' && !(ITEMS[x].slot && ITEMS[x].slot(run()))) { say(`${W.equipName(x)} · nothing to hold; it's worn`); return; }
    if (g === 'coll' || g === 'purse') state.handColl = { grid: g, i };
    if (!W.hold(g === 'coll' || g === 'purse' ? 'hand-coll' : x)) { state.handColl = null; say('your hands are full · set it down first'); return; }
    W.closeBigMap();
    W.showCaption('in hand: ' + W.slotLabel(W.selectedSlot()));
  }

  /** X / X: drop one where you stand (it lies there, as it did before you took it). At a chest: take everything. */
  function dropCur() {
    const v = state.bigmap;
    if (!v || !v.cur) return;
    if (v.chest) { takeAll(); return; }
    const { g, i } = v.cur;
    if (g === 'equip') { say(cells(g)[i] ? 'equipment stays on you' : 'nothing there to drop'); return; }
    const c = W.takeOut(run(), g, i, true);
    if (!c) { say('nothing there to drop'); return; }
    if (!W.dropCell(c)) { W.receive(run(), c, { force: true }); say('nowhere to drop it here'); return; }
    v.pick = null;
    note = 'you drop ' + W.cellName(c);
    changed();
  }
  /** At a chest: everything in it that fits. */
  function takeAll() {
    const v = state.bigmap, a = W.chestCells(v.chest);
    let got = 0, left = 0;
    for (let i = 0; i < a.length; i++) {
      const c = a[i];
      if (!c) continue;
      const l = W.receive(run(), c);
      if (l < (c.n || 1)) got++;
      if (l) { a[i] = Object.assign({}, c, { n: l }); left++; } else a[i] = null;
    }
    note = !got && !left ? 'the chest is empty' : left ? 'you take what fits · the rest stays' : null;
    changed();
  }

  /** Esc / B: put back what's picked up, else close. */
  function back() {
    const v = state.bigmap;
    if (v && v.pick) { v.pick = null; note = null; renderMenu(); return; }
    W.closeBigMap();
  }

  /** A key while the menu is open (input.js; the pad's buttons come here as keys too). */
  function menuKey(k, e) {
    const v = state.bigmap;
    if (k === 'tab' || k === 'escape') {
      if (k === 'tab') e.preventDefault();
      if (e.repeat) return;
      if (k === 'tab') W.closeBigMap(); else back();
      return;
    }
    if ((k === '1' || k === '2') && !e.repeat) {
      if (v.travel || v.chest) return;
      const at = TABS.findIndex(([id]) => id === v.tab);
      W.menuTab(TABS[(at + (k === '2' ? 1 : -1) + TABS.length) % TABS.length][0]);
      return;
    }
    if (v.tab === 'map') return;
    const dir = { w: [0, -1], arrowup: [0, -1], s: [0, 1], arrowdown: [0, 1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0] }[k];
    if (dir) { menuMove(dir[0], dir[1]); e.preventDefault(); return; }
    if (e.repeat) return;
    if (k === ' ') { primary(); e.preventDefault(); } else if (k === 'f') holdCur();
    else if (k === 'x') dropCur();
    else if (k === 'e' && v.chest) takeAll();
  }

  Object.assign(W, { openMenu, renderMenu, menuMove, menuKey });
})(window);
