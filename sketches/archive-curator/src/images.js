// Object-URL plumbing for thumbnails and full-size images.
//
// Thumbnails are generated once (longest edge THUMB_EDGE px, webp) and cached
// in IndexedDB, so the library grid stays fast — and still renders — even
// before you've reconnected the folder in a new session. Generation runs
// through a small LIFO pool: the most recently requested thumbs (i.e. the
// ones currently scrolled into view) are made first.
(function () {
  const C = (window.Curator = window.Curator || {});
  const THUMB_EDGE = 512;
  const POOL = 4;
  const FULL_CACHE = 24;

  const thumbUrls = new Map(); // path -> objectURL
  const thumbPending = new Map(); // path -> Promise<url|null>
  const jobs = []; // LIFO
  let active = 0;

  function schedule(fn) {
    return new Promise((resolve, reject) => {
      jobs.push({ fn, resolve, reject });
      pump();
    });
  }
  function pump() {
    while (active < POOL && jobs.length) {
      const job = jobs.pop();
      active++;
      job
        .fn()
        .then(job.resolve, job.reject)
        .finally(() => {
          active--;
          pump();
        });
    }
  }

  async function makeThumb(path) {
    const file = await C.source.getFile(path);
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, THUMB_EDGE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return new Promise((res) => canvas.toBlob(res, "image/webp", 0.82));
  }

  function thumb(path) {
    if (thumbUrls.has(path)) return Promise.resolve(thumbUrls.get(path));
    if (thumbPending.has(path)) return thumbPending.get(path);
    const p = (async () => {
      let blob = await C.store.get("thumbs", path).catch(() => null);
      if (!blob) {
        if (!C.source.connected) return null;
        blob = await schedule(() => makeThumb(path)).catch(() => null);
        if (!blob) return null;
        C.store.put("thumbs", blob, path).catch(() => {});
      }
      const url = URL.createObjectURL(blob);
      thumbUrls.set(path, url);
      return url;
    })().finally(() => thumbPending.delete(path));
    thumbPending.set(path, p);
    return p;
  }

  // Full-size: small LRU of object URLs so flipping back and forth is instant.
  const full = new Map(); // path -> Promise<url>
  function fullUrl(path) {
    if (full.has(path)) {
      const p = full.get(path);
      full.delete(path);
      full.set(path, p);
      return p;
    }
    const p = C.source.getFile(path).then((f) => URL.createObjectURL(f));
    p.catch(() => full.delete(path));
    full.set(path, p);
    while (full.size > FULL_CACHE) {
      const [oldPath, oldP] = full.entries().next().value;
      full.delete(oldPath);
      oldP.then((u) => URL.revokeObjectURL(u), () => {});
    }
    return p;
  }

  function preload(paths) {
    for (const p of paths) {
      fullUrl(p)
        .then((u) => {
          const img = new Image();
          img.src = u;
        })
        .catch(() => {});
    }
  }

  async function clearThumbCache() {
    for (const u of thumbUrls.values()) URL.revokeObjectURL(u);
    thumbUrls.clear();
    await C.store.clear("thumbs");
  }

  C.images = { thumb, fullUrl, preload, clearThumbCache };
})();
