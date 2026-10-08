// Camera and input: drag to pan, wheel / pinch / double-click to zoom,
// tap to select. A very light "slippy map".
(function (global) {
  'use strict';
  var VG = (global.VillageGen = global.VillageGen || {});

  function View(canvas, onChange) {
    this.canvas = canvas;
    this.onChange = onChange;
    this.cx = 0; this.cy = 0; this.scale = 1;
    this.minScale = 0.02; this.maxScale = 40;
    this.w = 1; this.h = 1; this.dpr = 1;
    this.onTap = null; this.onHover = null;
    this._bind();
  }

  View.prototype.resize = function () {
    var r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(global.devicePixelRatio || 1, 2.5);
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.onChange();
  };

  View.prototype.bounds = function () {
    var hw = this.w / 2 / this.scale, hh = this.h / 2 / this.scale;
    return [this.cx - hw, this.cy - hh, this.cx + hw, this.cy + hh];
  };

  View.prototype.toWorld = function (sx, sy) {
    return [(sx - this.w / 2) / this.scale + this.cx, (sy - this.h / 2) / this.scale + this.cy];
  };

  View.prototype.clampScale = function (s) { return Math.min(this.maxScale, Math.max(this.minScale, s)); };

  /** Zoom by factor k keeping screen point (sx, sy) fixed. */
  View.prototype.zoomAt = function (k, sx, sy) {
    var before = this.toWorld(sx, sy);
    this.scale = this.clampScale(this.scale * k);
    var after = this.toWorld(sx, sy);
    this.cx += before[0] - after[0]; this.cy += before[1] - after[1];
    this.onChange();
  };

  /** Fit a world-space box of the given size around (x, y). */
  View.prototype.fit = function (x, y, size, animate) {
    var target = { cx: x, cy: y, scale: this.clampScale(Math.min(this.w, this.h) / size) };
    if (!animate) { this.cx = target.cx; this.cy = target.cy; this.scale = target.scale; this.onChange(); return; }
    var self = this, from = { cx: this.cx, cy: this.cy, scale: this.scale }, t0 = performance.now();
    function step(now) {
      var t = Math.min(1, (now - t0) / 380), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      var ls = Math.log(from.scale) + (Math.log(target.scale) - Math.log(from.scale)) * e;
      self.scale = Math.exp(ls);
      self.cx = from.cx + (target.cx - from.cx) * e;
      self.cy = from.cy + (target.cy - from.cy) * e;
      self.onChange();
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  };

  View.prototype._bind = function () {
    var self = this, cv = this.canvas, pointers = new Map(), moved = 0, pinch = null, last = null;
    function pos(e) { var r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

    cv.addEventListener('pointerdown', function (e) {
      cv.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, pos(e));
      moved = 0;
      if (pointers.size === 2) {
        var p = Array.from(pointers.values());
        pinch = { d: Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]), m: [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2] };
      }
      last = pos(e);
    });
    cv.addEventListener('pointermove', function (e) {
      var p = pos(e);
      if (!pointers.has(e.pointerId)) {
        if (self.onHover && e.pointerType === 'mouse') self.onHover(self.toWorld(p[0], p[1]), p);
        return;
      }
      var prev = pointers.get(e.pointerId);
      pointers.set(e.pointerId, p);
      if (pointers.size === 1) {
        moved += Math.abs(p[0] - prev[0]) + Math.abs(p[1] - prev[1]);
        if (moved > 4) {
          self.cx -= (p[0] - prev[0]) / self.scale;
          self.cy -= (p[1] - prev[1]) / self.scale;
          cv.classList.add('dragging');
          self.onChange();
        }
      } else if (pointers.size === 2 && pinch) {
        var q = Array.from(pointers.values());
        var d = Math.hypot(q[0][0] - q[1][0], q[0][1] - q[1][1]), m = [(q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2];
        self.cx -= (m[0] - pinch.m[0]) / self.scale;
        self.cy -= (m[1] - pinch.m[1]) / self.scale;
        self.zoomAt(d / pinch.d, m[0], m[1]);
        pinch = { d: d, m: m };
        moved = 99;
      }
    });
    function end(e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      cv.classList.remove('dragging');
      if (pointers.size === 0 && moved <= 4 && e.type === 'pointerup' && self.onTap) {
        var p = pos(e);
        self.onTap(self.toWorld(p[0], p[1]), p);
      }
    }
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', function () { if (self.onHover) self.onHover(null); });
    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      var p = pos(e), dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      self.zoomAt(Math.exp(-dy * 0.0016), p[0], p[1]);
    }, { passive: false });
    cv.addEventListener('dblclick', function (e) {
      var p = pos(e);
      self.zoomAt(e.shiftKey ? 0.5 : 2, p[0], p[1]);
    });
  };

  VG.View = View;
})(window);
