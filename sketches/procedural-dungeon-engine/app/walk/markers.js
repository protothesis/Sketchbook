// Walk mode: off-screen markers for creatures. A creature you'd want to
// know about that's off screen gets a marker on a ring around the figure
// (not the screen's edge, so none get lost in a far corner), with an arrow
// toward it. Each kind of creature registers how it's marked: which of
// them want a marker, the icon, and a class for the ring's colour (see
// .gedge in play.css). Ghosts (ghosts.js) and shadow creepers (creepers.js)
// register themselves; updateMarkers() runs once a frame, after them.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, THREE, $, S, camera, state, roomGap } = W;

  // kind: {
  //   list():       the live creatures of this kind
  //   wanted(c):    does it want a marker now (when off screen)?
  //   key(c):       changes whenever its icon needs redrawing
  //   draw(c, cv):  paint its icon into a 96 x 96 canvas
  //   cls(c):       extra classes for the marker ('' for none)
  //   lift:         cells above the creature's mesh to aim at (default 0.5)
  // }
  const kinds = [];
  function register(kind) { kinds.push(kind); }

  /** Is c within `range` cells of you and `rooms` rooms or nearer? (For idle markers.) */
  function near(c, rooms, range) {
    const p = state.player;
    if (p.spaceId == null || Math.hypot(c.x - p.x, c.y - p.y) >= range) return false;
    const cs = state.exp.registry[DE.key(Math.floor(c.x), Math.floor(c.y))];
    return cs !== undefined && roomGap(cs, p.spaceId, rooms) <= rooms;
  }

  const layer = $('ghost-edges');
  const marks = new Map(); // creature -> { el, cv, key, cls }
  const v = new THREE.Vector3();

  function updateMarkers() {
    const w = global.innerWidth, h = global.innerHeight, p = state.player;
    v.set(p.x * S, (p.z + 0.35) * S, p.y * S).project(camera);
    const ox = (v.x + 1) / 2 * w, oy = (1 - v.y) / 2 * h;
    const R = Math.min(w, h) * 0.42;
    const live = new Set();
    for (const kind of kinds) {
      for (const c of kind.list()) {
        live.add(c);
        let show = false, px = 0, py = 0, ang = 0;
        if (!state.bigmap && !state.paused && kind.wanted(c)) {
          v.copy(c.mesh.position);
          v.y += (kind.lift == null ? 0.5 : kind.lift) * S;
          v.project(camera);
          const behind = v.z > 1;
          let sx = (v.x + 1) / 2 * w, sy = (1 - v.y) / 2 * h;
          if (behind) { sx = w - sx; sy = h - sy; }
          if (behind || sx < 8 || sx > w - 8 || sy < 8 || sy > h - 8) {
            show = true;
            ang = Math.atan2(sy - oy, sx - ox);
            px = ox + Math.cos(ang) * R; py = oy + Math.sin(ang) * R;
          }
        }
        let m = marks.get(c);
        if (show && !m) {
          const el = document.createElement('div');
          el.innerHTML = '<canvas width="96" height="96"></canvas><i class="arrow"></i>';
          layer.append(el);
          m = { el, cv: el.firstChild, arrow: el.lastChild, key: null, cls: null };
          marks.set(c, m);
        }
        if (!m) continue;
        m.el.hidden = !show;
        if (!show) continue;
        m.el.style.left = px + 'px';
        m.el.style.top = py + 'px';
        m.arrow.style.transform = `rotate(${ang}rad) translateX(26px)`;
        const cls = kind.cls(c);
        if (cls !== m.cls) { m.el.className = 'gedge' + (cls ? ' ' + cls : ''); m.cls = cls; }
        const key = kind.key(c);
        if (key !== m.key) { kind.draw(c, m.cv); m.key = key; }
      }
    }
    // Creatures that are gone (removed, collapsed, caught) take their markers with them.
    for (const [c, m] of marks) if (!live.has(c)) { m.el.remove(); marks.delete(c); }
  }

  W.markers = { register, near };
  Object.assign(W, { updateMarkers });
})(window);
