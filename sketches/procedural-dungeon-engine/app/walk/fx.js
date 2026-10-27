// Walk mode: the psych post-process (wobble, glitch), and rendering a frame.
//
// What a creature does to your mind shows on screen through an effect
// profile (FX_PROFILES): how much the picture tears, splits, fills with
// static and scanlines, and in what colour. Each profile has a level, 0
// and up (state.fx.levels), set by whatever drives it: ghosts.js sets the
// ghost's (a flash on contact, a steadier glitch while it holds you),
// creepers.js the creeper's (fading in slowly with nearness, and stacking).
// Levels add up into one pass, so different creatures mix.
//
// Your psychic stamina has its own say (the psyche, lamp.js): each kind of
// drain *bursts* when it starts on you (fxBurst: a level that decays fast,
// on top of the steady one, so bursts from several sources compound), and
// while anything drains you a shared distress level ('psyche') climbs as
// the meter empties. The dark has a profile of its own whose static and
// tearing keep to the screen's edges, where shadows reach in (`shadow`).
// Passing out runs its own sequence on top of all of it (state.fx.faint).
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { THREE, canvas, renderer, scene, camera, state } = W;

  const tmpV2 = new THREE.Vector2();

  // Each profile, per unit of level: tear (share of slices torn, and how
  // far), split (colour fringe, in screen widths), noise (how much static
  // replaces the picture), scan (scanline darkening), tint (the static's
  // colour) and glow (colour added over everything).
  // Optional: edge (static and tearing kept to the screen's edges), and
  // for a burst, decay (its level lost per second) and cap (how far bursts
  // stack). The grasping shadows aren't a profile: they follow the meter
  // itself (state.fx.shadow, lamp.js; shaped by PSYCHE.shadow).
  const FX_PROFILES = {
    ghost: { tear: 1, split: 0.014, noise: 0.5, scan: 0.3, tint: [0.55, 0.3, 0.9], glow: [0.12, 0.02, 0.22] },
    // A creeper's flash: entering its pull, or bumping into it. Well under a ghost's.
    creeperFlash: { tear: 0.45, split: 0.008, noise: 0.18, scan: 0.18, tint: [0.85, 0.15, 0.1], glow: [0.1, 0.01, 0],
      decay: 2.6, cap: 1.6 },
    // The jolt when your psych meter starts going down at all, whatever starts it.
    jolt: { tear: 0.35, split: 0.007, noise: 0.12, scan: 0.12, tint: [0.7, 0.5, 0.95], glow: [0.07, 0.05, 0.1],
      decay: 2, cap: 1.5 },
    // The dark: static and tears at the edges, shadows reaching in, a cold cast.
    // (The pass works in linear colour: tiny glow and noise values still lift a dark scene a lot.)
    dark: { tear: 0.04, split: 0.002, noise: 0.012, scan: 0.08, tint: [0.45, 0.2, 0.7], glow: [0, 0, 0],
      edge: 0.3, rise: 0.9, fall: 0.7 },
    // The lamp going out: noticeable, not a ghost's bang.
    darkFlash: { tear: 0.3, edge: 0.9, split: 0.004, noise: 0.06, scan: 0.12, tint: [0.5, 0.2, 0.8], glow: [0.03, 0, 0.06],
      decay: 1.3, cap: 1 },
    // Distress: everything draining you, worse the emptier the meter.
    psyche: { tear: 0.35, split: 0.008, noise: 0.05, scan: 0.15, tint: [0.6, 0.25, 0.85], glow: [0.003, 0, 0.005],
      edge: 0.18, rise: 0.8, fall: 0.5 },
    // Much subtler: a faint red fringe and grain, barely tearing.
    // (Static brightens a dark scene a lot, so noise and glow stay tiny.)
    creeper: { tear: 0.06, split: 0.003, noise: 0.035, scan: 0.06, tint: [0.75, 0.12, 0.08], glow: [0.012, 0, 0],
      rise: 1, fall: 0.6 }, // per second: eased toward its target by fxToward() (quick enough to show a dash)
  };

  /** Ease a profile's level toward `target` at the profile's rise/fall rates (per second). */
  function fxToward(name, target, dt) {
    const pr = FX_PROFILES[name], lv = state.fx.levels;
    const cur = lv[name] || 0;
    lv[name] = target > cur ? Math.min(target, cur + pr.rise * dt) : Math.max(target, cur - pr.fall * dt);
  }

  // Post-processing for the psych effects: the scene renders into an
  // offscreen target, then a full-screen pass wobbles it and tears it into
  // static, per the profiles' levels. Skipped entirely while all are at zero.
  //
  // Kept cheap on big, high-DPI screens: the target is 8-bit sRGB (no
  // banding, half the bytes of half-float), has no MSAA (the wobble softens
  // edges anyway), and is sized in CSS pixels times `fxScale`, not device
  // pixels (a quarter of the pixels on a 2x display). If frames still run
  // slow while the effect is on, fxScale steps down toward 0.5, and creeps
  // back up when there's headroom. At full screen on a 2x display this took
  // the effect from ~15 ms a frame to a few.
  const post = (() => {
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType, samples: 0, stencilBuffer: true }); // the figure's silhouette uses the stencil
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: rt.texture }, uTime: { value: 0 },
        uWobble: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
        uTear: { value: 0 }, uSplit: { value: 0 }, uNoise: { value: 0 }, uScan: { value: 0 },
        uTint: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
        uEdge: { value: 0 }, uShadow: { value: 0 }, uShadowShape: { value: new THREE.Vector4() },
        uShatter: { value: 0 }, uStatic: { value: 0 }, uStreakT: { value: 0 }, uBlack: { value: 0 },
      },
      vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
