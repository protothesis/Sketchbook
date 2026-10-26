// Walk mode: hash ghosts. Spawning, light and line of sight, noticing,
// following, and their off-screen markers (markers.js draws them).
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, THREE, S, UNIT, scene, state, lantern, noteUnmade, roomGap,
    lowBlockTop, driftToward, followPath, lightReaches } = W;

  // ---------------------------------------------------------------------------
  // Hash ghosts
  //
  // Floating things that drift through a room and sometimes the next one.
  // They pass open doorways but not walls, closed doors, or
  // tall blocks (it floats over low ones). Noticing you takes two stages: a
  // while in your lantern light and one stops and turns to you ("?"); keep
  // the light on it and a ring fills around the "?"; a full ring and it
  // follows ("!!"), slowly. Light off and the ring drains. "In your light"
  // is a 3D ray from the lamp, so walls and blocks (crouch behind one) hide it. A follower gives up after a couple of seconds out of your
  // light, or once a room lies between you. Contact glitches the screen and
  // drains your psychic stamina (lamp.js); once it touches you, its reach
  // swells for a moment, so you have to hurry clear.
  // (Nearness used to wobble it; that's switched off with WOBBLE below.)
  // Ghosts stay: there's no catching them, and a room can't be rerolled
  // while one is in it. What you can do is move them, since they're drawn
  // to pixies (the ecology's rules, ecology.js), jarred ones included.

  // The proximity wobble: off for now. It cost frames, left artifacts, and
  // felt ghosts through walls (it went by distance alone). The code stays.
  const WOBBLE = false;

  const GHOST = {
    contact: 0.34,       // cells, figure to ghost
    swell: 0.8,          // cells: its reach once it's touching you
    swellShrink: 1,      // s for the reach to shrink back once you're clear
    shySpeed: 0.6,       // cells/s, backing out of steady light (the ecology's flee rule)
    lean: 0.35,          // radians: a ghost drawn to something leans toward it
    markRooms: 1,        // an idle ghost off screen gets a marker (markers.js) this many rooms away or nearer
    markRange: 14,       // cells: and only within this distance
    wanderSpeed: 0.35,
    chaseSpeed: 0.5,     // slow but relentless: far slower than walking (2.4) or crawling (1.1)
    noticeTime: 0.25,    // s in your light before it stops and turns to you ("?"): a moment
    stun: 1.2,           // s a ghost reels after you bump into it, before it follows
    alertPause: 0.8,     // s of "?" before the ring starts filling
    ringTime: 3,         // s of continuous light to fill the ring
    ringDrain: 2.5,      // s for a full ring to drain out of the light
    alertGiveUp: 1.2,    // s unlit with an empty ring before it goes back to wandering
    loseDark: 2,         // s out of your light before a follower gives up
    loseRooms: 2,        // ...or once the rooms between you reach this (one room in between)
    height: 0.55,        // cells: hover height of the head's center
    hoverClear: 0.45,    // over a low block, stay this far above its top
    // How far the lantern "touches", which blocks it floats over and how far it keeps
    // off the rest: the kit's defaults (CREATURE in creatures.js).
  };

  // The status icon: "?" while it's deciding about you, a purple "!!" once
  // it follows. The ring fills clockwise in violet while your light is on
  // it, and rewinds counter-clockwise in a dim colour while it isn't: for
  // "?" it's how close it is to following, for "!!" how long until it gives
  // up. Drawn into a small canvas per ghost, shown as a sprite above it
  // (over walls) and copied into the off-screen edge marker.
  function drawStatus(g) {
    const c = g.alertCanvas, x = c.getContext('2d'), n = c.width;
    x.clearRect(0, 0, n, n);
    const r = n * 0.36, cx = n / 2, cy = n / 2;
    const chasing = g.mode === 'chase';
    const v = chasing ? 1 - g.dark / GHOST.loseDark : Math.min(1, g.ring);
    x.lineWidth = n * 0.09;
    x.strokeStyle = 'rgba(20, 12, 30, 0.7)';
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke();
    if (v > 0.001) {
      x.beginPath();
      if (g.litNow) {
        x.strokeStyle = chasing ? '#ff5fd2' : '#c58bff';
        x.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * v);
      } else {
        x.strokeStyle = '#8a95b8';
        x.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 - Math.PI * 2 * v, true);
      }
      x.stroke();
    }
    x.fillStyle = chasing ? '#d678ff' : '#ffc35a';
    x.font = `bold ${Math.round(n * (chasing ? 0.42 : 0.5))}px system-ui, sans-serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(chasing ? '!!' : '?', cx, cy + n * 0.03);
    g.alertTex.needsUpdate = true;
  }
  const ghostGeo = {
    head: new THREE.SphereGeometry(0.16 * S, 18, 12),
    tail: new THREE.ConeGeometry(0.16 * S, 0.44 * S, 18, 1, true),
    bit: new THREE.BoxGeometry(0.035 * S, 0.035 * S, 0.035 * S),
  };
  const ghostBitMat = new THREE.MeshBasicMaterial({ color: 0xb59cff, transparent: true, opacity: 0.85 });
  // Like the figure: where a block or wall stands between the camera and a
  // ghost, the hidden part shows through as a dithered violet silhouette.
  const ghostSilMat = new THREE.MeshBasicMaterial({
    color: 0xc58bff, transparent: true, opacity: 0.15, depthFunc: THREE.GreaterDepth, depthWrite: false,
  });
  ghostSilMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <clipping_planes_fragment>',
      '#include <clipping_planes_fragment>\nif (mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0) < 0.5) discard;');
  };
  ghostSilMat.customProgramCacheKey = () => 'ghost';

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
    for (const m of [head, tail]) {
      const sil = new THREE.Mesh(m.geometry, ghostSilMat);
      sil.position.copy(m.position);
      sil.rotation.copy(m.rotation);
      sil.renderOrder = 11;
      mesh.add(sil);
    }
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
    const ghost = Object.assign({
      mode: 'wander', lit: 0, dark: 0, ring: 0, alertT: 0, idle: 0, stun: 0, target: null, pause: 0, next: null, pathT: 0,
    }, g, {
      mesh, mat, bits, alert, alertCanvas, alertTex, drawnKey: '', litNow: false,
      h: GHOST.height, phase: Math.random() * 10,
    });
    if (ghost.mode === 'alert' && !ghost.alertT) ghost.alertT = GHOST.alertPause;
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

  function wander(g, dt) {
    if (g.pause > 0) { g.pause -= dt; return; }
    if (!g.target) g.target = W.ecology.seek('ghost', g); // drawn to something (a pixie)?
    for (let i = 0; i < 5 && !g.target; i++) {
      const exp = state.exp;
      const here = exp.registry[DE.key(Math.floor(g.x), Math.floor(g.y))];
      if (here === undefined) return;
      let sp = exp.spaces[here];
      // Mostly its own room; sometimes the room next door.
      if (Math.random() < 0.25) {
        const doors = sp.exits.filter((ex) => ex.connectionId && !W.isClosed(ex.connectionId));
        if (doors.length) {
          const c = exp.connections[doors[Math.floor(Math.random() * doors.length)].connectionId];
          sp = exp.spaces[c.a.spaceId === here ? c.b.spaceId : c.a.spaceId] || sp;
        }
      }
      const cell = DE.parseKey(sp.cells[Math.floor(Math.random() * sp.cells.length)]);
      const tx = cell.x + 0.2 + Math.random() * 0.6, ty = cell.y + 0.2 + Math.random() * 0.6;
      if (!W.ecology.shuns('ghost', tx, ty, g)) g.target = { x: tx, y: ty }; // not into steady light
      g.next = null; g.pathT = 0;
    }
    if (!g.target) return;
    const rule = g.target.rule; // a goal from the ecology carries its rule
    if (followPath(g, g.target.x, g.target.y, rule && rule.speed || GHOST.wanderSpeed, dt)) {
      g.target = null;
      g.pause = rule && rule.pause ? rule.pause[0] + Math.random() * (rule.pause[1] - rule.pause[0]) : 1 + Math.random() * 2.5;
    }
  }

  function updateGhosts(dt) {
    const p = state.player;
    const frozen = state.paused || !!state.bigmap;
    const lamp = { x: lantern.position.x / S, y: lantern.position.z / S, h: lantern.position.y / S };
    let nearest = Infinity, touching = false;
    for (const g of state.ghosts.slice()) {
      // A covered or empty lamp can't be noticed. A ghost held by something
      // it's drawn to (a pixie, by the ecology's rules) forgets you.
      const held = frozen ? g.held : W.ecology.heldBy('ghost', g);
      g.held = held;
      const lit = W.lampOn() && lightReaches(lamp, { x: g.x, y: g.y, h: g.h }) && !held;
      g.litNow = lit;
      if (!frozen && held && g.mode !== 'wander' && g.stun <= 0) {
        g.mode = 'wander'; g.lit = 0; g.ring = 0; g.dark = 0; g.target = null; g.pause = 0;
        W.showCaption('a hash ghost turns from you to the pixie');
      }
      // Steady light (a lit sconce, an awake waystone): it backs away.
      const shy = !frozen && W.ecology.flee('ghost', g);
      if (shy) {
        const d = Math.hypot(shy.x, shy.y) || 1;
        driftToward(g, g.x + shy.x / d * 0.3, g.y + shy.y / d * 0.3, GHOST.shySpeed, dt);
        if (g.mode === 'wander') { g.target = null; g.pause = 0; }
      }
      if (!frozen && !shy) {
        // Bump into one and it's onto you at once, though it reels for a beat first.
        if (g.mode !== 'chase' && Math.hypot(p.x - g.x, p.y - g.y) < GHOST.contact && p.z < 0.6) {
          g.mode = 'chase'; g.ring = 1; g.dark = 0; g.stun = GHOST.stun; g.next = null; g.pathT = 0; g.target = null;
          W.showCaption('you collide with a hash ghost');
        }
        if (g.mode === 'wander') {
          g.lit = lit ? g.lit + dt : Math.max(0, g.lit - dt);
          if (g.lit >= GHOST.noticeTime) {
            // Stage one: it stops and turns to you ("?").
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
            W.showCaption('a hash ghost turns its attention to you');
          } else if (g.idle >= GHOST.alertGiveUp && g.alertT > GHOST.alertPause) {
            g.mode = 'wander'; g.lit = 0; g.pause = 1;
          }
        }
        if (g.mode === 'chase' && g.stun > 0) {
          g.stun = Math.max(0, g.stun - dt); // stunned: holds still, can't lose you yet
          g.dark = 0;
        } else if (g.mode === 'chase') {
          g.dark = lit ? 0 : g.dark + dt;
          const gs = state.exp.registry[DE.key(Math.floor(g.x), Math.floor(g.y))];
          const gap = gs === undefined || p.spaceId === undefined ? Infinity : roomGap(gs, p.spaceId, GHOST.loseRooms);
          if (g.dark >= GHOST.loseDark || gap >= GHOST.loseRooms) {
            g.mode = 'wander'; g.lit = 0; g.ring = 0; g.target = null; g.pause = 1.5;
            W.showCaption('the hash ghost loses your thread');
          } else if (followPath(g, p.x, p.y, GHOST.chaseSpeed, dt) === true && g.next === undefined) {
            // Unreachable from here (closed door between you): drift and wait.
            g.mode = 'wander'; g.target = null;
          }
        }
        // Rise over low blocks, settle back down after.
        const want = Math.max(GHOST.height, lowBlockTop(g.x, g.y) + GHOST.hoverClear);
        g.h += (want - g.h) * Math.min(1, dt * 4);
      }
      const d = Math.hypot(p.x - g.x, p.y - g.y);
      nearest = Math.min(nearest, d);
      // Its reach: the contact radius, swollen while it has hold of you.
      const reach = GHOST.contact + (GHOST.swell - GHOST.contact) * (g.swell || 0);
      const holds = d < reach && p.z < 0.6 && !frozen;
      if (holds) { touching = true; g.swell = 1; }
      else if (!frozen) g.swell = Math.max(0, (g.swell || 0) - dt / GHOST.swellShrink);

      // Look: bob, orbiting "bits", and a hotter, jittery glow when following.
      const chasing = g.mode === 'chase';
      g.phase += dt;
      const jit = g.stun > 0 ? 0.07 : chasing ? 0.02 : 0;
      g.mesh.position.set(
        (g.x + (Math.random() - 0.5) * jit) * S,
        (g.h + Math.sin(g.phase * 1.7) * 0.05) * S,
        (g.y + (Math.random() - 0.5) * jit) * S);
      // Drawn to something: it leans toward it (tilting its wisp), easing in and out.
      const pull = g.held ? g.held.target : g.target && g.target.target;
      const lx = pull ? pull.x - g.x : 0, ly = pull ? pull.y - g.y : 0, ld = Math.hypot(lx, ly) || 1;
      const k = Math.min(1, dt * 3);
      g.mesh.rotation.z += ((pull ? -lx / ld * GHOST.lean : 0) - g.mesh.rotation.z) * k;
      g.mesh.rotation.x += ((pull ? ly / ld * GHOST.lean : 0) - g.mesh.rotation.x) * k;
      g.mat.emissive.setHex(chasing ? 0x6a1f7a : 0x24185a);
      g.mat.opacity = chasing ? 0.62 + Math.sin(g.phase * 23) * 0.08 : 0.5;
      // Status icon while it's deciding about you or following you.
      g.alert.visible = g.mode !== 'wander';
      if (g.alert.visible) {
        const v = chasing ? 1 - g.dark / GHOST.loseDark : g.ring;
        const key = g.mode + (g.litNow ? 1 : 0) + Math.round(v * 60);
        if (key !== g.drawnKey) { drawStatus(g); g.drawnKey = key; }
        const pop = chasing ? 1 : Math.min(1, g.alertT / 0.15);
        g.alert.scale.setScalar(0.42 * S * (0.6 + 0.4 * pop));
      }
      const watching = g.mode === 'alert';
      g.bits.forEach((b, i) => {
        const a = g.phase * (g.stun > 0 ? 0.2 : chasing ? 4 : watching ? 0.6 : g.held ? 3.2 : 1.6) + i * Math.PI / 2;
        b.position.set(Math.cos(a) * 0.24 * S, Math.sin(g.phase * 3 + i) * 0.08 * S, Math.sin(a) * 0.24 * S);
        b.rotation.set(a, a * 1.3, 0);
      });
    }
    state.ghostTouch = touching; // read by the lamp's stamina

    // Screen effects: wobble grows with nearness, glitch with contact. Both
    // hold for a moment once you're clear, then wear off.
    const fx = state.fx;
    const want = WOBBLE ? THREE.MathUtils.clamp(1 - (nearest - 0.4) / 3.6, 0, 1) : 0;
    if (want >= fx.wobble - 0.001) { fx.wobble += (want - fx.wobble) * Math.min(1, dt * 2.5); fx.heldNear = state.time; }
    else if (state.time - fx.heldNear > 1.2) fx.wobble = Math.max(want, fx.wobble - dt * 0.22);
    // Contact: a full-strength flash the moment you collide, settling into a
    // steadier glitch at half strength while you stay in contact.
    if (touching && !fx.touching) { fx.flash = 1; fx.glitch = 1; }
    fx.touching = touching;
    fx.flash = Math.max(0, fx.flash - dt / 0.35);
    if (touching) { fx.glitch = Math.min(1, fx.glitch + dt * 1.6); fx.heldTouch = state.time; }
    else if (state.time - fx.heldTouch > 1.5) fx.glitch = Math.max(0, fx.glitch - dt * 0.3);
  }

  /** An idle ghost's marker icon: a faint ghost, no status. */
  function drawIdle(c) {
    const x = c.getContext('2d'), n = c.width;
    x.clearRect(0, 0, n, n);
    x.fillStyle = 'rgba(217, 210, 255, 0.55)';
    x.beginPath();
    x.arc(n / 2, n * 0.44, n * 0.17, Math.PI, 0);
    x.lineTo(n * 0.67, n * 0.66);
    x.lineTo(n * 0.58, n * 0.6); x.lineTo(n / 2, n * 0.68); x.lineTo(n * 0.42, n * 0.6);
    x.lineTo(n * 0.33, n * 0.66);
    x.closePath();
    x.fill();
  }

  // Off-screen markers: any ghost watching or following you, showing its
  // status, and idle ones in your room or the next, as a faint ghost.
  W.markers.register({
    list: () => state.ghosts,
    wanted: (g) => g.mode !== 'wander' || W.markers.near(g, GHOST.markRooms, GHOST.markRange),
    key: (g) => (g.mode === 'wander' ? 'idle' : g.drawnKey),
    draw(g, cv) {
      if (g.mode === 'wander') { drawIdle(cv); return; }
      const x = cv.getContext('2d');
      x.clearRect(0, 0, cv.width, cv.height);
      x.drawImage(g.alertCanvas, 0, 0);
    },
    cls: (g) => (g.mode === 'chase' ? 'chase' : g.mode === 'wander' ? 'idle' : ''),
  });

  /** Is a ghost in any of these rooms? (A room can't be rerolled while one is.) */
  function ghostIn(ids) {
    const reg = state.exp.registry;
    return state.ghosts.some((g) => ids.has(reg[DE.key(Math.floor(g.x), Math.floor(g.y))]));
  }

  /** Ghosts inside rooms about to collapse come undone with them (noted, nothing gained). */
  function banishGhostsIn(ids) {
    const reg = state.exp.registry;
    const gone = state.ghosts.filter((g) => ids.has(reg[DE.key(Math.floor(g.x), Math.floor(g.y))]));
    for (const g of gone) noteUnmade(g.id, reg[DE.key(Math.floor(g.x), Math.floor(g.y))]);
    gone.forEach(removeGhost);
    return gone.length;
  }

  Object.assign(W, { GHOST, addGhost, clearGhosts, updateGhosts, ghostIn, banishGhostsIn });
})(window);
