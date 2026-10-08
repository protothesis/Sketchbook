// The side panel shown next to the review stage and the lightbox: path +
// copy buttons, rating, gallery membership, markdown notes, and whatever
// generation metadata (prompt, seed, model...) the PNG carries.
(function () {
  const C = (window.Curator = window.Curator || {});
  const esc = (s) => C.markdown.esc(String(s));
  const metaCache = new Map(); // path -> Promise<meta|null>

  function readMeta(path) {
    if (!metaCache.has(path)) {
      const p = C.source.getFile(path).then((f) => C.pngmeta.read(f));
      p.catch(() => metaCache.delete(path));
      metaCache.set(path, p);
    }
    return metaCache.get(path);
  }

  function render(panel, path) {
    const app = C.app;
    panel.dataset.path = path || "";
    if (!path) {
      panel.innerHTML = "";
      return;
    }
    const rec = app.record(path);
    const name = path.slice(path.lastIndexOf("/") + 1);
    const folder = path.slice(0, Math.max(0, path.lastIndexOf("/")));
    const notes = (rec && rec.notes) || "";
    panel.innerHTML = `
      <div class="d-head">
        <div>
          <div class="d-name" title="${esc(path)}">${esc(name)}</div>
          <div class="d-folder">${esc(folder || "(root)")}</div>
        </div>
        <button class="icon-btn" data-d="close" title="Hide (I)">&times;</button>
      </div>
      <div class="d-actions">
        <button data-d="copy" title="Copy full file path — paste into Explorer's address bar">Copy path</button>
        <button data-d="copy-folder" title="Copy the containing folder's path">Copy folder</button>
        <button data-d="show-folder" title="Browse this image's folder in the library">Show in folder</button>
        <button data-d="open" title="Open the original in a new tab">Open &#8599;</button>
      </div>
      <div class="seg d-rating">
        <button class="rate yes" data-rate="yes">Yes</button>
        <button class="rate maybe" data-rate="maybe">Maybe</button>
        <button class="rate no" data-rate="no">No</button>
        <button data-rate="" title="Clear rating">&ndash;</button>
      </div>
      <h4>Galleries</h4>
      <div class="chips d-galleries"></div>
      <h4>Notes <span class="seg mini"><button data-d="write">Write</button><button data-d="preview">Preview</button></span></h4>
      <textarea class="d-notes" placeholder="Markdown notes&hellip;"></textarea>
      <div class="md d-preview" title="Click to edit"></div>
      <h4>Colours <button class="tiny" data-d="similar" title="Images with a similar colour make-up">Similar colours</button></h4>
      <div class="d-palette muted small">Analysing&hellip;</div>
      <h4>Generation</h4>
      <div class="d-meta muted">Reading&hellip;</div>`;

    const ta = panel.querySelector(".d-notes");
    const preview = panel.querySelector(".d-preview");
    ta.value = notes;
    setNotesMode(panel, notes.trim() ? "preview" : "write");

    let timer = null;
    const save = () => {
      clearTimeout(timer);
      if (panel.dataset.path === path) app.setNotes(path, ta.value);
    };
    ta.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(save, 400);
    });
    ta.addEventListener("blur", save);
    preview.addEventListener("click", (e) => {
      if (e.target.closest("a")) return;
      setNotesMode(panel, "write");
      ta.focus();
    });

    panel.onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.rate !== undefined) return app.setRating(path, b.dataset.rate || null);
      if (b.dataset.gallery) return app.toggleGallery(path, b.dataset.gallery);
      switch (b.dataset.d) {
        case "close": return app.toggleDetails(false);
        case "copy": return app.copyPath(path, false);
        case "copy-folder": return app.copyPath(path, true);
        case "open": return app.openOriginal(path);
        case "show-folder": return app.showInFolder(path);
        case "similar": return app.findSimilar(path);
        case "swatch": return app.searchColor(JSON.parse(b.dataset.lab));
        case "write": setNotesMode(panel, "write"); return ta.focus();
        case "preview": save(); return setNotesMode(panel, "preview");
        case "new-gallery": {
          const g = app.newGallery();
          if (g) app.toggleGallery(path, g.id);
          return;
        }
        case "copy-text": return app.copyText(b.parentElement.querySelector("pre").textContent, "Copied prompt");
        case "copy-workflow":
          return readMeta(path).then((m) => m && m.raw.workflow && app.copyText(m.raw.workflow, "Copied workflow JSON"));
      }
    };

    refresh(panel);
    renderPalette(panel, path);
    renderMeta(panel, path);
  }

  // Palette from the background indexer (computed now if it hasn't got
  // there yet). Click a swatch to search for that colour.
  async function renderPalette(panel, path) {
    const e = await C.features.analyzeNow(path);
    if (panel.dataset.path !== path) return;
    const box = panel.querySelector(".d-palette");
    if (!e || !e.pal || !e.pal.length) {
      box.textContent = C.source.isConnected(path) ? "Couldn't analyse colours." : "Reconnect the folder to analyse colours.";
      return;
    }
    box.classList.remove("muted", "small");
    box.innerHTML = e.pal
      .map((c) => `<button class="swatch" data-d="swatch" data-lab="${esc(JSON.stringify(c.slice(0, 3)))}" style="background:${C.features.labHex(c)};flex-grow:${c[3]}" title="${Math.round(c[3] * 100)}% — click to find this colour"></button>`)
      .join("");
  }

  function setNotesMode(panel, mode) {
    const ta = panel.querySelector(".d-notes");
    const preview = panel.querySelector(".d-preview");
    if (mode === "preview") preview.innerHTML = C.markdown.render(ta.value) || '<p class="muted">No notes yet — click to write.</p>';
    ta.hidden = mode !== "write";
    preview.hidden = mode !== "preview";
    panel.querySelectorAll('[data-d="write"],[data-d="preview"]').forEach((b) => b.classList.toggle("on", b.dataset.d === mode));
  }

  // Cheap update of rating + gallery chips without touching the notes editor.
  function refresh(panel) {
    const path = panel.dataset.path;
    if (!path || !panel.querySelector(".d-rating")) return;
    const rec = C.app.record(path);
    const rating = (rec && rec.rating) || "";
    panel.querySelectorAll(".d-rating button").forEach((b) => b.classList.toggle("on", b.dataset.rate === rating));
    const inG = new Set((rec && rec.galleries) || []);
    panel.querySelector(".d-galleries").innerHTML =
      C.app.galleries().map((g) => `<button class="chip ${inG.has(g.id) ? "on" : ""}" data-gallery="${esc(g.id)}">${esc(g.name)}</button>`).join("") +
      `<button class="chip add" data-d="new-gallery">+ New</button>`;
  }

  async function renderMeta(panel, path) {
    const box = panel.querySelector(".d-meta");
    let meta;
    try {
      meta = await readMeta(path);
    } catch (e) {
      meta = undefined;
    }
    if (panel.dataset.path !== path) return;
    if (meta === undefined) {
      box.textContent = C.source.isConnected(path) ? "Couldn't read file." : "Reconnect the folder to read metadata.";
      return;
    }
    if (!meta) {
      box.textContent = "No embedded metadata.";
      return;
    }
    const parts = [];
    const block = (label, text, cls) =>
      `<div class="prompt ${cls || ""}"><div class="label">${label}<button class="tiny" data-d="copy-text">copy</button></div><pre>${esc(text)}</pre></div>`;
    if (meta.comfy) {
      const c = meta.comfy;
      c.positive.forEach((t) => parts.push(block("Prompt", t)));
      if (c.negative.length) parts.push(`<details><summary>Negative</summary>${c.negative.map((t) => block("Negative", t, "neg")).join("")}</details>`);
      const rows = c.params.slice();
      c.models.forEach((m) => rows.push(["model", m]));
      c.loras.forEach((l) => rows.push(["lora", l]));
      if (rows.length) parts.push(`<table class="params">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>`);
    }
    if (meta.a1111) parts.push(block("Parameters", meta.a1111));
    const keys = Object.keys(meta.raw);
    parts.push(
      `<div class="muted small">Chunks: ${keys.map(esc).join(", ")}` +
        (meta.raw.workflow ? ` &middot; <button class="tiny" data-d="copy-workflow">copy workflow JSON</button>` : "") +
        `</div>`
    );
    box.classList.remove("muted");
    box.innerHTML = parts.join("");
  }

  C.details = { render, refresh };
})();
