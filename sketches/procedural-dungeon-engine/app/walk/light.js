// Walk mode: light, as one thing for the eye and for the game.
//
// Every light (your lamp, lit sconces, awake waystones, sigils) is a plain
// three.js point light: an intensity, a reach (its cutoff distance) and a
// decay. That light is all there is. The renderer draws it, and the game
// asks the same question in JavaScript: how bright is this light on the
// floor here (the same falloff formula, from the light's real height), and
// does anything block it (lightReaches, creatures.js, standing in for the
// shadows)?
//
// On faces turned up (the floor, block tops) the light's brightness is
// rounded down to a few steps, BANDS: past the dimmest step there's only
// the ambient fill, then BANDS.count steps, each BANDS.step times brighter,
// then the light as it is. Upright faces (walls) are shaded as usual. The
// bands sit wherever the light's own falloff crosses the steps, so they
// move with the light: there are no sizes here. "Lit" means at or over the
// dimmest step, which is exactly the outer edge of the bands you see.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { THREE, S, scene, state } = W;

  const BANDS = {
    lit: 0.07,    // brightness of the dimmest band: the edge of a light (what creatures count as lit)
    step: 2,      // each band this much brighter than the one outside it
    count: 3,     // bands between the edge and the light as it is (0: no bands, just the edge)
  };

  // ---------------------------------------------------------------------------
  // The shader: posterize each point light on faces turned up. three.js
  // sorts shadow-casting lights first and keeps the rest in scene order;
  // `skip` is the index of the one light that isn't banded (your cool fill,
  // which only helps nearby walls read), worked out each frame below.

  const lightBands = { v: new THREE.Vector4() }; // lit, step, count, skip
  for (const k of ['lambert', 'phong', 'standard', 'physical', 'toon']) {
    if (THREE.ShaderLib[k]) THREE.ShaderLib[k].uniforms.lightBands = { value: lightBands };
  }
  THREE.ShaderChunk.lights_pars_begin += `
struct LightBands { vec4 v; };
uniform LightBands lightBands;
// The light's brightness here, rounded down to its band on faces turned up.
vec3 bandLight(vec3 color, vec3 dir, vec3 normal, float index) {
  if (index == lightBands.v.w) return color;
  vec3 up = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  float flatness = smoothstep(0.55, 0.85, dot(normalize(normal), up));
  if (flatness <= 0.0) return color;
  float b = dot(color, vec3(0.2126, 0.7152, 0.0722)) * saturate(dot(normal, dir));
  float lit = lightBands.v.x, step = lightBands.v.y, n = lightBands.v.z;
  float q = b;
  if (b < lit) q = 0.0;
  else if (b < lit * pow(step, n)) q = lit * pow(step, floor(log(b / lit) / log(step)));
  return color * mix(1.0, q / max(b, 1e-6), flatness);
}
`;
  THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin.replace(
    'getPointLightInfo( pointLight, geometryPosition, directLight );',
    `getPointLightInfo( pointLight, geometryPosition, directLight );
		directLight.color = bandLight( directLight.color, directLight.direction, geometryNormal, float( UNROLLED_LOOP_INDEX ) );`);

  /** Once a frame: the bands' numbers, and which light is the fill (the same order three.js gives them). */
  function updateBands() {
    const pts = [];
    scene.traverseVisible((o) => { if (o.isPointLight) pts.push(o); });
    pts.sort((a, b) => (b.castShadow ? 1 : 0) - (a.castShadow ? 1 : 0)); // stable, like three.js
    lightBands.v.set(BANDS.lit, Math.max(1.01, BANDS.step), Math.max(0, Math.round(BANDS.count)), pts.indexOf(W.fill));
  }

  // ---------------------------------------------------------------------------
  // The same light, for the game. A source: { x, y, h (cells), intensity,
  // reach (cells), decay, lum (the colour's brightness, linear) }, steady
  // (no flicker), from lamp.js, restore.js (sconces) and waystones.js.

  const lumOf = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

  /** The light's brightness on open floor at (x, y), as the renderer works it out (no blocking). */
  function floorLight(src, x, y) {
    if (!src || src.intensity <= 0) return 0;
    const hz = Math.max(0.01, src.h) * S;
    const d = Math.hypot((x - src.x) * S, (y - src.y) * S, hz);
    let a = 1 / Math.max(Math.pow(d, src.decay), 0.01);
    const cut = THREE.MathUtils.clamp(1 - Math.pow(d / (src.reach * S), 4), 0, 1);
    a *= cut * cut;
    return src.intensity * src.lum * a * (hz / d);
  }

  /** How far the light's edge lies across open floor, in cells (where it drops under BANDS.lit). */
  function edge(src) {
    if (!src || floorLight(src, src.x, src.y) < BANDS.lit) return 0;
    let lo = 0, hi = src.reach;
    for (let i = 0; i < 24; i++) {
      const m = (lo + hi) / 2;
      if (floorLight(src, src.x + m, src.y) >= BANDS.lit) lo = m; else hi = m;
    }
    return lo;
  }

  /**
   * Is a spot lit by this source: the floor under it at or over BANDS.lit,
   * and nothing in the way from the light to it (`h`: the target's height,
   * cells, default a little off the floor)?
   */
  function litBy(src, x, y, h = 0.1) {
    if (floorLight(src, x, y) < BANDS.lit) return false;
    return W.lightReaches({ x: src.x, y: src.y, h: src.h }, { x, y, h }, src.reach + 1);
  }

  Object.assign(W, { BANDS, light: { updateBands, floorLight, edge, litBy, lumOf } });
})(window);
