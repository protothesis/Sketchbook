// Walk mode: the air of a room, from its conditions (DE.CONDITIONS).
//
//   temperature  the ambient light: cool blue-grey in a cold room, amber in
//                a warm one, so your lamp's pool reads against it
//   age, moisture  motes in the air: more the older and drier the room,
//                and they only show where your lamp catches them
//   air          how the motes (and sparks) move: hanging still, carried
//                one way by a draught (wrapping round the room), or drawn
//                in and pushed out on a slow breath
//   potency      sparks: firefly lights blinking on and off, none in an
//                inert room, a swarm in a potent one
//   moisture, temperature  fog: low, soft, lying near the floor, thickest
//                where it's wet and cold (a warm wet room has a thinner
//                mist); it drifts with the air and parts around you
//
// Moisture also wets the floor (materials.js) and brings puddles and
// drips (water.js). All of it is drawn in shaders
// off one shared clock, one points object per kind per room.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, THREE, S, WALL_H, scene, state } = W;

  const ATMOS = {
    // Ambient light by temperature band: [colour, intensity]. Eased toward
    // the room you're in.
    ambient: { cold: [0x6c9cff, 0.42], mild: [0x8a90b8, 0.06], warm: [0xff9248, 0.36] },
    ambientEase: 1.2,        // per second
    // Motes per cell, by age, times moisture's share.
    motes: { fresh: 0.5, old: 1.3, ancient: 2.4 },
    motesMoisture: { dry: 1, damp: 0.6, wet: 0.3 },
    moteColor: 0xe6d6b8,
    moteSize: 130,           // point size at unit depth (about 10 px at the camera's distance)
    moteLit: 1.15,           // motes show within this many of your lamp's pool radii
    // Sparks per cell, by potency.
    sparks: { low: 0, mid: 0.25, high: 0.9 },
    sparkColor: 0xd6f27a,
    sparkSize: 260,
    // How they move, by air.
    drift: 0.35,             // cells/s: a draught's speed
    breath: 7,               // s: one breath in and out
    breathDepth: 0.14,       // share of the distance to the room's middle
    // Fog: puffs per cell = fogPerCell x moisture's share x temperature's.
    fogPerCell: 2.2,
    fogMoisture: { dry: 0, damp: 0.45, wet: 1 },
    fogTemperature: { cold: 1.25, mild: 0.8, warm: 0.55 },
    fogMin: 0.15,            // below this many per cell, no fog at all
    fogHeight: 0.35,         // cells: how high the puffs sit (from the floor)
    fogSize: 1800,           // a puff's size at unit depth
    fogAlpha: 0.3,           // a puff's opacity at its middle, lit
    fogDark: 0.35,           // ...and away from your lamp, as a share of that
    fogPush: 0.75,           // cells: how far it parts around you
    fogPushRadius: 1.1,      // cells: how close you have to be
    fogCold: 0x9fb6d0,       // its colour in a cold room
    fogWarm: 0xc9bca6,       // in a warm one (a mist)
    roomInfo: false,         // dev: show the room-info window (roominfo.js)
  };

  // The scene's one ambient light (core.js).
  const ambient = scene.children.find((o) => o.isAmbientLight);
  const ambientTarget = { color: new THREE.Color(), intensity: 0.06 };

  // Shared uniforms: the clock and the lamp.
  const shared = {
    uTime: { value: 0 },
    uPlayer: { value: new THREE.Vector3(0, 0, 0) },
    uLamp: { value: new THREE.Vector3(0, -100, 0) },
    uReach: { value: 0.01 },
  };

  const VERT = `
uniform float uTime;
uniform vec3 uLamp;
uniform float uReach;
uniform float uMode;      // 0 still, 1 draughty, 2 breathing
uniform vec2 uWind;       // world units per second
uniform vec3 uMin;
uniform vec3 uSize;
uniform vec3 uCenter;
uniform float uBreath;    // seconds per breath
uniform float uDepth;
uniform float uPx;
uniform float uSpark;     // 1: lit by itself, blinking; 0: a mote, lit by the lamp
attribute float phase;
varying float vA;
void main() {
  vec3 p = position;
  float t = uTime;
  float wob = mix(${(0.05 * S).toFixed(3)}, ${(0.16 * S).toFixed(3)}, uSpark);
  p += vec3(sin(t * 0.37 + phase * 6.28), 0.6 * sin(t * 0.29 + phase * 12.0), cos(t * 0.33 + phase * 9.0)) * wob;
  if (uMode > 0.5 && uMode < 1.5) {
    p.xz = uMin.xz + mod(p.xz - uMin.xz + uWind * t, uSize.xz);
  } else if (uMode > 1.5) {
    float b = sin(t * 6.2831 / uBreath);
    p.xz += (p.xz - uCenter.xz) * uDepth * b;
    p.y += ${(0.08 * S).toFixed(3)} * b;
  }
  if (uSpark > 0.5) {
    vA = pow(max(0.0, sin(t * (0.6 + phase * 0.9) + phase * 40.0)), 4.0);
  } else {
    float d = distance(p, uLamp) / max(uReach, 0.001);
    vA = (1.0 - smoothstep(0.25, 1.0, d)) * (0.6 + 0.4 * sin(t * 1.3 + phase * 20.0));
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uPx / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
  const FRAG = `
