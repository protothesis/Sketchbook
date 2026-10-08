// Background indexer: works out, once per image, the things search needs
// that aren't in the file name — a colour palette and the generation prompt.
//
//   palette  k-means over a ~64px decode, in OKLab (a perceptual colour
//            space, so "near" means "looks near"). Stored as up to 6
//            [L, a, b, weight] entries, weight = share of the image.
//            Works from the cached thumbnail when there is one, so it runs
//            for disconnected folders too.
//   prompt   positive prompt text (ComfyUI graph or A1111 parameters);
//   model    checkpoint + LoRA names. Both need the original PNG.
//
// Results live in the "features" store and in memory. Indexing runs a few
// images at a time, current folder first, and backs off while the user is
// scrolling. Bump VERSION to recompute everything after changing the maths.
(function () {
  const C = (window.Curator = window.Curator || {});
  const VERSION = 1;
  const CONCURRENCY = 3;
  const SAMPLE = 64; // decode width for colour analysis
  const K = 6;

  const data = new Map(); // key -> { k, v, pal, prompt, model }
  let todo = [];
  let ti = 0;
  let active = 0;
  let generation = 0;
  let skipped = new Set(); // couldn't be read this run (folder offline, no thumb)
  let writes = [];
  let busyUntil = 0;
  const listeners = { progress: [], batch: [] };
  const stats = { done: 0, total: 0, running: false };

  // ------------------------------------------------------------ colour

  const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const gam = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

  function rgbToLab(r, g, b) {
    r = lin(r);
    g = lin(g);
    b = lin(b);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  }

  function labToRgb(L, a, b) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const clamp = (x) => Math.max(0, Math.min(255, Math.round(gam(Math.max(0, x)))));
    return [
      clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    ];
  }

  const labHex = (c) => "#" + labToRgb(c[0], c[1], c[2]).map((x) => x.toString(16).padStart(2, "0")).join("");
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

  // k-means with a deterministic farthest-first start, then merge
  // near-duplicate clusters and drop specks.
  function palette(px, n) {
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) {
      cx += px[i * 3];
      cy += px[i * 3 + 1];
      cz += px[i * 3 + 2];
    }
    const centers = [[cx / n, cy / n, cz / n]];
    const near = new Float32Array(n).fill(Infinity);
    while (centers.length < K) {
      const c = centers[centers.length - 1];
      let best = -1, bestD = -1;
      for (let i = 0; i < n; i++) {
        const d = (px[i * 3] - c[0]) ** 2 + (px[i * 3 + 1] - c[1]) ** 2 + (px[i * 3 + 2] - c[2]) ** 2;
        if (d < near[i]) near[i] = d;
        if (near[i] > bestD) {
          bestD = near[i];
          best = i;
        }
      }
      if (bestD < 1e-5) break;
      centers.push([px[best * 3], px[best * 3 + 1], px[best * 3 + 2]]);
    }
    const k = centers.length;
    const assign = new Uint8Array(n);
    let counts = new Array(k).fill(0);
    for (let iter = 0; iter < 10; iter++) {
      const sums = centers.map(() => [0, 0, 0]);
      counts = new Array(k).fill(0);
      for (let i = 0; i < n; i++) {
        let bj = 0, bd = Infinity;
        for (let j = 0; j < k; j++) {
          const c = centers[j];
          const d = (px[i * 3] - c[0]) ** 2 + (px[i * 3 + 1] - c[1]) ** 2 + (px[i * 3 + 2] - c[2]) ** 2;
          if (d < bd) {
            bd = d;
            bj = j;
          }
        }
        assign[i] = bj;
        counts[bj]++;
        sums[bj][0] += px[i * 3];
        sums[bj][1] += px[i * 3 + 1];
        sums[bj][2] += px[i * 3 + 2];
      }
      for (let j = 0; j < k; j++) if (counts[j]) centers[j] = sums[j].map((v) => v / counts[j]);
    }
    let pal = centers.map((c, j) => [c[0], c[1], c[2], counts[j] / n]).filter((c) => c[3] > 0);
    pal.sort((a, b) => b[3] - a[3]);
    const merged = [];
    for (const c of pal) {
      const m = merged.find((x) => dist(x, c) < 0.05);
      if (!m) merged.push(c.slice());
      else {
        const w = m[3] + c[3];
        for (let i = 0; i < 3; i++) m[i] = (m[i] * m[3] + c[i] * c[3]) / w;
        m[3] = w;
      }
    }
    return merged
      .filter((c) => c[3] >= 0.02)
      .sort((a, b) => b[3] - a[3])
      .map((c) => c.map((v) => Math.round(v * 1000) / 1000));
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  async function paletteOf(blob) {
    const bmp = await createImageBitmap(blob, { resizeWidth: SAMPLE, resizeQuality: "medium" });
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const { data: rgba } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const n = rgba.length / 4;
    const px = new Float32Array(n * 3);
    let m = 0;
    for (let i = 0; i < n; i++) {
      if (rgba[i * 4 + 3] < 128) continue; // ignore transparency
      const lab = rgbToLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
      px[m * 3] = lab[0];
      px[m * 3 + 1] = lab[1];
      px[m * 3 + 2] = lab[2];
      m++;
    }
    return m ? palette(px, m) : [];
  }

  // Share of the image within `radius` of a target colour, soft-edged.
  function colorScore(pal, target, radius) {
    let s = 0;
    for (const c of pal) s += c[3] * Math.max(0, 1 - dist(c, target) / radius);
    return s;
  }

  // How differently two palettes are made up (0 = same). Each colour is
  // matched to its nearest counterpart, weighted by its share, both ways.
  function paletteDistance(p, q) {
    if (!p.length || !q.length) return Infinity;
    const one = (x, y) => x.reduce((sum, c) => sum + c[3] * Math.min(...y.map((d) => dist(c, d))), 0);
    return (one(p, q) + one(q, p)) / 2;
  }

  // ------------------------------------------------------------ prompts

  function promptOf(meta) {
    if (!meta) return { prompt: "", model: "" };
    if (meta.comfy) return { prompt: meta.comfy.positive.join("\n"), model: [...meta.comfy.models, ...meta.comfy.loras].join("\n") };
    if (meta.a1111) {
      const t = meta.a1111;
      const cut = t.indexOf("Negative prompt:");
      const model = (t.match(/Model: ([^,\n]+)/) || [])[1] || "";
      return { prompt: (cut < 0 ? t.split("\nSteps:")[0] : t.slice(0, cut)).trim(), model };
    }
    return { prompt: "", model: "" };
  }

  // ------------------------------------------------------------ indexing

  function needsWork(key) {
    const e = data.get(key);
    if (!e || e.v !== VERSION) return true;
    return e.prompt === null && C.source.isConnected(key);
  }

  async function analyze(key) {
    const prev = data.get(key);
    const conn = C.source.isConnected(key);
    let pal = prev && prev.v === VERSION ? prev.pal : null;
    let prompt = prev && prev.v === VERSION ? prev.prompt : null;
    let model = prev && prev.v === VERSION ? prev.model : null;
    let file = null;
    if (!pal) {
      let blob = await C.store.get("thumbs", key).catch(() => null);
      if (!blob && conn) blob = file = await C.source.getFile(key);
      if (!blob) return null;
      pal = await paletteOf(blob);
    }
    if (prompt === null) {
      if (!/\.png$/i.test(key)) prompt = model = "";
      else if (conn) {
        file = file || (await C.source.getFile(key));
        ({ prompt, model } = promptOf(await C.pngmeta.read(file).catch(() => null)));
      }
    }
    return { k: key, v: VERSION, pal, prompt, model };
  }

  function emit(type) {
    listeners[type].forEach((fn) => fn(stats));
  }

  let progressTimer = 0;
  let batchTimer = 0;
  function tick() {
    if (!progressTimer)
      progressTimer = setTimeout(() => {
        progressTimer = 0;
        emit("progress");
      }, 300);
    if (writes.length >= 50) flush();
    if (!batchTimer)
      batchTimer = setTimeout(() => {
        batchTimer = 0;
        flush();
        emit("batch");
      }, 2500);
  }

  function flush() {
    if (!writes.length) return;
    C.store.putMany("features", writes).catch((e) => console.warn("features write failed", e));
    writes = [];
  }

  function pump(gen) {
    if (gen !== generation) return;
    if (performance.now() < busyUntil) return setTimeout(() => pump(gen), 250);
    while (active < CONCURRENCY && ti < todo.length) {
      const key = todo[ti++];
      if (!needsWork(key)) {
        stats.done++;
        continue;
      }
      active++;
      analyze(key)
        .then((e) => {
          if (e) {
            data.set(key, e);
            writes.push(e);
          } else skipped.add(key);
        })
        .catch(() => skipped.add(key))
        .finally(() => {
          active--;
          stats.done++;
          tick();
          setTimeout(() => pump(gen), 0);
        });
    }
    if (ti >= todo.length && !active && stats.running) {
      stats.running = false;
      flush();
      emit("progress");
      emit("batch");
    }
  }

  // Which images have a cached thumbnail (so can be analysed offline).
  let thumbSet = null;
  let thumbSetAt = 0;
  async function thumbKeys() {
    if (!thumbSet || performance.now() - thumbSetAt > 30000) {
      thumbSet = new Set(await C.store.keys("thumbs").catch(() => []));
      thumbSetAt = performance.now();
    }
    return thumbSet;
  }

  // (Re)start indexing over `all` keys, `first` ones first. Images in
  // offline folders are only queued if they have a cached thumbnail.
  async function start(all, first) {
    const gen = ++generation;
    const thumbs = await thumbKeys();
    if (gen !== generation) return;
    const can = (k) => needsWork(k) && (C.source.isConnected(k) || (thumbs.has(k) && !(data.get(k) || {}).pal));
    skipped = new Set();
    const pri = new Set(first || []);
    todo = [];
    for (const k of pri) if (can(k)) todo.push(k);
    for (const k of all) if (!pri.has(k) && can(k)) todo.push(k);
    ti = 0;
    stats.done = 0;
    stats.total = todo.length;
    stats.running = todo.length > 0;
    emit("progress");
    pump(gen);
  }

  async function load() {
    for (const e of await C.store.getAll("features")) data.set(e.k, e);
  }

  // Right now, for the details panel (skips the queue).
  async function analyzeNow(key) {
    if (!needsWork(key)) return data.get(key);
    const e = await analyze(key).catch(() => null);
    if (e) {
      data.set(key, e);
      C.store.put("features", e).catch(() => {});
    }
    return e || data.get(key) || null;
  }

  // Keys moved (orphans reattached) or forgotten (folder removed).
  async function rekey(pairs) {
    const moved = [];
    for (const [from, to] of pairs) {
      const e = data.get(from);
      if (!e) continue;
      data.delete(from);
      data.set(to, { ...e, k: to });
      moved.push(data.get(to));
    }
    await C.store.delMany("features", pairs.map((p) => p[0]));
    await C.store.putMany("features", moved);
  }
  async function forget(keys) {
    keys.forEach((k) => data.delete(k));
    await C.store.delMany("features", keys);
  }

  // Restore from a backup: only fills in images not already indexed.
  async function importMany(entries) {
    const add = (entries || []).filter((e) => e && e.k && !data.has(e.k));
    add.forEach((e) => data.set(e.k, e));
    if (add.length) await C.store.putMany("features", add);
    return add.length;
  }

  C.features = {
    importMany,
    load,
    start,
    analyzeNow,
    rekey,
    forget,
    get: (k) => data.get(k),
    count: () => data.size,
    stats,
    on: (type, fn) => listeners[type].push(fn),
    busy: (ms) => (busyUntil = Math.max(busyUntil, performance.now() + (ms || 400))),
    rgbToLab,
    labToRgb,
    labHex,
    colorScore,
    paletteDistance,
  };
})();