uniform sampler2D tDiffuse;
uniform float uTime, uWobble, uTear, uSplit, uNoise, uScan;
uniform float uEdge, uShadow, uShatter, uStatic, uStreakT, uBlack;
uniform vec4 uShadowShape; // x: its edge with none, y: at most (both 0 centre .. 1 corner), z: finger length, w: most opacity
uniform vec3 uTint, uGlow;
uniform vec2 uRes;
varying vec2 vUv;
float rand(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rand(i), rand(i + vec2(1.0, 0.0)), f.x), mix(rand(i + vec2(0.0, 1.0)), rand(i + vec2(1.0, 1.0)), f.x), f.y);
}
// The faint's colours: the dark's purple, the creeper's red, your lamp's yellow.
vec3 faintCol(float r) { return r < 0.34 ? vec3(0.55, 0.18, 0.9) : r < 0.67 ? vec3(0.95, 0.16, 0.1) : vec3(1.0, 0.82, 0.45); }
void main() {
  vec2 uv = vUv;
  float w = uWobble;
  // How far out toward the screen's edge (0 centre, 1 corner), for the dark.
  vec2 q = (vUv - 0.5) * vec2(uRes.x / max(uRes.y, 1.0), 1.0);
  float r = length(q) / length(vec2(0.5 * uRes.x / max(uRes.y, 1.0), 0.5));
  float edgeW = smoothstep(0.3, 1.0, r);
  float tick = floor(uTime * 14.0);
  // Passing out, first: the picture stutters in big chunks (shatter), then rows jump (static).
  float stut = floor(uTime * 18.0);
  vec2 cells = vec2(4.0 + floor(rand(vec2(stut, 1.0)) * 6.0), 3.0 + floor(rand(vec2(stut, 2.0)) * 5.0));
  vec2 cell = floor(vUv * cells);
  float cr = rand(cell + stut * 1.7);
  if (uShatter > 0.0 && cr < 0.55 * uShatter) uv += (vec2(rand(cell + stut), rand(cell - stut)) - 0.5) * 0.45 * uShatter;
  float row = floor(vUv.y * 60.0);
  if (uStatic > 0.0 && rand(vec2(row, stut)) < 0.3 * uStatic) uv.x += (rand(vec2(row, stut + 3.0)) - 0.5) * 0.3 * uStatic;
  // Wobble: slow, overlapping waves, a bit stronger toward the edges.
  float edge = 0.6 + 0.8 * length(vUv - 0.5);
  uv.x += (sin(uv.y * 11.0 + uTime * 2.1) * 0.011 + sin(uv.y * 29.0 - uTime * 3.7) * 0.004) * w * edge;
  uv.y += (cos(uv.x * 9.0 + uTime * 1.6) * 0.009 + sin(uv.x * 23.0 + uTime * 2.9) * 0.003) * w * edge;
  // Glitch: torn horizontal slices that jump a few times a second.
  float band = floor(vUv.y * 46.0);
  float tearHere = min(1.0, uTear + uEdge * edgeW); // the dark tears the edges
  if (rand(vec2(band, tick)) < tearHere * 0.38) uv.x += (rand(vec2(band, tick + 7.0)) - 0.5) * 0.16 * tearHere;
  float split = 0.003 * w + uSplit;
  vec4 col;
  col.r = texture2D(tDiffuse, uv + vec2(split, 0.0)).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv - vec2(split, 0.0)).b;
  col.a = 1.0;
  // Tinted static and scanlines.
  float n = rand(floor(vUv * uRes / 2.0) + tick * 3.1);
  col.rgb = mix(col.rgb, vec3(n) * uTint, min(1.0, uNoise + uEdge * edgeW * edgeW * 0.5)); // edge static: mostly the outer band
  col.rgb += uGlow;
  col.rgb *= 1.0 - min(0.6, uScan) * step(0.5, fract(vUv.y * uRes.y / 3.0));
  // Grasping shadows: a ragged black-violet rim, reaching in as uShadow grows, its fingers drifting and curling.
  if (uShadow > 0.001) {
    vec2 dir = q / max(length(q), 1e-4);
    float reach = vnoise(dir * 2.6 + vec2(uTime * 0.23, -uTime * 0.17)) * 0.7
      + vnoise(dir * 6.5 + vec2(-uTime * 0.41, uTime * 0.33)) * 0.3;
    float inner = mix(uShadowShape.x, uShadowShape.y, uShadow) - reach * uShadowShape.z * min(1.0, uShadow * 2.0);
    float dark = smoothstep(inner, inner + 0.22, r);
    vec3 shade = mix(vec3(0.010, 0.002, 0.016), vec3(0.001, 0.0, 0.003), smoothstep(inner + 0.1, 1.0, r)); // linear: a near-black violet
    col.rgb = mix(col.rgb, shade, dark * uShadowShape.w * (0.45 + 0.55 * uShadow));
  }
  // The faint: static, its colour streaks fading like an old TV's; over it, chunks of its colours (shatter).
  if (uStatic > 0.0) {
    float sr = rand(vec2(floor(vUv.y * 120.0), floor(uTime * 9.0)));
    float fadeT = exp(-uStreakT * 0.9);
    vec3 streak = mix(vec3(0.6), faintCol(rand(vec2(floor(vUv.y * 120.0), 5.0))), fadeT);
    col.rgb = mix(col.rgb, vec3(n) * mix(vec3(0.55), uTint + 0.2, 0.5), min(1.0, uStatic * 0.6));
    if (sr > 0.86) col.rgb += streak * uStatic * (0.25 + 0.6 * fadeT) * (0.6 + 0.4 * sin(vUv.x * 9.0 + uTime * 30.0));
  }
  if (uShatter > 0.0) {
    if (cr > 1.0 - 0.3 * uShatter) col.rgb = faintCol(rand(cell + stut * 2.3)) * (0.7 + 0.5 * n);
    else if (cr > 1.0 - 0.45 * uShatter) col.rgb = vec3(n) * faintCol(rand(cell - stut));
    col.rgb += faintCol(rand(vec2(stut, 9.0))) * 0.25 * uShatter;
  }
  col.rgb *= 1.0 - uBlack;
  gl_FragColor = col;
  #include <colorspace_fragment>
}`,
      depthTest: false, depthWrite: false,
    });
    const sc = new THREE.Scene();
    sc.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    return { rt, mat, sc, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
  })();

  // `base` is the frame time without the effect, so only slowness the
  // effect itself adds (not a slow machine or a big map) lowers its resolution.
  const GLITCH_HOLD = 0.25; // sustained contact glitch, as a share of the collision flash
  const fxPerf = { scale: 1, avg: 1 / 60, base: 1 / 60, clock: 0 };
  /** Called each frame with dt while the effect runs: adapt the target's resolution. */
  function adaptEffect(dt) {
    fxPerf.avg += (dt - fxPerf.avg) * 0.1;
    fxPerf.clock += dt;
    if (fxPerf.clock < 0.5) return;
    fxPerf.clock = 0;
    const slow = fxPerf.avg > Math.max(1 / 40, fxPerf.base * 1.35);
    if (slow) fxPerf.scale = Math.max(0.5, fxPerf.scale * 0.85);
    else if (fxPerf.avg < fxPerf.base * 1.08 + 0.001) fxPerf.scale = Math.min(1, fxPerf.scale * 1.05);
  }

  /** Add the profiles up into the pass's uniforms; false if there's nothing to show. */
  /** A burst of profile `name`: `k` more of it, decaying at its own rate; bursts stack up to its cap. */
  function fxBurst(name, k = 1) {
    const b = state.fx.bursts || (state.fx.bursts = {}), pr = FX_PROFILES[name];
    b[name] = Math.min((pr && pr.cap) || 1, (b[name] || 0) + k);
  }
  function decayBursts(dt) {
    const b = state.fx.bursts;
    if (!b || !dt) return;
    for (const name in b) b[name] = Math.max(0, b[name] - dt * ((FX_PROFILES[name] || {}).decay || 2));
  }

  function mixProfiles(u) {
    const fx = state.fx;
    fx.levels.ghost = Math.max(fx.glitch * GLITCH_HOLD, fx.flash);
    let tear = 0, split = 0, noise = 0, scan = 0, tw = 0, edge = 0;
    u.uTint.value.setRGB(0, 0, 0); u.uGlow.value.setRGB(0, 0, 0);
    const bursts = fx.bursts || {};
    const names = new Set(Object.keys(fx.levels).concat(Object.keys(bursts)));
    for (const name of names) {
      const k = (fx.levels[name] || 0) + (bursts[name] || 0), pr = FX_PROFILES[name];
      if (!pr || k < 0.003) continue;
      tear += pr.tear * k; split += pr.split * k; noise += pr.noise * k; scan += pr.scan * k;
      edge += (pr.edge || 0) * k;
      // The static's colour: each profile's tint, weighted by how much static it adds.
      u.uTint.value.r += pr.tint[0] * pr.noise * k; u.uTint.value.g += pr.tint[1] * pr.noise * k; u.uTint.value.b += pr.tint[2] * pr.noise * k;
      tw += pr.noise * k;
      u.uGlow.value.r += pr.glow[0] * k; u.uGlow.value.g += pr.glow[1] * k; u.uGlow.value.b += pr.glow[2] * k;
    }
    if (tw > 0) u.uTint.value.multiplyScalar(1 / tw);
    else u.uTint.value.setRGB(0.6, 0.3, 0.85);
    u.uTear.value = Math.min(1, tear); u.uSplit.value = split; u.uNoise.value = noise; u.uScan.value = scan;
    const shadow = fx.shadow || 0, sh = (W.PSYCHE && W.PSYCHE.shadow) || {};
    u.uEdge.value = Math.min(1, edge); u.uShadow.value = Math.min(1, shadow);
    u.uShadowShape.value.set(sh.none ?? 1.25, sh.most ?? 0.62, sh.fingers ?? 0.2, sh.opacity ?? 0.75);
    const f = fx.faint || {};
    u.uShatter.value = f.shatter || 0; u.uStatic.value = f.static || 0; u.uStreakT.value = f.streakT || 0; u.uBlack.value = f.black || 0;
    return fx.wobble >= 0.003 || tear + split * 50 + noise + scan + edge + shadow >= 0.003 ||
      u.uShatter.value + u.uStatic.value + u.uBlack.value > 0.001;
  }

  function renderFrame(dt) {
    const fx = state.fx;
    const u = post.mat.uniforms;
    decayBursts(dt);
    if (!mixProfiles(u)) {
      if (dt) { fxPerf.base += (dt - fxPerf.base) * 0.05; fxPerf.avg = fxPerf.base; }
      renderer.render(scene, camera);
      return;
    }
    if (dt) adaptEffect(dt);
    const cssScale = Math.min(1, renderer.getPixelRatio()) * fxPerf.scale;
    const w = Math.max(1, Math.round(canvas.clientWidth * cssScale)), h = Math.max(1, Math.round(canvas.clientHeight * cssScale));
    if (post.rt.width !== w || post.rt.height !== h) post.rt.setSize(w, h);
    renderer.getDrawingBufferSize(tmpV2);
    u.uTime.value = state.time; u.uWobble.value = fx.wobble;
    u.uRes.value.copy(tmpV2);
    renderer.setRenderTarget(post.rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(post.sc, post.cam);
  }

  Object.assign(W, { tmpV2, post, fxPerf, renderFrame, FX_PROFILES, fxToward, fxBurst });
})(window);
