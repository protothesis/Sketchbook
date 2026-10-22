// Walk mode: the figure. Its meshes and lantern, collision against walls
// and blocks, the lamp kept out of walls, climbing and crouching.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, RULES, THREE, $, S, JAMB, RADIUS, UNIT, LANTERN, LANTERN_RANGE, OPP, ekey, scene,
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

  const canClimb = (b) => !b.jar && !b.push && b.top - state.player.z > 0.05 &&
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

  function toggleCrouch() {
    state.crouch = !state.crouch;
    $('crouch-btn').classList.toggle('on', state.crouch);
  }

  Object.assign(W, { figure, bodyRig, lantern, lanternMesh, fill, edgeEnds, resolveCollisions, placeLamp,
    canClimb, blockNear, climb, toggleCrouch });
})(window);
