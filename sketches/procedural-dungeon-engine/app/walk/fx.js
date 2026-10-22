// Walk mode: the ghost wobble and glitch post-process, and rendering a frame.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { THREE, canvas, renderer, scene, camera, state } = W;

  const tmpV2 = new THREE.Vector2();

  // Post-processing for the ghost effects: the scene renders into an
  // offscreen target, then a full-screen pass wobbles it and, on contact,
  // tears it into purple static. Skipped entirely while both are at zero.
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
        uWobble: { value: 0 }, uGlitch: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
uniform sampler2D tDiffuse;
uniform float uTime, uWobble, uGlitch;
uniform vec2 uRes;
varying vec2 vUv;
float rand(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 uv = vUv;
  float w = uWobble, g = uGlitch;
  // Wobble: slow, overlapping waves, a bit stronger toward the edges.
  float edge = 0.6 + 0.8 * length(vUv - 0.5);
  uv.x += (sin(uv.y * 11.0 + uTime * 2.1) * 0.011 + sin(uv.y * 29.0 - uTime * 3.7) * 0.004) * w * edge;
  uv.y += (cos(uv.x * 9.0 + uTime * 1.6) * 0.009 + sin(uv.x * 23.0 + uTime * 2.9) * 0.003) * w * edge;
  // Glitch: torn horizontal slices that jump a few times a second.
  float band = floor(vUv.y * 46.0);
  float tick = floor(uTime * 14.0);
  if (rand(vec2(band, tick)) < g * 0.38) uv.x += (rand(vec2(band, tick + 7.0)) - 0.5) * 0.16 * g;
  float split = 0.003 * w + 0.014 * g;
  vec4 col;
  col.r = texture2D(tDiffuse, uv + vec2(split, 0.0)).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv - vec2(split, 0.0)).b;
  col.a = 1.0;
  // Purple static and scanlines.
  float n = rand(floor(vUv * uRes / 2.0) + tick * 3.1);
  col.rgb = mix(col.rgb, vec3(n) * vec3(0.55, 0.3, 0.9), g * 0.5);
  col.rgb += vec3(0.12, 0.02, 0.22) * g;
  col.rgb *= 1.0 - g * 0.3 * step(0.5, fract(vUv.y * uRes.y / 3.0));
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

  function renderFrame(dt) {
    const fx = state.fx;
    if (fx.wobble < 0.003 && fx.glitch < 0.003 && fx.flash < 0.003) {
      if (dt) { fxPerf.base += (dt - fxPerf.base) * 0.05; fxPerf.avg = fxPerf.base; }
      renderer.render(scene, camera);
      return;
    }
    if (dt) adaptEffect(dt);
    const cssScale = Math.min(1, renderer.getPixelRatio()) * fxPerf.scale;
    const w = Math.max(1, Math.round(canvas.clientWidth * cssScale)), h = Math.max(1, Math.round(canvas.clientHeight * cssScale));
    if (post.rt.width !== w || post.rt.height !== h) post.rt.setSize(w, h);
    renderer.getDrawingBufferSize(tmpV2);
    const u = post.mat.uniforms;
    u.uTime.value = state.time; u.uWobble.value = fx.wobble; u.uGlitch.value = Math.max(fx.glitch * GLITCH_HOLD, fx.flash);
    u.uRes.value.copy(tmpV2);
    renderer.setRenderTarget(post.rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(post.sc, post.cam);
  }

  Object.assign(W, { tmpV2, post, fxPerf, renderFrame });
})(window);
