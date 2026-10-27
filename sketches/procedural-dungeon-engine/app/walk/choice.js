// Walk mode: a choice in the world, and the icons for what's at stake. Any
// action can put one up (W.openChoice): a few options side by side over the
// thing you're acting on. A / D (or the arrows) move between them, and E
// held confirms the one picked, filling the hold ring as any action does
// (actions.js). Esc, W or S backs out. On touch, press and hold an option.
// While a choice is up you stand still. An option can be unavailable (it
// says why, muted) or lose things (the icons of what's at stake turn red and
// crossed out while it's picked).
//
// The first user is the door to a lost path (retrace or reroll); nothing in
// here knows about doors.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { state, el } = W;

  // ---------------------------------------------------------------------------
  // Icons for things you could lose: small inline SVGs in currentColor.

  const ICONS = {
    pack: '<svg viewBox="0 0 16 16"><path d="M3.6 7.4C3.6 5.7 5.6 4.6 8 4.6s4.4 1.1 4.4 2.8v4.3c0 1.1-2 1.8-4.4 1.8s-4.4-.7-4.4-1.8z" fill="currentColor" opacity=".9"/><path d="M6.3 4.8 8 3l1.7 1.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    lantern: '<svg viewBox="0 0 16 16"><path d="M5.2 4.2h5.6L9.8 2.4H6.2z" fill="currentColor"/><rect x="5.2" y="5" width="5.6" height="6.6" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 6.6c1.1 1 1.1 2.6 0 3.3-1.1-.7-1.1-2.3 0-3.3z" fill="currentColor"/><rect x="4.4" y="12.2" width="7.2" height="1.6" rx=".4" fill="currentColor"/></svg>',
    waystone: '<svg viewBox="0 0 16 16"><rect x="5" y="2" width="6" height="12" rx="1" fill="currentColor" opacity=".9"/><path d="M8 4.5v2.5M6.8 9.2h2.4" stroke="#0c0a10" stroke-width="1.1" stroke-linecap="round"/></svg>',
  };
  const LABEL = { pack: 'your pack', lantern: 'a save lantern', waystone: 'a waystone' };

  /**
   * A lost path's own icon: its rooms' cells as a little map, styled like
   * the minimap's lost paths. { kind: 'path', key, svg }, for iconRow.
   * Lost (`lose` on the row), it blinks red instead of being crossed out.
   */
  function pathIcon(cellKeys) {
    const DE = W.DE;
    const cells = cellKeys.map(DE.parseKey);
    const own = new Set(cellKeys);
    const xs = cells.map((c) => c.x), ys = cells.map((c) => c.y);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    const cols = Math.max(...xs) - x0 + 1, rows = Math.max(...ys) - y0 + 1;
    const u = 4, pad = 1.5; // viewBox units per cell; the icon keeps the path's own proportions
    const at = (x, y) => [pad + (x - x0) * u, pad + (y - y0) * u];
    let fill = '', grid = '', edge = '';
    for (const c of cells) {
      const [x, y] = at(c.x, c.y);
      fill += `M${x} ${y}h${u}v${u}h-${u}z`;
      for (const f of DE.FACINGS) {
        const n = DE.step(c, f);
        const [ax, ay] = at(c.x + (f === 'E' ? 1 : 0), c.y + (f === 'S' ? 1 : 0));
        const side = `M${ax} ${ay}` + (f === 'N' || f === 'S' ? `h${u}` : `v${u}`);
        if (!own.has(DE.key(n.x, n.y))) edge += side; // the outline: sides that aren't another of its cells
        else if (f === 'E' || f === 'S') grid += side; // faint cell lines inside, like the minimap
      }
    }
    const vw = cols * u + 2 * pad, vh = rows * u + 2 * pad;
    const w = Math.min(66, Math.max(14, 22 * vw / vh)); // px wide at 22px tall (play.css), capped
    const svg = `<svg viewBox="0 0 ${vw} ${vh}" style="width:${w.toFixed(1)}px"><path d="${fill}" fill="currentColor" fill-opacity=".45"/>` +
      `<path d="${grid}" fill="none" stroke="currentColor" stroke-opacity=".45" stroke-width=".5"/>` +
      `<path d="${edge}" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="square"/></svg>`;
    return { kind: 'path', key: 'path:' + cellKeys.slice().sort().join(';'), svg };
  }
  LABEL.path = 'this lost path, every room of it';

  /**
   * A row of icons (kinds, e.g. ['pack', 'lantern'], or an icon object from
   * pathIcon); `lose`: red and crossed out (a path's own icon blinks red).
   */
  function iconRow(row, kinds, lose) {
    const sig = kinds.map((k) => (typeof k === 'string' ? k : k.key)).join(',') + (lose ? '!' : '');
    if (row.dataset.sig === sig) return;
    row.dataset.sig = sig;
    row.replaceChildren();
    row.classList.toggle('lose', !!lose);
    row.hidden = !kinds.length;
    for (const k of kinds) {
      const kind = typeof k === 'string' ? k : k.kind;
      const i = el('span', 'thing ' + kind);
      i.innerHTML = (typeof k === 'string' ? null : k.svg) || ICONS[kind] || '';
      i.title = (lose ? 'lost: ' : '') + (LABEL[kind] || kind);
      row.append(i);
    }
  }

  // ---------------------------------------------------------------------------
  // The choice

  const panel = el('div', 'choice');
  panel.hidden = true;
  const titleEl = el('div', 'choice-title');
  const thingsEl = el('div', 'things');
  const optsEl = el('div', 'choice-opts');
  const hintEl = el('div', 'choice-hint');
  panel.append(titleEl, thingsEl, optsEl, hintEl);
  document.body.append(panel);
  const touchUi = global.matchMedia && global.matchMedia('(hover: none)').matches;

  /**
   * Put a choice up. o: { title, things: [icon kinds], box (what it's over:
   * a focus box, actions.js), sel (the option picked first), options: [{
   * label, icon (for the hold ring), detail, off (why it can't be picked
   * now, or null), lose (picking it loses `things`), act() }] }.
   */
  function openChoice(o) {
    state.choice = Object.assign({ things: [], sel: 0 }, o);
    W.keys.clear(); // you stand still while it's up
    render();
  }

  function closeChoice() {
    if (!state.choice) return;
    state.choice = null;
    panel.hidden = true;
  }

  /** A / D: the option to the left or right. */
  function moveChoice(d) {
    const c = state.choice;
    if (!c) return;
    c.sel = (c.sel + d + c.options.length) % c.options.length;
    render();
  }

  /** What E is about while a choice is up: confirming the picked option. */
  function choiceNear() {
    const c = state.choice;
    if (!c) return null;
    const opt = c.options[c.sel];
    return { action: 'choose', choice: c, opt, box: c.box, icon: opt.icon, things: c.things, lose: !!opt.lose, sel: c.sel };
  }

  function render() {
    const c = state.choice;
    if (!c) return;
    titleEl.textContent = c.title || '';
    optsEl.replaceChildren(...c.options.map((o, i) => {
      const b = el('button', 'choice-opt' + (i === c.sel ? ' sel' : '') + (o.off ? ' off' : '') + (o.lose ? ' lose' : ''));
      b.type = 'button';
      b.append(el('span', 'ico', o.icon || ''), el('b', null, o.label));
      if (o.off || o.detail) b.append(el('small', null, o.off || o.detail));
      // Touch: press and hold an option to pick and confirm it.
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (state.choice !== c) return;
        c.sel = i;
        render();
        W.pressE();
      });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => W.releaseE());
      return b;
    }));
    iconRow(thingsEl, c.things, !!c.options[c.sel].lose);
    hintEl.textContent = W.padMode() ? `◀ ▶ to choose · hold ${W.glyph('E')} · ${W.glyph('Esc')} to back out`
      : touchUi ? 'press and hold one' : 'A / D to choose · hold E · Esc to back out';
    panel.hidden = false;
  }

  /** Each frame (hud.js): keep the panel over what it's about. */
  function updateChoice(rect) {
    if (!state.choice) return;
    if (!rect) { panel.style.left = '50%'; panel.style.top = '40%'; return; }
    panel.style.left = (rect.x0 + rect.x1) / 2 + 'px';
    panel.style.top = (rect.y0 - 44) + 'px'; // above the hold ring
  }

  Object.assign(W, { ICONS, pathIcon, iconRow, openChoice, closeChoice, moveChoice, choiceNear, updateChoice });
})(window);
