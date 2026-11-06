// Walk mode: the d-pad strips (HANDS-PLAN.md, step 3). Hold a d-pad
// direction and a strip of what you carry opens in the middle of the
// screen, on the thing the slot holds now: ◀ tools (the RT slot), ▼
// collectables and ▶ items (the item slot). The right stick (or LB / RB)
// moves along it; down and up move between its rows, one grid row each:
// the main grid's, then each bag's (the backpack under items and
// collectables, the purse under collectables only). Only the row you're on
// is open; the others fold to one cell (a bag's own icon). Let go of the
// d-pad and the highlighted thing is taken in hand (just assigned, if your
// hands are full of a block). B drops the highlighted one in front of you,
// one a press. Nothing here moves or sorts things: that's the menu's job.
// The world doesn't pause.
//
// Keyboard: hold 3 (tools), 4 (collectables) or 5 (items); 1 / 2 move
// along; G drops.
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
    if (kind === 'tools') return [{ bag: null, entries: W.slots().filter((s) => s.kind === 'duster').map((s) => ({ key: s.key, slot: s })) }];
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
      const hit = kind === 'tools' ? e.key === state.sel : kind === 'items' ? e.key === state.itemSel : !!h && e.grid === h.grid && e.i === h.i;
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
    if (kind === 'tools') {
      if (state.sel !== e.key && !state.carry) W.hold(e.key);
    } else if (kind === 'items') {
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
    if (strip.kind === 'tools') { W.showCaption(`your ${W.slotLabel(e.slot)} stays with you`); return; }
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

  const isSlotKind = (kind) => kind !== 'coll';
  const iconOf = (kind, e) => (isSlotKind(kind) ? W.slotIcon(e.slot) : W.cellIcon(e.cell));
  const DIR = { tools: '◀', coll: '▼', items: '▶' };

  /** One cell, like the menu's: `e` an entry, or null for an empty one. */
  function cellEl(kind, e, cls) {
    const c = el('span', 'slot cell' + (e ? '' : ' empty') + (cls ? ' ' + cls : ''));
    if (e) c.append(iconOf(kind, e));
    return c;
  }
  /** A row folded to one cell: a bag's own icon, or the main row's thing (its highlighted one, if any). */
  function foldedEl(kind, r) {
    if (r.bag) {
      const c = el('span', 'slot cell bag fold');
      c.append(W.equipIcon(r.bag));
      return c;
    }
    return cellEl(kind, r.entries[0] || null, 'fold');
  }

  function render() {
    if (!strip) return;
    const kind = strip.kind, rows = rowsFor(kind);
    stripEl.innerHTML = '';
    stripEl.hidden = false;
    stripEl.className = 'strip ' + kind;
    const grid = el('div', 'strip-rows');
    rows.forEach((r, ri) => {
      const line = el('div', 'strip-row' + (ri === strip.row ? ' on' : ''));
      if (ri !== strip.row) { line.append(foldedEl(kind, r)); grid.append(line); return; }
      if (r.bag) { const b = el('span', 'slot cell bag head'); b.append(W.equipIcon(r.bag)); line.append(b); }
      const n = r.entries.length;
      if (!n) line.append(cellEl(kind, null, 'cur'));
      const from = Math.max(0, Math.min(n - SHOW, strip.i - Math.floor(SHOW / 2)));
      for (let k = from; k < Math.min(n, from + SHOW); k++) {
        const e = r.entries[k];
        const inHand = isSlotKind(kind) ? state.sel === e.key
          : state.sel === 'hand-coll' && state.handColl && state.handColl.grid === e.grid && state.handColl.i === e.i;
        line.append(cellEl(kind, e, (k === strip.i ? 'cur' : '') + (inHand ? ' hand' : '') + (kind === 'coll' ? ' coll' : '')));
      }
      grid.append(line);
    });
    stripEl.append(grid);
    const acts = el('div', 'strip-actions');
    acts.append(el('span', 'btn', `Equip (let go ${DIR[kind]})`));
    if (kind !== 'tools') acts.append(el('span', 'btn', `Drop (${W.glyph('G')})`));
    stripEl.append(acts);
  }

  Object.assign(W, { openStrip, closeStrip, moveStrip, rowStrip, dropFromStrip, stripOpen: open });
})(window);
