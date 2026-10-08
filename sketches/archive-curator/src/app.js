// Core: folders, folder tree, library grid, galleries, search, lightbox,
// settings, keys — and the module host. Everything optional (flashcard
// review, and later things like people) is a module in src/modules/ that
// registers itself with Curator.registerModule() and gets its own tab.
//
// All state about images is metadata keyed by "<rootId>/<path>" — see
// store.js and source.js. Colour palettes and prompt text come from the
// background indexer in features.js.
(function () {
  const C = window.Curator;
  const { store, source, images, details, markdown, features } = C;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => markdown.esc(String(s));
  const fmt = (n) => n.toLocaleString();
  const RATINGS = ["yes", "maybe", "no"];
  const RATE_KEYS = { y: "yes", p: "yes", m: "maybe", n: "no", x: "no", 0: null, u: null };
  // Pseudo-folder for metadata from before multi-folder support whose
  // original folder hasn't been re-added yet. Re-adding it reattaches them.
  const ORPHAN = "~unattached";

  const DEFAULT_SETTINGS = {
    thumbSize: 200,
    thumbFit: "contain", // "contain" = whole image letterboxed, "cover" = cropped squares
    view: "library",
    src: { type: "folder", path: "" }, // what's being looked at: a folder (""=all) or a gallery
    filter: "all",
    sort: "path", // folders: path | path-desc | recent | shuffle
    gallerySort: "custom", // galleries: the same, plus custom (drag to arrange)
    groupFolders: false, // folder headers in the grid
    shuffleSeed: "",
    lastColor: null, // the colour picker's last { h, s, v, tol }
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
    galleries: [], // { id, name, created, group, pos, order[] }
    groups: [], // gallery groups: { id, name, pos, collapsed }
    view: null,
    lib: {
      search: "",
      items: [],
      groups: null, // [{ dir, start, end }] when folder headers are on
      hits: null, // key -> matched search fields
      match: null, // { type: "color", lab, hex, tol } | { type: "similar", key }
      matchSort: false, // sort by best match while a match is active
      scores: null,
      selected: new Set(),
      focus: null, // key of the "current" image (keyboard cursor, details panel)
    },
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

  // ------------------------------------------------------------ galleries

  const gallery = (id) => state.galleries.find((x) => x.id === id);
  const group = (id) => state.groups.find((x) => x.id === id);
  const plural = (n, w) => `${fmt(n)} ${w}${n === 1 ? "" : "s"}`;
  const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const saveGroups = () => store.put("kv", state.groups, "galleryGroups");

  function galleryChanged() {
    if (state.settings.src.type === "gallery") state.srcKeys = null;
    renderSidebar();
    refreshPanels();
  }

  // Keep a gallery's custom order in step with its members.
  function noteOrder(g, paths, remove) {
    const order = g.order || [];
    if (remove) {
      const drop = new Set(paths);
      g.order = order.filter((k) => !drop.has(k));
    } else {
      const have = new Set(order);
      g.order = order.concat(paths.filter((k) => !have.has(k)));
    }
    store.put("galleries", g);
  }

  function toggleGallery(path, id) {
    const r = ensureRecord(path);
    const has = r.galleries.includes(id);
    r.galleries = has ? r.galleries.filter((g) => g !== id) : [...r.galleries, id];
    saveRecord(r);
    if (gallery(id)) noteOrder(gallery(id), [path], has);
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
    if (g) noteOrder(g, paths, remove);
    toast(`${remove ? "Removed" : "Added"} ${plural(paths.length, "image")} ${remove ? "from" : "to"} “${g ? g.name : "gallery"}”`);
    galleryChanged();
    paths.forEach(updateCell);
  }

  // Optionally seeded with images (dropping a selection on "+ New gallery").
  function newGallery(paths) {
    const suggested = paths && paths.length ? suggestGalleryName(paths) : "";
    const name = (prompt(paths && paths.length ? `New gallery with ${plural(paths.length, "image")}:` : "New gallery name:", suggested) || "").trim();
    if (!name) return null;
    const g = { id: newId("g"), name, created: Date.now(), group: null, pos: topLevel().length, order: [] };
    state.galleries.push(g);
    store.put("galleries", g);
    if (paths && paths.length) addToGallery(paths, g.id);
    else galleryChanged();
    return g;
  }

  // Shared folder name of the paths, if any, as a starting point.
  function suggestGalleryName(paths) {
    const dirs = new Set(paths.map(dirname));
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

  // Top-level sidebar entries (ungrouped galleries and groups), in order.
  function topLevel() {
    return [...state.galleries.filter((g) => !g.group).map((g) => ({ kind: "g", item: g })), ...state.groups.map((gr) => ({ kind: "group", item: gr }))].sort(
      (a, b) => a.item.pos - b.item.pos
    );
  }
  const inGroup = (gid) => state.galleries.filter((g) => g.group === gid).sort((a, b) => a.pos - b.pos);

  function newGroup() {
    const name = (prompt("New gallery group:") || "").trim();
    if (!name) return;
    state.groups.push({ id: newId("grp"), name, pos: topLevel().length, collapsed: false });
    saveGroups();
    renderGalleries();
  }

  function renameGroup(id) {
    const gr = group(id);
    const name = gr && (prompt("Rename group:", gr.name) || "").trim();
    if (!name) return;
    gr.name = name;
    saveGroups();
    renderGalleries();
  }

  // The group goes; its galleries move to the top level.
  function deleteGroup(id) {
    const gr = group(id);
    if (!gr || !confirm(`Remove group “${gr.name}”? Its galleries move to the top level.`)) return;
    let pos = topLevel().length;
    for (const g of inGroup(id)) {
      g.group = null;
      g.pos = pos++;
      store.put("galleries", g);
    }
    state.groups = state.groups.filter((x) => x !== gr);
    saveGroups();
    renderGalleries();
  }

  // Move a gallery or group to `groupId` (null = top level), before `before`
  // (a gallery or group object; null = at the end). Renumbers positions.
  function placeEntity(kind, item, groupId, before) {
    if (kind === "group") groupId = null; // groups only nest one level
    const siblings = (groupId ? inGroup(groupId).map((g) => ({ kind: "g", item: g })) : topLevel()).filter((e) => e.item !== item);
    let at = before ? siblings.findIndex((e) => e.item === before) : -1;
    if (at < 0) at = siblings.length;
    siblings.splice(at, 0, { kind, item });
    if (kind === "g") item.group = groupId;
    siblings.forEach((e, i) => (e.item.pos = i));
    siblings.filter((e) => e.kind === "g").forEach((e) => store.put("galleries", e.item));
    saveGroups();
    renderGalleries();
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
    const id = state.settings.targetGallery;
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

  // Custom order: the saved order, then any members it doesn't know yet.
  function customOrder(g, keys) {
    const set = new Set(keys);
    const out = [];
    for (const k of g.order || []) if (set.delete(k)) out.push(k);
    return out.concat(keys.filter((k) => set.has(k)));
  }

  // Drag-to-arrange inside a gallery (switches it to custom order).
  function moveInGallery(id, moving, beforeKey) {
    const g = gallery(id);
    if (!g) return;
    const members = [];
    for (const r of state.records.values()) if (r.galleries.includes(id)) members.push(r.path);
    members.sort(C.collator.compare);
    // Start from what's on screen if it isn't custom yet, so the drop lands where it looks like it should.
    const base = effectiveSort() === "custom" ? customOrder(g, members) : state.lib.items.concat(customOrder(g, members).filter((k) => !state.lib.items.includes(k)));
    const mv = new Set(moving);
    const rest = base.filter((k) => !mv.has(k));
    let at = beforeKey ? rest.indexOf(beforeKey) : rest.length;
    if (at < 0) at = rest.length;
    rest.splice(at, 0, ...base.filter((k) => mv.has(k)));
    g.order = rest;
    store.put("galleries", g);
    state.lib.matchSort = false;
    if (state.settings.gallerySort !== "custom") {
      state.settings.gallerySort = "custom";
      saveSettings();
      toast("Switched this gallery to custom order");
    }
    rebuildLibrary(true);
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

  // cyrb53: a fast, well-mixed string hash. Shuffle order = hash(seed|key),
  // so a seed always reproduces the same order, whatever the filter.
  function hash(str) {
    let h1 = 0xdeadbeef ^ 0,
      h2 = 0x41c6ce57 ^ 0;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
  const randomSeed = () => Math.random().toString(36).slice(2, 7);

  function rgbToHsv(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    let h = 0;
    if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
  }

  // ------------------------------------------------- index & folder tree

  function rebuildIndex() {
    const all = [];
    for (const r of state.roots) for (const rel of state.files.get(r.id) || []) all.push(r.id + "/" + rel);
    state.all = all;
    state.srcKeys = null;
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
    state.lib.selected.clear();
    state.lib.focus = null;
    saveSettings();
    renderSidebar();
    renderStats();
    if (state.view === "library") rebuildLibrary();
    startIndexing();
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
    const li = (g, nested) => `<li draggable="true" class="${nested ? "nested" : ""} ${s.type === "gallery" && s.id === g.id ? "on" : ""} ${target === g.id ? "target" : ""}" data-gallery="${esc(g.id)}">
        <span class="gname">${esc(g.name)}</span>
        <button class="tiny hov tgt" data-g-act="target" title="${target === g.id ? "Target gallery (B adds to it) — click to clear" : "Make this the target gallery (B adds to it)"}">&#9673;</button>
        <button class="tiny hov" data-g-act="rename" title="Rename">&#9998;</button><button class="tiny hov" data-g-act="delete" title="Delete gallery">&times;</button>
        <span class="n">${fmt(gCounts.get(g.id) || 0)}</span>
      </li>`;
    const rows = [];
    for (const e of topLevel()) {
      if (e.kind === "g") {
        rows.push(li(e.item, false));
        continue;
      }
      const gr = e.item;
      const kids = inGroup(gr.id);
      rows.push(`<li draggable="true" class="gal-group" data-group="${esc(gr.id)}" title="Drag galleries here to file them">
          <span class="caret" data-gr-act="toggle">${gr.collapsed ? "&#9656;" : "&#9662;"}</span><span class="gname">${esc(gr.name)}</span>
          <button class="tiny hov" data-gr-act="rename" title="Rename group">&#9998;</button><button class="tiny hov" data-gr-act="delete" title="Remove group (keeps its galleries)">&times;</button>
          <span class="n">${kids.length}</span></li>`);
      if (!gr.collapsed) kids.forEach((g) => rows.push(li(g, true)));
    }
    rows.push(`<li class="new-gallery" data-new-gallery="1" title="Click to create, or drop images here to create a gallery with them">+ New gallery</li>`);
    $("gallery-list").innerHTML = rows.join("");
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

  function renderIndexStatus(st) {
    const el = $("index-status");
    el.hidden = !st.running;
    if (st.running) {
      el.textContent = `Indexing ${fmt(st.done)} / ${fmt(st.total)}`;
      el.title = "Working out colour palettes and reading prompts, in the background. Colour and prompt search cover what's indexed so far.";
    }
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

  // ------------------------------------------------------- search & match

  const FIELD_LABEL = { path: "path", notes: "notes", prompt: "prompt", model: "model" };
  const lcCache = new WeakMap(); // features entry -> lowercased text

  function searchTerms() {
    return state.lib.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  }

  function fieldsOf(k) {
    const r = state.records.get(k);
    const f = features.get(k);
    let lc = f && lcCache.get(f);
    if (f && !lc) lcCache.set(f, (lc = { prompt: (f.prompt || "").toLowerCase(), model: (f.model || "").toLowerCase() }));
    return [
      ["path", k.toLowerCase(), k],
      ["notes", ((r && r.notes) || "").toLowerCase(), (r && r.notes) || ""],
      ["prompt", lc ? lc.prompt : "", (f && f.prompt) || ""],
      ["model", lc ? lc.model : "", (f && f.model) || ""],
    ];
  }

  // Every term must appear somewhere; returns the fields that matched.
  function matchSearch(k, terms) {
    const fields = fieldsOf(k);
    const hit = new Set();
    for (const t of terms) {
      let found = false;
      for (const [name, lc] of fields) {
        if (lc.includes(t)) {
          hit.add(name);
          found = true;
        }
      }
      if (!found) return null;
    }
    return hit;
  }

  function setMatch(m) {
    state.lib.match = m;
    state.lib.matchSort = !!m;
    renderMatchChip();
    if (state.view === "library") rebuildLibrary();
  }

  function colorMatch(c) {
    state.settings.lastColor = { h: c.h, s: c.s, v: c.v, tol: c.tol };
    saveSettings();
    const m = { type: "color", lab: c.lab, hex: c.hex, tol: c.tol };
    // Keep the scroll position stable while dragging around the wheel.
    const was = state.lib.match && state.lib.match.type === "color";
    state.lib.match = m;
    if (!was) state.lib.matchSort = true;
    renderMatchChip();
    scheduleRebuild(was);
  }

  let rebuildTimer = 0;
  function scheduleRebuild(keepScroll) {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => state.view === "library" && rebuildLibrary(keepScroll), 120);
  }

  // From the details panel's palette swatches.
  function searchColor(lab) {
    const rgb = features.labToRgb(...lab);
    const hsv = rgbToHsv(...rgb);
    const tol = (state.settings.lastColor || {}).tol || 0.14;
    if (state.lb.open) closeLightbox();
    if (state.view !== "library") showView("library");
    colorMatch({ ...hsv, tol, lab, hex: C.colorPicker.hex(rgb) });
  }

  function findSimilar(key) {
    if (!features.get(key)) return toast("Still indexing this image — try again in a moment");
    if (state.lb.open) closeLightbox();
    if (state.view !== "library") showView("library");
    setMatch({ type: "similar", key });
  }

  function renderMatchChip() {
    const m = state.lib.match;
    const btn = $("color-btn");
    btn.classList.toggle("on", !!(m && m.type === "color"));
    btn.querySelector(".sw").style.background = m && m.type === "color" ? m.hex : "";
    const chip = $("match-chip");
    if (m && m.type === "similar") {
      chip.hidden = false;
      chip.innerHTML = `<img alt="" /> Similar colours <button class="tiny" data-clear-match title="Clear">&times;</button>`;
      images.thumb(m.key).then((u) => u && (chip.querySelector("img").src = u));
    } else if (m && m.type === "color") {
      chip.hidden = false;
      chip.innerHTML = `<span class="sw" style="background:${m.hex}"></span> Colour <button class="tiny" data-clear-match title="Clear">&times;</button>`;
    } else chip.hidden = true;
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

  const inGallerySrc = () => state.settings.src.type === "gallery";
  function baseSort() {
    if (inGallerySrc()) return state.settings.gallerySort;
    return state.settings.sort === "custom" ? "path" : state.settings.sort;
  }
  const effectiveSort = () => (state.lib.match && state.lib.matchSort ? "match" : baseSort());

  function renderSortBar() {
    const opts = [
      ["path", "Name / date"],
      ["path-desc", "Name / date, newest first"],
      ["recent", "Recently rated"],
      ["shuffle", "Shuffle"],
    ];
    if (inGallerySrc()) opts.unshift(["custom", "Custom order (drag)"]);
    if (state.lib.match) opts.unshift(["match", state.lib.match.type === "color" ? "Best colour match" : "Most similar"]);
    const eff = effectiveSort();
    $("lib-sort").innerHTML = opts.map(([v, l]) => `<option value="${v}" ${v === eff ? "selected" : ""}>${l}</option>`).join("");
    $("shuffle-ctl").hidden = eff !== "shuffle";
    $("shuffle-seed").value = state.settings.shuffleSeed;
    const gb = $("group-btn");
    gb.classList.toggle("on", state.settings.groupFolders);
    gb.disabled = eff === "custom";
    gb.title = eff === "custom" ? "Folder headers are off in custom order" : "Folder headers (G)";
  }

  function setSort(v) {
    if (v === "match") state.lib.matchSort = true;
    else {
      state.lib.matchSort = false;
      if (inGallerySrc()) state.settings.gallerySort = v;
      else state.settings.sort = v;
      if (v === "shuffle" && !state.settings.shuffleSeed) state.settings.shuffleSeed = randomSeed();
      saveSettings();
    }
    rebuildLibrary();
  }

  function reroll(seed) {
    state.settings.shuffleSeed = seed || randomSeed();
    state.lib.matchSort = false;
    if (inGallerySrc()) state.settings.gallerySort = "shuffle";
    else state.settings.sort = "shuffle";
    saveSettings();
    rebuildLibrary();
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
    const terms = searchTerms();
    state.lib.hits = null;
    if (terms.length) {
      const hits = new Map();
      keys = keys.filter((k) => {
        const h = matchSearch(k, terms);
        if (h) hits.set(k, h);
        return !!h;
      });
      state.lib.hits = hits;
    }
    const m = state.lib.match;
    state.lib.scores = null;
    if (m) {
      const scores = new Map();
      if (m.type === "color") {
        for (const k of keys) {
          const e = features.get(k);
          if (!e || !e.pal) continue;
          const s = features.colorScore(e.pal, m.lab, m.tol);
          if (s >= 0.08) scores.set(k, s);
        }
      } else {
        const ref = features.get(m.key);
        for (const k of keys) {
          const e = features.get(k);
          if (e && e.pal && ref) scores.set(k, -features.paletteDistance(ref.pal, e.pal));
        }
      }
      keys = keys.filter((k) => scores.has(k));
      state.lib.scores = scores;
    }
    const sort = effectiveSort();
    if (sort === "path-desc") keys = keys.slice().reverse();
    else if (sort === "recent") {
      const t = (k) => (state.records.get(k) || {}).reviewedAt || 0;
      keys = keys.slice().sort((a, b) => t(b) - t(a));
    } else if (sort === "shuffle") {
      const seed = state.settings.shuffleSeed + "|";
      const rank = new Map(keys.map((k) => [k, hash(seed + k)]));
      keys = keys.slice().sort((a, b) => rank.get(a) - rank.get(b));
    } else if (sort === "match") {
      const sc = state.lib.scores;
      keys = keys.slice().sort((a, b) => sc.get(b) - sc.get(a));
    } else if (sort === "custom") {
      const g = gallery(state.settings.src.id);
      if (g) keys = customOrder(g, keys);
    }
    // Folder headers: keep folders in path order and the chosen order
    // *within* each folder (so shuffle shuffles inside each day, etc.).
    state.lib.groups = null;
    if (state.settings.groupFolders && sort !== "custom") {
      const byDir = new Map();
      for (const k of keys) {
        const d = dirname(k);
        if (!byDir.has(d)) byDir.set(d, []);
        byDir.get(d).push(k);
      }
      if (byDir.size > 1) {
        const dirs = [...byDir.keys()].sort(C.collator.compare);
        if (baseSort() === "path-desc") dirs.reverse();
        keys = [];
        state.lib.groups = dirs.map((d) => {
          const start = keys.length;
          keys.push(...byDir.get(d));
          return { dir: d, start, end: keys.length };
        });
      }
    }
    return keys;
  }

  // The grid is virtualized: only rows in (or near) view exist as DOM nodes,
  // absolutely positioned inside a spacer as tall as the whole grid. Rows are
  // either a folder header or a strip of cells; that's what keeps 100k-image
  // folders as fast as 100-image ones.
  const GRID_GAP = 8;
  const GRID_PAD = 12; // matches .grid padding-top in styles.css
  const HEAD_H = 34;
  const OVERSCAN = 600; // px rendered above/below the viewport
  const grid = { cols: 1, size: 0, rows: [], cellRows: [], cells: new Map(), heads: new Map() };

  function rebuildLibrary(keepScroll) {
    hideHoverCard();
    const items = libraryItems();
    state.lib.items = items;
    const keep = new Set(items);
    for (const p of [...state.lib.selected]) if (!keep.has(p)) state.lib.selected.delete(p);
    if (state.lib.focus && !keep.has(state.lib.focus)) state.lib.focus = null;
    applyThumbFit();
    clearCells();
    if (!keepScroll) $("grid").scrollTop = 0;
    layoutGrid(true);
    $("lib-count").textContent = plural(items.length, "image");
    $("grid").classList.toggle("searching", !!state.lib.hits);
    const empty = $("lib-empty");
    empty.hidden = items.length > 0;
    const s = state.settings.src;
    const indexing = features.stats.running && (state.lib.match || state.lib.hits);
    empty.innerHTML =
      s.type === "gallery" && !srcKeys().length
        ? "This gallery is empty. Select images and drag them onto it, or set it as the target and press B."
        : state.lib.match
          ? "No matches" + (indexing ? " yet — still indexing." : ". Try a wider range in the colour picker.")
          : state.lib.search
            ? "Nothing matches that search" + (indexing ? " yet — prompts are still being indexed." : ".")
            : state.settings.filter !== "all"
              ? "Nothing here with this filter."
              : "No images in this folder.";
    renderLibTitle();
    renderFilterBar();
    renderSortBar();
    renderSelectBar();
    renderLibDetails();
  }

  function clearCells() {
    for (const cell of grid.cells.values()) images.cancel(cell.dataset.path);
    grid.cells.clear();
    grid.heads.clear();
    const inner = $("grid-inner");
    inner.innerHTML = "";
    inner.appendChild(dropMarker);
  }

  function buildRows() {
    const { cols, size } = grid;
    const step = size + GRID_GAP;
    const rows = [];
    const cellRows = [];
    const segs = state.lib.groups || [{ dir: null, start: 0, end: state.lib.items.length }];
    let y = 0;
    for (const seg of segs) {
      if (seg.dir !== null) {
        rows.push({ type: "head", y, h: HEAD_H, seg });
        y += HEAD_H;
      }
      for (let s = seg.start; s < seg.end; s += cols) {
        const row = { type: "cells", y, h: size, start: s, end: Math.min(s + cols, seg.end) };
        rows.push(row);
        cellRows.push(row);
        y += step;
      }
      if (seg.dir !== null) y += 10;
    }
    grid.rows = rows;
    grid.cellRows = cellRows;
    $("grid-inner").style.height = Math.max(0, y - GRID_GAP) + "px";
  }

  // Last row starting at or above y.
  function rowAt(rows, y) {
    let lo = 0,
      hi = rows.length - 1,
      ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid].y <= y) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }
  // The cell row holding item i.
  function cellRowOf(i) {
    const rows = grid.cellRows;
    let lo = 0,
      hi = rows.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid].end <= i) lo = mid + 1;
      else if (rows[mid].start > i) hi = mid - 1;
      else return mid;
    }
    return -1;
  }
  function posOf(i) {
    const r = grid.cellRows[cellRowOf(i)];
    return r ? { x: (i - r.start) * (grid.size + GRID_GAP), y: r.y } : { x: 0, y: 0 };
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
    // Keep the first visible image in view across the re-layout.
    let anchor = -1;
    if (!force && grid.rows.length) {
      const r = grid.rows[rowAt(grid.rows, Math.max(0, el.scrollTop - GRID_PAD))];
      anchor = r.type === "cells" ? r.start : r.seg.start;
    }
    const changedGeom = cols !== grid.cols || size !== grid.size;
    grid.cols = cols;
    grid.size = size;
    if (changedGeom) clearCells();
    buildRows();
    if (anchor >= 0) el.scrollTop = posOf(anchor).y;
    renderVisible();
  }

  function renderVisible() {
    const el = $("grid");
    const { size, cells, heads } = grid;
    if (!size) return;
    const step = size + GRID_GAP;
    const top = Math.max(0, el.scrollTop - GRID_PAD - OVERSCAN);
    const bottom = el.scrollTop + el.clientHeight + OVERSCAN;
    const want = new Set();
    const wantHeads = new Set();
    const vis = [];
    for (let ri = rowAt(grid.rows, top); ri < grid.rows.length && grid.rows[ri].y < bottom; ri++) {
      const r = grid.rows[ri];
      if (r.type === "head") {
        wantHeads.add(r.seg.dir);
        vis.push(r);
      } else for (let i = r.start; i < r.end; i++) want.add(i);
      if (r.type === "cells") vis.push(r);
    }
    for (const [i, cell] of cells) {
      if (!want.has(i)) {
        images.cancel(cell.dataset.path);
        cell.remove();
        cells.delete(i);
      }
    }
    for (const [d, h] of heads) {
      if (!wantHeads.has(d)) {
        h.remove();
        heads.delete(d);
      }
    }
    const frag = document.createDocumentFragment();
    for (const r of vis) {
      if (r.type === "head") {
        if (heads.has(r.seg.dir)) continue;
        const h = document.createElement("div");
        h.className = "group-head";
        h.dataset.dir = r.seg.dir;
        h.style.top = r.y + "px";
        h.innerHTML = `<span class="gh-name">${esc(groupLabel(r.seg.dir))}</span><span class="muted">${plural(r.seg.end - r.seg.start, "image")}</span>`;
        h.title = "Open this folder";
        heads.set(r.seg.dir, h);
        frag.appendChild(h);
        continue;
      }
      for (let i = r.start; i < r.end; i++) {
        if (cells.has(i)) continue;
        const p = state.lib.items[i];
        const cell = document.createElement("div");
        cell.className = "cell";
        cell.draggable = true;
        cell.dataset.i = i;
        cell.dataset.path = p;
        if (!state.lib.hits) cell.title = p;
        cell.style.cssText = `left:${(i - r.start) * step}px;top:${r.y}px;width:${size}px;height:${size}px`;
        cell.innerHTML = `<img draggable="false" alt="" /><span class="badge"></span><span class="note-dot" title="Has notes">&#9998;</span>${hitTags(p)}`;
        decorateCell(cell);
        setThumb(cell.firstChild, p, cell);
        cells.set(i, cell);
        frag.appendChild(cell);
      }
    }
    $("grid-inner").appendChild(frag);
  }

  // Folder header text, relative to the folder being viewed.
  function groupLabel(dir) {
    const s = state.settings.src;
    if (s.type === "folder" && s.path) {
      if (dir === s.path) return "(this folder)";
      if (dir.startsWith(s.path + "/")) return dir.slice(s.path.length + 1);
    }
    return dir;
  }

  function hitTags(p) {
    const h = state.lib.hits && state.lib.hits.get(p);
    if (!h) return "";
    return `<span class="hit-tags">${[...h].map((f) => `<i class="${f}">${FIELD_LABEL[f]}</i>`).join("")}</span>`;
  }

  let scrollRaf = 0;
  function onGridScroll() {
    features.busy(600);
    hideHoverCard();
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      renderVisible();
    });
  }

  function scrollToItem(i) {
    const el = $("grid");
    const { y } = posOf(i);
    if (y < el.scrollTop - GRID_PAD || y + grid.size > el.scrollTop + el.clientHeight - GRID_PAD) el.scrollTop = Math.max(0, y - el.clientHeight / 3);
    renderVisible();
  }

  function decorateCell(cell) {
    const p = cell.dataset.path;
    const r = record(p) || {};
    cell.classList.remove("yes", "maybe", "no");
    if (r.rating) cell.classList.add(r.rating);
    cell.classList.toggle("has-notes", !!(r.notes || "").trim());
    cell.classList.toggle("selected", state.lib.selected.has(p));
    cell.classList.toggle("focus", state.lib.focus === p);
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
    $("select-bar").classList.toggle("show", sel.size > 1);
    $("select-count").textContent = `${fmt(sel.size)} selected`;
    const pick = inGallery || state.settings.targetGallery;
    $("select-gallery").innerHTML =
      state.galleries.map((g) => `<option value="${esc(g.id)}" ${g.id === pick ? "selected" : ""}>${esc(g.name)}</option>`).join("") +
      `<option value="__new">+ New gallery&hellip;</option>`;
    $("select-remove").hidden = !inGallery;
  }

  // Click = select just this; Ctrl/⌘ = toggle; Shift = range from the focus.
  function selectCell(i, e) {
    const sel = state.lib.selected;
    const items = state.lib.items;
    const p = items[i];
    const anchor = state.lib.focus ? items.indexOf(state.lib.focus) : -1;
    if (e.shiftKey && anchor >= 0) {
      if (!(e.ctrlKey || e.metaKey)) sel.clear();
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
      for (let k = a; k <= b; k++) sel.add(items[k]);
      decorateAll();
      renderSelectBar();
      return; // keep the anchor where it was
    }
    if (e.ctrlKey || e.metaKey) {
      if (sel.has(p)) sel.delete(p);
      else sel.add(p);
    } else {
      sel.clear();
      sel.add(p);
    }
    setFocus(p);
  }

  function setFocus(p) {
    state.lib.focus = p;
    decorateAll();
    renderSelectBar();
    renderLibDetails();
  }

  // Arrow keys: move the cursor (Shift extends the selection).
  function moveCursor(dx, dy, extend) {
    const items = state.lib.items;
    if (!items.length) return;
    let i = state.lib.focus ? items.indexOf(state.lib.focus) : -1;
    if (i < 0) i = 0;
    else if (dx) i = Math.max(0, Math.min(items.length - 1, i + dx));
    else {
      const ri = cellRowOf(i);
      const r = grid.cellRows[ri];
      const t = grid.cellRows[ri + dy];
      if (t) i = Math.min(t.start + (i - r.start), t.end - 1);
    }
    const p = items[i];
    if (extend) state.lib.selected.add(p);
    else {
      state.lib.selected.clear();
      state.lib.selected.add(p);
    }
    scrollToItem(i);
    setFocus(p);
  }

  function clearSelection() {
    state.lib.selected.clear();
    state.lib.focus = null;
    decorateAll();
    renderSelectBar();
    renderLibDetails();
  }

  function renderLibDetails() {
    if (!state.settings.detailsOpen || state.view !== "library") return;
    const panel = $("lib-details");
    const p = state.lib.focus;
    if (panel.dataset.path !== (p || "")) details.render(panel, p || null);
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

  function toggleGroupFolders() {
    if (effectiveSort() === "custom") return;
    state.settings.groupFolders = !state.settings.groupFolders;
    saveSettings();
    const keep = state.lib.focus;
    rebuildLibrary();
    if (keep) {
      const i = state.lib.items.indexOf(keep);
      if (i >= 0) scrollToItem(i);
    }
    toast(state.settings.groupFolders ? "Folder headers on (G)" : "Folder headers off — one continuous feed");
  }

  // Jump from any image (e.g. one in a gallery) to its folder in the library.
  function showInFolder(path) {
    const dir = dirname(path);
    if (state.lb.open) closeLightbox();
    const segs = dir.split("/");
    for (let i = 1; i < segs.length; i++) toggleExpanded(segs.slice(0, i).join("/"), true);
    state.settings.filter = "all";
    state.lib.search = "";
    state.lib.match = null;
    $("lib-search").value = "";
    renderMatchChip();
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
    scrollToItem(i);
    setFocus(path);
  }

  // ------------------------------------------------- search hover card

  let hoverTimer = 0;
  function showHoverCard(cell) {
    const p = cell.dataset.path;
    const terms = searchTerms();
    const hit = state.lib.hits && state.lib.hits.get(p);
    if (!hit || !terms.length) return;
    const rows = fieldsOf(p)
      .filter(([name]) => hit.has(name))
      .map(([name, lc, raw]) => `<div class="hc-row"><span class="hc-field ${name}">${FIELD_LABEL[name]}</span><span class="hc-text">${snippet(raw, lc, terms)}</span></div>`);
    const card = $("hovercard");
    card.innerHTML = rows.join("");
    const r = cell.getBoundingClientRect();
    card.classList.add("show");
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    let x = r.right + 8;
    if (x + w > window.innerWidth - 8) x = r.left - w - 8;
    if (x < 8) x = Math.min(window.innerWidth - w - 8, r.left);
    const y = Math.max(8, Math.min(window.innerHeight - h - 8, r.top));
    card.style.left = x + "px";
    card.style.top = y + "px";
  }
  function hideHoverCard() {
    clearTimeout(hoverTimer);
    $("hovercard").classList.remove("show");
  }

  // Text around the first match of each term, with matches highlighted.
  function snippet(raw, lc, terms) {
    const ranges = [];
    for (const t of terms) {
      let from = 0;
      let idx;
      while ((idx = lc.indexOf(t, from)) >= 0) {
        ranges.push([idx, idx + t.length]);
        from = idx + t.length;
      }
    }
    if (!ranges.length) return esc(raw.slice(0, 120));
    ranges.sort((a, b) => a[0] - b[0]);
    const CTX = 60;
    const windows = [];
    for (const [a, b] of ranges) {
      const w = windows[windows.length - 1];
      if (w && a - CTX <= w[1]) w[1] = Math.max(w[1], b + CTX);
      else windows.push([Math.max(0, a - CTX), b + CTX]);
      if (windows.length > 3) break;
    }
    return windows
      .slice(0, 3)
      .map(([ws, we]) => {
        we = Math.min(raw.length, we);
        let out = "";
        let pos = ws;
        for (const [a, b] of ranges) {
          if (b <= ws || a >= we || a < pos) continue;
          out += esc(raw.slice(pos, a)) + "<mark>" + esc(raw.slice(a, b)) + "</mark>";
          pos = b;
        }
        out += esc(raw.slice(pos, we));
        return (ws > 0 ? "&hellip;" : "") + out + (we < raw.length ? "&hellip;" : "");
      })
      .join(" ");
  }

  // --------------------------------------------------------- lightbox

  function openLightbox(items, index) {
    if (!items.length) return;
    hideHoverCard();
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
    // Leave the library's cursor on the last image viewed.
    if (state.view === "library") {
      const p = state.lb.items[state.lb.index];
      const i = state.lib.items.indexOf(p);
      if (i >= 0) {
        state.lib.selected = new Set([p]);
        scrollToItem(i);
        setFocus(p);
      }
    }
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
    if (open) {
      $("lib-details").dataset.path = "\0"; // force a render
      renderLibDetails();
    }
    layoutGrid();
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
    startIndexing();
    emit("onFiles");
  }

  let indexTimer = 0;
  function startIndexing() {
    clearTimeout(indexTimer);
    indexTimer = setTimeout(() => features.start(state.all, srcKeys()), 400);
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
    startIndexing();
    emit("onFiles");
  }

  async function removeRoot(id) {
    const root = rootById(id);
    if (!root) return;
    const msg = root.virtual
      ? "Forget these unattached ratings, notes and thumbnails for good?"
      : `Remove “${root.name}” from the library?\n\nThe folder itself is untouched. Its ratings, notes and gallery entries are kept and come back if you add it again.`;
    if (!confirm(msg)) return;
    const pre = id + "/";
    const keys = (state.files.get(id) || []).map((rel) => pre + rel);
    state.roots = state.roots.filter((r) => r !== root);
    state.files.delete(id);
    source.disconnect(id);
    await store.del("roots", id);
    await store.del("kv", "files:" + id);
    const thumbKeys = (await store.keys("thumbs")).filter((k) => k.startsWith(pre));
    images.forget(thumbKeys);
    await store.delMany("thumbs", thumbKeys);
    await features.forget(keys);
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
    if (state.settings.libSort) state.settings.sort = state.settings.libSort;
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
    await features.rekey(pairs);
    const renamed = new Map(pairs);
    for (const g of state.galleries) {
      if (!g.order || !g.order.some((k) => renamed.has(k))) continue;
      g.order = g.order.map((k) => renamed.get(k) || k);
      store.put("galleries", g);
    }
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
      galleryGroups: state.groups,
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
    for (const gr of data.galleryGroups || []) if (!group(gr.id)) state.groups.push(gr);
    saveGroups();
    for (const g of data.galleries || []) {
      if (!gallery(g.id)) {
        const copy = { group: null, pos: topLevel().length, order: [], ...g };
        if (copy.group && !group(copy.group)) copy.group = null;
        if (prefix) copy.order = (copy.order || []).map((k) => prefix + k);
        state.galleries.push(copy);
        store.put("galleries", copy);
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
    $("set-index").textContent = `${fmt(features.count())} of ${fmt(state.all.length)} images indexed for colour and prompt search.`;
    $("settings").showModal();
  }

  // Opening the picker starts a colour search with its current colour.
  function openColorPicker() {
    if (state.view !== "library") showView("library");
    C.colorPicker.open($("color-btn"), state.settings.lastColor || undefined, colorMatch, () => setMatch(null));
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

    if (state.lb.open) {
      const path = state.lb.items[state.lb.index];
      if (k === "ArrowRight") lbStep(1);
      else if (k === "ArrowLeft") lbStep(-1);
      else if (k === "Home") ((state.lb.index = 0), renderLightbox());
      else if (k === "End") ((state.lb.index = state.lb.items.length - 1), renderLightbox());
      else if (k === "Escape" || k === "Enter") closeLightbox();
      else if (k === " ") setZoom(!state.lb.zoom);
      else if (k in RATE_KEYS) setRating(path, RATE_KEYS[k]);
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
      const sel = [...state.lib.selected];
      if (k === "+" || k === "=") setThumbSize(state.settings.thumbSize + 40);
      else if (k === "-") setThumbSize(state.settings.thumbSize - 40);
      else if (k === "ArrowRight") moveCursor(1, 0, e.shiftKey);
      else if (k === "ArrowLeft") moveCursor(-1, 0, e.shiftKey);
      else if (k === "ArrowDown") moveCursor(0, 1, e.shiftKey);
      else if (k === "ArrowUp") moveCursor(0, -1, e.shiftKey);
      else if ((k === "Enter" || k === " ") && state.lib.focus) openLightbox(state.lib.items, state.lib.items.indexOf(state.lib.focus));
      else if (k in RATE_KEYS && sel.length) sel.forEach((p) => setRating(p, RATE_KEYS[k]));
      else if (k === "g") toggleGroupFolders();
      else if (k === "d") reroll();
      else if (k === "c") openColorPicker();
      else if (k === "/") $("lib-search").focus();
      else if (k === "Escape") {
        if (state.lib.selected.size) clearSelection();
        else if (state.lib.match) setMatch(null);
      } else return;
      e.preventDefault();
    }
  }

  // ------------------------------------------------------------- bind

  const DRAG_TYPE = "application/x-curator-paths";
  const GALLERY_DRAG = "application/x-curator-gallery";
  let dragPaths = null; // images being dragged from the grid
  let dragEntity = null; // { kind, item } being dragged in the gallery list
  const dropMarker = document.createElement("div");
  dropMarker.className = "drop-marker";

  // Where a drop at (x, y) would insert, in a gallery's grid.
  function dropIndexAt(clientX, clientY) {
    const inner = $("grid-inner").getBoundingClientRect();
    const x = clientX - inner.left;
    const y = clientY - inner.top;
    const rows = grid.cellRows;
    if (!rows.length) return { index: 0, row: null };
    const row = rows[rowAt(rows, y)];
    const step = grid.size + GRID_GAP;
    const rel = x / step;
    let index = row.start + Math.floor(rel) + (rel - Math.floor(rel) > 0.5 ? 1 : 0);
    index = Math.max(row.start, Math.min(row.end, index));
    return { index, row };
  }

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
    $("new-group-btn").onclick = newGroup;
    gl.onclick = (e) => {
      if (e.target.closest("[data-new-gallery]")) return newGallery();
      const gh = e.target.closest("li[data-group]");
      if (gh) {
        const gr = group(gh.dataset.group);
        const a = (e.target.closest("[data-gr-act]") || {}).dataset;
        if (a && a.grAct === "rename") return renameGroup(gr.id);
        if (a && a.grAct === "delete") return deleteGroup(gr.id);
        gr.collapsed = !gr.collapsed;
        saveGroups();
        return renderGalleries();
      }
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
    gl.addEventListener("dragstart", (e) => {
      const li = e.target.closest("li[data-gallery], li[data-group]");
      if (!li) return;
      dragEntity = li.dataset.group ? { kind: "group", item: group(li.dataset.group) } : { kind: "g", item: gallery(li.dataset.gallery) };
      e.dataTransfer.setData(GALLERY_DRAG, "1");
      e.dataTransfer.effectAllowed = "move";
    });
    gl.addEventListener("dragend", () => {
      dragEntity = null;
      gl.querySelectorAll(".drop, .drop-before").forEach((x) => x.classList.remove("drop", "drop-before"));
    });
    const dropTarget = (e) => e.target.closest("li[data-gallery], li[data-new-gallery], li[data-group]");
    // Images: onto a gallery (add) or + New gallery. Galleries/groups: reorder or file into a group.
    const dropKind = (e, li) => {
      const t = e.dataTransfer.types;
      if (t.includes(DRAG_TYPE)) return li.dataset.group ? null : "drop";
      if (t.includes(GALLERY_DRAG) && dragEntity) {
        if (li.dataset.group && dragEntity.kind === "g") return "drop";
        if (li.dataset.gallery && li.dataset.gallery === (dragEntity.item || {}).id) return null;
        return "drop-before";
      }
      return null;
    };
    gl.addEventListener("dragover", (e) => {
      const li = dropTarget(e);
      const kind = li && dropKind(e, li);
      if (!kind) return;
      e.preventDefault();
      gl.querySelectorAll(".drop, .drop-before").forEach((x) => x !== li && x.classList.remove("drop", "drop-before"));
      li.classList.add(kind);
    });
    gl.addEventListener("dragleave", (e) => {
      const li = dropTarget(e);
      if (li && !li.contains(e.relatedTarget)) li.classList.remove("drop", "drop-before");
    });
    gl.addEventListener("drop", (e) => {
      const li = dropTarget(e);
      if (!li) return;
      e.preventDefault();
      li.classList.remove("drop", "drop-before");
      if (e.dataTransfer.types.includes(GALLERY_DRAG) && dragEntity) {
        const { kind, item } = dragEntity;
        dragEntity = null;
        if (li.dataset.newGallery) return placeEntity(kind, item, null, null);
        if (li.dataset.group) {
          const gr = group(li.dataset.group);
          if (kind === "g") {
            gr.collapsed = false;
            return placeEntity("g", item, gr.id, null);
          }
          return placeEntity("group", item, null, gr);
        }
        const target = gallery(li.dataset.gallery);
        if (kind === "group") return placeEntity("group", item, null, target.group ? group(target.group) : target);
        return placeEntity("g", item, target.group || null, target);
      }
      const paths = JSON.parse(e.dataTransfer.getData(DRAG_TYPE) || "[]");
      if (!paths.length) return;
      if (li.dataset.newGallery) newGallery(paths);
      else addToGallery(paths, li.dataset.gallery);
      renderSelectBar();
    });

    // library bar
    $("lib-filter").onclick = (e) => {
      const b = e.target.closest("button[data-filter]");
      if (!b) return;
      state.settings.filter = b.dataset.filter;
      saveSettings();
      rebuildLibrary();
    };
    $("lib-sort").onchange = (e) => setSort(e.target.value);
    $("reroll-btn").onclick = () => reroll();
    $("shuffle-seed").onchange = (e) => reroll(e.target.value.trim() || randomSeed());
    $("group-btn").onclick = toggleGroupFolders;
    $("color-btn").onclick = openColorPicker;
    $("match-chip").onclick = (e) => {
      if (e.target.closest("[data-clear-match]")) return setMatch(null);
      if (state.lib.match && state.lib.match.type === "color") openColorPicker();
    };

    // grid
    const gridEl = $("grid");
    gridEl.addEventListener("scroll", onGridScroll, { passive: true });
    gridEl.onclick = (e) => {
      const head = e.target.closest(".group-head");
      if (head) return setSource({ type: "folder", path: head.dataset.dir });
      const cell = e.target.closest(".cell");
      if (!cell) {
        if (e.target === gridEl || e.target.id === "grid-inner") clearSelection();
        return;
      }
      selectCell(+cell.dataset.i, e);
    };
    gridEl.ondblclick = (e) => {
      const cell = e.target.closest(".cell");
      if (cell) openLightbox(state.lib.items, +cell.dataset.i);
    };
    gridEl.addEventListener("mouseover", (e) => {
      const cell = e.target.closest(".cell");
      clearTimeout(hoverTimer);
      if (!cell || !state.lib.hits) return hideHoverCard();
      hoverTimer = setTimeout(() => showHoverCard(cell), 250);
    });
    gridEl.addEventListener("mouseleave", hideHoverCard);
    gridEl.addEventListener("dragstart", (e) => {
      const cell = e.target.closest(".cell");
      if (!cell) return;
      hideHoverCard();
      const p = cell.dataset.path;
      if (!state.lib.selected.has(p)) {
        state.lib.selected = new Set([p]);
        setFocus(p);
      }
      dragPaths = state.lib.items.filter((k) => state.lib.selected.has(k));
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(dragPaths));
      e.dataTransfer.setData("text/plain", dragPaths.map(fullPath).join("\n"));
      e.dataTransfer.effectAllowed = "copyMove";
    });
    gridEl.addEventListener("dragend", () => {
      dragPaths = null;
      dropMarker.classList.remove("show");
    });
    // Arrange by dragging, inside a gallery.
    gridEl.addEventListener("dragover", (e) => {
      if (!dragPaths || !inGallerySrc() || state.lib.groups) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const r = gridEl.getBoundingClientRect();
      if (e.clientY < r.top + 40) gridEl.scrollTop -= 20;
      else if (e.clientY > r.bottom - 40) gridEl.scrollTop += 20;
      const { index, row } = dropIndexAt(e.clientX, e.clientY);
      if (!row) return;
      const step = grid.size + GRID_GAP;
      dropMarker.style.left = (index - row.start) * step - GRID_GAP / 2 - 1 + "px";
      dropMarker.style.top = row.y + "px";
      dropMarker.style.height = grid.size + "px";
      dropMarker.classList.add("show");
    });
    gridEl.addEventListener("dragleave", (e) => {
      if (!gridEl.contains(e.relatedTarget)) dropMarker.classList.remove("show");
    });
    gridEl.addEventListener("drop", (e) => {
      if (!dragPaths || !inGallerySrc() || state.lib.groups) return;
      e.preventDefault();
      dropMarker.classList.remove("show");
      const { index } = dropIndexAt(e.clientX, e.clientY);
      const moving = new Set(dragPaths);
      let before = null;
      for (let i = index; i < state.lib.items.length; i++) {
        if (!moving.has(state.lib.items[i])) {
          before = state.lib.items[i];
          break;
        }
      }
      moveInGallery(state.settings.src.id, dragPaths, before);
      dragPaths = null;
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
      searchTimer = setTimeout(() => rebuildLibrary(), 220);
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

    const [roots, recs, gals, groups] = await Promise.all([
      store.getAll("roots"),
      store.getAll("records"),
      store.getAll("galleries"),
      store.get("kv", "galleryGroups"),
      features.load(),
    ]);
    state.roots = roots.sort((a, b) => a.added - b.added);
    await Promise.all(state.roots.map(async (r) => state.files.set(r.id, (await store.get("kv", "files:" + r.id)) || [])));
    const orphans = await store.get("kv", "files:" + ORPHAN);
    if (orphans && orphans.length) {
      state.files.set(ORPHAN, orphans);
      state.roots.push(orphanRoot());
    }
    for (const r of recs) state.records.set(r.path, r);
    state.groups = groups || [];
    state.galleries = gals.sort((a, b) => a.created - b.created);
    // Galleries from before groups/ordering: give them a place in the list.
    state.galleries.forEach((g, i) => {
      if (g.pos === undefined) g.pos = i;
      if (g.group === undefined) g.group = null;
      if (g.group && !group(g.group)) g.group = null;
    });
    if (!state.settings.shuffleSeed) state.settings.shuffleSeed = randomSeed();
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

    $("app").appendChild(Object.assign(document.createElement("div"), { id: "hovercard", className: "hovercard" }));
    features.on("progress", renderIndexStatus);
    features.on("batch", () => {
      // New palettes/prompts can change what a colour or prompt search shows.
      if (state.view === "library" && (state.lib.match || state.lib.hits)) rebuildLibrary(true);
    });

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
    renderMatchChip();
    showView(state.settings.view);
    startIndexing();
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
    searchColor,
    findSimilar,
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
