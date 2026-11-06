// Walk mode: water, from a room's moisture (DE.CONDITIONS).
//
//   puddles  a damp room has the odd one, a wet room plenty: dark, glossy
//            pools flat on the floor. Walk through one and it splashes
//            (droplets and a ripple ring at your feet).
//   drips    water falls from the ceiling at fixed spots (some over a
//            puddle, so it fills), each on its own beat, and rings where
//            it lands.
//
// Where they go is seeded from the room (never on a door, a block, a
// sigil, well or waystone). The droplets, drops and rings are small shared
// pools, updated each frame near you.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, DP, THREE, S, WALL_H, scene, state } = W;

  const WATER = {
    puddles: { dry: 0, damp: 0.07, wet: 0.22 },   // chance per cell
    puddleSize: [0.14, 0.34],                    // cells: radius
    drips: { dry: 0, damp: 0.05, wet: 0.14 },     // drip spots per cell
    dripOverPuddle: 0.6,                         // share of drip spots placed over a puddle
    dripEvery: [1.6, 5],                         // s: one spot's beat (it wavers a little)
    dripReach: 9,                                // cells: drips only fall this near you
    gravity: 9,                                  // cells/s²
    splashEvery: 0.26,                           // s: between splashes while you walk through a puddle
    splashDrops: 9,                              // droplets per splash
    rippleLife: 0.9,                             // s
    rippleSize: 0.32,                            // cells: a splash's ring at its widest (a drip's is smaller)
    puddleColor: 0x16202a,
    puddleShine: 0x9fb4c8,
  };

  // ---------------------------------------------------------------------------
  // Puddles and drip spots (per room, seeded)

  const puddleMat = new THREE.MeshPhongMaterial({
    color: WATER.puddleColor, specular: WATER.puddleShine, shininess: 110, emissive: 0x04070a,
    transparent: true, opacity: 0.88, depthWrite: false,
  });

  /** An irregular flat blob of radius ~r (world units), in the xz plane. */
  function blobGeometry(r, rng) {
    const n = 14, shape = new THREE.Shape();
    const wob = [rng.range(0.8, 1.2), rng.range(0.85, 1.15)];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const k = (i === n ? 1 : rng.range(0.78, 1.12));
      const x = Math.cos(a) * r * k * wob[0], y = Math.sin(a) * r * k * wob[1];
      if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    }
    return new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
  }

  /** Where a room's water goes: { puddles: [{ x, y, r }], spots: [{ x, y }] }, in cells. */
  function waterOf(space) {
    const out = { puddles: [], spots: [] };
    const wet = DE.bandOf(space.meta && space.meta.cond, 'moisture');
    if (!WATER.puddles[wet] && !WATER.drips[wet]) return out;
    const r = DE.createRng(DE.hash('water', space.seed));
    const avoid = new Set(space.exits.map((e) => DE.key(e.cell.x, e.cell.y)));
    for (const f of [DP.sigil(space), DP.well(space), DP.waystone && DP.waystone(space), DP.saveLantern && DP.saveLantern(space)]) {
      if (f && f.cell) avoid.add(DE.key(f.cell.x, f.cell.y));
    }
    const blocks = DP.props(space).blocks;
    const blocked = (x, y, rad) => blocks.some((b) => x + rad > b.x0 && x - rad < b.x1 && y + rad > b.y0 && y - rad < b.y1);
    for (const k of space.cells.slice().sort()) {
      const c = DE.parseKey(k);
      const roll = r.next(), u = r.next(), v = r.next(), rad = r.range(WATER.puddleSize[0], WATER.puddleSize[1]);
      if (avoid.has(k) || roll >= WATER.puddles[wet]) continue;
      const x = c.x + 0.5 + (u - 0.5) * (1 - 2 * rad) * 0.9, y = c.y + 0.5 + (v - 0.5) * (1 - 2 * rad) * 0.9;
      if (!blocked(x, y, rad * 0.7)) out.puddles.push({ x, y, r: rad, cell: k });
    }
    const nSpots = Math.round(space.cells.length * WATER.drips[wet]);
    for (let i = 0; i < nSpots; i++) {
      const over = out.puddles.length && r.chance(WATER.dripOverPuddle);
      const pick = r.next(), u = r.next(), v = r.next(), beat = r.range(WATER.dripEvery[0], WATER.dripEvery[1]);
      let x, y;
      if (over) { const p = out.puddles[Math.floor(pick * out.puddles.length)]; x = p.x + (u - 0.5) * p.r; y = p.y + (v - 0.5) * p.r; }
      else { const c = DE.parseKey(space.cells[Math.floor(pick * space.cells.length)]); x = c.x + 0.15 + u * 0.7; y = c.y + 0.15 + v * 0.7; }
      if (blocked(x, y, 0.05)) continue;
      out.spots.push({ x, y, beat, t: beat * r.next() });
    }
    return out;
  }

  /** A room's puddles (on their tiles, so they assemble with them) and drip spots, into rec.water. */
  function addWater(space, rec, tileAt) {
    const w = waterOf(space);
    rec.water = w;
    rec.atmos = rec.atmos || [];
    w.puddles.forEach((p, i) => {
      const tile = tileAt[p.cell];
      if (!tile) return;
      const g = blobGeometry(p.r * S, DE.createRng(DE.hash('puddle', space.seed, String(i))));
      const m = new THREE.Mesh(g, puddleMat);
      m.position.set(p.x * S - tile.position.x, 0.055, p.y * S - tile.position.z);
      m.receiveShadow = true;
      m.renderOrder = 1;
      tile.add(m);
      rec.atmos.push(g);
    });
  }

  // ---------------------------------------------------------------------------
  // Shared pools: ripple rings, falling drops, splash droplets

  const ringGeo = new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2);
  const rings = [];
  for (let i = 0; i < 32; i++) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0xbcd4ec, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    m.visible = false;
    m.renderOrder = 3;
    scene.add(m);
    rings.push({ m, life: 0, max: 1, size: 1 });
  }
  let ringNext = 0;
  function ripple(x, y, size, bright) {
    const r = rings[ringNext++ % rings.length];
    r.m.position.set(x * S, 0.07, y * S);
    r.life = WATER.rippleLife; r.max = WATER.rippleLife; r.size = size * S; r.bright = bright;
    r.m.visible = true;
  }

  const dropGeo = new THREE.SphereGeometry(0.018 * S, 6, 4).scale(1, 2.4, 1);
  const dropMat = new THREE.MeshBasicMaterial({ color: 0xcfe2f5, transparent: true, opacity: 0.85 });
  const drops = [];
  for (let i = 0; i < 24; i++) {
    const m = new THREE.Mesh(dropGeo, dropMat);
    m.visible = false;
    scene.add(m);
    drops.push({ m, on: false, x: 0, y: 0, h: 0, vh: 0, puddle: false });
  }

  const NDROP = 120;
  const dpos = new Float32Array(NDROP * 3), dvel = new Float32Array(NDROP * 3), dlife = new Float32Array(NDROP);
  const dgeo = new THREE.BufferGeometry();
  dgeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  const droplets = new THREE.Points(dgeo, new THREE.PointsMaterial({
    color: 0xd4e6f8, size: 0.05 * S, transparent: true, opacity: 0.9, depthWrite: false,
  }));
  droplets.frustumCulled = false;
  scene.add(droplets);
  let dNext = 0;
  for (let i = 0; i < NDROP; i++) dpos[i * 3 + 1] = -100;
  function splash(x, y, n, speed) {
    for (let k = 0; k < n; k++) {
      const i = dNext++ % NDROP, a = Math.random() * Math.PI * 2, sp = speed * (0.4 + Math.random() * 0.6);
      dpos[i * 3] = x * S; dpos[i * 3 + 1] = 0.08; dpos[i * 3 + 2] = y * S;
      dvel[i * 3] = Math.cos(a) * sp * 0.5 * S; dvel[i * 3 + 1] = sp * (1 + Math.random()) * S; dvel[i * 3 + 2] = Math.sin(a) * sp * 0.5 * S;
      dlife[i] = 0.6;
    }
  }

  // ---------------------------------------------------------------------------
  // Each frame

  let lastX = null, lastY = null, splashT = 0;
  /** The puddle under (x, y), if any, in the rooms built near you. */
  function puddleAt(x, y) {
    for (const rec of state.spaces.values()) {
      if (!rec.water) continue;
      for (const p of rec.water.puddles) if (Math.hypot(x - p.x, y - p.y) < p.r * 0.95) return p;
    }
    return null;
  }

  function updateWater(dt) {
    if (!dt) return;
    const p = state.player;
    // Walking through a puddle splashes.
    const moved = lastX === null ? 0 : Math.hypot(p.x - lastX, p.y - lastY) / dt;
    lastX = p.x; lastY = p.y;
    splashT -= dt;
    if (moved > 0.4 && (p.z || 0) < 0.05 && splashT <= 0) {
      const pd = puddleAt(p.x, p.y);
      if (pd) {
        splashT = WATER.splashEvery;
        ripple(p.x, p.y, WATER.rippleSize, 1);
        splash(p.x, p.y, WATER.splashDrops, Math.min(1.6, 0.5 + moved * 0.3));
      }
    }
    // Drip spots near you let go on their beat.
    for (const rec of state.spaces.values()) {
      if (!rec.water) continue;
      for (const s of rec.water.spots) {
        s.t -= dt;
        if (s.t > 0) continue;
        s.t = s.beat * (0.8 + Math.random() * 0.4);
        if (Math.hypot(s.x - p.x, s.y - p.y) > WATER.dripReach) continue;
        const d = drops.find((o) => !o.on);
        if (!d) continue;
        Object.assign(d, { on: true, x: s.x, y: s.y, h: WALL_H * 0.98, vh: 0, puddle: !!puddleAt(s.x, s.y) });
        d.m.visible = true;
      }
    }
    for (const d of drops) {
      if (!d.on) continue;
      d.vh -= WATER.gravity * dt;
      d.h += d.vh * dt;
      if (d.h <= 0.02) {
        d.on = false; d.m.visible = false;
        ripple(d.x, d.y, WATER.rippleSize * (d.puddle ? 0.75 : 0.4), d.puddle ? 0.9 : 0.5);
        splash(d.x, d.y, d.puddle ? 3 : 2, 0.45);
        continue;
      }
      d.m.position.set(d.x * S, d.h * S, d.y * S);
    }
    for (const r of rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const t = 1 - Math.max(0, r.life) / r.max;
      const s = r.size * (0.15 + 0.85 * Math.sqrt(t));
      r.m.scale.set(s, 1, s);
      r.m.material.opacity = (1 - t) * 0.55 * r.bright;
      if (r.life <= 0) r.m.visible = false;
    }
    for (let i = 0; i < NDROP; i++) {
      if (dlife[i] <= 0) continue;
      dlife[i] -= dt;
      dvel[i * 3 + 1] -= WATER.gravity * S * dt;
      dpos[i * 3] += dvel[i * 3] * dt; dpos[i * 3 + 1] += dvel[i * 3 + 1] * dt; dpos[i * 3 + 2] += dvel[i * 3 + 2] * dt;
      if (dpos[i * 3 + 1] < 0.02 || dlife[i] <= 0) { dlife[i] = 0; dpos[i * 3 + 1] = -100; }
    }
    dgeo.attributes.position.needsUpdate = true;
  }

  Object.assign(W, { WATER, waterOf, addWater, updateWater });
})(window);
