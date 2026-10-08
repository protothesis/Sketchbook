// HTML snippets shared by the lab and the town inspector. Anything with a
// data-wiki attribute opens that entry in the wiki drawer.
(function () {
  var PT = (window.PsycheTown = window.PsycheTown || {});
  var W = function () { return PT.wiki; };

  // Every planet's pull as a bar, with the ego's hold as a blue marker.
  function tugHtml(p, hold, max) {
    var v = (p.view || PT.psyche.view(p)).slice().sort(function (a, b) { return b.pull - a.pull; });
    if (max) v = v.slice(0, max);
    var scale = Math.max(1, hold * 1.25, v.length ? v[0].pull * 1.05 : 0);
    var rows = v.map(function (s) {
      var a = PT.ARCH[s.id];
      return '<a href="#" data-wiki="arch-' + s.id + '"' + (s.id === p.ruler ? ' class="ruler"' : "") + '><span class="dot" style="background:' +
        a.color + '"></span>' + W().esc(a.name) + '</a><div class="track"><i style="width:' + Math.min(100, (s.pull / scale) * 100).toFixed(1) +
        "%;background:" + a.color + '"></i><b style="left:' + ((hold / scale) * 100).toFixed(1) + '%"></b></div>';
    });
    return '<div class="tug">' + rows.join("") + "</div>";
  }

  function weatherHtml(p) {
    var w = (p.weather || []).slice().sort(function (a, b) { return (b.rule ? 1 : 0) - (a.rule ? 1 : 0); });
    if (!w.length) return '<span class="muted">Clear skies. No significant aspects right now.</span>';
    return '<div class="chips">' + w.map(function (x) {
      var asp = PT.ASPECT_BY_ID[x.aspect];
      var pair = W().esc(PT.ARCH[x.a].name) + " " + asp.glyph + " " + W().esc(PT.ARCH[x.b].name);
      if (x.rule) {
        return '<a href="#" class="chip named" style="--c:' + asp.color + '" data-wiki="weather-' + x.rule + '" title="' + pair + '">' +
          '<span class="g">' + asp.glyph + "</span>" + W().esc(PT.WEATHER_BY_ID[x.rule].name) + "</a>";
      }
      return '<a href="#" class="chip" data-wiki="aspect-' + x.aspect + '">' + pair + "</a>";
    }).join("") + "</div>";
  }

  function typeHtml(p) {
    var t = PT.psyche.typeOf(p.type);
    var lean = p.lean === "stress" ? ' <span class="muted">· under stress, leaning toward ' + W().link("type-" + t.stress, String(t.stress), "drawer") + "</span>"
      : p.lean === "growth" ? ' <span class="muted">· at ease, leaning toward ' + W().link("type-" + t.growth, String(t.growth), "drawer") + "</span>" : "";
    return '<a href="#" class="pill" style="--c:' + PT.EGO.color + '" data-wiki="type-' + t.n + '">Type ' + t.n + " · " + W().esc(t.name) + "</a>" + lean;
  }

  // One line about who's driving.
  function rulerHtml(p, hoursFn) {
    if (p.ruler === "ego") {
      var top = PT.ARCH[PT.psyche.strongest(p)];
      return '<a href="#" class="pill" style="--c:' + PT.EGO.color + '" data-wiki="concept-ego">Composed</a> The ego has the wheel. Strongest pull: ' +
        W().link("arch-" + top.id, top.name, "drawer") + ".";
    }
    var a = PT.ARCH[p.ruler];
    var eta = PT.psyche.timeToRelease(p);
    var etaTxt = eta < 595 ? ' <span class="muted">Left safe and alone, it would likely let go in ~' + hoursFn(eta) + ".</span>" : "";
    return '<a href="#" class="pill" style="--c:' + a.color + '" data-wiki="arch-' + a.id + '">' + W().esc(a.name) + "</a> has captured the ego." + etaTxt;
  }

  PT.panel = { tugHtml: tugHtml, weatherHtml: weatherHtml, typeHtml: typeHtml, rulerHtml: rulerHtml };
})();