uniform vec3 uColor;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = (smoothstep(0.5, 0.0, d) * 0.5 + smoothstep(0.18, 0.0, d)) * vA; // a soft halo round a bright core
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor * a, a);
}`;

  // Fog: big soft puffs near the floor, moving with the air like the motes,
  // pushed aside around you, brighter in your lamp's pool.
  const FOG_VERT = `
uniform float uTime;
uniform vec3 uLamp;
uniform float uReach;
uniform vec3 uPlayer;
uniform float uPush;
uniform float uPushR;
uniform float uMode;
uniform vec2 uWind;
uniform vec3 uMin;
uniform vec3 uSize;
uniform vec3 uCenter;
uniform float uBreath;
uniform float uDepth;
uniform float uPx;
uniform float uAlpha;
uniform float uDark;
attribute float phase;
varying float vA;
void main() {
  vec3 p = position;
  float t = uTime;
  p += vec3(sin(t * 0.11 + phase * 6.28), 0.0, cos(t * 0.09 + phase * 9.0)) * ${(0.25 * S).toFixed(3)};
  if (uMode > 0.5 && uMode < 1.5) {
    p.xz = uMin.xz + mod(p.xz - uMin.xz + uWind * 0.6 * t, uSize.xz);
  } else if (uMode > 1.5) {
    float b = sin(t * 6.2831 / uBreath);
    p.xz += (p.xz - uCenter.xz) * uDepth * b;
  }
  vec2 d = p.xz - uPlayer.xz;
  float l = length(d);
  float k = 1.0 - smoothstep(0.0, uPushR, l);
  p.xz += (l > 0.001 ? d / l : vec2(0.0)) * k * uPush;
  float lit = 1.0 - smoothstep(0.2, 1.0, distance(p, uLamp) / max(uReach, 0.001));
  vA = uAlpha * mix(uDark, 1.0, lit) * (1.0 - 0.5 * k);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uPx / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
  const FOG_FRAG = `
uniform vec3 uColor;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = pow(smoothstep(0.5, 0.0, d), 1.6) * vA;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}`;

  const bandOf = (space, axis) => DE.bandOf(space.meta && space.meta.cond, axis);

  /** Fog puffs per cell for a room (0 for none). */
  function fogPerCell(space) {
    const n = ATMOS.fogPerCell * ATMOS.fogMoisture[bandOf(space, 'moisture')] * ATMOS.fogTemperature[bandOf(space, 'temperature')];
    return n >= ATMOS.fogMin ? n : 0;
  }

  /** One points object scattered over a room's cells: `perCell` of them, at heights in [lo, hi] cells. */
  function points(space, perCell, lo, hi, salt, uniforms, shaders) {
    const r = DE.createRng(DE.hash('atmos', salt, space.seed));
    const n = Math.round(space.cells.length * perCell);
    if (!n) return null;
    const pos = new Float32Array(n * 3), phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const c = DE.parseKey(space.cells[r.int(0, space.cells.length - 1)]);
      pos[i * 3] = (c.x + r.next()) * S;
      pos[i * 3 + 1] = r.range(lo, hi) * S;
      pos[i * 3 + 2] = (c.y + r.next()) * S;
      phase[i] = r.next();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, shared, uniforms),
      vertexShader: shaders ? shaders.vert : VERT, fragmentShader: shaders ? shaders.frag : FRAG,
      transparent: true, depthWrite: false, blending: shaders ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false; // they wander out of their bounding box
    return pts;
  }

  /** A room's motes and sparks, added to its group; their geometry and materials go in rec.atmos (disposed with the room). */
  function addAtmos(space, rec, group) {
    if (!space.meta || !space.meta.cond) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const k of space.cells) { const c = DE.parseKey(k); x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x + 1); y1 = Math.max(y1, c.y + 1); }
    const air = bandOf(space, 'air');
    const wr = DE.createRng(DE.hash('wind', space.regionId || space.seed)); // one draught per region
    const a = wr.next() * Math.PI * 2;
    const motion = {
      uMode: { value: air === 'draughty' ? 1 : air === 'breathing' ? 2 : 0 },
      uWind: { value: new THREE.Vector2(Math.cos(a), Math.sin(a)).multiplyScalar(ATMOS.drift * S) },
      uMin: { value: new THREE.Vector3(x0 * S, 0, y0 * S) },
      uSize: { value: new THREE.Vector3((x1 - x0) * S, 1, (y1 - y0) * S) },
      uCenter: { value: new THREE.Vector3((x0 + x1) / 2 * S, 0, (y0 + y1) / 2 * S) },
      uBreath: { value: ATMOS.breath * (0.85 + 0.3 * wr.next()) },
      uDepth: { value: ATMOS.breathDepth },
    };
    rec.atmos = rec.atmos || [];
    const motes = points(space, ATMOS.motes[bandOf(space, 'age')] * ATMOS.motesMoisture[bandOf(space, 'moisture')], 0.08, WALL_H * 0.9, 'motes',
      Object.assign({ uColor: { value: new THREE.Color(ATMOS.moteColor) }, uPx: { value: ATMOS.moteSize }, uSpark: { value: 0 } }, motion));
    const sparks = points(space, ATMOS.sparks[bandOf(space, 'potency')], 0.15, WALL_H * 0.8, 'sparks',
      Object.assign({ uColor: { value: new THREE.Color(ATMOS.sparkColor) }, uPx: { value: ATMOS.sparkSize }, uSpark: { value: 1 } }, motion));
    const cold = bandOf(space, 'temperature') !== 'warm';
    const fog = points(space, fogPerCell(space), 0.02, ATMOS.fogHeight, 'fog',
      Object.assign({ uColor: { value: new THREE.Color(cold ? ATMOS.fogCold : ATMOS.fogWarm) }, uPx: { value: ATMOS.fogSize },
        uAlpha: { value: ATMOS.fogAlpha }, uDark: { value: ATMOS.fogDark },
        uPush: { value: ATMOS.fogPush * S }, uPushR: { value: ATMOS.fogPushRadius * S } }, motion),
      { vert: FOG_VERT, frag: FOG_FRAG });
    rec.atmosInfo = { motes: motes ? motes.geometry.attributes.position.count : 0, sparks: sparks ? sparks.geometry.attributes.position.count : 0,
      fog: fog ? fog.geometry.attributes.position.count : 0, air: ['still', 'a draught', 'breathing'][motion.uMode.value],
      breath: motion.uBreath.value, wind: a };
    if (fog) fog.renderOrder = 2;
    for (const p of [motes, sparks, fog]) {
      if (!p) continue;
      group.add(p);
      rec.atmos.push(p.geometry, p.material);
    }
  }

  function disposeAtmos(rec) {
    if (rec && rec.atmos) for (const o of rec.atmos) o.dispose();
  }

  /** Each frame: the clock, the lamp, and the ambient light easing toward the room you're in. */
  function updateAtmos(dt) {
    shared.uTime.value = state.time;
    shared.uPlayer.value.set(state.player.x * S, 0, state.player.y * S);
    const L = W.lampLight();
    shared.uLamp.value.set(L.from.x * S, L.from.h * S, L.from.y * S);
    shared.uReach.value = L.r * S * ATMOS.moteLit;
    const sp = state.exp && state.exp.spaces[state.player.spaceId];
    const [col, inten] = ATMOS.ambient[sp ? bandOf(sp, 'temperature') : 'mild'];
    ambientTarget.color.setHex(col);
    ambientTarget.intensity = inten;
    if (ambient) {
      const k = Math.min(1, dt * ATMOS.ambientEase);
      ambient.color.lerp(ambientTarget.color, k);
      ambient.intensity += (ambientTarget.intensity - ambient.intensity) * k;
    }
  }

  Object.assign(W, { ATMOS, addAtmos, disposeAtmos, updateAtmos, fogPerCell });
})(window);
