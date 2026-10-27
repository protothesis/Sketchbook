// Walk mode: the figure. Its meshes and lantern, collision against walls
// and blocks, the lamp kept out of walls, jumping and crouching.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, RULES, THREE, $, S, JAMB, RADIUS, UNIT, GRAVITY, JUMP, LANTERN, LANTERN_RANGE, OPP, ekey, scene,
    state } = W;

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
  // The figure's shadow: a hard-edged disc cut out of your lamp's light,
  // straight down onto every upward-facing lit surface below its feet (the
  // floor, a block top, a crate), so it lands right across an edge. Only
  // the lamp's light is taken (`opacity`: how much), so where the lamp's
  // light is already blocked, or the lamp is out, there's no shadow; other
  // lights (the fill, sconces) still reach in. Patched into
  // three's Lambert and Phong shaders once, before anything compiles; the
  // uniforms are plain objects, which three shares by reference between
  // materials, so one update a frame (fall()) moves it everywhere.
  const SHADOW = { radius: 0.2, opacity: 0.85, fade: 0.6 }; // cells; fade: the height where it's faintest
  const blobAt = { x: 0, y: -1e4, z: 0, w: 0.2 * S }; // world x, feet y, world z, radius
  const blobLook = { x: 0.85, y: 0.6 * S, z: 0, w: 0 }; // opacity, fade height
  const blobLamp = { x: 0, y: -1e4, z: 0 }; // the lamp's light, world position (placeLamp())
  for (const name of ['lambert', 'phong']) {
    const lib = THREE.ShaderLib[name];
    lib.uniforms.uBlob = { value: blobAt };
    lib.uniforms.uBlobLook = { value: blobLook };
    lib.uniforms.uBlobLamp = { value: blobLamp };
    lib.vertexShader = lib.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBlobWorld;\nvarying float vBlobUp;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n' +
        'vBlobWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n' +
        'vBlobUp = normalize(mat3(modelMatrix) * objectNormal).y;');
    lib.fragmentShader = lib.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vBlobWorld;
