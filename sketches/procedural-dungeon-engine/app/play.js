// Walk mode: a third-person 3D client of the engine (see PLAY.md).
//
// Every unresolved exit is a closed door. Pushing one open calls expand +
// commit straight away, and the new space assembles itself outward from the
// threshold. Standing at a door you opened, you can spend entropy charges to close
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
  const RADIUS = 0.2;
  const SPEED = 2.4;
  const RUN = 4.0;
  const CROUCH_SPEED = 1.1; // a crawl
  const CROUCH_SCALE = 0.55; // figure height when crouched (standing is ~0.64 cells tall)
  const HIDE_RANGE = 0.2;
  const UNIT = RULES.blockUnit; // one stacked block unit, in cells
  const CLIMB_TIME = 0.42;      // seconds to step up onto a block
  const GRAVITY = 9;            // cells/s^2 when stepping off an edge   // cells between the figure and a block to count as hidden
  const PUSH_TIME = 0.35;   // seconds of walking into a door to open it
  const USE_RANGE = 0.6;    // E / tap reach to a door's midpoint
  const PICKUP_RANGE = 0.42;
  const DOOR_SWING = 0.6;   // seconds
  const SWING_ANGLE = THREE.MathUtils.degToRad(92);
  const REVEAL_STEP = 0.07; // seconds of delay per cell from the door
  const REVEAL_DUR = 0.45;
  const DISSOLVE_DUR = 0.7;
  const DITHER_RADIUS = 0.27; // fraction of the shorter screen side
  const DITHER_APPROACH = 2.5; // cells: south walls start a light dither this close
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

  // Screen-door dither on wall pixels south of the figure (between it and
  // the camera), discarded in a 4x4 Bayer pattern: fully inside a soft
  // circle around the figure on screen, and lightly across the whole wall
  // as the figure approaches it. The test uses world position, so a wall's
  // whole face clears, not just its top. The shadow pass uses its own
  // material, so dithered walls still block light.
  const dither = {
    uDitherCenter: { value: new THREE.Vector2(-1e4, -1e4) },
    uDitherRadius: { value: 1 },
    uDitherPlayer: { value: new THREE.Vector2(1e4, 1e4) }, // world x, z
  };
  const DITHER_VERT_HEAD = `
varying vec3 vDitherWorld;
varying float vDitherEW;`;
  // vDitherEW: 1 for meshes running east-west (their local x along world x).
  // Only those can stand between the camera (south) and the figure.
  const DITHER_VERT_BODY = `
vDitherWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vDitherEW = abs(normalize(modelMatrix[0].xyz).x);`;
  const DITHER_HEAD = `
varying vec3 vDitherWorld;
varying float vDitherEW;
uniform float uDitherMax;
uniform vec2 uDitherCenter;
uniform float uDitherRadius;
uniform vec2 uDitherPlayer;
float ditherBayer(vec2 p) {
  int i = int(mod(p.x, 4.0)) + int(mod(p.y, 4.0)) * 4;
  float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
  return (m[i] + 0.5) / 16.0;
}`;
  const DITHER_BODY = `
float south = vDitherWorld.z - uDitherPlayer.y;
if (vDitherEW > 0.7 && south > 0.2) {
  float dd = distance(gl_FragCoord.xy, uDitherCenter) / uDitherRadius;
  float circle = uDitherMax * (1.0 - smoothstep(0.35, 1.0, dd));
  float approach = min(uDitherMax, 0.3) * (1.0 - smoothstep(0.4, ${(DITHER_APPROACH * S).toFixed(1)}, south));
  if (ditherBayer(gl_FragCoord.xy) < max(circle, approach)) discard;
}`;
  /** `max` caps how much of the surface may dissolve (frames and doors stay readable). */
  function withDither(mat, max = 0.92) {
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, dither);
      shader.uniforms.uDitherMax = { value: max };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + DITHER_VERT_HEAD)
        .replace('#include <project_vertex>', '#include <project_vertex>\n' + DITHER_VERT_BODY);
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
  const DOOR_DITHER = 0.6, FRAME_DITHER = 0.45;
  const doorMat = withDither(new THREE.MeshLambertMaterial({ color: 0x2b211b, emissive: 0x1a0904 }), DOOR_DITHER);
  const doorOpenMat = withDither(new THREE.MeshLambertMaterial({ color: 0x2b211b }), DOOR_DITHER);
  const lockMat = withDither(new THREE.MeshLambertMaterial({ color: 0x323941, emissive: 0x08111a }), DOOR_DITHER);
  const bandMat = withDither(new THREE.MeshLambertMaterial({ color: 0x5d6670, emissive: 0x0c1218 }), DOOR_DITHER);
  const seamMat = new THREE.MeshBasicMaterial({ color: SEAM });
  const lockSeamMat = new THREE.MeshBasicMaterial({ color: LOCK_SEAM });
  const shardMat = new THREE.MeshLambertMaterial({ color: 0xb59cff, emissive: 0x2c1a66 });
  const keyMat = new THREE.MeshLambertMaterial({ color: 0xe2b84a, emissive: 0x3a2606 });
  geo.block = new THREE.BoxGeometry(1, 1, 1); // scaled per prop
  geo.post = new THREE.BoxGeometry(WALL_T * S, WALL_H * S, WALL_T * S); // inside-corner filler
  geo.decal = new THREE.PlaneGeometry(S * 0.94, S * 0.94);

  // Cracks: tiles standing on the trace of a collapsed room. A few canvas
  // variants of dark fissures with a faint violet core (the imprint shows
  // even in the dark). More trace layers under a cell, more cracks.
  function crackTexture(seed, strokes) {
    const n = 128, cv = document.createElement('canvas');
    cv.width = cv.height = n;
    const g = cv.getContext('2d');
    const r = DE.createRng(DE.hash('crack', seed));
    for (let i = 0; i < strokes; i++) {
      let x = r.range(0.15, 0.85) * n, y = r.range(0.15, 0.85) * n, a = r.range(0, Math.PI * 2);
      const pts = [[x, y]];
      for (let j = 0; j < 6; j++) {
        a += r.range(-0.9, 0.9);
        x += Math.cos(a) * n * 0.11; y += Math.sin(a) * n * 0.11;
        pts.push([x, y]);
      }
      for (const [w, col] of [[4, 'rgba(8,5,12,0.85)'], [1.3, 'rgba(176,140,255,0.75)']]) {
        g.lineWidth = w; g.strokeStyle = col; g.lineJoin = 'round';
        g.beginPath(); pts.forEach(([px, py], j) => (j ? g.lineTo(px, py) : g.moveTo(px, py))); g.stroke();
      }
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const crackMats = [0, 1, 2, 3].map((i) => [2, 4].map((strokes) => new THREE.MeshBasicMaterial({
    map: crackTexture(i + ':' + strokes, strokes), transparent: true, depthWrite: false,
  })));

  const matCache = {};
  function spaceMats(space) {
    if (matCache[space.id] && matCache[space.id].seed === space.seed) return matCache[space.id];
    const h = space.meta.hue / 360;
    const m = {
      seed: space.seed,
      floor: [0.15, 0.17, 0.19].map((l) => new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(h, 0.22, l) })),
      wall: withDither(new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(h, 0.2, 0.32) })),
      // Door frames dissolve less, so a doorway in a south wall stays readable.
      frame: withDither(new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(h, 0.22, 0.36) }), FRAME_DITHER),
      // Blocks never dissolve; the figure shows through them instead.
      block: new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(h, 0.16, 0.24) }),
      detail: [0.12, 0.21].map((l) => new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(h, 0.18, l) })),
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
    blockAt: new Map(),  // "x,y" -> [{ x0, y0, x1, y1, h, spaceId }] for collision
    player: { x: 0.5, y: 0.5, z: 0, vz: 0, angle: 0, spaceId: null, phase: 0 },
    climb: null,         // { fx, fy, fz, tx, ty, tz, t } while stepping up
    ghosts: [],          // live hash ghosts (see "Hash ghosts")
    fx: { wobble: 0, glitch: 0, heldNear: -9, heldTouch: -9 }, // screen effects, 0..1
    run: null,           // inventory + run stats, see freshRun()
    push: { key: null, t: 0 },
    time: 0,
    minimap: true,
    bigmap: null,        // { cx, cy, px } while the enlarged map is open
    crouch: false,
    crouchAmt: 0,        // 0 standing .. 1 crouched, eased
    hidden: false,
    paused: false,
  };
  const world = new THREE.Group();
  scene.add(world);

  function freshRun(rootSeed) {
    return {
      rootSeed, charges: RULES.chargesStart, shards: 0, keys: 0,
      shardsFound: 0, keysFound: 0, keysUsed: 0,
      collapses: 0, roomsCollapsed: 0, chargesSpent: 0,
      walked: 0, collected: [], unlocked: [], extracted: null,
      keyRooms: [],  // "spaceId:seed" of rooms whose key showed up (locks first, keys later)
      echoes: 0,     // hash ghosts unravelled by collapsing their rooms (no use yet)
      ghostSeen: [], // "spaceId:seed:ghost" for rooms whose ghost roll has happened
      ghosts: [],    // saved positions: [{ id, x, y, mode }]
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

  /** Locked and not yet unlocked by this run (unlocked doors are checkpoints). */
  function isLockedNow(space, ex) {
    return !ex.connectionId && DP.isLocked(space, ex) && !state.run.unlocked.includes(space.id + '/' + ex.id);
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
      const tile = new THREE.Mesh(geo.tile, mats.floor[(((c.x * 7 + c.y * 13) % 3) + 3) % 3]);
      tile.receiveShadow = true;
      tile.position.set((c.x + 0.5) * S, -0.05, (c.y + 0.5) * S);
      tile.userData.delay = dist * REVEAL_STEP;
      group.add(tile);
      rec.tiles.push(tile);
      tileAt[k] = tile;

      const layers = DE.imprintAt(exp, k);
      if (layers.length) {
        const hsh = parseInt(DE.hash(k, layers[layers.length - 1].seed).slice(-6), 16);
        const crack = new THREE.Mesh(geo.decal, crackMats[hsh % 4][layers.length > 1 ? 1 : 0]);
        crack.rotation.set(-Math.PI / 2, 0, (hsh >> 3) % 4 * Math.PI / 2);
        crack.position.y = 0.052;
        tile.add(crack);
      }

      for (const f of DE.FACINGS) {
        const n = DE.step(c, f);
        if (exp.registry[DE.key(n.x, n.y)] === space.id) continue;
        const fr = edgeFrame(c.x, c.y, f);
        const eg = new THREE.Group();
        eg.position.set(fr.gx * S, 0, fr.gy * S);
        eg.rotation.y = fr.rot;
        const hit = state.exitAt.get(ekey(c.x, c.y, f));
        if (hit) {
          const jl = shadowed(new THREE.Mesh(geo.jamb, mats.frame));
          jl.position.set(-(0.5 - JAMB / 2) * S, WALL_H * S / 2, 0);
          const jr = shadowed(jl.clone());
          jr.position.x = -jl.position.x;
          const li = shadowed(new THREE.Mesh(geo.lintel, mats.frame));
          li.position.set(0, (DOOR_H + (WALL_H - DOOR_H) / 2) * S, 0);
          eg.add(jl, jr, li);
          if (ownsDoorPanel(space.id, hit.exit)) addDoor(eg, space, hit.exit, fr.beyond);
        } else {
          const w = shadowed(new THREE.Mesh(geo.wall, mats.wall));
          w.position.y = WALL_H * S / 2;
          eg.add(w);
        }
        // Inside corners: walls are inset into their own cell and stop at the
        // cell's edge, so where a wall turns around an inside corner the two
        // pieces only touch at a point and leave a wall-thick notch. East-west
        // walls fill it with a post at that end (only they, so it's filled once).
        if (f === 'N' || f === 'S') {
          for (const [a, sign] of [['W', -1], ['E', 1]]) {
            const along = DE.step(c, a), diag = DE.step(along, f);
            if (exp.registry[DE.key(along.x, along.y)] !== space.id || exp.registry[DE.key(diag.x, diag.y)] !== space.id) continue;
            const post = shadowed(new THREE.Mesh(geo.post, mats.wall));
            post.position.set(sign * (0.5 + WALL_T / 2) * S, WALL_H * S / 2, 0);
            eg.add(post);
          }
        }
        eg.userData = { delay: dist * REVEAL_STEP + 0.12 };
        group.add(eg);
        rec.edges.push(eg);
      }
    }

    // Props ride on their cell's tile, so they assemble and dissolve with it.
    const pr = DP.props(space);
    rec.blocks = [];
    const onTile = (b, h, mat, cast) => {
      const t = tileAt[DE.key(Math.floor((b.x0 + b.x1) / 2), Math.floor((b.y0 + b.y1) / 2))];
      const m = new THREE.Mesh(geo.block, mat);
      m.scale.set((b.x1 - b.x0) * S, h * S, (b.y1 - b.y0) * S);
      m.position.set(((b.x0 + b.x1) / 2) * S - t.position.x, h * S / 2 + 0.05, ((b.y0 + b.y1) / 2) * S - t.position.z);
      if (cast) shadowed(m); else m.receiveShadow = true;
      t.add(m);
    };
    for (const d of pr.details) onTile(d, d.h, mats.detail[d.shade < 0.5 ? 0 : 1], false);
    for (const b of pr.blocks) {
      // One seamless box per block, however many units tall.
      const t = tileAt[DE.key(Math.floor((b.x0 + b.x1) / 2), Math.floor((b.y0 + b.y1) / 2))];
      const m = shadowed(new THREE.Mesh(geo.block, mats.block));
      m.scale.set((b.x1 - b.x0) * S, b.units * UNIT * S, (b.y1 - b.y0) * S);
      m.position.set(((b.x0 + b.x1) / 2) * S - t.position.x, b.units * UNIT * S / 2 + 0.05, ((b.y0 + b.y1) / 2) * S - t.position.z);
      t.add(m);
      const blk = Object.assign({ spaceId: space.id, top: b.units * UNIT }, b);
      rec.blocks.push(blk);
      // Index under every cell it overlaps (a 2x2 or double can straddle cells).
      for (let cy = Math.floor(b.y0); cy < Math.ceil(b.y1); cy++) {
        for (let cx = Math.floor(b.x0); cx < Math.ceil(b.x1); cx++) {
          const k = DE.key(cx, cy);
          const list = state.blockAt.get(k) || [];
          if (!list.includes(blk)) list.push(blk);
          state.blockAt.set(k, list);
        }
      }
    }

    // A hash ghost may start here (rolled once per room, ever).
    const gid = space.id + ':' + space.seed + ':ghost';
    if (!state.run.ghostSeen.includes(gid)) {
      state.run.ghostSeen.push(gid);
      const gc = DP.ghostSpawn(space, exp);
      if (gc) addGhost({ id: gid, x: gc.x + 0.5, y: gc.y + 0.5 });
    }

    const spaceKey = space.id + ':' + space.seed;
    for (const item of DP.loot(space)) {
      const key = itemKey(space, item);
      if (state.run.collected.includes(key)) continue;
      if (item.kind === 'key' && !state.run.keyRooms.includes(spaceKey)) continue;
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
    const gate = !ex.connectionId && DP.isLocked(space, ex); // keeps its iron bands once unlocked
    const locked = isLockedNow(space, ex);
    const pivot = new THREE.Group();
    pivot.position.set(-DOOR_W / 2 * S, 0, 0);
    const panel = shadowed(new THREE.Mesh(geo.door, ex.connectionId ? doorOpenMat : locked ? lockMat : doorMat));
    panel.position.set(DOOR_W / 2 * S, DOOR_H * S / 2, 0);
    pivot.add(panel);
    if (gate) {
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
    for (const [k, list] of state.blockAt) {
      const keep = list.filter((b) => b.spaceId !== id);
      if (keep.length) state.blockAt.set(k, keep); else state.blockAt.delete(k);
    }
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
    clearGhosts();
    for (const id of Array.from(state.spaces.keys())) disposeSpace(id);
    for (const rec of state.dying) world.remove(rec.group);
    state.dying = [];
    rebuildExitIndex();
    for (const id in state.exp.spaces) buildSpace(state.exp.spaces[id], false);
  }

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
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
  // When something stands between the camera and the figure (a block, or
  // the solid part of a dithered wall), the hidden part of the figure shows
  // through as a dithered, lantern-orange silhouette. GreaterDepth: these
  // only draw where something nearer already covers the figure.
  const ghostMat = new THREE.MeshBasicMaterial({
    color: 0xffa25c, transparent: true, opacity: 0.6, depthFunc: THREE.GreaterDepth, depthWrite: false,
  });
  ghostMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <clipping_planes_fragment>',
      '#include <clipping_planes_fragment>\nif (mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0) < 0.5) discard;');
  };
  ghostMat.customProgramCacheKey = () => 'ghost';
  for (const m of [body, head]) {
    const g = new THREE.Mesh(m.geometry, ghostMat);
    g.position.copy(m.position);
    g.renderOrder = 10;
    bodyRig.add(g);
  }
  figure.add(bodyRig, blob);
  // The light rides with the held lamp (ahead and to the right, which gives
  // the light its direction). Each frame the lamp is kept out of walls; see
  // placeLamp(). It lives in the scene, positioned in world space.
  const lantern = new THREE.PointLight(0xffb36b, LANTERN, LANTERN_RANGE, 1.7);
  lantern.castShadow = true;
  lantern.shadow.mapSize.set(512, 512);
  lantern.shadow.camera.near = 0.1;
  lantern.shadow.camera.far = LANTERN_RANGE;
  // Small bias + a little normal bias: shadows meet the things that cast
  // them (a big bias made blocks look like they floated off walls/floor).
  lantern.shadow.bias = -0.0008;
  lantern.shadow.normalBias = 0.02;
  scene.add(lantern);
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

  /**
   * Wall, door and block edges around a point. Blocks only count if their
   * top rises above `above` (cells): for the figure that's its feet, for the
   * lamp its own height.
   */
  function nearbySegments(p, above) {
    const segs = [];
    const cx = Math.floor(p.x), cy = Math.floor(p.y);
    const seen = new Set();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      edgeSegments(cx + dx, cy + dy, segs);
      for (const b of state.blockAt.get(DE.key(cx + dx, cy + dy)) || []) {
        if (seen.has(b) || b.top <= above) continue;
        seen.add(b);
        // facing = the side's outward direction, for push-to-climb.
        segs.push({ ax: b.x0, ay: b.y0, bx: b.x1, by: b.y0, block: b, facing: 'N' },
          { ax: b.x1, ay: b.y0, bx: b.x1, by: b.y1, block: b, facing: 'E' },
          { ax: b.x1, ay: b.y1, bx: b.x0, by: b.y1, block: b, facing: 'S' },
          { ax: b.x0, ay: b.y1, bx: b.x0, by: b.y0, block: b, facing: 'W' });
      }
    }
    return segs;
  }

  /** Push the player out of every nearby wall; returns the doors and blocks touched. */
  function resolveCollisions(p) {
    const segs = nearbySegments(p, p.z + 0.05); // at or below your feet: walkable
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
          if ((s.door || s.block) && iter === 0) touched.push(s);
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
      if (p.z > 0.05) continue; // no doors from on top of a block
      if (!ex.connectionId) action = isLockedNow(sp, ex) ? 'locked' : 'open';
      else if ((child = DP.childThrough(exp, sp.id, ex))) action = 'collapse';
      if (!action) continue;
      bestD = d;
      best = { space: sp, exit: ex, action, child };
    }
    if (best && best.action === 'collapse') {
      best.price = DP.collapseCost(DP.branch(exp, best.child.id));
      best.affordable = best.price.charges <= state.run.charges;
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // The lamp: offset from the body, but never inside or through a wall.

  const LAMP_SIDE = 0.14, LAMP_FWD = 0.12; // cells, right and forward of the body
  const LAMP_CLEAR = 0.14;  // from a wall line (walls are 0.08 thick, inside the cell)

  /** Ray (px,py)+t(dx,dy), t in [0,1], against a segment; returns t or null. */
  function raySeg(px, py, dx, dy, g) {
    const ex = g.bx - g.ax, ey = g.by - g.ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) return null;
    const wx = g.ax - px, wy = g.ay - py;
    const t = (wx * ey - wy * ex) / den, u = (wx * dy - wy * dx) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
  }

  /**
   * Put the light at the held lamp: cast from the body's center toward the
   * lamp's spot, stop short of the first wall, door or taller block, then
   * keep a little clearance from every edge. The lamp mesh follows.
   */
  function placeLamp(p, height) {
    const c = Math.cos(p.angle), sn = Math.sin(p.angle);
    // three.js rotation.y: local (x, z) -> world (x c + z s, -x s + z c)
    const ox = LAMP_SIDE * c + LAMP_FWD * sn, oy = -LAMP_SIDE * sn + LAMP_FWD * c;
    const len = Math.hypot(ox, oy);
    const segs = nearbySegments(p, p.z + height - 0.05);
    let t = 1;
    for (const g of segs) {
      const hit = raySeg(p.x, p.y, ox, oy, g);
      if (hit !== null) t = Math.min(t, hit);
    }
    if (t < 1) t = Math.max(0, t - LAMP_CLEAR / len);
    const q = { x: p.x + ox * t, y: p.y + oy * t };
    for (let iter = 0; iter < 2; iter++) {
      for (const g of segs) {
        const vx = g.bx - g.ax, vy = g.by - g.ay;
        const k = THREE.MathUtils.clamp(((q.x - g.ax) * vx + (q.y - g.ay) * vy) / (vx * vx + vy * vy), 0, 1);
        const dx = q.x - (g.ax + vx * k), dy = q.y - (g.ay + vy * k);
        const d = Math.hypot(dx, dy);
        if (d < LAMP_CLEAR && d > 1e-6) { q.x += dx / d * (LAMP_CLEAR - d); q.y += dy / d * (LAMP_CLEAR - d); }
      }
    }
    lantern.position.set(q.x * S, (p.z + height) * S, q.y * S);
    // The lamp mesh, back in the body's local frame.
    const wx = q.x - p.x, wy = q.y - p.y;
    lanternMesh.position.x = (wx * c - wy * sn) * S;
    lanternMesh.position.z = (wx * sn + wy * c) * S;
  }

  const canClimb = (b) => b.top - state.player.z > 0.05 &&
    b.top - state.player.z <= RULES.climbMaxUnits * UNIT + 0.01 && b.top <= RULES.climbMaxTop * UNIT + 0.01;

  /** A climbable block right in front of the figure, if no door is closer. */
  function blockNear(p) {
    const cx = Math.floor(p.x), cy = Math.floor(p.y);
    const fx = Math.sin(p.angle), fy = Math.cos(p.angle); // facing
    let best = null, bestD = RADIUS + 0.14;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const b of state.blockAt.get(DE.key(cx + dx, cy + dy)) || []) {
        if (!canClimb(b)) continue;
        const qx = THREE.MathUtils.clamp(p.x, b.x0, b.x1), qy = THREE.MathUtils.clamp(p.y, b.y0, b.y1);
        const d = Math.hypot(qx - p.x, qy - p.y);
        if (d >= bestD || d < 1e-6) continue;
        if (((qx - p.x) * fx + (qy - p.y) * fy) / d < 0.3) continue; // must be roughly ahead
        bestD = d;
        best = { action: 'climb', block: b, dir: { x: (qx - p.x) / d, y: (qy - p.y) / d } };
      }
    }
    return best;
  }

  /**
   * Step up onto a block, moving as little as possible: cross the face
   * you're at just far enough to stand on the near edge, and keep your
   * position along that face (nudged in only if you were past a corner).
   */
  function climb(b, dir) {
    const p = state.player;
    const IN = 0.12, SIDE = 0.06; // how far onto the block; corner margin
    const inX = Math.min(IN, (b.x1 - b.x0) / 2), inY = Math.min(IN, (b.y1 - b.y0) / 2);
    const gx = Math.max(b.x0 - p.x, 0, p.x - b.x1), gy = Math.max(b.y0 - p.y, 0, p.y - b.y1);
    const acrossX = gx > gy || (gx === gy && Math.abs(dir.x) >= Math.abs(dir.y));
    let tx, ty;
    if (acrossX) {
      tx = p.x < b.x0 ? b.x0 + inX : b.x1 - inX;
      ty = THREE.MathUtils.clamp(p.y, b.y0 + Math.min(SIDE, inY), b.y1 - Math.min(SIDE, inY));
    } else {
      ty = p.y < b.y0 ? b.y0 + inY : b.y1 - inY;
      tx = THREE.MathUtils.clamp(p.x, b.x0 + Math.min(SIDE, inX), b.x1 - Math.min(SIDE, inX));
    }
    state.climb = { fx: p.x, fy: p.y, fz: p.z, tx, ty, tz: b.top, t: 0 };
    state.push.key = null;
    if (state.crouch) toggleCrouch(); // vaulting stands you up
  }

  function act(near) {
    if (!near || state.paused || state.climb) return;
    if (near.action === 'climb') { climb(near.block, near.dir); return; }
    const run = state.run;
    const doorKey = near.space.id + '/' + near.exit.id;
    if (near.action === 'open') {
      openDoor(near.space.id, near.exit.id);
    } else if (near.action === 'locked') {
      if (run.keys <= 0) { showCaption('locked. you need a key'); return; }
      run.keys--;
      run.keysUsed++;
      run.unlocked.push(doorKey);
      const door = state.doors.get(doorKey);
      if (door) {
        door.locked = false;
        door.panel.material = doorMat;
        door.seam.material = seamMat;
      }
      savePlayer();
      refreshHud();
      showRecord(near.space.id, near.exit.id, 'checkpoint');
    } else if (near.action === 'collapse') {
      if (!near.affordable) {
        showCaption(`too much lies beyond: ${chargeText(near.price.charges)}, you have ${run.charges}`);
        return;
      }
      collapseThrough(near);
    }
  }

  /**
   * Locks first, keys later: a key-capable room only shows its key while
   * there are more unopened locked doors around than keys (held + lying).
   */
  function keyNeeded() {
    const exp = state.exp;
    let locks = 0, lying = 0;
    for (const id in exp.spaces) for (const ex of exp.spaces[id].exits) if (isLockedNow(exp.spaces[id], ex)) locks++;
    for (const it of state.items.values()) if (it.item.kind === 'key') lying++;
    return locks > state.run.keys + lying;
  }

  function openDoor(spaceId, exitId) {
    const exp = state.exp;
    const needKey = keyNeeded();
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
      const sp = cand.space;
      if (needKey && DP.loot(sp).some((it) => it.kind === 'key')) state.run.keyRooms.push(sp.id + ':' + sp.seed);
      buildSpace(sp, true);
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

    const unravelled = banishGhostsIn(ids);
    DP.collapse(exp, near.child.id);
    run.charges -= near.price.charges;
    run.chargesSpent += near.price.charges;
    run.collapses++;
    run.roomsCollapsed += spaces.length;
    rebuildExitIndex();

    const maxDepth = spaces[0].depth;
    spaces.forEach((s) => dissolveSpace(s.id, maxDepth - s.depth));
    for (const id of touched) if (exp.spaces[id]) buildSpace(exp.spaces[id], false);
    const door = state.doors.get(near.space.id + '/' + near.exit.id);
    if (door) door.dir = -1;

    showCaption(`collapsed ${spaces.length} room${spaces.length === 1 ? '' : 's'} · −${chargeText(near.price.charges)}` +
      (unravelled ? ` · ${unravelled === 1 ? 'a hash ghost unravels' : unravelled + ' hash ghosts unravel'} (+${unravelled} echo${unravelled === 1 ? '' : 'es'})` : ''));
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
      if (k === 'escape' && recordMode === 'checkpoint') hideRecord();
      return;
    }
    if (state.bigmap) {
      if (k === 'm' || k === 'escape') closeBigMap();
      return;
    }
    keys.add(k);
    if (k === 'e' || k === ' ') {
      if (!e.repeat) act(doorNear(state.player) || blockNear(state.player));
      e.preventDefault();
    } else if (k === 'm') {
      openBigMap();
    } else if (k === 'c') {
      if (!e.repeat) toggleCrouch();
    } else if (k === 'n') {
      requestNewMap();
    }
    if (k.startsWith('arrow')) e.preventDefault();
  });
  global.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  global.addEventListener('blur', () => keys.clear());

  const promptEl = $('prompt');
  promptEl.addEventListener('click', (e) => { act(doorNear(state.player) || blockNear(state.player)); promptEl.blur(); e.preventDefault(); });

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
    hideRecord();
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

  function toggleCrouch() {
    state.crouch = !state.crouch;
    $('crouch-btn').classList.toggle('on', state.crouch);
  }
  $('crouch-btn').addEventListener('click', (e) => { toggleCrouch(); e.currentTarget.blur(); });

  function readInput() {
    if (state.paused || state.bigmap) return { x: 0, y: 0, mag: 0 };
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
    let inp = readInput();
    const prev = { x: p.x, y: p.y };
    let moving = false;

    // Stepping up onto a block: a short eased hop; input waits.
    if (state.climb) {
      const c = state.climb;
      c.t = Math.min(1, c.t + dt / CLIMB_TIME);
      // Rise first, then carry forward, both eased in and out, so the hop
      // has no sudden starts or stops; a small arc over the lip.
      const rise = easeInOut(THREE.MathUtils.clamp(c.t / 0.65, 0, 1));
      const carry = easeInOut(THREE.MathUtils.clamp((c.t - 0.2) / 0.8, 0, 1));
      p.x = c.fx + (c.tx - c.fx) * carry;
      p.y = c.fy + (c.ty - c.fy) * carry;
      p.z = c.fz + (c.tz - c.fz) * rise + Math.sin(Math.PI * c.t) * 0.04;
      if (c.t >= 1) { p.z = c.tz; p.vz = 0; state.climb = null; }
      inp = { x: 0, y: 0, mag: 0 };
    }

    if (inp.mag > 0) {
      const sp = (state.crouch ? CROUCH_SPEED : inp.run ? RUN : SPEED) * inp.mag;
      p.x += inp.x * sp * dt;
      p.y += inp.y * sp * dt;
      const target = Math.atan2(inp.x, inp.y);
      let da = target - p.angle;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      p.angle += da * Math.min(1, dt * 14);
      moving = true;
    }
    if (!state.paused) run.walked += dt;
    const touched = state.climb ? [] : resolveCollisions(p);
    if (exp.registry[DE.key(Math.floor(p.x), Math.floor(p.y))] === undefined) { p.x = prev.x; p.y = prev.y; }

    // Standing height: the tallest block top under the figure's center.
    // Step off an edge and you drop to whatever is below.
    if (!state.climb) {
      let support = 0;
      for (const b of state.blockAt.get(DE.key(Math.floor(p.x), Math.floor(p.y))) || []) {
        if (b.top <= p.z + 0.05 && p.x > b.x0 && p.x < b.x1 && p.y > b.y0 && p.y < b.y1) support = Math.max(support, b.top);
      }
      if (p.z > support) {
        p.vz = (p.vz || 0) - GRAVITY * dt;
        p.z = Math.max(support, p.z + p.vz * dt);
        if (p.z === support) p.vz = 0;
      } else { p.z = support; p.vz = 0; }
    }

    // Pushing into a closed (unlocked) door, or a climbable block, for a
    // beat opens it / steps up onto it. A wall is a block's way of saying no.
    let pushing = null, pushingBlock = null, pk = null;
    if (inp.mag > 0) {
      for (const s of touched) {
        const d = DE.DIRS[s.facing];
        // Doors face out of their room; block sides face out of the block.
        const into = s.block ? -(d.x * inp.x + d.y * inp.y) : d.x * inp.x + d.y * inp.y;
        if (into <= 0.5) continue;
        if (s.door && p.z <= 0.05 && !isLockedNow(exp.spaces[s.door.spaceId], s.door.exit)) {
          pushing = s.door; pk = s.door.spaceId + '/' + s.door.exit.id; break;
        }
        if (s.block && canClimb(s.block)) {
          pushingBlock = s.block; pk = 'block:' + s.block.x0 + ',' + s.block.y0; break;
        }
      }
    }
    if (pk && pk === state.push.key) state.push.t += dt;
    else { state.push.key = pk; state.push.t = 0; }
    if (pk && state.push.t >= PUSH_TIME) {
      state.push.key = null;
      if (pushing) openDoor(pushing.spaceId, pushing.exit.id);
      else climb(pushingBlock, { x: inp.x, y: inp.y });
    }

    // Pick things up.
    for (const [k, it] of state.items) {
      const dx = p.x - (it.item.cell.x + 0.5), dy = p.y - (it.item.cell.y + 0.5);
      if (dx * dx + dy * dy > PICKUP_RANGE * PICKUP_RANGE) continue;
      run.collected.push(k);
      it.mesh.parent.remove(it.mesh);
      state.items.delete(k);
      if (it.item.kind === 'shard') {
        run.shardsFound++;
        const per = RULES.shardsPerCharge;
        if (run.charges >= RULES.chargesMax) {
          run.shards = Math.min(per - 1, run.shards + 1);
          showCaption('a shard · your entropy is full');
        } else if (++run.shards >= per) {
          run.shards -= per;
          run.charges++;
          showCaption(`${per} shards fuse · a charge of entropy (${run.charges})`);
        } else {
          showCaption(`a shard · ${run.shards}/${per}`);
        }
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

    updatePrompt(state.paused || state.climb ? null : doorNear(p) || blockNear(p));

    // Figure
    p.phase += moving ? dt * 11 * (inp.run ? 1.4 : 1) : 0;
    figure.position.set(p.x * S, p.z * S, p.y * S);
    figure.rotation.y = p.angle;
    fill.position.set(p.x * S, 1.0 * S, (p.y + 0.6) * S);
    state.crouchAmt += ((state.crouch ? 1 : 0) - state.crouchAmt) * Math.min(1, dt * 10);
    const ca = state.crouchAmt;
    bodyRig.scale.y = 1 - (1 - CROUCH_SCALE) * ca;
    bodyRig.position.y = moving ? Math.abs(Math.sin(p.phase)) * 0.05 * S * (1 - 0.7 * ca) : 0;
    // Never let the lantern rise above the walls (it would light other rooms).
    placeLamp(p, Math.max(0.2, Math.min(0.75 - 0.4 * ca, WALL_H - 0.15 - p.z)));

    // Hidden: crouched, right up against a block (every block is taller
    // than a crouched figure). Nothing hunts you yet; this is the hook.
    let hidden = false;
    if (ca > 0.8) {
      const cx = Math.floor(p.x), cy = Math.floor(p.y);
      for (let dy = -1; dy <= 1 && !hidden; dy++) for (let dx = -1; dx <= 1 && !hidden; dx++) {
        for (const b of state.blockAt.get(DE.key(cx + dx, cy + dy)) || []) {
          if (b.top - p.z < 0.38) continue; // must rise above a crouched figure
          const ex = Math.max(b.x0 - p.x, 0, p.x - b.x1), ey = Math.max(b.y0 - p.y, 0, p.y - b.y1);
          if (Math.hypot(ex, ey) < RADIUS + HIDE_RANGE) { hidden = true; break; }
        }
      }
    }
    const stance = hidden ? 'hidden' : state.crouch ? 'crouched' : '';
    if (stance !== stanceEl.textContent) {
      state.hidden = hidden;
      stanceEl.textContent = stance;
      stanceEl.className = 'stance' + (hidden ? ' hidden' : '');
    }
    lantern.intensity = LANTERN * (0.94 + 0.06 * Math.sin(state.time * 9.3) * Math.sin(state.time * 3.1));

    // Camera: fixed angle, smoothed follow.
    tmpV.set(p.x * S, 0.6 + p.z * S * 0.6, p.y * S);
    camTarget.lerp(tmpV, 1 - Math.exp(-dt * 7));
    camera.position.copy(camTarget).add(CAM_OFFSET);
    camera.lookAt(camTarget);
    camera.updateMatrixWorld();

    // Dither: centered on the figure on screen, for pixels nearer the camera.
    renderer.getDrawingBufferSize(tmpV2);
    tmpV.set(p.x * S, (0.35 + p.z) * S, p.y * S).project(camera);
    dither.uDitherCenter.value.set((tmpV.x + 1) / 2 * tmpV2.x, (tmpV.y + 1) / 2 * tmpV2.y);
    dither.uDitherRadius.value = DITHER_RADIUS * Math.min(tmpV2.x, tmpV2.y);
    dither.uDitherPlayer.value.set(p.x * S, p.y * S);

    updateGhosts(dt);

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
  // Hash ghosts
  //
  // Floating things that drift through a room and sometimes the next one.
  // They pass open doorways but not walls or closed doors, and float over
  // blocks. Noticing you takes two stages: a while in your lantern light and
  // one stops and turns to you ("!"); keep the light on it and a ring fills
  // around the "!"; a full ring and it follows, slowly. Light off and the
  // ring drains. A follower gives up after a couple of seconds out of your
  // light, or once a room lies between you. Nearness wobbles the screen;
  // contact glitches it.
  // The only way to be rid of one is to collapse the rooms it's in, which
  // unravels it and leaves you an echo (a resource with no use yet).

  const GHOST = {
    contact: 0.34,       // cells, figure to ghost
    wanderSpeed: 0.45,
    chaseSpeed: 0.9,     // slower than walking (2.4) and even crouching (1.1)
    lightRange: 5,       // cells: how far the lantern "touches"
    noticeTime: 1.2,     // s in your light before it stops and turns to you ("!")
    alertPause: 0.8,     // s of "!" before the ring starts filling
    ringTime: 3,         // s of continuous light to fill the ring
    ringDrain: 2.5,      // s for a full ring to drain out of the light
    alertGiveUp: 1.2,    // s unlit with an empty ring before it goes back to wandering
    loseDark: 2,         // s out of your light before a follower gives up
    loseRooms: 2,        // ...or once the rooms between you reach this (one room in between)
    height: 0.55,
  };

  // The "!" and its ring, drawn into a small canvas per ghost and shown as
  // a camera-facing sprite above it (over walls, so you can always read it).
  function drawAlert(g) {
    const c = g.alertCanvas, x = c.getContext('2d'), n = c.width;
    x.clearRect(0, 0, n, n);
    const r = n * 0.36, cx = n / 2, cy = n / 2;
    x.lineWidth = n * 0.09;
    x.strokeStyle = 'rgba(20, 12, 30, 0.65)';
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke();
    if (g.ring > 0) {
      x.strokeStyle = g.ring >= 1 ? '#ff5fd2' : '#d678ff';
      x.beginPath(); x.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, g.ring)); x.stroke();
    }
    x.fillStyle = '#ffc35a';
    x.font = `bold ${Math.round(n * 0.5)}px system-ui, sans-serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('!', cx, cy + n * 0.02);
    g.alertTex.needsUpdate = true;
  }
  const ghostGeo = {
    head: new THREE.SphereGeometry(0.16 * S, 18, 12),
    tail: new THREE.ConeGeometry(0.16 * S, 0.44 * S, 18, 1, true),
    bit: new THREE.BoxGeometry(0.035 * S, 0.035 * S, 0.035 * S),
  };
  const ghostBitMat = new THREE.MeshBasicMaterial({ color: 0xb59cff, transparent: true, opacity: 0.85 });

  function addGhost(g) {
    const mesh = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({
      color: 0xd9d2ff, emissive: 0x24185a, transparent: true, opacity: 0.5, depthWrite: false,
    });
    const head = new THREE.Mesh(ghostGeo.head, mat);
    const tail = new THREE.Mesh(ghostGeo.tail, mat);
    tail.rotation.x = Math.PI;           // point down: a trailing wisp
    tail.position.y = -0.21 * S;
    mesh.add(head, tail);
    const bits = [];
    for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(ghostGeo.bit, ghostBitMat); mesh.add(b); bits.push(b); }
    const alertCanvas = document.createElement('canvas');
    alertCanvas.width = alertCanvas.height = 96;
    const alertTex = new THREE.CanvasTexture(alertCanvas);
    alertTex.colorSpace = THREE.SRGBColorSpace;
    const alert = new THREE.Sprite(new THREE.SpriteMaterial({ map: alertTex, transparent: true, depthTest: false }));
    alert.scale.setScalar(0.42 * S);
    alert.position.y = 0.5 * S;
    alert.renderOrder = 20;
    alert.visible = false;
    mesh.add(alert);
    scene.add(mesh);
    const ghost = Object.assign({ mode: 'wander', lit: 0, dark: 0, ring: 0, alertT: 0, idle: 0, target: null, pause: 0, next: null, pathT: 0 }, g,
      { mesh, mat, bits, alert, alertCanvas, alertTex, drawnRing: -1, phase: Math.random() * 10 });
    state.ghosts.push(ghost);
    return ghost;
  }

  function removeGhost(g) {
    scene.remove(g.mesh);
    g.mat.dispose();
    g.alertTex.dispose();
    g.alert.material.dispose();
    state.ghosts = state.ghosts.filter((o) => o !== g);
  }

  function clearGhosts() { for (const g of state.ghosts.slice()) removeGhost(g); }

  const FACE = { '1,0': 'E', '-1,0': 'W', '0,1': 'S', '0,-1': 'N' };
  /** Can something float from cell a to the adjacent cell b? */
  function passable(ax, ay, bx, by) {
    const reg = state.exp.registry;
    const sa = reg[DE.key(ax, ay)], sb = reg[DE.key(bx, by)];
    if (sa === undefined || sb === undefined) return false;
    if (sa === sb) return true;
    const hit = state.exitAt.get(ekey(ax, ay, FACE[(bx - ax) + ',' + (by - ay)]));
    return !!(hit && hit.exit.connectionId);
  }

  /** Does the lantern's light reach (tx, ty): in range, and no wall between? */
  function lightReaches(fx, fy, tx, ty) {
    const d = Math.hypot(tx - fx, ty - fy);
    if (d > GHOST.lightRange) return false;
    const n = Math.max(1, Math.ceil(d / 0.1));
    let cx = Math.floor(fx), cy = Math.floor(fy);
    for (let i = 1; i <= n; i++) {
      const nx = Math.floor(fx + (tx - fx) * i / n), ny = Math.floor(fy + (ty - fy) * i / n);
      if (nx === cx && ny === cy) continue;
      if (nx !== cx && ny !== cy) {
        if (!((passable(cx, cy, nx, cy) && passable(nx, cy, nx, ny)) ||
              (passable(cx, cy, cx, ny) && passable(cx, ny, nx, ny)))) return false;
      } else if (!passable(cx, cy, nx, ny)) return false;
      cx = nx; cy = ny;
    }
    return true;
  }

  /** The next cell on a shortest floating path from one cell to another. */
  function nextCellToward(fx, fy, tx, ty, limit) {
    const start = DE.key(fx, fy), goal = DE.key(tx, ty);
    if (start === goal) return null;
    const prev = new Map([[start, null]]);
    const q = [[fx, fy]];
    for (let h = 0; h < q.length && prev.size < limit; h++) {
      const [x, y] = q[h];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = DE.key(nx, ny);
        if (prev.has(k) || !passable(x, y, nx, ny)) continue;
        prev.set(k, DE.key(x, y));
        if (k === goal) {
          let c = k;
          while (prev.get(c) !== start) c = prev.get(c);
          return DE.parseKey(c);
        }
        q.push([nx, ny]);
      }
    }
    return undefined;
  }

  /** Rooms between two spaces through open doors (Infinity past `max`). */
  function roomGap(a, b, max) {
    if (a === b) return 0;
    const exp = state.exp;
    let frontier = [a];
    const seen = new Set([a]);
    for (let d = 1; d <= max; d++) {
      const nxt = [];
      for (const id of frontier) {
        for (const ex of exp.spaces[id].exits) {
          if (!ex.connectionId) continue;
          const c = exp.connections[ex.connectionId];
          const o = c.a.spaceId === id ? c.b.spaceId : c.a.spaceId;
          if (o === b) return d;
          if (!seen.has(o)) { seen.add(o); nxt.push(o); }
        }
      }
      frontier = nxt;
    }
    return Infinity;
  }

  /** Drift toward a point, staying in cells it can float between. True on arrival. */
  function driftToward(g, tx, ty, speed, dt) {
    const dx = tx - g.x, dy = ty - g.y, d = Math.hypot(dx, dy);
    if (d < 0.02) return true;
    const step = Math.min(d, speed * dt);
    const nx = g.x + dx / d * step, ny = g.y + dy / d * step;
    const ox = Math.floor(g.x), oy = Math.floor(g.y);
    const ok = (x, y) => {
      const cx = Math.floor(x), cy = Math.floor(y);
      return (cx === ox && cy === oy) || (Math.abs(cx - ox) + Math.abs(cy - oy) === 1 && passable(ox, oy, cx, cy));
    };
    if (ok(nx, ny)) { g.x = nx; g.y = ny; } else if (ok(nx, g.y)) g.x = nx; else if (ok(g.x, ny)) g.y = ny;
    return d <= step + 0.02;
  }

  /** Steer through doorways: head for the next cell's center, or the goal once in its cell. */
  function followPath(g, gx, gy, speed, dt) {
    g.pathT -= dt;
    const cx = Math.floor(g.x), cy = Math.floor(g.y);
    if (g.pathT <= 0 || (g.next && g.next.x === cx && g.next.y === cy)) {
      g.next = nextCellToward(cx, cy, Math.floor(gx), Math.floor(gy), 500);
      g.pathT = 0.3;
    }
    if (g.next === undefined) return true; // no way through: give up on this goal
    if (g.next === null) return driftToward(g, gx, gy, speed, dt);
    driftToward(g, g.next.x + 0.5, g.next.y + 0.5, speed, dt);
    return false;
  }

  function wander(g, dt) {
    if (g.pause > 0) { g.pause -= dt; return; }
    if (!g.target) {
      const exp = state.exp;
      const here = exp.registry[DE.key(Math.floor(g.x), Math.floor(g.y))];
      if (here === undefined) return;
      let sp = exp.spaces[here];
      // Mostly its own room; sometimes the room next door.
      if (Math.random() < 0.25) {
        const doors = sp.exits.filter((ex) => ex.connectionId);
        if (doors.length) {
          const c = exp.connections[doors[Math.floor(Math.random() * doors.length)].connectionId];
          sp = exp.spaces[c.a.spaceId === here ? c.b.spaceId : c.a.spaceId] || sp;
        }
      }
      const cell = DE.parseKey(sp.cells[Math.floor(Math.random() * sp.cells.length)]);
      g.target = { x: cell.x + 0.2 + Math.random() * 0.6, y: cell.y + 0.2 + Math.random() * 0.6 };
      g.next = null; g.pathT = 0;
    }
    if (followPath(g, g.target.x, g.target.y, GHOST.wanderSpeed, dt)) {
      g.target = null;
      g.pause = 1 + Math.random() * 2.5;
    }
  }

  function updateGhosts(dt) {
    const p = state.player;
    const frozen = state.paused || !!state.bigmap;
    const lx = lantern.position.x / S, ly = lantern.position.z / S;
    let nearest = Infinity, touching = false;
    for (const g of state.ghosts.slice()) {
      if (!frozen) {
        const lit = lightReaches(lx, ly, g.x, g.y);
        if (g.mode === 'wander') {
          g.lit = lit ? g.lit + dt : Math.max(0, g.lit - dt);
          if (g.lit >= GHOST.noticeTime) {
            // Stage one: it stops and turns to you.
            g.mode = 'alert'; g.ring = 0; g.alertT = 0; g.idle = 0; g.target = null;
          } else wander(g, dt);
        }
        if (g.mode === 'alert') {
          // Stage two: keep it in your light and the ring fills.
          g.alertT += dt;
          if (lit) {
            g.idle = 0;
            if (g.alertT > GHOST.alertPause) g.ring += dt / GHOST.ringTime;
          } else {
            g.ring = Math.max(0, g.ring - dt / GHOST.ringDrain);
            if (g.ring === 0) g.idle += dt;
          }
          if (g.ring >= 1) {
            g.mode = 'chase'; g.dark = 0; g.next = null; g.pathT = 0;
            showCaption('a hash ghost turns its attention to you');
          } else if (g.idle >= GHOST.alertGiveUp && g.alertT > GHOST.alertPause) {
            g.mode = 'wander'; g.lit = 0; g.pause = 1;
          }
        }
        if (g.mode === 'chase') {
          g.dark = lit ? 0 : g.dark + dt;
          const gs = state.exp.registry[DE.key(Math.floor(g.x), Math.floor(g.y))];
          const gap = gs === undefined || p.spaceId === undefined ? Infinity : roomGap(gs, p.spaceId, GHOST.loseRooms);
          if (g.dark >= GHOST.loseDark || gap >= GHOST.loseRooms) {
            g.mode = 'wander'; g.lit = 0; g.ring = 0; g.target = null; g.pause = 1.5;
            showCaption('the hash ghost loses your thread');
          } else if (followPath(g, p.x, p.y, GHOST.chaseSpeed, dt) === true && g.next === undefined) {
            // Unreachable from here (closed door between you): drift and wait.
            g.mode = 'wander'; g.target = null;
          }
        }
      }
      const d = Math.hypot(p.x - g.x, p.y - g.y);
      nearest = Math.min(nearest, d);
      if (d < GHOST.contact && p.z < 0.6) touching = true;

      // Look: bob, orbiting "bits", and a hotter, jittery glow when following.
      const chasing = g.mode === 'chase';
      g.phase += dt;
      const jit = chasing ? 0.02 : 0;
      g.mesh.position.set(
        (g.x + (Math.random() - 0.5) * jit) * S,
        (GHOST.height + Math.sin(g.phase * 1.7) * 0.05) * S,
        (g.y + (Math.random() - 0.5) * jit) * S);
      g.mat.emissive.setHex(chasing ? 0x6a1f7a : 0x24185a);
      g.mat.opacity = chasing ? 0.62 + Math.sin(g.phase * 23) * 0.08 : 0.5;
      // The "!" and ring while it's deciding about you.
      g.alert.visible = g.mode === 'alert';
      if (g.alert.visible) {
        const q = Math.round(g.ring * 60) / 60;
        if (q !== g.drawnRing) { g.ring = Math.min(1, g.ring); drawAlert(g); g.drawnRing = q; }
        const pop = Math.min(1, g.alertT / 0.15);
        g.alert.scale.setScalar(0.42 * S * (0.6 + 0.4 * pop));
      }
      const watching = g.mode === 'alert';
      g.bits.forEach((b, i) => {
        const a = g.phase * (chasing ? 4 : watching ? 0.6 : 1.6) + i * Math.PI / 2;
        b.position.set(Math.cos(a) * 0.24 * S, Math.sin(g.phase * 3 + i) * 0.08 * S, Math.sin(a) * 0.24 * S);
        b.rotation.set(a, a * 1.3, 0);
      });
    }

    // Screen effects: wobble grows with nearness, glitch with contact. Both
    // hold for a moment once you're clear, then wear off.
    const fx = state.fx;
    const want = THREE.MathUtils.clamp(1 - (nearest - 0.4) / 3.6, 0, 1);
    if (want >= fx.wobble - 0.001) { fx.wobble += (want - fx.wobble) * Math.min(1, dt * 2.5); fx.heldNear = state.time; }
    else if (state.time - fx.heldNear > 1.2) fx.wobble = Math.max(want, fx.wobble - dt * 0.22);
    if (touching) { fx.glitch = Math.min(1, fx.glitch + dt * 1.6); fx.heldTouch = state.time; }
    else if (state.time - fx.heldTouch > 1.5) fx.glitch = Math.max(0, fx.glitch - dt * 0.3);
  }

  /** Ghosts inside rooms about to collapse unravel; each leaves an echo. */
  function banishGhostsIn(ids) {
    const reg = state.exp.registry;
    const gone = state.ghosts.filter((g) => ids.has(reg[DE.key(Math.floor(g.x), Math.floor(g.y))]));
    gone.forEach(removeGhost);
    state.run.echoes += gone.length;
    return gone.length;
  }

  // Post-processing for the ghost effects: the scene renders into a
  // half-float target, then a full-screen pass wobbles it and, on contact,
  // tears it into purple static. Skipped entirely while both are at zero.
  const post = (() => {
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: rt.texture }, uTime: { value: 0 },
        uWobble: { value: 0 }, uGlitch: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
uniform sampler2D tDiffuse;
uniform float uTime, uWobble, uGlitch;
uniform vec2 uRes;
varying vec2 vUv;
float rand(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 uv = vUv;
  float w = uWobble, g = uGlitch;
  // Wobble: slow, overlapping waves, a bit stronger toward the edges.
  float edge = 0.6 + 0.8 * length(vUv - 0.5);
  uv.x += (sin(uv.y * 11.0 + uTime * 2.1) * 0.011 + sin(uv.y * 29.0 - uTime * 3.7) * 0.004) * w * edge;
  uv.y += (cos(uv.x * 9.0 + uTime * 1.6) * 0.009 + sin(uv.x * 23.0 + uTime * 2.9) * 0.003) * w * edge;
  // Glitch: torn horizontal slices that jump a few times a second.
  float band = floor(vUv.y * 46.0);
  float tick = floor(uTime * 14.0);
  if (rand(vec2(band, tick)) < g * 0.38) uv.x += (rand(vec2(band, tick + 7.0)) - 0.5) * 0.16 * g;
  float split = 0.003 * w + 0.014 * g;
  vec4 col;
  col.r = texture2D(tDiffuse, uv + vec2(split, 0.0)).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv - vec2(split, 0.0)).b;
  col.a = 1.0;
  // Purple static and scanlines.
  float n = rand(floor(vUv * uRes / 2.0) + tick * 3.1);
  col.rgb = mix(col.rgb, vec3(n) * vec3(0.55, 0.3, 0.9), g * 0.5);
  col.rgb += vec3(0.12, 0.02, 0.22) * g;
  col.rgb *= 1.0 - g * 0.3 * step(0.5, fract(vUv.y * uRes.y / 3.0));
  gl_FragColor = col;
  #include <colorspace_fragment>
}`,
      depthTest: false, depthWrite: false,
    });
    const sc = new THREE.Scene();
    sc.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    return { rt, mat, sc, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
  })();

  function renderFrame() {
    const fx = state.fx;
    if (fx.wobble < 0.003 && fx.glitch < 0.003) { renderer.render(scene, camera); return; }
    renderer.getDrawingBufferSize(tmpV2);
    if (post.rt.width !== tmpV2.x || post.rt.height !== tmpV2.y) post.rt.setSize(tmpV2.x, tmpV2.y);
    const u = post.mat.uniforms;
    u.uTime.value = state.time; u.uWobble.value = fx.wobble; u.uGlitch.value = fx.glitch;
    u.uRes.value.copy(tmpV2);
    renderer.setRenderTarget(post.rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(post.sc, post.cam);
  }

  // ---------------------------------------------------------------------------
  // HUD

  const touchUi = global.matchMedia && global.matchMedia('(hover: none)').matches;
  const verb = touchUi ? 'tap' : 'E';
  const chargeText = (n) => `${n} charge${n === 1 ? '' : 's'}`;

  let lastPrompt = '';
  function updatePrompt(near) {
    let text = '', cls = '';
    if (near) {
      const run = state.run;
      if (near.action === 'climb') {
        text = state.push.key ? 'climbing…' : `a block · push, or ${verb} to climb`;
      } else if (near.action === 'open') {
        text = state.push.key ? 'opening…' : `a closed door · push, or ${verb}`;
      } else if (near.action === 'locked') {
        cls = 'lock';
        text = run.keys > 0 ? `a locked door · ${verb} to unlock (1 key)` : 'a locked door · you need a key';
      } else {
        const pr = near.price;
        const rooms = `${pr.rooms} room${pr.rooms === 1 ? '' : 's'}`;
        cls = near.affordable ? 'collapse' : 'blocked';
        text = near.affordable
          ? `close & collapse ${rooms} · ${chargeText(pr.charges)} · ${verb}`
          : `too much lies beyond · ${rooms}, ${chargeText(pr.charges)}`;
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

  const stanceEl = $('stance');

  function refreshHud() {
    const s = DE.stats(state.exp);
    const run = state.run;
    $('stats').textContent = `seed ${state.exp.rootSeed} · ${s.spaces} rooms · ${s.openExits} closed doors`;
    const charges = $('charges');
    charges.innerHTML = '';
    for (let i = 0; i < RULES.chargesMax; i++) charges.append(el('span', i < run.charges ? 'charge on' : 'charge'));
    const shards = $('shard-pips');
    shards.innerHTML = '';
    for (let i = 0; i < RULES.shardsPerCharge; i++) shards.append(el('span', i < run.shards ? 'pip on' : 'pip'));
    charges.parentElement.title = `${run.charges} of ${RULES.chargesMax} charges · ${run.shards}/${RULES.shardsPerCharge} shards toward the next`;
    $('keys-num').textContent = run.keys;
    $('echoes-num').textContent = run.echoes;
  }

  /**
   * Draw the chart (traces, rooms, doors, figure) into a 2D canvas, with
   * grid cell (cx, cy) at the canvas center and `px` pixels per cell. Used
   * by the minimap (centered on the figure) and the enlarged map.
   */
  function drawChart(cv, ctx, cx, cy, px) {
    const dpr = Math.min(global.devicePixelRatio || 1, 2);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const p = state.player;
    const exp = state.exp;
    const ox = w / 2 - cx * px, oy = h / 2 - cy * px;
    const visible = (c) => ox + (c.x + 1) * px > 0 && ox + c.x * px < w && oy + (c.y + 1) * px > 0 && oy + c.y * px < h;
    const gap = px > 4 ? 1 : 0;
    const cell = (c) => ctx.fillRect(ox + c.x * px + gap / 2, oy + c.y * px + gap / 2, px - gap, px - gap);
    // Traces of collapsed rooms: greyed, under everything live.
    ctx.fillStyle = 'rgba(150, 146, 160, 0.22)';
    for (const id in exp.traces || {}) {
      for (const k of exp.traces[id].cells) { const c = DE.parseKey(k); if (visible(c)) cell(c); }
    }
    for (const id in exp.spaces) {
      const sp = exp.spaces[id];
      ctx.fillStyle = `hsla(${sp.meta.hue}, 18%, ${id === p.spaceId ? 46 : 30}%, 0.95)`;
      for (const k of sp.cells) { const c = DE.parseKey(k); if (visible(c)) cell(c); }
    }
    // Live cells standing on a trace: a violet tick (the imprint).
    if (px >= 5) {
      ctx.strokeStyle = 'rgba(181, 156, 255, 0.7)';
      ctx.lineWidth = Math.max(1, px * 0.08);
      ctx.beginPath();
      for (const id in exp.spaces) for (const k of exp.spaces[id].cells) {
        if (!DE.imprintAt(exp, k).length) continue;
        const c = DE.parseKey(k);
        if (!visible(c)) continue;
        ctx.moveTo(ox + (c.x + 0.3) * px, oy + (c.y + 0.7) * px);
        ctx.lineTo(ox + (c.x + 0.7) * px, oy + (c.y + 0.3) * px);
      }
      ctx.stroke();
    }
    // Doors: unopened orange, locked blue, opened green.
    const t = Math.max(1.5, px * 0.12);
    for (const id in exp.spaces) {
      const sp = exp.spaces[id];
      for (const ex of sp.exits) {
        ctx.fillStyle = ex.connectionId ? '#5fbf7a' : isLockedNow(sp, ex) ? '#6fa8d8' : '#c4502a';
        const [ax, ay, bx, by] = edgeEnds(ex.cell.x, ex.cell.y, ex.facing);
        ctx.fillRect(ox + Math.min(ax, bx) * px - t, oy + Math.min(ay, by) * px - t,
          Math.abs(bx - ax) * px + 2 * t, Math.abs(by - ay) * px + 2 * t);
      }
    }
    // Hash ghosts watching you (amber) or following you (magenta).
    for (const g of state.ghosts) {
      if (g.mode === 'wander') continue;
      ctx.fillStyle = g.mode === 'chase' ? 'rgba(214, 120, 255, 0.95)' : 'rgba(255, 195, 90, 0.95)';
      ctx.beginPath();
      ctx.arc(ox + g.x * px, oy + g.y * px, Math.max(2.5, px * 0.28), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(ox + p.x * px, oy + p.y * px);
    ctx.rotate(-p.angle);
    ctx.fillStyle = '#f3ecdc';
    const a = Math.max(px, 7);
    ctx.beginPath();
    ctx.moveTo(0, a * 0.55);
    ctx.lineTo(a * 0.32, -a * 0.3);
    ctx.lineTo(-a * 0.32, -a * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  const mm = $('minimap');
  const mmCtx = mm.getContext('2d');
  function drawMinimap() {
    if (state.bigmap) return;
    drawChart(mm, mmCtx, state.player.x, state.player.y, mm.clientWidth / 26);
  }
  mm.addEventListener('click', () => openBigMap());

  // The enlarged map: M (or tapping the minimap) opens it; drag to pan,
  // wheel or pinch to zoom. Walking pauses while it's open.
  const bm = $('bigmap-canvas');
  const bmCtx = bm.getContext('2d');
  function openBigMap() {
    if (state.paused) return;
    keys.clear();
    state.bigmap = { cx: state.player.x, cy: state.player.y, px: 14 };
    $('bigmap').hidden = false;
    mm.classList.add('hidden');
  }
  function closeBigMap() {
    state.bigmap = null;
    $('bigmap').hidden = true;
    mm.classList.remove('hidden');
  }
  function drawBigMap() {
    if (!state.bigmap) return;
    drawChart(bm, bmCtx, state.bigmap.cx, state.bigmap.cy, state.bigmap.px);
  }
  function zoomBigMap(f, sx, sy) {
    const v = state.bigmap;
    const npx = THREE.MathUtils.clamp(v.px * f, 2.5, 60);
    // Keep the cell under (sx, sy) fixed while zooming.
    const r = bm.getBoundingClientRect();
    const dx = sx - r.left - r.width / 2, dy = sy - r.top - r.height / 2;
    v.cx += dx / v.px - dx / npx;
    v.cy += dy / v.px - dy / npx;
    v.px = npx;
  }
  const bmPointers = new Map();
  let pinchDist = 0;
  bm.addEventListener('pointerdown', (e) => {
    bm.setPointerCapture(e.pointerId);
    bmPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (bmPointers.size === 2) {
      const [a, b] = Array.from(bmPointers.values());
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  bm.addEventListener('pointermove', (e) => {
    const prev = bmPointers.get(e.pointerId);
    if (!prev || !state.bigmap) return;
    const cur = { x: e.clientX, y: e.clientY };
    bmPointers.set(e.pointerId, cur);
    if (bmPointers.size === 1) {
      state.bigmap.cx -= (cur.x - prev.x) / state.bigmap.px;
      state.bigmap.cy -= (cur.y - prev.y) / state.bigmap.px;
    } else if (bmPointers.size === 2) {
      const [a, b] = Array.from(bmPointers.values());
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) zoomBigMap(d / pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinchDist = d;
    }
  });
  const bmUp = (e) => { bmPointers.delete(e.pointerId); pinchDist = 0; };
  bm.addEventListener('pointerup', bmUp);
  bm.addEventListener('pointercancel', bmUp);
  bm.addEventListener('wheel', (e) => {
    if (!state.bigmap) return;
    e.preventDefault();
    zoomBigMap(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  }, { passive: false });
  $('bigmap-center').addEventListener('click', () => {
    if (state.bigmap) { state.bigmap.cx = state.player.x; state.bigmap.cy = state.player.y; }
  });
  $('bigmap-close').addEventListener('click', closeBigMap);

  // ---------------------------------------------------------------------------
  // The expedition record: the seed chain from the root to a locked door.
  // Unlocking one is a checkpoint (continue down, or leave the dungeon);
  // leaving ends the run on the same record.

  const short = (h) => (h ? h.slice(0, 8) : '');
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  let recordMode = null;   // 'checkpoint' | 'extracted' | null
  let recordDoor = null;   // { spaceId, exitId }

  function showRecord(spaceId, exitId, mode) {
    const exp = state.exp;
    const run = state.run;
    if (!exp.spaces[spaceId]) return;
    recordMode = mode;
    recordDoor = { spaceId, exitId };
    const s = DE.stats(exp);
    const chain = DP.seedChain(exp, spaceId);
    const generated = exp.history.filter((ev) => ev.type === 'commit' && !ev.loop).length + 1;
    let deepest = 0;
    for (const id in exp.spaces) deepest = Math.max(deepest, exp.spaces[id].depth);

    const out = mode === 'extracted';
    $('done-kicker').textContent = out ? 'expedition record' : 'checkpoint';
    $('done-title').textContent = out ? 'You left the dungeon.' : 'The locked door gives.';
    $('done-lede').textContent = out
      ? 'What you charted stays charted.'
      : 'Beyond it the dungeon goes on. Continue down, or leave with what you have charted.';
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
    last.append(el('span', 'sid', '⟶'),
      el('span', 'hash', `locked door ${spaceId}/${exitId}, unlocked${out ? '. left the dungeon here' : ''}`));
    list.append(last);

    const mins = Math.floor(run.walked / 60), secs = Math.floor(run.walked % 60);
    const rows = [
      ['rooms standing', s.spaces], ['rooms ever opened', generated], ['loops', s.cycles],
      ['cells charted', s.cells], ['deepest', deepest], ['chain length', chain.length],
      ['shards found', run.shardsFound], ['keys found', run.keysFound], ['checkpoints', run.keysUsed],
      ['collapses', run.collapses], ['rooms collapsed', run.roomsCollapsed], ['charges spent', run.chargesSpent],
      ['charges left', `${run.charges} + ${run.shards}/${RULES.shardsPerCharge}`],
      ['time walked', `${mins}:${String(secs).padStart(2, '0')}`],
    ];
    const dl = $('done-stats');
    dl.innerHTML = '';
    for (const [k, v] of rows) {
      const cell = el('div');
      cell.append(el('dt', null, k), el('dd', null, String(v)));
      dl.append(cell);
    }

    for (const id of ['done-continue', 'done-leave']) $(id).hidden = out;
    for (const id of ['done-new', 'done-chart']) $(id).hidden = !out;
    state.paused = true;
    keys.clear();
    $('done').hidden = false;
  }

  function hideRecord() {
    recordMode = null;
    state.paused = false;
    $('done').hidden = true;
  }

  $('done-continue').addEventListener('click', () => {
    const d = recordDoor;
    hideRecord();
    if (d && state.exp.spaces[d.spaceId]) openDoor(d.spaceId, d.exitId);
  });
  $('done-leave').addEventListener('click', () => {
    state.run.extracted = Object.assign({}, recordDoor);
    savePlayer();
    showRecord(recordDoor.spaceId, recordDoor.exitId, 'extracted');
  });
  $('done-new').addEventListener('click', newExpedition);
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
    state.run.ghosts = state.ghosts.map((g) => ({ id: g.id, x: +g.x.toFixed(3), y: +g.y.toFixed(3), mode: g.mode }));
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
    const savedGhosts = state.run.ghosts || [];
    buildWorld();
    for (const g of savedGhosts) {
      if (exp.registry[DE.key(Math.floor(g.x), Math.floor(g.y))] !== undefined) addGhost({ id: g.id, x: g.x, y: g.y, mode: g.mode });
    }
    state.fx.wobble = state.fx.glitch = 0;
    let sp = spawnPoint(exp);
    if (same && exp.registry[DE.key(Math.floor(savedPlayer.x), Math.floor(savedPlayer.y))] !== undefined) {
      sp = savedPlayer;
    }
    Object.assign(state.player, { x: sp.x, y: sp.y, z: 0, vz: 0, angle: sp.angle || 0, spaceId: null });
    state.climb = null;
    camTarget.set(sp.x * S, 0.6, sp.y * S);
    save();
    savePlayer();
    refreshHud();
    // A run that left the dungeon reopens on its record.
    const x = state.run.extracted;
    if (x && exp.spaces[x.spaceId]) showRecord(x.spaceId, x.exitId, 'extracted');
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
    drawBigMap();
    renderFrame();
    saveClock += dt;
    if (saveClock > 1) { saveClock = 0; savePlayer(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  global.addEventListener('pagehide', savePlayer);

  // Handy from the console.
  Object.assign(DP, { state, scene, camera, renderer, openDoor, doorNear, act, showRecord, addGhost, lightReaches });
})(window);
