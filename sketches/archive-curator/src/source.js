// Read-only access to the image folder.
//
// Two modes:
//   "handle" — File System Access API (Chrome/Edge). The directory handle is
//              persisted in IndexedDB so next visit is one "Reconnect" click
//              (browsers require a user gesture to re-grant read access).
//   "files"  — <input webkitdirectory> fallback for other browsers. Works,
//              but the folder has to be re-picked every session.
//
// Paths are always relative to the picked folder, "/"-separated, e.g.
// "2024-05-01/ComfyUI_00042_.png" — that's the key all metadata hangs off,
// so moving the whole output folder elsewhere doesn't lose anything.
(function () {
  const C = (window.Curator = window.Curator || {});
  const IMAGE_RE = /\.(png|jpe?g|webp|gif|avif|bmp)$/i;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

  const source = {
    supportsHandles: typeof window.showDirectoryPicker === "function",
    mode: null,
    handle: null, // root FileSystemDirectoryHandle (handle mode)
    fileMap: null, // path -> File (files mode)
    name: "",
    connected: false,
    dirCache: new Map(),

    async pick() {
      const h = await window.showDirectoryPicker({ id: "archive-curator", mode: "read" });
      this.useHandle(h);
      return h;
    },

    useHandle(h) {
      this.mode = "handle";
      this.handle = h;
      this.fileMap = null;
      this.name = h.name;
      this.dirCache = new Map([["", h]]);
      this.connected = true;
    },

    // Fallback: a FileList from <input webkitdirectory>. Returns sorted paths.
    useFileList(list) {
      const map = new Map();
      let rootName = "";
      for (const f of list) {
        const rel = f.webkitRelativePath || f.name;
        const parts = rel.split("/");
        if (!rootName) rootName = parts.length > 1 ? parts[0] : "";
        const path = parts.length > 1 ? parts.slice(1).join("/") : rel;
        if (!IMAGE_RE.test(path) || parts.some((p) => p.startsWith("."))) continue;
        map.set(path, f);
      }
      this.mode = "files";
      this.handle = null;
      this.fileMap = map;
      this.name = rootName || "folder";
      this.connected = true;
      return [...map.keys()].sort(collator.compare);
    },

    // Whether we (still) have read permission on a stored handle. Passing
    // request=true prompts the user, which only works inside a click handler.
    async hasPermission(h, request) {
      const opts = { mode: "read" };
      if ((await h.queryPermission(opts)) === "granted") return true;
      if (!request) return false;
      return (await h.requestPermission(opts)) === "granted";
    },

    // Recursively lists every image under the root. onProgress(count, dir)
    // fires periodically so the UI can show something during big scans.
    async scan(onProgress) {
      if (this.mode === "files") return [...this.fileMap.keys()].sort(collator.compare);
      const out = [];
      const stack = [["", this.handle]];
      let lastTick = 0;
      while (stack.length) {
        const [prefix, dir] = stack.pop();
        for await (const [name, entry] of dir.entries()) {
          if (name.startsWith(".")) continue;
          const path = prefix ? prefix + "/" + name : name;
          if (entry.kind === "directory") {
            this.dirCache.set(path, entry);
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

    async getDir(dirPath) {
      if (this.dirCache.has(dirPath)) return this.dirCache.get(dirPath);
      const cut = dirPath.lastIndexOf("/");
      const parent = await this.getDir(cut < 0 ? "" : dirPath.slice(0, cut));
      const dir = await parent.getDirectoryHandle(dirPath.slice(cut + 1));
      this.dirCache.set(dirPath, dir);
      return dir;
    },

    async getFile(path) {
      if (!this.connected) throw new Error("Folder not connected");
      if (this.mode === "files") {
        const f = this.fileMap.get(path);
        if (!f) throw new Error("Not found: " + path);
        return f;
      }
      const cut = path.lastIndexOf("/");
      const dir = await this.getDir(cut < 0 ? "" : path.slice(0, cut));
      const fh = await dir.getFileHandle(path.slice(cut + 1));
      return fh.getFile();
    },
  };

  C.source = source;
  C.collator = collator;
})();
