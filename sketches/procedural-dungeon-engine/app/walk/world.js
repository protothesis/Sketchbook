// Walk mode: the world. The wall dither, shared geometry and materials,
// building and tearing down a space's meshes, and which cells connect.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, DP, THREE, S, WALL_H, WALL_T, DOOR_W, DOOR_H, JAMB, UNIT, SWING_ANGLE,
    REVEAL_STEP, REVEAL_DUR, DISSOLVE_DUR, DITHER_APPROACH, SEAM, LOCK_SEAM, OPEN_SEAM, ekey, scene, state,
    world, rebuildExitIndex, isLockedNow, ownsDoorPanel } = W;

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
  const seamMat = new THREE.MeshBasicMaterial({ color: SEAM, side: THREE.DoubleSide }); // double: the door's point can be mirrored
  const lockSeamMat = new THREE.MeshBasicMaterial({ color: LOCK_SEAM, side: THREE.DoubleSide });
  // A door to a lost path (a faint's), waiting for your choice: a waystone's violet.
  const lostSeamMat = new THREE.MeshBasicMaterial({ color: 0xa58cff, side: THREE.DoubleSide });
  // The surface door: weathered pale wood, daylight under it.
  const surfaceMat = withDither(new THREE.MeshLambertMaterial({ color: 0x6f6a62, emissive: 0x15171a }), DOOR_DITHER);
  const surfaceSeamMat = new THREE.MeshBasicMaterial({ color: 0xdcebff, side: THREE.DoubleSide });
  geo.chalk = new THREE.CylinderGeometry(0.03 * S, 0.03 * S, 0.22 * S, 8);
  geo.doorstone = new THREE.BoxGeometry(0.15 * S, 0.21 * S, 0.05 * S);
  geo.doorstoneInset = new THREE.BoxGeometry(0.07 * S, 0.12 * S, 0.006 * S);
  geo.block = new THREE.BoxGeometry(1, 1, 1); // scaled per prop
  geo.post = new THREE.BoxGeometry(WALL_T * S, WALL_H * S, WALL_T * S); // inside-corner filler
  geo.decal = new THREE.PlaneGeometry(S * 0.94, S * 0.94);
  // An opened door's floor arrow: the flat side on the threshold, the point
  // into the room it opened. Collapsing only works that way.
  geo.arrow = new THREE.ShapeGeometry(new THREE.Shape([
    new THREE.Vector2(-DOOR_W * 0.35 * S, 0), new THREE.Vector2(DOOR_W * 0.35 * S, 0), new THREE.Vector2(0, -0.28 * S),
  ])).rotateX(-Math.PI / 2); // flat on the floor, point toward +z
  const arrowMat = new THREE.MeshBasicMaterial({ color: OPEN_SEAM, side: THREE.DoubleSide });

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
    const sealed = DP.pastLock(state.exp, space);
    const h = space.meta.hue / 360;
    const m = {
      seed: space.seed,
      // Past a locked door the floor carries a faint gold warmth.
      floor: [0.15, 0.17, 0.19].map((l) => new THREE.MeshLambertMaterial({
        color: new THREE.Color().setHSL(h, 0.22, l), emissive: sealed ? 0x1c1404 : 0x000000,
      })),
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
    const tileAt = {}, edgeAt = {}; // edgeAt: "x,y,f" -> { eg, beyond } for every wall or door edge

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
        edgeAt[ekey(c.x, c.y, f)] = { eg, beyond: fr.beyond };
      }
    }

    W.addSigil(space, tileAt);
    W.addWell(space, tileAt);
    W.addPushBlocks(space, rec, tileAt);
    W.addSconces(space, edgeAt);
    W.addWaystone(space, rec, tileAt);

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
      if (gc) W.addGhost({ id: gid, x: gc.x + 0.5, y: gc.y + 0.5 });
    }
    W.spawnPixie(space); // and a pixie (also rolled once, ever)

    const spaceKey = space.id + ':' + space.seed;
    for (const item of DP.loot(space)) {
      const key = itemKey(space, item);
      if (state.run.collected.includes(key)) continue;
      if (item.kind === 'key' && !state.run.keyRooms.includes(spaceKey)) continue;
      if (item.kind === 'thread' && state.run.thread) continue; // found once, kept for good
      const tile = tileAt[DE.key(item.cell.x, item.cell.y)];
      if (W.ITEMS[item.kind].cls === 'object') { W.spawnObject(item, key, tile); continue; }
      const mesh = W.itemMesh(item, key);
      mesh.position.set((item.cell.x + 0.5) * S, W.ITEMS[item.kind].cls === 'pickup' ? 0.45 * S : 0, (item.cell.y + 0.5) * S);
      group.add(mesh);
      state.items.set(key, { mesh, item, spaceId: space.id, tile });
    }

    world.add(group);
    state.spaces.set(space.id, rec);
    applyReveal(rec);
  }

  function addDoor(edgeGroup, space, ex, beyond) {
    const gate = !ex.connectionId && DP.isLocked(space, ex); // keeps its iron bands once unlocked
    const locked = isLockedNow(space, ex);
    const surface = ex.kind === 'surface';
    const pivot = new THREE.Group();
    pivot.position.set(-DOOR_W / 2 * S, 0, 0);
    const panel = shadowed(new THREE.Mesh(geo.door, surface ? surfaceMat : ex.connectionId ? doorOpenMat : locked ? lockMat : doorMat));
    panel.position.set(DOOR_W / 2 * S, DOOR_H * S / 2, 0);
    pivot.add(panel);
    if (gate) {
      for (const y of [0.25, 0.75]) {
        const band = new THREE.Mesh(geo.band, bandMat);
        band.position.set(DOOR_W / 2 * S, DOOR_H * S * y, 0);
        pivot.add(band);
      }
    }
    const seam = new THREE.Mesh(geo.seam, surface ? surfaceSeamMat : locked ? lockSeamMat : !ex.connectionId && W.lostPathAt(space.id, ex.id) ? lostSeamMat : seamMat);
    seam.position.set(0, 0.02, 0);
    seam.visible = !ex.connectionId;
    // A closed door's point: off the bar's outer edge, toward where it opens.
    // A child of the bar, so it shows and hides with it.
    const point = new THREE.Mesh(geo.arrow, seam.material);
    point.position.set(0, 0.01, beyond * 0.1 * S);
    point.scale.z = beyond;
    seam.add(point);
    const arrow = new THREE.Mesh(geo.arrow, arrowMat);
    arrow.position.y = 0.03;
    arrow.scale.z = beyond; // local +z, flipped to point out of this space
    arrow.visible = !!DP.rerollThrough(state.exp, space.id, ex);
    edgeGroup.add(pivot, seam, arrow);
    const door = {
      key: space.id + '/' + ex.id, spaceId: space.id, exitId: ex.id, pivot, panel, seam, point, arrow, locked,
      openAngle: -beyond * SWING_ANGLE, t: ex.connectionId ? 1 : 0, dir: 0,
    };
    pivot.rotation.y = door.openAngle * door.t;
    state.doors.set(door.key, door);
  }

  /**
   * Green arrows mark only doors whose room beyond is still provisional
   * (rerollable). Violet seams mark doors to a lost path (game.js).
   */
  function refreshArrows() {
    const exp = state.exp;
    for (const d of state.doors.values()) {
      const sp = exp.spaces[d.spaceId], ex = sp && sp.exits.find((e) => e.id === d.exitId);
      d.arrow.visible = !!(ex && DP.rerollThrough(exp, d.spaceId, ex));
      if (ex && !ex.connectionId && ex.kind !== 'surface' && !d.locked) {
        d.seam.material = d.point.material = W.lostPathAt(d.spaceId, d.exitId) ? lostSeamMat : seamMat;
      }
    }
  }

  function forgetSpace(id) {
    state.sconces = state.sconces.filter((sc) => sc.spaceId !== id);
    state.waystones = state.waystones.filter((st) => st.spaceId !== id);
    state.pushBlocks = state.pushBlocks.filter((b) => b.spaceId !== id);
    state.wells = state.wells.filter((w) => w.spaceId !== id);
    const sg = state.sigils.get(id);
    if (sg && sg.fx) scene.remove(sg.fx.group);
    state.sigils.delete(id);
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
    W.clearGhosts();
    W.clearPixies();
    W.clearJars();
    W.clearMarks();
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

  Object.assign(W, { dither, geo, doorMat, doorOpenMat, seamMat, buildSpace, refreshArrows,
    dissolveSpace, buildWorld, easeOut, easeInOut, applyReveal, applyDissolve, passable });
})(window);
