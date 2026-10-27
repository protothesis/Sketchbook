// Walk mode: the camera. A fixed angle that follows you, eased, with a
// little room to see where you're going.
//
// - It follows on a critically damped spring (`smooth`): it gathers speed
//   as you start, has a little drag, and settles without overshooting or
//   swinging back.
// - It leads in the direction you're moving: a little walking, more
//   running. The lead is built by travelling, not by pressing: each cell
//   you walk adds up to `build` cells of lead, so a slow walk pushes the
//   view on slowly, and turning on the spot doesn't swing it. It holds
//   when you slow down or stop, at the most it reached; heading more than
//   `turn` degrees away from it starts a new lead that way, which the view
//   travels to as you go.
// - Its height follows the ground you stand on, not your jump (`rise`: 1
//   follows block tops, 0 keeps it level).
// - The right stick peeks (gamepad.js sets W.padLook): it slides the view
//   up to `peek` cells that way, and springs back when you let go.
//
// The numbers are in CAMERA, which the dev panel tunes live. Its `debug`
// switch draws what the camera is doing over the game (drawDebug below).
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { THREE, S, SPEED, RUN, CAM_OFFSET, camera, state } = W;

  const CAMERA = {
    smooth: 0.15,     // s: the follow's spring (bigger: more drag and lag)
    lookWalk: 0.7,    // cells of lead at walking speed
    lookRun: 1.3,     // cells of lead at running speed
    build: 0.5,       // cells of lead gained (or swung) per cell you travel
    leadSmooth: 0.35, // s: rounds off the lead's starts and stops
    turn: 50,         // degrees off the lead's way that count as a new direction
    rise: 1,          // how much of the ground's height it follows (0: stays level)
    riseSmooth: 0.3,  // s: how gently it follows the ground up or down
    peek: 2,          // cells the right stick slides the view at full tilt
    peekEase: 6,      // 1/s: how fast the peek goes out and springs back
    debug: false,     // draw the camera's workings over the game
  };
  const MOVING = 0.5; // cells/s: slower than this (or bumping a wall) doesn't steer the lead

  const target = new THREE.Vector3();
  // Springs (value, velocity): the followed spot, the lead shown, the height.
  const pos = { x: 0, y: 0, vx: 0, vy: 0 }, shown = { x: 0, y: 0, vx: 0, vy: 0 }, hgt = { v: 0, dv: 0 };
  const lead = { x: 0, y: 0 }, goal = { x: 0, y: 0 }, peek = { x: 0, y: 0 }, last = { x: 0, y: 0 };

  /**
   * One step of a critically damped spring toward `to` (Game Programming
   * Gems 4's SmoothDamp): no overshoot, eases in and out. Returns [value, velocity].
   */
  function damp(from, to, vel, time, dt) {
    const w = 2 / Math.max(time, 1e-3), x = w * dt;
    const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = from - to, temp = (vel + w * change) * dt;
    let v = (vel - w * temp) * e, out = to + (change + temp) * e;
    if ((to - from > 0) === (out > to)) { out = to; v = 0; } // never past the target
    return [out, v];
  }
  function damp2(s, tx, ty, time, dt) {
    [s.x, s.vx] = damp(s.x, tx, s.vx, time, dt);
    [s.y, s.vy] = damp(s.y, ty, s.vy, time, dt);
  }

  /** How far ahead to look at a speed (cells/s). */
  function leadAt(speed) {
    if (speed <= SPEED) return CAMERA.lookWalk * speed / SPEED;
    return CAMERA.lookWalk + (CAMERA.lookRun - CAMERA.lookWalk) * Math.min(1, (speed - SPEED) / (RUN - SPEED));
  }

  function updateCamera(dt) {
    const p = state.player;
    // How far you went this frame (a jump across the map, like travel, isn't a step).
    let mx = p.x - last.x, my = p.y - last.y;
    if (Math.hypot(mx, my) > 1) mx = my = 0;
    last.x = p.x; last.y = p.y;
    const step = Math.hypot(mx, my), speed = step / Math.max(dt, 1e-4);
    if (speed > MOVING) {
      // Still going the lead's way: keep the longest lead reached, pointed
      // where you're going. A new direction starts over from this speed.
      const dx = mx / step, dy = my / step, len = Math.hypot(goal.x, goal.y);
      const same = len > 1e-3 && (goal.x * dx + goal.y * dy) / len > Math.cos(CAMERA.turn * Math.PI / 180);
      const l = same ? Math.max(len, leadAt(speed)) : leadAt(speed);
      goal.x = dx * l; goal.y = dy * l;
    }
    // The lead moves toward its goal only as you travel.
    const gx = goal.x - lead.x, gy = goal.y - lead.y, gap = Math.hypot(gx, gy), most = CAMERA.build * step;
    if (gap > 1e-6) { const k = Math.min(1, most / gap); lead.x += gx * k; lead.y += gy * k; }
    damp2(shown, lead.x, lead.y, CAMERA.leadSmooth, dt);

    const look = !state.paused && !state.bigmap && W.padLook;
    const kp = 1 - Math.exp(-dt * CAMERA.peekEase);
    peek.x += ((look ? look.x * CAMERA.peek : 0) - peek.x) * kp;
    peek.y += ((look ? look.y * CAMERA.peek : 0) - peek.y) * kp;

    damp2(pos, p.x, p.y, CAMERA.smooth, dt);
    [hgt.v, hgt.dv] = damp(hgt.v, state.jump.ground * CAMERA.rise, hgt.dv, CAMERA.riseSmooth, dt);
    target.set((pos.x + shown.x + peek.x) * S, 0.6 + hgt.v * S * 0.6, (pos.y + shown.y + peek.y) * S);
    camera.position.copy(target).add(CAM_OFFSET);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    drawDebug(p, speed, mx, my, step);
  }

  // ---------------------------------------------------------------------------
  // The debug overlay (CAMERA.debug). On the floor at your feet' height:
  //   white dot      you
  //   orange arrow   your velocity (a third of a second of it)
  //   grey rings     the walking and running leads, around you
  //   cyan dot       the spring-followed spot (it trails you while you move)
  //   green ring     the lead's goal; the dashed lines either side are the
  //                  `turn` cone: heading outside it starts a new lead
  //   green arrow    the lead shown, from the followed spot
  //   magenta arrow  the right stick's peek
  //   yellow cross   where the camera looks: the middle of the screen

  let dbg = null;
  const pv = new THREE.Vector3();
  function drawDebug(p, speed, mx, my, step) {
    if (!CAMERA.debug) { if (dbg) dbg.cv.hidden = true; return; }
    if (!dbg) {
      const cv = document.createElement('canvas');
      cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:50';
      document.body.append(cv);
      dbg = { cv, g: cv.getContext('2d') };
    }
    const { cv, g } = dbg, dpr = global.devicePixelRatio || 1;
    const w = global.innerWidth, h = global.innerHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    cv.hidden = false;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const y = p.z * S;
    const at = (x, z) => { pv.set(x * S, y, z * S).project(camera); return [(pv.x + 1) / 2 * w, (1 - pv.y) / 2 * h]; };
    const line = (pts, color, width, dash) => {
      g.strokeStyle = color; g.lineWidth = width || 2; g.setLineDash(dash || []);
      g.beginPath(); pts.forEach(([sx, sy], i) => (i ? g.lineTo(sx, sy) : g.moveTo(sx, sy))); g.stroke();
    };
    const ring = (cx, cy, r, color, width, dash) => {
      const pts = []; for (let i = 0; i <= 32; i++) { const a = i / 32 * Math.PI * 2; pts.push(at(cx + Math.cos(a) * r, cy + Math.sin(a) * r)); }
      line(pts, color, width, dash);
    };
    const arrow = (x0, y0, x1, y1, color) => {
      const a = at(x0, y0), b = at(x1, y1);
      line([a, b], color, 2.5);
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 6) {
        line([[b[0] - 9 * Math.cos(ang - 0.45), b[1] - 9 * Math.sin(ang - 0.45)], b,
          [b[0] - 9 * Math.cos(ang + 0.45), b[1] - 9 * Math.sin(ang + 0.45)]], color, 2.5);
      }
    };
    const dot = (x, z, color, r) => { const [sx, sy] = at(x, z); g.fillStyle = color; g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.fill(); };

    ring(p.x, p.y, CAMERA.lookWalk, 'rgba(255,255,255,0.18)', 1);
    ring(p.x, p.y, CAMERA.lookRun, 'rgba(255,255,255,0.18)', 1);
    const gl = Math.hypot(goal.x, goal.y);
    if (gl > 1e-3) {
      const ga = Math.atan2(goal.y, goal.x), t = CAMERA.turn * Math.PI / 180, r = CAMERA.lookRun * 1.4;
      for (const s of [-1, 1]) line([at(p.x, p.y), at(p.x + Math.cos(ga + s * t) * r, p.y + Math.sin(ga + s * t) * r)], 'rgba(120,230,140,0.55)', 1.5, [5, 5]);
      ring(pos.x + goal.x, pos.y + goal.y, 0.12, 'rgb(120,230,140)', 2);
    }
    if (step > 0) arrow(p.x, p.y, p.x + mx / step * speed / 3, p.y + my / step * speed / 3, 'rgb(255,160,70)');
    arrow(pos.x, pos.y, pos.x + shown.x, pos.y + shown.y, 'rgb(120,230,140)');
    if (Math.hypot(peek.x, peek.y) > 0.02) arrow(pos.x + shown.x, pos.y + shown.y, pos.x + shown.x + peek.x, pos.y + shown.y + peek.y, 'rgb(240,110,230)');
    dot(pos.x, pos.y, 'rgb(90,220,255)', 4);
    dot(p.x, p.y, '#fff', 4);
    const [cx, cy] = [w / 2, h / 2];
    line([[cx - 10, cy], [cx + 10, cy]], 'rgb(255,230,90)', 2); line([[cx, cy - 10], [cx, cy + 10]], 'rgb(255,230,90)', 2);

    g.setLineDash([]);
    g.font = '12px ui-monospace, monospace'; g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(w - 230, h - 132, 218, 118);
    g.fillStyle = '#e8e2d6';
    [`speed  ${speed.toFixed(2)} cells/s`, `lag    ${Math.hypot(p.x - pos.x, p.y - pos.y).toFixed(2)} cells`,
      `lead   ${Math.hypot(shown.x, shown.y).toFixed(2)} / goal ${gl.toFixed(2)}`,
      `peek   ${Math.hypot(peek.x, peek.y).toFixed(2)}`, `height ${hgt.v.toFixed(2)} (ground ${state.jump.ground.toFixed(2)})`,
      `air    ${state.jump.air ? 'yes' : 'no'}  z ${p.z.toFixed(2)}`,
    ].forEach((t, i) => g.fillText(t, w - 222, h - 112 + i * 17));
  }

  /** Jump the camera to the figure (after travelling, waking, or a new run). */
  function snapCameraTo(p) {
    state.jump.ground = p.z || 0;
    Object.assign(pos, { x: p.x, y: p.y, vx: 0, vy: 0 });
    Object.assign(shown, { x: 0, y: 0, vx: 0, vy: 0 });
    Object.assign(hgt, { v: state.jump.ground * CAMERA.rise, dv: 0 });
    lead.x = lead.y = goal.x = goal.y = peek.x = peek.y = 0;
    last.x = p.x; last.y = p.y;
    target.set(p.x * S, 0.6 + hgt.v * S * 0.6, p.y * S);
  }

  Object.assign(W, { CAMERA, updateCamera, snapCameraTo });
})(window);
