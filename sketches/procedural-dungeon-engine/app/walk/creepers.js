// Walk mode: shadow creepers. Small dark things with one red eye, hopping
// about the dim corners of a room (about 1 room in 12, from depth 2). They
// keep off steady light (lit sconces, awake waystones: the ecology's flee
// rule) and want you, but they're afraid of your lamp.
//
// Its mood comes from your lamp:
//   afraid  (more than two charges): it waits at the edge of your light,
//           just past its radius, and never steps inside it. Walk at it and
//           it scrambles back; catch it in your light and it flinches,
//           blinks off the daze and dashes away. It only ever comes closer
//           because your light shrank.
//   bold    (the last two charges): the same, with a thinner margin, until
//           it's a little inside the edge.
//   hunting (under one charge, or the lamp covered or out): it comes for
//           you, skittering about you in quick hops, and now and then winds
//           up and dashes at you.
// Lurking (you're not near) it hops slowly between dark spots.
//
// It gets about in hops: a dip, a quick little arc, a squish on landing, a
// nervous pause. Its average pace is well under your walk (dashes catch
// you up in bursts; running loses it). It walks the floor, so it goes
// around every block. Once it's bold, being close to it wears on your
// psychic stamina, like the dark does (lamp.js): in bands, stronger nearer
// in and while it dashes, stacking with others. While it hunts, its bands
// show on the floor as faint discs, and a subtle red glitch (fx.js's
// creeper profile) fades in as it drains you. An afraid one doesn't drain.
// Off screen it gets a marker (markers.js).
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, DP, THREE, S, scene, state, passable, lantern, roomGap, subBlocked, followPath } = W;

  const CREEPER = {
    notice: 7,           // cells: this near (a room away or less) and it starts stalking you
    loseRange: 11,       // cells: farther than this and it goes back to lurking...
    loseRooms: 2,        // ...or once this many rooms lie between you
    margin: 0.45,        // cells it keeps outside the light's edge (afraid)
    boldPips: 2,         // charges: at or under this it's bold...
    boldMargin: -0.6,    // ...its margin thinning to this (negative: inside the light) at directPips
    directPips: 1,       // charges: under this it hunts you, light or not
    postTol: 0.15,       // cells inside its edge it tolerates before moving back out
    postSlack: 1.2,      // cells past its edge before it follows you in
    reach: 0.4,          // cells, centre to centre: as close as it gets
    // Its pull on your psychic stamina, by mood: bands out from it, innermost
    // first; inside one (and in its sight) you lose k × RULES.staminaCreeperDrain
    // per second. Afraid, it doesn't drain you.
    bands: {
      bold: [{ r: 0.55, k: 0.15 }],                    // a faint, short pull
      hunt: [{ r: 0.45, k: 1 }, { r: 0.75, k: 0.45 }], // the inner band mostly takes a dash to reach
    },
    dashDrain: 1.5,      // × while it dashes at you...
    dashLinger: 0.5,     // ...and for this many s after
    stack: 2,            // most creepers' worth of drain (and glitch) that adds up at once
    rays: 24,            // directions searched for the edge of the light
    look: 1.5,           // cells past the edge searched along each ray
    step: 0.12,          // cells between points tried along a ray
    // Hops, by what it's doing: len (cells), time (s in the air), rest (s between hops).
    hops: {
      lurk: { len: 0.3, time: 0.22, rest: [0.7, 2] },
      afraid: { len: 0.35, time: 0.2, rest: [0.3, 0.8] },
      bold: { len: 0.38, time: 0.2, rest: [0.2, 0.55] },
      follow: { len: 0.45, time: 0.2, rest: [0.1, 0.3] },  // catching up to the edge as you move off
      flee: { len: 0.5, time: 0.18, rest: [0.03, 0.1] },   // scrambling out of your light
      hunt: { len: 0.5, time: 0.2, rest: [0.06, 0.22] },   // about 1.2 cells/s: under your walk (2.4)
    },
    hopHeight: 0.07,     // cells
    dip: 0.07,           // s crouched before a hop
    dash: { windup: 0.35, speed: 4.2, time: 0.32, chance: 0.22 }, // hunting: share of hops that are dashes at you
    circle: [0.55, 1.1], // cells from you: where a hunting one hops about
    circleTime: [0.5, 1.3], // s before it picks somewhere else around you
    daze: { cooldown: 2.5, windup: 0.4, burst: 3 }, // caught in your light: flinch, blink, dash off
    blink: [2, 6],       // s between blinks
    blinkTime: 0.12,     // s the eye stays shut
    rapid: 0.25,         // share of blinks that are a quick double or triple
    burstGap: 0.08,      // s open between blinks in a burst
    disc: { opacity: 0.09, dash: 1.8, ease: 3 }, // its bands on the floor while it hunts: each adds this opacity (× dash while dashing)
    debugBands: false,   // dev: show its bands in every mood that has them (DungeonPlay.walk.CREEPER.debugBands = true)
    markRooms: 1,        // a lurking creeper off screen gets a marker this many rooms away or nearer
    markRange: 14,       // cells: and only within this distance
    lightH: 0.3,         // cells: the height your light has to reach to count as touching it
  };

  const geo = {
    body: new THREE.CapsuleGeometry(0.12 * S, 0.22 * S, 4, 10), // the figure's body
    eye: new THREE.SphereGeometry(0.028 * S, 10, 8),
    blob: new THREE.CircleGeometry(0.17 * S, 20),
    disc: new THREE.CircleGeometry(1, 48),
  };
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x2c2b30 });
  // Emissive on black, and out of the fog: the eye shows in any darkness.
  const eyeMat = new THREE.MeshLambertMaterial({ color: 0x000000, emissive: 0xff2414, fog: false });
  const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false });
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
  const lerp = THREE.MathUtils.lerp, clamp = THREE.MathUtils.clamp;

  function addCreeper(o) {
    const mesh = new THREE.Group();
    // The rig squashes and hops; the blob and band discs stay on the floor.
    const rig = new THREE.Group();
    const body = new THREE.Mesh(geo.body, bodyMat);
    body.position.y = 0.23 * S;
    // The eye sits on the front of the body (+z, turned to face you); blinking squashes it flat.
    const eye = new THREE.Group();
    eye.position.set(0, 0.36 * S, 0.115 * S);
    eye.add(new THREE.Mesh(geo.eye, eyeMat));
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(0.16 * S);
    eye.add(glow);
    rig.add(body, eye);
    const blob = new THREE.Mesh(geo.blob, blobMat);
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.01;
    // One flat disc per band, additive, so where they overlap (nearer in) reads brighter.
    const discs = CREEPER.bands.hunt.map((b, i) => {
      const m = new THREE.Mesh(geo.disc, new THREE.MeshBasicMaterial({ color: 0xff3a24, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = (0.012 + i * 0.002) * S;
      m.visible = false;
      return m;
    });
    mesh.add(rig, blob, ...discs);
    scene.add(mesh);
    // tall 0: every block is in its way (creatures.js).
    const c = Object.assign({ mode: 'lurk', target: null, next: null, pathT: 0, post: null }, o, {
      mesh, rig, eye, blob, discs, tall: 0, mood: 'lurk',
      hop: { phase: 'rest', t: 0, dur: Math.random(), speed: 0, goal: null, land: 0 },
      circleT: 0, dazeT: 0, dashT: 0, discOn: 0,
      blinkT: between(CREEPER.blink), shut: 0, burst: 0, gap: 0,
    });
    state.creepers.push(c);
    return c;
  }

  function removeCreeper(c) {
    scene.remove(c.mesh);
    for (const m of c.discs) m.material.dispose();
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

  // ---------------------------------------------------------------------------
  // Where to go

  /** Can you see from cell a into the next cell b (through floor and open doors, corners included)? */
  function sightStep(ax, ay, bx, by) {
    if (ax !== bx && ay !== by) {
      return (passable(ax, ay, bx, ay) && passable(bx, ay, bx, by)) || (passable(ax, ay, ax, by) && passable(ax, by, bx, by));
    }
    return passable(ax, ay, bx, by);
  }

  /** How far your light keeps creepers off you, in cells, or 0 once they hunt you. */
  function keepOff() {
    const fuel = state.run.fuel, r = W.lightRadius();
    if (!r || fuel < CREEPER.directPips) return 0;
    const k = clamp((fuel - CREEPER.directPips) / (CREEPER.boldPips - CREEPER.directPips), 0, 1);
    return Math.max(0, r + lerp(CREEPER.boldMargin, CREEPER.margin, k));
  }

  /** Distance from point (px, py) to the segment a-b. */
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
    return Math.hypot(px - ax - dx * t, py - ay - dy * t);
  }

  /** Is a waiting spot still good: at the edge (not inside it, not far past it) and not by a steady light? */
  function postOk(c, post, keep) {
    const p = state.player, d = Math.hypot(post.x - p.x, post.y - p.y);
    return d >= keep - CREEPER.postTol && d <= keep + CREEPER.postSlack && !W.ecology.shuns('creeper', post.x, post.y, c);
  }

  /**
   * Where to wait: along rays out from you (in sight of you: walls stop a
   * ray), the first point at or past the edge of your light, not by a
   * steady light, and reachable without cutting through your light. Of
   * those, the one nearest the creeper, so it shifts along the edge rather
   * than crossing the room. Null if none.
   */
  function pickPost(c, keep) {
    const p = state.player;
    const base = Math.atan2(c.y - p.y, c.x - p.x);
    const inner = Math.min(keep, Math.hypot(c.x - p.x, c.y - p.y)) - CREEPER.postTol;
    let best = null, bs = Infinity;
    for (let i = 0; i < CREEPER.rays; i++) {
      const a = base + i / CREEPER.rays * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
      let cx = Math.floor(p.x), cy = Math.floor(p.y);
      for (let r = CREEPER.step; r <= keep + CREEPER.look; r += CREEPER.step) {
        const x = p.x + dx * r, y = p.y + dy * r;
        const nx = Math.floor(x), ny = Math.floor(y);
        if (nx !== cx || ny !== cy) {
          if (!sightStep(cx, cy, nx, ny)) break;
          cx = nx; cy = ny;
        }
        if (r < keep || subBlocked(Math.floor(x * 2), Math.floor(y * 2), 0) || W.ecology.shuns('creeper', x, y, c)) continue;
        if (segDist(p.x, p.y, c.x, c.y, x, y) < inner) break; // the way there crosses your light
        const s = Math.hypot(x - c.x, y - c.y);
        if (s < bs) { bs = s; best = { x, y }; }
        break;
      }
    }
    return best;
  }

  /** A spot around you for a hunting one to hop to: roughly on its side of you. */
  function circleSpot(c) {
    const p = state.player, base = Math.atan2(c.y - p.y, c.x - p.x);
    for (let i = 0; i < 6; i++) {
      const a = base + (Math.random() - 0.5) * 1.8, r = between(CREEPER.circle);
      const x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
      if (spaceAt(x, y) !== undefined && !subBlocked(Math.floor(x * 2), Math.floor(y * 2), 0)) return { x, y };
    }
    return { x: p.x, y: p.y };
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

  /**
   * Decide where it's headed this frame: c.hop.goal, the hop style, and
   * whether its next hop may be a dash at you.
   */
  function think(c, dt, lamp) {
    const p = state.player, h = c.hop;
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    if (c.mode === 'lurk') {
      c.mood = 'lurk';
      if (!c.target) c.target = darkSpot(c);
      h.goal = c.target; c.style = 'lurk'; c.dashAt = null;
      return;
    }
    const keep = keepOff();
    c.mood = !keep ? 'hunt' : state.run.fuel <= CREEPER.boldPips ? 'bold' : 'afraid';
    if (c.mood === 'hunt') {
      c.post = null;
      c.circleT -= dt;
      if (c.circleT <= 0 || !h.goal) { h.goal = circleSpot(c); c.circleT = between(CREEPER.circleTime); }
      c.style = 'hunt';
      // A dash goes right at you, stopping at its reach.
      c.dashAt = d > CREEPER.reach ? { x: p.x + (c.x - p.x) / d * CREEPER.reach, y: p.y + (c.y - p.y) / d * CREEPER.reach } : null;
      return;
    }
    c.dashAt = null;
    // Steady light pushes it back, as it does ghosts.
    const shy = W.ecology.flee('creeper', c);
    if (shy) {
      const n = Math.hypot(shy.x, shy.y) || 1;
      h.goal = { x: c.x + shy.x / n * 0.6, y: c.y + shy.y / n * 0.6 }; c.style = 'flee'; c.post = null;
      return;
    }
    if (!c.post || !postOk(c, c.post, keep)) {
      c.post = pickPost(c, keep);
      if (!c.post) { // nowhere at the edge in sight: back straight off
        const a = Math.atan2(c.y - p.y, c.x - p.x);
        c.post = { x: p.x + Math.cos(a) * keep, y: p.y + Math.sin(a) * keep };
      }
    }
    h.goal = c.post;
    c.style = d < keep - CREEPER.postTol ? 'flee'
      : Math.hypot(c.post.x - c.x, c.post.y - c.y) > 1.5 ? 'follow' : c.mood;
    // Caught in your light, inside its edge: flinch, blink it off, dash for the edge.
    // (A bold one's edge is inside the light; it doesn't flinch there.)
    c.dazeT -= dt;
    if (c.dazeT <= 0 && d < Math.min(W.lightRadius(), keep - CREEPER.postTol) && W.lightReaches(lamp, { x: c.x, y: c.y, h: CREEPER.lightH }, keep + 1)) {
      c.dazeT = CREEPER.daze.cooldown;
      c.burst = CREEPER.daze.burst; c.gap = 0;
      Object.assign(h, { phase: 'windup', t: 0, dur: CREEPER.daze.windup, dashTo: c.post });
    }
  }

  // ---------------------------------------------------------------------------
  // Getting there: hops and dashes

  function hopTo(c, dt) {
    const h = c.hop, st = CREEPER.hops[c.style] || CREEPER.hops.afraid;
    h.t += dt;
    h.land = Math.max(0, h.land - dt);
    const land = () => { h.phase = 'rest'; h.t = 0; h.dur = between(st.rest); h.land = 0.12; };
    if (h.phase === 'rest') {
      if (h.t < h.dur || !h.goal || Math.hypot(h.goal.x - c.x, h.goal.y - c.y) < 0.06) {
        // There: a lurking one picks its next dark spot after a longer wait.
        if (h.t >= h.dur && c.mode === 'lurk' && c.target) { c.target = null; h.t = 0; h.dur = between([1.5, 4]); }
        return;
      }
      if (c.dashAt && Math.random() < CREEPER.dash.chance) Object.assign(h, { phase: 'windup', t: 0, dur: CREEPER.dash.windup, dashTo: c.dashAt });
      else Object.assign(h, { phase: 'dip', t: 0, dur: CREEPER.dip });
    } else if (h.phase === 'dip' && h.t >= h.dur) {
      Object.assign(h, { phase: 'air', t: 0, dur: st.time, speed: st.len / st.time });
      c.next = null; c.pathT = 0;
    } else if (h.phase === 'windup' && h.t >= h.dur) {
      Object.assign(h, { phase: 'dash', t: 0, dur: CREEPER.dash.time, speed: CREEPER.dash.speed });
      c.next = null; c.pathT = 0;
    } else if (h.phase === 'air' || h.phase === 'dash') {
      const to = h.phase === 'dash' ? h.dashTo || h.goal : h.goal;
      const there = !to || followPath(c, to.x, to.y, h.speed, dt);
      if (there || h.t >= h.dur) land();
    }
  }

  // ---------------------------------------------------------------------------
  // Per frame

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
          c.mode = 'stalk'; c.target = null; c.post = null; c.hop.goal = null;
          W.showCaption('a red eye opens at the edge of your light');
        } else if (c.mode === 'stalk' && (d > CREEPER.loseRange || gap >= CREEPER.loseRooms)) {
          c.mode = 'lurk'; c.post = null; c.hop.goal = null;
        }
        const was = c.mood;
        think(c, dt, lamp);
        if (c.mood === 'hunt' && was !== 'hunt' && was !== 'lurk') W.showCaption('the red eye stops minding your light');
        hopTo(c, dt);
        // Its pull on you: the band you're in, while it can see you. Several add up.
        c.dashT = c.hop.phase === 'dash' ? CREEPER.dashLinger : Math.max(0, c.dashT - dt);
        const bands = CREEPER.bands[c.mood];
        if (bands && d < bands[bands.length - 1].r && W.lightReaches(eyes, { x: c.x, y: c.y, h: CREEPER.lightH + 0.1 })) {
          drain += bands.find((b) => d < b.r).k * (c.dashT > 0 ? CREEPER.dashDrain : 1);
        }
      }
      look(c, dt, frozen);
    }
    drain = Math.min(CREEPER.stack, drain);
    if (!frozen) {
      state.creeperDrain = drain;
      W.fxToward('creeper', drain, dt); // the subtle red glitch, easing in as it drains you
    }
  }

  /** Hop arc and squish, always facing you, blinks, and its bands on the floor. */
  function look(c, dt, frozen) {
    const p = state.player, h = c.hop;
    let sx = 1, sy = 1, lift = 0, shake = 0;
    const k = h.dur > 0 ? clamp(h.t / h.dur, 0, 1) : 1;
    if (h.phase === 'dip') { sx = 1 + 0.1 * k; sy = 1 - 0.18 * k; }
    else if (h.phase === 'windup') { sx = 1 + 0.16 * k; sy = 1 - 0.3 * k; shake = 0.012 * k; } // anticipation: low, trembling
    else if (h.phase === 'air') { sx = 0.93; sy = 1.1; lift = Math.sin(Math.PI * k) * CREEPER.hopHeight; }
    else if (h.phase === 'dash') { sx = 0.9; sy = 1.08; lift = Math.sin(Math.PI * k) * CREEPER.hopHeight * 0.4; }
    if (h.land > 0) { const q = h.land / 0.12; sx += 0.1 * q; sy -= 0.16 * q; }
    c.mesh.position.set((c.x + (Math.random() - 0.5) * shake) * S, 0, (c.y + (Math.random() - 0.5) * shake) * S);
    c.rig.position.y = lift * S;
    c.rig.scale.set(sx, sy, sx);
    c.rig.rotation.y = Math.atan2(p.x - c.x, p.y - c.y);
    c.blob.scale.setScalar(1 - lift * 3);

    // Blinks: now and then, sometimes a quick double or triple, and a burst when it's dazed.
    if (!frozen) {
      if (c.shut > 0) c.shut -= dt;
      else if (c.burst > 0) {
        if ((c.gap -= dt) <= 0) { c.shut = CREEPER.blinkTime; c.burst--; c.gap = CREEPER.burstGap; }
      } else if ((c.blinkT -= dt) <= 0) {
        c.shut = CREEPER.blinkTime;
        c.burst = Math.random() < CREEPER.rapid ? 1 + Math.floor(Math.random() * 2) : 0;
        c.gap = CREEPER.burstGap;
        c.blinkT = between(CREEPER.blink);
      }
    }
    c.eye.scale.y = c.shut > 0 ? 0.001 : 1;

    // Its bands on the floor: only while it hunts (or in any mood that has them, with
    // debugBands), flaring while it dashes.
    const bands = CREEPER.bands[c.mood];
    const want = bands && (c.mood === 'hunt' || CREEPER.debugBands) ? 1 : 0;
    if (!frozen) c.discOn += (want - c.discOn) * Math.min(1, dt * CREEPER.disc.ease);
    const shown = bands || c.lastBands;
    if (bands) c.lastBands = bands; // keep the last bands' sizes while fading out
    c.discs.forEach((m, i) => {
      const b = shown && shown[i];
      m.visible = !!b && c.discOn > 0.01;
      if (!m.visible) return;
      m.scale.setScalar(b.r * S);
      m.material.opacity = CREEPER.disc.opacity * c.discOn * (c.dashT > 0 ? CREEPER.disc.dash : 1);
    });
  }

  /** Its marker icon: a dark disc and the red eye (shut mid-blink). */
  function drawMarker(c, cv) {
    const x = cv.getContext('2d'), n = cv.width;
    x.clearRect(0, 0, n, n);
    x.fillStyle = 'rgba(70, 68, 76, 0.9)';
    x.beginPath(); x.ellipse(n / 2, n * 0.52, n * 0.17, n * 0.24, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = c.mode === 'stalk' ? '#ff3a24' : 'rgba(255, 70, 50, 0.6)';
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
