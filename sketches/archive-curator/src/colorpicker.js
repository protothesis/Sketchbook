// Colour-search popover: an HSV wheel (hue around, saturation outward),
// brightness and range sliders, and a row of neutrals. Calls
// onChange({ h, s, v, tol, hex, lab }) as you drag.
(function () {
  const C = (window.Curator = window.Curator || {});
  const SIZE = 180;
  const R = SIZE / 2 - 1;
  let el = null;
  let cur = null;
  let onChange = null;
  let onClear = null;
  let anchor = null;

  const PRESETS = [
    [0, 0, 1],
    [0, 0, 0.75],
    [0, 0, 0.5],
    [0, 0, 0.25],
    [0, 0, 0.03],
    [30, 0.3, 0.9],
    [25, 0.55, 0.45],
    [210, 0.25, 0.35],
  ];

  function hsvToRgb(h, s, v) {
    const f = (n) => {
      const k = (n + h / 60) % 6;
      return Math.round(255 * (v - v * s * Math.max(Math.min(k, 4 - k, 1), 0)));
    };
    return [f(5), f(3), f(1)];
  }
  const hex = (rgb) => "#" + rgb.map((x) => x.toString(16).padStart(2, "0")).join("");

  function build() {
    el = document.createElement("div");
    el.className = "color-pop";
    el.innerHTML = `
      <canvas width="${SIZE}" height="${SIZE}"></canvas>
      <div class="cp-side">
        <div class="cp-swatch"></div>
        <label>Brightness <input type="range" class="cp-v" min="0" max="100" /></label>
        <label>Range <input type="range" class="cp-tol" min="5" max="35" title="How far from this colour still counts" /></label>
        <div class="cp-presets">${PRESETS.map((p, i) => `<button data-p="${i}" style="background:${hex(hsvToRgb(...p))}"></button>`).join("")}</div>
        <div class="row"><button class="tiny cp-clear">Clear</button><button class="tiny cp-done">Done</button></div>
      </div>`;
    document.body.appendChild(el);
    const cv = el.querySelector("canvas");
    let dragging = false;
    const pick = (e) => {
      const r = cv.getBoundingClientRect();
      const dx = e.clientX - r.left - SIZE / 2;
      const dy = e.clientY - r.top - SIZE / 2;
      cur.h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
      cur.s = Math.min(1, Math.hypot(dx, dy) / R);
      if (cur.v < 0.15) cur.v = 0.85; // picking a hue in the dark is confusing
      update(true);
    };
    cv.addEventListener("pointerdown", (e) => {
      dragging = true;
      cv.setPointerCapture(e.pointerId);
      pick(e);
    });
    cv.addEventListener("pointermove", (e) => dragging && pick(e));
    cv.addEventListener("pointerup", () => (dragging = false));
    el.querySelector(".cp-v").oninput = (e) => {
      cur.v = e.target.value / 100;
      update(true);
    };
    el.querySelector(".cp-tol").oninput = (e) => {
      cur.tol = e.target.value / 100;
      update(false);
    };
    el.querySelector(".cp-presets").onclick = (e) => {
      const b = e.target.closest("[data-p]");
      if (!b) return;
      [cur.h, cur.s, cur.v] = PRESETS[+b.dataset.p];
      update(true);
    };
    el.querySelector(".cp-clear").onclick = () => {
      close();
      if (onClear) onClear();
    };
    el.querySelector(".cp-done").onclick = close;
    document.addEventListener("pointerdown", (e) => {
      if (el.classList.contains("open") && !el.contains(e.target) && !(anchor && anchor.contains(e.target))) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && el.classList.contains("open")) {
        e.stopPropagation();
        close();
      }
    }, true);
  }

  function drawWheel() {
    const cv = el.querySelector("canvas");
    const ctx = cv.getContext("2d");
    const img = ctx.createImageData(SIZE, SIZE);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const dx = x - SIZE / 2;
        const dy = y - SIZE / 2;
        const r = Math.hypot(dx, dy);
        const o = (y * SIZE + x) * 4;
        if (r > R) continue;
        const rgb = hsvToRgb(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360, r / R, cur.v);
        img.data[o] = rgb[0];
        img.data[o + 1] = rgb[1];
        img.data[o + 2] = rgb[2];
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const a = (cur.h * Math.PI) / 180;
    ctx.beginPath();
    ctx.arc(SIZE / 2 + Math.cos(a) * cur.s * R, SIZE / 2 + Math.sin(a) * cur.s * R, 6, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = cur.v > 0.6 ? "#000" : "#fff";
    ctx.stroke();
  }

  let lastV = null;
  function update(notify) {
    if (cur.v !== lastV || notify) drawWheel();
    lastV = cur.v;
    const rgb = hsvToRgb(cur.h, cur.s, cur.v);
    cur.hex = hex(rgb);
    cur.lab = C.features.rgbToLab(...rgb);
    el.querySelector(".cp-swatch").style.background = cur.hex;
    el.querySelector(".cp-v").value = Math.round(cur.v * 100);
    el.querySelector(".cp-tol").value = Math.round(cur.tol * 100);
    if (onChange) onChange({ ...cur });
  }

  function open(anchorEl, init, change, clear) {
    if (!el) build();
    anchor = anchorEl;
    cur = { h: 20, s: 0.7, v: 0.85, tol: 0.14, ...(init || {}) };
    onChange = change;
    onClear = clear;
    const r = anchorEl.getBoundingClientRect();
    el.style.left = Math.max(8, Math.min(window.innerWidth - 340, r.left)) + "px";
    el.style.top = r.bottom + 6 + "px";
    el.classList.add("open");
    lastV = null;
    update(true);
  }

  function close() {
    if (el) el.classList.remove("open");
  }

  C.colorPicker = { open, close, hsvToRgb, hex, isOpen: () => !!el && el.classList.contains("open") };
})();
