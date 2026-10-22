// Walk mode: entropy wells (GAME-DESIGN.md, section 13). A round basin in
// the floor of about 1 room in 20. Stand in it and it pours entropy into
// your lamp, up to RULES.wellCapacity, then it's dry. Two kinds, by seed:
//
//   surge    once you stop drawing on it, it comes back all at once,
//            RULES.wellSurgeCooldown seconds later. Violet.
//   trickle  RULES.wellTrickleDelay seconds after you last drew on it, it
//            starts filling back slowly; dip in again any time. Teal.
//
// A well's level is saved as { level, drawn } in run.wells, where `drawn`
// is the walking time (run.walked) you last drew on it, so a well in a room
// you're nowhere near still refills.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, DP, RULES, THREE, S, state } = W;

  const WELL = {
    reach: 0.42,        // cells from the tile's centre: you're standing in it
    colors: { surge: 0xa070ff, trickle: 0x4fd8c4 },
    motes: 14,
  };
  const CAP = RULES.wellCapacity;

  /** A well's level right now, after any refilling since it was last drawn on. */
  function levelOf(w) {
    const rec = state.run.wells[w.key];
    if (!rec) return CAP;
    const since = state.run.walked - rec.drawn;
    if (w.kind === 'surge') return since >= RULES.wellSurgeCooldown ? CAP : rec.level;
    const fill = Math.max(0, since - RULES.wellTrickleDelay) * CAP / RULES.wellTrickleTime;
    return Math.min(CAP, rec.level + fill);
  }

  const basinMat = new THREE.MeshLambertMaterial({ color: 0x2a2730 });
  const ringGeo = new THREE.RingGeometry(0.3 * S, 0.4 * S, 32);
  const poolGeo = new THREE.CircleGeometry(0.3 * S, 32);

  /** Add a space's well (if any) to its tile. Called from buildSpace. */
  function addWell(space, tileAt) {
    const wl = DP.well(space);
    if (!wl) return;
    const tile = tileAt[DE.key(wl.cell.x, wl.cell.y)];
    if (!tile) return;
    const color = new THREE.Color(WELL.colors[wl.kind]);
    const ring = new THREE.Mesh(ringGeo, basinMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.058;
    ring.receiveShadow = true;
    const poolMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.056;
    const pos = new Float32Array(WELL.motes * 3);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const motes = new THREE.Points(pg, new THREE.PointsMaterial({
      color, size: 0.04 * S, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    tile.add(ring, pool, motes);
    const seeds = Array.from({ length: WELL.motes }, () => [Math.random(), Math.random() * Math.PI * 2, Math.random()]);
    const key = space.id + ':' + space.seed + ':well';
    const w = { key, spaceId: space.id, cell: wl.cell, kind: wl.kind, pool, poolMat, motes, seeds, phase: Math.random() * 10, drinking: false };
    state.wells = state.wells.filter((o) => o.key !== key).concat(w);
  }

  let poured = 0; // entropy drawn since the last +◆
  /** Stand in a well: it pours into your lamp. Then everyone's look. */
  function updateWells(dt) {
    const p = state.player, run = state.run;
    const frozen = state.paused || !!state.bigmap;
    for (const w of state.wells) {
      const level = levelOf(w);
      const inIt = !frozen && p.z < 0.05 && p.spaceId === w.spaceId &&
        Math.hypot(p.x - (w.cell.x + 0.5), p.y - (w.cell.y + 0.5)) < WELL.reach;
      if (inIt && !w.inIt) {
        W.showCaption(level > 0.01 ? `an entropy well (${w.kind}) · it pours into your lamp`
          : `the well is dry · ${w.kind === 'surge' ? 'it surges back after a while' : 'it trickles back, slowly'}`);
      }
      w.inIt = inIt;
      w.drinking = false;
      if (inIt && level > 0) {
        const want = Math.min(RULES.wellRate * dt, level);
        const got = W.gainFuel(want, true);
        if (got > 0) {
          w.drinking = true;
          run.wells[w.key] = { level: level - got, drawn: run.walked };
          run.wellDrawn = (run.wellDrawn || 0) + got;
          poured += got;
          if (poured >= 1 / RULES.shardsPerCharge - 1e-6) { W.popEntropy(poured); poured = 0; }
          if (level - got <= 0.001) W.showCaption(`the well runs dry · ${w.kind === 'surge' ? 'it will surge back' : 'it will trickle back'}`);
        }
      }
      // Look: the pool's brightness is its level; motes rise faster while you drink.
      const k = levelOf(w) / CAP;
      w.phase += dt;
      w.poolMat.opacity = 0.08 + 0.72 * k * (0.9 + 0.1 * Math.sin(w.phase * 2.3));
      w.pool.scale.setScalar(0.35 + 0.65 * k);
      const n = Math.round(WELL.motes * k), speed = w.drinking ? 1.4 : 0.35;
      const pos = w.motes.geometry.attributes.position.array;
      for (let i = 0; i < n; i++) {
        const [ph, ang, rr] = w.seeds[i];
        const u = (w.phase * speed * (0.6 + rr * 0.8) + ph) % 1;
        const r = 0.22 * (w.drinking ? 1 - u : 0.4 + rr * 0.6);
        pos[i * 3] = Math.cos(ang + w.phase * 0.5) * r * S;
        pos[i * 3 + 1] = 0.06 + u * (w.drinking ? 0.7 : 0.35) * S;
        pos[i * 3 + 2] = Math.sin(ang + w.phase * 0.5) * r * S;
      }
      w.motes.geometry.setDrawRange(0, n);
      w.motes.geometry.attributes.position.needsUpdate = true;
    }
    if (!state.wells.some((w) => w.drinking) && poured > 0.02) { W.popEntropy(poured); poured = 0; }
  }

  /** Is the figure drinking from a well right now? (The lamp's state line says so.) */
  const drinking = () => state.wells.some((w) => w.drinking);

  Object.assign(W, { WELL, addWell, updateWells, wellLevel: levelOf, drinking });
})(window);
