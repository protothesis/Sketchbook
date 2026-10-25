// Walk mode: entropy wells (GAME-DESIGN.md, section 13). A round basin in
// the floor of about 1 room in 20. Stand in it and it pours entropy into
// your lamp (a stream of motes runs from the pool to the lamp), up to
// RULES.wellCapacity, then it's dry. Two kinds, by seed, and each shows
// its own clock in the world, not on the HUD:
//
//   surge    violet, with a notched stone rim. Once you stop drawing on it,
//            it comes back all at once, RULES.wellSurgeCooldown seconds
//            later. The notches are the clock: they light one by one
//            through the cooldown, and when the last one lights the pool
//            surges back with a burst.
//   trickle  teal, with a smooth rim and a drip above it. After you draw on
//            it, a drop slowly forms at the drip for RULES.wellTrickleDelay
//            seconds (that's its wait); then drops fall steadily and the
//            pool grows back, a full well every RULES.wellTrickleTime
//            seconds. Full, it still drips now and then, so you can tell
//            the kind at a glance.
//
// The pool's size and brightness are its level, for both. A well's level
// is saved as { level, drawn } in run.wells, where `drawn` is the walking
// time (run.walked) you last drew on it, so a well in a room you're
// nowhere near still refills.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, DP, RULES, THREE, S, state } = W;

  const WELL = {
    reach: 0.42,        // cells from the tile's centre: you're standing in it
    colors: { surge: 0xa070ff, trickle: 0x4fd8c4 },
    motes: 14,
    notches: 8,         // surge: the clock around the rim
    dripHeight: 1.1,    // cells: where a trickle well's drop forms
    dripEvery: 0.7,     // s between drops while it refills
    dripIdle: 4,        // s between drops when it's full
    gravity: 9,         // cells/s², a falling drop
    ripple: 0.6,        // s, a drop's ripple
    burst: 0.9,         // s, a surge well coming back
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
  /** Seconds since you last drew on it (Infinity if never). */
  function sinceDrawn(w) {
    const rec = state.run.wells[w.key];
    return rec ? state.run.walked - rec.drawn : Infinity;
  }

  const basinMat = new THREE.MeshLambertMaterial({ color: 0x2a2730 });
  const ringGeo = new THREE.RingGeometry(0.3 * S, 0.4 * S, 32);
  const poolGeo = new THREE.CircleGeometry(0.3 * S, 32);
  const notchGeo = new THREE.BoxGeometry(0.07 * S, 0.035 * S, 0.06 * S);
  const dropGeo = new THREE.SphereGeometry(0.03 * S, 8, 6);
  const spoutGeo = new THREE.ConeGeometry(0.05 * S, 0.12 * S, 8);
  const rippleGeo = new THREE.RingGeometry(0.85, 1, 32);
  const add = (color, opacity) => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
  });

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
    const poolMat = add(color, 0.8);
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.056;
    const pos = new Float32Array(WELL.motes * 3);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const motes = new THREE.Points(pg, new THREE.PointsMaterial({
      color, size: 0.04 * S, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    const rippleMat = add(color, 0);
    const ripple = new THREE.Mesh(rippleGeo, rippleMat);
    ripple.rotation.x = -Math.PI / 2;
    ripple.position.y = 0.07;
    tile.add(ring, pool, motes, ripple);
    const w = {
      key: space.id + ':' + space.seed + ':well', spaceId: space.id, cell: wl.cell, kind: wl.kind, color,
      pool, poolMat, motes, ripple, rippleMat, rippleT: 9, burstT: 9, wasFull: true, drinking: false,
      seeds: Array.from({ length: WELL.motes }, () => [Math.random(), Math.random() * Math.PI * 2, Math.random()]),
      phase: Math.random() * 10,
    };
    if (wl.kind === 'surge') {
      // The clock: notches set into the rim, lit one by one through the cooldown.
      w.notches = Array.from({ length: WELL.notches }, (_, i) => {
        const a = i / WELL.notches * Math.PI * 2 - Math.PI / 2;
        const m = new THREE.Mesh(notchGeo, add(color, 0.1));
        m.position.set(Math.cos(a) * 0.35 * S, 0.075, Math.sin(a) * 0.35 * S);
        m.rotation.y = -a;
        tile.add(m);
        return m;
      });
    } else {
      // The drip: a little stone spout above the pool, and the drop forming under it.
      const spout = new THREE.Mesh(spoutGeo, basinMat);
      spout.rotation.x = Math.PI; // point down
      spout.position.y = (WELL.dripHeight + 0.08) * S;
      const drop = new THREE.Mesh(dropGeo, add(color, 0.9));
      drop.position.y = WELL.dripHeight * S;
      tile.add(spout, drop);
      Object.assign(w, { drop, grow: 0, fall: null });
    }
    state.wells = state.wells.filter((o) => o.key !== w.key).concat(w);
    w.wasFull = levelOf(w) >= CAP - 1e-6;
  }

  let poured = 0; // entropy drawn since the last +◆
  const poolWorld = new THREE.Vector3();
  /** Stand in a well: it pours into your lamp. Then everyone's look. */
  function updateWells(dt) {
    const p = state.player, run = state.run;
    const frozen = state.paused || !!state.bigmap;
    for (const w of state.wells) {
      const level = levelOf(w);
      const inIt = !frozen && p.z < 0.05 && p.spaceId === w.spaceId &&
        Math.hypot(p.x - (w.cell.x + 0.5), p.y - (w.cell.y + 0.5)) < WELL.reach;
      // An empty jar in your hands: the well waits for your swipe (F) instead.
      const jar = W.heldJar(), saving = !!(jar && !jar.holds);
      if (inIt && !w.inIt) {
        W.showCaption(saving ? 'an entropy well · swipe your jar through it (F) to fill it'
          : level > 0.01 ? 'an entropy well · it pours into your lamp'
          : `the well is dry · ${w.kind === 'surge' ? 'it surges back when the rim is lit' : 'it drips back, slowly'}`);
      }
      w.inIt = inIt;
      w.drinking = false;
      if (inIt && level > 0 && !saving) {
        const want = Math.min(RULES.wellRate * dt, level);
        const got = W.gainFuel(want, true);
        if (got > 0) {
          w.drinking = true;
          run.wells[w.key] = { level: level - got, drawn: run.walked };
          run.wellDrawn = (run.wellDrawn || 0) + got;
          poured += got;
          if (poured >= 1 / RULES.shardsPerCharge - 1e-6) { W.popEntropy(poured); poured = 0; }
          if (level - got <= 0.001) W.showCaption(`the well runs dry · ${w.kind === 'surge' ? 'watch the rim' : 'watch the drip'}`);
          poolWorld.set((w.cell.x + 0.5) * S, 0.1, (w.cell.y + 0.5) * S);
          W.feedFrom(poolWorld, w.color);
        }
      }
      animate(w, dt);
    }
    if (!state.wells.some((w) => w.drinking) && poured > 0.02) { W.popEntropy(poured); poured = 0; }
  }

  function animate(w, dt) {
    const level = levelOf(w), k = level / CAP, since = sinceDrawn(w);
    const full = level >= CAP - 1e-6;
    w.phase += dt;
    // Back to full on its own (not just now from drinking): a surge well bursts.
    if (full && !w.wasFull && w.kind === 'surge') w.burstT = 0;
    w.wasFull = full;
    w.burstT += dt;
    const burst = Math.max(0, 1 - w.burstT / WELL.burst);
    // The pool: its size and glow are its level (a burst overshoots).
    w.poolMat.opacity = 0.08 + 0.72 * k * (0.9 + 0.1 * Math.sin(w.phase * 2.3)) + 0.3 * burst;
    w.pool.scale.setScalar(0.35 + 0.65 * k + 0.25 * burst * Math.sin(burst * Math.PI));
    // Motes rise off it, faster while you drink; a burst throws them high.
    const n = Math.round(WELL.motes * Math.max(k, burst)), speed = w.drinking ? 1.4 : burst ? 2 : 0.35;
    const pos = w.motes.geometry.attributes.position.array;
    for (let i = 0; i < n; i++) {
      const [ph, ang, rr] = w.seeds[i];
      const u = (w.phase * speed * (0.6 + rr * 0.8) + ph) % 1;
      const r = 0.22 * (w.drinking ? 1 - u : 0.4 + rr * 0.6) * (1 + burst);
      pos[i * 3] = Math.cos(ang + w.phase * 0.5) * r * S;
      pos[i * 3 + 1] = 0.06 + u * (w.drinking ? 0.7 : 0.35 + burst) * S;
      pos[i * 3 + 2] = Math.sin(ang + w.phase * 0.5) * r * S;
    }
    w.motes.geometry.setDrawRange(0, n);
    w.motes.geometry.attributes.position.needsUpdate = true;

    if (w.kind === 'surge') {
      // The clock: full, all notches glow; drinking, they go out with the
      // level; recharging, they light one by one, the next one pulsing.
      const lit = full ? WELL.notches
        : w.drinking ? Math.ceil(k * WELL.notches)
          : Math.floor(Math.min(1, since / RULES.wellSurgeCooldown) * WELL.notches);
      w.notches.forEach((m, i) => {
        const next = !full && !w.drinking && i === lit;
        m.material.opacity = i < lit ? 0.85 + 0.15 * burst : next ? 0.15 + 0.35 * (0.5 + 0.5 * Math.sin(w.phase * 4)) : 0.08;
      });
    } else {
      dripAnimate(w, dt, full, since);
    }

    // A ripple: from a falling drop, or a burst.
    w.rippleT = Math.min(w.rippleT + dt, 9);
    const rk = w.burstT < WELL.burst ? w.burstT / WELL.burst : w.rippleT / WELL.ripple;
    const big = w.burstT < WELL.burst;
    w.ripple.visible = rk < 1;
    if (w.ripple.visible) {
      w.ripple.scale.setScalar((big ? 0.1 + 0.5 * rk : 0.04 + 0.22 * rk) * S);
      w.rippleMat.opacity = (big ? 0.8 : 0.6) * (1 - rk);
    }
  }

  /**
   * The trickle well's drip. Waiting out its delay, a drop forms slowly
   * under the spout (it's the clock); refilling, drops form and fall every
   * WELL.dripEvery seconds; full, every WELL.dripIdle.
   */
  function dripAnimate(w, dt, full, since) {
    const d = w.drop;
    if (w.fall) {
      w.fall.v += WELL.gravity * dt;
      w.fall.y -= w.fall.v * dt;
      d.position.y = Math.max(0.07, w.fall.y * S);
      if (w.fall.y <= 0.04) { w.fall = null; w.grow = 0; w.rippleT = 0; }
      return;
    }
    const waiting = !full && since < RULES.wellTrickleDelay;
    if (waiting) w.grow = since / RULES.wellTrickleDelay * 0.999;
    else w.grow += dt / (full ? WELL.dripIdle : WELL.dripEvery);
    d.scale.setScalar(Math.max(0.05, Math.min(1, w.grow)));
    d.position.y = WELL.dripHeight * S;
    if (w.grow >= 1) w.fall = { y: WELL.dripHeight, v: 0 };
  }

  /** The well you're standing in, or null. */
  const wellHere = () => state.wells.find((w) => w.inIt) || null;
  /** Swipe an empty jar through a full well: the jar takes its charge, and the well is dry. */
  function scoopWell(w, jar) {
    jar.holds = 'entropy';
    state.run.wells[w.key] = { level: 0, drawn: state.run.walked };
    W.showCaption(`the jar fills with entropy · ${w.kind === 'surge' ? 'watch the rim' : 'watch the drip'}`);
  }

  /** Is the figure drinking from a well right now? (The lamp's icon shimmers.) */
  const drinking = () => state.wells.some((w) => w.drinking);

  Object.assign(W, { WELL, addWell, updateWells, wellLevel: levelOf, wellHere, scoopWell, drinking });
})(window);
