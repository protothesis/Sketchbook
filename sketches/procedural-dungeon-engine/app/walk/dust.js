// Walk mode: dusting (notes/dusting-2026-10-27.md). Rooms gather dust by
// their mood (DP.dust, play-rules.js): a thin light-grey plane a little
// above the floor or a low block's top, in a scaled-up pixel dither whose
// density is how many layers are left. The feather duster, always in your
// bag, swipes it (F; one press, one swing): each swing takes a layer off
// every dusted half-cell in an arc in front of you, kicks up chunky dust
// clouds that break down into motes catching the light, and now and then
// throws out entropy chits. Walk through chits (they drift to you over a
// short range) and they fill the pre-pool; a full pre-pool (DUST.perShard
// chits) pours a shard into your lamp, and that's the gain that holds the
// burn (lamp.js), not each chit.
//
// Most shards in a dusty room lie crusted over: a dull crystal half sunk in
// dust, with a glint when your lamp's light reaches it. RULES.crustLayers
// swipes wake it, and it rises as an ordinary shard to collect.
//
// Saved in the run: run.dust (layers taken off, per room and half-cell),
// run.crust (swipes taken off each crusted shard), run.chits (chits lying
// loose, where they lie) and run.dustPool (chits gathered toward the next
// shard; a faint leaves them in your pack, packs.js).
// Loaded right after hourglass.js (it adds the duster to W.ITEMS).
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, DP, RULES, THREE, S, UNIT, camera, renderer, scene, state, el, ITEMS } = W;

  const DUST = {
    reach: 0.75,       // cells from you to a half-cell's centre, in front
    arc: 0.3,          // the swing's width: cos of its half-angle (0.3 is about 70°)
    near: 0.32,        // cells: this close, a half-cell is hit whatever way you face
    reachUp: 0.55,     // cells above your feet a swing reaches (a one-unit block's top from the floor)
    reachDown: 0.5,    // and below them (the floor, from a block)
    swingEvery: 0.18,  // s: a press sooner than this doesn't swing again
    chit: 0.45,        // chance a layer taken off throws a chit
    chitTwo: 0.1,      // chance it throws a second
    pity: 3,           // swings in a row that hit dust and threw nothing; the next one throws one
    perShard: 6,       // chits in the pre-pool that pour a shard into your lamp
    magnet: 0.9,       // cells: chits drift to you this close
    collect: 0.28,     // cells: and are gathered this close
    gravity: 14,       // cells/s²
    launch: 1.3,       // cells/s: how hard a chit flies out
    lift: 2.6,         // cells/s: and up
    bounce: 0.35,
    puffs: 5,          // cloud puffs per half-cell a swing clears a layer from
    cloudLife: 2.2,    // s
    cloudSize: 0.42,   // cells across, at first
    cloudGrow: 1.9,    // times that, at the end
    motes: 2,          // motes each puff breaks down into
    moteLife: 9,       // s
    moteSize: 0.035,   // cells
    cover: 0.82,       // how much of a half-cell three layers cover (the dither's density)
    pixels: 7,         // dither pixels across a half-cell
    color: 0xc4c1ba,   // the dust's grey
    glintEvery: 1.7,   // s between a crusted crystal's glints, in your light
  };

  const PER_SHARD = () => 1 / RULES.shardsPerCharge;
  const run = () => state.run;
  const ckey = (c) => c.sx + ',' + c.sy + ',' + c.h;

  // ---------------------------------------------------------------------------
  // The dust plane: one instanced quad per dusted half-cell, a Lambert
  // material (so the lamp, its pool bands and the shadows fall on it), with
  // fragments thrown out in a world-space 4x4 Bayer pattern (plus a little
  // hash) against the half-cell's coverage. World-space pixels, so patches
  // meet seamlessly and read as one chunky dither.

  const dustUniforms = { uDustPix: { value: 0.5 * S / DUST.pixels } };
  const dustMat = new THREE.MeshLambertMaterial({ color: DUST.color, emissive: 0x0d0d0f });
  dustMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, dustUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aDust;\nvarying float vDust;\nvarying vec3 vDustW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
