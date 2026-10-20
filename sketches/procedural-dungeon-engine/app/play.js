// Walk mode: a third-person 3D client of the engine (see PLAY.md).
//
// Every unresolved exit is a closed door. Pushing one open calls expand +
// commit straight away, and the new space assembles itself outward from the
// threshold. Logic runs in grid units (1 = one cell, y = grid y); rendering
// scales by S into three.js world space, with grid y mapped to world z.
// Shares the map view's autosave, so both pages are the same expedition.
(function (global) {
  'use strict';

  const DE = global.DungeonEngine;
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
  const USE_RANGE = 0.6;    // E / Space reach to a door's midpoint
  const DOOR_SWING = 0.6;   // seconds
  const SWING_ANGLE = THREE.MathUtils.degToRad(92);
  const REVEAL_STEP = 0.07; // seconds of delay per cell from the door
  const REVEAL_DUR = 0.45;
  const CUT_RANGE_X = 3.5, CUT_RANGE_Y = 3;
  const CAM_OFFSET = new THREE.Vector3(0, 10.5, 7.5);
  const SEAM = 0xc4502a;    // the map view's open-doorway orange
  const BG = 0x07060a;
  const LANTERN = 16;       // point-light intensity (three.js physical units)

  const OPP = DE.OPPOSITE;
  const ekey = (x, y, f) => x + ',' + y + ',' + f;

  // ---------------------------------------------------------------------------
  // three.js scaffolding

  const canvas = $('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.Fog(BG, 13, 28);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  scene.add(new THREE.AmbientLight(0x8a90b8, 0.35));

  const geo = {
    tile: new THREE.BoxGeometry(S * 0.96, 0.1, S * 0.96),
    wall: new THREE.BoxGeometry(S, WALL_H * S, WALL_T * S),
    jamb: new THREE.BoxGeometry(JAMB * S, WALL_H * S, WALL_T * S),
    lintel: new THREE.BoxGeometry(DOOR_W * S, (WALL_H - DOOR_H) * S, WALL_T * S),
    door: new THREE.BoxGeometry(DOOR_W * S * 0.97, DOOR_H * S * 0.97, 0.05 * S),
    seam: new THREE.BoxGeometry(DOOR_W * S * 0.9, 0.04, 0.2 * S),
  };
  const doorMat = new THREE.MeshLambertMaterial({ color: 0x2b211b, emissive: 0x1a0904 });
  const doorOpenMat = new THREE.MeshLambertMaterial({ color: 0x2b211b });
  const seamMat = new THREE.MeshBasicMaterial({ color: SEAM });

  const matCache = {};
  function spaceMats(space) {
    if (matCache[space.id] && matCache[space.id].seed === space.seed) return matCache[space.id];
    const h = space.meta.hue / 360;
    const m = {
      seed: space.seed,
      floor: [0.15, 0.17, 0.19].map((l) => new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(h, 0.22, l) })),
      wall: new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(h, 0.2, 0.32) }),
    };
    matCache[space.id] = m;
    return m;
  }

  // ---------------------------------------------------------------------------
  // State

  const state = {
    exp: null,
    exitAt: new Map(),   // "x,y,f" -> { spaceId, exit }
    spaces: new Map(),   // spaceId -> { group, edges[], tiles[], revealStart|null }
    doors: new Map(),    // "spaceId/exitId" -> door
    player: { x: 0.5, y: 0.5, angle: 0, spaceId: null, phase: 0 },
    push: { key: null, t: 0 },
    time: 0,
    minimap: true,
  };
  const world = new THREE.Group();
  scene.add(world);

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

  function buildSpace(space, reveal) {
    disposeSpace(space.id);
    const exp = state.exp;
    const mats = spaceMats(space);
    const group = new THREE.Group();
    const rec = { group, edges: [], tiles: [], revealStart: reveal ? state.time : null };
    const entry = space.exits[0] && space.parentId ? space.exits[0].cell : DE.parseKey(space.cells[0]);

    for (const k of space.cells) {
      const c = DE.parseKey(k);
      const dist = Math.abs(c.x - entry.x) + Math.abs(c.y - entry.y);
      const tile = new THREE.Mesh(geo.tile, mats.floor[(c.x * 7 + c.y * 13 + 999) % 3]);
      tile.position.set((c.x + 0.5) * S, -0.05, (c.y + 0.5) * S);
      tile.userData.delay = dist * REVEAL_STEP;
      group.add(tile);
      rec.tiles.push(tile);

      for (const f of DE.FACINGS) {
        const n = DE.step(c, f);
        if (exp.registry[DE.key(n.x, n.y)] === space.id) continue;
        const fr = edgeFrame(c.x, c.y, f);
        const eg = new THREE.Group();
        eg.position.set(fr.gx * S, 0, fr.gy * S);
        eg.rotation.y = fr.rot;
        const hit = state.exitAt.get(ekey(c.x, c.y, f));
        if (hit) {
          const jl = new THREE.Mesh(geo.jamb, mats.wall);
          jl.position.set(-(0.5 - JAMB / 2) * S, WALL_H * S / 2, 0);
          const jr = jl.clone();
          jr.position.x = -jl.position.x;
          const li = new THREE.Mesh(geo.lintel, mats.wall);
          li.position.set(0, (DOOR_H + (WALL_H - DOOR_H) / 2) * S, 0);
          eg.add(jl, jr, li);
          if (ownsDoorPanel(space.id, hit.exit)) addDoor(eg, space.id, hit.exit, fr.beyond);
        } else {
          const w = new THREE.Mesh(geo.wall, mats.wall);
          w.position.y = WALL_H * S / 2;
          eg.add(w);
        }
        eg.userData = { gx: fr.gx, gy: fr.gy, ns: f === 'N' || f === 'S', cut: 1, delay: dist * REVEAL_STEP + 0.12 };
        group.add(eg);
        rec.edges.push(eg);
      }
    }
    world.add(group);
    state.spaces.set(space.id, rec);
    applyReveal(rec);
  }

  function addDoor(edgeGroup, spaceId, ex, beyond) {
    const pivot = new THREE.Group();
    pivot.position.set(-DOOR_W / 2 * S, 0, 0);
    const panel = new THREE.Mesh(geo.door, ex.connectionId ? doorOpenMat : doorMat);
    panel.position.set(DOOR_W / 2 * S, DOOR_H * S / 2, 0);
    pivot.add(panel);
    const seam = new THREE.Mesh(geo.seam, seamMat);
    seam.position.set(0, 0.02, 0);
    seam.visible = !ex.connectionId;
    edgeGroup.add(pivot, seam);
    const door = {
      key: spaceId + '/' + ex.id, spaceId, exitId: ex.id, pivot, panel, seam,
      openAngle: -beyond * SWING_ANGLE, t: ex.connectionId ? 1 : 0, opening: false,
    };
    pivot.rotation.y = door.openAngle * door.t;
    state.doors.set(door.key, door);
  }

  function disposeSpace(id) {
    const rec = state.spaces.get(id);
    if (!rec) return;
    world.remove(rec.group);
    state.spaces.delete(id);
    for (const [k, d] of state.doors) if (d.spaceId === id) state.doors.delete(k);
  }

  function buildWorld() {
    for (const id of Array.from(state.spaces.keys())) disposeSpace(id);
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
    for (const e of rec.edges) {
      e.scale.y = Math.max(0.001, revealAmount(rec, e.userData.delay) * e.userData.cut);
    }
    if (rec.revealStart !== null && state.time - rec.revealStart > 3) rec.revealStart = null;
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
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.2 * S, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;
  const bodyRig = new THREE.Group();
  bodyRig.add(body, head, lanternMesh);
  figure.add(bodyRig, shadow);
  const lantern = new THREE.PointLight(0xffb36b, LANTERN, 13 * S, 1.7);
  lantern.position.set(0.14 * S, 0.75 * S, 0.12 * S);
  figure.add(lantern);
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
  // Doors

  function closedDoorNear(p) {
    const cx = Math.floor(p.x), cy = Math.floor(p.y);
    let best = null, bestD = USE_RANGE;
    const sp = state.exp.spaces[state.exp.registry[DE.key(cx, cy)]];
    if (!sp) return null;
    for (const ex of sp.exits) {
      if (ex.connectionId) continue;
      const [ax, ay, bx, by] = edgeEnds(ex.cell.x, ex.cell.y, ex.facing);
      const d = Math.hypot(p.x - (ax + bx) / 2, p.y - (ay + by) / 2);
      if (d < bestD) { bestD = d; best = { spaceId: sp.id, exit: ex }; }
    }
    return best;
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
      door.opening = true;
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
    refreshStats();
  }

  // ---------------------------------------------------------------------------
  // Input

  const keys = new Set();
  const stick = { active: false, id: null, ox: 0, oy: 0, vx: 0, vy: 0 };

  global.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    keys.add(k);
    if (k === 'e' || k === ' ') {
      const d = closedDoorNear(state.player);
      if (d) openDoor(d.spaceId, d.exit.id);
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

  // New map needs a second tap/press within a few seconds; window.confirm()
  // is unreliable (some embedded and in-app viewers block it silently).
  const newBtn = $('new-btn');
  let newArmedUntil = 0;
  function requestNewMap() {
    if (performance.now() < newArmedUntil) {
      newArmedUntil = 0;
      newBtn.classList.remove('armed');
      newBtn.textContent = 'New map';
      setExpedition(DE.createExpedition(DE.randomRootSeed()), null);
      showCaption('a new expedition. seed ' + state.exp.rootSeed);
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

  const stickEl = $('stick');
  const knob = stickEl.querySelector('.knob');
  const STICK_R = 50;
  canvas.addEventListener('pointerdown', (e) => {
    if (stick.active) return;
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

  function update(dt) {
    const p = state.player;
    const exp = state.exp;
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
    const touched = resolveCollisions(p);
    if (exp.registry[DE.key(Math.floor(p.x), Math.floor(p.y))] === undefined) { p.x = prev.x; p.y = prev.y; }

    // Pushing into a closed door for a beat opens it.
    let pushing = null;
    if (inp.mag > 0) {
      for (const s of touched) {
        const d = DE.DIRS[s.facing];
        if (d.x * inp.x + d.y * inp.y > 0.5) { pushing = s.door; break; }
      }
    }
    const pk = pushing ? pushing.spaceId + '/' + pushing.exit.id : null;
    if (pk && pk === state.push.key) state.push.t += dt;
    else { state.push.key = pk; state.push.t = 0; }
    if (pushing && state.push.t >= PUSH_TIME) {
      state.push.key = null;
      openDoor(pushing.spaceId, pushing.exit.id);
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

    const near = closedDoorNear(p);
    const prompt = $('prompt');
    prompt.hidden = !near;
    if (near) prompt.textContent = state.push.key ? 'opening…' : 'a closed door. push, or press E';

    // Figure
    p.phase += moving ? dt * 11 * (inp.run ? 1.4 : 1) : 0;
    figure.position.set(p.x * S, 0, p.y * S);
    figure.rotation.y = p.angle;
    bodyRig.position.y = moving ? Math.abs(Math.sin(p.phase)) * 0.05 * S : 0;
    lantern.intensity = LANTERN * (0.94 + 0.06 * Math.sin(state.time * 9.3) * Math.sin(state.time * 3.1));

    // Camera: fixed angle, smoothed follow.
    const target = new THREE.Vector3(p.x * S, 0.6, p.y * S);
    camTarget.lerp(target, 1 - Math.exp(-dt * 7));
    camera.position.copy(camTarget).add(CAM_OFFSET);
    camera.lookAt(camTarget);

    // Doors swinging
    for (const d of state.doors.values()) {
      if (!d.opening) continue;
      d.t = Math.min(1, d.t + dt / DOOR_SWING);
      d.pivot.rotation.y = d.openAngle * easeOut(d.t);
      if (d.t >= 1) d.opening = false;
    }

    // Cutaway for walls just south of the player, then reveal.
    for (const rec of state.spaces.values()) {
      for (const e of rec.edges) {
        const u = e.userData;
        const south = u.ns ? u.gy > p.y + 0.05 : u.gy > p.y + 0.6;
        const cut = south && u.gy - p.y < CUT_RANGE_Y && Math.abs(u.gx - p.x) < CUT_RANGE_X;
        u.cut += ((cut ? 0.12 : 1) - u.cut) * Math.min(1, dt * 10);
      }
      applyReveal(rec);
    }
  }

  const camTarget = new THREE.Vector3();

  // ---------------------------------------------------------------------------
  // HUD

  let captionTimer = null;
  function showCaption(text) {
    const el = $('caption');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(captionTimer);
    captionTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function refreshStats() {
    const s = DE.stats(state.exp);
    $('stats').textContent = `seed ${state.exp.rootSeed} · ${s.spaces} spaces · ${s.openExits} closed doors · ${s.cycles} loops`;
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
    ctx.fillStyle = '#c4502a';
    for (const id in exp.spaces) {
      for (const ex of exp.spaces[id].exits) {
        if (ex.connectionId) continue;
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
  // Persistence (shared with the map view)

  function save() {
    try { localStorage.setItem(STORAGE_KEY, DE.exportRecord(state.exp)); } catch (e) { /* storage unavailable */ }
  }
  function savePlayer() {
    const p = state.player;
    try {
      localStorage.setItem(PLAYER_KEY, JSON.stringify({ rootSeed: state.exp.rootSeed, x: p.x, y: p.y, angle: p.angle }));
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
    buildWorld();
    let sp = spawnPoint(exp);
    if (savedPlayer && savedPlayer.rootSeed === exp.rootSeed &&
        exp.registry[DE.key(Math.floor(savedPlayer.x), Math.floor(savedPlayer.y))] !== undefined) {
      sp = savedPlayer;
    }
    Object.assign(state.player, { x: sp.x, y: sp.y, angle: sp.angle || 0, spaceId: null });
    camTarget.set(sp.x * S, 0.6, sp.y * S);
    save();
    savePlayer();
    refreshStats();
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

  global.DungeonPlay = { state, scene, camera, renderer, openDoor }; // handy from the console
})(window);
