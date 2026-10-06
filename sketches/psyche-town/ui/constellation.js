// The inspector's "constellation": one node per complex, Obsidian-graph style,
// sized by charge. The Ego sits at the centre with spokes to every complex;
// coloured links show charge actively leaking from one complex into another.
// Whoever currently rules gets a crown ring. Layout is a tiny force sim whose
// positions persist between frames, so the graph breathes rather than jumps.
(function () {
  var PT = (window.PsycheTown = window.PsycheTown || {});

  function Constellation(canvas) {
    this.canvas = canvas;
    this.nodes = {};
    var self = this;
    PT.COMPLEXES.forEach(function (c, i) {
      var a = (i / PT.COMPLEXES.length) * Math.PI * 2;
      self.nodes[c.id] = { id: c.id, x: Math.cos(a) * 80, y: Math.sin(a) * 80, vx: 0, vy: 0 };
    });
    this.nodes.ego.x = 0; this.nodes.ego.y = 0;
  }

  function nodeValue(agent, id, hold) {
    if (id === "ego") return hold;
    return agent.psyche.charge[id];
  }

  Constellation.prototype.draw = function (agent, hold, colors, dt) {
    var cv = this.canvas, dpr = window.devicePixelRatio || 1;
    var W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    var g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    var nodes = this.nodes, ids = Object.keys(nodes);
    var ruler = agent.lost ? agent.lost.ruler : agent.psyche.ruler;
    var scale = Math.min(W, H) / 280;

    function radius(id) { return (7 + 26 * nodeValue(agent, id, hold)) * scale; }

    // Force step
    var step = Math.min(dt, 0.05) * 60;
    ids.forEach(function (a) {
      var na = nodes[a];
      if (a === "ego") return;
      var fx = 0, fy = 0;
      ids.forEach(function (b) {
        if (a === b) return;
        var nb = nodes[b], dx = na.x - nb.x, dy = na.y - nb.y;
        var d2 = dx * dx + dy * dy + 0.01, d = Math.sqrt(d2);
        var rep = 2200 / d2;
        fx += (dx / d) * rep; fy += (dy / d) * rep;
      });
      // Spoke to ego: stronger complexes pull in closer to the centre, as if
      // vying for the seat.
      var want = (95 - 40 * nodeValue(agent, a, hold)) * scale / 1.0;
      var e = nodes.ego, ex = na.x - e.x, ey = na.y - e.y, ed = Math.sqrt(ex * ex + ey * ey) || 1;
      var k = (ed - want) * 0.02;
      fx -= (ex / ed) * k * 10; fy -= (ey / ed) * k * 10;
      // Affinity links attract a little.
      PT.LINKS.forEach(function (l) {
        if (l[0] !== a && l[1] !== a) return;
        var o = nodes[l[0] === a ? l[1] : l[0]];
        fx += (o.x - na.x) * 0.002 * Math.sign(l[2]);
        fy += (o.y - na.y) * 0.002 * Math.sign(l[2]);
      });
      na.vx = (na.vx + fx * 0.05 * step) * 0.82;
      na.vy = (na.vy + fy * 0.05 * step) * 0.82;
      na.x += na.vx * step; na.y += na.vy * step;
    });

    // If someone else rules, the ego is pushed off-centre toward them.
    var target = { x: 0, y: 0 };
    if (ruler !== "ego") {
      var rn = nodes[ruler];
      target = { x: rn.x * 0.35, y: rn.y * 0.35 };
    }
    nodes.ego.x += (target.x - nodes.ego.x) * 0.05 * step;
    nodes.ego.y += (target.y - nodes.ego.y) * 0.05 * step;

    g.save();
    g.translate(W / 2, H / 2);

    // Spokes
    ids.forEach(function (id) {
      if (id === "ego") return;
      g.strokeStyle = colors.line;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(nodes.ego.x, nodes.ego.y); g.lineTo(nodes[id].x, nodes[id].y); g.stroke();
    });

    // Active affinity flows
    PT.LINKS.forEach(function (l) {
      var s = agent.psyche.charge[l[0]] - 0.4;
      if (s <= 0) return;
      var a = nodes[l[0]], b = nodes[l[1]];
      g.strokeStyle = l[2] < 0 ? PT.COMPLEX.caretaker.color : PT.COMPLEX[l[0]].color;
      g.globalAlpha = Math.min(1, 0.3 + s * 1.5);
      g.lineWidth = 1 + s * 8 * Math.abs(l[2]) * 10;
      if (l[2] < 0) g.setLineDash([4, 4]);
      var mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.15, my = (a.y + b.y) / 2 - (b.x - a.x) * 0.15;
      g.beginPath(); g.moveTo(a.x, a.y); g.quadraticCurveTo(mx, my, b.x, b.y); g.stroke();
      g.setLineDash([]);
    });
    g.globalAlpha = 1;

    // Nodes
    g.textAlign = "center";
    ids.forEach(function (id) {
      var n = nodes[id], c = PT.COMPLEX[id], r = radius(id);
      var v = nodeValue(agent, id, hold);
      if (id === ruler) {
        g.strokeStyle = c.color;
        g.lineWidth = 2;
        g.globalAlpha = 0.6;
        g.beginPath(); g.arc(n.x, n.y, r + 6, 0, Math.PI * 2); g.stroke();
        g.globalAlpha = 0.15;
        g.fillStyle = c.color;
        g.beginPath(); g.arc(n.x, n.y, r + 12, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
      }
      g.fillStyle = c.color;
      g.globalAlpha = agent.lost ? 0.35 : 0.35 + 0.65 * Math.min(1, v * 1.4);
      g.beginPath(); g.arc(n.x, n.y, r, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
      g.fillStyle = id === ruler ? colors.text : colors.muted;
      g.font = (id === ruler ? "700 " : "500 ") + Math.round(11 * Math.max(0.9, scale)) + "px system-ui, sans-serif";
      g.fillText(c.name, n.x, n.y + r + 13);
      if (id === ruler) {
        g.font = "700 10px system-ui, sans-serif";
        g.fillText("▲ IN CHARGE", n.x, n.y - r - 9);
      }
    });
    g.restore();
  };

  PT.Constellation = Constellation;
})();
