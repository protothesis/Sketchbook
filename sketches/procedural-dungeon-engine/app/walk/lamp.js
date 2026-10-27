// Walk mode: the lamp (GAME-DESIGN.md, section 10). One pool of entropy is
// your light and your rerolls. It's a fluid amount in charges
// (`run.fuel`): a shard adds a third of a charge, rerolls and waystones
// spend whole charges, and the lamp burns it steadily, except within a tile
// of an entropy light (a lit sconce, a save lantern: light.js). A gain holds the burn for a moment (RULES.lampGrace), so
// a charge you just earned doesn't start draining that instant.
//
// When the fuel runs out the lamp goes out, and stays out until you relight
// it with R (a shard). R while it's lit covers it: no light, no burn, and
// ghosts can't notice you, but the dark wears on your psychic stamina.
//
// Psychic stamina is your other meter (GAME-DESIGN.md, section 12). A
// ghost's touch drains it, a creeper's pull and its touch, and the dark,
// more slowly (after a beat: RULES.staminaDarkDelay). Empty, you pass out
// and wake at your last save, and lose everything opened since (game.js).
// It refills in light once nothing drains it.
//
// The psyche: what the meter does shows on screen (fx.js). Each kind of
// drain bursts when it starts on you (and again each time it comes back,
// after its cooldown); the meter starting to go down at all gives a jolt;
// while it drains, a distress level climbs as it empties; and the dark has
// its own look, static and shadows closing in from the edges, fading in
// across that first beat. They all add up. Passing out runs a sequence:
// the picture shatters, settles into static that holds until you press
// something, then collapses to black, and you wake.
//
// You should feel the lamp without looking at the meter. It has three
// stages, blended (RULES.lampUneasy, lampDanger, lampDying): uneasy, a
// little more flicker and wobble; danger, a clear flicker; dying, the
// flicker settles into a slow irregular fade that swells as you move, and
// the odd red ember. Through all of it the colour slides from yellow to
// red, the halo shrinks (but can still wobble out past its average), the
// light gets dimmer, redder and shorter, and its hard edge (a circle around
// you, there at a full lamp too) closes in.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { RULES, THREE, $, S, LANTERN, LANTERN_RANGE, scene, camera, state, savePlayer, el,
    maxCharges, lantern, lanternMesh, chargeText } = W;

  const PER_SHARD = 1 / RULES.shardsPerCharge;
  const DRAIN = PER_SHARD / RULES.lampSeconds; // charges per second
  const RELIGHT = RULES.relightShards * PER_SHARD;

  // ---------------------------------------------------------------------------
  // Fuel

  /**
   * Add entropy (in charges). Never past the max, but a meter already above
   * it (a sigil's +1 lost) keeps its extra. Holds the burn for a moment and
   * shows a +◆ over your head (unless `quiet`: a well pours a little every
   * frame and pops its own). Returns what was added.
   */
  function gainFuel(amount, quiet) {
    const run = state.run, max = maxCharges();
    const add = Math.max(0, Math.min(amount, max - run.fuel));
    const couldnt = run.fuel < RELIGHT - 1e-6;
    run.fuel += add;
    state.lampGrace = RULES.lampGrace;
    if (add > 1e-6 && !quiet) popEntropy(add);
    if (!run.lampOn && couldnt && run.fuel >= RELIGHT - 1e-6) W.showCaption(`enough entropy to relight your lamp · ${relightKey()}`);
    return add;
  }

  /** Spend entropy if there's enough; false (and nothing spent) if not. */
  function spendFuel(amount) {
    const run = state.run;
    if (run.fuel < amount - 1e-6) return false;
    run.fuel = Math.max(0, run.fuel - amount);
    if (run.fuel <= 0 && run.lampOn) putOut();
    return true;
  }

  /**
   * Take entropy back (a push block moved off its mark): up to `amount`,
   * never past empty, and never so low that this alone puts the lamp out.
   * Returns what was taken.
   */
  function takeFuel(amount) {
    const run = state.run;
    const take = Math.max(0, Math.min(amount, run.fuel - 0.05));
    run.fuel -= take;
    if (take > 1e-6) popEntropy(-take);
    return take;
  }

  /** Is this spot sheltered by an entropy light (a lit sconce, a save lantern): inside its pool, nothing in the way (light.js)? */
  function litAt(p) {
    return !!W.light.shelterAt(p.x, p.y);
  }

  // ---------------------------------------------------------------------------
  // Lit, covered, out: R relights or covers

  const lampOn = () => !!state.run.lampOn && state.run.fuel > 0;
  const relightKey = () => (W.verbF === 'tap' ? 'tap the lamp' : W.glyph('R'));

  function putOut() {
    state.run.lampOn = false;
    W.showCaption(`your lamp goes out · find entropy, then ${relightKey()} to relight it`);
  }

  /** R (or tapping the lamp): relight it for a shard, or cover it. */
  function toggleLamp() {
    const run = state.run;
    if (state.paused || state.gutter) return;
    if (run.lampOn) {
      run.lampOn = false;
      run.covers = (run.covers || 0) + 1;
      W.showCaption(`you cover your lamp · ghosts can't see you, but the dark wears on you · ${relightKey()} to relight`);
    } else if (!spendFuel(RELIGHT)) {
      W.showCaption(`not enough entropy to relight: ${RULES.relightShards} shard`);
      return;
    } else {
      run.lampOn = true;
      run.relights = (run.relights || 0) + 1;
      state.lampGrace = RULES.lampGrace;
      W.showCaption(`your lamp catches · −${RULES.relightShards} shard`);
    }
    savePlayer();
    updateLampHud(true);
  }

  // ---------------------------------------------------------------------------
  // Burning, the dark, stamina, passing out and waking

  const GUTTER_FADE = 1.2; // seconds: your lamp's light sinks as you pass out
  let lampMode = '';
  let staminaIdle = 0; // seconds since anything last drained your stamina
  let darkT = 0;       // seconds in the dark (the first RULES.staminaDarkDelay cost nothing)

  // The psyche's look (fx.js profiles), and the faint's timing.
  const PSYCHE = {
    cooldown: { creeper: 0.6, ghost: 0.3 }, // s clear of a source before it bursts again
    creeperBurst: 0.8,   // creeperFlash, entering a creeper's pull
    creeperHit: 1.2,     // creeperFlash, bumping into one
    jolt: 0.7,           // the meter starting to go down at all
    outFlash: 0.8,       // darkFlash, the moment your lamp goes out (or you cover it)
    darkGrace: [0.3, 0.55], // the dark's level across its first beat...
    darkMax: 1,          // ...and just before you faint in it
    distress: 1.1,       // psyche, just before you faint (any drain)
    faint: {
      shatter: 0.45,     // s: the picture breaks into chunks
      static: 1.4,       // s: settling into static, its colour streaks fading
      hold: 0.55,        // the static's level while it waits for you
      hint: 2,           // s into the wait before it says so
      collapse: 0.7,     // s: noise collapses to black
      beat: 0.6,         // s of black
      wake: 1.6,         // s: fading back in, the last static dying away
      wakeStatic: 0.3,
    },
  };
  const psy = { on: {}, off: {}, draining: false };

  function updateLamp(dt) {
    const run = state.run, p = state.player;
    if (state.gutter) { updateFaint(dt); return; }
    updateWaking(dt);
    let mode = 'burning';
    if (state.paused || state.bigmap) mode = 'paused';
    else if (litAt(p)) mode = 'sheltered';
    else if (!lampOn()) mode = 'dark';
    else if (state.lampGrace > 0) mode = 'held';
    state.lampGrace = Math.max(0, (state.lampGrace || 0) - (mode === 'paused' ? 0 : dt));
    if (mode === 'dark' && lampMode !== 'dark' && lampMode !== 'paused') W.fxBurst('darkFlash', PSYCHE.outFlash); // the lamp goes out
    lampMode = mode;
    if (mode === 'paused') return;
    darkT = mode === 'dark' ? darkT + dt : 0;
    if (mode === 'burning') {
      const before = run.fuel;
      run.fuel = Math.max(0, run.fuel - DRAIN * dt);
      run.lampBurned = (run.lampBurned || 0) + (before - run.fuel);
      if (run.fuel <= 0) putOut();
      else if (before > RULES.lampDanger && run.fuel <= RULES.lampDanger) W.showCaption('your lamp is running low');
    }
    updateStamina(dt, mode);
  }

  /**
   * Psychic stamina: a ghost's touch (state.ghostTouch, from ghosts.js)
   * knocks a chunk off once and drains it while you stay in its reach; a
   * creeper's pull drains it and its touch knocks a smaller chunk off
   * (creepers.js); the dark drains it too, more slowly, after a beat. In
   * light, with nothing draining it for a moment, it refills.
   */
  function updateStamina(dt, mode) {
    const run = state.run;
    const touch = !!state.ghostTouch, dark = mode === 'dark' && darkT >= RULES.staminaDarkDelay;
    const creep = state.creeperDrain || 0; // 0..1, a creeper's nearness (creepers.js)
    const hits = state.creeperHits || 0;   // bumps into a creeper this frame
    state.creeperHits = 0;
    if (touch && !state.wasTouched) run.stamina -= RULES.staminaHit;
    state.wasTouched = touch;
    if (hits) { run.stamina -= RULES.staminaCreeperHit * hits; W.fxBurst('creeperFlash', PSYCHE.creeperHit); staminaIdle = 0; }
    updatePsyche(dt, mode, { ghost: touch, creeper: creep > 0, dark }, touch || dark || creep > 0 || hits > 0);
    if (touch || dark || creep > 0) {
      run.stamina -= ((touch ? RULES.staminaDrain : 0) + (dark ? RULES.staminaDarkDrain : 0) +
        RULES.staminaCreeperDrain * creep) * dt;
      staminaIdle = 0;
    } else {
      staminaIdle += dt;
      if (staminaIdle >= RULES.staminaRegenDelay && mode !== 'dark') run.stamina += RULES.staminaRegen * dt; // only in light, not the dark's first beat
    }
    run.stamina = THREE.MathUtils.clamp(run.stamina, 0, 1);
    if (run.stamina <= 0) {
      passOut(touch ? 'the ghost is too much · you pass out'
        : (creep > 0 || hits) && !dark ? 'the creeper is too close · you pass out' : 'the dark is too much · you pass out');
    }
  }

  /**
   * The psyche on screen (fx.js): a burst as each source starts on you
   * (again after its cooldown), a jolt as the meter starts going down at
   * all, distress climbing as it empties while anything drains it, and the
   * dark's own look: fading in across its first beat, then closing in as
   * the meter empties.
   */
  function updatePsyche(dt, mode, sources, draining) {
    const run = state.run, t = state.time;
    for (const src in sources) {
      const on = sources[src];
      if (on && !psy.on[src] && t - (psy.off[src] ?? -9) >= (PSYCHE.cooldown[src] || 0)) {
        if (src === 'creeper') W.fxBurst('creeperFlash', PSYCHE.creeperBurst); // a ghost flashes on its own (ghosts.js)
      }
      if (!on && psy.on[src]) psy.off[src] = t;
      psy.on[src] = on;
    }
    if (draining && !psy.draining) W.fxBurst('jolt', PSYCHE.jolt);
    psy.draining = draining;
    const empty = smooth(0, 1, 1 - run.stamina);
    W.fxToward('psyche', draining ? PSYCHE.distress * empty : 0, dt);
    const g = PSYCHE.darkGrace, delay = RULES.staminaDarkDelay;
    W.fxToward('dark', mode !== 'dark' ? 0 : darkT < delay ? lerp(g[0], g[1], darkT / delay)
      : lerp(g[1], PSYCHE.darkMax, empty), dt);
  }

  // ---------------------------------------------------------------------------
  // Passing out: shatter, static, wait for you, collapse, black, wake.

  function passOut(text) {
    if (W.closeChoice) W.closeChoice();
    state.gutter = { phase: 'shatter', t: 0, total: 0 };
    state.fx.faint = { shatter: 1, static: 0, streakT: 0, black: 0 };
    state.paused = true;
    state.wasTouched = false;
    W.keys.clear();
    W.showCaption(text);
  }

  function updateFaint(dt) {
    const g = state.gutter, f = state.fx.faint || (state.fx.faint = {}), F = PSYCHE.faint;
    g.t += dt; g.total += dt;
    const next = (phase) => { g.phase = phase; g.t = 0; };
    if (g.phase === 'shatter') {
      f.shatter = 1 - 0.3 * (g.t / F.shatter); f.static = 0.8 * (g.t / F.shatter);
      if (g.t >= F.shatter) next('static');
    } else if (g.phase === 'static') {
      f.shatter = Math.max(0, 0.7 - g.t * 2);
      f.static = lerp(1, F.hold, smooth(0, 1, g.t / F.static));
      f.streakT = g.t;
      if (g.t >= F.static) next('hold');
    } else if (g.phase === 'hold') {
      f.shatter = 0; f.static = F.hold; f.streakT += dt;
      if (!g.hinted && g.t >= F.hint) {
        g.hinted = true;
        W.showCaption(W.padMode && W.padMode() ? 'press any button to come to' : touchScreen ? 'tap to come to' : 'press any key to come to');
      }
      if (g.woken) next('collapse');
    } else if (g.phase === 'collapse') {
      const k = 7, b = (1 - Math.exp(-k * g.t)) / (1 - Math.exp(-k * F.collapse)); // exponential, landing on 1
      f.black = Math.min(1, b); f.static = F.hold * (1 - f.black);
      if (g.t >= F.collapse) next('beat');
    } else if (g.phase === 'beat') {
      f.black = 1; f.static = 0;
      if (g.t >= F.beat) wake();
    }
  }

  // The wait: any key, click, tap or (through gamepad.js's keys) button brings you to.
  const touchScreen = global.matchMedia && global.matchMedia('(hover: none)').matches;
  function comeTo(e) {
    const g = state.gutter;
    if (!g || g.phase !== 'hold' || g.t < 0.25 || g.woken) return;
    g.woken = true;
    e.stopImmediatePropagation();
  }
  global.addEventListener('keydown', comeTo, true);
  global.addEventListener('pointerdown', comeTo, true);

  /** After waking: black fading back to the picture, the last static dying away. */
  function updateWaking(dt) {
    const f = state.fx.faint, F = PSYCHE.faint;
    if (!f || f.waking === undefined) return;
    f.waking += dt;
    f.black = 1 - smooth(0, F.wake, f.waking);
    f.static = F.wakeStatic * (1 - smooth(0, F.wake * 1.2, f.waking));
    if (f.waking >= F.wake * 1.2) state.fx.faint = null;
  }

  function wake() {
    state.gutter = null;
    state.paused = false;
    psy.on = {}; psy.draining = false; darkT = 0;
    const out = W.faint(); // the rooms since your last save are suspended; your pack stays where you fell
    state.fx.faint = { black: 1, static: PSYCHE.faint.wakeStatic, streakT: 3, shatter: 0, waking: 0 }; // after faint(): its reload clears the effects
    const lost = out.lost;
    const run = state.run;
    run.fuel = RULES.wakeCharges; // what you had is in your pack
    run.lampOn = true;
    run.stamina = 1;
    run.gutters = (run.gutters || 0) + 1;
    state.lampGrace = RULES.lampGrace;
    const st = W.hearth();
    if (st) W.placeAt(st);
    else { Object.assign(state.player, W.spawnPoint(state.exp), { z: 0, vz: 0 }); W.snapCamera(); }
    W.showCaption(`you wake by the lantern in ${st ? st.spaceId : 's0'}` +
      (lost ? ` · ${lost} room${lost === 1 ? '' : 's'} lost to the dark` : '') +
      (out.pack ? ' · your pack lies where you fell' : '') + ` · ${chargeText(run.fuel)} of entropy`);
    savePlayer();
    W.refreshHud();
  }

  // ---------------------------------------------------------------------------
  // How the lamp looks: colour, halo, light and its edge, embers, streams

  /** 0..1: full at RULES.lampFullCharges or more, 0 when empty. */
  function lampLevel() {
    return THREE.MathUtils.clamp(state.run.fuel / RULES.lampFullCharges, 0, 1);
  }

  const lerp = (a, b, k) => a + (b - a) * k;
  const smooth = (a, b, x) => { const k = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
  const between = (r) => r[0] + Math.random() * (r[1] - r[0]);

  /**
   * How unsettled the flame is, by fuel: `flick` is the fast flicker's
   * depth, `fade` the slow irregular fade's. Points in between blend, so
   * the stages never pop. Fuel: full ... uneasy (2) ... danger (1) ...
   * dying (0.5) ... empty.
   */
  const UNREST = [ // [fuel, flick, fade]
    [0, 0.02, 0.5],
    [RULES.lampDying / 2, 0.06, 0.4],
    [RULES.lampDying, 0.28, 0.2],
    [RULES.lampDanger, 0.38, 0.05],
    [(RULES.lampDanger + RULES.lampUneasy) / 2, 0.2, 0],
    [RULES.lampUneasy, 0.08, 0],
    [RULES.lampFullCharges, 0.03, 0],
  ];
  function unrest(fuel) {
    for (let i = 1; i < UNREST.length; i++) {
      const [f1, k1, d1] = UNREST[i];
      if (fuel <= f1) {
        const [f0, k0, d0] = UNREST[i - 1], k = (fuel - f0) / (f1 - f0);
        return { flick: lerp(k0, k1, k), fade: lerp(d0, d1, k) };
      }
    }
    const last = UNREST[UNREST.length - 1];
    return { flick: last[1], fade: last[2] };
  }

  // Colour by level, from empty to full.
  const STOPS = [[0, new THREE.Color(0x4a4446)], [0.33, new THREE.Color(0xe0402a)],
    [0.66, new THREE.Color(0xff9a3c)], [1, new THREE.Color(0xffd27a)]];
  const lampColor = new THREE.Color(), lightTint = new THREE.Color();
  const WARM = new THREE.Color(0xffb36b), EMBER_RED = new THREE.Color(0xff3a1a);
  function colorAt(level, out) {
    for (let i = 1; i < STOPS.length; i++) {
      if (level <= STOPS[i][0]) {
        const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i];
        return out.copy(ca).lerp(cb, (level - a) / (b - a));
      }
    }
    return out.copy(STOPS[STOPS.length - 1][1]);
  }

  // The halo: a flat, see-through disc with a hard edge, in the lamp's
  // colour. HALO.full across at full; it shrinks with the fuel and wobbles
  // with the flame, more as it fails, and can wobble out past its average.
  // It lasts until the lamp is out.
  const HALO = {
    full: 0.34 * S,   // diameter at full (the lamp itself is 0.08 S)
    minScale: 0.4,    // of full, as the lamp empties
    opacity: 0.3,     // at full
    lowOpacity: 0.12, // at the very end
    wobble: 0.6,      // how far the flicker pushes its size around
    fedScale: 1.35,   // fed by an entropy light: it swells this much
    fedOpacity: 0.16, // and gets this much more solid
  };
  // Fed by an entropy light, that light gets a halo too, in its colour.
  const FEED_GLOW = { size: 0.4 * S, opacity: 0.36, ease: 4 };
  function hardDisc() {
    const n = 128, cv = document.createElement('canvas');
    cv.width = cv.height = n;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(n / 2, n / 2, n / 2 - 2, 0, Math.PI * 2); g.fill();
    return new THREE.CanvasTexture(cv);
  }
  const haloMat = new THREE.SpriteMaterial({ map: hardDisc(), transparent: true, depthWrite: false });
  const halo = new THREE.Sprite(haloMat);
  halo.renderOrder = 5;
  scene.add(halo); // follows the lamp in world space (the figure's rig squashes when crouched)
  const feedGlowMat = new THREE.SpriteMaterial({ map: haloMat.map, transparent: true, depthWrite: false, opacity: 0 });
  const feedGlow = new THREE.Sprite(feedGlowMat);
  feedGlow.renderOrder = 5;
  feedGlow.visible = false;
  scene.add(feedGlow);
  let fedAmt = 0; // eased: 1 while an entropy light feeds the lamp

  // The light's look: the lantern, a plain point light that goes redder,
  // dimmer and shorter as the fuel drops, flickering with the flame. Its
  // pool is separate (light.js): a steady circle on the floor around you
  // where the light shows in bands, and what creatures read as your light.
  const LIGHT = {
    minIntensity: 0.25, // of full, when empty
    minRange: 0.18,     // of full, when empty: how far the point light's falloff reaches
    redden: 0.5,        // how far the light's colour follows the lamp's toward red
    swell: 0.35,        // dying: brightness swell while you move
    poolFull: 3.2,      // cells: the pool's radius at a full lamp (RULES.lampFullCharges or more)
    poolEmpty: 0.9,     // cells: its radius as the lamp empties
    poolCurve: 1,       // over 1 holds it wide and shrinks it late; under 1, early
    breathe: 0,         // of the radius: how much the flame's flicker moves the pool (0: steady)
  };

  /**
   * The lamp's pool, as a light.js pool: centred on you, its radius from
   * the fuel (steady), and the lamp as where its light comes from (what
   * blocks it). Covered or out, it has no radius.
   */
  function lampLight() {
    const p = state.player, q = lantern.position;
    return {
      x: p.x, y: p.y, from: { x: q.x / S, y: q.z / S, h: q.y / S },
      r: lampOn() ? lerp(LIGHT.poolEmpty, LIGHT.poolFull, Math.pow(lampLevel(), LIGHT.poolCurve)) : 0,
    };
  }

  /**
   * How far your light reaches across the floor, in cells: its pool's edge.
   * Creatures that keep to its edge read it (creepers.js); 0 while the lamp
   * is out or covered.
   */
  function lightRadius() {
    return lampLight().r;
  }

  // Embers: points rising off the lamp. Walking, they spray and trail
  // behind you; standing still, they rise in a slow, swaying column, like
  // embers off a flame. Dying, only the odd red one. Additive, so a dead
  // one is just black.
  const EMBER = {
    still: 0.25,  // cells/s: below this you count as standing
    walk: { rate: 22, life: [0.35, 0.75], spread: 0.25, rise: [0.25, 0.6], sway: 0 },
    idle: { rate: 9, life: [0.9, 1.6], spread: 0.05, rise: [0.12, 0.22], sway: 0.12 },
    dyingRate: 0.7,     // per second, in the dying stage
    swayHz: [1.2, 2.2], // how fast an idle ember weaves
    drag: 2.5,          // of its sideways speed, lost per second
  };
  const SPARKS = 48;
  const sparkPos = new Float32Array(SPARKS * 3), sparkCol = new Float32Array(SPARKS * 3);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    size: 0.045 * S, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  sparks.frustumCulled = false;
  scene.add(sparks);
  const spark = Array.from({ length: SPARKS }, () => ({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, sway: 0, hz: 1, ph: 0, red: false }));
  let sparkClock = 0, sparkNext = 0, stillness = 0;
  const lampWorld = new THREE.Vector3();
  const lastPos = { x: 0, y: 0 };

  // Streams: motes flowing into the lamp from whatever is feeding it. A
  // well you're drinking from pours (STREAM); an entropy light sheltering
  // you only drips (DRIP), now and then, slow: a hint of the link, not a
  // pull. A source calls feedFrom(worldPos, colour, drip) every frame it's
  // feeding.
  const STREAM = { rate: 16, travel: 0.6, arc: 0.25 * S, count: 40 };
  const DRIP = {
    every: [1.3, 2.8], // seconds between drops
    travel: 1.4,       // seconds a drop takes to reach the lamp
    arc: 0.12 * S,     // how far it bows up on the way
    size: 1.6,         // of a stream mote's brightness
  };
  const streamPos = new Float32Array(STREAM.count * 3), streamCol = new Float32Array(STREAM.count * 3);
  const streamGeo = new THREE.BufferGeometry();
  streamGeo.setAttribute('position', new THREE.BufferAttribute(streamPos, 3));
  streamGeo.setAttribute('color', new THREE.BufferAttribute(streamCol, 3));
  const streamPts = new THREE.Points(streamGeo, new THREE.PointsMaterial({
    size: 0.05 * S, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  streamPts.frustumCulled = false;
  scene.add(streamPts);
  const motes = Array.from({ length: STREAM.count }, () => ({ t: 1, from: new THREE.Vector3(), col: new THREE.Color(), off: 0, travel: 1, arc: 0, k: 1 }));
  const feeds = [], drips = [];
  let streamClock = 0, dripClock = 0;
  function feedFrom(pos, color, drip) { (drip ? drips : feeds).push({ pos: pos.clone(), color: new THREE.Color(color) }); }
  const scPos = new THREE.Vector3();
  function launch(f, travel, arc, k) {
    const m = motes.find((o) => o.t >= 1);
    if (!m) return;
    m.t = 0; m.from.copy(f.pos); m.col.copy(f.color); m.off = (Math.random() - 0.5) * 0.3 * (arc / STREAM.arc);
    m.travel = travel; m.arc = arc; m.k = k;
  }

  /** The entropy light feeding your lamp now (light.js), or null. */
  const feeder = () => (lampMode === 'sheltered' && !state.paused && lampOn() ? W.light.shelterAt(state.player.x, state.player.y) : null);

  function updateStreams(dt, fed) {
    if (state.paused) feeds.length = drips.length = 0;
    if (fed) { fed.flame.getWorldPosition(scPos); feedFrom(scPos, fed.color, true); }
    streamClock += dt;
    while (feeds.length && streamClock >= 1 / STREAM.rate) {
      streamClock -= 1 / STREAM.rate;
      launch(feeds[Math.floor(Math.random() * feeds.length)], STREAM.travel, STREAM.arc, 1);
    }
    if (!feeds.length) streamClock = 0;
    // Drips: the first comes soon after you step in, then one every so often.
    if (drips.length) {
      dripClock -= dt;
      if (dripClock <= 0) {
        launch(drips[Math.floor(Math.random() * drips.length)], DRIP.travel, DRIP.arc, DRIP.size);
        dripClock = between(DRIP.every);
      }
    } else dripClock = 0.25;
    feeds.length = drips.length = 0;
    motes.forEach((m, i) => {
      if (m.t < 1) m.t = Math.min(1, m.t + dt / m.travel);
      const k = m.t * m.t * (3 - 2 * m.t), up = Math.sin(Math.PI * m.t) * (m.arc + m.off);
      streamPos[i * 3] = lerp(m.from.x, lampWorld.x, k);
      streamPos[i * 3 + 1] = lerp(m.from.y, lampWorld.y, k) + up;
      streamPos[i * 3 + 2] = lerp(m.from.z, lampWorld.z, k);
      const a = m.t < 1 ? Math.sin(Math.PI * m.t) * m.k : 0;
      streamCol[i * 3] = m.col.r * a; streamCol[i * 3 + 1] = m.col.g * a; streamCol[i * 3 + 2] = m.col.b * a;
    });
    streamGeo.attributes.position.needsUpdate = true;
    streamGeo.attributes.color.needsUpdate = true;
  }

  let onAmt = 1; // the light easing on and off (covering, relighting, going out)
  function updateLampLook(dt) {
    const t = state.time, run = state.run, p = state.player;
    const g = state.gutter ? Math.max(0, 1 - state.gutter.total / GUTTER_FADE) : 1;
    onAmt += ((lampOn() ? 1 : 0) - onAmt) * Math.min(1, dt * 6);
    const on = onAmt * g;
    const fuel = run.fuel, level = lampLevel();
    const u = unrest(fuel);
    const dying = 1 - smooth(RULES.lampDying / 2, RULES.lampDying, fuel); // 0 above the dying stage, 1 near empty

    // Standing or moving, for the embers and the dying swell.
    const speed = dt > 0 ? Math.hypot(p.x - lastPos.x, p.y - lastPos.y) / dt : 0;
    lastPos.x = p.x; lastPos.y = p.y;
    stillness += ((speed < EMBER.still ? 1 : 0) - stillness) * Math.min(1, dt * 3);

    // Fast flicker (jitter), a slow irregular fade, and a swell when you move while it's dying.
    const jitter = Math.sin(t * 17.3) * Math.sin(t * 6.1 + 1.3);
    const jitter2 = Math.sin(t * 13.7 + 0.7) * Math.sin(t * 4.3 + 2.1);
    const slow = (Math.sin(t * 0.9) + Math.sin(t * 1.7 + 2) + Math.sin(t * 0.37 + 4)) / 3;
    const swell = dying * (1 - stillness) * LIGHT.swell;
    const bright = (1 - u.flick * Math.abs(jitter)) * (1 - u.fade * (0.5 + 0.5 * slow)) * (1 + swell);

    colorAt(level * (0.85 + 0.15 * Math.min(1, bright)), lampColor);
    lanternMesh.material.color.copy(lampColor).multiplyScalar(lerp(0.25, 1, on));

    colorAt(Math.max(level, 0.3), lightTint);
    lantern.color.copy(WARM).lerp(lightTint, LIGHT.redden * (1 - level) + 0.3);
    lantern.intensity = LANTERN * lerp(LIGHT.minIntensity, 1, level) * bright * on * (0.96 + 0.04 * Math.sin(t * 9.3));
    const reach = lerp(LIGHT.minRange, 1, smooth(0, 1, level)) * (0.92 + 0.08 * bright);
    lantern.distance = LANTERN_RANGE * reach;

    // Fed by an entropy light: your halo swells and brightens, and the light gets one of its own.
    const fed = feeder();
    fedAmt += ((fed ? 1 : 0) - fedAmt) * Math.min(1, dt * FEED_GLOW.ease);
    if (fed) {
      fed.flame.getWorldPosition(feedGlow.position);
      feedGlowMat.color.set(fed.color);
    }
    feedGlow.visible = fedAmt > 0.01;
    feedGlowMat.opacity = FEED_GLOW.opacity * fedAmt * (0.9 + 0.1 * Math.sin(t * 5.1));
    feedGlow.scale.setScalar(FEED_GLOW.size * (0.7 + 0.3 * fedAmt));

    lanternMesh.getWorldPosition(lampWorld);
    haloMat.color.copy(lampColor);
    halo.position.copy(lampWorld);
    const wob = 1 + HALO.wobble * (u.flick * jitter2 + u.fade * 0.6 * slow) + swell * 0.6;
    halo.scale.setScalar(HALO.full * (HALO.minScale + (1 - HALO.minScale) * level) * Math.max(0.3, wob) * lerp(1, HALO.fedScale, fedAmt));
    haloMat.opacity = (lerp(HALO.lowOpacity, HALO.opacity, smooth(0, 0.66, level)) + HALO.fedOpacity * fedAmt) * Math.min(1.2, bright) * on;

    // The pool on the floor, breathing with the flame only as much as LIGHT.breathe says.
    const pool = lampLight();
    pool.r *= 1 - LIGHT.breathe + LIGHT.breathe * Math.min(1.2, bright);
    W.light.setLampPool(pool);

    // Embers: fewer, dimmer and shorter-lived as the lamp fails; how still
    // you are (eased) blends the walking spray into the idle column; dying,
    // only the odd red one.
    const mix = (k) => lerp(EMBER.walk[k], EMBER.idle[k], stillness);
    const mixR = (k) => [lerp(EMBER.walk[k][0], EMBER.idle[k][0], stillness), lerp(EMBER.walk[k][1], EMBER.idle[k][1], stillness)];
    sparkClock += dt;
    const rate = fuel <= 0 || on < 0.5 || state.paused ? 0
      : lerp(mix('rate') * (0.2 + 0.8 * level), EMBER.dyingRate, dying);
    while (rate && sparkClock >= sparkNext) {
      sparkClock -= sparkNext;
      sparkNext = 1 / rate * (0.6 + Math.random() * 0.8);
      const s = spark.find((o) => o.life <= 0);
      if (!s) break;
      const i = spark.indexOf(s);
      s.red = dying > 0.5;
      s.max = s.life = between(mixR('life')) * (0.6 + 0.4 * level) * (s.red ? 1.6 : 1);
      const spread = mix('spread');
      s.vx = (Math.random() - 0.5) * spread * S; s.vz = (Math.random() - 0.5) * spread * S;
      s.vy = between(mixR('rise')) * S;
      s.sway = Math.max(mix('sway'), s.red ? 0.08 : 0) * S; s.hz = between(EMBER.swayHz); s.ph = Math.random() * Math.PI * 2;
      sparkPos[i * 3] = lampWorld.x + (Math.random() - 0.5) * 0.04 * S;
      sparkPos[i * 3 + 1] = lampWorld.y;
      sparkPos[i * 3 + 2] = lampWorld.z + (Math.random() - 0.5) * 0.04 * S;
    }
    if (!rate) sparkClock = 0;
    const drag = Math.exp(-EMBER.drag * dt);
    spark.forEach((s, i) => {
      if (s.life > 0) {
        s.life -= dt;
        s.vx *= drag; s.vz *= drag;
        // A weave that widens as it rises, like heat off a flame.
        const age = s.max - s.life;
        const w = Math.cos(age * s.hz * Math.PI * 2 + s.ph) * s.sway * Math.min(1, age * 2);
        sparkPos[i * 3] += (s.vx + w) * dt; sparkPos[i * 3 + 1] += s.vy * dt; sparkPos[i * 3 + 2] += (s.vz + w * 0.4) * dt;
      }
      const k = Math.max(0, s.life / s.max) * (s.red ? 1 : 0.5 + 0.5 * level);
      const c = s.red ? EMBER_RED : lampColor;
      sparkCol[i * 3] = c.r * k; sparkCol[i * 3 + 1] = c.g * k; sparkCol[i * 3 + 2] = c.b * k;
    });
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.attributes.color.needsUpdate = true;

    updateStreams(dt, fed);
    updateLampHud();
  }

  // ---------------------------------------------------------------------------
  // The lamp on the HUD: an icon in the lamp's colour, whose flame stands
  // lower at each stage, and a fluid meter cut into one section per charge
  // (the one that's burning shows dimmer). Fed by an entropy light the icon
  // and its lantern shimmer gold; drinking from a well, violet. Looking at
  // something that costs entropy (lighting a sconce, a reroll), the share it
  // would take pulses on the meter, harder while you hold E (red if you
  // can't afford it); snuffing a sconce, the share it gives back shows
  // past your fuel. Under the meter, psychic stamina: a
  // thin bar, and the screen's edges closing in as it falls. Words only
  // when the lamp is off, to say how to relight it.

  const FLAME_H = [[RULES.lampUneasy, 1], [RULES.lampDanger, 0.8], [RULES.lampDying, 0.62], [0, 0.45]];
  const meterEl = $('lamp-meter'), iconEl = $('lamp-icon'), stateEl = $('lamp-state');
  const flameEl = $('lamp-flame'), staminaEl = $('stamina'); // the edges closing in are the psyche's now (fx.js)
  if (iconEl) iconEl.addEventListener('click', toggleLamp);
  let built = -1, lastSig = '';
  let preview = null; // { cost (charges: over 0 spends, under 0 gives back), held (0..1) }
  /** What the focused action would cost (hud.js, every frame): charges (negative: a gain), and how far its hold has filled. */
  function previewCost(cost, held) {
    preview = cost ? { cost, held: held || 0 } : null;
  }
  function updateLampHud(force) {
    if (!meterEl) return;
    const run = state.run, max = maxCharges();
    if (staminaEl) {
      staminaEl.firstChild.style.width = (run.stamina * 100).toFixed(1) + '%';
      staminaEl.classList.toggle('low', run.stamina < 0.35);
      staminaEl.classList.toggle('draining', !!state.ghostTouch || lampMode === 'dark' || state.creeperDrain > 0);
      staminaEl.title = `psychic stamina ${Math.round(run.stamina * 100)}% · a ghost's touch, a creeper close by and the dark drain it; it comes back in light`;
    }
    const n = Math.max(max, Math.ceil(run.fuel - 1e-6));
    if (n !== built || force) {
      meterEl.innerHTML = '';
      for (let i = 0; i < n; i++) {
        const sec = el('span', 'sec' + (i >= RULES.chargesMax ? ' buff' : ''));
        sec.append(el('i', 'liquid'), el('i', 'cost'));
        meterEl.append(sec);
      }
      built = n;
      lastSig = '';
    }
    const off = !state.gutter && !lampOn();
    const mode = state.gutter ? 'out' : lampMode;
    const pv = preview;
    const sig = run.fuel.toFixed(3) + mode + W.drinking() + off + run.lampOn + (pv ? pv.cost.toFixed(3) + (pv.held > 0) : '');
    if (sig === lastSig) return;
    lastSig = sig;
    // The span the preview marks: what it would take off the top of your fuel, or add past it.
    const short = !!pv && pv.cost > run.fuel + 1e-6;
    const lo = !pv ? 0 : pv.cost > 0 ? Math.max(0, run.fuel - pv.cost) : run.fuel;
    const hi = !pv ? 0 : pv.cost > 0 ? run.fuel : Math.min(max, run.fuel - pv.cost);
    meterEl.classList.toggle('previewing', !!pv);
    meterEl.classList.toggle('holding', !!pv && pv.held > 0);
    Array.from(meterEl.children).forEach((sec, i) => {
      const f = THREE.MathUtils.clamp(run.fuel - i, 0, 1);
      sec.firstChild.style.width = (f * 100).toFixed(1) + '%';
      const a = THREE.MathUtils.clamp(lo - i, 0, 1), b = THREE.MathUtils.clamp(hi - i, 0, 1);
      const cost = sec.children[1];
      cost.style.left = (a * 100).toFixed(1) + '%';
      cost.style.width = (Math.max(0, b - a) * 100).toFixed(1) + '%';
      sec.className = 'sec' + (i >= RULES.chargesMax ? ' buff' : '') + (f >= 1 ? ' full' : f > 0 ? ' part' : '') +
        (pv && b > a ? (pv.cost < 0 ? ' gain' : short ? ' short' : ' spend') : '');
    });
    iconEl.style.color = '#' + lampColor.getHexString();
    iconEl.classList.toggle('burning', mode === 'burning' || mode === 'held');
    iconEl.classList.toggle('danger', !off && run.fuel <= RULES.lampDanger);
    iconEl.classList.toggle('sheltered', mode === 'sheltered' && !off);
    iconEl.classList.toggle('drinking', W.drinking());
    iconEl.classList.toggle('off', off);
    if (flameEl) flameEl.style.transform = `scaleY(${(FLAME_H.find(([f]) => run.fuel > f) || [0, 0.45])[1]})`;
    if (stateEl) {
      stateEl.textContent = !off ? ''
        : run.fuel < RELIGHT - 1e-6 ? `out · find entropy, then ${relightKey()}`
          : `${relightKey()} to relight (${RULES.relightShards} shard)`;
    }
    meterEl.parentElement.parentElement.title =
      `entropy ${run.fuel.toFixed(2)} of ${max} charges · the lamp burns a charge every ${RULES.lampSeconds * RULES.shardsPerCharge} s · ${relightKey()} covers or relights it`;
  }

  // ---------------------------------------------------------------------------
  // +◆ over your head when entropy comes in (−◆ when it's taken back).

  const popLayer = $('popups');
  const popV = new THREE.Vector3();
  function popEntropy(amount) {
    if (!popLayer) return;
    const p = state.player;
    popV.set(p.x * S, (p.z + 0.8) * S, p.y * S).project(camera);
    const n = Math.max(1, Math.min(3, Math.round(Math.abs(amount) / PER_SHARD)));
    const d = el('div', 'pop' + (amount < 0 ? ' minus' : ''), (amount < 0 ? '−' : '+') + '◆'.repeat(n));
    d.style.left = ((popV.x + 1) / 2 * global.innerWidth) + 'px';
    d.style.top = ((1 - popV.y) / 2 * global.innerHeight) + 'px';
    d.addEventListener('animationend', () => d.remove());
    popLayer.append(d);
  }

  Object.assign(W, { gainFuel, spendFuel, takeFuel, litAt, lampOn, toggleLamp, feedFrom, updateLamp,
    updateLampLook, updateLampHud, previewCost, lampLevel, PSYCHE, lightRadius, lampLight, popEntropy, passOut });
  /** The lamp's colour at this much fuel (charges), as it would show: for a pack's little lantern (packs.js). */
  const lampColorAt = (fuel, out) => colorAt(THREE.MathUtils.clamp(fuel / RULES.lampFullCharges, 0, 1), out);
  /** The lamp's colour at this level (0 empty .. 1 full), into `out`: for a save lantern's flare (lanterns.js). */
  const lampColorAtLevel = (level, out) => colorAt(THREE.MathUtils.clamp(level, 0, 1), out);
  /**
   * Your lamp's light at this much fuel (charges), steady (no flicker):
   * { intensity, distance, pool (cells) }, and its colour into `color`. For
   * a pack's little lantern, which shines like yours would (packs.js).
   */
  function lampLightAt(fuel, color) {
    const level = THREE.MathUtils.clamp(fuel / RULES.lampFullCharges, 0, 1);
    colorAt(Math.max(level, 0.3), lightTint);
    color.copy(WARM).lerp(lightTint, LIGHT.redden * (1 - level) + 0.3);
    return {
      intensity: LANTERN * lerp(LIGHT.minIntensity, 1, level),
      distance: LANTERN_RANGE * lerp(LIGHT.minRange, 1, smooth(0, 1, level)),
      pool: lerp(LIGHT.poolEmpty, LIGHT.poolFull, Math.pow(level, LIGHT.poolCurve)),
    };
  }
  Object.assign(W, { LIGHT, HALO, UNREST, EMBER, STREAM, DRIP, FEED_GLOW, lampColorAt, lampColorAtLevel, lampLightAt }); // tuning tables (the dev panel, dev.js)
})(window);
