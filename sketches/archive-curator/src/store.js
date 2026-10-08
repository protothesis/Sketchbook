// Tiny IndexedDB wrapper. Everything the app knows lives here — the source
// images themselves are only ever read, never written, moved or copied.
//
// Stores:
//   kv         misc key/value: settings, schema version, and each folder's
//              scanned file list under "files:<rootId>"
//   roots      added folders: { id, name, handle, rootPath, added }
//              (directory handles are structured-cloneable)
//   records    one row per image you've touched, keyed by "<rootId>/<path>":
//              { path, rating, reviewedAt, notes, galleries }
//   galleries  virtual galleries: { id, name, created, group, pos, order[] }
//              (gallery groups live in kv "galleryGroups")
//   thumbs     cached thumbnail blobs keyed by "<rootId>/<path>"
//   features   background-index results per image (features.js):
//              { k, v, pal, prompt, model }
(function () {
  const C = (window.Curator = window.Curator || {});
  const DB_NAME = "archive-curator";
  const DB_VERSION = 3;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        if (!db.objectStoreNames.contains("records")) db.createObjectStore("records", { keyPath: "path" });
        if (!db.objectStoreNames.contains("galleries")) db.createObjectStore("galleries", { keyPath: "id" });
        if (!db.objectStoreNames.contains("thumbs")) db.createObjectStore("thumbs");
        if (!db.objectStoreNames.contains("roots")) db.createObjectStore("roots", { keyPath: "id" });
        if (!db.objectStoreNames.contains("features")) db.createObjectStore("features", { keyPath: "k" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  // Runs body(objectStore) in a transaction; resolves once the transaction
  // commits, with the result of the IDBRequest body returned (if any).
  async function run(storeName, mode, body) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(storeName, mode);
      const out = body(t.objectStore(storeName));
      t.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  C.store = {
    get: (s, key) => run(s, "readonly", (os) => os.get(key)),
    getAll: (s) => run(s, "readonly", (os) => os.getAll()),
    keys: (s) => run(s, "readonly", (os) => os.getAllKeys()),
    put: (s, value, key) => run(s, "readwrite", (os) => (key === undefined ? os.put(value) : os.put(value, key))),
    del: (s, key) => run(s, "readwrite", (os) => os.delete(key)),
    clear: (s) => run(s, "readwrite", (os) => os.clear()),
    putMany: (s, values) =>
      run(s, "readwrite", (os) => {
        for (const v of values) os.put(v);
      }),
    delMany: (s, keys) =>
      run(s, "readwrite", (os) => {
        for (const k of keys) os.delete(k);
      }),
    // Clear + refill in one transaction, so it's all-or-nothing.
    replaceAll: (s, values) =>
      run(s, "readwrite", (os) => {
        os.clear();
        for (const v of values) os.put(v);
      }),
    // Moves values between out-of-line keys: pairs of [oldKey, newKey].
    rekey: (s, pairs) =>
      run(s, "readwrite", (os) => {
        for (const [from, to] of pairs) {
          os.get(from).onsuccess = (e) => {
            if (e.target.result !== undefined) os.put(e.target.result, to);
            os.delete(from);
          };
        }
      }),
  };
})();
