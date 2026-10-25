// Walk mode: the per-frame update, starting or restoring an expedition, and
// boot. Loads last, so everything else is already on W.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, DP, THREE, $, S, WALL_H, RADIUS, SPEED, RUN,
    CROUCH_SPEED, CROUCH_SCALE, HIDE_RANGE, CLIMB_TIME, GRAVITY, PUSH_TIME, DOOR_SWING,
    DITHER_RADIUS, CAM_OFFSET, LANTERN, renderer, scene, camera, state, world, freshRun,
    isLockedNow, save, savePlayer, dither, doorMat, buildWorld, easeOut, easeInOut,
    applyReveal, applyDissolve, figure, bodyRig, lantern, fill, resolveCollisions, placeLamp,
    canClimb, climb, addMarkToWorld, addJarToWorld, useNear, collectPickups, updateItems,
    pushBlock, updatePushBlocks, updateSconces, noteUnmade, updateJars, updateSigils, doorNear, actionNear, act, openDoor, readInput,
    addGhost, lightReaches, updateGhosts, tmpV2, post, fxPerf, renderFrame, updatePrompt,
    showCaption, stanceEl, refreshHud, notice, REFRESH_HINT, drawMinimap, drawBigMap,
    showRecord, hideRecord } = W;

  // ---------------------------------------------------------------------------
  // Per-frame update

  const camTarget = new THREE.Vector3();
  const tmpV = new THREE.Vector3();

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

    // Safety net: if the figure's center ever ends up inside a block that
    // rises above its feet (say a room rebuilt around it), step out of the
    // nearest side.
    if (!state.climb) {
      for (const b of state.blockAt.get(DE.key(Math.floor(p.x), Math.floor(p.y))) || []) {
        if (b.top <= p.z + 0.05 || p.x <= b.x0 || p.x >= b.x1 || p.y <= b.y0 || p.y >= b.y1) continue;
        const outs = [[p.x - b.x0, -1, 0], [b.x1 - p.x, 1, 0], [p.y - b.y0, 0, -1], [b.y1 - p.y, 0, 1]].sort((a, c) => a[0] - c[0]);
        const [d, ox, oy] = outs[0];
        p.x += ox * (d + RADIUS + 0.01);
        p.y += oy * (d + RADIUS + 0.01);
      }
    }

    // Standing height: the tallest block top under the figure's center.
    // Step off an edge and you drop to whatever is below.
    if (!state.climb) {
      let support = 0;
      for (const b of state.blockAt.get(DE.key(Math.floor(p.x), Math.floor(p.y))) || []) {
        if (!b.jar && b.top <= p.z + 0.05 && p.x > b.x0 && p.x < b.x1 && p.y > b.y0 && p.y < b.y1) support = Math.max(support, b.top);
      }
      if (p.z > support) {
        p.vz = (p.vz || 0) - GRAVITY * dt;
        p.z = Math.max(support, p.z + p.vz * dt);
        if (p.z === support) p.vz = 0;
      } else { p.z = support; p.vz = 0; }
    }

    // Pushing into a closed (unlocked) door, or a climbable block, for a
    // beat opens it / steps up onto it. A wall is a block's way of saying no.
    let pushing = null, pushingBlock = null, pushDir = null, pk = null;
    if (inp.mag > 0) {
      for (const s of touched) {
        const d = DE.DIRS[s.facing];
        // Doors face out of their room; block sides face out of the block.
        const into = s.block ? -(d.x * inp.x + d.y * inp.y) : d.x * inp.x + d.y * inp.y;
        if (into <= 0.5) continue;
        if (s.door && p.z <= 0.05 && !isLockedNow(exp.spaces[s.door.spaceId], s.door.exit)) {
          pushing = s.door; pk = s.door.spaceId + '/' + s.door.exit.id; break;
        }
        if (s.block && s.block.push && p.z <= 0.05) {
          pushingBlock = s.block; pushDir = { x: -d.x, y: -d.y }; pk = 'push:' + s.block.key; break;
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
      if (pushing) {
        if (pushing.exit.kind === 'surface') W.askSurface();
        else openDoor(pushing.spaceId, pushing.exit.id);
      }
      else if (pushDir) pushBlock(pushingBlock, pushDir);
      else climb(pushingBlock, { x: inp.x, y: inp.y });
    }

    collectPickups(p);

    // Entering a new space shows its log line.
    const sid = exp.registry[DE.key(Math.floor(p.x), Math.floor(p.y))];
    if (sid !== p.spaceId) {
      p.spaceId = sid;
      const sp = exp.spaces[sid];
      if (sp && state.arrival && state.arrival.spaceId === sp.id) {
        showCaption(`${sp.id} · ${state.arrival.text}`);
        state.arrival = null;
      } else if (sp) {
        const kind = sp.deadEnd ? 'dead end' : sp.archetype;
        const sealed = DP.pastLock(exp, sp) ? ' · beyond a lock' : '';
        // A hall with an awake waystone that isn't your hearth: passing
        // through doesn't move where you wake; touching the stone does.
        const st = state.waystones.find((o) => o.spaceId === sp.id && o.awake);
        const home = W.hearth();
        const hint = st && home && st !== home ? ` · you'd still wake in ${home.spaceId} · touch the waystone to wake here` : '';
        showCaption(`${sp.id} · ${kind}${sealed} · ${sp.meta.mood} · depth ${sp.depth}${hint}`);
      }
    }

    updatePrompt(state.paused || state.climb ? null : actionNear(p) || useNear(p));

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

    W.updateWells(dt);
    W.updatePixies(dt);
    updateGhosts(dt);
    W.updateCreepers(dt);
    W.updateMarkers(); // off-screen markers, after everything they mark has moved
    updateJars();
    updateSigils(dt);

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
    updateItems();
    updatePushBlocks(dt);
    updateSconces();
    W.updateWaystones();
    W.updateLamp(dt);
    W.updateLampLook(dt); // the lamp's colour, halo, sparks and light (after placeLamp)
  }

  /** Jump the camera to the figure (after travelling, or waking). */
  function snapCamera() {
    const p = state.player;
    camTarget.set(p.x * S, 0.6 + p.z * S * 0.6, p.y * S);
    // Already "in" the room, so its log line doesn't cover the caller's caption.
    p.spaceId = state.exp.registry[DE.key(Math.floor(p.x), Math.floor(p.y))];
  }

  function newExpedition() {
    hideRecord();
    setExpedition(DE.createExpedition(DE.randomRootSeed()), null);
    showCaption('a new expedition. seed ' + state.exp.rootSeed);
  }

  function spawnPoint(exp) {
    const ws = DP.waystone(exp.spaces.s0); // the starter hall: by its waystone
    if (ws) return Object.assign({}, ws.wake);
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

  /**
   * Start playing an expedition. `saved` is { run, player } from a save
   * snapshot (saves.js), or null for a fresh run at the start.
   */
  function setExpedition(exp, saved) {
    state.exp = exp;
    const same = !!(saved && saved.run && saved.run.rootSeed === exp.rootSeed);
    state.run = same ? Object.assign(freshRun(exp.rootSeed), saved.run) : freshRun(exp.rootSeed);
    const savedPlayer = same ? saved.player : null;
    const savedGhosts = state.run.ghosts || [];
    const savedPixies = state.run.pixies || [];
    const savedCreepers = state.run.creepers || [];
    const savedJars = state.run.placedJars || [];
    const savedMarks = state.run.marks || [];
    state.buffReady = false;
    buildWorld();
    for (const j of savedJars) {
      if (exp.registry[DE.key(Math.floor(j.sx / 2), Math.floor(j.sy / 2))] !== undefined) addJarToWorld(j);
      else for (let i = 0; i < j.fill; i++) noteUnmade('jar:' + j.id, null); // its room is gone: the jar broke
    }
    for (const m of savedMarks) {
      if (exp.registry[DE.key(Math.floor(m.sx / 2), Math.floor(m.sy / 2))] !== undefined) addMarkToWorld(m);
    }
    for (const g of savedGhosts) {
      if (exp.registry[DE.key(Math.floor(g.x), Math.floor(g.y))] !== undefined) addGhost({ id: g.id, x: g.x, y: g.y, mode: g.mode });
    }
    for (const o of savedPixies) {
      if (exp.registry[DE.key(Math.floor(o.x), Math.floor(o.y))] !== undefined && !state.pixies.some((q) => q.id === o.id)) W.addPixie(o);
    }
    for (const c of savedCreepers) {
      if (exp.registry[DE.key(Math.floor(c.x), Math.floor(c.y))] !== undefined && !state.creepers.some((q) => q.id === c.id)) W.addCreeper(c);
    }
    state.fx.wobble = state.fx.glitch = state.fx.flash = 0;
    state.ghostTouch = state.wasTouched = false;
    state.creeperDrain = 0;
    state.gutter = null;
    state.arrival = null;
    state.paused = false;
    const fade = $('fade');
    if (fade) fade.classList.remove('on');
    W.ensureWaypoints();
    let sp = spawnPoint(exp);
    if (savedPlayer && exp.registry[DE.key(Math.floor(savedPlayer.x), Math.floor(savedPlayer.y))] !== undefined) {
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
    // So does one that went up to the surface, until you go back down.
    const up = state.run.surfaced && exp.spaces.s0.exits.find((e) => e.kind === 'surface');
    if (up) showRecord('s0', up.id, 'surface');
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

  // Nothing is loaded until the title screen says so (game.js).
  W.bootGame();

  let last = performance.now();
  let saveClock = 0;
  // The loop schedules its next frame first, so one bad frame can't stop the
  // game (that's what froze it: an error mid-update killed the loop while
  // the HTML buttons kept working). The first error shows on screen.
  let errorShown = false;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!state.exp) { renderer.clear(); return; } // the title screen, before any run is loaded
    try {
      state.time += dt;
      update(dt);
      drawMinimap();
      drawBigMap();
      renderFrame(dt);
      saveClock += dt;
      if (saveClock > 1) { saveClock = 0; savePlayer(); }
    } catch (e) {
      console.error(e);
      if (!errorShown) {
        errorShown = true;
        notice(`Something went wrong: ${e && e.message ? e.message : e}. ${REFRESH_HINT}`, 'error');
      }
    }
  }
  requestAnimationFrame(frame);

  // Stale-file check: play.html, the scripts and the CSS are cached
  // separately, so a browser can end up with a mix of versions. If pieces
  // this play.js expects are missing, say so instead of failing oddly later.
  const expectIds = ['view', 'stats', 'lamp', 'lamp-meter', 'lamp-icon', 'popups', 'hotbar', 'use-btn',
    'prompt', 'caption', 'minimap', 'bigmap', 'bigmap-canvas', 'bigmap-hint', 'ghost-edges', 'crouch-btn', 'done',
    'dialog', 'fade', 'title', 'menu-btn'];
  const expectFns = [DE.carve, DE.imprintAt, DE.reserve, DE.restore, DE.tagTraces, DP.saves && DP.saves.write, W.faint, W.lostPathAt, DP.props, DP.ghostSpawn, DP.loot, DP.waypointCount, W.updateLampLook];
  const missing = expectIds.filter((id) => !$(id));
  if (missing.length || expectFns.some((f) => typeof f !== 'function')) {
    notice(`This page's files are out of date (cached copies of different versions). ${REFRESH_HINT}`, 'stale');
  }
  global.addEventListener('pagehide', savePlayer);

  // Handy from the console.
  Object.assign(DP, { state, scene, camera, renderer, openDoor, doorNear, act, showRecord, addGhost, lightReaches, lantern, renderFrame, fxPerf, post, addJarToWorld });

  Object.assign(W, { newExpedition, setExpedition, snapCamera, spawnPoint });
})(window);
