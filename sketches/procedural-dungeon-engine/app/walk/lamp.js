// Walk mode: the lamp (GAME-DESIGN.md, section 10). One pool of entropy is
// your light and your rerolls. It's a fluid amount in charges
// (`run.fuel`): a shard adds a third of a charge, rerolls and waystones
// spend whole charges, and the lamp burns it steadily, except within a tile
// of a lit sconce. A gain holds the burn for a moment (RULES.lampGrace), so
// a charge you just earned doesn't start draining that instant.
//
// When the fuel runs out the lamp goes out, and stays out until you relight
// it with R (a shard). R while it's lit covers it: no light, no burn, and
// ghosts can't notice you, but the dark wears on your psychic stamina.
//
// Psychic stamina is your other meter (GAME-DESIGN.md, section 12). A
// ghost's touch drains it, and so does the dark, more slowly. Empty, you
// pass out and wake at your last waystone, and lose everything opened since
// you last used one (game.js). It refills in light once nothing drains it.
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

  /** Is this spot sheltered by a lit sconce (its tile, or one of the 8 around it, same room)? */
  function litAt(p) {
    return !!shelterAt(p);
  }
  function shelterAt(p) {
    const cx = Math.floor(p.x), cy = Math.floor(p.y);
    return state.sconces.find((sc) => sc.lit && sc.spaceId === p.spaceId &&
      Math.abs(sc.cell.x - cx) <= 1 && Math.abs(sc.cell.y - cy) <= 1) || null;
  }

  // ---------------------------------------------------------------------------
  // Lit, covered, out: R relights or covers

  const lampOn = () => !!state.run.lampOn && state.run.fuel > 0;
  const relightKey = () => (W.verbF === 'tap' ? 'tap the lamp' : 'R');

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

  const GUTTER_FADE = 1.2, GUTTER_DARK = 1.4; // seconds: you sink, then darkness
  let lampMode = '';
  let staminaIdle = 0; // seconds since anything last drained your stamina

  function updateLamp(dt) {
    const run = state.run, p = state.player;
    if (state.gutter) {
      state.gutter.t += dt;
      if (state.gutter.t >= GUTTER_FADE + GUTTER_DARK) wake();
      return;
    }
    let mode = 'burning';
    if (state.paused || state.bigmap) mode = 'paused';
    else if (litAt(p)) mode = 'sheltered';
    else if (!lampOn()) mode = 'dark';
    else if (state.lampGrace > 0) mode = 'held';
    state.lampGrace = Math.max(0, (state.lampGrace || 0) - (mode === 'paused' ? 0 : dt));
    lampMode = mode;
    if (mode === 'paused') return;
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
   * knocks a chunk off once and drains it while you stay in its reach; the
   * dark drains it too, more slowly. In light, with nothing draining it for
   * a moment, it refills.
   */
  function updateStamina(dt, mode) {
    const run = state.run;
    const touch = !!state.ghostTouch, dark = mode === 'dark';
    const creep = state.creeperDrain || 0; // 0..1, a creeper's nearness (creepers.js)
    if (touch && !state.wasTouched) run.stamina -= RULES.staminaHit;
    state.wasTouched = touch;
    if (touch || dark || creep > 0) {
      run.stamina -= ((touch ? RULES.staminaDrain : 0) + (dark ? RULES.staminaDarkDrain : 0) +
        RULES.staminaCreeperDrain * creep) * dt;
      staminaIdle = 0;
    } else {
      staminaIdle += dt;
      if (staminaIdle >= RULES.staminaRegenDelay) run.stamina += RULES.staminaRegen * dt;
    }
    run.stamina = THREE.MathUtils.clamp(run.stamina, 0, 1);
    if (run.stamina <= 0) {
      passOut(touch ? 'the ghost is too much · you pass out'
        : creep > 0 && !dark ? 'the creeper is too close · you pass out' : 'the dark is too much · you pass out');
    }
  }

  function passOut(text) {
    state.gutter = { t: 0 };
    state.paused = true;
    state.wasTouched = false;
    W.keys.clear();
    W.showCaption(text);
    const f = $('fade');
    if (f) f.classList.add('on');
  }

  function wake() {
    state.gutter = null;
    state.paused = false;
    const lost = W.faint(); // the rooms since your last checkpoint, and the run back to it
    const run = state.run;
    run.fuel = Math.max(run.fuel, RULES.chargesStart);
    run.lampOn = true;
    run.stamina = 1;
    run.gutters = (run.gutters || 0) + 1;
    state.lampGrace = RULES.lampGrace;
    const st = W.hearth();
    if (st) W.placeAt(st);
    else { Object.assign(state.player, W.spawnPoint(state.exp), { z: 0, vz: 0 }); W.snapCamera(); }
    const f = $('fade');
    if (f) f.classList.remove('on');
    W.showCaption(`you wake by the waystone in ${st ? st.spaceId : 's0'}` +
      (lost ? ` · ${lost} room${lost === 1 ? '' : 's'} lost to the dark` : '') + ` · ${chargeText(run.fuel)} of entropy`);
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
  };
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

  // The light's reach and colour. Dimming, it goes redder and dimmer. It
  // ends at a hard edge, past which there's only the ambient fill: a
  // sphere around the lamp, sized so it meets the floor in a circle of the
  // edge's radius. On a wall the edge curves like a pool of light rather
  // than a vertical line. The circle is always there and shrinks with the
  // fuel. The last stretch inside it steps down in bands, like a creeper's
  // discs (each band a smaller sphere meeting the floor a band further in).
  const LIGHT = {
    minIntensity: 0.25, // of full, when empty
    minRange: 0.18,     // of full, when empty: the point light's own falloff, inside the edge
    redden: 0.5,        // how far the light's colour follows the lamp's toward red
    swell: 0.35,        // dying: brightness swell while you move
    radiusFull: 3.2,    // cells: the edge at a full lamp (RULES.lampFullCharges or more)
    radiusEmpty: 0.9,   // cells: the edge as it empties
    radiusCurve: 1,     // over 1 holds it wide and shrinks it late; under 1, early
    breathe: 0.04,      // of the radius: how much the flame's flicker moves the edge
    soft: 0.03,         // cells: anti-aliasing across the edge (0 is razor sharp)
    sphere: true,       // the edge is a sphere around the lamp (off: a cylinder, cut straight up walls)
    banded: true,       // step the light down in bands just inside the edge (on the floor and block tops)
    wallBands: 0,       // how much walls and other upright faces band too (0: the plain edge, 1: as the floor)
    bands: 3,           // how many
    bandWidth: 0.32,    // cells each, on the floor
    bandFloor: 0.2,     // the outermost band's brightness (the inner ones step up to full)
  };

  /**
   * How far the light reaches, in cells: the hard edge, without the
   * flicker. Creatures that keep to its edge read it (creepers.js); 0 while
   * the lamp is out or covered.
   */
  function lightRadius() {
    return lampOn() ? edgeRadius() : 0;
  }
  function edgeRadius() {
    return lerp(LIGHT.radiusEmpty, LIGHT.radiusFull, Math.pow(lampLevel(), LIGHT.radiusCurve));
  }

  // The edge is a mask on the lantern's light in every lit material's
  // shader: three.js sorts shadow-casting lights first, and the lantern is
  // the only point light that casts shadows, so it's always pointLights[0].
  // Every material shares the one uniform object (three.js copies a
  // uniform's value by reference when it isn't a vector, colour, matrix or
  // texture), so setting it once a frame reaches them all.
  // center: the lamp's world xyz, radius on the floor; band: count, width, floor, soft;
  // shape: sphere (1) or cylinder (0), how much upright faces band
  const lampMask = { center: new THREE.Vector4(), band: new THREE.Vector4(), shape: new THREE.Vector4() };
  for (const k of ['lambert', 'phong', 'standard', 'physical', 'toon']) {
    if (THREE.ShaderLib[k]) THREE.ShaderLib[k].uniforms.lampMask = { value: lampMask };
  }
  THREE.ShaderChunk.lights_pars_begin += `
struct LampMask { vec4 center; vec4 band; vec4 shape; };
uniform LampMask lampMask;
// 1 inside the lamp's edge, 0 past it. d is the radius on the floor (y = 0)
// of the sphere around the lamp through this point: across the floor it's
// just the distance from you; up a wall it grows with the height off the
// lamp's, so the edge curves. As a cylinder, it's the distance across the floor.
// Bands only on faces turned up (the floor, block tops), blending out as a
// face turns upright, so walls get the plain edge (shape.y of the banding).
float lampMaskAt(vec3 viewPos, vec3 normal) {
  float R = lampMask.center.w;
  if (R <= 0.0) return 1.0;
  vec3 c = (viewMatrix * vec4(lampMask.center.xyz, 1.0)).xyz;
  vec3 up = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  vec3 dv = viewPos - c;
  float h = dot(dv, up), flat2 = dot(dv, dv) - h * h;
  float lampH = lampMask.center.y; // the lamp's height over the floor
  float d = lampMask.shape.x > 0.5 ? sqrt(max(flat2 + h * h - lampH * lampH, 0.0)) : sqrt(max(flat2, 0.0));
  float m = 1.0 - smoothstep(R - lampMask.band.w, R, d);
  float n = lampMask.band.x;
  if (n > 0.5) {
    float i = ceil((R - d) / lampMask.band.y); // 1 in the outermost band
    float flatness = smoothstep(0.55, 0.85, abs(dot(normalize(normal), up)));
    float k = mix(lampMask.shape.y, 1.0, flatness);
    if (i <= n) m *= mix(1.0, mix(lampMask.band.z, 1.0, (max(i, 1.0) - 1.0) / n), k);
  }
  return m;
}
`;
  THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin.replace(
    'getPointLightInfo( pointLight, geometryPosition, directLight );',
    `getPointLightInfo( pointLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX == 0 ) && ( NUM_POINT_LIGHT_SHADOWS > 0 )
		directLight.color *= lampMaskAt( geometryPosition, geometryNormal );
		#endif`);

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

  // Streams: motes flowing into the lamp from whatever is feeding it (a lit
  // sconce sheltering it, a well you're drinking from). A source calls
  // feedFrom(worldPos, colour) every frame it's feeding.
  const STREAM = { rate: 16, travel: 0.6, arc: 0.25 * S, count: 40 };
  const streamPos = new Float32Array(STREAM.count * 3), streamCol = new Float32Array(STREAM.count * 3);
  const streamGeo = new THREE.BufferGeometry();
  streamGeo.setAttribute('position', new THREE.BufferAttribute(streamPos, 3));
  streamGeo.setAttribute('color', new THREE.BufferAttribute(streamCol, 3));
  const streamPts = new THREE.Points(streamGeo, new THREE.PointsMaterial({
    size: 0.05 * S, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  streamPts.frustumCulled = false;
  scene.add(streamPts);
  const motes = Array.from({ length: STREAM.count }, () => ({ t: 1, from: new THREE.Vector3(), col: new THREE.Color(), off: 0 }));
  const feeds = [];
  let streamClock = 0;
  function feedFrom(pos, color) { feeds.push({ pos: pos.clone(), color: new THREE.Color(color) }); }
  const scPos = new THREE.Vector3();

  function updateStreams(dt) {
    if (state.paused) feeds.length = 0;
    if (lampMode === 'sheltered' && !state.paused) {
      const sc = shelterAt(state.player);
      if (sc) { sc.flame.getWorldPosition(scPos); feedFrom(scPos, 0xffc06a); }
    }
    streamClock += dt;
    while (feeds.length && streamClock >= 1 / STREAM.rate) {
      streamClock -= 1 / STREAM.rate;
      const m = motes.find((o) => o.t >= 1);
      if (!m) break;
      const f = feeds[Math.floor(Math.random() * feeds.length)];
      m.t = 0; m.from.copy(f.pos); m.col.copy(f.color); m.off = (Math.random() - 0.5) * 0.3;
    }
    if (!feeds.length) streamClock = 0;
    feeds.length = 0;
    motes.forEach((m, i) => {
      if (m.t < 1) m.t = Math.min(1, m.t + dt / STREAM.travel);
      const k = m.t * m.t * (3 - 2 * m.t), up = Math.sin(Math.PI * m.t) * (STREAM.arc + m.off);
      streamPos[i * 3] = lerp(m.from.x, lampWorld.x, k);
      streamPos[i * 3 + 1] = lerp(m.from.y, lampWorld.y, k) + up;
      streamPos[i * 3 + 2] = lerp(m.from.z, lampWorld.z, k);
      const a = m.t < 1 ? Math.sin(Math.PI * m.t) : 0;
      streamCol[i * 3] = m.col.r * a; streamCol[i * 3 + 1] = m.col.g * a; streamCol[i * 3 + 2] = m.col.b * a;
    });
    streamGeo.attributes.position.needsUpdate = true;
    streamGeo.attributes.color.needsUpdate = true;
  }

  let onAmt = 1; // the light easing on and off (covering, relighting, going out)
  function updateLampLook(dt) {
    const t = state.time, run = state.run, p = state.player;
    const g = state.gutter ? Math.max(0, 1 - state.gutter.t / GUTTER_FADE) : 1;
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

    lanternMesh.getWorldPosition(lampWorld);
    haloMat.color.copy(lampColor);
    halo.position.copy(lampWorld);
    const wob = 1 + HALO.wobble * (u.flick * jitter2 + u.fade * 0.6 * slow) + swell * 0.6;
    halo.scale.setScalar(HALO.full * (HALO.minScale + (1 - HALO.minScale) * level) * Math.max(0.3, wob));
    haloMat.opacity = lerp(HALO.lowOpacity, HALO.opacity, smooth(0, 0.66, level)) * Math.min(1.2, bright) * on;

    // The light's edge, breathing a little with the flame.
    const edge = edgeRadius() * (1 - LIGHT.breathe + LIGHT.breathe * Math.min(1.2, bright));
    // Centred over you at the lamp's height, so the floor circle is the edge creatures read (lightRadius).
    lampMask.center.set(p.x * S, Math.max(0, lampWorld.y), p.y * S, Math.max(0.01, edge * S));
    lampMask.shape.set(LIGHT.sphere ? 1 : 0, LIGHT.wallBands, 0, 0);
    lampMask.band.set(LIGHT.banded ? Math.round(LIGHT.bands) : 0, Math.max(0.01, LIGHT.bandWidth * S),
      LIGHT.bandFloor, Math.max(0, LIGHT.soft * S));

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

    updateStreams(dt);
    updateLampHud();
  }

  // ---------------------------------------------------------------------------
  // The lamp on the HUD: an icon in the lamp's colour, whose flame stands
  // lower at each stage, and a fluid meter cut into one section per charge
  // (the one that's burning shows dimmer). By a sconce the icon shimmers
  // gold; drinking from a well, violet. Under the meter, psychic stamina: a
  // thin bar, and the screen's edges closing in as it falls. Words only
  // when the lamp is off, to say how to relight it.

  const FLAME_H = [[RULES.lampUneasy, 1], [RULES.lampDanger, 0.8], [RULES.lampDying, 0.62], [0, 0.45]];
  const meterEl = $('lamp-meter'), iconEl = $('lamp-icon'), stateEl = $('lamp-state');
  const flameEl = $('lamp-flame'), staminaEl = $('stamina'), vignetteEl = $('vignette');
  if (iconEl) iconEl.addEventListener('click', toggleLamp);
  let built = -1, lastSig = '';
  function updateLampHud(force) {
    if (!meterEl) return;
    const run = state.run, max = maxCharges();
    if (staminaEl) {
      staminaEl.firstChild.style.width = (run.stamina * 100).toFixed(1) + '%';
      staminaEl.classList.toggle('low', run.stamina < 0.35);
      staminaEl.classList.toggle('draining', !!state.ghostTouch || lampMode === 'dark' || state.creeperDrain > 0);
      staminaEl.title = `psychic stamina ${Math.round(run.stamina * 100)}% · a ghost's touch, a creeper close by and the dark drain it; it comes back in light`;
    }
    if (vignetteEl) vignetteEl.style.opacity = ((1 - run.stamina) * 0.85).toFixed(3);
    const n = Math.max(max, Math.ceil(run.fuel - 1e-6));
    if (n !== built || force) {
      meterEl.innerHTML = '';
      for (let i = 0; i < n; i++) {
        const sec = el('span', 'sec' + (i >= RULES.chargesMax ? ' buff' : ''));
        sec.append(el('i', 'liquid'));
        meterEl.append(sec);
      }
      built = n;
      lastSig = '';
    }
    const off = !state.gutter && !lampOn();
    const mode = state.gutter ? 'out' : lampMode;
    const sig = run.fuel.toFixed(3) + mode + W.drinking() + off + run.lampOn;
    if (sig === lastSig) return;
    lastSig = sig;
    Array.from(meterEl.children).forEach((sec, i) => {
      const f = THREE.MathUtils.clamp(run.fuel - i, 0, 1);
      sec.firstChild.style.width = (f * 100).toFixed(1) + '%';
      sec.className = 'sec' + (i >= RULES.chargesMax ? ' buff' : '') + (f >= 1 ? ' full' : f > 0 ? ' part' : '');
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
    updateLampLook, updateLampHud, lampLevel, lightRadius, popEntropy });
  Object.assign(W, { LIGHT, HALO, UNREST, EMBER, STREAM }); // tuning tables (the dev panel, dev.js)
})(window);
