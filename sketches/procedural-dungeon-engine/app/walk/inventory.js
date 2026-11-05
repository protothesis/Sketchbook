// Walk mode: the inventory (GAME-DESIGN.md, section 20). Everything you
// carry lives in grids, all sized from INV (the dev panel tunes it):
//
//   items       tools: keys, doorstones, chalk by colour, jars by what they
//               hold. A cell holds one kind, up to a full stack (INV.stack);
//               more of it spills into another cell. The truth stays in the
//               run's counters (run.keys, run.chalks, run.jars ...);
//               run.inv.items is where each stack sits (its id, once per
//               cell it fills) and run.inv.itemN how many each cell holds,
//               both kept in step with the counters by layoutItems().
//               A backpack adds a second grid after it (cells INV.items on),
//               which takes collectables too: a collectable cell there is
//               the cell itself, like one in coll.
//   equip       gear: the duster, the hourglass, the coin purse, the backpack.
//               The kinds are the truth (run.equipment); run.inv.equip is the
//               order. A bag (the purse, the backpack) can be dropped, with
//               what's in it.
//   coll        collectables, things with no use: coins, curios. The cells
//               are the truth: [{ kind, type, n }].
//   purse       the coin purse's own grid (run.equipment.purse.cells), coins only.
//
// A cell anywhere else (a chest, something you dropped) is the same shape
// as a collectable's: { kind, n, color?, holds?, type? }. receive() takes
// one into your grids (as much as fits), takeOut() takes one out.
//
// A grid can run past its size (a pack taken back after you'd filled up
// again, a jar that filled and needs a cell of its own): the extra cells
// show as over, and nothing new comes in until there's room.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { RULES, THREE, S, state, el, ITEMS, CHALK, STROKES } = W;

  const INV = {
    items: { cols: 4, rows: 4 },
    backpack: { cols: 4, rows: 4 }, // added to items while you have the backpack
    equip: { cols: 2, rows: 4 },
    coll: { cols: 4, rows: 4 },
    purse: { cols: 2, rows: 4 },
    chest: { cols: 4, rows: 2 },
    // How many make a full stack, by kind (chalk in sticks).
    stack: { key: 9, doorstone: 9, chalk: 10, jar: 6, coin: 50, curio: 9 },
  };
  // Equipment you keep through a faint. Everything else falls with your pack.
  const PROTECTED = new Set(['duster', 'hourglass']);
  const TOOLS = new Set(['key', 'doorstone', 'chalk', 'jar']);
  const COLLECTABLE = new Set(['coin', 'curio']);

  const size = (g) => INV[g].cols * INV[g].rows;
  const has = (run, k) => !!(run.equipment && run.equipment[k]);
  function inv(run) {
    if (!run.inv) run.inv = { items: [], equip: [], coll: [] };
    return run.inv;
  }
  /** How many item stacks you can carry: the items grid, and the backpack's. */
  const itemCap = (run) => size('items') + (has(run, 'backpack') ? size('backpack') : 0);
  const purseCells = (run) => (has(run, 'purse') ? (run.equipment.purse.cells = run.equipment.purse.cells || []) : null);

  // ---------------------------------------------------------------------------
  // Item stacks, from the run's counters

  const JAR_IDS = { empty: null, pixie: 'pixie', entropy: 'entropy' };
  const idOf = (c) => (c.kind === 'chalk' ? 'chalk:' + c.color : c.kind === 'jar' ? 'jar:' + (c.holds || 'empty') : c.kind);
  /** A stack id back to a cell's shape (no n). */
  function cellOfId(id) {
    const [kind, v] = id.split(':');
    return kind === 'chalk' ? { kind, color: v } : kind === 'jar' ? { kind, holds: JAR_IDS[v] } : { kind };
  }
  /** Every item stack you carry: Map id -> cell (n: count; chalk in strokes). */
  function itemStacks(run) {
    const out = new Map();
    if (run.keys > 0) out.set('key', { kind: 'key', n: run.keys });
    if (run.doorstones > 0) out.set('doorstone', { kind: 'doorstone', n: run.doorstones });
    for (const c in run.chalks) if (run.chalks[c] > 0) out.set('chalk:' + c, { kind: 'chalk', color: c, n: run.chalks[c] });
    for (const j of run.jars) {
      const id = 'jar:' + (j.holds || 'empty');
      if (out.has(id)) out.get(id).n++;
      else out.set(id, { kind: 'jar', holds: j.holds || null, n: 1 });
    }
    return out;
  }
  const capOf = (kind) => INV.stack[kind] || 1;
  /** A full cell of a tool, in the counters' units (chalk: in strokes). */
  const fullOf = (kind) => capOf(kind) * (kind === 'chalk' ? STROKES : 1);
  /** How many each items cell holds (null for an empty cell or a collectable): run.inv.itemN, beside run.inv.items. */
  const itemN = (run) => inv(run).itemN || (inv(run).itemN = []);

  const isTool = (x) => typeof x === 'string'; // an items layout entry: a stack id, or a collectable cell (the backpack's)
  /** Pack the cells past `cap` into holes below it (from `from`, for what can't go lower), and drop trailing empties past it. `par`: an array kept beside a (moved with it). */
  function settle(a, cap, from = () => 0, par = null) {
    for (let i = cap; i < a.length; i++) {
      if (a[i] == null) continue;
      const f = from(a[i]);
      const hole = a.findIndex((x, j) => j >= f && j < cap && x == null);
      if (hole < 0) continue;
      a[hole] = a[i];
      a[i] = null;
      if (par) { par[hole] = par[i]; par[i] = null; }
    }
    while (a.length > cap && a[a.length - 1] == null) a.pop();
    for (let i = 0; i < a.length; i++) if (a[i] === undefined) a[i] = null;
    if (par) { par.length = a.length; for (let i = 0; i < a.length; i++) if (par[i] === undefined) par[i] = null; }
    return a;
  }
  /**
   * Where each item stack sits: run.inv.items (and run.inv.itemN, how many
   * in each cell), brought in step with what you carry. More than the cells
   * hold goes onto your cells of it with room, then into the first empty
   * cells (past the grid if need be: over); less comes off the smallest cell
   * of it first (the partial stack), and a cell left with none is empty.
   */
  function layoutItems(run) {
    const st = itemStacks(run), a = inv(run).items, N = itemN(run), cap = itemCap(run);
    for (let i = 0; i < a.length; i++) if (!isTool(a[i]) || !st.has(a[i])) { if (isTool(a[i])) a[i] = null; N[i] = null; }
    for (const [id, s] of st) {
      const full = fullOf(s.kind), at = [];
      for (let i = 0; i < a.length; i++) if (a[i] === id) { N[i] = Math.max(0, Math.min(full, N[i] || 0)); at.push(i); }
      let diff = s.n - at.reduce((t, i) => t + N[i], 0);
      for (const i of at) { if (diff <= 0) break; const t = Math.min(diff, full - N[i]); N[i] += t; diff -= t; }
      while (diff > 0) {
        let i = a.findIndex((x, j) => j < cap && x == null);
        if (i < 0) i = a.length < cap ? a.length : Math.max(a.length, cap);
        a[i] = id;
        N[i] = Math.min(diff, full);
        diff -= N[i];
      }
      if (diff < 0) for (const i of at.slice().sort((p, q) => N[p] - N[q] || q - p)) { // the smallest first; the latest cell of a tie
        const t = Math.min(-diff, N[i]);
        N[i] -= t; diff += t;
        if (diff >= 0) break;
      }
      for (const i of at) if (N[i] <= 0) { a[i] = null; N[i] = null; }
    }
    return settle(a, cap, (x) => (isTool(x) ? 0 : size('items')), N); // collectables only in the backpack's cells
  }
  /** Items cell i as a cell ({ kind, n, ... }; a tool's n is that cell's own), or null. */
  function itemCell(run, i) {
    const x = layoutItems(run)[i];
    if (!x) return null;
    return isTool(x) ? Object.assign(cellOfId(x), { n: itemN(run)[i] }) : x;
  }
  /** Swap items cells i and j, their counts with them. */
  function swapItems(run, i, j) {
    const a = inv(run).items, N = itemN(run);
    while (a.length <= Math.max(i, j)) a.push(null);
    while (N.length < a.length) N.push(null);
    [a[i], a[j]] = [a[j], a[i]];
    [N[i], N[j]] = [N[j], N[i]];
  }
  /** Items cell i onto cell j, the same kind: as much as j has room for. */
  function mergeItems(run, i, j) {
    const a = layoutItems(run), N = itemN(run);
    if (i === j || !isTool(a[i]) || a[i] !== a[j]) return;
    const t = Math.min(N[i], fullOf(cellOfId(a[i]).kind) - N[j]);
    N[j] += t; N[i] -= t;
    if (N[i] <= 0) { a[i] = null; N[i] = null; }
  }
  /** Add to the run's counters for a tool (layoutItems() finds it cells). */
  function addTools(run, cell, n) {
    if (cell.kind === 'key') run.keys += n;
    else if (cell.kind === 'doorstone') run.doorstones += n;
    else if (cell.kind === 'chalk') run.chalks[cell.color] = (run.chalks[cell.color] || 0) + n;
    else for (let i = 0; i < n; i++) run.jars.push({ id: 'j' + (++run.jarSeq), holds: cell.holds || null });
  }
  /** The equipment you have, duster first: kinds in run.inv.equip order. */
  function layoutEquip(run) {
    const own = ['duster'].concat(Object.keys(run.equipment || {}).filter((k) => ITEMS[k] && run.equipment[k]));
    const a = inv(run).equip;
    for (let i = 0; i < a.length; i++) if (a[i] && !own.includes(a[i])) a[i] = null;
    for (const k of own) {
      if (a.includes(k)) continue;
      const i = a.findIndex((x) => x == null);
      a[i < 0 ? a.length : i] = k;
    }
    return settle(a, size('equip'));
  }
  const collCells = (run) => settle(inv(run).coll, size('coll'));

  // ---------------------------------------------------------------------------
  // In and out

  /**
   * Take a cell into your grids, as much of it as fits. Coins go to the purse
   * first. `force`: take it all, past the grids' size if need be (a pack
   * taken back). Returns how much didn't fit (0: all of it). `dry`: only count.
   */
  function receive(run, cell, { force = false, dry = false } = {}) {
    let n = cell.n || 1;
    if (TOOLS.has(cell.kind)) { // onto your cells of it with room, then into empty cells (layoutItems puts it there)
      let room = Infinity;
      if (!force) {
        const a = layoutItems(run), N = itemN(run), id = idOf(cell), full = fullOf(cell.kind), cap = itemCap(run);
        room = 0;
        for (let i = 0; i < cap; i++) room += a[i] == null ? full : a[i] === id ? full - N[i] : 0;
      }
      const take = Math.min(n, Math.max(0, room));
      if (!dry && take > 0) addTools(run, cell, take);
      return n - take;
    }
    if (!COLLECTABLE.has(cell.kind)) return n;
    const grids = []; // [cells, from, to]: the purse (coins), your collectables, then the backpack
    if (cell.kind === 'coin' && purseCells(run)) grids.push([purseCells(run), 0, size('purse')]);
    grids.push([inv(run).coll, 0, size('coll')]);
    if (has(run, 'backpack')) grids.push([layoutItems(run), size('items'), itemCap(run)]);
    const same = (c) => c && !isTool(c) && c.kind === cell.kind && c.type === cell.type;
    for (const [a, from, to] of grids) { // first onto stacks of the same, then into empty cells
      for (let i = from; i < (a === inv(run).items ? to : a.length) && n > 0; i++) {
        if (!same(a[i])) continue;
        const t = Math.min(n, capOf(cell.kind) - a[i].n);
        if (t > 0) { if (!dry) a[i].n += t; n -= t; }
      }
    }
    for (const [a, from, to] of grids) {
      for (let i = from; i < to && n > 0; i++) {
        if (a[i]) continue;
        const t = Math.min(n, capOf(cell.kind));
        if (!dry) { while (a.length < i) a.push(null); a[i] = { kind: cell.kind, type: cell.type, n: t }; }
        n -= t;
      }
    }
    if (force && n > 0) {
      const a = inv(run).coll;
      if (!dry) a.push({ kind: cell.kind, type: cell.type, n });
      n = 0;
    }
    return n;
  }
  /** Would any of this fit? */
  const fits = (run, cell) => receive(run, cell, { dry: true }) < (cell.n || 1);

  /**
   * Take `count` (default: all) out of a grid cell, and return it as a cell
   * (or null). `where`: 'items' (index into the layout: a stack, or a collectable in the backpack), 'coll', 'purse'.
   * `one`: just one (a jar, a key, a stick of chalk: the one already broken).
   */
  function takeOut(run, where, i, one) {
    if (where === 'items') {
      const id = layoutItems(run)[i];
      if (!id) return null;
      if (!isTool(id)) return takeCell(inv(run).items, i, one);
      const st = itemCell(run, i); // this cell's stack, not every one of the kind
      const n = !one ? st.n : st.kind === 'chalk' ? ((st.n - 1) % STROKES) + 1 : 1;
      if (st.kind === 'key') run.keys -= n;
      else if (st.kind === 'doorstone') run.doorstones -= n;
      else if (st.kind === 'chalk') { run.chalks[st.color] -= n; if (run.chalks[st.color] <= 0) delete run.chalks[st.color]; } else {
        let left = n;
        run.jars = run.jars.filter((j) => !(left > 0 && (j.holds || null) === st.holds && left--));
      }
      itemN(run)[i] -= n; // out of this cell (layoutItems empties it at 0)
      layoutItems(run);
      return Object.assign({}, st, { n });
    }
    return takeCell(where === 'purse' ? purseCells(run) : inv(run).coll, i, one);
  }
  function takeCell(a, i, one) {
    const c = a && a[i];
    if (!c) return null;
    const n = one ? 1 : c.n;
    c.n -= n;
    if (c.n <= 0) a[i] = null;
    return Object.assign({}, c, { n });
  }

  // ---------------------------------------------------------------------------
  // Bags: the purse and the backpack, set down with what's in them

  const BAGS = new Set(['purse', 'backpack']);
  /** Take a bag off, with what's in it: a cell { kind, n: 1, cells } (the purse's coins; the backpack's cells, in order). */
  function takeBag(run, kind) {
    let cells = [];
    if (kind === 'purse') cells = (purseCells(run) || []).slice();
    else {
      const main = size('items'), cap = itemCap(run);
      for (let i = main; i < cap; i++) cells.push(layoutItems(run)[i] ? takeOut(run, 'items', i) : null);
    }
    delete run.equipment[kind];
    while (cells.length && !cells[cells.length - 1]) cells.pop();
    return { kind, n: 1, cells };
  }
  /** Put a bag back on, what's in it back in its cells. One of it already on you: its contents come into your grids instead. */
  function giveBag(run, kind, cells) {
    cells = cells || [];
    if (has(run, kind)) { for (const c of cells) if (c) receive(run, c, { force: true }); return; }
    if (kind === 'purse') { run.equipment.purse = { cells: cells.map((c) => (c ? Object.assign({}, c) : null)) }; return; }
    run.equipment.backpack = {};
    const main = size('items');
    cells.forEach((c, j) => {
      if (!c) return;
      const at = main + j;
      if (TOOLS.has(c.kind)) { // back in its own cell if that's free, else with the rest
        const lay = layoutItems(run), N = itemN(run), n = c.n || 1;
        if (lay[at] == null && n <= fullOf(c.kind)) {
          while (lay.length <= at) lay.push(null);
          while (N.length < lay.length) N.push(null);
          lay[at] = idOf(c); N[at] = n;
        }
        addTools(run, c, n);
        return;
      }
      const lay = layoutItems(run);
      if (lay[at] == null) { while (lay.length <= at) lay.push(null); lay[at] = Object.assign({}, c); } else receive(run, c, { force: true });
    });
    layoutItems(run);
  }

  // ---------------------------------------------------------------------------
  // Names and icons

  const METAL = { copper: '#c7794a', silver: '#cfd3d8', gold: '#e6c25a' };
  const MARK = { sun: '☀', moon: '☾', eye: '◉', key: '⚷', wheel: '✇' };
  const CURIO = {
    teacup: { name: 'a chipped teacup', glyph: '☕', color: '#d9e4ea' },
    saucer: { name: 'a saucer with a blue rim', glyph: '◍', color: '#9fc0e6' },
    spoon: { name: 'a tarnished spoon', glyph: '⚲', color: '#b9bec4' },
    button: { name: 'a brass button', glyph: '❂', color: '#d2a84f' },
    thimble: { name: 'a thimble', glyph: '⛫', color: '#c9c2b4' },
    marble: { name: 'a glass marble', glyph: '●', color: '#7fc6c0' },
    moth: { name: 'a pressed moth', glyph: '❦', color: '#b8a58a' },
    beetle: { name: 'a beetle in amber', glyph: '✲', color: '#d68a2e' },
  };
  const coinName = (type) => { const [m, k] = (type || 'copper-sun').split('-'); return `${m} coin stamped with a ${k}`; };
  const JAR_NAME = { null: 'empty jar', pixie: 'pixie jar', entropy: 'jar of entropy' };

  /** A cell, in words: "3 keys", "a silver coin stamped with a moon". */
  function cellName(c) {
    const n = c.n || 1, s = n === 1 ? '' : 's';
    switch (c.kind) {
      case 'key': return n === 1 ? 'a key' : `${n} keys`;
      case 'doorstone': return n === 1 ? 'a doorstone' : `${n} doorstones`;
      case 'chalk': { const st = Math.ceil(n / STROKES); return `${c.color} chalk · ${st} stick${st === 1 ? '' : 's'}, ${n} mark${s} left`; }
      case 'jar': { const j = JAR_NAME[c.holds || null]; return n === 1 ? (c.holds ? 'a ' : 'an ') + j : `${n} ${j.replace('jar', 'jars')}`; }
      case 'coin': return n === 1 ? 'a ' + coinName(c.type) : `${n} ${coinName(c.type).replace('coin', 'coins')}`;
      case 'curio': return (CURIO[c.type] || CURIO.button).name + (n > 1 ? ` ×${n}` : '');
      default: return ITEMS[c.kind] && ITEMS[c.kind].label ? (BAGS.has(c.kind) ? 'your ' : '') + ITEMS[c.kind].label : c.kind;
    }
  }

  /** A cell's icon (a span), for the menu and the carousel. */
  function cellIcon(c) {
    if (TOOLS.has(c.kind)) return W.slotIcon(W.itemSlot(state.run, idOf(c), c));
    if (c.kind === 'coin') {
      const [m, k] = (c.type || 'copper-sun').split('-');
      const w = el('span', 'coinic');
      const disc = el('span', 'disc', MARK[k] || '·');
      disc.style.background = METAL[m] || METAL.copper;
      w.append(disc);
      if (c.n > 1) w.append(el('span', 'ct', '×' + c.n));
      return w;
    }
    if (c.kind === 'curio') {
      const cu = CURIO[c.type] || CURIO.button;
      const w = el('span', 'curioic');
      const g = el('span', 'ic', cu.glyph);
      g.style.color = cu.color;
      w.append(g);
      if (c.n > 1) w.append(el('span', 'ct', '×' + c.n));
      return w;
    }
    return el('span', 'ic', '?');
  }

  // ---------------------------------------------------------------------------
  // The kinds: coins and curios (collectables), the purse and the backpack (equipment)

  const coinGeo = new THREE.CylinderGeometry(0.07 * S, 0.07 * S, 0.014 * S, 16);
  const coinMats = {};
  const coinMat = (m) => coinMats[m] || (coinMats[m] = new THREE.MeshLambertMaterial({
    color: METAL[m] || METAL.copper, emissive: new THREE.Color(METAL[m] || METAL.copper).multiplyScalar(0.25),
  }));
  ITEMS.coin = {
    cls: 'collectable',
    take(run, item) {
      receive(run, { kind: 'coin', type: item.type, n: item.n || 1 });
      return `a ${coinName(item.type)}` + (purseCells(run) ? ' · into your purse' : '');
    },
    mesh(item) {
      const m = new THREE.Mesh(coinGeo, coinMat((item.type || 'copper').split('-')[0]));
      m.position.y = 0.012 * S;
      return m;
    },
    use: (p, slot) => ({ action: 'look', slot }),
    act: (u) => W.showCaption(`${cellName(u.slot.item)} · nothing to spend it on yet`),
  };
  const curioGeo = { cup: new THREE.CylinderGeometry(0.06 * S, 0.045 * S, 0.08 * S, 12), bit: new THREE.SphereGeometry(0.045 * S, 10, 8) };
  ITEMS.curio = {
    cls: 'collectable',
    take(run, item) {
      receive(run, { kind: 'curio', type: item.type, n: item.n || 1 });
      return (CURIO[item.type] || CURIO.button).name;
    },
    mesh(item) {
      const cu = CURIO[item.type] || CURIO.button;
      const m = new THREE.Mesh(item.type === 'teacup' || item.type === 'thimble' ? curioGeo.cup : curioGeo.bit,
        new THREE.MeshLambertMaterial({ color: cu.color, emissive: new THREE.Color(cu.color).multiplyScalar(0.15) }));
      m.position.y = 0.045 * S;
      return m;
    },
    use: (p, slot) => ({ action: 'look', slot }),
    act: (u) => W.showCaption(`${cellName(u.slot.item)} · it does nothing; it's just yours`),
  };

  const leatherMat = new THREE.MeshLambertMaterial({ color: 0x7a5232, emissive: 0x1a0e06 });
  const PURSE_SVG = '<svg viewBox="0 0 20 20" width="18" height="18"><path d="M6 6 Q10 9 14 6 L13 4 Q10 6 7 4 Z" fill="#a4774c"/>' +
    '<path d="M5 8 Q2 18 10 18 Q18 18 15 8 Q10 11 5 8 Z" fill="#8a5f38"/><circle cx="10" cy="13" r="1.6" fill="#e6c25a"/></svg>';
  const PACK_SVG = '<svg viewBox="0 0 20 20" width="18" height="18"><path d="M7 4 Q10 1 13 4" fill="none" stroke="#a4774c" stroke-width="1.6"/>' +
    '<rect x="4" y="4" width="12" height="14" rx="3" fill="#7a5232"/><rect x="6" y="10" width="8" height="5" rx="1.5" fill="#a4774c"/></svg>';
  const svgIcon = (svg) => { const ic = el('span', 'ic'); ic.innerHTML = svg; return ic; };
  ITEMS.purse = {
    cls: 'equipment',
    label: 'coin purse',
    take(run) {
      run.equipment.purse = { cells: [] };
      // Coins you already carry move in.
      const a = inv(run).coll;
      for (let i = 0; i < a.length; i++) if (a[i] && a[i].kind === 'coin') { const c = a[i]; a[i] = null; receive(run, c, { force: true }); }
      return 'a coin purse · your coins go in it · see it in your inventory (Tab)';
    },
    mesh() {
      const g = new THREE.Group();
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.09 * S, 12, 10), leatherMat);
      b.scale.set(1, 0.75, 1);
      b.position.y = 0.065 * S;
      const k = new THREE.Mesh(new THREE.SphereGeometry(0.03 * S, 8, 6), leatherMat);
      k.position.y = 0.14 * S;
      g.add(b, k);
      return g;
    },
    icon: () => svgIcon(PURSE_SVG),
    title: () => 'coin purse: holds your coins in its own grid',
  };
  ITEMS.backpack = {
    cls: 'equipment',
    label: 'backpack',
    take() {
      state.run.equipment.backpack = {};
      return `a backpack · room for ${size('backpack')} more stacks, tools or collectables`;
    },
    mesh() {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.2 * S, 0.24 * S, 0.12 * S), leatherMat);
      m.position.y = 0.12 * S;
      return m;
    },
    icon: () => svgIcon(PACK_SVG),
    title: () => `backpack: ${size('backpack')} more cells, for tools or collectables`,
  };
  /** An equipment kind's icon (its slot's, for the ones with a use). */
  function equipIcon(k) {
    const it = ITEMS[k];
    if (it.slot) { const s = it.slot(state.run); if (s) return it.icon(s); }
    return it.icon ? it.icon() : el('span', 'ic', '?');
  }
  const equipName = (k) => (ITEMS[k].label || (k === 'duster' ? 'feather duster' : k)) + (PROTECTED.has(k) ? ' · kept when you faint' : '');

  // ---------------------------------------------------------------------------
  // Things you drop: lying where you stood, as they were before you took them

  /** Drop a cell where you stand. It shows in the room until you pick it up again. */
  function dropCell(c) {
    const run = state.run, p = state.player, exp = state.exp;
    const sid = exp.registry[W.DE.key(Math.floor(p.x), Math.floor(p.y))];
    const sp = exp.spaces[sid];
    if (!sp) return false;
    const d = Object.assign({}, c, { id: 'd' + (++run.dropSeq), x: +p.x.toFixed(3), y: +p.y.toFixed(3), spaceId: sp.id, seed: sp.seed });
    if (!run.dropped) run.dropped = [];
    run.dropped.push(d);
    const rec = state.spaces.get(sp.id);
    if (rec) addDropToWorld(d, rec.group, rec.tileAt || {}, true);
    return true;
  }
  /** A dropped thing, in its room (buildSpace, or just now). `fresh`: you're standing on it; not picked up until you step off. */
  function addDropToWorld(d, group, tileAt, fresh) {
    const item = Object.assign({}, d, { cell: { x: d.x - 0.5, y: d.y - 0.5 }, drop: true });
    const key = 'drop:' + d.id;
    const mesh = W.itemMesh(item, key);
    const pickup = ITEMS[d.kind] && ITEMS[d.kind].cls === 'pickup';
    mesh.position.set(d.x * S, pickup ? 0.45 * S : 0, d.y * S);
    group.add(mesh);
    state.items.set(key, { mesh, item, spaceId: d.spaceId, tile: tileAt[W.DE.key(Math.floor(d.x), Math.floor(d.y))] || null, fresh: !!fresh });
  }
  /** buildSpace: the things dropped in this room. */
  function addDrops(space, group, tileAt) {
    for (const d of state.run.dropped || []) if (d.spaceId === space.id && d.seed === space.seed) addDropToWorld(d, group, tileAt, false);
  }
  /** A dropped thing picked up again: it's yours, and gone from the room. */
  function takeDrop(item) {
    const run = state.run;
    run.dropped = (run.dropped || []).filter((d) => d.id !== item.id);
    if (BAGS.has(item.kind)) {
      const full = (item.cells || []).some(Boolean);
      giveBag(run, item.kind, item.cells);
      return `your ${ITEMS[item.kind].label}` + (full ? ' · and what\'s in it' : '');
    }
    const c = { kind: item.kind, n: item.n || 1, color: item.color, holds: item.holds, type: item.type };
    receive(run, c, { force: true });
    return cellName(c);
  }

  // ---------------------------------------------------------------------------
  // A faint: everything falls but protected equipment (packs.js)

  /** What packUp takes from the inventory, beyond the counters: collectables, unprotected equipment, the layout. */
  function packInventory(run) {
    const out = { coll: inv(run).coll.slice(), equip: {}, layout: layoutItems(run).slice() };
    for (const k in run.equipment) if (run.equipment[k] && !PROTECTED.has(k)) { out.equip[k] = run.equipment[k]; delete run.equipment[k]; }
    inv(run).coll = [];
    const a = inv(run).items;
    for (let i = 0; i < a.length; i++) if (a[i] && !isTool(a[i])) a[i] = null; // the backpack's collectables
    return out;
  }
  const packHasInventory = (pk) => !!(pk.coll && pk.coll.some(Boolean)) || !!(pk.equip && Object.keys(pk.equip).length) ||
    !!(pk.layout && pk.layout.some((x) => x && !isTool(x)));
  /** Taking a pack back: equipment to where it was, collectables to their cells, and the stacks' order. */
  function unpackInventory(run, pk) {
    for (const k in pk.equip || {}) {
      const e = pk.equip[k];
      if (!run.equipment[k]) { run.equipment[k] = e; continue; }
      for (const c of (e && e.cells) || []) if (c) receive(run, c, { force: true }); // found another meanwhile
    }
    const a = inv(run).coll;
    (pk.coll || []).forEach((c, i) => { if (!c) return; if (!a[i]) a[i] = c; else receive(run, c, { force: true }); });
    const lay = layoutItems(run);
    (pk.layout || []).forEach((id, i) => { // stacks back in their cells (whatever's there moves to make room)
      if (!isTool(id) || lay[i] === id || (lay[i] && !isTool(lay[i]))) return;
      const at = lay.findIndex((x, j) => x === id && pk.layout[j] !== id); // a cell of it not already where one was
      if (at >= 0) swapItems(run, at, i);
    });
    layoutItems(run);
    (pk.layout || []).forEach((c, i) => { // the backpack's collectables back in theirs
      if (!c || isTool(c)) return;
      const a = layoutItems(run);
      if (i >= size('items') && i < itemCap(run) && a[i] == null) { while (a.length <= i) a.push(null); a[i] = c; } else receive(run, c, { force: true });
    });
    pk.coll = []; pk.equip = {}; pk.layout = [];
  }

  // ---------------------------------------------------------------------------
  // Chests: a loose object (restore.js) with a grid of its own

  const chestCells = (key) => { const o = state.run.objects[key]; return o ? (o.cells = o.cells || []) : null; };
  /** Put a cell into a chest: onto a stack of the same, then the first empty cell. Returns what didn't fit. */
  function giveToChest(key, c) {
    const a = chestCells(key), cap = size('chest');
    let n = c.n || 1;
    const same = (x) => x && idOf(x) === idOf(c) && x.type === c.type;
    const capN = (k) => capOf(k) * (k === 'chalk' ? STROKES : 1);
    for (let i = 0; i < a.length && n > 0; i++) if (same(a[i])) { const t = Math.min(n, capN(c.kind) - a[i].n); if (t > 0) { a[i].n += t; n -= t; } }
    for (let i = 0; i < cap && n > 0; i++) if (!a[i]) { const t = Math.min(n, capN(c.kind)); a[i] = Object.assign({}, c, { n: t }); n -= t; }
    return n;
  }

  Object.assign(W, { INV, PROTECTED, TOOLS, COLLECTABLE, BAGS, takeBag, giveBag, isTool, invSize: size, inv, itemCap, purseCells, idOf, cellOfId, itemStacks,
    layoutItems, itemCell, swapItems, mergeItems, layoutEquip, collCells, receive, fits, takeOut, cellName, cellIcon, equipIcon, equipName, coinName, CURIO,
    dropCell, addDrops, takeDrop, packInventory, packHasInventory, unpackInventory, chestCells, giveToChest });
})(window);
