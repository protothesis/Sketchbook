// Walk mode: your pack (GAME-DESIGN.md, section 17). When you faint, what
// you carried stays where you fell: your tools, your jars and your lamp's
// entropy, in a bundle with a little lantern glowing at the fuel it holds.
// Walk over it to take it all back. A pack follows its room: on a lost path
// it waits, out of reach, until you retrace the path; it dims with the path
// and goes when the path fades, or when you let the path go or reroll its
// room. The maps mark it with a flame for as long as it's there.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, THREE, S, PICKUP_RANGE, scene, state, savePlayer, chargeText } = W;

  const PENDING = new Set(['lost', 'lost-dim']);

  /**
   * Pack up what you carry, where you stand: { id, spaceId, seed, x, y, fuel,
   * keys, doorstones, jars, chalks }. It all leaves the run. Null if you
   * carried nothing.
   */
  function packUp() {
    const run = state.run, p = state.player, exp = state.exp;
    const sid = exp.registry[DE.key(Math.floor(p.x), Math.floor(p.y))];
    const sp = exp.spaces[sid];
    if (!sp) return null;
    const chalks = {};
    for (const c in run.chalks) if (run.chalks[c] > 0) chalks[c] = run.chalks[c];
    const pk = {
      id: 'pack' + (++run.packSeq), spaceId: sp.id, seed: sp.seed, x: +p.x.toFixed(3), y: +p.y.toFixed(3),
      fuel: Math.max(0, run.fuel), keys: run.keys, doorstones: run.doorstones, jars: run.jars.slice(), chalks,
      at: Math.round(run.walked),
    };
    if (pk.fuel < 0.01 && !pk.keys && !pk.doorstones && !pk.jars.length && !Object.keys(chalks).length) return null;
    run.fuel = 0;
    run.keys = 0;
    run.doorstones = 0;
    run.jars = [];
    run.chalks = {};
    state.sel = 'lantern';
    run.packs.push(pk);
    return pk;
  }

  /** Where a pack is: 'here' (its room stands), 'lost' or 'dim' (on a lost path), or null (gone). */
  function packStatus(pk) {
    const exp = state.exp, sp = exp.spaces[pk.spaceId];
    if (sp) return sp.seed === pk.seed ? 'here' : null;
    const t = (exp.traces || {})[pk.spaceId];
    if (!t || t.seed !== pk.seed || !PENDING.has(t.cause)) return null;
    return t.cause === 'lost' ? 'lost' : 'dim';
  }

  /** Drop the packs that are gone for good (their path faded or was let go). */
  function prunePacks() {
    const run = state.run;
    run.packs = run.packs.filter((pk) => packStatus(pk) !== null);
    for (const [id, m] of meshes) if (!run.packs.some((pk) => pk.id === id)) { m.group.removeFromParent(); meshes.delete(id); }
  }

  /** Packs lying in these rooms (a Set of space ids). */
  const packsIn = (ids) => state.run.packs.filter((pk) => ids.has(pk.spaceId));

  /** Rooms about to be rerolled: their packs go with them. Returns how many. */
  function dropPacksIn(ids) {
    const n = packsIn(ids).length;
    if (n) {
      state.run.packs = state.run.packs.filter((pk) => !ids.has(pk.spaceId));
      prunePacks();
    }
    return n;
  }

  // ---------------------------------------------------------------------------
  // In the world: a cloth bundle, its knot, and a little lantern

  const geo = {
    bundle: new THREE.SphereGeometry(1, 14, 10),
    knot: new THREE.SphereGeometry(0.035 * S, 8, 6),
    glass: new THREE.BoxGeometry(0.06 * S, 0.08 * S, 0.06 * S),
    cap: new THREE.ConeGeometry(0.05 * S, 0.035 * S, 4),
  };
  const clothMat = new THREE.MeshLambertMaterial({ color: 0x6b5643 });
  const ironMat = new THREE.MeshLambertMaterial({ color: 0x2a2420 });
  const glowTex = (() => {
    const n = 64, cv = document.createElement('canvas');
    cv.width = cv.height = n;
    const g = cv.getContext('2d');
    const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, n, n);
    return new THREE.CanvasTexture(cv);
  })();

  const meshes = new Map(); // pack id -> { group, glassMat, glow, tile }
  const tint = new THREE.Color();

  // The pack's lantern shines like yours would at the fuel it holds (W.lampLightAt):
  // a real light on the nearest pack, no shadows, with a pool on the floor
  // like your lamp's (light.js). A pack with next to no fuel still glows,
  // dimly, as if it held PACK_LIGHT.minFuel, so it can be found.
  const PACK_LIGHT = { minFuel: 0.5, height: 0.35 }; // charges; cells above the floor
  const packLight = new THREE.PointLight(0xffb36b, 0, 1, 2);
  scene.add(packLight);
  W.light.addPooledLight(packLight);
  let litPack = null; // { pk, pool } this frame

  function makeMesh(pk) {
    const group = new THREE.Group();
    const bundle = new THREE.Mesh(geo.bundle, clothMat);
    bundle.scale.set(0.16 * S, 0.1 * S, 0.13 * S);
    bundle.position.y = 0.09 * S;
    bundle.castShadow = bundle.receiveShadow = true;
    const knot = new THREE.Mesh(geo.knot, clothMat);
    knot.position.set(0.02 * S, 0.19 * S, 0);
    const lamp = new THREE.Group();
    lamp.position.set(0.16 * S, 0, 0.08 * S);
    W.lampColorAt(pk.fuel, tint);
    const glassMat = new THREE.MeshBasicMaterial({ color: tint.clone() });
    const glass = new THREE.Mesh(geo.glass, glassMat);
    glass.position.y = 0.04 * S;
    const cap = new THREE.Mesh(geo.cap, ironMat);
    cap.position.y = 0.0975 * S;
    cap.rotation.y = Math.PI / 4;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: tint.clone(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    glow.position.y = 0.04 * S;
    lamp.add(glass, cap, glow);
    group.add(bundle, knot, lamp);
    return { group, glassMat, glow, tile: null, fuel: -1 };
  }

  /** Each frame: packs in built rooms are in the world, glowing; walk over one to take it back. */
  function updatePacks() {
    const run = state.run, p = state.player;
    shinePack();
    for (const pk of run.packs) {
      const rec = state.spaces.get(pk.spaceId);
      const tile = rec && rec.tileAt && rec.tileAt[DE.key(Math.floor(pk.x), Math.floor(pk.y))];
      let m = meshes.get(pk.id);
      if (!tile || packStatus(pk) !== 'here') { if (m) { m.group.removeFromParent(); m.tile = null; } continue; }
      if (!m) { m = makeMesh(pk); meshes.set(pk.id, m); }
      if (m.tile !== tile) {
        tile.add(m.group);
        m.group.position.set(pk.x * S - tile.position.x, 0.05, pk.y * S - tile.position.z);
        m.tile = tile;
      }
      if (m.fuel !== pk.fuel) {
        m.fuel = pk.fuel;
        W.lampColorAt(pk.fuel, tint);
        m.glassMat.color.copy(tint);
        m.glow.material.color.copy(tint);
      }
      const k = Math.min(1, pk.fuel / 3);
      const s = (0.12 + 0.3 * k) * S * (1 + 0.08 * Math.sin(state.time * 3 + pk.x));
      m.glow.scale.set(s, s, 1);
      m.glow.material.opacity = pk.fuel > 0.01 ? 0.35 + 0.4 * k : 0;
      if (p.z <= 0.05 && Math.hypot(p.x - pk.x, p.y - pk.y) <= PICKUP_RANGE) takePack(pk);
    }
  }

  /** The real light goes to the nearest pack lying in a built room. */
  function shinePack() {
    const p = state.player;
    let best = null, bd = 14;
    for (const pk of state.run.packs) {
      const m = meshes.get(pk.id);
      if (!m || !m.tile || m.tile.scale.x < 0.5) continue;
      const d = Math.hypot(pk.x - p.x, pk.y - p.y);
      if (d < bd) { bd = d; best = pk; }
    }
    if (!best) { packLight.intensity = 0; litPack = null; return; }
    const l = W.lampLightAt(Math.max(best.fuel, PACK_LIGHT.minFuel), packLight.color);
    packLight.intensity = l.intensity;
    packLight.distance = l.distance;
    packLight.position.set(best.x * S, PACK_LIGHT.height * S, best.y * S);
    litPack = { pk: best, pool: { x: best.x, y: best.y, r: l.pool, from: { x: best.x, y: best.y, h: PACK_LIGHT.height } } };
  }
  /** The lit pack's pool (light.js), if one is lit. */
  const packPools = () => (litPack ? [litPack.pool] : []);

  /** Take a pack back: everything in it, and as much of its entropy as your lamp holds (the rest stays in it). */
  function takePack(pk) {
    const run = state.run;
    run.keys += pk.keys;
    run.doorstones += pk.doorstones;
    run.jars = run.jars.concat(pk.jars);
    for (const c in pk.chalks) run.chalks[c] = (run.chalks[c] || 0) + pk.chalks[c];
    const got = W.gainFuel(pk.fuel);
    const left = pk.fuel - got;
    Object.assign(pk, { keys: 0, doorstones: 0, jars: [], chalks: {}, fuel: left });
    if (left < 0.01) run.packs = run.packs.filter((o) => o !== pk);
    prunePacks();
    W.showCaption('you take your pack back' + (got > 0.01 ? ` · +${chargeText(got)}` : '') +
      (left >= 0.01 ? ` · your lamp is full · ${chargeText(left)} stays in it` : ''));
    savePlayer();
    W.refreshHotbar();
    W.refreshHud();
  }

  /** On the maps: a flame where each pack lies, dimmer on a dimmed path. */
  function drawPackMarks(ctx, ox, oy, px) {
    for (const pk of state.run.packs) {
      const st = packStatus(pk);
      if (!st) continue;
      const mx = ox + pk.x * px, my = oy + pk.y * px, r = Math.max(4, px * 0.34);
      const flick = 0.85 + 0.15 * Math.sin(state.time * 7 + pk.x);
      ctx.save();
      ctx.globalAlpha = st === 'dim' ? 0.5 : 1;
      ctx.shadowColor = 'rgba(255, 160, 60, 0.95)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#ffb347';
      ctx.beginPath();
      ctx.moveTo(mx, my - r * 1.5 * flick);
      ctx.bezierCurveTo(mx + r * 1.1, my - r * 0.4, mx + r * 0.8, my + r, mx, my + r);
      ctx.bezierCurveTo(mx - r * 0.8, my + r, mx - r * 1.1, my - r * 0.4, mx, my - r * 1.5 * flick);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff2c8';
      ctx.beginPath();
      ctx.ellipse(mx, my + r * 0.35, r * 0.32, r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  Object.assign(W, { PACK_LIGHT, packUp, packStatus, prunePacks, packsIn, dropPacksIn, updatePacks, drawPackMarks, packPools });
})(window);
