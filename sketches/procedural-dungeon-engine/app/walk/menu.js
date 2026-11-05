// Walk mode: the menu (GAME-DESIGN.md, section 20). Tab (View on a pad, or
// the minimap or the carousel tapped) opens it on the last tab you had:
//
//   Map           the big map (hud.js)
//   Inventory     your items grid and your equipment (the bags in it)
//   Collectables  coins and curios, and your bags
//
// 1 / 2 (LB / RB) switch tabs. In a grid, WASD or the arrows (the d-pad or
// the stick) move the cursor. The buttons depend on what's under it (the
// row along the bottom shows the ones that do something there):
//
//   Space (A)   pick up what's under it, then put it down on another cell
//               (swapping); on a bag (the purse, the backpack), open its
//               grid on a screen of its own, where Esc (B) comes back
//   F (Y)       take it in your hand (the menu stays open); on a bag in
//               the equipment grid, pick it up to move it
//   X (X)       drop one where you stand; a bag, with what's in it
//   Esc (B)     out of a bag, else put back what you picked up, else close
//
// The backpack takes tools and collectables both; the items grid only
// tools, the collectables grid only collectables, the purse only coins.
//
// A chest (E tapped at one) opens its own screen: its grid on top, yours
// below. Space (A) on one of its cells takes one, on one of yours gives
// one; X or E (X) the whole stack. state.bigmap holds the menu's
// state while it's open: tab, cur and pick ({ g, i }: a grid and a cell),
// chest (its object's key), sub (the bag open, if one is) and back (its cell).
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
    if (g === 'bags') return bagCells();
    return [];
  }
  /** What's in cell i of grid g, as a cell ({ kind, n, ... }), or null. Equipment: { kind, equip: true }. */
  function cellAt(g, i) {
    const x = cells(g)[i];
    if (!x) return null;
    if (g === 'items') return W.itemCell(run(), i); // a stack (this cell's count), or a collectable in the backpack
    if (worn(g)) return { kind: x, equip: true };
    return x;
  }

  /**
   * The sections on screen now: [{ g, title, from, to (cells i in [from, to)), cols, cap }].
   * A bag (the purse, the backpack) shows as one cell; Space / A on it opens
   * its grid on a screen of its own (state.bigmap.sub), and Esc / B comes back.
   */
  function sections() {
    const v = state.bigmap, r = run(), out = [];
    const cap = W.itemCap(r), n = Math.max(cap, cells('items').length), main = W.invSize('items');
    const bp = !!(r.equipment && r.equipment.backpack);
    const size = (g) => Math.max(W.invSize(g), cells(g).length);
    if (v.chest) out.push({ g: 'chest', title: 'Chest', from: 0, to: W.invSize('chest'), cols: INV.chest.cols, cap: W.invSize('chest'), top: true });
    if (v.sub === 'backpack' && bp) {
      out.push({ g: 'items', title: 'Backpack', from: main, to: n, cols: INV.backpack.cols, cap });
      return out;
    }
    if (v.sub === 'purse' && W.purseCells(r)) {
      out.push({ g: 'purse', title: 'Coin purse', from: 0, to: size('purse'), cols: INV.purse.cols, cap: W.invSize('purse') });
      return out;
    }
    v.sub = null;
    const items = (title) => out.push({ g: 'items', title, from: 0, to: bp ? main : n, cols: INV.items.cols, cap });
    const coll = () => out.push({ g: 'coll', title: 'Collectables', from: 0, to: size('coll'), cols: INV.coll.cols, cap: W.invSize('coll') });
    const bags = () => { const k = cells('bags').length; if (k) out.push({ g: 'bags', title: 'Bags', from: 0, to: k, cols: 1, cap: k }); };
    if (v.chest) { items('Your items'); coll(); bags(); }
    else if (v.tab === 'inv') {
      items('Items');
      out.push({ g: 'equip', title: 'Equipment', from: 0, to: size('equip'), cols: INV.equip.cols, cap: W.invSize('equip') });
    } else if (v.tab === 'coll') { coll(); bags(); }
    return out;
  }
  /** The bags you have, beside the collectables (and at a chest): they open from here too. */
  function bagCells() {
    const eq = run().equipment || {};
    return ['backpack', 'purse'].filter((k) => eq[k]);
  }
  /** Is this cell a bag (it opens to its own grid)? */
  const isBag = (g, c) => !!c && worn(g) && W.BAGS.has(c.kind);
  /** Can you take this cell in hand? Tools and collectables; equipment with a use (the duster, the hourglass). */
  const holdable = (g, c) => !!c && (!worn(g) || !!(ITEMS[c.kind].slot && ITEMS[c.kind].slot(run())));
  const worn = (g) => g === 'equip' || g === 'bags';

  function cellIconOf(g, c) {
    if (worn(g)) return W.equipIcon(c.kind);
    return W.cellIcon(c);
  }
  function cellNameOf(g, c) {
    if (worn(g)) return W.equipName(c.kind);
    return W.cellName(c);
  }
  /** Is this cell the thing in your hand? */
  function inHand(g, i) {
    const x = cells(g)[i];
    if (!x) return false;
    if ((g === 'items' && W.isTool(x)) || worn(g)) return state.sel === x;
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
      row.append(section(s));
    }
    invEl.append(body);
    const c = v.cur && cellAt(v.cur.g, v.cur.i), k = K();
    const g = v.cur && v.cur.g;
    const pc = v.pick && cellAt(v.pick.g, v.pick.i);
    const here = pc && v.pick.g === g && v.pick.i === v.cur.i;
    const info = el('p', 'inv-info');
    const text = (t) => info.append(document.createTextNode(t));
    if (note) info.append(el('span', 'note', note));
    else if (pc) { // moving something: what, and what it would do here
      text('moving ');
      info.append(el('b', '', cellNameOf(v.pick.g, pc)));
      if (here) text(' · put it back');
      else if (c && isBag(g, c) && !worn(v.pick.g)) { text(' · open '); info.append(el('b', '', cellNameOf(g, c))); }
      else if (c) { text(' · swap with '); info.append(el('b', '', cellNameOf(g, c))); }
      else text(' · place it here');
    } else if (c) info.append(el('b', '', cellNameOf(g, c)));
    else info.append(el('span', 'dim', 'an empty cell'));
    invEl.append(info);
    const acts = el('div', 'inv-actions');
    const act = (label, key, fn) => {
      const b = el('button', 'btn', `${label} (${key})`);
      b.type = 'button';
      b.addEventListener('click', (e) => { e.preventDefault(); b.blur(); fn(); });
      acts.append(b);
    };
    // Only the buttons that do something here.
    if (v.chest) {
      if (isBag(g, c)) act('Open', k.a, primary);
      else if (c && g === 'chest') { act('Take one', k.a, primary); act('Take stack', k.x, dropCur); }
      else if (c) { act('Give one', k.a, primary); act('Give stack', k.x, dropCur); }
    } else if (pc) {
      act(here ? 'Put back' : c && isBag(g, c) && !worn(v.pick.g) ? 'Open' : c ? 'Swap' : 'Place', k.a, primary);
    } else if (c) {
      act(isBag(g, c) ? 'Open' : 'Pick up', k.a, primary);
      if (isBag(g, c) && g === 'equip') act('Move', k.y, yAct);
      else if (holdable(g, c)) act(inHand(g, v.cur.i) ? 'In hand' : 'Hold', k.y, yAct);
      if (!worn(g) || isBag(g, c)) act('Drop', k.x, dropCur);
    }
    act(v.sub ? 'Back' : pc ? 'Cancel' : 'Close', k.b, back);
    invEl.append(acts);
  }

  function section(s) {
    const sec = el('section', 'inv-sec');
    sec.dataset.g = s.g;
    sec.append(grid(s));
    return sec;
  }
  /** A grid's title and cells. */
  function grid(s) {
    const v = state.bigmap, a = cells(s.g);
    const wrap = el('div', 'inv-grid-wrap');
    const used = a.slice(s.from, Math.min(s.to, s.cap)).filter(Boolean).length;
    const h = el('h3', '', s.title);
    h.append(el('span', 'ct', ` ${used}/${Math.min(s.to, s.cap) - s.from}`));
    const gEl = el('div', 'inv-grid');
    gEl.style.gridTemplateColumns = `repeat(${s.cols}, var(--cell))`;
    for (let i = s.from; i < s.to; i++) {
      const c = cellAt(s.g, i);
      const b = el('button', 'slot cell' + (c ? '' : ' empty') + (i >= s.cap ? ' over' : '') +
        (v.cur && v.cur.g === s.g && v.cur.i === i ? ' cur' : '') + (v.pick && v.pick.g === s.g && v.pick.i === i ? ' picked' : '') +
        (c && inHand(s.g, i) ? ' hand' : '') + (isBag(s.g, c) ? ' bag' : ''));
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

  /** Space / A: pick up or put down (equipment in its own grid); on a bag, open it; at a chest, take or give one. */
  function primary() {
    const v = state.bigmap;
    if (!v || !v.cur) return;
    const { g, i } = v.cur, c = cellAt(g, i);
    note = null;
    if (isBag(g, c) && !(v.pick && worn(v.pick.g))) { openBag(c.kind); return; } // moving a bag onto one swaps them
    if (v.chest) { if (c) { if (g === 'chest') chestTake(i, true); else chestGive(g, i, true); } else renderMenu(); return; }
    if (!v.pick) {
      if (c && g !== 'bags') v.pick = { g, i };
      renderMenu();
      return;
    }
    const p = v.pick;
    v.pick = null;
    if (p.g === g && p.i === i) { renderMenu(); return; }
    if (!place(p, v.cur)) { v.pick = p; return; }
    changed();
  }
  /** Open a bag's own screen (what you picked up comes with you). Esc / B comes back to the bag. */
  function openBag(kind) {
    const v = state.bigmap;
    v.back = v.cur;
    v.sub = kind;
    v.cur = kind === 'purse' ? { g: 'purse', i: 0 } : { g: 'items', i: W.invSize('items') };
    renderMenu();
  }

  /** The array behind grid g, to move cells in. */
  function raw(g) {
    if (g === 'items') return W.inv(run()).items;
    if (g === 'equip') return W.inv(run()).equip;
    if (g === 'coll') return W.inv(run()).coll;
    if (g === 'purse') return W.purseCells(run());
    return null;
  }
  /** Why `x` (a layout entry or a cell) can't go in cell i of grid g, or null if it can. */
  function refuse(g, i, x) {
    if (x == null) return null;
    const tool = W.isTool(x);
    if (g === 'items' && !tool && i < W.invSize('items')) return 'only tools go in your items grid · collectables can go in the backpack';
    if (g === 'coll' && tool) return 'only collectables go here · tools can go in the backpack';
    if (g === 'purse' && (tool || x.kind !== 'coin')) return 'only coins go in the purse';
    return null;
  }
  /** Move what's at `p` onto cell `q`: swap them, or stack them up if they're the same. False if it can't go there. */
  function place(p, q) {
    if (worn(p.g) || worn(q.g)) {
      if (p.g !== 'equip' || q.g !== 'equip') { say(worn(q.g) ? 'only equipment goes there' : 'equipment stays in the equipment grid'); return false; }
      const a = W.inv(run()).equip;
      while (a.length <= Math.max(p.i, q.i)) a.push(null);
      [a[p.i], a[q.i]] = [a[q.i], a[p.i]];
      return true;
    }
    const A = raw(p.g), B = raw(q.g);
    if (!A || !B) return false;
    while (A.length <= p.i) A.push(null);
    while (B.length <= q.i) B.push(null);
    const x = A[p.i], y = B[q.i];
    const why = refuse(q.g, q.i, x) || refuse(p.g, p.i, y);
    if (why) { say(why); return false; }
    if (state.handColl) { state.handColl = null; if (state.sel === 'hand-coll') state.sel = 'hands'; } // it's put away as it moves
    if (y && x && !W.isTool(x) && !W.isTool(y) && y.kind === x.kind && y.type === x.type) {
      const t = Math.min(x.n, (INV.stack[x.kind] || 1) - y.n);
      y.n += t; x.n -= t;
      if (x.n <= 0) A[p.i] = null;
      return true;
    }
    if (p.g === 'items' && q.g === 'items') { // a tool's cell moves with its count; onto a cell of the same, it tops that up
      if (x && x === y && W.isTool(x)) W.mergeItems(run(), p.i, q.i); else W.swapItems(run(), p.i, q.i);
      return true;
    }
    A[p.i] = y || null;
    B[q.i] = x;
    return true;
  }

  /** At a chest: take one from its cell i (a stick of chalk), or the whole stack. */
  function chestTake(i, one) {
    const a = W.chestCells(state.bigmap.chest), c = a[i];
    if (!c) return;
    const n = one ? (c.kind === 'chalk' ? ((c.n - 1) % W.STROKES) + 1 : 1) : c.n;
    const got = n - W.receive(run(), Object.assign({}, c, { n }));
    if (!got) { say(`no room for ${W.cellName(c)}`); return; }
    c.n -= got;
    if (c.n <= 0) a[i] = null;
    note = got < n ? 'you take what fits' : null;
    changed();
  }
  /** At a chest: give it one from your cell, or the whole stack. What doesn't fit comes back. */
  function chestGive(g, i, one) {
    const out = W.takeOut(run(), g, i, one);
    if (!out) return;
    const left = W.giveToChest(state.bigmap.chest, out);
    if (left) W.receive(run(), Object.assign({}, out, { n: left }), { force: true });
    if (left === out.n) { say('the chest is full'); return; }
    changed();
  }

  /** F / Y: take it in your hand (the menu stays open); a bag in the equipment grid, pick it up to move it. */
  function yAct() {
    const v = state.bigmap;
    if (!v || !v.cur || v.chest) return;
    const { g, i } = v.cur, c = cellAt(g, i);
    if (isBag(g, c) && g === 'equip' && !v.pick) { v.pick = { g, i }; note = null; renderMenu(); return; }
    holdCur();
  }
  function holdCur() {
    const v = state.bigmap, { g, i } = v.cur, x = cells(g)[i], c = cellAt(g, i);
    if (!x) { say('nothing there to hold'); return; }
    if (!holdable(g, c)) { say(`${cellNameOf(g, c)} · nothing to hold`); return; }
    const coll = g === 'coll' || g === 'purse' || (g === 'items' && !W.isTool(x));
    if (coll) state.handColl = { grid: g, i };
    if (!W.hold(coll ? 'hand-coll' : x)) { state.handColl = null; say('your hands are full · set it down first'); return; }
    note = 'in hand: ' + W.slotLabel(W.selectedSlot());
    changed();
  }

  /** X / X: drop one where you stand (it lies there, as it did before you took it); a bag, with what's in it. At a chest: the whole stack. */
  function dropCur() {
    const v = state.bigmap;
    if (!v || !v.cur) return;
    const { g, i } = v.cur, c = cellAt(g, i);
    if (v.chest) {
      if (!c || isBag(g, c)) return;
      if (g === 'chest') chestTake(i, false); else chestGive(g, i, false);
      return;
    }
    if (worn(g)) {
      if (!c) { say('nothing there to drop'); return; }
      if (!isBag(g, c)) { say(`your ${cellNameOf(g, c).split(' · ')[0]} stays with you`); return; }
      dropBag(c.kind);
      return;
    }
    const out = W.takeOut(run(), g, i, true);
    if (!out) { say('nothing there to drop'); return; }
    if (!W.dropCell(out)) { W.receive(run(), out, { force: true }); say('nowhere to drop it here'); return; }
    v.pick = null;
    note = 'you drop ' + W.cellName(out);
    changed();
  }
  /** Set a bag down where you stand, with what's in it. */
  function dropBag(kind) {
    const v = state.bigmap, r = run();
    const h = state.handColl, main = W.invSize('items');
    if (h && (kind === 'purse' ? h.grid === 'purse' : h.grid === 'items' && h.i >= main)) { // what's in your hand goes in the bag
      state.handColl = null;
      if (state.sel === 'hand-coll') state.sel = 'hands';
    }
    const bag = W.takeBag(r, kind);
    if (!W.dropCell(bag)) { W.giveBag(r, kind, bag.cells); say('nowhere to drop it here'); return; }
    v.pick = null;
    v.sub = null;
    note = `you set down your ${ITEMS[kind].label}` + (bag.cells.some(Boolean) ? ', with what\'s in it' : '');
    changed();
  }

  /** Esc / B: out of a bag (back to it; what you're moving comes too), else put back what's picked up, else close. */
  function back() {
    const v = state.bigmap;
    if (v && v.sub) { v.sub = null; v.cur = v.back || null; note = null; renderMenu(); return; }
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
    if (k === ' ') { primary(); e.preventDefault(); } else if (k === 'f') yAct();
    else if (k === 'x' || (k === 'e' && v.chest)) dropCur();
  }

  Object.assign(W, { openMenu, renderMenu, menuMove, menuKey });
})(window);
