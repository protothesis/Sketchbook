// Walk mode: shadow creepers. Dark grey shapes with one red eye, lurking in
// the dim corners of a room (about 1 room in 12, from depth 2). They keep
// off steady light (lit sconces, awake waystones: the ecology's flee rule)
// and want you. Come near and one stalks you from the edge of your light:
// the nearest spot your lamp doesn't reach, just past its radius or in the
// shadow of a block, as close to you as it can get while still dark. It's
// light-sensitive, not light-proof: it only keeps out of the light's
// radius, and caught inside it backs out a little faster than it creeps.
//
// The lamp sets how close it dares. As the light shrinks it follows the
// edge in; in the lamp's last two charges it gets bold and dips inside the
// edge; under one charge (or with the lamp covered or out) it stops minding
// light and comes straight at you. Its nearness wears on your psychic
// stamina, like the dark does (lamp.js), harder the closer it is. It moves
// a little slower than you walk: walking keeps it at bay only just, running
// loses it. It walks the floor, so it goes around every block, even low
// ones. Off screen, it gets a marker (markers.js) like a ghost.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, DP, RULES, THREE, S, scene, state, passable, lantern, roomGap,
    subBlocked, followPath } = W;

  const CREEPER = {
    speed: 2.1,          // cells/s stalking: under walking (SPEED 2.4), far under running (RUN 4)
    shySpeed: 2.6,       // cells/s backing out of your light when it's caught inside the radius
    lurkSpeed: 0.4,      // cells/s, idling from dark spot to dark spot
    pause: [1.5, 4],     // s between dark spots while lurking
    notice: 7,           // cells: this near (a room away or less) and it starts stalking you
    loseRange: 11,       // cells: farther than this and it goes back to lurking...
    loseRooms: 2,        // ...or once this many rooms lie between you
    margin: 0.45,        // cells it keeps outside the light's edge
    boldPips: 2,         // charges: at or under this it creeps closer...
    boldMargin: -0.6,    // ...down to this margin (negative: inside the light) at directPips
    directPips: 1,       // charges: under this it ignores light and comes straight at you
    reach: 0.4,          // cells, centre to centre: as close as it comes
    drainRange: 3,       // cells: within this (and in sight of you) it drains psychic stamina,
                         // RULES.staminaCreeperDrain at `reach`, falling off to nothing here
    rays: 24,            // directions searched for the edge of the light
    look: 1.5,           // cells past the edge searched along each ray
    step: 0.12,          // cells between points tried along a ray
    stay: 0.35,          // weight on staying near where it is when picking a spot
    replan: 0.35,        // s between picks of where to stand
    lightH: 0.3,         // cells: the height the light has to reach to count as touching it
    markRooms: 1,        // a lurking creeper off screen gets a marker this many rooms away or nearer
    markRange: 14,       // cells: and only within this distance
    blink: [2, 6],       // s between blinks
    blinkTime: 0.14,     // s the eye stays shut
  };

  const geo = {
    body: new THREE.CapsuleGeometry(0.12 * S, 0.22 * S, 4, 10), // the figure's body
    eye: new THREE.SphereGeometry(0.028 * S, 10, 8),
  };
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x2c2b30 });
  // Emissive on black, and out of the fog: the eye shows in any darkness.
  const eyeMat = new THREE.MeshLambertMaterial({ color: 0x000000, emissive: 0xff2414, fog: false });
  const glowTex = (() => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 32;
    const g = cv.getContext('2d');
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(cv);
  })();
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xff2a14, blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false, fog: false });

  const between = (r) => r[0] + Math.random() * (r[1] - r[0]);
  const spaceAt = (x, y) => state.exp.registry[DE.key(Math.floor(x), Math.floor(y))];

  function addCreeper(o) {
    const mesh = new THREE.Group();
    const body = new THREE.Mesh(geo.body, bodyMat);
    body.position.y = 0.23 * S;
    // The eye rig sits on the front of the body (+z, turned to face you);
    // blinking squashes it flat.
    const eye = new THREE.Group();
    eye.position.set(0, 0.36 * S, 0.115 * S);
    eye.add(new THREE.Mesh(geo.eye, eyeMat));
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(0.16 * S);
    eye.add(glow);
    mesh.add(body, eye);
    scene.add(mesh);
    // tall 0: every block is in its way (the path helpers in ghosts.js).
    const c = Object.assign({ mode: 'lurk', target: null, pause: 0, next: null, pathT: 0, post: null, planT: 0 }, o, {
      mesh, eye, tall: 0, phase: Math.random() * 10, blinkT: between(CREEPER.blink), shut: 0, bold: false,
    });
    state.creepers.push(c);
    return c;
  }

  function removeCreeper(c) {
    scene.remove(c.mesh);
    state.creepers = state.creepers.filter((o) => o !== c);
  }
  function clearCreepers() { for (const c of state.creepers.slice()) removeCreeper(c); }

  /** A room's creeper, rolled once per room, ever (like its ghost). */
  function spawnCreeper(space) {
    const cid = space.id + ':' + space.seed + ':creeper';
    if (state.run.creeperSeen.includes(cid)) return;
    state.run.creeperSeen.push(cid);
    const cell = DP.creeperSpawn(space);
    if (cell) addCreeper({ id: cid, x: cell.x + 0.5, y: cell.y + 0.5 });
  }

  /** Creepers in rooms that collapse go with them. */
  function dropCreepersIn(ids) {
    for (const c of state.creepers.slice()) if (ids.has(spaceAt(c.x, c.y))) removeCreeper(c);
  }

  /** Can you see from cell a into the next cell b (through floor and open doors, corners included)? */
  function sightStep(ax, ay, bx, by) {
    if (ax !== bx && ay !== by) {
      return (passable(ax, ay, bx, ay) && passable(bx, ay, bx, by)) || (passable(ax, ay, ax, by) && passable(ax, by, bx, by));
    }
    return passable(ax, ay, bx, by);
  }

  /** How far the light keeps a creeper off you, in cells, or 0 once it stops minding it. */
  function keepOff() {
    const fuel = state.run.fuel, r = W.lightRadius();
    if (!r || fuel < CREEPER.directPips) return 0;
    const k = THREE.MathUtils.clamp((fuel - CREEPER.directPips) / (CREEPER.boldPips - CREEPER.directPips), 0, 1);
    return Math.max(0, r + THREE.MathUtils.lerp(CREEPER.boldMargin, CREEPER.margin, k));
  }

  /** Is (x, y) inside the light, as far as a creeper keeping `keep` off you cares? */
  function lit(x, y, keep, lamp) {
    const p = state.player;
    return Math.hypot(x - p.x, y - p.y) < keep && W.lightReaches(lamp, { x, y, h: CREEPER.lightH }, keep + 1);
  }

  /**
   * Where to wait: along rays out from you (in sight of you: walls stop a
   * ray), the first point the light doesn't touch (nor a steady light's
   * reach: the ecology's flee rule), and of those the one
   * nearest you, weighted a little toward staying put. Null if none.
   */
  function pickPost(c, keep, lamp) {
    const p = state.player;
    const base = Math.atan2(c.y - p.y, c.x - p.x);
    let best = null, bs = Infinity;
    for (let i = 0; i < CREEPER.rays; i++) {
      const a = base + i / CREEPER.rays * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
      let cx = Math.floor(p.x), cy = Math.floor(p.y);
      for (let r = CREEPER.reach; r <= keep + CREEPER.look; r += CREEPER.step) {
        const x = p.x + dx * r, y = p.y + dy * r;
        const nx = Math.floor(x), ny = Math.floor(y);
        if (nx !== cx || ny !== cy) {
          if (!sightStep(cx, cy, nx, ny)) break;
          cx = nx; cy = ny;
        }
        if (subBlocked(Math.floor(x * 2), Math.floor(y * 2), 0) || lit(x, y, keep, lamp) || W.ecology.shuns('creeper', x, y, c)) continue;
        const s = r + CREEPER.stay * Math.hypot(x - c.x, y - c.y);
        if (s < bs) { bs = s; best = { x, y }; }
        break;
      }
    }
    return best;
  }

  /** A dark spot in its own room to idle at: corners and walls first, and never by a steady light. */
  function darkSpot(c) {
    const here = spaceAt(c.x, c.y), sp = state.exp.spaces[here];
    if (!sp) return null;
    let best = null, bs = -1;
    for (let i = 0; i < 6; i++) {
      const cell = DE.parseKey(sp.cells[Math.floor(Math.random() * sp.cells.length)]);
      let x = cell.x + 0.5, y = cell.y + 0.5, walls = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (spaceAt(cell.x + 0.5 + dx, cell.y + 0.5 + dy) !== here) { walls++; x += dx * 0.28; y += dy * 0.28; }
      }
      if (W.ecology.shuns('creeper', x, y, c) || subBlocked(Math.floor(x * 2), Math.floor(y * 2), 0)) continue;
      const s = walls + Math.random() * 0.5;
      if (s > bs) { bs = s; best = { x, y }; }
    }
    return best;
  }

  function lurk(c, dt) {
    if (c.pause > 0) { c.pause -= dt; return; }
    if (!c.target) { c.target = darkSpot(c); c.next = null; c.pathT = 0; }
    if (c.target && followPath(c, c.target.x, c.target.y, CREEPER.lurkSpeed, dt)) {
      c.target = null;
      c.pause = between(CREEPER.pause);
    }
  }

  function stalk(c, dt, lamp) {
    const p = state.player;
    const keep = keepOff();
    if (!keep) {
      // Under a charge, or no light at all: straight for you.
      if (!c.bold) { c.bold = true; W.showCaption('the red eye stops minding your light'); }
      c.post = null;
      if (Math.hypot(p.x - c.x, p.y - c.y) > CREEPER.reach) followPath(c, p.x, p.y, CREEPER.speed, dt);
      return;
    }
    c.bold = false;
    // Steady light pushes it back, as it does ghosts.
    const shy = W.ecology.flee('creeper', c);
    if (shy) {
      const d = Math.hypot(shy.x, shy.y) || 1;
      followPath(c, c.x + shy.x / d * 0.3, c.y + shy.y / d * 0.3, CREEPER.shySpeed, dt);
      c.post = null;
      return;
    }
    c.planT -= dt;
    if (c.planT <= 0 || !c.post) {
      c.planT = CREEPER.replan;
      const post = pickPost(c, keep, lamp);
      if (post && (!c.post || Math.hypot(post.x - c.post.x, post.y - c.post.y) > 0.1)) { c.post = post; c.next = null; c.pathT = 0; }
      if (!post) { // nowhere dark in sight: back off along the line from you
        const a = Math.atan2(c.y - p.y, c.x - p.x);
        c.post = { x: p.x + Math.cos(a) * keep, y: p.y + Math.sin(a) * keep };
      }
    }
    followPath(c, c.post.x, c.post.y, lit(c.x, c.y, keep, lamp) ? CREEPER.shySpeed : CREEPER.speed, dt);
  }

  function updateCreepers(dt) {
    const p = state.player;
    const frozen = state.paused || !!state.bigmap;
    const lamp = { x: lantern.position.x / S, y: lantern.position.z / S, h: lantern.position.y / S };
    const eyes = { x: p.x, y: p.y, h: p.z + 0.45 };
    let drain = 0;
    for (const c of state.creepers) {
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (!frozen) {
        const cs = spaceAt(c.x, c.y);
        const gap = cs === undefined || p.spaceId === undefined ? Infinity : roomGap(cs, p.spaceId, CREEPER.loseRooms);
        if (c.mode === 'lurk' && d < CREEPER.notice && gap <= 1) {
          c.mode = 'stalk'; c.target = null; c.post = null; c.planT = 0;
          W.showCaption('a red eye opens at the edge of your light');
        } else if (c.mode === 'stalk' && (d > CREEPER.loseRange || gap >= CREEPER.loseRooms)) {
          c.mode = 'lurk'; c.post = null; c.bold = false; c.pause = 1;
        }
        if (c.mode === 'stalk') stalk(c, dt, lamp);
        else lurk(c, dt);
        // Its pull on you: by nearness, while it can see you.
        if (d < CREEPER.drainRange && W.lightReaches(eyes, { x: c.x, y: c.y, h: CREEPER.lightH + 0.1 })) {
          drain = Math.max(drain, THREE.MathUtils.clamp(1 - (d - CREEPER.reach) / (CREEPER.drainRange - CREEPER.reach), 0, 1));
        }
      }

      // Look: a slow sway, always turned to you, and a blink now and then.
      c.phase += dt;
      c.mesh.position.set(c.x * S, Math.sin(c.phase * 1.3) * 0.01 * S, c.y * S);
      c.mesh.rotation.y = Math.atan2(p.x - c.x, p.y - c.y);
      c.mesh.rotation.z = Math.sin(c.phase * 0.9) * 0.05;
      if (c.shut > 0) c.shut -= dt;
      else if ((c.blinkT -= dt) <= 0) { c.shut = CREEPER.blinkTime; c.blinkT = between(CREEPER.blink); }
      c.eye.scale.y = c.shut > 0 ? 0.001 : 1;
    }
    state.creeperDrain = drain;
  }

  /** Its marker icon: a dark disc and the red eye (shut mid-blink). */
  function drawMarker(c, cv) {
    const x = cv.getContext('2d'), n = cv.width;
    x.clearRect(0, 0, n, n);
    x.fillStyle = 'rgba(70, 68, 76, 0.9)';
    x.beginPath(); x.ellipse(n / 2, n * 0.52, n * 0.17, n * 0.24, 0, 0, Math.PI * 2); x.fill();
    const stalking = c.mode === 'stalk';
    x.fillStyle = stalking ? '#ff3a24' : 'rgba(255, 70, 50, 0.6)';
    x.beginPath();
    if (c.shut > 0) x.ellipse(n / 2, n * 0.44, n * 0.075, n * 0.012, 0, 0, Math.PI * 2);
    else x.arc(n / 2, n * 0.44, n * 0.06, 0, Math.PI * 2);
    x.fill();
  }

  // Off-screen markers: any creeper stalking you, and lurking ones in your room or the next.
  W.markers.register({
    list: () => state.creepers,
    wanted: (c) => c.mode === 'stalk' || W.markers.near(c, CREEPER.markRooms, CREEPER.markRange),
    key: (c) => c.mode + (c.shut > 0 ? 1 : 0),
    draw: drawMarker,
    cls: (c) => (c.mode === 'stalk' ? 'stalk' : 'idle lurk'),
  });

  Object.assign(W, { CREEPER, addCreeper, clearCreepers, spawnCreeper, dropCreepersIn, updateCreepers });
  Object.assign(DP, { addCreeper }); // handy from the console
})(window);
