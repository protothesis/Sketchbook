// Walk mode: the d-pad strips (HANDS-PLAN.md, step 3). Hold a d-pad
// direction and a strip of what you carry opens, on the thing the slot holds
// now: ◀ items (the item slot), ▼ collectables (the item slot too). The
// right stick (or LB / RB) moves along it; down and up move between its rows:
// the main grid's, then each bag's (the backpack under both, the purse under
// collectables only), each shown as just its icon until you move into it.
// Let go of the d-pad and the highlighted thing is taken in hand (assigned to
// the item slot, if your hands are full of a block). B drops the highlighted
// one in front of you, one a press. Nothing here moves or sorts things: that's
// the menu's job. The world doesn't pause.
//
// Keyboard: hold 3 (items) or 4 (collectables); 1 / 2 move along; G drops.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { state, el } = W;

  const SHOW = 9; // cells shown at once, the highlighted one kept in the middle

  let strip = null; // { kind: 'items' | 'coll', row, i }
  const stripEl = el('div', 'strip');
  stripEl.hidden = true;
  document.body.append(stripEl);

  const hasBag = (k) => !!(state.run.equipment && state.run.equipment[k]);

  /**
   * The strip's rows: [{ bag: null | 'backpack' | 'purse', entries }]. An
   * items entry is { key, slot } (a stack, or the hourglass); a collectables
   * entry is { grid, i, cell }.
   */
  function rowsFor(kind) {
    const run = state.run, main = W.invSize('items'), lay = W.layoutItems(run);
    if (kind === 'items') {
      const slotOf = new Map(W.slots().filter((s) => s.kind !== 'duster' && !s.coll).map((s) => [s.key, s]));
      const ids = (from, to) => {
        const seen = new Set(), out = [];
        for (let i = from; i < Math.min(to, lay.length); i++) {
          const x = lay[i];
          if (x && W.isTool(x) && slotOf.has(x) && !seen.has(x)) { seen.add(x); out.push({ key: x, slot: slotOf.get(x) }); }
        }
        return out;
      };
      const top = ids(0, main);
      for (const [k, s] of slotOf) if (!lay.includes(k)) top.push({ key: k, slot: s }); // the hourglass (equipment)
      const rows = [{ bag: null, entries: top }];
      if (hasBag('backpack')) rows.push({ bag: 'backpack', entries: ids(main, Infinity) });
      return rows;
    }
    const cells = (grid, a, from = 0) => {
      const out = [];
      if (a) for (let i = from; i < a.length; i++) if (a[i] && !W.isTool(a[i])) out.push({ grid, i, cell: a[i] });
      return out;
    };
    const rows = [{ bag: null, entries: cells('coll', W.inv(run).coll) }];
    if (hasBag('purse')) rows.push({ bag: 'purse', entries: cells('purse', W.purseCells(run)) });
    if (hasBag('backpack')) rows.push({ bag: 'backpack', entries: cells('items', lay, main) });
    return rows;
  }

  const open = () => !!strip;
  const entryNow = (rows) => { const r = rows[strip.row]; return r && r.entries[strip.i] || null; };

  /** Open a strip, on what the item slot holds now. */
  function openStrip(kind) {
    if (state.paused || state.bigmap || state.choice) return;
    strip = { kind, row: 0, i: 0 };
    const rows = rowsFor(kind);
    const h = state.handColl;
    rows.some((r, ri) => r.entries.some((e, ei) => {
      const hit = kind === 'items' ? e.key === state.itemSel : !!h && e.grid === h.grid && e.i === h.i;
      if (hit) { strip.row = ri; strip.i = ei; }
      return hit;
    }));
    render();
  }
  /** Let go: the highlighted thing in hand (`take`), or just close. */
  function closeStrip(take) {
    if (!strip) return;
    const kind = strip.kind, e = take && entryNow(rowsFor(kind));
    strip = null;
    stripEl.hidden = true;
    if (!e) return;
    if (kind === 'items') {
      state.itemCat = 'items';
      state.itemSel = e.key;
      if (state.sel !== e.key) W.hold(e.key);
      else W.refreshHotbar();
    } else {
      state.itemCat = 'coll';
      state.handColl = { grid: e.grid, i: e.i };
      W.hold('hand-coll');
    }
  }
  /** Along the row. */
  function moveStrip(d) {
    if (!strip) return;
    const r = rowsFor(strip.kind)[strip.row];
    strip.i = Math.max(0, Math.min(((r && r.entries.length) || 1) - 1, strip.i + d));
    render();
  }
  /** Down into a bag's row, or back up. */
  function rowStrip(d) {
    if (!strip) return;
    const rows = rowsFor(strip.kind);
    const to = Math.max(0, Math.min(rows.length - 1, strip.row + d));
    if (to === strip.row) return;
    strip.row = to;
    strip.i = Math.min(strip.i, Math.max(0, rows[to].entries.length - 1));
    render();
  }
  /** B: drop one of the highlighted thing in front of you. The hourglass stays with you. */
  function dropFromStrip() {
    if (!strip) return;
    const run = state.run, rows = rowsFor(strip.kind), e = entryNow(rows);
    if (!e) { W.shakeHotbar(); return; }
    let out = null;
    if (strip.kind === 'items') {
      if (e.slot.kind === 'hourglass') { W.showCaption('your hourglass stays with you'); return; }
      const main = W.invSize('items'), lay = W.layoutItems(run), inPack = rows[strip.row].bag === 'backpack';
      let at = -1;
      for (let i = lay.length - 1; i >= 0; i--) if (lay[i] === e.key && (i >= main) === inPack) { at = i; break; }
      out = at >= 0 && W.takeOut(run, 'items', at, true);
    } else {
      out = W.takeOut(run, e.grid, e.i, true);
    }
    if (!out) return;
    if (!W.dropCell(out, W.dropSpot(state.player))) { W.receive(run, out, { force: true }); W.showCaption('nowhere to drop it here'); return; }
    W.showCaption('you set down ' + W.cellName(out));
    W.selectedSlot(); // the last one gone from your hand: empty hands
    W.savePlayer();
    W.refreshHud();
    W.refreshHotbar();
    moveStrip(0); // keep the cursor on something
  }

  const iconOf = (kind, e) => (kind === 'items' ? W.slotIcon(e.slot) : W.cellIcon(e.cell));
  const nameOf = (kind, e) => (kind === 'items' ? W.slotLabel(e.slot) : W.cellName(e.cell));
  const bagName = (b) => (b === 'purse' ? 'coin purse' : b);

  function render() {
    if (!strip) return;
    const rows = rowsFor(strip.kind), row = rows[strip.row] || rows[0], g = (k) => W.glyph(k);
    const pad = W.padMode && W.padMode();
    stripEl.innerHTML = '';
    stripEl.hidden = false;
    stripEl.className = 'strip ' + strip.kind;
    const head = el('div', 'strip-head', (strip.kind === 'items' ? 'items' : 'collectables') + (row.bag ? ' · ' + bagName(row.bag) : ''));
    if (strip.row > 0) head.prepend(el('span', 'strip-up', '▴ '));
    stripEl.append(head);
    const cells = el('div', 'strip-cells');
    const n = row.entries.length;
    if (!n) cells.append(el('span', 'strip-empty', row.bag ? 'nothing in it' : 'nothing here'));
    const from = Math.max(0, Math.min(n - SHOW, strip.i - Math.floor(SHOW / 2)));
    if (from > 0) cells.append(el('span', 'strip-more', '‹'));
    for (let k = from; k < Math.min(n, from + SHOW); k++) {
      const e = row.entries[k];
      const inHand = strip.kind === 'items' ? state.sel === e.key
        : state.sel === 'hand-coll' && state.handColl && state.handColl.grid === e.grid && state.handColl.i === e.i;
      const c = el('span', 'slot strip-cell' + (k === strip.i ? ' cur' : '') + (inHand ? ' hand' : '') + (strip.kind === 'coll' ? ' coll' : ''));
      c.append(iconOf(strip.kind, e));
      cells.append(c);
    }
    if (from + SHOW < n) cells.append(el('span', 'strip-more', '›'));
    stripEl.append(cells);
    const cur = row.entries[strip.i];
    stripEl.append(el('div', 'strip-name', cur ? nameOf(strip.kind, cur) : ''));
    // The rows below, as their bags' icons: move down into one.
    const below = rows.slice(strip.row + 1);
    if (below.length) {
      const bags = el('div', 'strip-bags');
      below.forEach((r, k) => {
        const b = el('span', 'strip-bag' + (k === 0 ? ' next' : ''));
        b.append(W.equipIcon(r.bag), el('span', 'strip-bag-n', bagName(r.bag) + (r.entries.length ? ' · ' + r.entries.length : '')));
        bags.append(b);
      });
      stripEl.append(bags);
    }
    stripEl.append(el('div', 'strip-hint', pad
      ? `RS move${below.length ? ' · RS ▾ ' + bagName(below[0].bag) : ''}${strip.row ? ' · RS ▴ back' : ''} · ${g('G')} drop · let go to take it`
      : `1 / 2 move · G drop · let go to take it`));
  }

  Object.assign(W, { openStrip, closeStrip, moveStrip, rowStrip, dropFromStrip, stripOpen: open });
})(window);
