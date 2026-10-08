// Review module: flashcard-style random batches from whatever folder or
// gallery is selected in the sidebar. Rate yes / maybe / no with keys or
// mouse flicks; a batch summary follows every N images.
//
// Module contract (see Curator.registerModule in app.js): init(api) once,
// show() when its tab opens, onKey(e, k) -> handled?, current() -> the
// image(s) it's showing, plus optional onChange / onSource / onFiles /
// onDetails notifications and settings(container) for the Settings dialog.
(function () {
  const C = window.Curator;
  let api, $, esc, fmt, S;
  const q = { queue: [], qi: 0, session: new Map() };

  const TEMPLATE = `
  <section class="view" id="view-review">
    <div class="review-bar">
      <label>Queue
        <select id="queue-source">
          <option value="unreviewed">Unrated</option>
          <option value="maybe">Maybes (re-rate)</option>
          <option value="yes">Yeses (re-rate)</option>
          <option value="no">Nos (second chance)</option>
        </select>
      </label>
      <span class="muted">from <b id="review-src"></b></span>
      <label>Path contains
        <input type="search" id="queue-scope" placeholder="e.g. 2024-05" />
      </label>
      <span class="spacer"></span>
      <span class="session-stats" id="session-stats"></span>
    </div>
    <div class="review-body">
      <div class="review-main">
        <div class="stage" id="review-stage">
          <img id="review-img" alt="" />
          <div class="stamp" id="review-stamp"></div>
          <div class="stage-msg" id="review-msg"></div>
        </div>
        <div class="rate-bar" id="rate-bar">
          <button data-act="back" title="Back (Backspace)">&#8630; Back</button>
          <span class="spacer"></span>
          <button class="rate no" data-act="no" title="No (&larr; or N)"><kbd>&larr;</kbd> No</button>
          <button class="rate maybe" data-act="maybe" title="Maybe (&uarr; or M)"><kbd>&uarr;</kbd> Maybe</button>
          <button class="rate yes" data-act="yes" title="Yes (&rarr; or Y)"><kbd>&rarr;</kbd> Yes</button>
          <span class="spacer"></span>
          <button data-act="skip" title="Skip (&darr; or S)">Skip <kbd>&darr;</kbd></button>
          <button data-act="info" title="Details & notes (I)">Info <kbd>I</kbd></button>
        </div>
        <div class="filmstrip" id="filmstrip"></div>
      </div>
      <aside class="details-panel" id="review-details"></aside>
    </div>
    <div class="batch-done" id="batch-done">
      <div class="batch-card">
        <h2>Batch done</h2>
        <p id="batch-summary"></p>
        <div class="batch-grid" id="batch-grid"></div>
        <div class="batch-actions">
          <button class="primary big" id="next-batch-btn">Next batch <kbd>Enter</kbd></button>
          <button class="big" id="to-library-btn">Library <kbd>L</kbd></button>
        </div>
      </div>
    </div>
  </section>`;

  const record = (p) => api.record(p) || {};
  const current = () => q.queue[q.qi];
  const active = () => api.isActive("review");

  function buildPool() {
    const src = S.queueSource || "unreviewed";
    const scope = (S.scope || "").trim().toLowerCase();
    return api.srcKeys().filter((p) => {
      if (!C.source.isConnected(p)) return false; // review needs the full image
      const r = record(p);
      if (src === "unreviewed" ? r.rating : r.rating !== src) return false;
      return !scope || p.toLowerCase().includes(scope);
    });
  }

  function newBatch() {
    $("batch-done").classList.remove("show");
    q.queue = api.sample(buildPool(), S.queueSize || 10);
    q.qi = 0;
    renderReview();
  }

  let token = 0;
  function renderReview() {
    const path = current();
    const img = $("review-img");
    const msg = $("review-msg");
    const stage = $("review-stage");
    $("review-src").textContent = api.srcLabel();
    renderFilmstrip();
    renderSession();
    if (!path) {
      img.removeAttribute("src");
      stage.dataset.rating = "";
      C.details.render($("review-details"), null);
      const anyConnected = api.srcKeys().some((p) => C.source.isConnected(p));
      if (!anyConnected && api.srcKeys().length) {
        msg.innerHTML = `<p>This folder isn't connected — use <b>Reconnect</b> at the top right.</p>`;
      } else if (q.qi >= q.queue.length && q.queue.length) {
        msg.textContent = "";
      } else {
        const what = S.queueSource === "unreviewed" || !S.queueSource ? "unrated images" : S.queueSource + "s";
        msg.innerHTML = `<p>No ${esc(what)} left in <b>${esc(api.srcLabel())}</b>${S.scope ? " matching “" + esc(S.scope) + "”" : ""}.</p>`;
      }
      return;
    }
    msg.textContent = "";
    stage.dataset.rating = record(path).rating || "";
    const t = ++token;
    img.classList.add("loading");
    C.images
      .fullUrl(path)
      .then((url) => {
        if (t !== token) return;
        if (img.src === url && img.complete) return img.classList.remove("loading");
        img.onload = () => t === token && img.classList.remove("loading");
        img.src = url;
      })
      .catch(() => {
        if (t === token) msg.innerHTML = `<p>Couldn't read <code>${esc(path)}</code> — moved or deleted?</p>`;
      });
    if (S.detailsOpen) C.details.render($("review-details"), path);
    C.images.preload(q.queue.slice(q.qi + 1, q.qi + 3));
  }

  function renderFilmstrip() {
    const fs = $("filmstrip");
    fs.innerHTML = "";
    q.queue.forEach((p, i) => {
      const cell = document.createElement("button");
      cell.className = "film " + (record(p).rating || "") + (i === q.qi ? " current" : "");
      cell.dataset.i = i;
      cell.title = p;
      const img = document.createElement("img");
      img.draggable = false;
      cell.appendChild(img);
      api.setThumb(img, p, cell);
      fs.appendChild(cell);
    });
  }

  function renderSession() {
    const s = { yes: 0, maybe: 0, no: 0 };
    for (const r of q.session.values()) s[r]++;
    const n = q.session.size;
    $("session-stats").textContent = n ? `This session: ${n} rated · ${s.yes} yes · ${s.maybe} maybe · ${s.no} no` : "";
  }

  function flashStamp(rating) {
    const s = $("review-stamp");
    s.className = "stamp";
    void s.offsetWidth; // restart the animation
    s.textContent = { yes: "YES", maybe: "MAYBE", no: "NO", skip: "SKIP" }[rating];
    s.className = "stamp flash " + rating;
  }

  function rate(rating) {
    const path = current();
    if (!path) return;
    q.session.set(path, rating);
    api.setRating(path, rating);
    flashStamp(rating);
    advance();
  }

  function skip() {
    flashStamp("skip");
    advance();
  }

  function advance() {
    if (q.qi < q.queue.length - 1) {
      q.qi++;
      renderReview();
    } else if (q.queue.length) {
      q.qi = q.queue.length;
      renderReview();
      showBatchDone();
    }
  }

  function back() {
    if (q.qi <= 0) return;
    $("batch-done").classList.remove("show");
    q.qi--;
    renderReview();
  }

  function showBatchDone() {
    const c = { yes: 0, maybe: 0, no: 0, skipped: 0 };
    q.queue.forEach((p) => c[record(p).rating || "skipped"]++);
    $("batch-summary").innerHTML =
      `<span class="chip yes">&#10003; ${c.yes}</span> <span class="chip maybe">? ${c.maybe}</span> <span class="chip no">&#10005; ${c.no}</span>` +
      (c.skipped ? ` <span class="chip">skipped ${c.skipped}</span>` : "") +
      ` &nbsp;<span class="muted">${fmt(buildPool().length)} left in this queue</span>`;
    const grid = $("batch-grid");
    grid.innerHTML = "";
    q.queue.forEach((p, i) => {
      const cell = document.createElement("button");
      cell.className = "film " + (record(p).rating || "");
      cell.dataset.i = i;
      const img = document.createElement("img");
      img.draggable = false;
      cell.appendChild(img);
      api.setThumb(img, p, cell);
      grid.appendChild(cell);
    });
    $("batch-done").classList.add("show");
  }

  // Flick the review image: right = yes, left = no, up = maybe.
  function bindSwipe(stage) {
    let start = null;
    stage.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !current()) return;
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
      if (Math.abs(dx) > 90 && Math.abs(dx) > Math.abs(dy)) rate(dx > 0 ? "yes" : "no");
      else if (dy < -90) rate("maybe");
      else if (Math.abs(dx) < 5 && Math.abs(dy) < 5) api.openLightbox(q.queue, q.qi);
    };
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
  }

  function bind() {
    $("queue-source").value = S.queueSource || "unreviewed";
    $("queue-source").onchange = (e) => {
      S.queueSource = e.target.value;
      api.saveSettings();
      newBatch();
    };
    $("queue-scope").value = S.scope || "";
    let scopeTimer = null;
    $("queue-scope").oninput = (e) => {
      S.scope = e.target.value;
      api.saveSettings();
      clearTimeout(scopeTimer);
      scopeTimer = setTimeout(newBatch, 500);
    };
    $("rate-bar").onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const act = b.dataset.act;
      if (act === "yes" || act === "maybe" || act === "no") rate(act);
      else if (act === "skip") skip();
      else if (act === "back") back();
      else if (act === "info") api.toggleDetails();
    };
    $("filmstrip").onclick = (e) => {
      const b = e.target.closest(".film");
      if (!b) return;
      q.qi = +b.dataset.i;
      $("batch-done").classList.remove("show");
      renderReview();
    };
    $("batch-grid").onclick = (e) => {
      const b = e.target.closest(".film");
      if (b) api.openLightbox(q.queue, +b.dataset.i);
    };
    $("next-batch-btn").onclick = newBatch;
    $("to-library-btn").onclick = () => api.showView("library");
    bindSwipe($("review-stage"));
  }

  C.registerModule({
    id: "review",
    title: "Review",
    key: "r",
    description: "flashcard-style random batches for rating yes / maybe / no.",
    defaultEnabled: true,

    init(a) {
      api = a;
      ({ $, esc, fmt } = a);
      S = a.state.settings;
      a.views.insertAdjacentHTML("beforeend", TEMPLATE);
      bind();
    },

    show() {
      if (!q.queue.length) newBatch();
      else renderReview();
    },

    current: () => (current() ? [current()] : []),

    onKey(e, k) {
      if ($("batch-done").classList.contains("show")) {
        if (k === "Enter" || k === " ") newBatch();
        else if (k === "Backspace" || k === "z") back();
        else return false;
        return true;
      }
      const path = current();
      if (k === "ArrowRight" || k === "y" || k === "p") rate("yes");
      else if (k === "ArrowUp" || k === "m") rate("maybe");
      else if (k === "ArrowLeft" || k === "n" || k === "x") rate("no");
      else if (k === "ArrowDown" || k === "s") skip();
      else if (k === "Backspace" || k === "z") back();
      else if ((k === "0" || k === "u") && path) api.setRating(path, null);
      else if (k === "Enter" && path) api.openLightbox(q.queue, q.qi);
      else return false;
      return true;
    },

    onChange(path) {
      if (!q.queue.includes(path)) return;
      renderFilmstrip();
      if (current() === path) $("review-stage").dataset.rating = record(path).rating || "";
    },

    // A new folder/gallery was picked: start a fresh batch from it.
    onSource() {
      q.queue = [];
      q.qi = 0;
      $("batch-done").classList.remove("show");
      if (active()) newBatch();
    },

    onFiles() {
      if (active() && !q.queue.length) newBatch();
    },

    onDetails(open) {
      if (open && active()) C.details.render($("review-details"), current() || null);
    },

    settings(box) {
      box.innerHTML = `<label>Images per batch <input type="number" min="1" max="200" value="${S.queueSize || 10}" /></label>
        <p class="muted small">Keys: &rarr;/Y yes &middot; &uarr;/M maybe &middot; &larr;/N no &middot; &darr;/S skip &middot; Backspace back &middot; R opens this tab.</p>`;
      box.querySelector("input").oninput = (e) => {
        const n = parseInt(e.target.value, 10);
        if (n > 0) S.queueSize = Math.min(200, n);
        api.saveSettings();
      };
    },
  });
})();
