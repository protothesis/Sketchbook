// Object-URL plumbing for thumbnails and full-size images.
//
// Thumbnails are generated once (longest edge THUMB_EDGE px, webp) and cached
// in IndexedDB, so the library grid stays fast — and still renders — even
// before you've reconnected a folder in a new session. Generation runs
// through a small LIFO pool: the most recently requested thumbs (i.e. the
// ones currently scrolled into view) are made first, and the grid cancels
// requests for cells that scroll away before their turn.
(function () {
  const C = (window.Curator = window.Curator || {});
  const THUMB_EDGE = 512;
  const POOL = 4;
  const FULL_CACHE = 24;
  const THUMB_URL_CACHE = 3000; // object URLs kept alive; blobs stay in IndexedDB

  const thumbUrls = new Map(); // key -> objectURL (insertion order = LRU)
  const thumbPending = new Map(); // key -> Promise<url|null>
  const jobs = []; // LIFO of { key, fn, resolve, reject }
  let active = 0;

  function schedule(key, fn) {
    return new Promise((resolve, reject) => {
      jobs.push({ key, fn, resolve, reject });
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

  // Drop a not-yet-started thumbnail job (its cell scrolled out of view).
  function cancel(key) {
    const i = jobs.findIndex((j) => j.key === key);
    if (i >= 0) jobs.splice(i, 1)[0].resolve(null);
  }

  async function makeThumb(key) {
    const file = await C.source.getFile(key);
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

  function remember(key, url) {
    thumbUrls.set(key, url);
    while (thumbUrls.size > THUMB_URL_CACHE) {
      const [oldKey, oldUrl] = thumbUrls.entries().next().value;
      thumbUrls.delete(oldKey);
      URL.revokeObjectURL(oldUrl);
    }
  }

  function thumb(key) {
    if (thumbUrls.has(key)) {
      const url = thumbUrls.get(key);
      thumbUrls.delete(key);
      thumbUrls.set(key, url);
      return Promise.resolve(url);
    }
    if (thumbPending.has(key)) return thumbPending.get(key);
    const p = (async () => {
      let blob = await C.store.get("thumbs", key).catch(() => null);
      if (!blob) {
        if (!C.source.isConnected(key)) return null;
        blob = await schedule(key, () => makeThumb(key)).catch(() => null);
        if (!blob) return null;
        C.store.put("thumbs", blob, key).catch(() => {});
      }
      const url = URL.createObjectURL(blob);
      remember(key, url);
      return url;
    })().finally(() => thumbPending.delete(key));
    thumbPending.set(key, p);
    return p;
  }

  // Full-size: small LRU of object URLs so flipping back and forth is instant.
  const full = new Map(); // key -> Promise<url>
  function fullUrl(key) {
    if (full.has(key)) {
      const p = full.get(key);
      full.delete(key);
      full.set(key, p);
      return p;
    }
    const p = C.source.getFile(key).then((f) => URL.createObjectURL(f));
    p.catch(() => full.delete(key));
    full.set(key, p);
    while (full.size > FULL_CACHE) {
      const [oldKey, oldP] = full.entries().next().value;
      full.delete(oldKey);
      oldP.then((u) => URL.revokeObjectURL(u), () => {});
    }
    return p;
  }

  function preload(keys) {
    for (const k of keys) {
      fullUrl(k)
        .then((u) => {
          const img = new Image();
          img.src = u;
        })
        .catch(() => {});
    }
  }

  // Forget in-memory URLs for keys whose stored thumbs were moved or deleted.
  function forget(keys) {
    for (const k of keys) {
      const u = thumbUrls.get(k);
      if (u) URL.revokeObjectURL(u);
      thumbUrls.delete(k);
    }
  }

  async function clearThumbCache() {
    for (const u of thumbUrls.values()) URL.revokeObjectURL(u);
    thumbUrls.clear();
    await C.store.clear("thumbs");
  }

  C.images = { thumb, cancel, fullUrl, preload, forget, clearThumbCache };
})();
