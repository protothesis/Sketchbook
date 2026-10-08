// Read-only access to one or more image folders ("roots").
//
// Every image is identified by a key: "<rootId>/<path inside that folder>",
// e.g. "output/2024-05-01/ComfyUI_00042_.png". The root id is the folder's
// name (made unique if two added folders share one), so a key doubles as
// its position in the folder tree, and re-adding a folder after moving it
// lines all its metadata back up.
//
// Two modes per root:
//   "handle" — File System Access API (Chrome/Edge). The app persists the
//              handle; each session the browser wants one click to re-grant
//              read access (unless it was told to remember).
//   "files"  — <input webkitdirectory> fallback for other browsers. Held in
//              memory only, so the folder is re-picked every session.
//
// Only connected roots live here; the app keeps the list of known roots.
(function () {
  const C = (window.Curator = window.Curator || {});
  const IMAGE_RE = /\.(png|jpe?g|webp|gif|avif|bmp)$/i;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const roots = new Map(); // id -> { mode, handle, fileMap, dirCache }

  function split(key) {
    const i = key.indexOf("/");
    return i < 0 ? [key, ""] : [key.slice(0, i), key.slice(i + 1)];
  }

  const source = {
    supportsHandles: typeof window.showDirectoryPicker === "function",
    split,

    isConnected: (keyOrId) => roots.has(split(keyOrId)[0]),

    useHandle(id, h) {
      roots.set(id, { mode: "handle", handle: h, dirCache: new Map([["", h]]) });
    },

    // Fallback: a FileList from <input webkitdirectory>.
    // Returns { name, map } with map: relative path -> File.
    readFileList(list) {
      const map = new Map();
      let name = "";
      for (const f of list) {
        const rel = f.webkitRelativePath || f.name;
        const parts = rel.split("/");
        if (!name) name = parts.length > 1 ? parts[0] : "";
        const path = parts.length > 1 ? parts.slice(1).join("/") : rel;
        if (!IMAGE_RE.test(path) || parts.some((p) => p.startsWith("."))) continue;
        map.set(path, f);
      }
      return { name: name || "folder", map };
    },

    useFileMap(id, map) {
      roots.set(id, { mode: "files", fileMap: map });
    },

    disconnect(id) {
      roots.delete(id);
    },

    // Whether we (still) have read permission on a stored handle. Passing
    // request=true prompts the user, which only works inside a click handler.
    async hasPermission(h, request) {
      const opts = { mode: "read" };
      if ((await h.queryPermission(opts)) === "granted") return true;
      if (!request) return false;
      return (await h.requestPermission(opts)) === "granted";
    },

    // Recursively lists every image under a connected root, as sorted
    // relative paths. onProgress(count, dir) fires periodically.
    async scan(id, onProgress) {
      const root = roots.get(id);
      if (!root) throw new Error("Folder not connected");
      if (root.mode === "files") return [...root.fileMap.keys()].sort(collator.compare);
      const out = [];
      const stack = [["", root.handle]];
      let lastTick = 0;
      while (stack.length) {
        const [prefix, dir] = stack.pop();
        for await (const [name, entry] of dir.entries()) {
          if (name.startsWith(".")) continue;
          const path = prefix ? prefix + "/" + name : name;
          if (entry.kind === "directory") {
            root.dirCache.set(path, entry);
            stack.push([path, entry]);
          } else if (IMAGE_RE.test(name)) {
            out.push(path);
          }
        }
        const now = performance.now();
        if (onProgress && now - lastTick > 120) {
          lastTick = now;
          onProgress(out.length, prefix);
        }
      }
      out.sort(collator.compare);
      if (onProgress) onProgress(out.length, "");
      return out;
    },

    async getFile(key) {
      const [id, rel] = split(key);
      const root = roots.get(id);
      if (!root) throw new Error("Folder not connected");
      if (root.mode === "files") {
        const f = root.fileMap.get(rel);
        if (!f) throw new Error("Not found: " + key);
        return f;
      }
      const cut = rel.lastIndexOf("/");
      const dir = await getDir(root, cut < 0 ? "" : rel.slice(0, cut));
      const fh = await dir.getFileHandle(rel.slice(cut + 1));
      return fh.getFile();
    },
  };

  async function getDir(root, dirPath) {
    if (root.dirCache.has(dirPath)) return root.dirCache.get(dirPath);
    const cut = dirPath.lastIndexOf("/");
    const parent = await getDir(root, cut < 0 ? "" : dirPath.slice(0, cut));
    const dir = await parent.getDirectoryHandle(dirPath.slice(cut + 1));
    root.dirCache.set(dirPath, dir);
    return dir;
  }

  C.source = source;
  C.collator = collator;
})();
