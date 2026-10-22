// Walk mode: hash ghosts. Spawning, light and line of sight, noticing,
// following, and their markers at the screen edge.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, RULES, THREE, $, S, UNIT, scene, camera, state, savePlayer, passable, lantern,
    jarCatches, noteUnmade } = W;

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
  // light, or once a room lies between you. Nearness wobbles the screen;
  // contact glitches it.
  // The only way to be rid of one is to collapse the rooms it's in, which
  // unravels it and leaves you an echo (a resource with no use yet).

  const GHOST = {
    contact: 0.34,       // cells, figure to ghost
    wanderSpeed: 0.35,
    chaseSpeed: 0.5,     // slow but relentless: far slower than walking (2.4) or crawling (1.1)
    lightRange: 4.5,     // cells: how far the lantern "touches"
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
    tall: 1.5 * UNIT,    // blocks taller than this are obstacles; lower ones it floats over
    radius: 0.14,        // kept this far from tall blocks
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
      mesh, mat, bits, alert, alertCanvas, alertTex, drawnKey: '', litNow: false, edge: null,
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
    if (g.edge) g.edge.remove();
    state.ghosts = state.ghosts.filter((o) => o !== g);
  }

  function clearGhosts() { for (const g of state.ghosts.slice()) removeGhost(g); }

  const blocksAt = (cx, cy) => state.blockAt.get(DE.key(cx, cy)) || [];

  /** Is this half-cell taken by a block too tall to float over? */
  function subBlocked(sx, sy) {
    const x = (sx + 0.5) / 2, y = (sy + 0.5) / 2;
    for (const b of blocksAt(Math.floor(x), Math.floor(y))) {
      if (!b.jar && b.top > GHOST.tall && x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1) return true;
    }
    return false;
  }

  /** Top of the highest low block under a point (what a ghost floats over). */
  function lowBlockTop(x, y) {
    let top = 0;
    for (const b of blocksAt(Math.floor(x), Math.floor(y))) {
      if (b.top <= GHOST.tall && x > b.x0 - 0.1 && x < b.x1 + 0.1 && y > b.y0 - 0.1 && y < b.y1 + 0.1) top = Math.max(top, b.top);
    }
    return top;
  }

  /** Does a ray (from f to t, both {x, y, h} in cells) pass through block b? */
  function rayHitsBlock(f, t, b) {
    let t0 = 0, t1 = 1;
    const axes = [[f.x, t.x - f.x, b.x0, b.x1], [f.y, t.y - f.y, b.y0, b.y1], [f.h, t.h - f.h, 0, b.top]];
    for (const [o, d, lo, hi] of axes) {
      if (Math.abs(d) < 1e-9) { if (o <= lo || o >= hi) return false; continue; }
      let a = (lo - o) / d, c = (hi - o) / d;
      if (a > c) { const s2 = a; a = c; c = s2; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, c);
      if (t0 >= t1) return false;
    }
    return t1 > 0.01 && t0 < 0.99;
  }

  /**
   * Does the lantern's light reach a point? A 3D ray from the lamp (its real
   * position and height, so crouching lowers it) to the target: in range,
   * not through a wall or closed door, and not through any block. This is
   * the same light that casts the shadows you see, so in shadow = unseen.
   */
  function lightReaches(f, t) {
    const d = Math.hypot(t.x - f.x, t.y - f.y);
    if (d > GHOST.lightRange) return false;
    const n = Math.max(1, Math.ceil(d / 0.08));
    let cx = Math.floor(f.x), cy = Math.floor(f.y);
    const cells = [[cx, cy]];
    for (let i = 1; i <= n; i++) {
      const nx = Math.floor(f.x + (t.x - f.x) * i / n), ny = Math.floor(f.y + (t.y - f.y) * i / n);
      if (nx === cx && ny === cy) continue;
      if (nx !== cx && ny !== cy) {
        if (!((passable(cx, cy, nx, cy) && passable(nx, cy, nx, ny)) ||
              (passable(cx, cy, cx, ny) && passable(cx, ny, nx, ny)))) return false;
        cells.push([nx, cy], [cx, ny]);
      } else if (!passable(cx, cy, nx, ny)) return false;
      cells.push([nx, ny]);
      cx = nx; cy = ny;
    }
    const seen = new Set();
    for (const [x, y] of cells) {
      for (const b of blocksAt(x, y)) {
        if (seen.has(b)) continue;
        seen.add(b);
        if (rayHitsBlock(f, t, b)) return false;
      }
    }
    return true;
  }

  /** Next half-cell on a shortest floating path (around tall blocks, through open doors). */
  function nextSubToward(fsx, fsy, tsx, tsy, limit) {
    const start = fsx + ',' + fsy, goal = tsx + ',' + tsy;
    if (start === goal) return null;
    const prev = new Map([[start, null]]);
    const q = [[fsx, fsy]];
    for (let h = 0; h < q.length && prev.size < limit; h++) {
      const [x, y] = q[h];
      const cx = Math.floor(x / 2), cy = Math.floor(y / 2);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
        if (prev.has(k)) continue;
        const ncx = Math.floor(nx / 2), ncy = Math.floor(ny / 2);
        if ((ncx !== cx || ncy !== cy) && !passable(cx, cy, ncx, ncy)) continue;
        if (ncx === cx && ncy === cy && state.exp.registry[DE.key(cx, cy)] === undefined) continue;
        if (subBlocked(nx, ny) && k !== goal) continue;
        prev.set(k, x + ',' + y);
        if (k === goal) {
          let c = k;
          while (prev.get(c) !== start) c = prev.get(c);
          const [sx, sy] = c.split(',').map(Number);
          return { x: sx, y: sy };
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

  /**
   * Drift toward a point: only into cells it can float between and never
   * into a tall block (and kept a little clear of their sides). True on arrival.
   */
  function driftToward(g, tx, ty, speed, dt) {
    const dx = tx - g.x, dy = ty - g.y, d = Math.hypot(dx, dy);
    if (d < 0.02) return true;
    const step = Math.min(d, speed * dt);
    const nx = g.x + dx / d * step, ny = g.y + dy / d * step;
    const ox = Math.floor(g.x), oy = Math.floor(g.y);
    const ok = (x, y) => {
      const cx = Math.floor(x), cy = Math.floor(y);
      const cellOk = (cx === ox && cy === oy) || (Math.abs(cx - ox) + Math.abs(cy - oy) === 1 && passable(ox, oy, cx, cy));
      return cellOk && !subBlocked(Math.floor(x * 2), Math.floor(y * 2));
    };
    if (ok(nx, ny)) { g.x = nx; g.y = ny; } else if (ok(nx, g.y)) g.x = nx; else if (ok(g.x, ny)) g.y = ny;
    // Keep the body off the sides of tall blocks.
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      for (const b of blocksAt(Math.floor(g.x) + i, Math.floor(g.y) + j)) {
        if (b.top <= GHOST.tall) continue;
        const qx = THREE.MathUtils.clamp(g.x, b.x0, b.x1), qy = THREE.MathUtils.clamp(g.y, b.y0, b.y1);
        const ex = g.x - qx, ey = g.y - qy, e = Math.hypot(ex, ey);
        if (e > 1e-6 && e < GHOST.radius) { g.x += ex / e * (GHOST.radius - e); g.y += ey / e * (GHOST.radius - e); }
      }
    }
    return d <= step + 0.02;
  }

  /** Steer half-cell by half-cell (around blocks, through doors), then straight to the goal. */
  function followPath(g, gx, gy, speed, dt) {
    g.pathT -= dt;
    const sx = Math.floor(g.x * 2), sy = Math.floor(g.y * 2);
    if (g.pathT <= 0 || (g.next && g.next.x === sx && g.next.y === sy)) {
      g.next = nextSubToward(sx, sy, Math.floor(gx * 2), Math.floor(gy * 2), 2400);
      g.pathT = 0.3;
    }
    if (g.next === undefined) return true; // no way through: give up on this goal
    if (g.next === null) return driftToward(g, gx, gy, speed, dt);
    driftToward(g, (g.next.x + 0.5) / 2, (g.next.y + 0.5) / 2, speed, dt);
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
    const lamp = { x: lantern.position.x / S, y: lantern.position.z / S, h: lantern.position.y / S };
    let nearest = Infinity, touching = false;
    for (const g of state.ghosts.slice()) {
      const lit = lightReaches(lamp, { x: g.x, y: g.y, h: g.h });
      g.litNow = lit;
      if (!frozen && g.mode === 'chase' && g.stun <= 0) {
        const jar = jarCatches(g);
        if (jar) {
          jar.fill++;
          removeGhost(g);
          W.showCaption(`the jar drinks in the hash ghost · ${jar.fill}/${RULES.jarCapacity}`);
          savePlayer();
          W.refreshHud();
          continue;
        }
      }
      if (!frozen) {
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
      if (d < GHOST.contact && p.z < 0.6) touching = true;

      // Look: bob, orbiting "bits", and a hotter, jittery glow when following.
      const chasing = g.mode === 'chase';
      g.phase += dt;
      const jit = g.stun > 0 ? 0.07 : chasing ? 0.02 : 0;
      g.mesh.position.set(
        (g.x + (Math.random() - 0.5) * jit) * S,
        (g.h + Math.sin(g.phase * 1.7) * 0.05) * S,
        (g.y + (Math.random() - 0.5) * jit) * S);
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
        const a = g.phase * (g.stun > 0 ? 0.2 : chasing ? 4 : watching ? 0.6 : 1.6) + i * Math.PI / 2;
        b.position.set(Math.cos(a) * 0.24 * S, Math.sin(g.phase * 3 + i) * 0.08 * S, Math.sin(a) * 0.24 * S);
        b.rotation.set(a, a * 1.3, 0);
      });
    }
    updateEdgeMarkers();

    // Screen effects: wobble grows with nearness, glitch with contact. Both
    // hold for a moment once you're clear, then wear off.
    const fx = state.fx;
    const want = THREE.MathUtils.clamp(1 - (nearest - 0.4) / 3.6, 0, 1);
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

  /**
   * Off-screen ghosts that are watching or following you get a marker on
   * the screen edge: their status icon, with an arrow pointing toward them.
   */
  const edgeLayer = $('ghost-edges');
  const edgeV = new THREE.Vector3();
  function updateEdgeMarkers() {
    const w = global.innerWidth, h = global.innerHeight, m = 34;
    for (const g of state.ghosts) {
      let show = false, px = 0, py = 0, ang = 0;
      if (g.mode !== 'wander' && !state.bigmap && !state.paused) {
        edgeV.copy(g.mesh.position);
        edgeV.y += 0.5 * S;
        edgeV.project(camera);
        const behind = edgeV.z > 1;
        let sx = (edgeV.x + 1) / 2 * w, sy = (1 - edgeV.y) / 2 * h;
        if (behind) { sx = w - sx; sy = h - sy; }
        if (behind || sx < 8 || sx > w - 8 || sy < 8 || sy > h - 8) {
          show = true;
          const dx = sx - w / 2, dy = sy - h / 2;
          const k = Math.min((w / 2 - m) / Math.max(Math.abs(dx), 1e-6), (h / 2 - m) / Math.max(Math.abs(dy), 1e-6));
          px = w / 2 + dx * k; py = h / 2 + dy * k;
          ang = Math.atan2(dy, dx);
        }
      }
      if (show && !g.edge) {
        g.edge = document.createElement('div');
        g.edge.className = 'gedge';
        g.edge.innerHTML = '<canvas width="96" height="96"></canvas><i class="arrow"></i>';
        edgeLayer.append(g.edge);
      }
      if (!g.edge) continue;
      g.edge.hidden = !show;
      if (!show) continue;
      g.edge.style.left = px + 'px';
      g.edge.style.top = py + 'px';
      g.edge.classList.toggle('chase', g.mode === 'chase');
      g.edge.querySelector('.arrow').style.transform = `rotate(${ang}rad) translateX(26px)`;
      const cx = g.edge.firstChild.getContext('2d');
      cx.clearRect(0, 0, 96, 96);
      cx.drawImage(g.alertCanvas, 0, 0);
    }
  }

  /** Ghosts inside rooms about to collapse come undone with them (noted, nothing gained). */
  function banishGhostsIn(ids) {
    const reg = state.exp.registry;
    const gone = state.ghosts.filter((g) => ids.has(reg[DE.key(Math.floor(g.x), Math.floor(g.y))]));
    for (const g of gone) noteUnmade(g.id, reg[DE.key(Math.floor(g.x), Math.floor(g.y))]);
    gone.forEach(removeGhost);
    return gone.length;
  }

  Object.assign(W, { addGhost, clearGhosts, lightReaches, updateGhosts, banishGhostsIn });
})(window);
