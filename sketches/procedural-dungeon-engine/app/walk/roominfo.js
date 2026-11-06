// Walk mode, dev: the room-info window. Turn it on in the dev panel
// (Cheats > Debug views > ATMOS.roomInfo) and it shows everything about the
// room you're in: what it is, its region, material and conditions (each
// axis's value and band), and what those made here (dust, motes, sparks,
// fog, air, puddles, drips, wells, sigils). It floats over the game, stays
// open when the dev panel closes, and can be dragged anywhere by its title
// (where you leave it is remembered).
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, DP, state } = W;

  const POS_KEY = 'dungeon-engine:roominfo-pos';
  const box = document.createElement('div');
  box.id = 'room-info';
  Object.assign(box.style, {
    position: 'fixed', left: '12px', top: '290px', zIndex: 40, width: '290px', maxHeight: 'calc(100vh - 24px)', overflowY: 'auto',
    background: 'rgba(14, 12, 18, 0.9)', color: '#e6e0d2', border: '1px solid #3a3440', borderRadius: '8px',
    font: '11px/1.45 ui-monospace, Menlo, Consolas, monospace', boxShadow: '0 4px 18px rgba(0,0,0,0.5)', display: 'none',
    userSelect: 'none',
  });
  const head = document.createElement('div');
  head.textContent = 'Room info';
  Object.assign(head.style, { padding: '5px 9px', cursor: 'move', borderBottom: '1px solid #3a3440', color: '#d9a066', fontWeight: 'bold' });
  const body = document.createElement('div');
  Object.assign(body.style, { padding: '6px 9px 8px', whiteSpace: 'pre', overflow: 'hidden' });
  box.append(head, body);
  document.body.append(box);

  try {
    const pos = JSON.parse(global.localStorage.getItem(POS_KEY) || 'null');
    if (pos) Object.assign(box.style, { left: pos.left, top: pos.top });
  } catch (e) { /* storage blocked */ }

  // Drag by the title.
  let drag = null;
  head.addEventListener('pointerdown', (e) => {
    const r = box.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    head.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  head.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const x = Math.max(0, Math.min(global.innerWidth - 60, e.clientX - drag.dx));
    const y = Math.max(0, Math.min(global.innerHeight - 30, e.clientY - drag.dy));
    Object.assign(box.style, { left: x + 'px', top: y + 'px' });
  });
  head.addEventListener('pointerup', () => {
    if (!drag) return;
    drag = null;
    try { global.localStorage.setItem(POS_KEY, JSON.stringify({ left: box.style.left, top: box.style.top })); } catch (e) { /* storage blocked */ }
  });

  const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
  const bar = (v) => { const n = Math.round(v * 10); return '[' + '#'.repeat(n) + '.'.repeat(10 - n) + ']'; };

  function text(sp) {
    const exp = state.exp;
    const g = exp.regions && exp.regions[sp.regionId];
    const rec = state.spaces.get(sp.id) || {};
    const c = sp.meta.cond || {};
    const lines = [];
    lines.push(`${sp.id} · ${sp.deadEnd ? 'dead end' : sp.archetype} · ${sp.role || '-'} · depth ${sp.depth} · ${sp.cells.length} cells`);
    if (g) lines.push(`region ${g.id} · ${g.type} · ${DE.regionSpent(exp, g.id)}/${g.size} rooms`);
    lines.push(`material ${sp.meta.material || '-'} · hue ${sp.meta.hue}`);
    lines.push(`mood "${sp.meta.mood}"`);
    lines.push('');
    for (const a of DE.AXES) {
      const v = c[a] == null ? 0.5 : c[a];
      lines.push(`${pad(a, 11)} ${bar(v)} ${v.toFixed(2)} ${DE.bandOf(c, a)}`);
    }
    lines.push('');
    const info = rec.atmosInfo || {};
    const dust = DP.dust(sp);
    lines.push(`air      ${info.air || '-'}${info.air === 'breathing' ? ` (${(info.breath || 0).toFixed(1)} s)` : ''}`);
    lines.push(`motes    ${info.motes || 0}   sparks ${info.sparks || 0}   fog ${info.fog || 0}`);
    lines.push(`dust     ${dust.cells.length} half-cells${dust.crust.length ? `, ${dust.crust.length} crusted` : ''}`);
    const w = rec.water || { puddles: [], spots: [] };
    lines.push(`water    ${w.puddles.length} puddles, ${w.spots.length} drip spots`);
    const well = DP.well(sp), sig = DP.sigil(sp);
    lines.push(`wells    ${well ? well.kind : 'none'}   sigil ${sig ? 'yes' : 'no'}`);
    lines.push(`ambient  ${DE.bandOf(c, 'temperature')} light`);
    return lines.join('\n');
  }

  let next = 0, lastId = null;
  /** Each frame: show or hide, and refresh a few times a second (and on a new room). */
  function updateRoomInfo() {
    const on = !!(W.ATMOS && W.ATMOS.roomInfo);
    box.style.display = on ? 'block' : 'none';
    if (!on || !state.exp) return;
    const sp = state.exp.spaces[state.player.spaceId];
    const now = performance.now();
    if (!sp || (now < next && sp.id === lastId)) return;
    next = now + 250; lastId = sp.id;
    body.textContent = text(sp);
  }

  Object.assign(W, { updateRoomInfo });
})(window);