vDust = aDust;
vec4 dustW = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
dustW = instanceMatrix * dustW;
#endif
vDustW = (modelMatrix * dustW).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vDust;
varying vec3 vDustW;
uniform float uDustPix;
float dustBayer(vec2 p) {
  int i = int(mod(p.x, 4.0)) + int(mod(p.y, 4.0)) * 4;
  float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
  return (m[i] + 0.5) / 16.0;
}
float dustHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
vec2 dustG = floor(vDustW.xz / uDustPix);
if (dustBayer(dustG) * 0.72 + dustHash(dustG) * 0.28 >= vDust) discard;`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 0.84 + 0.3 * dustHash(dustG + 7.0);');
  };
  dustMat.customProgramCacheKey = () => 'dust';
  const quadGeo = new THREE.PlaneGeometry(0.5 * S, 0.5 * S).rotateX(-Math.PI / 2);

  /** How much of a half-cell `n` layers cover (n eases between whole layers as one comes off). */
  const coverage = (n) => (n <= 1 ? n * 0.38 : 0.38 + (n - 1) * 0.22) * DUST.cover / 0.82;

  // ---------------------------------------------------------------------------
  // Rooms: what's built. dustRooms: spaceId -> { key, spaceId, mesh, attr,
  // cells, crystals, tile }. dustAt: "sx,sy" -> [cell] across built rooms.

  const dustRooms = new Map();
  const dustAt = new Map();
  const builtKeys = new Set();  // "spaceId:seed" of built rooms (their chits are live)
  const crusted = new Map();    // item key -> crystal, for crystals still crusted over
  const easing = new Set();     // cells whose shown layers are catching up

  /** Add a space's dust and crusted crystals. Called from buildSpace, before its loot. */
  function addDust(space, rec, tileAt) {
    const r = run();
    r.dust = r.dust || {};
    r.crust = r.crust || {};
    r.chits = r.chits || [];
    const key = space.id + ':' + space.seed;
    // Chits left in an older room by this id (rerolled since) go with it.
    r.chits = r.chits.filter((c) => c.s === key || c.s.slice(0, c.s.indexOf(':') + 1) !== space.id + ':');
    builtKeys.add(key);
    const d = DP.dust(space);
    const taken = r.dust[key] || {};
    const cells = d.cells.map((c) => {
      const left = Math.max(0, c.layers - (taken[ckey(c)] || 0));
      return Object.assign({}, c, { key, left, shown: left });
    });
    const room = { key, spaceId: space.id, cells, crystals: [], mesh: null, attr: null };
    if (cells.length) {
      const geom = quadGeo.clone();
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(cells.length), 1);
      geom.setAttribute('aDust', attr);
      const mesh = new THREE.InstancedMesh(geom, dustMat, cells.length);
      const m = new THREE.Matrix4();
      cells.forEach((c, i) => {
        Object.assign(c, { i, room, top: c.h * UNIT });
        m.makeTranslation((c.sx + 0.5) / 2 * S, c.top * S + 0.014, (c.sy + 0.5) / 2 * S);
        mesh.setMatrixAt(i, m);
        attr.array[i] = coverage(c.left);
        const at = c.sx + ',' + c.sy;
        dustAt.set(at, (dustAt.get(at) || []).concat(c));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false; // its bounds are the one quad's
      mesh.visible = false;       // until the room has assembled (updateDust)
      rec.group.add(mesh);
      Object.assign(room, { mesh, attr });
    }
    // Crusted crystals: shards not yet woken (or collected).
    const items = d.crust.length ? DP.loot(space) : [];
    for (const id of d.crust) {
      const item = items.find((o) => o.id === id);
      const ikey = key + ':' + id;
      if (!item || r.collected.includes(ikey) || (r.crust[ikey] || 0) >= RULES.crustLayers) continue;
      const cr = makeCrystal(item, ikey, space, tileAt[DE.key(item.cell.x, item.cell.y)]);
      rec.group.add(cr.group);
      room.crystals.push(cr);
      crusted.set(ikey, cr);
    }
    room.rec = rec;
    dustRooms.set(space.id, room);
  }

  /** A shard still crusted over (world.js leaves its pickup out). */
  const isCrusted = (itemKey) => crusted.has(itemKey);

  /** A space torn down (collapsed, rebuilt): its dust goes from the world; what's saved stays. */
  function forgetDust(id) {
    const room = dustRooms.get(id);
    if (!room) return;
    if (room.mesh) room.mesh.visible = false;
    for (const c of room.cells) {
      const at = c.sx + ',' + c.sy;
      const keep = (dustAt.get(at) || []).filter((o) => o !== c);
      if (keep.length) dustAt.set(at, keep); else dustAt.delete(at);
      easing.delete(c);
    }
    for (const cr of room.crystals) { crusted.delete(cr.ikey); cr.group.visible = false; }
    builtKeys.delete(room.key);
    dustRooms.delete(id);
  }

  // ---------------------------------------------------------------------------
  // Crusted crystals: today's shard, dull and tilted, half sunk in a crust
  // of grey lumps that come off a swipe at a time; a glint in your light.

  const crystalMat = new THREE.MeshLambertMaterial({ color: 0x6d6580, emissive: 0x0b0714 });
  const crustMat = new THREE.MeshLambertMaterial({ color: DUST.color, flatShading: true });
  const lumpGeo = new THREE.IcosahedronGeometry(0.055 * S, 0);
  const glintTex = (() => {
    const n = 64, cv = document.createElement('canvas');
    cv.width = cv.height = n;
    const g = cv.getContext('2d');
    const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, n, n);
    g.fillStyle = 'rgba(255,255,255,0.9)'; // a four-point star
    g.fillRect(n / 2 - 1, 4, 2, n - 8);
    g.fillRect(4, n / 2 - 1, n - 8, 2);
    return new THREE.CanvasTexture(g.canvas);
  })();
  const additive = (color) => new THREE.SpriteMaterial({ map: glintTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });

  function makeCrystal(item, ikey, space, tile) {
    const group = new THREE.Group();
    const x = item.cell.x + 0.5, y = item.cell.y + 0.5;
    group.position.set(x * S, 0, y * S);
    const h = parseInt(DE.hash(ikey, 'crust').slice(-6), 16);
    const gem = new THREE.Mesh(W.geo.shard, crystalMat.clone());
    gem.rotation.set(0.5 + (h % 7) * 0.08, (h % 13) * 0.5, 0.35);
    gem.position.y = 0.06 * S;
    gem.castShadow = true;
    group.add(gem);
    const lumps = [];
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2 + (h % 5);
      const lump = new THREE.Mesh(lumpGeo, crustMat);
      const rr = i === 6 ? 0 : 0.07 + ((h >> i) % 3) * 0.015;
      lump.position.set(Math.cos(a) * rr * S, (i === 6 ? 0.13 : 0.03 + ((h >> (i + 2)) % 3) * 0.025) * S, Math.sin(a) * rr * S);
      lump.scale.setScalar(0.8 + ((h >> (i + 4)) % 4) * 0.15);
      lump.rotation.set(i, i * 2, i * 3);
      lump.castShadow = true;
      group.add(lump);
      lumps.push(lump);
    }
    const glint = new THREE.Sprite(additive(0xe8dcff));
    glint.position.y = 0.16 * S;
    glint.scale.setScalar(0.001);
    group.add(glint);
    const cr = { ikey, item, space, tile, group, gem, lumps, glint, x, y, phase: (h % 100) / 100 * DUST.glintEvery };
    showCrust(cr);
    return cr;
  }
  /** Lumps for the crust that's left (all of them at full crust). */
  function showCrust(cr) {
    const left = RULES.crustLayers - (run().crust[cr.ikey] || 0);
    const k = Math.max(0, left) / Math.max(1, RULES.crustLayers);
    cr.lumps.forEach((l, i) => { l.visible = i < Math.ceil(k * cr.lumps.length); });
    cr.gem.material.emissive.setHex(k > 0.5 ? 0x0b0714 : 0x2c1a66); // the violet shows as it comes clean
  }

  /** The last swipe: the crust falls away, the shard rises out of it (an ordinary pickup now). */
  function wake(cr) {
    run().crust[cr.ikey] = RULES.crustLayers;
    crusted.delete(cr.ikey);
    const room = dustRooms.get(cr.space.id);
    if (room) room.crystals = room.crystals.filter((o) => o !== cr);
    const parent = cr.group.parent;
    cr.group.removeFromParent();
    const mesh = W.itemMesh(cr.item, cr.ikey);
    mesh.position.set(cr.x * S, 0.45 * S, cr.y * S);
    if (parent) parent.add(mesh);
    state.items.set(cr.ikey, { mesh, item: cr.item, spaceId: cr.space.id, tile: cr.tile });
    flash(cr.x, cr.y, 0.15);
    puff(cr.x, cr.y, 0.05, DUST.puffs * 2, 0.35);
    run().crystalsWoken = (run().crystalsWoken || 0) + 1;
    W.showCaption(run().crystalsWoken === 1 ? 'the crystal wakes · a shard, under all that dust' : 'the crystal wakes');
  }

  // Wake flashes: a violet bloom, quickly gone.
  const flashes = [];
  function flash(x, y, z) {
    const s = new THREE.Sprite(additive(0xc9a8ff));
    s.position.set(x * S, (z + 0.2) * S, y * S);
    scene.add(s);
    flashes.push({ s, t: 0 });
  }

  // ---------------------------------------------------------------------------
  // The swing

  /** What a swing would hit right now: { cells, crystal }. */
  function targets(p) {
    const fx = Math.sin(p.angle), fy = Math.cos(p.angle);
    const cells = [];
    const R = DUST.reach;
    const ok = (qx, qy, top) => {
      const dx = qx - p.x, dy = qy - p.y, d = Math.hypot(dx, dy);
      if (d > R + 0.18) return false;
      if (d > DUST.near && (dx * fx + dy * fy) / d < DUST.arc) return false;
      return top >= p.z - DUST.reachDown && top <= p.z + DUST.reachUp;
    };
    for (let sy = Math.floor((p.y - R) * 2) - 1; sy <= Math.floor((p.y + R) * 2) + 1; sy++) {
      for (let sx = Math.floor((p.x - R) * 2) - 1; sx <= Math.floor((p.x + R) * 2) + 1; sx++) {
        const list = dustAt.get(sx + ',' + sy);
        if (!list) continue;
        for (const c of list) {
          if (c.left <= 0 || !ok((sx + 0.5) / 2, (sy + 0.5) / 2, c.top)) continue;
          if (W.quarterReachable(sx, sy, p)) cells.push(c);
        }
      }
    }
    let crystal = null, best = Infinity;
    for (const cr of crusted.values()) {
      const d = Math.hypot(cr.x - p.x, cr.y - p.y);
      if (d < best && ok(cr.x, cr.y, 0) && W.quarterReachable(Math.floor(cr.x * 2), Math.floor(cr.y * 2), p)) { best = d; crystal = cr; }
    }
    return { cells, crystal };
  }

  let lastSwing = -9, dry = 0; // dry: swings in a row that hit dust and threw no chit
  function swing() {
    if (state.time - lastSwing < DUST.swingEvery) return;
    lastSwing = state.time;
    const p = state.player, r = run();
    const { cells, crystal } = targets(p);
    let layers = 0;
    const from = [];
    for (const c of cells) {
      c.left--;
      const t = r.dust[c.key] = r.dust[c.key] || {};
      t[ckey(c)] = (t[ckey(c)] || 0) + 1;
      easing.add(c);
      layers++;
      const qx = (c.sx + 0.5) / 2, qy = (c.sy + 0.5) / 2;
      from.push({ x: qx, y: qy, z: c.top, s: c.key });
      puff(qx, qy, c.top + 0.02, Math.round(DUST.puffs * (0.6 + 0.4 * (c.left + 1) / 3)), 0.12);
    }
    if (crystal) {
      r.crust[crystal.ikey] = (r.crust[crystal.ikey] || 0) + 1;
      puff(crystal.x, crystal.y, 0.08, DUST.puffs + 2, 0.15);
      if (r.crust[crystal.ikey] >= RULES.crustLayers) wake(crystal);
      else {
        showCrust(crystal);
        if (!r.crustHinted) { r.crustHinted = true; W.showCaption('something hard under the dust · keep at it'); }
      }
    }
    if (!layers) return;
    if (!r.dustHinted) { r.dustHinted = true; W.showCaption('the dust lifts · now and then a chit of entropy flies out of it'); }
    r.dusted = (r.dusted || 0) + layers;
    // Chits: a chance per layer, and never too many dry swings in a row.
    let n = 0;
    for (let i = 0; i < layers; i++) {
      if (Math.random() < DUST.chit) n++;
      if (Math.random() < DUST.chitTwo) n++;
    }
    if (n) dry = 0;
    else if (++dry > DUST.pity) { n = 1; dry = 0; }
    for (let i = 0; i < n; i++) throwChit(from[Math.floor(Math.random() * from.length)], p);
  }

  // ---------------------------------------------------------------------------
  // Chits: run.chits holds every loose chit as { x, y, z, s } (its room's
  // key), and is the truth: the ones in built rooms move and draw. Their
  // motion lives beside them, unsaved (a chit loaded mid-flight just falls).

  const motion = new WeakMap();
  function throwChit(o, p) {
    const a = Math.atan2(o.x - p.x, o.y - p.y) + (Math.random() - 0.5) * 2.4;
    const sp = DUST.launch * (0.5 + Math.random() * 0.7);
    const c = { x: o.x, y: o.y, z: o.z + 0.04, s: o.s };
    run().chits.push(c);
    motion.set(c, { vx: Math.sin(a) * sp, vy: Math.cos(a) * sp, vz: DUST.lift * (0.7 + Math.random() * 0.5), rest: false, born: state.time });
  }

  /** The height you'd stand at on (x, y): the floor, or the top of a block there. */
  function groundAt(x, y) {
    let g = 0;
    for (const b of state.blockAt.get(DE.key(Math.floor(x), Math.floor(y))) || []) {
      if (b.carried || b.jar || b.top == null) continue;
      if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1) g = Math.max(g, b.top);
    }
    return g;
  }

  /** Can the pre-pool take a chit? Not when it's full and your lamp has no room for its shard. */
  const poolTakes = () => (run().dustPool || 0) < DUST.perShard || W.lampRoom() >= PER_SHARD() - 1e-6;

  function gather(c) {
    const r = run();
    r.chits.splice(r.chits.indexOf(c), 1);
    r.dustPool = (r.dustPool || 0) + 1;
    r.chitsFound = (r.chitsFound || 0) + 1;
    pourIfFull();
    poolHud(true);
  }

  /** A full pre-pool pours a shard into your lamp, if it has room. */
  function pourIfFull() {
    const r = run();
    if ((r.dustPool || 0) < DUST.perShard || W.lampRoom() < PER_SHARD() - 1e-6) return;
    r.dustPool -= DUST.perShard;
    r.dustShards = (r.dustShards || 0) + 1;
    W.gainFuel(PER_SHARD());
    poured = state.time;
  }

  /** Chits coming back to the pre-pool (a pack taken back). */
  function addToPool(n) {
    if (!(n > 0)) return;
    run().dustPool = (run().dustPool || 0) + n;
    pourIfFull();
    poolHud(true);
  }

  function updateChits(dt) {
    const p = state.player, chits = run().chits;
    const takes = poolTakes();
    for (let i = chits.length - 1; i >= 0; i--) {
      const c = chits[i];
      if (!builtKeys.has(c.s)) continue;
      let m = motion.get(c);
      if (!m) { m = { vx: 0, vy: 0, vz: 0, rest: false, born: -9 }; motion.set(c, m); }
      const d = Math.hypot(p.x - c.x, p.y - c.y), dz = p.z + 0.25 - c.z;
      const old = state.time - m.born > 0.35; // just thrown: let it fly first
      if (takes && old && d < DUST.magnet && Math.abs(dz) < 0.8 &&
          W.quarterReachable(Math.floor(c.x * 2), Math.floor(c.y * 2), p)) {
        const k = Math.min(1, dt * (3 + 12 * (1 - d / DUST.magnet)));
        c.x += (p.x - c.x) * k;
        c.y += (p.y - c.y) * k;
        c.z += dz * k;
        m.rest = false;
        m.vx = m.vy = m.vz = 0;
        if (Math.hypot(p.x - c.x, p.y - c.y) < DUST.collect) gather(c);
        continue;
      }
      if (m.rest) {
        const g = groundAt(c.x, c.y);
        if (g > c.z + 0.01) c.z = g; // a block slid under it
        continue;
      }
      m.vz -= DUST.gravity * dt;
      let nx = c.x + m.vx * dt, ny = c.y + m.vy * dt;
      const cx = Math.floor(c.x), cy = Math.floor(c.y);
      if (Math.floor(nx) !== cx && !W.passable(cx, cy, Math.floor(nx), cy)) { m.vx = -m.vx * 0.5; nx = c.x; }
      if (Math.floor(ny) !== cy && !W.passable(cx, cy, cx, Math.floor(ny))) { m.vy = -m.vy * 0.5; ny = c.y; }
      if (groundAt(nx, ny) > c.z + 0.02) { m.vx *= -0.4; m.vy *= -0.4; nx = c.x; ny = c.y; } // a block's side
      c.x = nx;
      c.y = ny;
      c.z += m.vz * dt;
      const g = groundAt(c.x, c.y);
      if (c.z <= g) {
        c.z = g;
        if (m.vz < -1) { m.vz = -m.vz * DUST.bounce; m.vx *= 0.55; m.vy *= 0.55; }
        else {
          m.rest = true;
          c.x = +c.x.toFixed(3); c.y = +c.y.toFixed(3); c.z = +c.z.toFixed(3);
        }
      }
    }
  }

  // Drawn as points: little violet diamonds that brighten as you come near.
  const MAX_CHITS = 400;
  const chitGeo = new THREE.BufferGeometry();
  chitGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_CHITS * 3), 3));
  chitGeo.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(MAX_CHITS), 1));
  const sizing = { uScale: { value: 400 }, uTime: { value: 0 } };
  const chitMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({ uColor: { value: new THREE.Color(0xc4a6ff) } }, sizing),
    vertexShader: `
