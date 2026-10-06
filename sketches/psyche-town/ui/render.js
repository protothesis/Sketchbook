// Draws the town onto a canvas. World coordinates are fixed (900x600) and
// scaled to fit; colours come from CSS custom properties so the canvas
// follows the page's light/dark theme.
(function () {
  var PT = (window.PsycheTown = window.PsycheTown || {});

  function themeColors() {
    var cs = getComputedStyle(document.documentElement);
    function v(n) { return cs.getPropertyValue(n).trim(); }
    return {
      ground: v("--town-ground"), place: v("--town-place"), park: v("--town-park"),
      house: v("--town-house"), line: v("--border"), text: v("--text"), muted: v("--text-muted"),
      night: v("--town-night"), body: v("--town-body"),
    };
  }

  function fit(canvas, world) {
    var dpr = window.devicePixelRatio || 1;
    var cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    var s = Math.min(cw / world.W, ch / world.H);
    return { dpr: dpr, s: s, ox: (cw - world.W * s) / 2, oy: (ch - world.H * s) / 2 };
  }

  function toWorld(view, px, py) {
    return { x: (px - view.ox) / view.s, y: (py - view.oy) / view.s };
  }

  function draw(canvas, world, view, colors, selectedId, hoverId) {
    var g = canvas.getContext("2d");
    g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    g.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    g.translate(view.ox, view.oy);
    g.scale(view.s, view.s);

    g.fillStyle = colors.ground;
    roundRect(g, 0, 0, world.W, world.H, 14); g.fill();

    // Places
    g.font = "600 12px system-ui, sans-serif";
    g.textAlign = "center";
    for (var k in world.places) {
      var p = world.places[k];
      g.fillStyle = k === "park" ? colors.park : colors.place;
      if (p.kind === "circle") { g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill(); }
      else { roundRect(g, p.x, p.y, p.w, p.h, 10); g.fill(); }
      g.fillStyle = colors.muted;
      var ly = p.kind === "circle" ? p.y - p.r + 16 : p.y + 16;
      var lx = p.kind === "circle" ? p.x : p.x + p.w / 2;
      g.fillText(p.name.toUpperCase(), lx, ly);
    }

    // Homes, outlined in the owner's current colour
    world.agents.forEach(function (a) {
      var c = a.lost ? colors.muted : a.psyche.ruler === "ego" ? colors.line : PT.COMPLEX[a.psyche.ruler].color;
      g.fillStyle = colors.house;
      g.strokeStyle = c;
      g.lineWidth = a.psyche.ruler === "ego" || a.lost ? 1 : 2;
      roundRect(g, a.home.x - 10, a.home.y - 9, 20, 18, 3);
      g.fill(); g.stroke();
      if (a.lost) {
        g.fillStyle = colors.muted;
        g.fillRect(a.home.x - 1, a.home.y - 4, 2, 8);
      }
    });

    // Confrontation tethers
    world.agents.forEach(function (s) {
      if (!s.encounter || s.lost) return;
      var o = world.agents[s.encounter.with];
      g.strokeStyle = PT.COMPLEX.guardian.color;
      g.globalAlpha = 0.5 + 0.5 * Math.sin(world.time * 12);
      g.lineWidth = 2;
      g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(o.x, o.y); g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    });

    // Flashes
    world.flashes.forEach(function (f) {
      var k = f.t / f.life;
      g.strokeStyle = f.color;
      g.globalAlpha = 1 - k;
      g.lineWidth = f.big ? 3 : 2;
      g.beginPath(); g.arc(f.x, f.y, 8 + k * (f.big ? 60 : 30), 0, Math.PI * 2); g.stroke();
    });
    g.globalAlpha = 1;

    // People
    world.agents.forEach(function (a) {
      if (a.lost) {
        g.strokeStyle = colors.muted;
        g.globalAlpha = 0.6;
        g.lineWidth = 1.2;
        g.beginPath(); g.arc(a.x, a.y, 5, 0, Math.PI * 2); g.stroke();
        g.globalAlpha = 1;
        return;
      }
      var r = a.psyche.ruler;
      var col = r === "ego" ? colors.body : PT.COMPLEX[r].color;
      if (r !== "ego") {
        var pulse = 0.5 + 0.5 * Math.sin(world.time * 4 + a.id);
        g.fillStyle = col;
        g.globalAlpha = 0.18 + 0.14 * pulse;
        g.beginPath(); g.arc(a.x, a.y, 11 + pulse * 3, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
      }
      if (a.userCare > 0) {
        g.strokeStyle = PT.COMPLEX.caretaker.color;
        g.lineWidth = 1.5;
        g.setLineDash([2, 3]);
        g.beginPath(); g.arc(a.x, a.y, 16, 0, Math.PI * 2); g.stroke();
        g.setLineDash([]);
      }
      g.fillStyle = col;
      g.beginPath(); g.arc(a.x, a.y, 6, 0, Math.PI * 2); g.fill();
      if (a.id === selectedId || a.id === hoverId) {
        g.strokeStyle = colors.text;
        g.lineWidth = a.id === selectedId ? 2 : 1;
        g.beginPath(); g.arc(a.x, a.y, 9.5, 0, Math.PI * 2); g.stroke();
      }
    });

    // Names for selected / hovered
    [selectedId, hoverId].forEach(function (id) {
      if (id == null) return;
      var a = world.agents[id];
      g.font = "600 12px system-ui, sans-serif";
      g.fillStyle = colors.text;
      g.fillText(a.name, a.x, a.y - 14);
    });

    // Night
    var h = PT.town.hourOf(world);
    var dark = h >= 21 || h < 5 ? 1 : h >= 19 ? (h - 19) / 2 : h < 7 ? (7 - h) / 2 : 0;
    if (dark > 0) {
      g.fillStyle = colors.night;
      g.globalAlpha = 0.28 * dark;
      roundRect(g, 0, 0, world.W, world.H, 14); g.fill();
      g.globalAlpha = 1;
    }
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function pick(world, wp, radius) {
    var best = null, bd = radius;
    world.agents.forEach(function (a) {
      var d = Math.hypot(a.x - wp.x, a.y - wp.y);
      if (d < bd) { bd = d; best = a; }
    });
    return best;
  }

  PT.render = { themeColors: themeColors, fit: fit, toWorld: toWorld, draw: draw, pick: pick };
})();
