// Colour-search popover. One canvas control does everything:
//
//   centre disc   hue (angle) x saturation (distance) at the current
//                 brightness; colours outside the search Range are dimmed,
//                 so you can see exactly what counts as a match
//   hue ring      full-strength hues that never dim, with a marker, so you
//                 know where you are even at brightness 0; drag it to change hue
//   left arc      brightness (bottom = black, top = full) — or scroll
//   right arc     range (bottom = tight, top = loose) — or Shift+scroll
//
// Below it: Swatches (your own palettes, any size, any number) and
// Profiles (saved colour make-ups of images, with their proportions).
// Both persist in IndexedDB (kv "colorPalettes" / "colorProfiles").
(function () {
  const C = (window.Curator = window.Curator || {});
  const SIZE = 248;
  const CX = SIZE / 2;
  const R_DISC = 84;
  const R_RING0 = 89;
  const R_RING1 = 101;
  const R_ARC0 = 107;
  const R_ARC1 = 119;
  const TOL_MIN = 0.04;
  const TOL_MAX = 0.36;
  // Arc angles in canvas degrees (0 = right, 90 = down).
  const V_FROM = 120; // brightness: bottom-left (0) ...
  const V_TO = 240; // ... to top-left (1)
  const T_FROM = 60; // range: bottom-right (tight) ...
  const T_TO = -60; // ... to top-right (loose)

  let el = null;
  let cur = null;
  let cb = {};
  let anchor = null;
  let data = null; // { palettes, profiles, active, tab }

  function hsvToRgb(h, s, v) {
    const f = (n) => {
      const k = (n + h / 60) % 6;
      return Math.round(255 * (v - v * s * Math.max(Math.min(k, 4 - k, 1), 0)));
    };
    return [f(5), f(3), f(1)];
  }
  const hex = (rgb) => "#" + rgb.map((x) => x.toString(16).padStart(2, "0")).join("");
  const hsvHex = (c) => hex(hsvToRgb(c.h, c.s, c.v));
  const esc = (s) => C.markdown.esc(String(s));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const rad = (deg) => (deg * Math.PI) / 180;
  const tolT = (tol) => (tol - TOL_MIN) / (TOL_MAX - TOL_MIN);

  // ------------------------------------------------------------ storage

  async function load() {
    if (data) return data;
    const [palettes, profiles, ui] = await Promise.all([
      C.store.get("kv", "colorPalettes"),
      C.store.get("kv", "colorProfiles"),
      C.store.get("kv", "colorPickerUi"),
    ]);
    data = { palettes: palettes || [], profiles: profiles || [], active: (ui || {}).active || null, tab: (ui || {}).tab || "swatches" };
    return data;
  }
  const saveData = () => {
    C.store.put("kv", data.palettes, "colorPalettes");
    C.store.put("kv", data.profiles, "colorProfiles");
    C.store.put("kv", { active: data.active, tab: data.tab }, "colorPickerUi");
  };
  const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  // ------------------------------------------------------------ build

  function build() {
    el = document.createElement("div");
    el.className = "color-pop";
    el.innerHTML = `
      <canvas width="${SIZE}" height="${SIZE}"></canvas>
      <div class="cp-row">
        <button class="cp-swatch" title="Add this colour to the current palette"></button>
        <span class="cp-hex"></span>
        <span class="spacer"></span>
        <button class="tiny cp-clear" title="Stop searching by colour">Clear</button>
        <button class="tiny cp-done">Done</button>
      </div>
      <div class="cp-hint">Scroll: brightness &middot; Shift+scroll: range</div>
      <div class="cp-tabs seg mini"><button data-tab="swatches">Swatches</button><button data-tab="profiles">Profiles</button></div>
      <div class="cp-body"></div>`;
    document.body.appendChild(el);
    const cv = el.querySelector("canvas");

    let mode = null;
    const regionAt = (e) => {
      const r = cv.getBoundingClientRect();
      const dx = e.clientX - r.left - CX;
      const dy = e.clientY - r.top - CX;
      const d = Math.hypot(dx, dy);
      const ang = (Math.atan2(dy, dx) * 180) / Math.PI; // -180..180
      if (d <= R_DISC + 2) return { mode: "disc", dx, dy, d, ang };
      if (d <= R_RING1 + 2) return { mode: "ring", dx, dy, d, ang };
      if (d <= R_ARC1 + 4) {
        const a = (ang + 360) % 360;
        if (a >= V_FROM - 8 && a <= V_TO + 8) return { mode: "v", ang: a };
        if (ang >= T_TO - 8 && ang <= T_FROM + 8) return { mode: "tol", ang };
      }
      return null;
    };
    const apply = (e) => {
      const r = cv.getBoundingClientRect();
      const dx = e.clientX - r.left - CX;
      const dy = e.clientY - r.top - CX;
      const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (mode === "disc") {
        cur.h = (ang + 360) % 360;
        cur.s = Math.min(1, Math.hypot(dx, dy) / R_DISC);
      } else if (mode === "ring") {
        cur.h = (ang + 360) % 360;
      } else if (mode === "v") {
        cur.v = clamp(((ang + 360) % 360 - V_FROM) / (V_TO - V_FROM), 0, 1);
      } else if (mode === "tol") {
        cur.tol = TOL_MIN + clamp((T_FROM - ang) / (T_FROM - T_TO), 0, 1) * (TOL_MAX - TOL_MIN);
      }
      update(true);
    };
    cv.addEventListener("pointerdown", (e) => {
      const reg = regionAt(e);
      if (!reg) return;
      mode = reg.mode;
      cv.setPointerCapture(e.pointerId);
      apply(e);
    });
    cv.addEventListener("pointermove", (e) => {
      if (mode) return apply(e);
      const reg = regionAt(e);
      cv.style.cursor = reg ? (reg.mode === "disc" ? "crosshair" : "pointer") : "default";
      cv.title = !reg ? "" : { disc: "Pick a colour", ring: "Hue", v: "Brightness (or scroll)", tol: "Range: how close counts as a match (or Shift+scroll)" }[reg.mode];
    });
    cv.addEventListener("pointerup", () => (mode = null));
    cv.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const d = -Math.sign(e.deltaY || e.deltaX);
        if (e.shiftKey) cur.tol = clamp(cur.tol + d * 0.01, TOL_MIN, TOL_MAX);
        else cur.v = clamp(cur.v + d * 0.04, 0, 1);
        update(true);
      },
      { passive: false }
    );

    el.querySelector(".cp-swatch").onclick = () => addToPalette(activePalette(true));
    el.querySelector(".cp-clear").onclick = () => {
      close();
      if (cb.onClear) cb.onClear();
    };
    el.querySelector(".cp-done").onclick = close;
    el.querySelector(".cp-tabs").onclick = (e) => {
      const b = e.target.closest("[data-tab]");
      if (!b) return;
      data.tab = b.dataset.tab;
      saveData();
      renderBody();
    };
    bindBody(el.querySelector(".cp-body"));

    document.addEventListener("pointerdown", (e) => {
      if (el.classList.contains("open") && !el.contains(e.target) && !(anchor && anchor.contains(e.target))) close();
    });
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape" && el.classList.contains("open")) {
          e.stopPropagation();
          close();
        }
      },
      true
    );
  }

  // ------------------------------------------------------------ drawing

  function draw() {
    const cv = el.querySelector("canvas");
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, SIZE, SIZE);
    const img = ctx.createImageData(SIZE, SIZE);
    const px = img.data;
    const target = cur.lab;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const dx = x - CX + 0.5;
        const dy = y - CX + 0.5;
        const d = Math.hypot(dx, dy);
        const o = (y * SIZE + x) * 4;
        const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
        let rgb;
        if (d <= R_DISC) {
          rgb = hsvToRgb(h, d / R_DISC, cur.v);
          // Dim what falls outside the range: what's left lit is what matches.
          const lab = C.features.rgbToLab(rgb[0], rgb[1], rgb[2]);
          const dist = Math.hypot(lab[0] - target[0], lab[1] - target[1], lab[2] - target[2]);
          if (dist > cur.tol) rgb = rgb.map((c) => c * 0.28 + 20);
        } else if (d >= R_RING0 && d <= R_RING1) {
          rgb = hsvToRgb(h, 1, 1);
        } else continue;
        px[o] = rgb[0];
        px[o + 1] = rgb[1];
        px[o + 2] = rgb[2];
        px[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    const R_MID = (R_ARC0 + R_ARC1) / 2;
    ctx.lineCap = "round";
    // Brightness arc: the current colour from black up to full.
    for (let i = 0; i < 40; i++) {
      ctx.beginPath();
      ctx.strokeStyle = hsvHex({ h: cur.h, s: cur.s, v: i / 39 });
      ctx.lineWidth = R_ARC1 - R_ARC0;
      const a0 = V_FROM + ((V_TO - V_FROM) * i) / 40;
      ctx.arc(CX, CX, R_MID, rad(a0), rad(a0 + (V_TO - V_FROM) / 40 + 0.6));
      ctx.stroke();
    }
    // Range arc: a track, filled up to the current range.
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#3a3a3a";
    ctx.beginPath();
    ctx.arc(CX, CX, R_MID, rad(T_TO), rad(T_FROM));
    ctx.stroke();
    const tAng = T_FROM - tolT(cur.tol) * (T_FROM - T_TO);
    ctx.strokeStyle = "#6aa6e8";
    ctx.beginPath();
    ctx.arc(CX, CX, R_MID, rad(tAng), rad(T_FROM));
    ctx.stroke();

    const dot = (ang, r, size, fill) => {
      ctx.beginPath();
      ctx.arc(CX + Math.cos(rad(ang)) * r, CX + Math.sin(rad(ang)) * r, size, 0, Math.PI * 2);
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#000a";
      ctx.stroke();
    };
    dot(cur.h, cur.s * R_DISC, 6, cur.hex); // picked colour
    dot(cur.h, (R_RING0 + R_RING1) / 2, 5, hsvHex({ h: cur.h, s: 1, v: 1 })); // where in the spectrum
    dot(V_FROM + cur.v * (V_TO - V_FROM), R_MID, 6, hsvHex(cur)); // brightness
    dot(tAng, R_MID, 6, "#6aa6e8"); // range

    ctx.fillStyle = "#8a8a8a";
    ctx.font = "13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("☀", CX + Math.cos(rad(V_TO + 14)) * R_MID, CX + Math.sin(rad(V_TO + 14)) * R_MID);
    ctx.fillText("◎", CX + Math.cos(rad(T_TO - 14)) * R_MID, CX + Math.sin(rad(T_TO - 14)) * R_MID);
  }

  function update(notify) {
    const rgb = hsvToRgb(cur.h, cur.s, cur.v);
    cur.hex = hex(rgb);
    cur.lab = C.features.rgbToLab(...rgb);
    draw();
    el.querySelector(".cp-swatch").style.background = cur.hex;
    el.querySelector(".cp-hex").textContent = cur.hex + "  ·  range " + Math.round(tolT(cur.tol) * 100) + "%";
    if (notify && cb.onChange) cb.onChange({ ...cur });
  }

  // ------------------------------------------------------- swatches tab

  function activePalette(create) {
    let p = data.palettes.find((x) => x.id === data.active);
    if (!p && create) {
      p = data.palettes[data.palettes.length - 1] || newPalette(true);
      data.active = p.id;
    }
    return p;
  }

  function newPalette(silent) {
    const name = silent ? `Palette ${data.palettes.length + 1}` : (prompt("New palette name:", `Palette ${data.palettes.length + 1}`) || "").trim();
    if (!name) return null;
    const p = { id: newId("p"), name, colors: [] };
    data.palettes.push(p);
    data.active = p.id;
    saveData();
    if (!silent) renderBody();
    return p;
  }

  function addToPalette(p) {
    if (!p) return;
    p.colors.push({ h: Math.round(cur.h * 10) / 10, s: Math.round(cur.s * 1000) / 1000, v: Math.round(cur.v * 1000) / 1000 });
    data.active = p.id;
    data.tab = "swatches";
    saveData();
    renderBody();
  }

  function renderBody() {
    el.querySelectorAll(".cp-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === data.tab));
    const body = el.querySelector(".cp-body");
    if (data.tab === "profiles") {
      body.innerHTML = data.profiles.length
        ? data.profiles
            .map(
              (p) => `<div class="prof" data-prof="${esc(p.id)}" title="Find images with this colour make-up">
                <img alt="" data-key="${esc(p.key || "")}" />
                <div class="prof-main"><div class="prof-name">${esc(p.name)}</div>
                <div class="prof-bar">${p.pal.map((c) => `<i style="background:${C.features.labHex(c)};flex-grow:${c[3]}"></i>`).join("")}</div></div>
                <button class="tiny hov" data-act="del-prof" title="Delete profile">&times;</button>
              </div>`
            )
            .join("")
        : `<p class="cp-empty">No profiles yet. In an image's details panel, <b>&#9734; Save</b> next to Colours keeps its colour make-up here.</p>`;
      body.querySelectorAll("img[data-key]").forEach((img) => img.dataset.key && C.images.thumb(img.dataset.key).then((u) => u && (img.src = u)));
      return;
    }
    body.innerHTML =
      (data.palettes.length
        ? data.palettes
            .map(
              (p) => `<div class="pal ${p.id === data.active ? "on" : ""}" data-pal="${esc(p.id)}">
                <div class="pal-head"><span class="pal-name" title="Double-click to rename">${esc(p.name)}</span>
                  <button class="tiny hov" data-act="del-pal" title="Delete palette">&times;</button></div>
                <div class="pal-sw">${p.colors
                  .map((c, i) => `<button class="sw" data-i="${i}" style="background:${hsvHex(c)}" title="Click to use · right-click to remove"></button>`)
                  .join("")}<button class="sw add" data-act="add" title="Add the current colour (click or right-click)">+</button></div>
              </div>`
            )
            .join("")
        : `<p class="cp-empty">No palettes yet. Click the colour preview above to start one, or right-click here.</p>`) +
      `<button class="tiny new-pal" data-act="new-pal">+ New palette</button>`;
  }

  function bindBody(body) {
    body.addEventListener("click", (e) => {
      const act = (e.target.closest("[data-act]") || {}).dataset;
      const pal = e.target.closest("[data-pal]");
      const p = pal && data.palettes.find((x) => x.id === pal.dataset.pal);
      const prof = e.target.closest("[data-prof]");
      if (act && act.act === "new-pal") return newPalette();
      if (act && act.act === "add") return addToPalette(p);
      if (act && act.act === "del-pal") {
        if (confirm(`Delete palette “${p.name}”?`)) {
          data.palettes = data.palettes.filter((x) => x !== p);
          saveData();
          renderBody();
        }
        return;
      }
      if (act && act.act === "del-prof") {
        data.profiles = data.profiles.filter((x) => x.id !== prof.dataset.prof);
        saveData();
        return renderBody();
      }
      const sw = e.target.closest(".sw[data-i]");
      if (sw && p) {
        Object.assign(cur, p.colors[+sw.dataset.i]);
        data.active = p.id;
        saveData();
        update(true);
        renderBody();
        return;
      }
      if (prof && cb.onProfile) cb.onProfile(data.profiles.find((x) => x.id === prof.dataset.prof));
    });
    body.addEventListener("contextmenu", (e) => {
      if (data.tab !== "swatches") return;
      e.preventDefault();
      const pal = e.target.closest("[data-pal]");
      const p = pal && data.palettes.find((x) => x.id === pal.dataset.pal);
      const sw = e.target.closest(".sw[data-i]");
      if (sw && p) {
        p.colors.splice(+sw.dataset.i, 1);
        saveData();
        return renderBody();
      }
      if (p) return addToPalette(p);
      newPalette();
    });
    body.addEventListener("dblclick", (e) => {
      const n = e.target.closest(".pal-name");
      if (!n) return;
      const p = data.palettes.find((x) => x.id === n.closest("[data-pal]").dataset.pal);
      const name = (prompt("Rename palette:", p.name) || "").trim();
      if (!name) return;
      p.name = name;
      saveData();
      renderBody();
    });
  }

  // ------------------------------------------------------------ public

  async function open(anchorEl, init, callbacks) {
    await load();
    if (!el) build();
    anchor = anchorEl;
    cur = { h: 20, s: 0.7, v: 0.85, tol: 0.14, ...(init || {}) };
    cb = callbacks || {};
    const r = anchorEl.getBoundingClientRect();
    el.classList.add("open");
    const w = el.offsetWidth;
    el.style.left = clamp(r.left, 8, window.innerWidth - w - 8) + "px";
    el.style.top = r.bottom + 6 + "px";
    renderBody();
    update(false); // searching starts once you pick something
  }

  function close() {
    if (el) el.classList.remove("open");
  }

  async function addProfile(p) {
    await load();
    data.profiles.unshift({ id: newId("cp"), created: Date.now(), ...p });
    saveData();
    if (el && el.classList.contains("open")) renderBody();
  }

  // Restore from a backup: adds palettes/profiles not already here (by id).
  async function importData(d) {
    await load();
    for (const p of d.palettes || []) if (!data.palettes.some((x) => x.id === p.id)) data.palettes.push(p);
    for (const p of d.profiles || []) if (!data.profiles.some((x) => x.id === p.id)) data.profiles.push(p);
    saveData();
    if (el && el.classList.contains("open")) renderBody();
  }

  C.colorPicker = { open, close, addProfile, importData, hsvToRgb, hex, isOpen: () => !!el && el.classList.contains("open") };
})();
