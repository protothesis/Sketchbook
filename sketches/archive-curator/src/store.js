// Tiny IndexedDB wrapper. Everything the app knows lives here — the source
// images themselves are only ever read, never written, moved or copied.
//
// Stores:
//   kv         misc key/value: settings, the scanned file index, the root
//              directory handle (handles are structured-cloneable)
//   records    one row per image you've touched, keyed by path relative to
//              the root folder: { path, rating, reviewedAt, notes, galleries }
//   galleries  virtual galleries: { id, name, created }
//   thumbs     cached thumbnail blobs keyed by relative path
(function () {
  const C = (window.Curator = window.Curator || {});
  const DB_NAME = "archive-curator";
  const DB_VERSION = 1;
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
    put: (s, value, key) => run(s, "readwrite", (os) => (key === undefined ? os.put(value) : os.put(value, key))),
    del: (s, key) => run(s, "readwrite", (os) => os.delete(key)),
    clear: (s) => run(s, "readwrite", (os) => os.clear()),
    putMany: (s, values) =>
      run(s, "readwrite", (os) => {
        for (const v of values) os.put(v);
      }),
  };
})();
