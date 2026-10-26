// Walk mode: the hourglass (GAME-DESIGN.md, section 17). Part jar, part
// key: a rare find (1 room in 20, depth 3+), one per run. It holds one
// pixie, caught the way an empty jar catches one (F near it), or taken from
// a vessel of pixies; F at a vessel pours it back. Charged, it's the key to a
// path lost to a faint: F with it in hand at the path's door retraces the
// path, and spends the pixie (and the entropy). E held there rerolls it.
//
// It's equipment: always with you, kept through faints along with what's
// in it (run.equipment, the class items.js describes). The door code
// (actions.js) does the retrace, and asks canRetrace() / calls spendHourglass().
// Loaded right after items.js (it adds itself to W.ITEMS).
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { RULES, THREE, S, state, el, ITEMS, chargeText } = W;

  /** The hourglass you carry ({ holds: null | 'pixie' }), or null. */
  const hourglass = () => (state.run.equipment && state.run.equipment.hourglass) || null;

  /** Can a lost path be retraced right now (entropy aside)? A charged hourglass. */
  function canRetrace() {
    const hg = hourglass();
    return !!(hg && hg.holds === 'pixie');
  }
  /** Why not, in a few words (for prompts), or null if you can. */
  function retraceWant() {
    const hg = hourglass();
    return !hg ? 'no hourglass to find the way back' : hg.holds !== 'pixie' ? 'your hourglass is empty · catch a pixie in it' : null;
  }
  /** A retrace happened: the pixie is spent, the hourglass empty again. */
  function spendHourglass() {
    if (!canRetrace()) return false;
    hourglass().holds = null;
    return true;
  }

  // --- in the world and in your hand: two glass bulbs in a wooden frame,
  // a pixie glowing in the lower bulb when it's charged.

  const geo = {
    bulb: new THREE.ConeGeometry(0.065 * S, 0.1 * S, 14, 1, true),
    plate: new THREE.CylinderGeometry(0.08 * S, 0.08 * S, 0.02 * S, 14),
    post: new THREE.CylinderGeometry(0.008 * S, 0.008 * S, 0.22 * S, 6),
    pixie: new THREE.SphereGeometry(0.025 * S, 10, 8),
    halo: new THREE.SphereGeometry(0.05 * S, 12, 8),
  };
  const glassMat = new THREE.MeshLambertMaterial({ color: 0xc8d8e6, emissive: 0x10161c, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide });
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2e, emissive: 0x140a04 });
  const pixieMat = new THREE.MeshBasicMaterial({ color: 0xe6c8ff });
  const haloMat = new THREE.MeshBasicMaterial({ color: 0xa86bff, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });

  function makeMesh(item) {
    const g = new THREE.Group();
    const top = new THREE.Mesh(geo.bulb, glassMat), bottom = new THREE.Mesh(geo.bulb, glassMat);
    top.rotation.x = Math.PI; // tip down, meeting the lower bulb's tip
    top.position.y = 0.17 * S;
    bottom.position.y = 0.07 * S;
    const lo = new THREE.Mesh(geo.plate, woodMat), hi = new THREE.Mesh(geo.plate, woodMat);
    lo.position.y = 0.01 * S;
    hi.position.y = 0.23 * S;
    g.add(top, bottom, lo, hi);
    for (let i = 0; i < 3; i++) {
      const post = new THREE.Mesh(geo.post, woodMat), a = i / 3 * Math.PI * 2;
      post.position.set(Math.cos(a) * 0.068 * S, 0.12 * S, Math.sin(a) * 0.068 * S);
      g.add(post);
    }
    if (item.holds === 'pixie') {
      const px = new THREE.Mesh(geo.pixie, pixieMat), halo = new THREE.Mesh(geo.halo, haloMat);
      px.position.y = halo.position.y = 0.06 * S;
      g.add(px, halo);
    }
    return g;
  }

  // --- on the hotbar: an hourglass glyph, the lower bulb lit when charged.

  const icon = (on) => '<svg viewBox="0 0 16 22" width="13" height="18"><path d="M2 1h12M2 21h12" stroke="currentColor" stroke-width="1.8"/>' +
    '<path d="M3.5 2 C3.5 7 8 9 8 11 C8 13 3.5 15 3.5 20 H12.5 C12.5 15 8 13 8 11 C8 9 12.5 7 12.5 2 Z" fill="none" stroke="currentColor" stroke-width="1.3"/>' +
    (on ? '<circle cx="8" cy="16.5" r="2.6" fill="#d9b3ff"/>' : '') + '</svg>';

  ITEMS.hourglass = {
    cls: 'equipment',
    take(run) {
      run.equipment.hourglass = { holds: null };
      return `an hourglass · empty · ${W.verbF} with it near a pixie to catch one · charged, it's the key to a path lost to a faint`;
    },
    mesh: makeMesh,
    slot(run) {
      const hg = run.equipment && run.equipment.hourglass;
      if (!hg) return null;
      return { key: 'hourglass', kind: 'hourglass', sig: hg.holds || 'empty', item: { kind: 'hourglass', holds: hg.holds } };
    },
    title: (slot) => `hourglass (${slot.item.holds ? 'charged' : 'empty'}): F near a pixie catches it, F at a vessel pours it in or takes one out; charged, F at a lost path's door retraces it`,
    icon(slot) {
      const ic = el('span', 'ic' + (slot.item.holds ? ' charged' : ''));
      ic.innerHTML = icon(!!slot.item.holds);
      return ic;
    },
    /** What F does with it: retrace a lost path at its door, or the jar's catch and vessel moves, for pixies only. */
    use(p, slot) {
      const hg = hourglass();
      const door = W.doorNear(p);
      const lost = door && (door.action === 'letgo' || door.action === 'lostdoor') ? door : null;
      if (lost && hg.holds) {
        const n = lost.path.traces.length, why = W.retraceBlocked(lost);
        return why ? { action: 'retraceno', slot, why, line: { cls: 'blocked', text: `retrace your lost path · ${why}` } }
          : { action: 'retrace', slot, door: lost, line: { cls: 'collapse', text: `retrace your lost path · ${n} room${n === 1 ? '' : 's'} · ${chargeText(lost.price)} and the hourglass's pixie` } };
      }
      const v = W.vesselAhead(p);
      if (v) {
        if (hg.holds && (!v.n || (v.holds === 'pixie' && v.n < RULES.vesselCapacity))) {
          return { action: 'deposit', slot, jar: hg, vessel: v, line: { cls: 'jar', text: `pour the hourglass's pixie into the vessel (${v.n || 0}/${RULES.vesselCapacity})` } };
        }
        if (!hg.holds && v.n && v.holds === 'pixie') {
          return { action: 'withdraw', slot, jar: hg, vessel: v, line: { cls: 'jar', text: 'take a pixie out of the vessel into the hourglass' } };
        }
        const why = v.n >= RULES.vesselCapacity ? 'the vessel is full' : hg.holds ? 'the vessel holds entropy' : v.n ? 'the hourglass holds only a pixie' : 'the vessel is empty';
        return { action: 'vesselno', slot, jar: hg, vessel: v, why, line: { cls: 'blocked', text: why } };
      }
      const px = !hg.holds && W.pixieNear(p);
      if (px) return { action: 'catch', slot, jar: hg, pixie: px, line: { cls: 'jar', text: 'swipe the hourglass to catch the pixie' } };
      if (lost) return { action: 'retraceno', slot, why: W.retraceWant(), line: { cls: 'blocked', text: `retrace your lost path · ${W.retraceWant()}` } };
      return null;
    },
    act(u) {
      if (u.action === 'retrace') W.retraceThrough(u.door, !u.door.own);
      else if (u.action === 'catch') W.catchPixie(u.pixie, u.jar, 'you catch the pixie in the hourglass · now it can find a lost path');
      else if (u.action === 'deposit') W.deposit(u.jar, u.vessel, 'hourglass');
      else if (u.action === 'withdraw') W.withdraw(u.jar, u.vessel, 'hourglass');
      else W.showCaption(u.why);
    },
  };

  Object.assign(W, { canRetrace, retraceWant, spendHourglass });
})(window);
