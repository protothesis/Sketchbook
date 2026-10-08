// Core: folders, folder tree, library grid, galleries, lightbox, settings,
// keys — and the module host. Everything optional (flashcard review, and
// later things like people or colour search) is a module in src/modules/
// that registers itself with Curator.registerModule() and gets its own tab.
//
// All state about images is metadata keyed by "<rootId>/<path>" — see
// store.js and source.js.
(function () {
  const C = window.Curator;
  const { store, source, images, details, markdown } = C;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => markdown.esc(String(s));
  const fmt = (n) => n.toLocaleString();
  const RATINGS = ["yes", "maybe", "no"];
  // Pseudo-folder for metadata from before multi-folder support whose
  // original folder hasn't been re-added yet. Re-adding it reattaches them.
  const ORPHAN = "~unattached";

  const DEFAULT_SETTINGS = {
    thumbSize: 200,
    thumbFit: "contain", // "contain" = whole image letterboxed, "cover" = cropped squares
    view: "library",
    src: { type: "folder", path: "" }, // what's being looked at: a folder (""=all) or a gallery
    filter: "all",
    sort: "path",
    detailsOpen: false,
    expanded: [], // folder-tree nodes that are open
    targetGallery: null,
    modules: {}, // id -> enabled
  };

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    roots: [], // { id, name, handle, rootPath, added, virtual? }
    files: new Map(), // rootId -> sorted relative paths
    all: [], // every key, in folder order
    tree: null,
    srcKeys: null, // cache of keys in the current source
    scanning: new Set(),
    records: new Map(), // key -> { path, rating, reviewedAt, notes, galleries[] }
    galleries: [], // { id, name, created }
    view: null,
    lib: { search: "", items: [], selected: new Set(), anchor: -1, shuffled: null },
    lb: { items: [], index: 0, open: false, zoom: false },
  };

  // ------------------------------------------------------------ modules

  const modules = [];
  C.registerModule = (m) => modules.push(m);
  const enabledModules = () => modules.filter((m) => moduleEnabled(m));
  function moduleEnabled(m) {
    const v = state.settings.modules[m.id];
    return v === undefined ? m.defaultEnabled !== false : !!v;
  }
  const activeModule = () => modules.find((m) => m.id === state.view && moduleEnabled(m));
  const emit = (hook, ...args) => enabledModules().forEach((m) => m[hook] && m[hook](...args));

  // ---------------------------------------------------------------- data

  let settingsTimer = null;
  function saveSettings() {
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => store.put("kv", state.settings, "settings"), 250);
  }

  const record = (path) => state.records.get(path);
  function ensureRecord(path) {
    let r = state.records.get(path);
    if (!r) {
      r = { path, rating: null, reviewedAt: null, notes: "", galleries: [] };
      state.records.set(path, r);
    }
    return r;
  }
  function saveRecord(r) {
    if (!r.rating && !(r.notes || "").trim() && !r.galleries.length) {
      state.records.delete(r.path);
      store.del("records", r.path);
    } else {
      store.put("records", r);
    }
  }

  function setRating(path, rating) {
    const r = ensureRecord(path);
    r.rating = rating || null;
    r.reviewedAt = rating ? Date.now() : null;
    saveRecord(r);
    changed(path);
  }

  function setNotes(path, text) {
    const r = ensureRecord(path);
    if ((r.notes || "") === text) return;
    r.notes = text;
    saveRecord(r);
    updateCell(path);
  }

  function galleryChanged() {
    if (state.settings.src.type === "gallery") state.srcKeys = null;
    renderSidebar();
    refreshPanels();
  }

  function toggleGallery(path, id) {
    const r = ensureRecord(path);
    const has = r.galleries.includes(id);
    r.galleries = has ? r.galleries.filter((g) => g !== id) : [...r.galleries, id];
    saveRecord(r);
    galleryChanged();
    changed(path);
  }

  function addToGallery(paths, id, remove) {
    for (const p of paths) {
      const r = ensureRecord(p);
      const has = r.galleries.includes(id);
      if (remove && has) r.galleries = r.galleries.filter((g) => g !== id);
      else if (!remove && !has) r.galleries.push(id);
      saveRecord(r);
    }
    const g = gallery(id);
    toast(`${remove ? "Removed" : "Added"} ${plural(paths.length, "image")} ${remove ? "from" : "to"} “${g ? g.name : "gallery"}”`);
    galleryChanged();
    paths.forEach(updateCell);
  }

  const gallery = (id) => state.galleries.find((x) => x.id === id);
  const plural = (n, w) => `${fmt(n)} ${w}${n === 1 ? "" : "s"}`;

  // Optionally seeded with images (dropping a selection on "+ New gallery").
  function newGallery(paths) {
    const suggested = paths && paths.length ? suggestGalleryName(paths) : "";
    const name = (prompt(paths && paths.length ? `New gallery with ${plural(paths.length, "image")}:` : "New gallery name:", suggested) || "").trim();
    if (!name) return null;
    const g = { id: "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, created: Date.now() };
    state.galleries.push(g);
    store.put("galleries", g);
    if (paths && paths.length) addToGallery(paths, g.id);
    else galleryChanged();
    return g;
  }

  // Shared folder name of the paths, if any, as a starting point.
  function suggestGalleryName(paths) {
    const dirs = new Set(paths.map((p) => p.slice(0, Math.max(0, p.lastIndexOf("/")))));
    if (dirs.size !== 1) return "";
    const d = [...dirs][0];
    return d.slice(d.lastIndexOf("/") + 1);
  }

  function renameGallery(id) {
    const g = gallery(id);
    const name = g && (prompt("Rename gallery:", g.name) || "").trim();
    if (!name) return;
    g.name = name;
    store.put("galleries", g);
    galleryChanged();
    renderLibTitle();
  }

  function deleteGallery(id) {
    const g = gallery(id);
    if (!g || !confirm(`Delete gallery “${g.name}”? (Only the grouping is removed — images and ratings stay.)`)) return;
    state.galleries = state.galleries.filter((x) => x.id !== id);
    store.del("galleries", id);
    for (const r of [...state.records.values()]) {
      if (r.galleries.includes(id)) {
        r.galleries = r.galleries.filter((x) => x !== id);
        saveRecord(r);
      }
    }
    if (state.settings.targetGallery === id) state.settings.targetGallery = null;
    if (state.settings.src.type === "gallery" && state.settings.src.id === id) setSource({ type: "folder", path: "" });
    else galleryChanged();
  }

  function setTarget(id) {
    state.settings.targetGallery = state.settings.targetGallery === id ? null : id;
    saveSettings();
    renderSidebar();
    const g = gallery(state.settings.targetGallery);
    toast(g ? `Target gallery: “${g.name}” — press B to add/remove` : "Target gallery cleared");
  }

  // B: toggle the current image (or library selection) in the target gallery.
  function targetToggle() {
    const paths = currentPaths();
    if (!paths.length) return toast("Nothing selected");
    let id = state.settings.targetGallery;
    if (!gallery(id)) {
      const g = newGallery(paths);
      if (!g) return;
      state.settings.targetGallery = g.id;
      saveSettings();
      renderSidebar();
      return;
    }
    const all = paths.every((p) => (record(p) || { galleries: [] }).galleries.includes(id));
    addToGallery(paths, id, all);
    if (all && state.settings.src.type === "gallery" && state.settings.src.id === id && state.view === "library") rebuildLibrary(true);
  }

  // The image(s) the user is acting on right now.
  function currentPaths() {
    if (state.lb.open) return [state.lb.items[state.lb.index]];
    const m = activeModule();
    if (m && m.current) return m.current();
    if (state.view === "library") return [...state.lib.selected];
    return [];
  }

  // Counts over the current source (folder or gallery).
  function counts() {
    const c = { yes: 0, maybe: 0, no: 0, notes: 0, total: 0 };
    for (const k of srcKeys()) {
      c.total++;
      const r = state.records.get(k);
      if (!r) continue;
      if (r.rating) c[r.rating]++;
      if ((r.notes || "").trim()) c.notes++;
    }
    c.rated = c.yes + c.maybe + c.no;
    c.unrated = c.total - c.rated;
    return c;
  }

  // Something about `path` changed — update every place that shows it.
  function changed(path) {
    renderStats();
    updateCell(path);
    if (state.view === "library") renderFilterBar();
    refreshPanels();
    if (state.lb.open) renderLbPos();
    emit("onChange", path);
  }

  function refreshPanels() {
    document.querySelectorAll(".details-panel").forEach((p) => details.refresh(p));
  }

  // ------------------------------------------------------------- helpers

  let toastTimer = null;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  async function copyText(text, msg) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast(msg || "Copied");
  }

  const rootById = (id) => state.roots.find((r) => r.id === id);
  const dirname = (p) => p.slice(0, Math.max(0, p.lastIndexOf("/")));

  function fullPath(key) {
    const [id, rel] = source.split(key);
    const root = (rootById(id) || {}).rootPath || "";
    const base = root.trim().replace(/[\\/]+$/, "");
    if (!base) return key;
    const sep = base.includes("\\") || /^[a-z]:$/i.test(base) ? "\\" : "/";
    return rel ? base + sep + rel.split("/").join(sep) : base;
  }

  function copyPath(path, folderOnly) {
    const root = rootById(source.split(path)[0]);
    if (root && !root.virtual && !(root.rootPath || "").trim()) {
      const p = prompt(
        `Browsers can't see real disk paths, so paste the full path of the “${root.name}” folder once (e.g. D:\\ComfyUI\\output).\nIt's only used to build copyable paths. Change it later in Settings.`,
        ""
      );
      if (p === null) return;
      root.rootPath = p.trim();
      store.put("roots", root);
    }
    const p = fullPath(folderOnly ? dirname(path) : path);
    copyText(p, `Copied ${p} — paste into Explorer's address bar`);
  }

  async function openOriginal(path) {
    try {
      window.open(await images.fullUrl(path), "_blank");
    } catch (e) {
      toast("Folder not connected");
    }
  }

  function sample(arr, n) {
    const a = arr.slice();
    const k = Math.min(n, a.length);
    for (let i = 0; i < k; i++) {
      const j = i + Math.floor(Math.random() * (a.length - i));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, k);
  }

  function setThumb(img, path, cell) {
    images.thumb(path).then((url) => {
      if (url) img.src = url;
      else if (!source.isConnected(path)) cell.classList.add("nothumb");
    });
  }

  // ------------------------------------------------- index & folder tree

  function rebuildIndex() {
    const all = [];
    for (const r of state.roots) for (const rel of state.files.get(r.id) || []) all.push(r.id + "/" + rel);
    state.all = all;
    state.srcKeys = null;
    state.lib.shuffled = null;
    state.tree = buildTree();
    // A folder that disappeared (removed, renamed) falls back to "all".
    const s = state.settings.src;
    if (s.type === "folder" && s.path && !findNode(s.path)) state.settings.src = { type: "folder", path: "" };
  }

  function buildTree() {
    const top = { name: "", path: "", count: 0, children: new Map() };
    for (const r of state.roots) top.children.set(r.id, { name: r.name, path: r.id, count: 0, children: new Map(), root: r });
    for (const key of state.all) {
      const segs = key.split("/");
      let node = top;
      node.count++;
      for (let i = 0; i < segs.length - 1; i++) {
        let next = node.children.get(segs[i]);
        if (!next) {
          next = { name: segs[i], path: segs.slice(0, i + 1).join("/"), count: 0, children: new Map() };
          node.children.set(segs[i], next);
        }
        next.count++;
        node = next;
      }
    }
    return top;
  }

  function findNode(path) {
    let node = state.tree;
    for (const seg of path.split("/")) {
      node = node && node.children.get(seg);
      if (!node) return null;
    }
    return node;
  }

  function srcKeys() {
    if (state.srcKeys) return state.srcKeys;
    const s = state.settings.src;
    let keys;
    if (s.type === "gallery") {
      keys = [];
      for (const r of state.records.values()) if (r.galleries.includes(s.id)) keys.push(r.path);
      keys.sort(C.collator.compare);
    } else if (!s.path) {
      keys = state.all;
    } else {
      const pre = s.path + "/";
      keys = state.all.filter((k) => k.startsWith(pre));
    }
    return (state.srcKeys = keys);
  }

  function srcLabel() {
    const s = state.settings.src;
    if (s.type === "gallery") return "Gallery: " + ((gallery(s.id) || {}).name || "?");
    if (!s.path) return state.roots.length > 1 ? "All folders" : (state.roots[0] || {}).name || "";
    const [id, rel] = source.split(s.path);
    const root = rootById(id);
    return (root ? root.name : id) + (rel ? " / " + rel.split("/").join(" / ") : "");
  }

  function setSource(src, opts) {
    state.settings.src = src;
    state.srcKeys = null;
    state.lib.shuffled = null;
    state.lib.selected.clear();
    saveSettings();
    renderSidebar();
    renderStats();
    if (state.view === "library") rebuildLibrary();
    if (!(opts && opts.quiet)) emit("onSource");
  }

  function renderSidebar() {
    renderTree();
    renderGalleries();
  }

  function renderTree() {
    const el = $("folder-tree");
    if (!state.tree) return (el.innerHTML = "");
    const s = state.settings.src;
    const sel = s.type === "folder" ? s.path : null;
    const open = new Set(state.settings.expanded);
    const rows = [];
    if (state.roots.length > 1)
      rows.push(`<div class="tree-row all ${sel === "" ? "on" : ""}" data-folder=""><span class="caret"></span><span class="tname">All folders</span><span class="n">${fmt(state.tree.count)}</span></div>`);
    const walk = (node, depth) => {
      const kids = [...node.children.values()].sort((a, b) => C.collator.compare(a.name, b.name));
      const isOpen = open.has(node.path);
      const r = node.root;
      let extra = "";
      let cls = "";
      if (r) {
        const conn = r.virtual || source.isConnected(r.id);
        cls = " root" + (conn ? "" : " offline") + (r.virtual ? " virtual" : "");
        if (state.scanning.has(r.id)) extra += `<span class="muted small">scanning&hellip;</span>`;
        else if (!r.virtual && !conn) extra += `<button class="tiny" data-t-act="reconnect" title="Re-grant read access">Reconnect</button>`;
        extra += `<button class="tiny hov" data-t-act="remove" title="Remove this folder from the library">&times;</button>`;
      }
      const title = r && r.virtual ? "Ratings, notes and thumbnails from before multi-folder support. Add the original folder again to reattach them." : node.path;
      rows.push(
        `<div class="tree-row${cls} ${sel === node.path ? "on" : ""}" data-folder="${esc(node.path)}" style="--d:${depth}" title="${esc(title)}">` +
          `<span class="caret" data-t-act="toggle">${kids.length ? (isOpen ? "&#9662;" : "&#9656;") : ""}</span>` +
          `<span class="tname">${esc(node.name)}</span>${extra}<span class="n">${fmt(node.count)}</span></div>`
      );
      if (isOpen) kids.forEach((k) => walk(k, depth + 1));
    };
    [...state.tree.children.values()].forEach((n) => walk(n, 0));
    el.innerHTML = rows.join("") || `<p class="muted small none">No folders yet.</p>`;
  }

  function toggleExpanded(path, force) {
    const set = new Set(state.settings.expanded);
    const on = force === undefined ? !set.has(path) : force;
    if (on) set.add(path);
    else set.delete(path);
    state.settings.expanded = [...set];
    saveSettings();
  }

  function renderGalleries() {
    const gCounts = new Map();
    for (const r of state.records.values()) for (const g of r.galleries) gCounts.set(g, (gCounts.get(g) || 0) + 1);
    const s = state.settings.src;
    const target = state.settings.targetGallery;
    $("gallery-list").innerHTML =
      state.galleries
        .map(
          (g) => `<li class="${s.type === "gallery" && s.id === g.id ? "on" : ""} ${target === g.id ? "target" : ""}" data-gallery="${esc(g.id)}">
            <span class="gname">${esc(g.name)}</span>
            <button class="tiny hov tgt" data-g-act="target" title="${target === g.id ? "Target gallery (B adds to it) — click to clear" : "Make this the target gallery (B adds to it)"}">&#9673;</button>
            <button class="tiny hov" data-g-act="rename" title="Rename">&#9998;</button><button class="tiny hov" data-g-act="delete" title="Delete gallery">&times;</button>
            <span class="n">${fmt(gCounts.get(g.id) || 0)}</span>
          </li>`
        )
        .join("") + `<li class="new-gallery" data-new-gallery="1" title="Click to create, or drop images here to create a gallery with them">+ New gallery</li>`;
  }

  // --------------------------------------------------------- top bar

  function renderTabs() {
    const tabs = [["library", "Library", "L"], ...enabledModules().map((m) => [m.id, m.title, (m.key || "").toUpperCase()])];
    $("tabs").innerHTML = tabs
      .map(([id, title, key]) => `<button data-view="${id}" class="${state.view === id ? "on" : ""}" title="${esc(title)}${key ? " (" + key + ")" : ""}">${esc(title)}</button>`)
      .join("");
  }

  function renderStats() {
    const c = counts();
    const pct = (n) => (c.total ? (100 * n) / c.total : 0);
    $("stats").innerHTML = c.total
      ? `<div class="progress" title="${pct(c.rated).toFixed(1)}% rated">
           <i class="yes" style="width:${pct(c.yes)}%"></i><i class="maybe" style="width:${pct(c.maybe)}%"></i><i class="no" style="width:${pct(c.no)}%"></i>
         </div>
         <span><b>${fmt(c.rated)}</b> of ${fmt(c.total)} rated</span>
         <span class="chip yes" title="Yes">&#10003; ${fmt(c.yes)}</span>
         <span class="chip maybe" title="Maybe">? ${fmt(c.maybe)}</span>
         <span class="chip no" title="No">&#10005; ${fmt(c.no)}</span>`
      : "";
  }

  const offlineRoots = () => state.roots.filter((r) => !r.virtual && !source.isConnected(r.id));

  function renderSourceStatus() {
    const el = $("source-status");
    const off = offlineRoots();
    if (state.scanning.size) el.innerHTML = `<span class="muted">Scanning ${esc([...state.scanning].join(", "))}&hellip;</span>`;
    else if (off.length) el.innerHTML = `<button class="primary" id="reconnect-btn">Reconnect ${off.length === 1 ? "“" + esc(off[0].name) + "”" : off.length + " folders"}</button>`;
    else if (state.roots.length) {
      const n = state.roots.filter((r) => !r.virtual).length;
      el.innerHTML = `<span class="conn" title="Connected (read-only)">&#9679; ${n === 1 ? esc(state.roots.find((r) => !r.virtual).name) : n + " folders"}</span>`;
    } else el.innerHTML = "";
    const rb = $("reconnect-btn");
    if (rb) rb.onclick = reconnectAll;
    document.body.classList.toggle("no-roots", !state.roots.length);
  }

  // ------------------------------------------------------------ views

  function showView(view) {
    if (!state.roots.length) view = "welcome";
    else if (view !== "library" && !enabledModules().some((m) => m.id === view)) view = "library";
    state.view = view;
    if (view !== "welcome") {
      state.settings.view = view;
      saveSettings();
    }
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + view));
    renderTabs();
    if (view === "library") rebuildLibrary();
    const m = activeModule();
    if (m && m.show) m.show();
  }

  // ---------------------------------------------------------- library

  const FILTERS = [
    ["all", "All", "total", ""],
    ["unrated", "Unrated", "unrated", ""],
    ["yes", "&#10003;", "yes", "Yes"],
    ["maybe", "?", "maybe", "Maybe"],
    ["no", "&#10005;", "no", "No"],
    ["notes", "&#9998;", "notes", "With notes"],
  ];

  function renderFilterBar() {
    const c = counts();
    const f = state.settings.filter;
    $("lib-filter").innerHTML = FILTERS.map(
      ([k, label, ck, title]) =>
        `<button class="${k} ${f === k ? "on" : ""}" data-filter="${k}" title="${title || label}">${label} <span class="n">${fmt(c[ck])}</span></button>`
    ).join("");
  }

  function renderLibTitle() {
    $("lib-title").textContent = srcLabel();
  }

  function libraryItems() {
    const f = state.settings.filter;
    let keys = srcKeys();
    if (f !== "all") {
      keys = keys.filter((k) => {
        const r = state.records.get(k);
        if (f === "unrated") return !r || !r.rating;
        if (f === "notes") return r && (r.notes || "").trim();
        return r && r.rating === f;
      });
    }
    const q = state.lib.search.trim().toLowerCase();
    if (q)
      keys = keys.filter((k) => {
        if (k.toLowerCase().includes(q)) return true;
        const r = state.records.get(k);
        return r && (r.notes || "").toLowerCase().includes(q);
      });
    const sort = state.settings.sort;
    if (sort === "path-desc") keys = keys.slice().reverse();
    else if (sort === "recent") {
      const t = (k) => (state.records.get(k) || {}).reviewedAt || 0;
      keys = keys.slice().sort((a, b) => t(b) - t(a));
    } else if (sort === "shuffle") {
      // Stable until the source changes, so rating in place doesn't reshuffle.
      if (!state.lib.shuffled) {
        state.lib.shuffled = new Map();
        sample(state.all, state.all.length).forEach((k, i) => state.lib.shuffled.set(k, i));
      }
      const order = state.lib.shuffled;
      keys = keys.slice().sort((a, b) => order.get(a) - order.get(b));
    }
    return keys;
  }

  // The grid is virtualized: only the rows in (or near) view exist as DOM
  // nodes, absolutely positioned inside a spacer as tall as the whole grid.
  // That's what keeps 100k-image folders as fast as 100-image ones.
  const GRID_GAP = 8;
  const GRID_PAD = 12; // matches .grid padding-top in styles.css
  const OVERSCAN = 3; // rows rendered above/below the viewport
  const grid = { cols: 1, size: 0, cells: new Map() }; // cells: index -> element

  function rebuildLibrary(keepScroll) {
    const items = libraryItems();
    state.lib.items = items;
    const keep = new Set(items);
    for (const p of [...state.lib.selected]) if (!keep.has(p)) state.lib.selected.delete(p);
    state.lib.anchor = -1;
    applyThumbFit();
    clearCells();
    if (!keepScroll) $("grid").scrollTop = 0;
    layoutGrid(true);
    $("lib-count").textContent = plural(items.length, "image");
    const empty = $("lib-empty");
    empty.hidden = items.length > 0;
    const s = state.settings.src;
    empty.innerHTML =
      s.type === "gallery" && !srcKeys().length
        ? "This gallery is empty. Select images (Ctrl/⌘-click) and drag them onto it, or set it as the target and press B."
        : state.lib.search
          ? "Nothing matches that search."
          : state.settings.filter !== "all"
            ? "Nothing here with this filter."
            : "No images in this folder.";
    renderLibTitle();
    renderFilterBar();
    renderSelectBar();
  }

  function clearCells() {
    for (const cell of grid.cells.values()) images.cancel(cell.dataset.path);
    grid.cells.clear();
    $("grid-inner").innerHTML = "";
  }

  function layoutGrid(force) {
    const el = $("grid");
    const cs = getComputedStyle(el);
    const avail = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (avail <= 0) return; // hidden view
    const min = state.settings.thumbSize;
    const cols = Math.max(1, Math.floor((avail + GRID_GAP) / (min + GRID_GAP)));
    const size = Math.floor((avail - GRID_GAP * (cols - 1)) / cols);
    if (!force && cols === grid.cols && size === grid.size) return;
    // Keep the first visible row's images in view across the re-layout.
    const firstVisible = grid.size && !force ? Math.floor(Math.max(0, el.scrollTop - GRID_PAD) / (grid.size + GRID_GAP)) * grid.cols : -1;
    const changedGeom = cols !== grid.cols || size !== grid.size;
    grid.cols = cols;
    grid.size = size;
    const rows = Math.ceil(state.lib.items.length / cols);
    $("grid-inner").style.height = Math.max(0, rows * (size + GRID_GAP) - GRID_GAP) + "px";
    if (changedGeom) clearCells();
    if (firstVisible >= 0) el.scrollTop = Math.floor(firstVisible / cols) * (size + GRID_GAP);
    renderVisible();
  }

  function renderVisible() {
    const el = $("grid");
    const { cols, size, cells } = grid;
    if (!size) return;
    const step = size + GRID_GAP;
    const n = state.lib.items.length;
    const top = Math.max(0, el.scrollTop - GRID_PAD);
    const firstRow = Math.max(0, Math.floor(top / step) - OVERSCAN);
    const lastRow = Math.floor((top + el.clientHeight) / step) + OVERSCAN;
    const lo = firstRow * cols;
    const hi = Math.min(n, (lastRow + 1) * cols);
    for (const [i, cell] of cells) {
      if (i < lo || i >= hi) {
        images.cancel(cell.dataset.path);
        cell.remove();
        cells.delete(i);
      }
    }
    const inner = $("grid-inner");
    const frag = document.createDocumentFragment();
    for (let i = lo; i < hi; i++) {
      if (cells.has(i)) continue;
      const p = state.lib.items[i];
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.draggable = true;
      cell.dataset.i = i;
      cell.dataset.path = p;
      cell.title = p;
      cell.style.cssText = `left:${(i % cols) * step}px;top:${Math.floor(i / cols) * step}px;width:${size}px;height:${size}px`;
      cell.innerHTML = `<img draggable="false" alt="" /><span class="badge"></span><span class="note-dot" title="Has notes">&#9998;</span>`;
      decorateCell(cell);
      setThumb(cell.firstChild, p, cell);
      cells.set(i, cell);
      frag.appendChild(cell);
    }
    inner.appendChild(frag);
  }

  let scrollRaf = 0;
  function onGridScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      renderVisible();
    });
  }

  function scrollToItem(i) {
    const el = $("grid");
    const step = grid.size + GRID_GAP;
    el.scrollTop = Math.max(0, Math.floor(i / grid.cols) * step - el.clientHeight / 3);
    renderVisible();
  }

  function decorateCell(cell) {
    const r = record(cell.dataset.path) || {};
    cell.classList.remove("yes", "maybe", "no");
    if (r.rating) cell.classList.add(r.rating);
    cell.classList.toggle("has-notes", !!(r.notes || "").trim());
    cell.classList.toggle("selected", state.lib.selected.has(cell.dataset.path));
  }
  const decorateAll = () => grid.cells.forEach(decorateCell);

  function updateCell(path) {
    if (state.view !== "library") return;
    const cell = $("grid-inner").querySelector(`.cell[data-path="${CSS.escape(path)}"]`);
    if (cell) decorateCell(cell);
  }

  function renderSelectBar() {
    const sel = state.lib.selected;
    const s = state.settings.src;
    const inGallery = s.type === "gallery" ? s.id : null;
    $("select-bar").classList.toggle("show", sel.size > 0);
    $("select-count").textContent = `${fmt(sel.size)} selected`;
    const pick = inGallery || state.settings.targetGallery;
    $("select-gallery").innerHTML =
      state.galleries.map((g) => `<option value="${esc(g.id)}" ${g.id === pick ? "selected" : ""}>${esc(g.name)}</option>`).join("") +
      `<option value="__new">+ New gallery&hellip;</option>`;
    $("select-remove").hidden = !inGallery;
  }

  function selectCell(i, e) {
    const sel = state.lib.selected;
    const items = state.lib.items;
    if (e.shiftKey && state.lib.anchor >= 0) {
      const [a, b] = [Math.min(state.lib.anchor, i), Math.max(state.lib.anchor, i)];
      for (let k = a; k <= b; k++) sel.add(items[k]);
    } else {
      const p = items[i];
      if (sel.has(p)) sel.delete(p);
      else sel.add(p);
      state.lib.anchor = i;
    }
    decorateAll();
    renderSelectBar();
  }

  function clearSelection() {
    state.lib.selected.clear();
    decorateAll();
    renderSelectBar();
  }

  function setThumbSize(px) {
    px = Math.max(80, Math.min(520, px));
    state.settings.thumbSize = px;
    $("thumb-size").value = px;
    layoutGrid();
    saveSettings();
  }

  function applyThumbFit() {
    const fit = state.settings.thumbFit === "contain";
    $("grid").classList.toggle("fit", fit);
    const b = $("fit-btn");
    b.textContent = fit ? "Fit" : "Crop";
    b.title = fit ? "Showing whole images — click to crop thumbnails to fill squares" : "Showing cropped squares — click to show whole images";
  }

  // Jump from any image (e.g. one in a gallery) to its folder in the library.
  function showInFolder(path) {
    const dir = dirname(path);
    if (state.lb.open) closeLightbox();
    const segs = dir.split("/");
    for (let i = 1; i < segs.length; i++) toggleExpanded(segs.slice(0, i).join("/"), true);
    state.settings.filter = "all";
    state.lib.search = "";
    $("lib-search").value = "";
    if (state.view !== "library") {
      state.settings.src = { type: "folder", path: dir };
      state.srcKeys = null;
      showView("library");
      renderSidebar();
      renderStats();
      emit("onSource");
    } else setSource({ type: "folder", path: dir });
    const i = state.lib.items.indexOf(path);
    if (i < 0) return;
    state.lib.selected = new Set([path]);
    state.lib.anchor = i;
    scrollToItem(i);
    decorateAll();
    renderSelectBar();
  }

  // --------------------------------------------------------- lightbox

  function openLightbox(items, index) {
    if (!items.length) return;
    const lb = state.lb;
    lb.items = items.slice();
    lb.index = Math.max(0, Math.min(index, items.length - 1));
    lb.open = true;
    $("lightbox").classList.add("open");
    renderLightbox();
  }

  function closeLightbox() {
    state.lb.open = false;
    $("lightbox").classList.remove("open");
    if (document.fullscreenElement === $("lightbox")) document.exitFullscreen();
    details.render($("lb-details"), null);
    const m = activeModule();
    if (m && m.show) m.show();
  }

  let lbToken = 0;
  function renderLightbox() {
    const { items, index } = state.lb;
    const path = items[index];
    const img = $("lb-img");
    const t = ++lbToken;
    setZoom(false);
    img.removeAttribute("src");
    // Show the cached thumbnail instantly, then swap in the full-size file.
    images.thumb(path).then((u) => {
      if (t === lbToken && u && !img.dataset.full) img.src = u;
    });
    img.dataset.full = "";
    images
      .fullUrl(path)
      .then((u) => {
        if (t !== lbToken) return;
        img.dataset.full = "1";
        img.src = u;
      })
      .catch(() => {});
    renderLbPos();
    if (state.settings.detailsOpen) details.render($("lb-details"), path);
    images.preload([items[index + 1], items[index - 1]].filter(Boolean));
  }

  function renderLbPos() {
    const { items, index } = state.lb;
    const path = items[index];
    const r = (record(path) || {}).rating || "";
    $("lb-pos").innerHTML = `${fmt(index + 1)} / ${fmt(items.length)} &nbsp; <span class="chip ${r}">${r || "unrated"}</span> &nbsp;<span class="muted">${esc(path)}</span>`;
    $("lightbox").dataset.rating = r;
  }

  function lbStep(d) {
    const lb = state.lb;
    const n = lb.index + d;
    if (n < 0 || n >= lb.items.length) return;
    lb.index = n;
    renderLightbox();
  }

  function setZoom(on, e) {
    const stage = $("lb-stage");
    const img = $("lb-img");
    let fx = 0.5;
    let fy = 0.5;
    if (on && e) {
      const r = img.getBoundingClientRect();
      fx = (e.clientX - r.left) / r.width;
      fy = (e.clientY - r.top) / r.height;
    }
    state.lb.zoom = on;
    stage.classList.toggle("zoom", on);
    if (on) {
      stage.scrollLeft = fx * img.naturalWidth - stage.clientWidth / 2;
      stage.scrollTop = fy * img.naturalHeight - stage.clientHeight / 2;
    }
  }

  // ------------------------------------------------------- shared UI

  function toggleDetails(force) {
    const open = force === undefined ? !state.settings.detailsOpen : force;
    state.settings.detailsOpen = open;
    saveSettings();
    document.body.classList.toggle("details-open", open);
    if (open && state.lb.open) details.render($("lb-details"), state.lb.items[state.lb.index]);
    emit("onDetails", open);
  }

  function toggleFullscreen() {
    const el = state.lb.open ? $("lightbox") : document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen();
    else if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  }

  // ---------------------------------------------------- folder access

  function showScan(on, text) {
    $("scan-overlay").classList.toggle("show", on);
    if (text) $("scan-text").textContent = text;
  }

  function uniqueRootId(name) {
    const base = name.replace(/\//g, "_") || "folder";
    let id = base;
    for (let n = 2; rootById(id) || id === ORPHAN; n++) id = `${base} (${n})`;
    return id;
  }

  async function saveFiles(id, rels) {
    state.files.set(id, rels);
    await store.put("kv", rels, "files:" + id);
  }

  // After every structural change to the file lists.
  function indexChanged(keepScroll) {
    rebuildIndex();
    renderSidebar();
    renderStats();
    renderSourceStatus();
    if (state.view === "welcome" || state.view === null) showView(state.settings.view);
    else if (state.view === "library") rebuildLibrary(keepScroll);
    emit("onFiles");
  }

  async function applyScan(id, rels) {
    const before = new Set(state.files.get(id) || []);
    const hadFiles = before.size > 0;
    let added = 0;
    for (const p of rels) if (!before.has(p)) added++;
    await saveFiles(id, rels);
    const adopted = await adoptOrphans(id);
    indexChanged(true);
    const name = (rootById(id) || {}).name || id;
    if (hadFiles && added) toast(`${plural(added, "new image")} in “${name}”`);
    else if (!hadFiles) toast(`${plural(rels.length, "image")} found in “${name}”` + (adopted ? ` — reattached ${fmt(adopted)} from earlier` : ""));
    else if (adopted) toast(`Reattached ${plural(adopted, "image")}'s ratings and notes from earlier`);
  }

  async function scanRoot(id, blocking) {
    if (state.scanning.has(id)) return;
    state.scanning.add(id);
    renderSourceStatus();
    renderTree();
    if (blocking) showScan(true, "Scanning…");
    try {
      const rels = await source.scan(id, (n, dir) => {
        if (blocking) $("scan-text").textContent = `Scanning… ${fmt(n)} images${dir ? " — " + dir : ""}`;
      });
      state.scanning.delete(id);
      await applyScan(id, rels);
    } catch (e) {
      console.error(e);
      toast("Scan failed: " + e.message);
    } finally {
      state.scanning.delete(id);
      showScan(false);
      renderSourceStatus();
      renderTree();
    }
  }

  async function addRoot(name, handle) {
    const id = uniqueRootId(name);
    const root = { id, name: id, handle: handle || null, rootPath: "", added: Date.now() };
    state.roots.push(root);
    await store.put("roots", root).catch(async (e) => {
      console.warn("Couldn't persist folder handle", e);
      await store.put("roots", { ...root, handle: null });
    });
    return root;
  }

  // Picking a folder that's already in the library reconnects it instead.
  async function matchRoot(name, handle) {
    for (const r of state.roots) {
      if (r.virtual) continue;
      if (handle && r.handle) {
        try {
          if (await r.handle.isSameEntry(handle)) return r;
        } catch (e) {
          /* stale handle */
        }
      }
    }
    const byName = state.roots.find((r) => !r.virtual && r.name === name && !source.isConnected(r.id));
    if (
      byName &&
      confirm(
        `Is this the same “${name}” folder you added before (moved, or re-picked)?\n\nOK — reconnect it, keeping its ratings, notes and galleries.\nCancel — add it as a separate folder.`
      )
    )
      return byName;
    return null;
  }

  let pendingReconnect = null; // root id the dir-input fallback is reconnecting

  async function addFolder() {
    if (!source.supportsHandles) {
      pendingReconnect = null;
      return $("dir-input").click();
    }
    let h;
    try {
      h = await window.showDirectoryPicker({ id: "archive-curator", mode: "read" });
    } catch (e) {
      return; // cancelled
    }
    let root = await matchRoot(h.name, h);
    if (root) {
      root.handle = h;
      store.put("roots", root).catch(() => {});
    } else root = await addRoot(h.name, h);
    source.useHandle(root.id, h);
    renderSourceStatus();
    await scanRoot(root.id, true);
    setSource({ type: "folder", path: root.id });
    if (state.view !== "library") showView("library");
  }

  async function onDirInput(e) {
    const list = e.target.files;
    if (!list || !list.length) return;
    showScan(true, `Reading ${fmt(list.length)} files…`);
    await new Promise((r) => setTimeout(r, 30));
    const { name, map } = source.readFileList(list);
    e.target.value = "";
    let root = pendingReconnect ? rootById(pendingReconnect) : await matchRoot(name, null);
    pendingReconnect = null;
    if (!root) root = await addRoot(name, null);
    source.useFileMap(root.id, map);
    showScan(false);
    await scanRoot(root.id, false);
    setSource({ type: "folder", path: root.id });
  }

  async function reconnect(id) {
    const root = rootById(id);
    if (!root || root.virtual) return;
    if (!root.handle) {
      pendingReconnect = id;
      return $("dir-input").click();
    }
    try {
      if (await source.hasPermission(root.handle, true)) {
        source.useHandle(id, root.handle);
        renderSourceStatus();
        renderTree();
        afterConnect();
        scanRoot(id, false);
        return true;
      }
      toast(`Permission denied for “${root.name}”`);
    } catch (e) {
      console.warn(e);
      toast(`Couldn't reconnect “${root.name}” — try adding it again`);
    }
    return false;
  }

  // One click, every folder. Browsers may only allow one permission prompt
  // per click; if so, the rest stay offline with a Reconnect button each.
  async function reconnectAll() {
    for (const r of offlineRoots()) {
      if (!r.handle) continue;
      try {
        if (await source.hasPermission(r.handle, true)) source.useHandle(r.id, r.handle);
      } catch (e) {
        toast("Click Reconnect on each remaining folder in the sidebar");
        break;
      }
    }
    const off = offlineRoots();
    if (off.length === 1 && !off[0].handle) reconnect(off[0].id);
    renderSourceStatus();
    renderTree();
    afterConnect();
    for (const r of state.roots) if (source.isConnected(r.id)) scanRoot(r.id, false);
  }

  function afterConnect() {
    if (state.view === "library") rebuildLibrary(true);
    emit("onFiles");
  }

  async function removeRoot(id) {
    const root = rootById(id);
    if (!root) return;
    const msg = root.virtual
      ? "Forget these unattached ratings, notes and thumbnails for good?"
      : `Remove “${root.name}” from the library?\n\nThe folder itself is untouched. Its ratings, notes and gallery entries are kept and come back if you add it again.`;
    if (!confirm(msg)) return;
    state.roots = state.roots.filter((r) => r !== root);
    state.files.delete(id);
    source.disconnect(id);
    await store.del("roots", id);
    await store.del("kv", "files:" + id);
    const pre = id + "/";
    const thumbKeys = (await store.keys("thumbs")).filter((k) => k.startsWith(pre));
    images.forget(thumbKeys);
    await store.delMany("thumbs", thumbKeys);
    if (root.virtual) {
      const dead = [...state.records.keys()].filter((k) => k.startsWith(pre));
      dead.forEach((k) => state.records.delete(k));
      await store.delMany("records", dead);
      galleryChanged();
    }
    if (state.settings.src.type === "folder" && (state.settings.src.path + "/").startsWith(pre)) state.settings.src = { type: "folder", path: "" };
    indexChanged();
    if (!state.roots.length) showView("welcome");
    if ($("settings").open) renderSettingsFolders();
  }

  // ------------------------------------------- migration & orphan reattach

  // v1 kept one folder, and keyed everything by path relative to it. Move it
  // all under that folder's root id; whatever doesn't belong to the current
  // file list came from an earlier folder and goes to the ORPHAN pseudo-
  // folder until that folder is re-added. Re-runnable if interrupted: records
  // are rebuilt from a backup taken first.
  async function migrateV1() {
    if ((await store.get("kv", "schema")) >= 2) return;
    const [files, rootName, handle] = await Promise.all([
      store.get("kv", "files"),
      store.get("kv", "rootName"),
      store.get("kv", "rootHandle").catch(() => null),
    ]);
    let backup = await store.get("kv", "v1-backup");
    if (!backup && (files || rootName)) {
      backup = { records: await store.getAll("records"), files: files || [], rootName: rootName || "", savedAt: Date.now() };
      await store.put("kv", backup, "v1-backup");
    }
    if (backup) {
      const name = (backup.rootName || "folder").replace(/\//g, "_");
      const fileSet = new Set(backup.files);
      const orphans = new Set();
      if (!(await store.get("roots", name))) {
        const root = { id: name, name, handle: handle || null, rootPath: state.settings.rootPath || "", added: Date.now() };
        await store.put("roots", root).catch(() => store.put("roots", { ...root, handle: null }));
      }
      await store.put("kv", backup.files, "files:" + name);
      const recs = backup.records.map((r) => {
        const id = fileSet.has(r.path) ? name : ORPHAN;
        if (id === ORPHAN) orphans.add(r.path);
        return { ...r, path: id + "/" + r.path };
      });
      await store.replaceAll("records", recs);
      const pairs = [];
      for (const k of await store.keys("thumbs")) {
        if (fileSet.has(k)) pairs.push([k, name + "/" + k]);
        else if (k.startsWith(name + "/") || k.startsWith(ORPHAN + "/")) continue; // already moved
        else {
          orphans.add(k);
          pairs.push([k, ORPHAN + "/" + k]);
        }
      }
      await store.rekey("thumbs", pairs);
      if (orphans.size) await store.put("kv", [...orphans].sort(C.collator.compare), "files:" + ORPHAN);
    }
    delete state.settings.rootPath;
    delete state.settings.libFilter;
    if (state.settings.libSort) state.settings.sort = state.settings.libSort === "recent" ? "recent" : state.settings.libSort;
    delete state.settings.libSort;
    await store.put("kv", state.settings, "settings");
    await store.delMany("kv", ["files", "rootName", "rootHandle"]);
    await store.put("kv", 2, "schema");
  }

  function orphanRoot() {
    return { id: ORPHAN, name: "Unattached", virtual: true, handle: null, rootPath: "", added: 0 };
  }

  // Move ORPHAN images whose relative path exists in root `id` under it.
  async function adoptOrphans(id) {
    const orphans = state.files.get(ORPHAN);
    if (!orphans || !orphans.length || id === ORPHAN) return 0;
    const rels = new Set(state.files.get(id));
    const moved = orphans.filter((r) => rels.has(r));
    if (!moved.length) return 0;
    const puts = [];
    const dels = [];
    for (const rel of moved) {
      const from = ORPHAN + "/" + rel;
      const to = id + "/" + rel;
      const r = state.records.get(from);
      if (!r) continue;
      state.records.delete(from);
      dels.push(from);
      if (!state.records.has(to)) {
        r.path = to;
        state.records.set(to, r);
        puts.push(r);
      }
    }
    await store.delMany("records", dels);
    await store.putMany("records", puts);
    const pairs = moved.map((rel) => [ORPHAN + "/" + rel, id + "/" + rel]);
    images.forget(pairs.map((p) => p[0]));
    await store.rekey("thumbs", pairs);
    const left = orphans.filter((r) => !rels.has(r));
    if (left.length) await saveFiles(ORPHAN, left);
    else {
      state.files.delete(ORPHAN);
      state.roots = state.roots.filter((r) => r.id !== ORPHAN);
      await store.del("kv", "files:" + ORPHAN);
    }
    return dels.length;
  }

  // ------------------------------------------------------ import/export

  function exportData() {
    const data = {
      app: "archive-curator",
      version: 2,
      exportedAt: new Date().toISOString(),
      roots: state.roots.filter((r) => !r.virtual).map(({ id, name, rootPath, added }) => ({ id, name, rootPath, added })),
      galleries: state.galleries,
      records: [...state.records.values()],
    };
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `archive-curator-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function importData(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (e) {
      return toast("Not a valid JSON file");
    }
    if (!data || data.app !== "archive-curator") return toast("Not an Archive Curator export");
    // v1 exports had paths relative to a single folder.
    const prefix = data.version === 1 ? (rootById(data.rootName) ? data.rootName : ORPHAN) + "/" : "";
    for (const g of data.galleries || []) {
      if (!gallery(g.id)) {
        state.galleries.push(g);
        store.put("galleries", g);
      }
    }
    for (const r of data.roots || []) {
      const mine = rootById(r.id);
      if (mine && !mine.rootPath && r.rootPath) {
        mine.rootPath = r.rootPath;
        store.put("roots", mine);
      }
    }
    const changedRecs = [];
    for (const inc of data.records || []) {
      const path = prefix + inc.path;
      const cur = state.records.get(path);
      if (!cur) {
        const r = { path, rating: inc.rating || null, reviewedAt: inc.reviewedAt || null, notes: inc.notes || "", galleries: inc.galleries || [] };
        state.records.set(path, r);
        changedRecs.push(r);
        continue;
      }
      if (inc.rating && (inc.reviewedAt || 0) > (cur.reviewedAt || 0)) {
        cur.rating = inc.rating;
        cur.reviewedAt = inc.reviewedAt;
      }
      if (inc.notes && !(cur.notes || "").includes(inc.notes)) cur.notes = cur.notes ? cur.notes + "\n\n" + inc.notes : inc.notes;
      cur.galleries = [...new Set([...cur.galleries, ...(inc.galleries || [])])];
      changedRecs.push(cur);
    }
    await store.putMany("records", changedRecs);
    if (prefix === ORPHAN + "/") {
      const rels = new Set(state.files.get(ORPHAN) || []);
      for (const inc of data.records || []) rels.add(inc.path);
      await saveFiles(ORPHAN, [...rels].sort(C.collator.compare));
      if (!rootById(ORPHAN)) state.roots.push(orphanRoot());
    }
    toast(`Imported ${fmt(changedRecs.length)} records, ${fmt((data.galleries || []).length)} galleries`);
    state.srcKeys = null;
    indexChanged(true);
  }

  // ---------------------------------------------------------- settings

  function renderSettingsFolders() {
    $("set-folders").innerHTML =
      state.roots
        .map((r) => {
          const n = (state.files.get(r.id) || []).length;
          const conn = r.virtual ? "from an earlier session" : source.isConnected(r.id) ? "connected" : "not connected";
          return `<div class="folder-row" data-root="${esc(r.id)}">
            <div class="fr-head"><b>${esc(r.name)}</b> <span class="muted">${plural(n, "image")} · ${conn}</span>
              <span class="spacer"></span>
              ${r.virtual ? "" : source.isConnected(r.id) ? `<button type="button" class="tiny" data-f-act="rescan">Rescan</button>` : `<button type="button" class="tiny" data-f-act="reconnect">Reconnect</button>`}
              <button type="button" class="tiny" data-f-act="remove">${r.virtual ? "Forget" : "Remove"}</button>
            </div>
            ${r.virtual ? "" : `<input type="text" data-f-act="path" placeholder="Full path on disk, e.g. D:\\ComfyUI\\output" value="${esc(r.rootPath || "")}" />`}
          </div>`;
        })
        .join("") || `<p class="muted">No folders yet.</p>`;
  }

  function renderSettingsModules() {
    const el = $("set-modules");
    el.innerHTML = modules.length
      ? modules
          .map(
            (m) => `<div class="module-row" data-module="${esc(m.id)}">
              <label class="check"><input type="checkbox" ${moduleEnabled(m) ? "checked" : ""} /> <b>${esc(m.title)}</b> <span class="muted">— ${esc(m.description || "")}</span></label>
              <div class="module-settings"></div>
            </div>`
          )
          .join("")
      : `<p class="muted">No modules installed.</p>`;
    modules.forEach((m) => {
      const box = el.querySelector(`[data-module="${CSS.escape(m.id)}"] .module-settings`);
      if (m.settings && moduleEnabled(m)) m.settings(box);
    });
  }

  function openSettings() {
    renderSettingsFolders();
    renderSettingsModules();
    $("settings").showModal();
  }

  // -------------------------------------------------------------- keys

  function onKey(e) {
    if (e.target.closest && e.target.closest("input, textarea, select")) {
      if (e.key === "Escape") e.target.blur();
      return;
    }
    if ($("settings").open || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (e.ctrlKey || e.metaKey) {
      if (k === "a" && state.view === "library" && !state.lb.open) {
        e.preventDefault();
        state.lib.items.forEach((p) => state.lib.selected.add(p));
        decorateAll();
        renderSelectBar();
      }
      return;
    }
    const rateKeys = { y: "yes", p: "yes", m: "maybe", n: "no", x: "no", 0: null, u: null };

    if (state.lb.open) {
      const path = state.lb.items[state.lb.index];
      if (k === "ArrowRight") lbStep(1);
      else if (k === "ArrowLeft") lbStep(-1);
      else if (k === "Home") ((state.lb.index = 0), renderLightbox());
      else if (k === "End") ((state.lb.index = state.lb.items.length - 1), renderLightbox());
      else if (k === "Escape" || k === "Enter") closeLightbox();
      else if (k === " ") setZoom(!state.lb.zoom);
      else if (k in rateKeys) setRating(path, rateKeys[k]);
      else if (k === "i") toggleDetails();
      else if (k === "f") toggleFullscreen();
      else if (k === "b") targetToggle();
      else return;
      e.preventDefault();
      return;
    }

    if (state.view === "welcome") return;
    if (k === "i") return toggleDetails();
    if (k === "f") return toggleFullscreen();
    if (k === "b") return targetToggle();
    if (k === "l") return showView("library");
    const tab = enabledModules().find((m) => m.key && m.key === k);
    if (tab) return showView(tab.id);

    const m = activeModule();
    if (m) {
      if (m.onKey && m.onKey(e, k)) e.preventDefault();
    } else if (state.view === "library") {
      if (k === "+" || k === "=") setThumbSize(state.settings.thumbSize + 40);
      else if (k === "-") setThumbSize(state.settings.thumbSize - 40);
      else if (k === "Escape") clearSelection();
      else return;
      e.preventDefault();
    }
  }

  // ------------------------------------------------------------- bind

  const DRAG_TYPE = "application/x-curator-paths";

  function bind() {
    $("tabs").onclick = (e) => {
      const b = e.target.closest("button[data-view]");
      if (b) showView(b.dataset.view);
    };
    $("settings-btn").onclick = openSettings;
    $("pick-btn").onclick = addFolder;
    $("add-folder-btn").onclick = addFolder;
    $("dir-input").onchange = onDirInput;
    $("browser-note").textContent = source.supportsHandles
      ? "Your browser remembers the folders; next time it's one click to reconnect."
      : "Tip: in Chrome or Edge folders are remembered between sessions. In this browser you'll re-pick them each visit (your ratings are kept either way).";

    // folder tree
    $("folder-tree").onclick = (e) => {
      const row = e.target.closest(".tree-row");
      if (!row) return;
      const path = row.dataset.folder;
      const act = e.target.closest("[data-t-act]");
      const a = act && act.dataset.tAct;
      if (a === "reconnect") return reconnect(path);
      if (a === "remove") return removeRoot(path);
      if (a === "toggle" && act.textContent) {
        toggleExpanded(path);
        return renderTree();
      }
      setSource({ type: "folder", path });
    };
    $("folder-tree").ondblclick = (e) => {
      const row = e.target.closest(".tree-row");
      if (!row || !row.dataset.folder || e.target.closest("[data-t-act]")) return;
      toggleExpanded(row.dataset.folder);
      renderTree();
    };

    // galleries
    const gl = $("gallery-list");
    gl.onclick = (e) => {
      if (e.target.closest("[data-new-gallery]")) return newGallery();
      const li = e.target.closest("li[data-gallery]");
      if (!li) return;
      const id = li.dataset.gallery;
      const act = e.target.closest("[data-g-act]");
      if (act) {
        const a = act.dataset.gAct;
        return a === "rename" ? renameGallery(id) : a === "target" ? setTarget(id) : deleteGallery(id);
      }
      setSource({ type: "gallery", id });
    };
    const dropTarget = (e) => e.target.closest("li[data-gallery], li[data-new-gallery]");
    gl.addEventListener("dragover", (e) => {
      const li = dropTarget(e);
      if (!li || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      gl.querySelectorAll(".drop").forEach((x) => x !== li && x.classList.remove("drop"));
      li.classList.add("drop");
    });
    gl.addEventListener("dragleave", (e) => {
      const li = dropTarget(e);
      if (li && !li.contains(e.relatedTarget)) li.classList.remove("drop");
    });
    gl.addEventListener("drop", (e) => {
      const li = dropTarget(e);
      if (!li) return;
      e.preventDefault();
      li.classList.remove("drop");
      const paths = JSON.parse(e.dataTransfer.getData(DRAG_TYPE) || "[]");
      if (!paths.length) return;
      if (li.dataset.newGallery) newGallery(paths);
      else addToGallery(paths, li.dataset.gallery);
      renderSelectBar();
    });

    // library
    $("lib-filter").onclick = (e) => {
      const b = e.target.closest("button[data-filter]");
      if (!b) return;
      state.settings.filter = b.dataset.filter;
      saveSettings();
      rebuildLibrary();
    };
    const gridEl = $("grid");
    gridEl.addEventListener("scroll", onGridScroll, { passive: true });
    gridEl.onclick = (e) => {
      const cell = e.target.closest(".cell");
      if (!cell) return;
      const i = +cell.dataset.i;
      if (e.ctrlKey || e.metaKey || e.shiftKey) selectCell(i, e);
      else openLightbox(state.lib.items, i);
    };
    gridEl.addEventListener("dragstart", (e) => {
      const cell = e.target.closest(".cell");
      if (!cell) return;
      const p = cell.dataset.path;
      const paths = state.lib.selected.has(p) ? [...state.lib.selected] : [p];
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(paths));
      e.dataTransfer.setData("text/plain", paths.map(fullPath).join("\n"));
      e.dataTransfer.effectAllowed = "copy";
    });
    gridEl.addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        setThumbSize(state.settings.thumbSize - Math.sign(e.deltaY) * 20);
      },
      { passive: false }
    );
    new ResizeObserver(() => layoutGrid()).observe(gridEl);
    let searchTimer = null;
    $("lib-search").oninput = (e) => {
      state.lib.search = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => rebuildLibrary(), 200);
    };
    $("lib-sort").value = state.settings.sort;
    $("lib-sort").onchange = (e) => {
      state.settings.sort = e.target.value;
      state.lib.shuffled = null;
      saveSettings();
      rebuildLibrary();
    };
    $("thumb-size").value = state.settings.thumbSize;
    $("thumb-size").oninput = (e) => setThumbSize(+e.target.value);
    $("fit-btn").onclick = () => {
      state.settings.thumbFit = state.settings.thumbFit === "contain" ? "cover" : "contain";
      saveSettings();
      applyThumbFit();
    };
    $("select-add").onclick = () => {
      const id = $("select-gallery").value;
      if (id === "__new") newGallery([...state.lib.selected]);
      else addToGallery([...state.lib.selected], id);
      renderSelectBar();
    };
    $("select-remove").onclick = () => {
      const s = state.settings.src;
      if (s.type !== "gallery") return;
      addToGallery([...state.lib.selected], s.id, true);
      state.lib.selected.clear();
      rebuildLibrary(true);
    };
    $("select-bar").addEventListener("click", (e) => {
      const b = e.target.closest("[data-rate]");
      if (!b) return;
      for (const p of state.lib.selected) setRating(p, b.dataset.rate);
      toast(`Marked ${fmt(state.lib.selected.size)} as ${b.dataset.rate}`);
    });
    $("select-clear").onclick = clearSelection;

    // lightbox
    $("lb-prev").onclick = () => lbStep(-1);
    $("lb-next").onclick = () => lbStep(1);
    $("lb-close").onclick = closeLightbox;
    $("lb-full").onclick = toggleFullscreen;
    $("lb-info").onclick = () => toggleDetails();
    $("lb-zoom").onclick = () => setZoom(!state.lb.zoom);
    $("lb-stage").onclick = (e) => {
      if (e.target.id === "lb-img") setZoom(!state.lb.zoom, e);
      else if (!state.lb.zoom) closeLightbox();
    };

    // settings
    $("set-add").onclick = () => {
      $("settings").close();
      addFolder();
    };
    $("set-folders").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-f-act]");
      if (!b) return;
      const id = b.closest("[data-root]").dataset.root;
      const a = b.dataset.fAct;
      if (a === "rescan") {
        $("settings").close();
        scanRoot(id, true);
      } else if (a === "reconnect") reconnect(id).then(renderSettingsFolders);
      else if (a === "remove") removeRoot(id);
    });
    $("set-folders").addEventListener("input", (e) => {
      if (e.target.dataset.fAct !== "path") return;
      const root = rootById(e.target.closest("[data-root]").dataset.root);
      root.rootPath = e.target.value.trim();
      store.put("roots", root);
    });
    $("set-modules").addEventListener("change", (e) => {
      const row = e.target.closest("[data-module]");
      if (!row || e.target.type !== "checkbox") return;
      state.settings.modules[row.dataset.module] = e.target.checked;
      saveSettings();
      renderSettingsModules();
      showView(state.view === "welcome" ? "welcome" : state.view);
    });
    $("set-export").onclick = exportData;
    $("set-import").onclick = () => $("import-input").click();
    $("import-input").onchange = (e) => {
      if (e.target.files[0]) importData(e.target.files[0]);
      e.target.value = "";
    };
    $("set-clear-thumbs").onclick = async () => {
      await images.clearThumbCache();
      toast("Thumbnail cache cleared");
      if (state.view === "library") rebuildLibrary(true);
    };

    document.addEventListener("keydown", onKey);
  }

  // -------------------------------------------------------------- init

  async function init() {
    Object.assign(state.settings, (await store.get("kv", "settings")) || {});
    state.settings.src = state.settings.src || { type: "folder", path: "" };
    await migrateV1();

    const [roots, recs, gals] = await Promise.all([store.getAll("roots"), store.getAll("records"), store.getAll("galleries")]);
    state.roots = roots.sort((a, b) => a.added - b.added);
    await Promise.all(state.roots.map(async (r) => state.files.set(r.id, (await store.get("kv", "files:" + r.id)) || [])));
    const orphans = await store.get("kv", "files:" + ORPHAN);
    if (orphans && orphans.length) {
      state.files.set(ORPHAN, orphans);
      state.roots.push(orphanRoot());
    }
    for (const r of recs) state.records.set(r.path, r);
    state.galleries = gals.sort((a, b) => a.created - b.created);
    document.body.classList.toggle("details-open", !!state.settings.detailsOpen);

    const api = {
      state,
      $,
      esc,
      fmt,
      plural,
      toast,
      record,
      setRating,
      srcKeys,
      srcLabel,
      sample,
      setThumb,
      openLightbox,
      toggleDetails,
      saveSettings,
      showView,
      isActive: (id) => state.view === id && !state.lb.open,
      views: $("views"),
    };
    for (const m of modules) if (m.init) m.init(api);

    bind();
    rebuildIndex();

    if (source.supportsHandles) {
      for (const r of state.roots) {
        if (!r.handle) continue;
        try {
          if (await source.hasPermission(r.handle, false)) source.useHandle(r.id, r.handle);
        } catch (e) {
          /* stale handle */
        }
      }
    }
    renderSidebar();
    renderStats();
    renderSourceStatus();
    showView(state.settings.view);
    // Pick up new images in the background, one folder at a time.
    for (const r of state.roots) if (source.isConnected(r.id)) await scanRoot(r.id, false);
  }

  C.app = {
    record,
    galleries: () => state.galleries,
    setRating,
    setNotes,
    toggleGallery,
    newGallery,
    copyPath,
    copyText,
    openOriginal,
    showInFolder,
    toggleDetails,
    state,
  };

  // Modules load after this file, so start once every script has run.
  document.addEventListener("DOMContentLoaded", () =>
    init().catch((e) => {
      console.error(e);
      document.body.insertAdjacentHTML("afterbegin", `<p class="fatal">Failed to start: ${esc(e.message)}</p>`);
    })
  );
})();
