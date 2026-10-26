// Walk mode: save lanterns (GAME-DESIGN.md, section 19). Every hall has one:
// a lantern on a dark stone plinth, always lit with a low red flame. E held
// at it saves: the flame flares, then settles back. It's the only thing that
// sets where you wake, and the first save at a hall's lantern reveals new
// waypoints. Like a lit sconce, its light has a pool (light.js): your lamp
// rests inside it, ghosts and creepers keep out of it, pixies flee it.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, DP, RULES, THREE, S, UNIT, scene, state, save, chargeText } = W;

  // The flame's light and its pool, and the flare when you save.
  const SAVE_LANTERN = {
    color: 0xff4a2a,
    intensity: 2.2,      // its steady, dim glow
    reach: 3.2,          // cells: how far the point light's falloff reaches
    decay: 1.6,
    pool: 1.8,           // cells: where your lamp rests and creatures keep out
    flicker: 0.14,       // of its brightness: a slow, uneven flicker
    flare: 9,            // brightness at the height of a save's flare
    flarePool: 2.6,      // cells: the pool, flaring
    flareTime: 1.4,      // seconds back down to its dim flame
  };
  const LANTERN_LIGHTS = 2; // real lights, given to the lanterns nearest you

  const PLINTH_UNITS = 2;
  const PLINTH_H = PLINTH_UNITS * UNIT;
  const FLAME_Y = PLINTH_H + 0.13; // cells above the floor

  const geo = {
    plinth: new THREE.BoxGeometry(1, 1, 1),
    base: new THREE.BoxGeometry(0.24 * S, 0.035 * S, 0.24 * S),
    glass: new THREE.BoxGeometry(0.17 * S, 0.19 * S, 0.17 * S),
    post: new THREE.BoxGeometry(0.025 * S, 0.21 * S, 0.025 * S),
    cap: new THREE.ConeGeometry(0.15 * S, 0.09 * S, 4),
    ring: new THREE.TorusGeometry(0.035 * S, 0.008 * S, 6, 12),
    flame: new THREE.ConeGeometry(0.035 * S, 0.11 * S, 8),
  };
  const plinthMat = new THREE.MeshLambertMaterial({ color: 0x2b2830 });
  const ironMat = new THREE.MeshLambertMaterial({ color: 0x2a2420, emissive: 0x080504 });
  const flameColor = new THREE.Color(SAVE_LANTERN.color);

  // A fixed pool of real lights (intensity 0 when idle): changing the number
  // of lights would recompile every material.
  const lights = Array.from({ length: LANTERN_LIGHTS }, () => {
    const l = new THREE.PointLight(SAVE_LANTERN.color, 0, SAVE_LANTERN.reach * S, SAVE_LANTERN.decay);
    scene.add(l);
    W.light.addPooledLight(l);
    return l;
  });

  /** A hall's save lantern, standing on its cell's tile (so it rises with the room). */
  function addLantern(space, rec, tileAt) {
    const ls = DP.saveLantern(space);
    if (!ls) return;
    const key = space.id + ':' + space.seed;
    const tile = tileAt[DE.key(ls.cell.x, ls.cell.y)];
    const cx = (ls.x0 + ls.x1) / 2, cy = (ls.y0 + ls.y1) / 2;
    const group = new THREE.Group();
    group.position.set(cx * S - tile.position.x, 0.05, cy * S - tile.position.z);
    tile.add(group);
    const plinth = new THREE.Mesh(geo.plinth, plinthMat);
    plinth.scale.set((ls.x1 - ls.x0) * S, PLINTH_H * S, (ls.y1 - ls.y0) * S);
    plinth.position.y = PLINTH_H * S / 2;
    plinth.castShadow = plinth.receiveShadow = true;
    // The lantern: an iron base and cap, four posts, glowing glass, a flame.
    const top = new THREE.Group();
    top.position.y = PLINTH_H * S;
    const base = new THREE.Mesh(geo.base, ironMat);
    base.position.y = 0.0175 * S;
    const glassMat = new THREE.MeshBasicMaterial({ color: flameColor.clone(), transparent: true, opacity: 0.35, depthWrite: false });
    const glass = new THREE.Mesh(geo.glass, glassMat);
    glass.position.y = 0.035 * S + 0.095 * S;
    const cap = new THREE.Mesh(geo.cap, ironMat);
    cap.position.y = 0.035 * S + 0.21 * S + 0.045 * S;
    cap.rotation.y = Math.PI / 4;
    const ring = new THREE.Mesh(geo.ring, ironMat);
    ring.position.y = cap.position.y + 0.06 * S;
    top.add(base, glass, cap, ring);
    for (const [px, pz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const post = new THREE.Mesh(geo.post, ironMat);
      post.position.set(px * 0.085 * S, 0.035 * S + 0.105 * S, pz * 0.085 * S);
      post.castShadow = true;
      top.add(post);
    }
    const flameMat = new THREE.MeshBasicMaterial({ color: flameColor.clone() });
    const flame = new THREE.Mesh(geo.flame, flameMat);
    flame.position.y = 0.035 * S + 0.07 * S;
    top.add(flame);
    for (const m of [base, cap]) m.castShadow = true;
    group.add(plinth, top);
    // Solid, and too tall to climb.
    const blk = { x0: ls.x0, y0: ls.y0, x1: ls.x1, y1: ls.y1, units: PLINTH_UNITS + 1, top: PLINTH_H + 0.3, spaceId: space.id, stone: true };
    const k = DE.key(ls.cell.x, ls.cell.y);
    state.blockAt.set(k, (state.blockAt.get(k) || []).concat(blk));
    const ln = {
      key, spaceId: space.id, ws: ls, x: cx, y: cy, tile, flame, glassMat, flameMat,
      phase: ls.cell.x * 1.3 + ls.cell.y * 0.7, flare: 0,
    };
    state.lanterns = state.lanterns.filter((o) => o.key !== key).concat(ln);
  }

  const REACH = 0.75;
  /** E at a save lantern in your room, within reach and roughly ahead. */
  function lanternNear(p) {
    if (p.z > 0.05) return null;
    const here = state.exp.registry[DE.key(Math.floor(p.x), Math.floor(p.y))];
    const fx = Math.sin(p.angle), fy = Math.cos(p.angle);
    for (const ln of state.lanterns) {
      if (ln.spaceId !== here) continue;
      const dx = ln.x - p.x, dy = ln.y - p.y, d = Math.hypot(dx, dy);
      if (d >= REACH || (dx * fx + dy * fy) / (d || 1) < 0.2) continue;
      return { action: 'save', lantern: ln };
    }
    return null;
  }

  /** Save at a lantern: it flares, you'll wake here, and a first save here may reveal waypoints. */
  function saveAt(ln) {
    const run = state.run, sp = state.exp.spaces[ln.spaceId];
    const first = !run.lanterns[ln.key] && !!sp.parentId; // the starter hall's waypoints come with the run
    run.lanterns[ln.key] = true;
    run.hearth = ln.key;
    ln.flare = 1;
    let n = 0;
    if (first) {
      n = W.revealWaypoints(DP.centerOf(sp), DP.waypointCount(state.exp, sp));
      save();
    }
    W.saveCheckpoint();
    W.showCaption('the lantern flares · saved · you\'ll wake here' +
      (first ? (n ? ` · ${n} new waypoint${n === 1 ? '' : 's'} on your map` : ' · nothing new stirs') : ''));
    W.refreshHud();
  }

  /** Where you wake: the lantern you last saved at, if it's still there, else the start's. */
  function hearth() {
    return state.lanterns.find((o) => o.key === state.run.hearth) ||
      state.lanterns.find((o) => o.spaceId === 's0') || null;
  }

  /** The flame flickers, slow and uneven; a flare eases back down; the nearest lanterns get the lights. */
  function updateLanterns(dt) {
    const t = state.time, p = state.player;
    for (const ln of state.lanterns) {
      ln.flare = Math.max(0, ln.flare - dt / SAVE_LANTERN.flareTime);
      const k = brightness(ln) / SAVE_LANTERN.intensity;
      ln.flame.scale.set(1, 0.85 + 0.25 * k + 0.12 * Math.sin(t * 9 + ln.phase), 1);
      ln.glassMat.opacity = Math.min(0.9, 0.25 + 0.06 * k);
    }
    const near = state.lanterns.filter((ln) => ln.tile.scale.x > 0.5)
      .map((ln) => ({ ln, d: Math.hypot(ln.x - p.x, ln.y - p.y) }))
      .filter((o) => o.d < 12).sort((a, b) => a.d - b.d);
    shown = near.slice(0, LANTERN_LIGHTS).map((o) => o.ln);
    lights.forEach((l, i) => {
      const o = near[i];
      if (!o) { l.intensity = 0; return; }
      l.color.setHex(SAVE_LANTERN.color);
      l.distance = SAVE_LANTERN.reach * S;
      l.position.set(o.ln.x * S, FLAME_Y * S, o.ln.y * S);
      l.intensity = brightness(o.ln);
    });
  }

  /** The flame's brightness now: dim and uneven, flaring when you've just saved. */
  function brightness(ln) {
    const t = state.time, f = W.easeOut(ln.flare);
    const flick = 1 + SAVE_LANTERN.flicker * (0.6 * Math.sin(t * 5.3 + ln.phase) + 0.4 * Math.sin(t * 12.7 + ln.phase * 2));
    return SAVE_LANTERN.intensity * flick * (1 - f) + SAVE_LANTERN.flare * f;
  }

  /** A lantern's pool (light.js): always lit, wider while it flares. */
  function lanternLight(ln) {
    const f = W.easeOut(ln.flare);
    return { x: ln.x, y: ln.y, r: SAVE_LANTERN.pool + (SAVE_LANTERN.flarePool - SAVE_LANTERN.pool) * f, from: { x: ln.x, y: ln.y, h: FLAME_Y } };
  }
  /** The pools of the lanterns that have real lights this frame (the ones drawn). */
  let shown = [];
  const lanternPools = () => shown.map(lanternLight);

  /** On the maps: a small lantern, glowing red; brighter where you'd wake. */
  function drawLanternMarks(ctx, ox, oy, px) {
    const home = hearth();
    for (const ln of state.lanterns) {
      const mx = ox + ln.x * px, my = oy + ln.y * px, r = Math.max(3, px * 0.26);
      ctx.save();
      ctx.shadowColor = 'rgba(255, 80, 50, 0.9)';
      ctx.shadowBlur = ln === home ? 10 : 5;
      ctx.fillStyle = ln === home ? '#ff7a52' : '#c2462c';
      ctx.beginPath();
      ctx.moveTo(mx, my - r * 1.3);
      ctx.quadraticCurveTo(mx + r, my - r * 0.1, mx, my + r);
      ctx.quadraticCurveTo(mx - r, my - r * 0.1, mx, my - r * 1.3);
      ctx.fill();
      ctx.restore();
    }
  }

  Object.assign(W, { SAVE_LANTERN, addLantern, lanternNear, saveAt, hearth, updateLanterns, lanternLight, lanternPools, drawLanternMarks });
})(window);