uniform float uScale;
attribute float aGlow;
varying float vGlow;
void main() {
  vGlow = aGlow;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(3.0, ${(0.075 * S).toFixed(3)} * (0.8 + 0.35 * aGlow) * uScale / -mv.z);
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `
uniform vec3 uColor;
varying float vGlow;
void main() {
  vec2 q = abs(gl_PointCoord - 0.5);
  float d = q.x + q.y;
  if (d > 0.5) discard;
  float a = d < 0.22 ? 1.0 : 0.45;
  gl_FragColor = vec4(uColor * a * (0.7 + 0.5 * vGlow), a);
}`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const chitPoints = new THREE.Points(chitGeo, chitMat);
  chitPoints.frustumCulled = false;
  chitPoints.renderOrder = 5;
  scene.add(chitPoints);

  function drawChits() {
    const p = state.player, pos = chitGeo.attributes.position.array, glow = chitGeo.attributes.aGlow.array;
    let n = 0;
    for (const c of run().chits) {
      if (n >= MAX_CHITS || !builtKeys.has(c.s)) continue;
      const m = motion.get(c);
      const bob = m && m.rest ? 0.03 + 0.015 * Math.sin(state.time * 3 + c.x * 7) : 0.02;
      pos[n * 3] = c.x * S;
      pos[n * 3 + 1] = (c.z + bob) * S;
      pos[n * 3 + 2] = c.y * S;
      const near = Math.max(0, 1 - Math.hypot(p.x - c.x, p.y - c.y) / 1.6);
      glow[n] = near * 1.6 + 0.35 * Math.max(0, Math.sin(state.time * 2.2 + c.y * 11)) ** 8;
      n++;
    }
    chitGeo.setDrawRange(0, n);
    chitGeo.attributes.position.needsUpdate = true;
    chitGeo.attributes.aGlow.needsUpdate = true;
  }

  // ---------------------------------------------------------------------------
  // Clouds and motes: chunky dithered puffs that grow, rise a little and
  // thin out, then break down into motes that drift and hang around,
  // brighter where light falls on them. All in one point cloud, its pixels
  // thrown out in a screen-space Bayer pattern (per particle, offset) against
  // their alpha, so they need no sorting.

  const MAX_PARTS = 900;
  const parts = [];
  const partGeo = new THREE.BufferGeometry();
  partGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PARTS * 3), 3));
  partGeo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(MAX_PARTS), 1));
  partGeo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(MAX_PARTS), 1));
  partGeo.setAttribute('aLight', new THREE.BufferAttribute(new Float32Array(MAX_PARTS), 1));
  partGeo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(MAX_PARTS), 1));
  const partMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({ uColor: { value: new THREE.Color(DUST.color) }, uWarm: { value: new THREE.Color(0xffc27a) }, uPx: { value: 2 } }, sizing),
    vertexShader: `
uniform float uScale;
attribute float aSize;
attribute float aAlpha;
attribute float aLight;
attribute float aSeed;
varying float vAlpha;
varying float vLight;
varying float vSeed;
varying float vMote;
void main() {
  vAlpha = aAlpha; vLight = aLight; vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float px = aSize * uScale / -mv.z;
  vMote = px < 6.0 ? 1.0 : 0.0;
  gl_PointSize = max(2.0, px);
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `
uniform vec3 uColor;
uniform vec3 uWarm;
uniform float uPx;
varying float vAlpha;
varying float vLight;
varying float vSeed;
varying float vMote;
float bayer4(vec2 p) {
  int i = int(mod(p.x, 4.0)) + int(mod(p.y, 4.0)) * 4;
  float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
  return (m[i] + 0.5) / 16.0;
}
void main() {
  float a = vAlpha;
  if (vMote < 0.5) {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    a *= 1.0 - smoothstep(0.35, 1.0, r);
    vec2 g = floor(gl_FragCoord.xy / uPx) + floor(vSeed * vec2(7.0, 3.0));
    if (bayer4(g) >= a) discard;
  } else if (a < 0.5) discard;
  gl_FragColor = vec4(uColor * (0.08 + vLight) + uWarm * vLight * 0.18, 1.0);
}`,
    depthWrite: false,
  });
  const partPoints = new THREE.Points(partGeo, partMat);
  partPoints.frustumCulled = false;
  partPoints.renderOrder = 4;
  scene.add(partPoints);

  /** A puff of `n` cloud particles at (x, y, z), spread about `r` cells. */
  function puff(x, y, z, n, r) {
    for (let i = 0; i < n; i++) {
      if (parts.length >= MAX_PARTS) parts.shift();
      const a = Math.random() * Math.PI * 2, rr = Math.random() * r;
      const s0 = DUST.cloudSize * (0.55 + Math.random() * 0.6);
      parts.push({
        mote: false, x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr, z: z + Math.random() * 0.08,
        vx: Math.cos(a) * (0.15 + Math.random() * 0.3), vy: Math.sin(a) * (0.15 + Math.random() * 0.3), vz: 0.12 + Math.random() * 0.3,
        age: 0, life: DUST.cloudLife * (0.7 + Math.random() * 0.6), s0, s1: s0 * DUST.cloudGrow, a0: 0.7 + Math.random() * 0.25, seed: Math.random(),
      });
    }
  }
  function mote(x, y, z) {
    if (parts.length >= MAX_PARTS) parts.shift();
    parts.push({
      mote: true, x, y, z, vx: (Math.random() - 0.5) * 0.1, vy: (Math.random() - 0.5) * 0.1, vz: (Math.random() - 0.3) * 0.06,
      age: 0, life: DUST.moteLife * (0.6 + Math.random() * 0.8), s0: DUST.moteSize * (0.7 + Math.random() * 0.6), a0: 1, seed: Math.random(),
    });
  }

  /** How much light falls on (x, y): your lamp's pool, and any entropy light's. 0 in the dark. */
  let lightsNow = [];
  function lightAt(x, y) {
    let b = 0;
    const lp = W.light.lampPool();
    if (lp && lp.r > 0 && state.run.lampOn) {
      const d = Math.hypot(x - lp.x, y - lp.y);
      b = d < lp.r ? 1 - 0.55 * d / lp.r : Math.max(0, 0.3 * (1 - (d - lp.r) / 1.2));
    }
    for (const o of lightsNow) {
      const pl = o.pool;
      if (!pl || !(pl.r > 0)) continue;
      const d = Math.hypot(x - pl.x, y - pl.y);
      if (d < pl.r) b = Math.max(b, 0.85 * (1 - 0.5 * d / pl.r));
    }
    return b;
  }

  function updateParts(dt) {
    lightsNow = W.light.entropyLights();
    const pos = partGeo.attributes.position.array, size = partGeo.attributes.aSize.array;
    const alpha = partGeo.attributes.aAlpha.array, light = partGeo.attributes.aLight.array, seed = partGeo.attributes.aSeed.array;
    let n = 0;
    for (let i = 0; i < parts.length; i++) {
      const q = parts[i];
      q.age += dt;
      if (q.age >= q.life) {
        if (!q.mote) for (let k = 0; k < DUST.motes; k++) mote(q.x + (Math.random() - 0.5) * 0.2, q.y + (Math.random() - 0.5) * 0.2, q.z + Math.random() * 0.15);
        parts.splice(i--, 1);
        continue;
      }
      const k = q.age / q.life;
      if (q.mote) { // a slow drift, wandering
        q.vx += (Math.random() - 0.5) * 0.25 * dt;
        q.vy += (Math.random() - 0.5) * 0.25 * dt;
        q.vz += ((Math.random() - 0.5) * 0.2 - 0.01) * dt;
      } else {
        const damp = Math.exp(-dt * 2.2);
        q.vx *= damp; q.vy *= damp; q.vz *= damp;
      }
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.z = Math.max(0.02, q.z + q.vz * dt);
      pos[n * 3] = q.x * S;
      pos[n * 3 + 1] = q.z * S;
      pos[n * 3 + 2] = q.y * S;
      const lit = lightAt(q.x, q.y);
      if (q.mote) {
        size[n] = q.s0 * S;
        // Fades in and out by going dark; catching the light, it twinkles.
        alpha[n] = k < 0.95 ? 1 : 0;
        light[n] = lit * (0.7 + 0.6 * Math.max(0, Math.sin(state.time * 3 + q.seed * 40))) * Math.min(1, k * 6) * Math.min(1, (1 - k) * 4);
      } else {
        size[n] = (q.s0 + (q.s1 - q.s0) * (1 - Math.pow(1 - k, 2))) * S;
        alpha[n] = q.a0 * Math.pow(1 - k, 1.3);
        light[n] = lit;
      }
      seed[n] = q.seed;
      n++;
    }
    partGeo.setDrawRange(0, n);
    for (const a of ['position', 'aSize', 'aAlpha', 'aLight', 'aSeed']) partGeo.attributes[a].needsUpdate = true;
  }

  // ---------------------------------------------------------------------------
  // The pre-pool on the HUD: a row of pips under the lamp's meter, one per
  // chit toward the next shard. It flashes as it pours into the lamp.

  let poolEl = null, poolSig = '', poured = -9;
  function poolHud(force) {
    if (!poolEl) {
      const meter = W.$('lamp-meter');
      if (!meter) return;
      poolEl = el('div', 'dust-pool');
      meter.after(poolEl);
    }
    const r = run(), have = Math.min(r.dustPool || 0, DUST.perShard);
    const pouring = state.time - poured < 0.6;
    const sig = have + '|' + DUST.perShard + '|' + pouring + '|' + !!r.chitsFound;
    if (sig === poolSig && !force) return;
    poolSig = sig;
    poolEl.hidden = !r.chitsFound && !(r.dustPool > 0);
    poolEl.classList.toggle('pour', pouring);
    poolEl.classList.toggle('full', have >= DUST.perShard);
    if (poolEl.children.length !== DUST.perShard) {
      poolEl.innerHTML = '';
      for (let i = 0; i < DUST.perShard; i++) poolEl.append(el('i'));
    }
    Array.from(poolEl.children).forEach((pip, i) => pip.classList.toggle('on', i < have));
    poolEl.title = `dust gathered: ${have} of ${DUST.perShard} chits · a full row pours a shard into your lamp` +
      (have >= DUST.perShard ? ' (when it has room)' : '');
  }

  // ---------------------------------------------------------------------------
  // Each frame

  const tmpSize = new THREE.Vector2();
  function updateDust(dt) {
    if (!state.run) return;
    renderer.getDrawingBufferSize(tmpSize);
    sizing.uScale.value = tmpSize.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    sizing.uTime.value = state.time;
    partMat.uniforms.uPx.value = Math.max(2, Math.round(2 * renderer.getPixelRatio()));
    // Rooms show their dust once they've assembled.
    for (const room of dustRooms.values()) {
      const rec = room.rec;
      const ready = !rec || rec.revealStart === null || state.time - rec.revealStart > 1;
      if (room.mesh) room.mesh.visible = ready;
      for (const cr of room.crystals) cr.group.scale.setScalar(Math.max(0.001, cr.tile ? cr.tile.scale.x : 1));
    }
    // A layer coming off thins the dither over a moment, not at once.
    for (const c of easing) {
      c.shown = Math.max(c.left, c.shown - dt * 5);
      c.room.attr.array[c.i] = coverage(c.shown);
      c.room.attr.needsUpdate = true;
      if (c.shown <= c.left) easing.delete(c);
    }
    // Crystals glint, now and then, where your light reaches them.
    const lp = W.light.lampPool();
    for (const cr of crusted.values()) {
      const lit = state.run.lampOn && W.light.litBy(lp, cr.x, cr.y, 0.15);
      const t = ((state.time + cr.phase) % DUST.glintEvery) / DUST.glintEvery;
      const g = lit ? Math.max(0, Math.sin(t * Math.PI * 2)) ** 14 : 0;
      cr.glint.scale.setScalar(Math.max(0.001, g * 0.42 * S));
      cr.glint.material.opacity = g;
    }
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      f.t += dt;
      const k = f.t / 0.7;
      if (k >= 1) { scene.remove(f.s); flashes.splice(i, 1); continue; }
      f.s.scale.setScalar((0.3 + 1.6 * k) * S);
      f.s.material.opacity = 1 - k;
    }
    if (!state.paused) updateChits(dt);
    pourIfFull(); // the lamp may have made room since
    drawChits();
    updateParts(dt);
    poolHud();
  }

  // ---------------------------------------------------------------------------
  // The feather duster: always in your bag (for now), the slot after your
  // lantern. A short wooden handle and a head of pale feathers.

  const dusterGeo = {
    handle: new THREE.CylinderGeometry(0.012 * S, 0.015 * S, 0.22 * S, 6),
    band: new THREE.CylinderGeometry(0.02 * S, 0.02 * S, 0.025 * S, 8),
    feather: new THREE.ConeGeometry(0.03 * S, 0.13 * S, 5),
  };
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2e, emissive: 0x140a04 });
  const bandMat = new THREE.MeshLambertMaterial({ color: 0x8a7a5a });
  const featherMats = [0xe9dfc8, 0xcfc4b0, 0xb9ad9a].map((c) => new THREE.MeshLambertMaterial({ color: c, emissive: 0x141210 }));
  function makeDuster() {
    const g = new THREE.Group();
    const handle = new THREE.Mesh(dusterGeo.handle, woodMat);
    handle.position.y = 0.11 * S;
    const band = new THREE.Mesh(dusterGeo.band, bandMat);
    band.position.y = 0.225 * S;
    g.add(handle, band);
    for (let i = 0; i < 9; i++) {
      const f = new THREE.Mesh(dusterGeo.feather, featherMats[i % 3]);
      const a = i / 9 * Math.PI * 2, tilt = i === 8 ? 0 : 0.55;
      f.position.set(Math.cos(a) * 0.025 * S * (i === 8 ? 0 : 1), 0.29 * S, Math.sin(a) * 0.025 * S * (i === 8 ? 0 : 1));
      f.rotation.set(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt);
      g.add(f);
    }
    return g;
  }

  const DUSTER_SVG = '<svg viewBox="0 0 16 22" width="13" height="18"><path d="M8 21 V11" stroke="#a07a52" stroke-width="1.8" stroke-linecap="round"/>' +
    '<path d="M8 11 C3 9 2 5 4 1 C6 4 7 3 8 1 C9 3 10 4 12 1 C14 5 13 9 8 11 Z" fill="#e3d8c2"/></svg>';

  ITEMS.duster = {
    cls: 'equipment',
    first: true, // its slot comes right after the lantern's (items.js slots)
    mesh: makeDuster,
    slot: () => ({ key: 'duster', kind: 'duster', sig: 'duster', item: { kind: 'duster' } }),
    title: () => 'feather duster: F swipes it · dust comes off a layer a swipe, and now and then a chit of entropy with it',
    icon() {
      const ic = el('span', 'ic');
      ic.innerHTML = DUSTER_SVG;
      return ic;
    },
    /** F always swings it; the prompt shows only with something in reach. */
    use(p, slot) {
      const t = targets(p);
      const line = t.crystal ? { cls: 'jar', text: 'dust the crystal off' } : t.cells.length ? { cls: 'jar', text: 'dust' } : null;
      return { action: 'dust', slot, line };
    },
    act: () => swing(),
  };

  Object.assign(W, { DUST, addDust, forgetDust, isCrusted, updateDust, addToPool });
})(window);
