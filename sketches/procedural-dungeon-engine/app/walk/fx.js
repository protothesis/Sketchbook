// Walk mode: the psych post-process (wobble, glitch), and rendering a frame.
//
// What a creature does to your mind shows on screen through an effect
// profile (FX_PROFILES): how much the picture tears, splits, fills with
// static and scanlines, and in what colour. Each profile has a level, 0
// and up (state.fx.levels), set by whatever drives it: ghosts.js sets the
// ghost's (a flash on contact, a steadier glitch while it holds you),
// creepers.js the creeper's (fading in slowly with nearness, and stacking).
// Levels add up into one pass, so different creatures mix.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { THREE, canvas, renderer, scene, camera, state } = W;

  const tmpV2 = new THREE.Vector2();

  // Each profile, per unit of level: tear (share of slices torn, and how
  // far), split (colour fringe, in screen widths), noise (how much static
  // replaces the picture), scan (scanline darkening), tint (the static's
  // colour) and glow (colour added over everything).
  const FX_PROFILES = {
    ghost: { tear: 1, split: 0.014, noise: 0.5, scan: 0.3, tint: [0.55, 0.3, 0.9], glow: [0.12, 0.02, 0.22] },
    // Much subtler: a faint red fringe and grain, barely tearing.
    // (Static brightens a dark scene a lot, so noise and glow stay tiny.)
    creeper: { tear: 0.06, split: 0.003, noise: 0.035, scan: 0.06, tint: [0.75, 0.12, 0.08], glow: [0.012, 0, 0],
      rise: 0.5, fall: 0.6 }, // per second: eased toward its target by fxToward()
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
      },
      vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
uniform sampler2D tDiffuse;
uniform float uTime, uWobble, uTear, uSplit, uNoise, uScan;
uniform vec3 uTint, uGlow;
uniform vec2 uRes;
varying vec2 vUv;
float rand(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 uv = vUv;
  float w = uWobble;
  // Wobble: slow, overlapping waves, a bit stronger toward the edges.
  float edge = 0.6 + 0.8 * length(vUv - 0.5);
  uv.x += (sin(uv.y * 11.0 + uTime * 2.1) * 0.011 + sin(uv.y * 29.0 - uTime * 3.7) * 0.004) * w * edge;
  uv.y += (cos(uv.x * 9.0 + uTime * 1.6) * 0.009 + sin(uv.x * 23.0 + uTime * 2.9) * 0.003) * w * edge;
  // Glitch: torn horizontal slices that jump a few times a second.
  float band = floor(vUv.y * 46.0);
  float tick = floor(uTime * 14.0);
  if (rand(vec2(band, tick)) < uTear * 0.38) uv.x += (rand(vec2(band, tick + 7.0)) - 0.5) * 0.16 * uTear;
  float split = 0.003 * w + uSplit;
  vec4 col;
  col.r = texture2D(tDiffuse, uv + vec2(split, 0.0)).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv - vec2(split, 0.0)).b;
  col.a = 1.0;
  // Tinted static and scanlines.
  float n = rand(floor(vUv * uRes / 2.0) + tick * 3.1);
  col.rgb = mix(col.rgb, vec3(n) * uTint, min(1.0, uNoise));
  col.rgb += uGlow;
  col.rgb *= 1.0 - min(0.6, uScan) * step(0.5, fract(vUv.y * uRes.y / 3.0));
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
  function mixProfiles(u) {
    const fx = state.fx;
    fx.levels.ghost = Math.max(fx.glitch * GLITCH_HOLD, fx.flash);
    let tear = 0, split = 0, noise = 0, scan = 0, tw = 0;
    u.uTint.value.setRGB(0, 0, 0); u.uGlow.value.setRGB(0, 0, 0);
    for (const name in fx.levels) {
      const k = fx.levels[name], pr = FX_PROFILES[name];
      if (!pr || k < 0.003) continue;
      tear += pr.tear * k; split += pr.split * k; noise += pr.noise * k; scan += pr.scan * k;
      // The static's colour: each profile's tint, weighted by how much static it adds.
      u.uTint.value.r += pr.tint[0] * pr.noise * k; u.uTint.value.g += pr.tint[1] * pr.noise * k; u.uTint.value.b += pr.tint[2] * pr.noise * k;
      tw += pr.noise * k;
      u.uGlow.value.r += pr.glow[0] * k; u.uGlow.value.g += pr.glow[1] * k; u.uGlow.value.b += pr.glow[2] * k;
    }
    if (tw > 0) u.uTint.value.multiplyScalar(1 / tw);
    u.uTear.value = Math.min(1, tear); u.uSplit.value = split; u.uNoise.value = noise; u.uScan.value = scan;
    return fx.wobble >= 0.003 || tear + split * 50 + noise + scan >= 0.003;
  }

  function renderFrame(dt) {
    const fx = state.fx;
    const u = post.mat.uniforms;
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

  Object.assign(W, { tmpV2, post, fxPerf, renderFrame, FX_PROFILES, fxToward });
})(window);
