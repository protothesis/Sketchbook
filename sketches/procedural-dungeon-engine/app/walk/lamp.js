// Walk mode: the lamp (GAME-DESIGN.md, section 10). One pool of entropy is
// your light and your rerolls. It's a fluid amount in charges
// (`run.fuel`): a shard adds a third of a charge, rerolls and waystones
// spend whole charges, and the lamp burns it steadily, except within a tile
// of a lit sconce. A gain holds the burn for a moment (RULES.lampGrace), so
// a charge you just earned doesn't start draining that instant. When it
// runs out the lamp gutters and you wake at your last waystone.
//
// You should feel it without looking at the meter: as the fuel falls, the
// lamp's colour goes from yellow through orange and red to grey and starts
// to flicker, its dithered halo shrinks and fades, its trail of sparks
// thins out, and the light itself gets dimmer and shorter.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { RULES, THREE, $, S, LANTERN, LANTERN_RANGE, scene, camera, state, savePlayer, el,
    maxCharges, lantern, lanternMesh, chargeText } = W;

  const PER_SHARD = 1 / RULES.shardsPerCharge;
  const DRAIN = PER_SHARD / RULES.lampSeconds; // charges per second

  // ---------------------------------------------------------------------------
  // Fuel

  /**
   * Add entropy (in charges). Never past the max, but a meter already above
   * it (a sigil's +1 lost) keeps its extra. Holds the burn for a moment and
   * shows a +◆ over your head. Returns what was added.
   */
  function gainFuel(amount) {
    const run = state.run, max = maxCharges();
    const add = Math.max(0, Math.min(amount, max - run.fuel));
    run.fuel += add;
    state.lampGrace = RULES.lampGrace;
    if (add > 1e-6) popEntropy(add);
    return add;
  }

  /** Spend entropy if there's enough; false (and nothing spent) if not. */
  function spendFuel(amount) {
    const run = state.run;
    if (run.fuel < amount - 1e-6) return false;
    run.fuel = Math.max(0, run.fuel - amount);
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
    const cx = Math.floor(p.x), cy = Math.floor(p.y);
    return state.sconces.some((sc) => sc.lit && sc.spaceId === p.spaceId &&
      Math.abs(sc.cell.x - cx) <= 1 && Math.abs(sc.cell.y - cy) <= 1);
  }

  // ---------------------------------------------------------------------------
  // Burning, guttering, waking

  const GUTTER_FADE = 1.2, GUTTER_DARK = 1.4; // seconds: the flame dies, then darkness
  let lampMode = '';

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
    else if (state.lampGrace > 0) mode = 'held';
    state.lampGrace = Math.max(0, (state.lampGrace || 0) - (mode === 'paused' ? 0 : dt));
    lampMode = mode;
    if (mode !== 'burning') return;
    const before = run.fuel;
    run.fuel = Math.max(0, run.fuel - DRAIN * dt);
    run.lampBurned = (run.lampBurned || 0) + (before - run.fuel);
    if (run.fuel <= 0) gutter();
    else if (before > RULES.lampDanger && run.fuel <= RULES.lampDanger) W.showCaption('your lamp is running low');
  }

  function gutter() {
    state.gutter = { t: 0 };
    state.paused = true;
    W.keys.clear();
    W.showCaption('your lantern gutters out');
    const f = $('fade');
    if (f) f.classList.add('on');
  }

  function wake() {
    const run = state.run;
    state.gutter = null;
    state.paused = false;
    run.fuel = RULES.chargesStart;
    run.gutters = (run.gutters || 0) + 1;
    state.lampGrace = RULES.lampGrace;
    const st = W.hearth();
    if (st) W.placeAt(st);
    else { Object.assign(state.player, W.spawnPoint(state.exp), { z: 0, vz: 0 }); W.snapCamera(); }
    const f = $('fade');
    if (f) f.classList.remove('on');
    W.showCaption(`you wake by the waystone in ${st ? st.spaceId : 's0'} · ${chargeText(run.fuel)} of entropy`);
    savePlayer();
    W.refreshHud();
  }

  // ---------------------------------------------------------------------------
  // How the lamp looks: colour, halo, sparks, light

  /** 0..1: full at RULES.lampFullCharges or more, 0 when empty. */
  function lampLevel() {
    return THREE.MathUtils.clamp(state.run.fuel / RULES.lampFullCharges, 0, 1);
  }

  // Colour by level, from empty to full.
  const STOPS = [[0, new THREE.Color(0x4a4446)], [0.33, new THREE.Color(0xe0402a)],
    [0.66, new THREE.Color(0xff9a3c)], [1, new THREE.Color(0xffd27a)]];
  const lampColor = new THREE.Color();
  function colorAt(level, out) {
    for (let i = 1; i < STOPS.length; i++) {
      if (level <= STOPS[i][0]) {
        const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i];
        return out.copy(ca).lerp(cb, (level - a) / (b - a));
      }
    }
    return out.copy(STOPS[STOPS.length - 1][1]);
  }

  // The halo: a dithered disc (a 4x4 Bayer pattern thinning out toward the
  // rim), additive, in the lamp's colour. Twice and a half the lamp's size
  // at full, shrinking and fading as the fuel goes.
  function ditherDisc() {
    const n = 32, cv = document.createElement('canvas');
    cv.width = cv.height = n;
    const g = cv.getContext('2d');
    const m = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const r = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
      const v = Math.max(0, 1 - r) * 1.25;
      if (v > (m[(x % 4) + (y % 4) * 4] + 0.5) / 16) { g.fillStyle = '#fff'; g.fillRect(x, y, 1, 1); }
    }
    const t = new THREE.CanvasTexture(cv);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    return t;
  }
  const haloMat = new THREE.SpriteMaterial({ map: ditherDisc(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  const halo = new THREE.Sprite(haloMat);
  const HALO_FULL = 0.2 * S; // 2.5x the lamp's diameter
  halo.renderOrder = 5;
  scene.add(halo); // follows the lamp in world space (the figure's rig squashes when crouched)

  // Sparks: short-lived points rising off the lamp, left behind as you
  // walk (a trail). Additive, so a dead one is just black.
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
  const spark = Array.from({ length: SPARKS }, () => ({ life: 0, max: 1, vx: 0, vy: 0, vz: 0 }));
  let sparkClock = 0, sparkNext = 0;
  const lampWorld = new THREE.Vector3();

  function updateLampLook(dt) {
    const t = state.time;
    const g = state.gutter ? Math.max(0, 1 - state.gutter.t / GUTTER_FADE) : 1;
    const level = lampLevel() * g;
    // Flicker grows as the level falls below half.
    const shake = Math.max(0, 0.5 - level) * 2;
    const flick = 1 - shake * 0.55 * Math.abs(Math.sin(t * 17.3) * Math.sin(t * 6.1 + 1.3));
    colorAt(level * flick, lampColor);
    lanternMesh.material.color.copy(lampColor);

    lantern.color.setHex(0xffb36b).lerp(lampColor, 0.5);
    lantern.intensity = LANTERN * (0.3 + 0.7 * level) * flick * g * (0.94 + 0.06 * Math.sin(t * 9.3) * Math.sin(t * 3.1));
    lantern.distance = LANTERN_RANGE * (0.4 + 0.6 * level);

    lanternMesh.getWorldPosition(lampWorld);
    haloMat.color.copy(lampColor);
    halo.position.copy(lampWorld);
    halo.scale.setScalar(HALO_FULL * (0.25 + 0.75 * level));
    const danger = RULES.lampDanger / RULES.lampFullCharges;
    haloMat.opacity = (level > 0.66 ? 0.85 : level > danger ? 0.2 + 0.65 * (level - danger) / (0.66 - danger) : 0.06 + 0.14 * level / danger) * flick;

    // Sparks: fewer, dimmer and shorter-lived as the lamp fails.
    sparkClock += dt;
    const rate = level > 0.01 && !state.paused ? 4 + 22 * level : 0;
    while (rate && sparkClock >= sparkNext) {
      sparkClock -= sparkNext;
      sparkNext = 1 / rate * (0.6 + Math.random() * 0.8);
      const s = spark.find((o) => o.life <= 0);
      if (!s) break;
      const i = spark.indexOf(s);
      s.max = s.life = (0.35 + 0.4 * Math.random()) * (0.6 + 0.4 * level);
      s.vx = (Math.random() - 0.5) * 0.25 * S; s.vz = (Math.random() - 0.5) * 0.25 * S;
      s.vy = (0.25 + Math.random() * 0.35) * S;
      sparkPos[i * 3] = lampWorld.x + (Math.random() - 0.5) * 0.04 * S;
      sparkPos[i * 3 + 1] = lampWorld.y;
      sparkPos[i * 3 + 2] = lampWorld.z + (Math.random() - 0.5) * 0.04 * S;
    }
    if (!rate) sparkClock = 0;
    spark.forEach((s, i) => {
      if (s.life > 0) {
        s.life -= dt;
        sparkPos[i * 3] += s.vx * dt; sparkPos[i * 3 + 1] += s.vy * dt; sparkPos[i * 3 + 2] += s.vz * dt;
      }
      const k = Math.max(0, s.life / s.max) * (0.5 + 0.5 * level);
      sparkCol[i * 3] = lampColor.r * k; sparkCol[i * 3 + 1] = lampColor.g * k; sparkCol[i * 3 + 2] = lampColor.b * k;
    });
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.attributes.color.needsUpdate = true;

    updateLampHud();
  }

  // ---------------------------------------------------------------------------
  // The lamp on the HUD: an icon in the lamp's colour, and a fluid meter cut
  // into one section per charge. The section that's burning shows dimmer.

  const meterEl = $('lamp-meter'), iconEl = $('lamp-icon'), stateEl = $('lamp-state');
  let built = -1, lastSig = '';
  const STATE_TEXT = { burning: 'burning', sheltered: 'by a sconce · not burning', held: 'held', paused: '' };
  function updateLampHud(force) {
    if (!meterEl) return;
    const run = state.run, max = maxCharges();
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
    const mode = state.gutter ? 'out' : lampMode;
    const sig = run.fuel.toFixed(3) + mode;
    if (sig === lastSig) return;
    lastSig = sig;
    Array.from(meterEl.children).forEach((sec, i) => {
      const f = THREE.MathUtils.clamp(run.fuel - i, 0, 1);
      sec.firstChild.style.width = (f * 100).toFixed(1) + '%';
      sec.className = 'sec' + (i >= RULES.chargesMax ? ' buff' : '') + (f >= 1 ? ' full' : f > 0 ? ' part' : '');
    });
    iconEl.style.color = '#' + lampColor.getHexString();
    iconEl.classList.toggle('burning', mode === 'burning');
    iconEl.classList.toggle('danger', run.fuel <= RULES.lampDanger);
    if (stateEl) stateEl.textContent = mode === 'out' ? 'out' : STATE_TEXT[mode] || '';
    meterEl.parentElement.parentElement.title =
      `entropy ${run.fuel.toFixed(2)} of ${max} charges · the lamp burns a charge every ${RULES.lampSeconds * RULES.shardsPerCharge} s in the dark`;
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

  Object.assign(W, { gainFuel, spendFuel, takeFuel, litAt, updateLamp, updateLampLook, updateLampHud,
    lampLevel, popEntropy });
})(window);
