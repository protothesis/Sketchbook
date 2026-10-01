// UI wiring: views (welcome / review / library), lightbox, settings, keys.
// All state about images is metadata keyed by relative path — see store.js.
(function () {
  const C = window.Curator;
  const { store, source, images, details, markdown } = C;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => markdown.esc(String(s));
  const fmt = (n) => n.toLocaleString();
  const RATINGS = ["yes", "maybe", "no"];

  const DEFAULT_SETTINGS = {
    queueSize: 10,
    thumbSize: 200,
    rootPath: "",
    queueSource: "unreviewed",
    scope: "",
    fit: "cover",
    view: "review",
    libFilter: "yes",
    libSort: "recent",
    detailsOpen: false,
  };

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    files: [],
    fileSet: new Set(),
    rootName: "",
    storedHandle: null,
    scanning: false,
    records: new Map(), // path -> { path, rating, reviewedAt, notes, galleries[] }
    galleries: [], // { id, name, created }
    view: null,
    queue: [],
    qi: 0,
    session: new Map(), // path -> rating given this session
    lib: { gallery: null, search: "", items: [], selected: new Set(), anchor: -1 },
    lb: { items: [], index: 0, open: false, zoom: false },
  };

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
    if (rating) state.session.set(path, rating);
    else state.session.delete(path);
    changed(path);
  }

  function setNotes(path, text) {
    const r = ensureRecord(path);
    if ((r.notes || "") === text) return;
    r.notes = text;
    saveRecord(r);
    updateCell(path);
  }

  function toggleGallery(path, id) {
    const r = ensureRecord(path);
    const has = r.galleries.includes(id);
    r.galleries = has ? r.galleries.filter((g) => g !== id) : [...r.galleries, id];
    saveRecord(r);
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
    const g = state.galleries.find((x) => x.id === id);
    toast(`${remove ? "Removed" : "Added"} ${paths.length} image${paths.length === 1 ? "" : "s"} ${remove ? "from" : "to"} “${g ? g.name : "gallery"}”`);
    renderSidebar();
    paths.forEach(updateCell);
    refreshPanels();
  }

  function newGallery() {
    const name = (prompt("New gallery name:") || "").trim();
    if (!name) return null;
    const g = { id: "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, created: Date.now() };
    state.galleries.push(g);
    store.put("galleries", g);
    renderSidebar();
    refreshPanels();
    return g;
  }

  function renameGallery(id) {
    const g = state.galleries.find((x) => x.id === id);
    const name = g && (prompt("Rename gallery:", g.name) || "").trim();
    if (!name) return;
    g.name = name;
    store.put("galleries", g);
    renderSidebar();
    refreshPanels();
  }

  function deleteGallery(id) {
    const g = state.galleries.find((x) => x.id === id);
    if (!g || !confirm(`Delete gallery “${g.name}”? (Only the grouping is removed — images and ratings stay.)`)) return;
    state.galleries = state.galleries.filter((x) => x.id !== id);
    store.del("galleries", id);
    for (const r of [...state.records.values()]) {
      if (r.galleries.includes(id)) {
        r.galleries = r.galleries.filter((x) => x !== id);
        saveRecord(r);
      }
    }
    if (state.lib.gallery === id) state.lib.gallery = null;
    if (state.view === "library") rebuildLibrary();
    refreshPanels();
  }

  function counts() {
    const c = { yes: 0, maybe: 0, no: 0, notes: 0 };
    const checkSet = state.fileSet.size > 0;
    for (const r of state.records.values()) {
      if (checkSet && !state.fileSet.has(r.path)) continue;
      if (r.rating) c[r.rating]++;
      if ((r.notes || "").trim()) c.notes++;
    }
    c.reviewed = c.yes + c.maybe + c.no;
    return c;
  }

  // Something about `path` changed — update every place that shows it.
  function changed(path) {
    renderStats();
    updateCell(path);
    renderFilmstrip();
    if (state.view === "library") renderSidebar();
    refreshPanels();
    if (state.lb.open) renderLbPos();
    if (state.queue[state.qi] === path) $("review-stage").dataset.rating = (record(path) || {}).rating || "";
  }

  function refreshPanels() {
    details.refresh($("review-details"));
    details.refresh($("lb-details"));
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

  function fullPath(rel) {
    const root = state.settings.rootPath.trim().replace(/[\\/]+$/, "");
    if (!root) return rel;
    const sep = root.includes("\\") || /^[a-z]:$/i.test(root) ? "\\" : "/";
    return rel ? root + sep + rel.split("/").join(sep) : root;
  }

  function copyPath(path, folderOnly) {
    if (!state.settings.rootPath.trim()) {
      const root = prompt(
        "Browsers can't see real disk paths, so paste the full path of the folder you picked once (e.g. D:\\ComfyUI\\output).\nIt's only used to build copyable paths. Change it later in Settings.",
        ""
      );
      if (root === null) return;
      state.settings.rootPath = root.trim();
      saveSettings();
    }
    const rel = folderOnly ? path.slice(0, Math.max(0, path.lastIndexOf("/"))) : path;
    const p = fullPath(rel);
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
      else cell.classList.add("nothumb");
    });
  }

  // --------------------------------------------------------- top bar

  function renderStats() {
    const total = state.files.length;
    const c = counts();
    const pct = (n) => (total ? (100 * n) / total : 0);
    $("stats").innerHTML = total
      ? `<div class="progress" title="${(pct(c.reviewed) || 0).toFixed(1)}% reviewed">
           <i class="yes" style="width:${pct(c.yes)}%"></i><i class="maybe" style="width:${pct(c.maybe)}%"></i><i class="no" style="width:${pct(c.no)}%"></i>
         </div>
         <span><b>${fmt(c.reviewed)}</b> of ${fmt(total)} reviewed</span>
         <span class="chip yes" title="Yes">&#10003; ${fmt(c.yes)}</span>
         <span class="chip maybe" title="Maybe">? ${fmt(c.maybe)}</span>
         <span class="chip no" title="No">&#10005; ${fmt(c.no)}</span>`
      : "";
    const s = { yes: 0, maybe: 0, no: 0 };
    for (const r of state.session.values()) s[r]++;
    const n = state.session.size;
    $("session-stats").textContent = n ? `This session: ${n} rated · ${s.yes} yes · ${s.maybe} maybe · ${s.no} no` : "";
  }

  function renderSourceStatus() {
    const el = $("source-status");
    const name = source.name || state.rootName;
    if (state.scanning) el.innerHTML = `<span class="muted">Scanning ${esc(name)}&hellip;</span>`;
    else if (source.connected) el.innerHTML = `<span class="conn" title="Connected (read-only)">&#9679; ${esc(name)}</span>`;
    else if (name) el.innerHTML = `<button class="primary" id="reconnect-btn">Reconnect “${esc(name)}”</button>`;
    else el.innerHTML = "";
    const rb = $("reconnect-btn");
    if (rb) rb.onclick = reconnect;
  }

  // ------------------------------------------------------------ views

  function showView(view) {
    if (!state.files.length) view = "welcome";
    state.view = view;
    if (view !== "welcome") {
      state.settings.view = view;
      saveSettings();
    }
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + view));
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
    if (view === "review") {
      if (!state.queue.length) newBatch();
      else renderReview();
    }
    if (view === "library") rebuildLibrary();
  }

  // ----------------------------------------------------------- review

  function buildPool() {
    const src = state.settings.queueSource;
    const scope = state.settings.scope.trim().toLowerCase();
    let pool;
    if (src === "unreviewed") {
      pool = state.files.filter((p) => {
        const r = state.records.get(p);
        return !r || !r.rating;
      });
    } else {
      pool = [];
      for (const r of state.records.values()) if (r.rating === src && state.fileSet.has(r.path)) pool.push(r.path);
    }
    if (scope) pool = pool.filter((p) => p.toLowerCase().includes(scope));
    return pool;
  }

  function newBatch() {
    $("batch-done").classList.remove("show");
    state.queue = [];
    state.qi = 0;
    if (source.connected) state.queue = sample(buildPool(), state.settings.queueSize);
    renderReview();
  }

  let reviewToken = 0;
  function renderReview() {
    const path = state.queue[state.qi];
    const img = $("review-img");
    const msg = $("review-msg");
    const stage = $("review-stage");
    renderFilmstrip();
    if (!path) {
      img.removeAttribute("src");
      stage.dataset.rating = "";
      details.render($("review-details"), null);
      if (!source.connected) {
        msg.innerHTML = `<p>The folder isn't connected yet.</p><button class="primary big" data-act="reconnect">Reconnect</button>`;
      } else if (state.qi >= state.queue.length && state.queue.length) {
        msg.textContent = "";
      } else {
        const what = state.settings.queueSource === "unreviewed" ? "unreviewed images" : state.settings.queueSource + "s";
        msg.innerHTML = `<p>No ${esc(what)} left${state.settings.scope ? " matching “" + esc(state.settings.scope) + "”" : ""}.</p>`;
      }
      return;
    }
    msg.textContent = "";
    stage.dataset.rating = (record(path) || {}).rating || "";
    const t = ++reviewToken;
    img.classList.add("loading");
    images
      .fullUrl(path)
      .then((url) => {
        if (t !== reviewToken) return;
        if (img.src === url && img.complete) return img.classList.remove("loading");
        img.onload = () => t === reviewToken && img.classList.remove("loading");
        img.src = url;
      })
      .catch(() => {
        if (t === reviewToken) msg.innerHTML = `<p>Couldn't read <code>${esc(path)}</code> — moved or deleted?</p>`;
      });
    if (state.settings.detailsOpen) details.render($("review-details"), path);
    images.preload(state.queue.slice(state.qi + 1, state.qi + 3));
  }

  function renderFilmstrip() {
    const fs = $("filmstrip");
    if (!fs) return;
    fs.innerHTML = "";
    state.queue.forEach((p, i) => {
      const r = (record(p) || {}).rating || "";
      const cell = document.createElement("button");
      cell.className = "film " + r + (i === state.qi ? " current" : "");
      cell.dataset.i = i;
      cell.title = p;
      const img = document.createElement("img");
      img.draggable = false;
      cell.appendChild(img);
      setThumb(img, p, cell);
      fs.appendChild(cell);
    });
  }

  function flashStamp(rating) {
    const s = $("review-stamp");
    s.className = "stamp";
    void s.offsetWidth; // restart the animation
    s.textContent = { yes: "YES", maybe: "MAYBE", no: "NO", skip: "SKIP" }[rating];
    s.className = "stamp flash " + rating;
  }

  function reviewRate(rating) {
    const path = state.queue[state.qi];
    if (!path) return;
    setRating(path, rating);
    flashStamp(rating);
    advance();
  }

  function advance() {
    if (state.qi < state.queue.length - 1) {
      state.qi++;
      renderReview();
    } else if (state.queue.length) {
      state.qi = state.queue.length;
      renderReview();
      showBatchDone();
    }
  }

  function back() {
    if (state.qi <= 0) return;
    $("batch-done").classList.remove("show");
    state.qi--;
    renderReview();
  }

  function showBatchDone() {
    const q = state.queue;
    const c = { yes: 0, maybe: 0, no: 0, skipped: 0 };
    q.forEach((p) => c[(record(p) || {}).rating || "skipped"]++);
    $("batch-summary").innerHTML =
      `<span class="chip yes">&#10003; ${c.yes}</span> <span class="chip maybe">? ${c.maybe}</span> <span class="chip no">&#10005; ${c.no}</span>` +
      (c.skipped ? ` <span class="chip">skipped ${c.skipped}</span>` : "") +
      ` &nbsp;<span class="muted">${fmt(buildPool().length)} left in this queue</span>`;
    const grid = $("batch-grid");
    grid.innerHTML = "";
    q.forEach((p, i) => {
      const cell = document.createElement("button");
      cell.className = "film " + ((record(p) || {}).rating || "");
      cell.dataset.i = i;
      const img = document.createElement("img");
      img.draggable = false;
      cell.appendChild(img);
      setThumb(img, p, cell);
      grid.appendChild(cell);
    });
    $("batch-done").classList.add("show");
  }

  // ---------------------------------------------------------- library

  function libraryItems() {
    const { gallery, search } = state.lib;
    const filter = state.settings.libFilter;
    let recs = [...state.records.values()];
    if (gallery) recs = recs.filter((r) => r.galleries.includes(gallery));
    else if (filter === "all") recs = recs.filter((r) => r.rating);
    else if (filter === "notes") recs = recs.filter((r) => (r.notes || "").trim());
    else recs = recs.filter((r) => r.rating === filter);
    const q = search.trim().toLowerCase();
    if (q) recs = recs.filter((r) => r.path.toLowerCase().includes(q) || (r.notes || "").toLowerCase().includes(q));
    const sort = state.settings.libSort;
    if (sort === "recent") recs.sort((a, b) => (b.reviewedAt || 0) - (a.reviewedAt || 0));
    else if (sort === "path") recs.sort((a, b) => C.collator.compare(a.path, b.path));
    else if (sort === "path-desc") recs.sort((a, b) => C.collator.compare(b.path, a.path));
    let paths = recs.map((r) => r.path);
    if (sort === "shuffle") paths = sample(paths, paths.length);
    return paths;
  }

  let io = null;
  function rebuildLibrary() {
    const grid = $("grid");
    const items = libraryItems();
    state.lib.items = items;
    const keep = new Set(items);
    for (const p of [...state.lib.selected]) if (!keep.has(p)) state.lib.selected.delete(p);
    state.lib.anchor = -1;
    grid.style.setProperty("--thumb", state.settings.thumbSize + "px");
    grid.classList.toggle("fit", state.settings.fit === "contain");
    $("fit-btn").textContent = state.settings.fit === "contain" ? "Fit" : "Crop";
    if (io) io.disconnect();
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          io.unobserve(e.target);
          setThumb(e.target.querySelector("img"), e.target.dataset.path, e.target);
        }
      },
      { root: grid, rootMargin: "800px" }
    );
    grid.innerHTML = "";
    const frag = document.createDocumentFragment();
    items.forEach((p, i) => {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.draggable = true;
      cell.dataset.i = i;
      cell.dataset.path = p;
      cell.title = p;
      cell.innerHTML = `<img draggable="false" alt="" /><span class="badge"></span><span class="note-dot" title="Has notes">&#9998;</span>`;
      decorateCell(cell);
      frag.appendChild(cell);
      io.observe(cell);
    });
    grid.appendChild(frag);
    grid.scrollTop = 0;
    $("lib-count").textContent = `${fmt(items.length)} image${items.length === 1 ? "" : "s"}`;
    const empty = $("lib-empty");
    empty.hidden = items.length > 0;
    empty.innerHTML = state.lib.gallery
      ? "This gallery is empty. Select images (Ctrl/⌘-click) and drag them onto it, or toggle it from an image's Info panel."
      : state.lib.search
        ? "Nothing matches that search."
        : "Nothing here yet — go review some images.";
    renderSidebar();
    renderSelectBar();
  }

  function decorateCell(cell) {
    const r = record(cell.dataset.path) || {};
    cell.classList.remove("yes", "maybe", "no");
    if (r.rating) cell.classList.add(r.rating);
    cell.classList.toggle("has-notes", !!(r.notes || "").trim());
    cell.classList.toggle("selected", state.lib.selected.has(cell.dataset.path));
  }

  function updateCell(path) {
    if (state.view !== "library") return;
    const cell = $("grid").querySelector(`.cell[data-path="${CSS.escape(path)}"]`);
    if (cell) decorateCell(cell);
  }

  function renderSidebar() {
    const c = counts();
    const f = state.lib.gallery ? null : state.settings.libFilter;
    const items = [
      ["yes", "Yes", c.yes],
      ["maybe", "Maybe", c.maybe],
      ["no", "No", c.no],
      ["all", "All rated", c.reviewed],
      ["notes", "With notes", c.notes],
    ];
    $("rating-list").innerHTML = items
      .map(([k, label, n]) => `<li class="${f === k ? "on" : ""}" data-filter="${k}"><span class="dot ${k}"></span>${label}<span class="n">${fmt(n)}</span></li>`)
      .join("");
    const gCounts = new Map();
    for (const r of state.records.values()) for (const g of r.galleries) gCounts.set(g, (gCounts.get(g) || 0) + 1);
    $("gallery-list").innerHTML =
      state.galleries
        .map(
          (g) => `<li class="${state.lib.gallery === g.id ? "on" : ""}" data-gallery="${esc(g.id)}">
            <span class="gname">${esc(g.name)}</span><span class="n">${fmt(gCounts.get(g.id) || 0)}</span>
            <button class="tiny" data-g-act="rename" title="Rename">&#9998;</button><button class="tiny" data-g-act="delete" title="Delete gallery">&times;</button>
          </li>`
        )
        .join("") || `<li class="muted small none">No galleries yet.</li>`;
  }

  function renderSelectBar() {
    const sel = state.lib.selected;
    const bar = $("select-bar");
    bar.classList.toggle("show", sel.size > 0);
    $("select-count").textContent = `${fmt(sel.size)} selected`;
    $("select-gallery").innerHTML = state.galleries.length
      ? state.galleries.map((g) => `<option value="${esc(g.id)}" ${g.id === state.lib.gallery ? "selected" : ""}>${esc(g.name)}</option>`).join("") +
        `<option value="__new">+ New gallery&hellip;</option>`
      : `<option value="__new">+ New gallery&hellip;</option>`;
    $("select-remove").hidden = !state.lib.gallery;
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
    $("grid").querySelectorAll(".cell").forEach(decorateCell);
    renderSelectBar();
  }

  function clearSelection() {
    state.lib.selected.clear();
    $("grid").querySelectorAll(".cell.selected").forEach(decorateCell);
    renderSelectBar();
  }

  function setThumbSize(px) {
    px = Math.max(80, Math.min(520, px));
    state.settings.thumbSize = px;
    $("thumb-size").value = px;
    $("grid").style.setProperty("--thumb", px + "px");
    saveSettings();
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
    if (state.view === "review") renderReview();
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
    if (open) {
      if (state.lb.open) details.render($("lb-details"), state.lb.items[state.lb.index]);
      details.render($("review-details"), state.queue[state.qi] || null);
    }
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

  function applyScan(paths) {
    const before = state.fileSet;
    let added = 0;
    for (const p of paths) if (!before.has(p)) added++;
    const hadFiles = state.files.length > 0;
    state.files = paths;
    state.fileSet = new Set(paths);
    state.rootName = source.name;
    store.put("kv", paths, "files");
    store.put("kv", source.name, "rootName");
    renderStats();
    if (hadFiles && added) toast(`${fmt(added)} new image${added === 1 ? "" : "s"} found`);
    else if (!hadFiles) toast(`${fmt(paths.length)} images found`);
  }

  async function scanNow(blocking) {
    if (state.scanning) return;
    state.scanning = true;
    renderSourceStatus();
    if (blocking) showScan(true, "Scanning…");
    try {
      const paths = await source.scan((n, dir) => {
        if (blocking) $("scan-text").textContent = `Scanning… ${fmt(n)} images${dir ? " — " + dir : ""}`;
      });
      applyScan(paths);
    } catch (e) {
      console.error(e);
      toast("Scan failed: " + e.message);
    } finally {
      state.scanning = false;
      showScan(false);
      renderSourceStatus();
    }
  }

  function confirmSwitch(newName) {
    if (!state.files.length || !state.rootName || newName === state.rootName) return true;
    return confirm(
      `Switch from “${state.rootName}” to “${newName}”?\n\nRatings, notes and galleries are keyed by path relative to the chosen folder, so they only line up if the new folder has the same layout (e.g. the same output folder moved elsewhere).`
    );
  }

  async function chooseFolder() {
    if (!source.supportsHandles) return $("dir-input").click();
    let h;
    try {
      h = await window.showDirectoryPicker({ id: "archive-curator", mode: "read" });
    } catch (e) {
      return; // cancelled
    }
    if (!confirmSwitch(h.name)) return;
    source.useHandle(h);
    state.storedHandle = h;
    store.put("kv", h, "rootHandle").catch((e) => console.warn("Couldn't persist folder handle", e));
    await scanNow(true);
    afterConnect();
  }

  async function onDirInput(e) {
    const list = e.target.files;
    if (!list || !list.length) return;
    showScan(true, `Reading ${fmt(list.length)} files…`);
    await new Promise((r) => setTimeout(r, 30));
    const first = (list[0].webkitRelativePath || "").split("/")[0];
    if (!confirmSwitch(first)) return showScan(false);
    const paths = source.useFileList(list);
    applyScan(paths);
    showScan(false);
    e.target.value = "";
    afterConnect();
  }

  async function reconnect() {
    if (state.storedHandle) {
      try {
        if (await source.hasPermission(state.storedHandle, true)) {
          source.useHandle(state.storedHandle);
          afterConnect();
          scanNow(false);
          return;
        }
      } catch (e) {
        console.warn(e);
      }
      toast("Permission denied — try Change folder in Settings");
    } else {
      $("dir-input").click();
    }
  }

  function afterConnect() {
    renderSourceStatus();
    if (state.view === "welcome" || state.view === null) return showView(state.settings.view);
    if (state.view === "review" && state.qi >= state.queue.length && !$("batch-done").classList.contains("show")) newBatch();
    else if (state.view === "review") renderReview();
    if (state.view === "library") rebuildLibrary();
  }

  // ------------------------------------------------------ import/export

  function exportData() {
    const data = {
      app: "archive-curator",
      version: 1,
      exportedAt: new Date().toISOString(),
      rootName: state.rootName,
      rootPath: state.settings.rootPath,
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
    for (const g of data.galleries || []) {
      if (!state.galleries.some((x) => x.id === g.id)) {
        state.galleries.push(g);
        store.put("galleries", g);
      }
    }
    const changedRecs = [];
    for (const inc of data.records || []) {
      const cur = state.records.get(inc.path);
      if (!cur) {
        const r = { path: inc.path, rating: inc.rating || null, reviewedAt: inc.reviewedAt || null, notes: inc.notes || "", galleries: inc.galleries || [] };
        state.records.set(r.path, r);
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
    if (!state.settings.rootPath && data.rootPath) state.settings.rootPath = data.rootPath;
    saveSettings();
    toast(`Imported ${fmt(changedRecs.length)} records, ${fmt((data.galleries || []).length)} galleries`);
    renderStats();
    if (state.view === "library") rebuildLibrary();
  }

  // ---------------------------------------------------------- settings

  function openSettings() {
    $("set-folder").innerHTML = state.rootName
      ? `<b>${esc(state.rootName)}</b> — ${fmt(state.files.length)} images ${source.connected ? "(connected, read-only)" : "(not connected)"}`
      : "No folder chosen yet.";
    $("set-root-path").value = state.settings.rootPath;
    $("set-queue-size").value = state.settings.queueSize;
    $("set-rescan").disabled = !source.connected;
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
        $("grid").querySelectorAll(".cell").forEach(decorateCell);
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
      else return;
      e.preventDefault();
      return;
    }

    if (k === "i" && state.view !== "welcome") return toggleDetails();
    if (k === "f") return toggleFullscreen();
    if (k === "r" && state.view !== "welcome") return showView("review");
    if (k === "l" && state.view !== "welcome") return showView("library");

    if (state.view === "review") {
      const done = $("batch-done").classList.contains("show");
      if (done) {
        if (k === "Enter" || k === " ") newBatch();
        else if (k === "Backspace" || k === "z") back();
        else return;
        e.preventDefault();
        return;
      }
      const path = state.queue[state.qi];
      if (k === "ArrowRight" || k === "y" || k === "p") reviewRate("yes");
      else if (k === "ArrowUp" || k === "m") reviewRate("maybe");
      else if (k === "ArrowLeft" || k === "n" || k === "x") reviewRate("no");
      else if (k === "ArrowDown" || k === "s") (flashStamp("skip"), advance());
      else if (k === "Backspace" || k === "z") back();
      else if ((k === "0" || k === "u") && path) setRating(path, null);
      else if (k === "Enter" && path) openLightbox(state.queue, state.qi);
      else return;
      e.preventDefault();
    } else if (state.view === "library") {
      if (k === "+" || k === "=") setThumbSize(state.settings.thumbSize + 40);
      else if (k === "-") setThumbSize(state.settings.thumbSize - 40);
      else if (k === "Escape") clearSelection();
      else return;
      e.preventDefault();
    }
  }

  // Flick the review image: right = yes, left = no, up = maybe.
  function bindSwipe(stage) {
    let start = null;
    stage.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !state.queue[state.qi]) return;
      start = { x: e.clientX, y: e.clientY };
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener("pointermove", (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      $("review-img").style.transform = `translate(${dx * 0.4}px, ${dy * 0.4}px) rotate(${dx * 0.02}deg)`;
    });
    const end = (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      start = null;
      $("review-img").style.transform = "";
      if (e.type === "pointercancel") return;
      if (Math.abs(dx) > 90 && Math.abs(dx) > Math.abs(dy)) reviewRate(dx > 0 ? "yes" : "no");
      else if (dy < -90) reviewRate("maybe");
      else if (Math.abs(dx) < 5 && Math.abs(dy) < 5) openLightbox(state.queue, state.qi);
    };
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
  }

  // ------------------------------------------------------------- bind

  function bind() {
    document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => showView(b.dataset.view)));
    $("settings-btn").onclick = openSettings;
    $("pick-btn").onclick = chooseFolder;
    $("dir-input").onchange = onDirInput;
    $("browser-note").textContent = source.supportsHandles
      ? "Your browser remembers the folder; next time it's one click to reconnect."
      : "Tip: in Chrome or Edge the folder is remembered between sessions. In this browser you'll re-pick it each visit (your ratings are kept either way).";

    // review
    $("queue-source").value = state.settings.queueSource;
    $("queue-source").onchange = (e) => {
      state.settings.queueSource = e.target.value;
      saveSettings();
      newBatch();
    };
    $("queue-scope").value = state.settings.scope;
    let scopeTimer = null;
    $("queue-scope").oninput = (e) => {
      state.settings.scope = e.target.value;
      saveSettings();
      clearTimeout(scopeTimer);
      scopeTimer = setTimeout(newBatch, 500);
    };
    $("rate-bar").onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const act = b.dataset.act;
      if (RATINGS.includes(act)) reviewRate(act);
      else if (act === "skip") (flashStamp("skip"), advance());
      else if (act === "back") back();
      else if (act === "info") toggleDetails();
    };
    $("review-msg").onclick = (e) => e.target.closest('[data-act="reconnect"]') && reconnect();
    $("filmstrip").onclick = (e) => {
      const b = e.target.closest(".film");
      if (!b) return;
      state.qi = +b.dataset.i;
      $("batch-done").classList.remove("show");
      renderReview();
    };
    $("batch-grid").onclick = (e) => {
      const b = e.target.closest(".film");
      if (b) openLightbox(state.queue, +b.dataset.i);
    };
    $("next-batch-btn").onclick = newBatch;
    $("to-library-btn").onclick = () => showView("library");
    bindSwipe($("review-stage"));

    // library
    $("rating-list").onclick = (e) => {
      const li = e.target.closest("li[data-filter]");
      if (!li) return;
      state.settings.libFilter = li.dataset.filter;
      state.lib.gallery = null;
      saveSettings();
      rebuildLibrary();
    };
    const gl = $("gallery-list");
    gl.onclick = (e) => {
      const li = e.target.closest("li[data-gallery]");
      if (!li) return;
      const act = e.target.closest("[data-g-act]");
      if (act) return act.dataset.gAct === "rename" ? renameGallery(li.dataset.gallery) : deleteGallery(li.dataset.gallery);
      state.lib.gallery = li.dataset.gallery;
      rebuildLibrary();
    };
    gl.addEventListener("dragover", (e) => {
      const li = e.target.closest("li[data-gallery]");
      if (!li || !e.dataTransfer.types.includes("application/x-curator-paths")) return;
      e.preventDefault();
      gl.querySelectorAll(".drop").forEach((x) => x.classList.remove("drop"));
      li.classList.add("drop");
    });
    gl.addEventListener("dragleave", (e) => {
      const li = e.target.closest("li[data-gallery]");
      if (li && !li.contains(e.relatedTarget)) li.classList.remove("drop");
    });
    gl.addEventListener("drop", (e) => {
      const li = e.target.closest("li[data-gallery]");
      if (!li) return;
      e.preventDefault();
      li.classList.remove("drop");
      const paths = JSON.parse(e.dataTransfer.getData("application/x-curator-paths") || "[]");
      if (paths.length) addToGallery(paths, li.dataset.gallery);
    });
    $("new-gallery-btn").onclick = newGallery;

    const grid = $("grid");
    grid.onclick = (e) => {
      const cell = e.target.closest(".cell");
      if (!cell) return;
      const i = +cell.dataset.i;
      if (e.ctrlKey || e.metaKey || e.shiftKey) selectCell(i, e);
      else openLightbox(state.lib.items, i);
    };
    grid.addEventListener("dragstart", (e) => {
      const cell = e.target.closest(".cell");
      if (!cell) return;
      const p = cell.dataset.path;
      const paths = state.lib.selected.has(p) ? [...state.lib.selected] : [p];
      e.dataTransfer.setData("application/x-curator-paths", JSON.stringify(paths));
      e.dataTransfer.setData("text/plain", paths.map(fullPath).join("\n"));
      e.dataTransfer.effectAllowed = "copy";
    });
    grid.addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        setThumbSize(state.settings.thumbSize - Math.sign(e.deltaY) * 20);
      },
      { passive: false }
    );
    let searchTimer = null;
    $("lib-search").oninput = (e) => {
      state.lib.search = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(rebuildLibrary, 200);
    };
    $("lib-sort").value = state.settings.libSort;
    $("lib-sort").onchange = (e) => {
      state.settings.libSort = e.target.value;
      saveSettings();
      rebuildLibrary();
    };
    $("thumb-size").value = state.settings.thumbSize;
    $("thumb-size").oninput = (e) => setThumbSize(+e.target.value);
    $("fit-btn").onclick = () => {
      state.settings.fit = state.settings.fit === "contain" ? "cover" : "contain";
      saveSettings();
      grid.classList.toggle("fit", state.settings.fit === "contain");
      $("fit-btn").textContent = state.settings.fit === "contain" ? "Fit" : "Crop";
    };
    $("select-add").onclick = () => {
      let id = $("select-gallery").value;
      if (id === "__new") {
        const g = newGallery();
        if (!g) return;
        id = g.id;
      }
      addToGallery([...state.lib.selected], id);
      renderSelectBar();
    };
    $("select-remove").onclick = () => {
      if (!state.lib.gallery) return;
      addToGallery([...state.lib.selected], state.lib.gallery, true);
      state.lib.selected.clear();
      rebuildLibrary();
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
    $("set-change").onclick = () => {
      $("settings").close();
      chooseFolder();
    };
    $("set-rescan").onclick = () => {
      $("settings").close();
      scanNow(true);
    };
    $("set-root-path").oninput = (e) => {
      state.settings.rootPath = e.target.value.trim();
      saveSettings();
    };
    $("set-queue-size").oninput = (e) => {
      const n = parseInt(e.target.value, 10);
      if (n > 0) state.settings.queueSize = Math.min(200, n);
      saveSettings();
    };
    $("set-export").onclick = exportData;
    $("set-import").onclick = () => $("import-input").click();
    $("import-input").onchange = (e) => {
      if (e.target.files[0]) importData(e.target.files[0]);
      e.target.value = "";
    };
    $("set-clear-thumbs").onclick = async () => {
      await images.clearThumbCache();
      toast("Thumbnail cache cleared");
    };

    document.addEventListener("keydown", onKey);
  }

  // -------------------------------------------------------------- init

  async function init() {
    const [settings, files, rootName, handle, recs, gals] = await Promise.all([
      store.get("kv", "settings"),
      store.get("kv", "files"),
      store.get("kv", "rootName"),
      store.get("kv", "rootHandle").catch(() => null),
      store.getAll("records"),
      store.getAll("galleries"),
    ]);
    Object.assign(state.settings, settings || {});
    state.files = files || [];
    state.fileSet = new Set(state.files);
    state.rootName = rootName || "";
    state.storedHandle = handle || null;
    for (const r of recs) state.records.set(r.path, r);
    state.galleries = gals.sort((a, b) => a.created - b.created);
    document.body.classList.toggle("details-open", !!state.settings.detailsOpen);

    bind();

    let connected = false;
    if (handle && source.supportsHandles) {
      try {
        connected = await source.hasPermission(handle, false);
      } catch (e) {
        /* stale handle */
      }
      if (connected) source.useHandle(handle);
    }
    renderStats();
    renderSourceStatus();
    showView(state.settings.view);
    if (connected) scanNow(false);
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
    toggleDetails,
    state,
  };

  init().catch((e) => {
    console.error(e);
    document.body.insertAdjacentHTML("afterbegin", `<p class="fatal">Failed to start: ${esc(e.message)}</p>`);
  });
})();