varying float vBlobUp;
uniform vec4 uBlob;
uniform vec4 uBlobLook;
uniform vec3 uBlobLamp;
// How much of a point light (its view-space position) reaches here: all of
// it, except your lamp's under the figure's shadow.
float blobCut(vec3 lightView) {
  if (distance(lightView, (viewMatrix * vec4(uBlobLamp, 1.0)).xyz) > 0.05) return 1.0;
  float h = uBlob.y - vBlobWorld.y; // how far below the feet
  if (h < -0.02 || vBlobUp < 0.5) return 1.0;
  float fade = clamp(h / uBlobLook.y, 0.0, 1.0);
  if (distance(vBlobWorld.xz, uBlob.xz) >= uBlob.w * (1.0 - 0.45 * fade)) return 1.0;
  return 1.0 - uBlobLook.x * (1.0 - 0.5 * fade);
}`)
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(
        'getPointLightInfo( pointLight, geometryPosition, directLight );',
        'getPointLightInfo( pointLight, geometryPosition, directLight );\ndirectLight.color *= blobCut( pointLight.position );'));
  }
  const bodyRig = new THREE.Group();
  bodyRig.add(body, head, lanternMesh);
  // When something stands between the camera and the figure (a block, or
  // the solid part of a dithered wall), the hidden part of the figure shows
  // through as a dithered, lantern-orange silhouette. GreaterDepth: these
  // only draw where something nearer already covers the figure.
  const ghostMat = new THREE.MeshBasicMaterial({
    color: 0xffa25c, transparent: true, opacity: 0.85, depthFunc: THREE.GreaterDepth, depthWrite: false,
  });
  ghostMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <clipping_planes_fragment>',
      '#include <clipping_planes_fragment>\nif (mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0) < 0.5) discard;');
  };
  ghostMat.customProgramCacheKey = () => 'ghost';
  // The figure is one thing: where any part of it is drawn (body, head,
  // lamp), it marks the stencil, and the silhouette skips those pixels. So
  // the head in front of the body, or the lamp in front of either, never
  // dithers the figure itself; only something else in front does. The
  // figure draws after every other solid thing (renderOrder), so it only
  // marks pixels where it's really in front: drawn first, it marked pixels a
  // block then covered, and the silhouette never showed.
  const FIGURE_STENCIL = 1;
  for (const mat of [bone, lanternMesh.material]) {
    Object.assign(mat, { stencilWrite: true, stencilRef: FIGURE_STENCIL, stencilFunc: THREE.AlwaysStencilFunc,
      stencilZPass: THREE.ReplaceStencilOp });
  }
  for (const m of [body, head, lanternMesh]) m.renderOrder = 5;
  Object.assign(ghostMat, { stencilWrite: true, stencilRef: FIGURE_STENCIL, stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp });
  // A flash over the whole figure, seen through anything (a chit gathered:
  // dust.js sets its opacity and shows it for a moment). Dithered like the
  // silhouette, on the other half of the checkerboard.
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xb98cff, transparent: true, opacity: 0, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  flashMat.visible = false;
  flashMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <clipping_planes_fragment>',
      '#include <clipping_planes_fragment>\nif (mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0) > 0.5) discard;');
  };
  flashMat.customProgramCacheKey = () => 'figure-flash';
  for (const m of [body, head]) {
    const g = new THREE.Mesh(m.geometry, ghostMat);
    g.position.copy(m.position);
    g.renderOrder = 10;
    const f = new THREE.Mesh(m.geometry, flashMat);
    f.position.copy(m.position);
    f.renderOrder = 11;
    bodyRig.add(g, f);
  }
  figure.add(bodyRig);
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
      const shut = hit && W.isClosed(hit.exit.connectionId);
      if (hit && hit.exit.connectionId && !shut) {
        const dx = bx - ax, dy = by - ay;
        out.push({ ax, ay, bx: ax + dx * JAMB, by: ay + dy * JAMB });
        out.push({ ax: bx - dx * JAMB, ay: by - dy * JAMB, bx, by });
      } else {
        out.push({ ax, ay, bx, by, door: hit && (hit.spaceId === sid || shut) ? hit : null, facing: f });
      }
    }
  }

  /**
   * Wall, door and block edges around a point. Blocks only count if their
   * top rises above `above` (cells): for the figure that's its feet, for the
   * lamp its own height. `ignore`: a block left out (the one you're dragging).
   * `figure`: jars are always walls (you can't stand on one).
   */
  function nearbySegments(p, above, ignore, figure) {
    const segs = [];
    const cx = Math.floor(p.x), cy = Math.floor(p.y);
    const seen = new Set();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      edgeSegments(cx + dx, cy + dy, segs);
      for (const b of state.blockAt.get(DE.key(cx + dx, cy + dy)) || []) {
        if (seen.has(b) || b === ignore || (b.top <= above && !(figure && b.jar))) continue;
        seen.add(b);
        // facing = the side's outward direction.
        segs.push({ ax: b.x0, ay: b.y0, bx: b.x1, by: b.y0, block: b, facing: 'N' },
          { ax: b.x1, ay: b.y0, bx: b.x1, by: b.y1, block: b, facing: 'E' },
          { ax: b.x1, ay: b.y1, bx: b.x0, by: b.y1, block: b, facing: 'S' },
          { ax: b.x0, ay: b.y1, bx: b.x0, by: b.y0, block: b, facing: 'W' });
      }
    }
    return segs;
  }

  /** Push the player out of every nearby wall; returns the doors and blocks touched. */
  function resolveCollisions(p, ignore) {
    const segs = nearbySegments(p, footReach(p), ignore, true); // at or below your feet: walkable
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
    blobLamp.x = lantern.position.x; blobLamp.y = lantern.position.y; blobLamp.z = lantern.position.z;
    // The lamp mesh, back in the body's local frame.
    const wx = q.x - p.x, wy = q.y - p.y;
    lanternMesh.position.x = (wx * c - wy * sn) * S;
    lanternMesh.position.z = (wx * sn + wy * c) * S;
  }

  // ---------------------------------------------------------------------------
  // Jumping. Press to take off; while it's held and you're rising, gravity
  // is lighter, and letting go cuts what rise is left: a tap is a hop, a
  // held press clears a one-unit block. A press just before you land,
  // or just after you walk off an edge, still counts, and coming down with
  // your feet a hair below a block's top puts you on it (JUMP in core.js).

  const MAX_TOP = RULES.climbMaxTop * UNIT + 0.01; // never stand higher than this (head room)

  /** How high a block's top can be and still be floor to you: a little more in the air. */
  function footReach(p) { return Math.min(p.z + (state.jump.air ? JUMP.ledge : 0.05), MAX_TOP); }

  function pressJump() {
    if (state.paused || state.bigmap || state.choice) return;
    state.jump.held = true;
    state.jump.buffer = JUMP.buffer;
  }
  function releaseJump() {
    const p = state.player;
    if (state.jump.held && p.vz > JUMP.cut) p.vz = JUMP.cut;
    state.jump.held = false;
  }

  /** Is the figure's footprint (JUMP.foot around its center) over block b? */
  function under(p, b) {
    const dx = Math.max(b.x0 - p.x, 0, p.x - b.x1), dy = Math.max(b.y0 - p.y, 0, p.y - b.y1);
    return dx * dx + dy * dy < JUMP.foot * JUMP.foot;
  }

  /**
   * Each frame: stand on the tallest block top under the figure's
   * footprint (jars aren't floor), take off if a jump is waiting, and rise
   * or fall. Step off an edge and you drop to whatever is below. The shadow
   * falls on what's below, smaller and fainter the farther down it is.
   */
  function fall(p, dt) {
    const j = state.jump, reach = footReach(p);
    let support = 0;
    const cx = Math.floor(p.x), cy = Math.floor(p.y);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const b of state.blockAt.get(DE.key(cx + dx, cy + dy)) || []) {
        if (!b.jar && b.top <= reach && under(p, b)) support = Math.max(support, b.top);
      }
    }
    j.buffer = Math.max(0, j.buffer - dt);
    j.coyote = p.z <= support && p.vz <= 0 ? JUMP.coyote : Math.max(0, j.coyote - dt);
    if (j.buffer > 0 && j.coyote > 0) {
      j.buffer = 0; j.coyote = 0;
      j.hop = !!(state.carry || state.grab); // a block in your hands: a hop at most
      p.vz = j.hop || !j.held ? JUMP.hop : JUMP.v;
      if (state.crouch) toggleCrouch(); // jumping stands you up
    }
    const before = p.z;
    if (p.z > support || p.vz > 0) {
      p.vz -= (p.vz > 0 && j.held && !j.hop ? JUMP.riseG : GRAVITY) * dt;
      p.z += p.vz * dt;
    }
    if (p.z <= support) {
      // Lifted onto a lip from below: the figure eases up rather than pops.
      j.lift += Math.max(0, support - Math.max(before, p.z));
      p.z = support; p.vz = 0;
    }
    j.lift *= Math.exp(-dt * JUMP.ease);
    j.air = p.z > support;
    if (!j.air) j.ground = support;
    blobAt.x = p.x * S; blobAt.y = (p.z - j.lift) * S + 0.02; blobAt.z = p.y * S;
    blobAt.w = SHADOW.radius * S;
    blobLook.x = SHADOW.opacity; blobLook.y = SHADOW.fade * S;
  }

  function toggleCrouch() {
    state.crouch = !state.crouch;
    $('crouch-btn').classList.toggle('on', state.crouch);
  }

  Object.assign(W, { figure, bodyRig, flashMat, lantern, lanternMesh, fill, edgeEnds, resolveCollisions, placeLamp,
    footReach, pressJump, releaseJump, fall, toggleCrouch, SHADOW });
})(window);
