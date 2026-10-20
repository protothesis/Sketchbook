// Walk mode: a third-person 3D client of the engine (see PLAY.md).
//
// Every unresolved exit is a closed door. Pushing one open calls expand +
// commit straight away, and the new space assembles itself outward from the
// threshold. Standing at a door you opened, you can spend entropy to close
// it and collapse everything beyond (engine reverts); reopening it rerolls.
// Game rules (loot, locks, costs) live in play-rules.js.
//
// Logic runs in grid units (1 = one cell, y = grid y); rendering scales by S
// into three.js world space, with grid y mapped to world z. Shares the map
// view's autosave, so both pages are the same expedition.
(function (global) {
  'use strict';

  const DE = global.DungeonEngine;
  const DP = global.DungeonPlay;
  const RULES = DP.RULES;
  const THREE = global.THREE;
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = 'dungeon-engine:expedition';
  const PLAYER_KEY = 'dungeon-engine:player';

  // Tunables, in cells unless noted. PLAY.md has the reasoning.
  const S = 2;              // world units per cell
  const WALL_H = 1.3;
  const WALL_T = 0.08;
  const DOOR_W = 0.6;
  const DOOR_H = 1.0;
  const JAMB = (1 - DOOR_W) / 2;
  const RADIUS = 0.22;
  const SPEED = 2.4;
  const RUN = 4.0;
  const PUSH_TIME = 0.35;   // seconds of walking into a door to open it
  const USE_RANGE = 0.6;    // E / tap reach to a door's midpoint
  const PICKUP_RANGE = 0.42;
  const DOOR_SWING = 0.6;   // seconds
  const SWING_ANGLE = THREE.MathUtils.degToRad(92);
  const REVEAL_STEP = 0.07; // seconds of delay per cell from the door
  const REVEAL_DUR = 0.45;
  const DISSOLVE_DUR = 0.7;
  const DITHER_RADIUS = 0.17; // fraction of the shorter screen side
  const CAM_OFFSET = new THREE.Vector3(0, 10.5, 7.5);
  const SEAM = 0xc4502a;    // the map view's open-doorway orange
  const LOCK_SEAM = 0x6fa8d8;
  const BG = 0x07060a;
  const LANTERN = 16;       // point-light intensity (three.js physical units)
  const LANTERN_RANGE = 13 * S;

  const OPP = DE.OPPOSITE;
  const ekey = (x, y, f) => x + ',' + y + ',' + f;

  // ---------------------------------------------------------------------------
  // three.js scaffolding

  const canvas = $('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.Fog(BG, 13, 28);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  // Barely any ambient: what the lantern can't reach stays dark.
  scene.add(new THREE.AmbientLight(0x8a90b8, 0.06));

  // Screen-door dither: wall pixels in front of the figure, inside a soft
  // circle around it on screen, are discarded in a 4x4 Bayer pattern. The
  // shadow pass uses its own material, so dithered walls still block light.
  const dither = {
    uDitherCenter: { value: new THREE.Vector2(-1e4, -1e4) },
    uDitherRadius: { value: 1 },
    uDitherDepth: { value: 0 },
  };
  const DITHER_HEAD = `
uniform vec2 uDitherCenter;
uniform float uDitherRadius;
uniform float uDitherDepth;
float ditherBayer(vec2 p) {
  int i = int(mod(p.x, 4.0)) + int(mod(p.y, 4.0)) * 4;
  float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
  return (m[i] + 0.5) / 16.0;
}`;
  const DITHER_BODY = `
if (vViewPosition.z < uDitherDepth) {
  float dd = distance(gl_FragCoord.xy, uDitherCenter) / uDitherRadius;
  float da = 0.88 * (1.0 - smoothstep(0.5, 1.0, dd));
  if (ditherBayer(gl_FragCoord.xy) < da) discard;
}`;
  function withDither(mat) {
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, dither);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + DITHER_HEAD)
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + DITHER_BODY);
    };
    mat.customProgramCacheKey = () => 'dither';
    return mat;
  }

  const geo = {
    tile: new THREE.BoxGeometry(S * 0.96, 0.1, S * 0.96),
    wall: new THREE.BoxGeometry(S, WALL_H * S, WALL_T * S),
    jamb: new THREE.BoxGeometry(JAMB * S, WALL_H * S, WALL_T * S),
    lintel: new THREE.BoxGeometry(DOOR_W * S, (WALL_H - DOOR_H) * S, WALL_T * S),
    door: new THREE.BoxGeometry(DOOR_W * S * 0.97, DOOR_H * S * 0.97, 0.05 * S),
    band: new THREE.BoxGeometry(DOOR_W * S * 0.99, 0.05 * S, 0.07 * S),
    seam: new THREE.BoxGeometry(DOOR_W * S * 0.9, 0.04, 0.2 * S),
    shard: new THREE.OctahedronGeometry(0.11 * S),
    keyRing: new THREE.TorusGeometry(0.06 * S, 0.018 * S, 6, 16),
    keyShaft: new THREE.BoxGeometry(0.17 * S, 0.035 * S, 0.035 * S),
  };
  const doorMat = withDither(new THREE.MeshLambertMaterial({ color: 0x2b211b, emissive: 0x1a0904 }));
  const doorOpenMat = withDither(new THREE.MeshLambertMaterial({ color: 0x2b211b }));
  const lockMat = withDither(new THREE.MeshLambertMaterial({ color: 0x323941, emissive: 0x08111a }));
  const bandMat = withDither(new THREE.MeshLambertMaterial({ color: 0x5d6670, emissive: 0x0c1218 }));
  const seamMat = new THREE.MeshBasicMaterial({ color: SEAM });
  const lockSeamMat = new THREE.MeshBasicMaterial({ color: LOCK_SEAM });
  const shardMat = new THREE.MeshLambertMaterial({ color: 0xb59cff, emissive: 0x2c1a66 });
  const keyMat = new THREE.MeshLambertMaterial({ color: 0xe2b84a, emissive: 0x3a2606 });

  const matCache = {};
  function spaceMats(space) {
    if (matCache[space.id] && matCache[space.id].seed === space.seed) return matCache[space.id];
    const h = space.meta.hue / 360;
    const m = {
      seed: space.seed,
      floor: [0.15, 0.17, 0.19].map((l) => new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(h, 0.22, l) })),
      wall: withDither(new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(h, 0.2, 0.32) })),
    };
    matCache[space.id] = m;
    return m;
  }

  function shadowed(mesh) { mesh.castShadow = true; mesh.receiveShadow = true; return mesh; }

  // ---------------------------------------------------------------------------
  // State

  const state = {
    exp: null,
    exitAt: new Map(),   // "x,y,f" -> { spaceId, exit }
    spaces: new Map(),   // spaceId -> { group, edges[], tiles[], revealStart|null }
    dying: [],           // collapsed space records still dissolving
    doors: new Map(),    // "spaceId/exitId" -> door
    items: new Map(),    // "spaceId:seed:itemId" -> { mesh, item, spaceId, tile }
    player: { x: 0.5, y: 0.5, angle: 0, spaceId: null, phase: 0 },
    run: null,           // inventory + run stats, see freshRun()
    push: { key: null, t: 0 },
    time: 0,
    minimap: true,
    paused: false,
  };
  const world = new THREE.Group();
  scene.add(world);

  function freshRun(rootSeed) {
    return {
      rootSeed, entropy: RULES.entropyStart, keys: 0,
      shardsFound: 0, keysFound: 0, keysUsed: 0,
      collapses: 0, roomsCollapsed: 0, entropySpent: 0,
      walked: 0, collected: [], unlocked: [],
    };
  }

  function rebuildExitIndex() {
    state.exitAt.clear();
    for (const id in state.exp.spaces) {
      for (const ex of state.exp.spaces[id].exits) {
        state.exitAt.set(ekey(ex.cell.x, ex.cell.y, ex.facing), { spaceId: id, exit: ex });
      }
    }
  }

  function ownsDoorPanel(spaceId, ex) {
    if (!ex.connectionId) return true;
    const c = state.exp.connections[ex.connectionId];
    return c.a.spaceId === spaceId && c.a.exitId === ex.id;
  }

  // ---------------------------------------------------------------------------
  // Building a space's meshes

  // Edge center in grid units, inset half a wall toward its own cell.
  function edgeFrame(x, y, f) {
    const t = WALL_T / 2;
    switch (f) {
      case 'N': return { gx: x + 0.5, gy: y + t, rot: 0, beyond: -1 };
      case 'S': return { gx: x + 0.5, gy: y + 1 - t, rot: 0, beyond: 1 };
      case 'W': return { gx: x + t, gy: y + 0.5, rot: Math.PI / 2, beyond: -1 };
      default:  return { gx: x + 1 - t, gy: y + 0.5, rot: Math.PI / 2, beyond: 1 };
    }
  }

  const itemKey = (space, item) => space.id + ':' + space.seed + ':' + item.id;

  function buildSpace(space, reveal) {
    disposeSpace(space.id);
    const exp = state.exp;
    const mats = spaceMats(space);
    const group = new THREE.Group();
    const rec = { id: space.id, group, edges: [], tiles: [], revealStart: reveal ? state.time : null };
    const entry = space.exits[0] && space.parentId ? space.exits[0].cell : DE.parseKey(space.cells[0]);
    const tileAt = {};

    for (const k of space.cells) {
      const c = DE.parseKey(k);
      const dist = Math.abs(c.x - entry.x) + Math.abs(c.y - entry.y);
      const tile = new THREE.Mesh(geo.tile, mats.floor[(c.x * 7 + c.y * 13 + 999) % 3]);
      tile.receiveShadow = true;
      tile.position.set((c.x + 0.5) * S, -0.05, (c.y + 0.5) * S);
      tile.userData.delay = dist * REVEAL_STEP;
      group.add(tile);
      rec.tiles.push(tile);
      tileAt[k] = tile;

      for (const f of DE.FACINGS) {
        const n = DE.step(c, f);
        if (exp.registry[DE.key(n.x, n.y)] === space.id) continue;
        const fr = edgeFrame(c.x, c.y, f);
        const eg = new THREE.Group();
        eg.position.set(fr.gx * S, 0, fr.gy * S);
        eg.rotation.y = fr.rot;
        const hit = state.exitAt.get(ekey(c.x, c.y, f));
        if (hit) {
          const jl = shadowed(new THREE.Mesh(geo.jamb, mats.wall));
          jl.position.set(-(0.5 - JAMB / 2) * S, WALL_H * S / 2, 0);
          const jr = shadowed(jl.clone());
          jr.position.x = -jl.position.x;
          const li = shadowed(new THREE.Mesh(geo.lintel, mats.wall));
          li.position.set(0, (DOOR_H + (WALL_H - DOOR_H) / 2) * S, 0);
          eg.add(jl, jr, li);
          if (ownsDoorPanel(space.id, hit.exit)) addDoor(eg, space, hit.exit, fr.beyond);
        } else {
          const w = shadowed(new THREE.Mesh(geo.wall, mats.wall));
          w.position.y = WALL_H * S / 2;
          eg.add(w);
        }
        eg.userData = { delay: dist * REVEAL_STEP + 0.12 };
        group.add(eg);
        rec.edges.push(eg);
      }
    }

    for (const item of DP.loot(space)) {
      const key = itemKey(space, item);
      if (state.run.collected.includes(key)) continue;
      let mesh;
      if (item.kind === 'shard') {
        mesh = new THREE.Mesh(geo.shard, shardMat);
      } else {
        mesh = new THREE.Group();
        const ring = new THREE.Mesh(geo.keyRing, keyMat);
        ring.position.x = -0.1 * S;
        const shaft = new THREE.Mesh(geo.keyShaft, keyMat);
        shaft.position.x = 0.04 * S;
        mesh.add(ring, shaft);
      }
      mesh.position.set((item.cell.x + 0.5) * S, 0.45 * S, (item.cell.y + 0.5) * S);
      group.add(mesh);
      state.items.set(key, { mesh, item, spaceId: space.id, tile: tileAt[DE.key(item.cell.x, item.cell.y)] });
    }

    world.add(group);
    state.spaces.set(space.id, rec);
    applyReveal(rec);
  }

  function addDoor(edgeGroup, space, ex, beyond) {
    const locked = !ex.connectionId && DP.isLocked(space, ex);
    const pivot = new THREE.Group();
    pivot.position.set(-DOOR_W / 2 * S, 0, 0);
    const panel = shadowed(new THREE.Mesh(geo.door, ex.connectionId ? doorOpenMat : locked ? lockMat : doorMat));
    panel.position.set(DOOR_W / 2 * S, DOOR_H * S / 2, 0);
    pivot.add(panel);
    if (locked) {
      for (const y of [0.25, 0.75]) {
        const band = new THREE.Mesh(geo.band, bandMat);
        band.position.set(DOOR_W / 2 * S, DOOR_H * S * y, 0);
        pivot.add(band);
      }
    }
    const seam = new THREE.Mesh(geo.seam, locked ? lockSeamMat : seamMat);
    seam.position.set(0, 0.02, 0);
    seam.visible = !ex.connectionId;
    edgeGroup.add(pivot, seam);
    const door = {
      key: space.id + '/' + ex.id, spaceId: space.id, exitId: ex.id, pivot, panel, seam, locked,
      openAngle: -beyond * SWING_ANGLE, t: ex.connectionId ? 1 : 0, dir: 0,
    };
    pivot.rotation.y = door.openAngle * door.t;
    state.doors.set(door.key, door);
  }

  function forgetSpace(id) {
    state.spaces.delete(id);
    for (const [k, d] of state.doors) if (d.spaceId === id) state.doors.delete(k);
    for (const [k, it] of state.items) if (it.spaceId === id) state.items.delete(k);
  }

  function disposeSpace(id) {
    const rec = state.spaces.get(id);
    if (!rec) return;
    world.remove(rec.group);
    forgetSpace(id);
  }

  /** Keep a collapsed space's meshes just long enough to sink away. */
  function dissolveSpace(id, order) {
    const rec = state.spaces.get(id);
    if (!rec) return;
    forgetSpace(id);
    rec.dieStart = state.time + order * 0.08;
    state.dying.push(rec);
  }

  function buildWorld() {
    for (const id of Array.from(state.spaces.keys())) disposeSpace(id);
    for (const rec of state.dying) world.remove(rec.group);
    state.dying = [];
    rebuildExitIndex();
    for (const id in state.exp.spaces) buildSpace(state.exp.spaces[id], false);
  }

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const revealAmount = (rec, delay) =>
    rec.revealStart === null ? 1 : easeOut(THREE.MathUtils.clamp((state.time - rec.revealStart - delay) / REVEAL_DUR, 0, 1));

  function applyReveal(rec) {
    for (const t of rec.tiles) {
      const r = Math.max(0.001, revealAmount(rec, t.userData.delay));
      t.scale.set(r, 1, r);
    }
    for (const e of rec.edges) e.scale.y = Math.max(0.001, revealAmount(rec, e.userData.delay));
    if (rec.revealStart !== null && state.time - rec.revealStart > 3) rec.revealStart = null;
  }

  function applyDissolve(rec) {
    const k = 1 - easeOut(THREE.MathUtils.clamp((state.time - rec.dieStart) / DISSOLVE_DUR, 0, 1));
    const s = Math.max(0.001, k);
    for (const e of rec.edges) e.scale.y = s;
    for (const t of rec.tiles) t.scale.set(s, 1, s);
    return k <= 0;
  }

  // ---------------------------------------------------------------------------
  // The figure

  const figure = new THREE.Group();
  const bone = new THREE.MeshLambertMaterial({ color: 0xd8d0bf, emissive: 0x3a352c });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.12 * S, 0.22 * S, 4, 10), bone);
  body.position.y = 0.23 * S;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.085 * S, 14, 10), bone);
  head.position.y = 0.55 * S;
  const lanternMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.04 * S, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffc27a }));
  lanternMesh.position.set(0.14 * S, 0.3 * S, 0.12 * S);
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.2 * S, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.01;
  const bodyRig = new THREE.Group();
  bodyRig.add(body, head, lanternMesh);
  figure.add(bodyRig, blob);
  const lantern = new THREE.PointLight(0xffb36b, LANTERN, LANTERN_RANGE, 1.7);
  lantern.position.set(0.14 * S, 0.75 * S, 0.12 * S);
  lantern.castShadow = true;
  lantern.shadow.mapSize.set(512, 512);
  lantern.shadow.camera.near = 0.1;
  lantern.shadow.camera.far = LANTERN_RANGE;
  lantern.shadow.bias = -0.004;
  figure.add(lantern);
  // A faint cool fill, south of the figure and without shadows, so the
  // camera-facing sides of nearby walls read. Short range, so it can't
  // light anything around a corner.
  const fill = new THREE.PointLight(0x8f9cc8, 3, 3.2 * S, 1.5);
  scene.add(fill);
  scene.add(figure);

  // ---------------------------------------------------------------------------
  // Collision: the player is a circle; blocking edges are line segments.

  function edgeEnds(x, y, f) {
    switch (f) {
      case 'N': return [x, y, x + 1, y];
      case 'S': return [x, y + 1, x + 1, y + 1];
      case 'W': return [x, y, x, y + 1];
      default:  return [x + 1, y, x + 1, y + 1];
    }
  }

  function edgeSegments(x, y, out) {
    const reg = state.exp.registry;
    const sid = reg[DE.key(x, y)];
    if (sid === undefined) return;
    for (const f of DE.FACINGS) {
      const n = DE.step({ x, y }, f);
      const nsid = reg[DE.key(n.x, n.y)];
      if (nsid === sid) continue;
      const [ax, ay, bx, by] = edgeEnds(x, y, f);
      let hit = state.exitAt.get(ekey(x, y, f));
      if (!hit && nsid !== undefined) {
        const back = state.exitAt.get(ekey(n.x, n.y, OPP[f]));
        if (back && back.exit.connectionId) hit = back;
      }
      if (hit && hit.exit.connectionId) {
        const dx = bx - ax, dy = by - ay;
        out.push({ ax, ay, bx: ax + dx * JAMB, by: ay + dy * JAMB });
        out.push({ ax: bx - dx * JAMB, ay: by - dy * JAMB, bx, by });
      } else {
        out.push({ ax, ay, bx, by, door: hit && hit.spaceId === sid ? hit : null, facing: f });
      }
    }
  }

  /** Push the player out of every nearby wall; returns the closed doors touched. */
  function resolveCollisions(p) {
    const segs = [];
    const cx = Math.floor(p.x), cy = Math.floor(p.y);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) edgeSegments(cx + dx, cy + dy, segs);
    const touched = [];
    for (let iter = 0; iter < 3; iter++) {
      for (const s of segs) {
        const vx = s.bx - s.ax, vy = s.by - s.ay;
        const len2 = vx * vx + vy * vy;
        const t = THREE.MathUtils.clamp(((p.x - s.ax) * vx + (p.y - s.ay) * vy) / len2, 0, 1);
        const qx = s.ax + vx * t, qy = s.ay + vy * t;
        const ddx = p.x - qx, ddy = p.y - qy;
        const d = Math.hypot(ddx, ddy);
        if (d < RADIUS && d > 1e-6) {
          p.x += (ddx / d) * (RADIUS - d);
          p.y += (ddy / d) * (RADIUS - d);
          if (s.door && iter === 0) touched.push(s);
        }
      }
    }
    return touched;
  }

  // ---------------------------------------------------------------------------
  // Doors: open, unlock, or close + collapse

  /**
   * The door in the player's own room within reach, and what can be done
   * with it: 'open' | 'locked' | 'collapse'. Loop doors and the way back
   * into a room have no action.
   */
  function doorNear(p) {
    const exp = state.exp;
    const sp = exp.spaces[exp.registry[DE.key(Math.floor(p.x), Math.floor(p.y))]];
    if (!sp) return null;
    let best = null, bestD = USE_RANGE;
    for (const ex of sp.exits) {
      const [ax, ay, bx, by] = edgeEnds(ex.cell.x, ex.cell.y, ex.facing);
      const d = Math.hypot(p.x - (ax + bx) / 2, p.y - (ay + by) / 2);
      if (d >= bestD) continue;
      let action = null, child = null;
      if (!ex.connectionId) action = DP.isLocked(sp, ex) ? 'locked' : 'open';
      else if ((child = DP.childThrough(exp, sp.id, ex))) action = 'collapse';
      if (!action) continue;
      bestD = d;
      best = { space: sp, exit: ex, action, child };
    }
    if (best && best.action === 'collapse') {
      best.price = DP.collapseCost(DP.branch(exp, best.child.id));
      best.affordable = best.price.cost <= state.run.entropy;
    }
    return best;
  }

  function act(near) {
    if (!near || state.paused) return;
    const run = state.run;
    const doorKey = near.space.id + '/' + near.exit.id;
    if (near.action === 'open') {
      openDoor(near.space.id, near.exit.id);
    } else if (near.action === 'locked') {
      if (run.unlocked.includes(doorKey)) { showComplete(near); return; }
      if (run.keys <= 0) { showCaption('locked. you need a key'); return; }
      run.keys--;
      run.keysUsed++;
      run.unlocked.push(doorKey);
      savePlayer();
      refreshHud();
      showComplete(near);
    } else if (near.action === 'collapse') {
      if (!near.affordable) {
        showCaption(`too much lies beyond: ${near.price.cost} entropy, you have ${run.entropy}`);
        return;
      }
      collapseThrough(near);
    }
  }

  function openDoor(spaceId, exitId) {
    const exp = state.exp;
    let cand;
    try {
      cand = DE.expand(exp, spaceId, exitId);
      DE.commit(exp, cand);
    } catch (e) {
      showCaption(e.message);
      return;
    }
    rebuildExitIndex();
    const door = state.doors.get(spaceId + '/' + exitId);
    if (door) {
      door.dir = 1;
      door.seam.visible = false;
      door.panel.material = doorOpenMat;
    }
    if (cand.type === 'loop') {
      buildSpace(exp.spaces[cand.targetId], false);
      showCaption('this door opens onto ' + cand.targetId + '. you have been here');
    } else {
      buildSpace(cand.space, true);
    }
    save();
    refreshHud();
  }

  /** Close an opened door and erase every space beyond it, for entropy. */
  function collapseThrough(near) {
    const exp = state.exp;
    const run = state.run;
    const spaces = DP.branch(exp, near.child.id);
    const ids = new Set(spaces.map((s) => s.id));
    // Spaces outside the branch that connect into it (loops) must rebuild:
    // their doorways become walls or unopened doors again.
    const touched = new Set();
    for (const s of spaces) {
      for (const ex of s.exits) {
        if (!ex.connectionId) continue;
        const c = exp.connections[ex.connectionId];
        for (const end of [c.a, c.b]) if (!ids.has(end.spaceId)) touched.add(end.spaceId);
      }
    }
    const loopsIntoParent = spaces.some((s) => s.exits.some((ex) => {
      if (!ex.connectionId || (s.id === near.child.id && ex.index === 0)) return false;
      const c = exp.connections[ex.connectionId];
      return c.a.spaceId === near.space.id || c.b.spaceId === near.space.id;
    }));
    if (!loopsIntoParent) touched.delete(near.space.id);

    DP.collapse(exp, near.child.id);
    run.entropy -= near.price.cost;
    run.entropySpent += near.price.cost;
    run.collapses++;
    run.roomsCollapsed += spaces.length;
    rebuildExitIndex();

    const maxDepth = spaces[0].depth;
    spaces.forEach((s) => dissolveSpace(s.id, maxDepth - s.depth));
    for (const id of touched) if (exp.spaces[id]) buildSpace(exp.spaces[id], false);
    const door = state.doors.get(near.space.id + '/' + near.exit.id);
    if (door) door.dir = -1;

    showCaption(`collapsed ${spaces.length} room${spaces.length === 1 ? '' : 's'} · −${near.price.cost} entropy`);
    save();
    savePlayer();
    refreshHud();
  }

  // ---------------------------------------------------------------------------
  // Input

  const keys = new Set();
  const stick = { active: false, id: null, ox: 0, oy: 0, vx: 0, vy: 0 };

  global.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (state.paused) {
      if (k === 'escape') hideComplete();
      return;
    }
    keys.add(k);
    if (k === 'e' || k === ' ') {
      if (!e.repeat) act(doorNear(state.player));
      e.preventDefault();
    } else if (k === 'm') {
      state.minimap = !state.minimap;
      $('minimap').classList.toggle('hidden', !state.minimap);
    } else if (k === 'n') {
      requestNewMap();
    }
    if (k.startsWith('arrow')) e.preventDefault();
  });
  global.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  global.addEventListener('blur', () => keys.clear());

  const promptEl = $('prompt');
  promptEl.addEventListener('click', (e) => { act(doorNear(state.player)); promptEl.blur(); e.preventDefault(); });

  // New map needs a second tap/press within a few seconds; window.confirm()
  // is unreliable (some embedded and in-app viewers block it silently).
  const newBtn = $('new-btn');
  let newArmedUntil = 0;
  function requestNewMap() {
    if (performance.now() < newArmedUntil) {
      newArmedUntil = 0;
      newBtn.classList.remove('armed');
      newBtn.textContent = 'New map';
      newExpedition();
      return;
    }
    newArmedUntil = performance.now() + 3000;
    newBtn.classList.add('armed');
    newBtn.textContent = 'Replace this map?';
    showCaption('press again to replace this expedition in both views');
    setTimeout(() => {
      if (performance.now() >= newArmedUntil) {
        newBtn.classList.remove('armed');
        newBtn.textContent = 'New map';
      }
    }, 3100);
  }
  newBtn.addEventListener('click', (e) => { requestNewMap(); newBtn.blur(); e.preventDefault(); });

  function newExpedition() {
    hideComplete();
    setExpedition(DE.createExpedition(DE.randomRootSeed()), null);
    showCaption('a new expedition. seed ' + state.exp.rootSeed);
  }

  const stickEl = $('stick');
  const knob = stickEl.querySelector('.knob');
  const STICK_R = 50;
  canvas.addEventListener('pointerdown', (e) => {
    if (stick.active || state.paused) return;
    stick.active = true;
    stick.id = e.pointerId;
    stick.ox = e.clientX; stick.oy = e.clientY;
    stick.vx = stick.vy = 0;
    stickEl.style.left = e.clientX + 'px';
    stickEl.style.top = e.clientY + 'px';
    knob.style.transform = '';
    stickEl.hidden = false;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!stick.active || e.pointerId !== stick.id) return;
    let dx = e.clientX - stick.ox, dy = e.clientY - stick.oy;
    const d = Math.hypot(dx, dy);
    if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d; }
    stick.vx = dx / STICK_R; stick.vy = dy / STICK_R;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  });
  const endStick = (e) => {
    if (e.pointerId !== stick.id) return;
    stick.active = false;
    stick.vx = stick.vy = 0;
    stickEl.hidden = true;
  };
  canvas.addEventListener('pointerup', endStick);
  canvas.addEventListener('pointercancel', endStick);

  function readInput() {
    if (state.paused) return { x: 0, y: 0, mag: 0 };
    let x = 0, y = 0;
    if (keys.has('w') || keys.has('arrowup')) y -= 1;
    if (keys.has('s') || keys.has('arrowdown')) y += 1;
    if (keys.has('a') || keys.has('arrowleft')) x -= 1;
    if (keys.has('d') || keys.has('arrowright')) x += 1;
    let mag = Math.hypot(x, y);
    if (mag > 0) { x /= mag; y /= mag; mag = 1; } else if (stick.active) {
      mag = Math.hypot(stick.vx, stick.vy);
      if (mag < 0.15) return { x: 0, y: 0, mag: 0 };
      x = stick.vx / mag; y = stick.vy / mag;
    }
    return { x, y, mag: Math.min(1, mag), run: keys.has('shift') || (stick.active && mag > 0.95) };
  }

  // ---------------------------------------------------------------------------
  // Per-frame update

  const camTarget = new THREE.Vector3();
  const tmpV = new THREE.Vector3();
  const tmpV2 = new THREE.Vector2();

  function update(dt) {
    const p = state.player;
    const exp = state.exp;
    const run = state.run;
    const inp = readInput();
    const prev = { x: p.x, y: p.y };
    let moving = false;

    if (inp.mag > 0) {
      const sp = (inp.run ? RUN : SPEED) * inp.mag;
      p.x += inp.x * sp * dt;
      p.y += inp.y * sp * dt;
      const target = Math.atan2(inp.x, inp.y);
      let da = target - p.angle;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      p.angle += da * Math.min(1, dt * 14);
      moving = true;
    }
    if (!state.paused) run.walked += dt;
    const touched = resolveCollisions(p);
    if (exp.registry[DE.key(Math.floor(p.x), Math.floor(p.y))] === undefined) { p.x = prev.x; p.y = prev.y; }

    // Pushing into a closed (unlocked) door for a beat opens it.
    let pushing = null;
    if (inp.mag > 0) {
      for (const s of touched) {
        const d = DE.DIRS[s.facing];
        if (d.x * inp.x + d.y * inp.y > 0.5 && !DP.isLocked(exp.spaces[s.door.spaceId], s.door.exit)) {
          pushing = s.door;
          break;
        }
      }
    }
    const pk = pushing ? pushing.spaceId + '/' + pushing.exit.id : null;
    if (pk && pk === state.push.key) state.push.t += dt;
    else { state.push.key = pk; state.push.t = 0; }
    if (pushing && state.push.t >= PUSH_TIME) {
      state.push.key = null;
      openDoor(pushing.spaceId, pushing.exit.id);
    }

    // Pick things up.
    for (const [k, it] of state.items) {
      const dx = p.x - (it.item.cell.x + 0.5), dy = p.y - (it.item.cell.y + 0.5);
      if (dx * dx + dy * dy > PICKUP_RANGE * PICKUP_RANGE) continue;
      run.collected.push(k);
      it.mesh.parent.remove(it.mesh);
      state.items.delete(k);
      if (it.item.kind === 'shard') {
        const before = run.entropy;
        run.entropy = Math.min(RULES.entropyMax, run.entropy + RULES.shardEntropy);
        run.shardsFound++;
        showCaption(run.entropy > before ? `a shard · +${run.entropy - before} entropy` : 'a shard · your entropy is full');
      } else {
        run.keys++;
        run.keysFound++;
        showCaption('a key. somewhere, a door is locked');
      }
      savePlayer();
      refreshHud();
    }

    // Entering a new space shows its log line.
    const sid = exp.registry[DE.key(Math.floor(p.x), Math.floor(p.y))];
    if (sid !== p.spaceId) {
      p.spaceId = sid;
      const sp = exp.spaces[sid];
      if (sp) {
        const kind = sp.deadEnd ? 'dead end' : sp.archetype;
        showCaption(`${sp.id} · ${kind} · ${sp.meta.mood} · depth ${sp.depth}`);
      }
    }

    updatePrompt(state.paused ? null : doorNear(p));

    // Figure
    p.phase += moving ? dt * 11 * (inp.run ? 1.4 : 1) : 0;
    figure.position.set(p.x * S, 0, p.y * S);
    figure.rotation.y = p.angle;
    fill.position.set(p.x * S, 1.0 * S, (p.y + 0.6) * S);
    bodyRig.position.y = moving ? Math.abs(Math.sin(p.phase)) * 0.05 * S : 0;
    lantern.intensity = LANTERN * (0.94 + 0.06 * Math.sin(state.time * 9.3) * Math.sin(state.time * 3.1));

    // Camera: fixed angle, smoothed follow.
    tmpV.set(p.x * S, 0.6, p.y * S);
    camTarget.lerp(tmpV, 1 - Math.exp(-dt * 7));
    camera.position.copy(camTarget).add(CAM_OFFSET);
    camera.lookAt(camTarget);
    camera.updateMatrixWorld();

    // Dither: centered on the figure on screen, for pixels nearer the camera.
    renderer.getDrawingBufferSize(tmpV2);
    tmpV.set(p.x * S, 0.35 * S, p.y * S).project(camera);
    dither.uDitherCenter.value.set((tmpV.x + 1) / 2 * tmpV2.x, (tmpV.y + 1) / 2 * tmpV2.y);
    dither.uDitherRadius.value = DITHER_RADIUS * Math.min(tmpV2.x, tmpV2.y);
    tmpV.set(p.x * S, 0.35 * S, p.y * S).applyMatrix4(camera.matrixWorldInverse);
    dither.uDitherDepth.value = -tmpV.z - 0.35 * S;

    // Doors swinging open (dir 1) or shut (dir -1).
    for (const d of state.doors.values()) {
      if (!d.dir) continue;
      d.t = THREE.MathUtils.clamp(d.t + d.dir * dt / DOOR_SWING, 0, 1);
      d.pivot.rotation.y = d.openAngle * easeOut(d.t);
      if (d.dir < 0 && d.t <= 0) {
        d.seam.visible = true;
        d.panel.material = doorMat;
      }
      if (d.t <= 0 || d.t >= 1) d.dir = 0;
    }

    // Spaces assembling or dissolving; items turning in the dark.
    for (const rec of state.spaces.values()) if (rec.revealStart !== null) applyReveal(rec);
    state.dying = state.dying.filter((rec) => {
      if (!applyDissolve(rec)) return true;
      world.remove(rec.group);
      return false;
    });
    for (const it of state.items.values()) {
      const r = it.tile ? it.tile.scale.x : 1;
      it.mesh.scale.setScalar(Math.max(0.001, r));
      it.mesh.rotation.y = state.time * 1.6;
      it.mesh.position.y = (0.45 + 0.05 * Math.sin(state.time * 2.4 + it.item.cell.x)) * S;
    }
  }

  // ---------------------------------------------------------------------------
  // HUD

  const touchUi = global.matchMedia && global.matchMedia('(hover: none)').matches;
  const verb = touchUi ? 'tap' : 'E';

  let lastPrompt = '';
  function updatePrompt(near) {
    let text = '', cls = '';
    if (near) {
      const run = state.run;
      const key = near.space.id + '/' + near.exit.id;
      if (near.action === 'open') {
        text = state.push.key ? 'opening…' : `a closed door · push, or ${verb}`;
      } else if (near.action === 'locked') {
        cls = 'lock';
        text = run.unlocked.includes(key) ? `the unlocked door · ${verb}`
          : run.keys > 0 ? `a locked door · ${verb} to unlock (1 key)` : 'a locked door · you need a key';
      } else {
        const pr = near.price;
        const rooms = `${pr.rooms} room${pr.rooms === 1 ? '' : 's'}`;
        cls = near.affordable ? 'collapse' : 'blocked';
        text = near.affordable
          ? `close & collapse ${rooms} · ${pr.cost} entropy · ${verb}`
          : `too much lies beyond · ${rooms}, ${pr.cost} entropy`;
      }
    }
    const sig = text + '|' + cls;
    if (sig === lastPrompt) return;
    lastPrompt = sig;
    promptEl.hidden = !text;
    promptEl.textContent = text;
    promptEl.className = 'prompt ' + cls;
  }

  let captionTimer = null;
  function showCaption(text) {
    const el = $('caption');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(captionTimer);
    captionTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function refreshHud() {
    const s = DE.stats(state.exp);
    const run = state.run;
    $('stats').textContent = `seed ${state.exp.rootSeed} · ${s.spaces} rooms · ${s.openExits} closed doors`;
    $('entropy-fill').style.width = (100 * run.entropy / RULES.entropyMax) + '%';
    $('entropy-num').textContent = run.entropy;
    $('keys-num').textContent = run.keys;
  }

  const mm = $('minimap');
  const mmCtx = mm.getContext('2d');
  function drawMinimap() {
    if (!state.minimap) return;
    const dpr = Math.min(global.devicePixelRatio || 1, 2);
    const w = mm.clientWidth, h = mm.clientHeight;
    if (mm.width !== Math.round(w * dpr)) { mm.width = Math.round(w * dpr); mm.height = Math.round(h * dpr); }
    const ctx = mmCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const px = w / 26; // pixels per cell
    const p = state.player;
    const ox = w / 2 - p.x * px, oy = h / 2 - p.y * px;
    const exp = state.exp;
    for (const id in exp.spaces) {
      const sp = exp.spaces[id];
      ctx.fillStyle = `hsla(${sp.meta.hue}, 18%, ${id === p.spaceId ? 46 : 30}%, 0.95)`;
      for (const k of sp.cells) {
        const c = DE.parseKey(k);
        ctx.fillRect(ox + c.x * px + 0.5, oy + c.y * px + 0.5, px - 1, px - 1);
      }
    }
    for (const id in exp.spaces) {
      const sp = exp.spaces[id];
      for (const ex of sp.exits) {
        if (ex.connectionId) continue;
        ctx.fillStyle = DP.isLocked(sp, ex) ? '#6fa8d8' : '#c4502a';
        const [ax, ay, bx, by] = edgeEnds(ex.cell.x, ex.cell.y, ex.facing);
        ctx.fillRect(ox + Math.min(ax, bx) * px - 1.5, oy + Math.min(ay, by) * px - 1.5,
          Math.abs(bx - ax) * px + 3, Math.abs(by - ay) * px + 3);
      }
    }
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-p.angle);
    ctx.fillStyle = '#f3ecdc';
    ctx.beginPath();
    ctx.moveTo(0, px * 0.55);
    ctx.lineTo(px * 0.32, -px * 0.3);
    ctx.lineTo(-px * 0.32, -px * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Level complete: the seed chain from the root to the unlocked door.

  const short = (h) => (h ? h.slice(0, 8) : '');
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function showComplete(near) {
    const exp = state.exp;
    const run = state.run;
    const s = DE.stats(exp);
    const chain = DP.seedChain(exp, near.space.id);
    const generated = exp.history.filter((ev) => ev.type === 'commit' && !ev.loop).length + 1;
    let deepest = 0;
    for (const id in exp.spaces) deepest = Math.max(deepest, exp.spaces[id].depth);

    $('done-seed').textContent = exp.rootSeed;
    const list = $('done-chain');
    list.innerHTML = '';
    for (const step of chain) {
      const li = el('li');
      li.append(el('span', 'sid', step.id));
      const formula = step.parentSeed
        ? `H(${short(step.parentSeed)} | ${step.exitIndex} | ${short(step.entropy)})`
        : `H(${exp.rootSeed} | root)`;
      li.append(el('span', 'hash', `${formula} → ${short(step.seed)}`));
      li.append(el('span', 'what', `${step.archetype} · ${step.mood}`));
      list.append(li);
    }
    const last = el('li', 'door');
    last.append(el('span', 'sid', '⟶'), el('span', 'hash', `locked door ${near.space.id}/${near.exit.id}, unlocked`));
    list.append(last);

    const mins = Math.floor(run.walked / 60), secs = Math.floor(run.walked % 60);
    const rows = [
      ['rooms standing', s.spaces], ['rooms ever opened', generated], ['loops', s.cycles],
      ['cells charted', s.cells], ['deepest', deepest], ['chain length', chain.length],
      ['shards found', run.shardsFound], ['keys found', run.keysFound], ['keys used', run.keysUsed],
      ['collapses', run.collapses], ['rooms collapsed', run.roomsCollapsed], ['entropy spent', run.entropySpent],
      ['entropy left', run.entropy], ['time walked', `${mins}:${String(secs).padStart(2, '0')}`],
    ];
    const dl = $('done-stats');
    dl.innerHTML = '';
    for (const [k, v] of rows) {
      const cell = el('div');
      cell.append(el('dt', null, k), el('dd', null, String(v)));
      dl.append(cell);
    }

    state.paused = true;
    keys.clear();
    $('done').hidden = false;
  }

  function hideComplete() {
    state.paused = false;
    $('done').hidden = true;
  }

  $('done-new').addEventListener('click', newExpedition);
  $('done-close').addEventListener('click', hideComplete);
  $('done-export').addEventListener('click', () => {
    const blob = new Blob([DE.exportRecord(state.exp)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `expedition-${state.exp.rootSeed}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // ---------------------------------------------------------------------------
  // Persistence (shared with the map view)

  function save() {
    try { localStorage.setItem(STORAGE_KEY, DE.exportRecord(state.exp)); } catch (e) { /* storage unavailable */ }
  }
  function savePlayer() {
    const p = state.player;
    try {
      localStorage.setItem(PLAYER_KEY, JSON.stringify({
        rootSeed: state.exp.rootSeed, x: p.x, y: p.y, angle: p.angle, run: state.run,
      }));
    } catch (e) { /* storage unavailable */ }
  }

  function spawnPoint(exp) {
    const cells = exp.spaces.s0.cells.map(DE.parseKey);
    const mx = cells.reduce((a, c) => a + c.x, 0) / cells.length;
    const my = cells.reduce((a, c) => a + c.y, 0) / cells.length;
    let best = cells[0], bd = Infinity;
    for (const c of cells) {
      const d = Math.hypot(c.x - mx, c.y - my);
      if (d < bd) { bd = d; best = c; }
    }
    return { x: best.x + 0.5, y: best.y + 0.5, angle: Math.PI };
  }

  function setExpedition(exp, savedPlayer) {
    state.exp = exp;
    const same = savedPlayer && savedPlayer.rootSeed === exp.rootSeed;
    state.run = same && savedPlayer.run ? Object.assign(freshRun(exp.rootSeed), savedPlayer.run) : freshRun(exp.rootSeed);
    buildWorld();
    let sp = spawnPoint(exp);
    if (same && exp.registry[DE.key(Math.floor(savedPlayer.x), Math.floor(savedPlayer.y))] !== undefined) {
      sp = savedPlayer;
    }
    Object.assign(state.player, { x: sp.x, y: sp.y, angle: sp.angle || 0, spaceId: null });
    camTarget.set(sp.x * S, 0.6, sp.y * S);
    save();
    savePlayer();
    refreshHud();
  }

  // ---------------------------------------------------------------------------
  // Boot

  function resize() {
    const w = global.innerWidth, h = global.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Pull back a little on narrow (portrait) screens so rooms still fit.
    camera.fov = w < h ? 55 : 42;
    camera.updateProjectionMatrix();
  }
  global.addEventListener('resize', resize);
  resize();

  let restored = null, savedPlayer = null;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) restored = DE.importRecord(saved).expedition;
    savedPlayer = JSON.parse(localStorage.getItem(PLAYER_KEY) || 'null');
  } catch (e) { restored = null; }
  setExpedition(restored || DE.createExpedition(DE.randomRootSeed()), savedPlayer);

  let last = performance.now();
  let saveClock = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    state.time += dt;
    update(dt);
    drawMinimap();
    renderer.render(scene, camera);
    saveClock += dt;
    if (saveClock > 1) { saveClock = 0; savePlayer(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  global.addEventListener('pagehide', savePlayer);

  // Handy from the console.
  Object.assign(DP, { state, scene, camera, renderer, openDoor, doorNear, act, showComplete });
})(window);
