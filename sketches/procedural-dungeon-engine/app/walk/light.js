// Walk mode: light pools, one floor layer for the eye and the game.
//
// The lights themselves (your lamp, sconces, waystones, sigils) are plain
// three.js point lights and look as they always did: walls are lit as
// usual. Some lights also own a *pool*: a steady circle on the floor (your
// lamp's from its fuel, a lit sconce's fixed). On faces turned up (the
// floor, block tops) the pooled lights only show inside the pools, in
// bands: the light as it is in the core, then POOL.bands steps down to
// POOL.floor at the edge, then dark.
//
// The pools share one ground layer: every floor point takes the strongest
// pool covering it, so where pools overlap they merge into one shape, with
// only those few values and never anything in between. Lights without a
// pool (waystones, sigils, your cool fill) light the floor as usual.
//
// A pool is also what creatures read as light: a spot is lit by a pool if
// it's inside the circle and nothing blocks the way from the light to it
// (lightReaches, creatures.js, standing in for the shadows). What you see
// on the floor is what they obey.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { THREE, S, scene, state } = W;

  const POOL = {
    bands: 3,       // steps between the core and the edge (0: just the hard edge)
    bandWidth: 0.32, // cells each
    floor: 0.2,     // the outermost band's brightness, of the light's (the inner ones step up to full)
    soft: 0.03,     // cells: anti-aliasing across each step (0 is razor sharp)
  };
  const POOLS = 4;  // pools drawn at once: your lamp and the sconces that have real lights

  // ---------------------------------------------------------------------------
  // The shader. Every material shares the one uniform object (three.js
  // copies a uniform's value by reference when it isn't a vector, colour,
  // matrix or texture), so setting it once a frame reaches them all.
  // p0..p3: pools (world x, z, radius; w 1 if in use); band: bands, width,
  // floor, soft; pooled.x: which point lights are pooled, as bits, in the
  // order three.js gives them (shadow-casting first, then scene order).

  const lightPools = { band: new THREE.Vector4(), pooled: new THREE.Vector4() };
  for (let i = 0; i < POOLS; i++) lightPools['p' + i] = new THREE.Vector4();
  for (const k of ['lambert', 'phong', 'standard', 'physical', 'toon']) {
    if (THREE.ShaderLib[k]) THREE.ShaderLib[k].uniforms.lightPools = { value: lightPools };
  }
  THREE.ShaderChunk.lights_pars_begin += `
struct LightPools { vec4 p0; vec4 p1; vec4 p2; vec4 p3; vec4 band; vec4 pooled; };
uniform LightPools lightPools;
// One pool's value at a point (view space; distance across the floor):
// 1 in its core, stepping down in bands to band.z at its edge, 0 past it.
float poolValue(vec4 pool, vec3 viewPos, vec3 up) {
  if (pool.w < 0.5 || pool.z <= 0.0) return 0.0;
  vec3 dv = viewPos - (viewMatrix * vec4(pool.x, 0.0, pool.y, 1.0)).xyz;
  float R = pool.z, d = length(dv - dot(dv, up) * up);
  float m = 1.0 - smoothstep(R - lightPools.band.w, R, d);
  float n = lightPools.band.x;
  if (n > 0.5) {
    float i = ceil((R - d) / lightPools.band.y); // 1 in the outermost band
    if (i <= n) m *= mix(lightPools.band.z, 1.0, (max(i, 1.0) - 1.0) / n);
  }
  return m;
}
// A pooled light's share here: on faces turned up, the strongest pool covering the point; elsewhere, all of it.
vec3 poolLight(vec3 color, vec3 viewPos, vec3 normal, float index) {
  if (mod(floor(lightPools.pooled.x / exp2(index)), 2.0) < 0.5) return color;
  vec3 up = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  float flatness = smoothstep(0.55, 0.85, dot(normalize(normal), up));
  if (flatness <= 0.0) return color;
  float m = max(max(poolValue(lightPools.p0, viewPos, up), poolValue(lightPools.p1, viewPos, up)),
                max(poolValue(lightPools.p2, viewPos, up), poolValue(lightPools.p3, viewPos, up)));
  return color * mix(1.0, m, flatness);
}
`;
  THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin.replace(
    'getPointLightInfo( pointLight, geometryPosition, directLight );',
    `getPointLightInfo( pointLight, geometryPosition, directLight );
		directLight.color = poolLight( directLight.color, geometryPosition, geometryNormal, float( UNROLLED_LOOP_INDEX ) );`);

  // ---------------------------------------------------------------------------
  // Pools for the game. A pool: { x, y, r (cells: centre and radius on the
  // floor), from: { x, y, h } (the light: what blocks it is measured from
  // there) }. Lamp: lamp.js lampLight(); sconce: restore.js sconceLight().

  /** How far a pool's edge lies, in cells. */
  const edge = (pool) => (pool ? pool.r : 0);

  /** Is (x, y) lit by this pool: inside its circle, nothing in the way (`h`: the target's height, cells)? */
  function litBy(pool, x, y, h = 0.1) {
    if (!pool || pool.r <= 0 || Math.hypot(x - pool.x, y - pool.y) >= pool.r) return false;
    return W.lightReaches(pool.from, { x, y, h }, pool.r + 2);
  }

  // ---------------------------------------------------------------------------
  // Once a frame (lamp.js): the pools to draw, and which lights they shape.

  let lampPool = null;
  const pooledLights = new Set([W.lantern]);
  /** Point lights whose floor light is shaped by the pools (the lantern, the sconces' real lights). */
  function addPooledLight(l) { pooledLights.add(l); }

  function setLampPool(pool) {
    lampPool = pool;
    const pools = [pool].concat((W.sconcePools ? W.sconcePools() : []).slice(0, POOLS - 1));
    for (let i = 0; i < POOLS; i++) {
      const o = pools[i];
      if (o && o.r > 0) lightPools['p' + i].set(o.x * S, o.y * S, o.r * S, 1);
      else lightPools['p' + i].set(0, 0, 0, 0);
    }
    lightPools.band.set(Math.max(0, Math.round(POOL.bands)), Math.max(0.01, POOL.bandWidth * S), POOL.floor, Math.max(0, POOL.soft * S));
    const pts = [];
    scene.traverseVisible((o) => { if (o.isPointLight) pts.push(o); });
    pts.sort((a, b) => (b.castShadow ? 1 : 0) - (a.castShadow ? 1 : 0)); // stable, like three.js
    let bits = 0;
    pts.forEach((l, i) => { if (pooledLights.has(l) && i < 24) bits += Math.pow(2, i); });
    lightPools.pooled.x = bits;
  }

  Object.assign(W, { POOL, light: { edge, litBy, setLampPool, addPooledLight, lampPool: () => lampPool } });
})(window);
