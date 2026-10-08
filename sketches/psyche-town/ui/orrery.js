// Draws one person's psyche as a little orrery: the ego as the sun inside
// its persona shield, each archetype as a planet on its orbit (size = mass,
// halo = breath), faint tethers showing each planet's pull on the sun, and
// lines for the aspects that make up their current weather. Remembers where
// it drew things so clicks can be mapped back to wiki entries.
(function () {
  var PT = (window.PsycheTown = window.PsycheTown || {});
  var TAU = Math.PI * 2;

  function Orrery(canvas) {
    this.canvas = canvas;
    this.hits = [];
    this.hover = null;
    this.sunOff = { x: 0, y: 0 };
    var self = this;
    canvas.addEventListener("pointermove", function (e) {
      self.hover = self.hit(e);
      canvas.style.cursor = self.hover ? "pointer" : "default";
    });
    canvas.addEventListener("pointerleave", function () { self.hover = null; });
  }

  // Returns a wiki key for whatever is under the pointer, or null.
  Orrery.prototype.hit = function (e) {
    var r = this.canvas.getBoundingClientRect();
    var x = e.clientX - r.left, y = e.clientY - r.top;
    for (var i = this.hits.length - 1; i >= 0; i--) {
      var h = this.hits[i], d = Math.hypot(x - h.x, y - h.y);
      if (h.ring ? Math.abs(d - h.r) < h.w : d < h.r) return h.key;
    }
    return null;
  };

  Orrery.prototype.draw = function (p, hold, colors, dt, opts) {
    opts = opts || {};
    var cv = this.canvas, dpr = window.devicePixelRatio || 1;
    var W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    }
    var g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    var R = Math.min(W, H) / 2 - 30;           // px for orbit radius 1.0
    var s = Math.max(0.7, Math.min(1.6, R / 150)); // size scale
    var cx = W / 2, cy = H / 2;
    var ruler = opts.lostRuler || p.ruler;
    var compact = opts.compact || W < 480;
    var v = p.view || PT.psyche.view(p);
    var hov = this.hover;
    this.hits = [];

    function pos(sv, pullIn) {
      var rr = Math.min(sv.r, 1.12) * R * (pullIn || 1);
      return { x: cx + Math.cos(sv.theta) * rr, y: cy + Math.sin(sv.theta) * rr };
    }
    function prad(sv) { return Math.max(3, Math.min(22, (3 + 15 * sv.mass))) * s; }

    // The sun drifts toward whoever has captured it.
    var target = { x: 0, y: 0 };
    var rv = null;
    v.forEach(function (sv) { if (sv.id === ruler) rv = sv; });
    if (rv) {
      var rp = pos(rv);
      target = { x: (rp.x - cx) * 0.18, y: (rp.y - cy) * 0.18 };
    }
    var k = Math.min(1, (dt || 0.016) * 3);
    this.sunOff.x += (target.x - this.sunOff.x) * k;
    this.sunOff.y += (target.y - this.sunOff.y) * k;
    var sx = cx + this.sunOff.x, sy = cy + this.sunOff.y;

    // Orbits
    p.planets.forEach(function (pl) {
      var arch = PT.ARCH[pl.id];
      g.beginPath();
      for (var i = 0; i <= 72; i++) {
        var th = (i / 72) * TAU;
        var rr = Math.min(pl.a * (1 - pl.e * Math.cos(th - pl.w)), 1.12) * R;
        var x = cx + Math.cos(th) * rr, y = cy + Math.sin(th) * rr;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.strokeStyle = pl.id === ruler || pl.id === hov ? arch.color : colors.line;
      g.globalAlpha = pl.id === ruler || pl.id === hov ? 0.55 : 0.7;
      g.lineWidth = 1;
      g.stroke();
    });
    g.globalAlpha = 1;

    var pts = {};
    v.forEach(function (sv) { pts[sv.id] = pos(sv, sv.id === ruler ? 0.8 : 1); });

    // Pull tethers: how hard each planet is tugging on the ego
    v.forEach(function (sv) {
      var f = Math.min(1.3, sv.pull / hold);
      if (f < 0.25) return;
      var q = pts[sv.id];
      g.strokeStyle = PT.ARCH[sv.id].color;
      g.globalAlpha = 0.1 + 0.5 * Math.max(0, f - 0.25);
      g.lineWidth = (0.5 + 3 * f) * s;
      g.beginPath(); g.moveTo(sx, sy); g.lineTo(q.x, q.y); g.stroke();
    });
    g.globalAlpha = 1;

    // Aspects (the weather)
    g.font = Math.round(10 * Math.max(1, s * 0.85)) + "px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    (p.weather || []).forEach(function (w) {
      var a = pts[w.a], b = pts[w.b], asp = PT.ASPECT_BY_ID[w.aspect];
      if (!a || !b) return;
      var named = !!w.rule;
      g.strokeStyle = asp.color;
      g.globalAlpha = (named ? 0.55 : 0.25) + 0.35 * w.exact;
      g.lineWidth = (named ? 2.2 : 1) * s;
      if (w.aspect === "square") g.setLineDash([4, 4]);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      g.setLineDash([]);
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      g.globalAlpha = 1;
      var label = named ? asp.glyph + " " + PT.WEATHER_BY_ID[w.rule].name : asp.glyph;
      var tw = g.measureText(label).width + 8;
      g.fillStyle = colors.surface;
      g.globalAlpha = 0.85;
      g.fillRect(mx - tw / 2, my - 8, tw, 16);
      g.globalAlpha = 1;
      g.fillStyle = named ? colors.text : colors.muted;
      g.fillText(label, mx, my);
      if (named) this.hits.push({ key: "weather-" + w.rule, x: mx, y: my, r: tw / 2 });
      else this.hits.push({ key: "aspect-" + w.aspect, x: mx, y: my, r: 9 });
    }, this);
    g.globalAlpha = 1;

    // Sun
    var sunR = 14 * s;
    var grad = g.createRadialGradient(sx, sy, sunR * 0.3, sx, sy, sunR * 2.6);
    grad.addColorStop(0, "rgba(233,216,166,0.55)");
    grad.addColorStop(1, "rgba(233,216,166,0)");
    g.fillStyle = grad;
    g.beginPath(); g.arc(sx, sy, sunR * 2.6, 0, TAU); g.fill();
    g.fillStyle = PT.EGO.color;
    g.globalAlpha = ruler === "ego" ? 1 : 0.6;
    g.beginPath(); g.arc(sx, sy, sunR, 0, TAU); g.fill();
    g.globalAlpha = 1;
    g.fillStyle = "#3a3122";
    g.font = "700 " + Math.round(12 * s) + "px system-ui, sans-serif";
    g.fillText(String(p.type), sx, sy + 0.5);

    // Persona shield: thickness is the ego's hold; cracks when captured
    var shR = sunR + 9 * s, shW = (1.5 + 7 * hold) * s;
    g.strokeStyle = colors.shield;
    g.lineWidth = shW;
    g.globalAlpha = 0.25 + 0.6 * hold;
    if (ruler !== "ego") {
      g.globalAlpha *= 0.55 + 0.25 * Math.sin(p.t * 9);
      g.setLineDash([7 * s, 6 * s]);
      g.lineDashOffset = p.t * 4;
    }
    g.beginPath(); g.arc(sx, sy, shR, 0, TAU); g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 1;
    this.hits.push({ key: "concept-shield", x: sx, y: sy, r: shR, w: Math.max(6, shW), ring: true });
    this.hits.push({ key: "type-" + p.type, x: sx, y: sy, r: sunR + 2 });

    // Planets
    v.forEach(function (sv) {
      var arch = PT.ARCH[sv.id], q = pts[sv.id], r = prad(sv);
      var isRuler = sv.id === ruler;
      // breath halo
      g.strokeStyle = arch.color;
      g.globalAlpha = 0.12 + 0.18 * (sv.breath + 1) / 2;
      g.lineWidth = 2 * s;
      g.beginPath(); g.arc(q.x, q.y, r * (1.35 + 0.35 * sv.breath) + 2, 0, TAU); g.stroke();
      if (isRuler) {
        g.globalAlpha = 0.18;
        g.fillStyle = arch.color;
        g.beginPath(); g.arc(q.x, q.y, r + 12 * s, 0, TAU); g.fill();
        g.globalAlpha = 0.8;
        g.lineWidth = 2;
        g.beginPath(); g.arc(q.x, q.y, r + 6 * s, 0, TAU); g.stroke();
      }
      g.globalAlpha = opts.lostRuler ? 0.4 : 0.55 + 0.45 * Math.min(1, sv.mass * 1.6);
      g.fillStyle = arch.color;
      g.beginPath(); g.arc(q.x, q.y, r, 0, TAU); g.fill();
      g.globalAlpha = 1;
      if (sv.id === hov) {
        g.strokeStyle = colors.text; g.lineWidth = 1.5;
        g.beginPath(); g.arc(q.x, q.y, r + 3, 0, TAU); g.stroke();
      }
      // In the compact (town inspector) view, only label what matters.
      if (!compact || isRuler || sv.id === hov || sv.mass > 0.3) {
        g.fillStyle = isRuler || sv.id === hov ? colors.text : colors.muted;
        g.font = (isRuler ? "700 " : "500 ") + Math.round(10.5 * Math.max(1, s * 0.9)) + "px system-ui, sans-serif";
        g.fillText(arch.name, q.x, q.y + r + 9 * s);
      }
      if (isRuler) {
        g.font = "700 " + Math.round(9.5 * Math.max(1, s * 0.9)) + "px system-ui, sans-serif";
        g.fillText("▲ IN CHARGE", q.x, q.y - r - 12 * s);
      }
      this.hits.push({ key: "arch-" + sv.id, x: q.x, y: q.y, r: Math.max(r + 5, 12) });
    }, this);
  };

  PT.Orrery = Orrery;
})();
