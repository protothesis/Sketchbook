// Walk mode: the camera. A fixed angle that follows you, eased, with a
// little room to see where you're going.
//
// - Its height follows the ground you stand on, not your jump: it holds
//   while you're in the air and eases up or down when you land on or step
//   off a block.
// - It leads in the direction you're moving: a little walking, more
//   running. The lead stays when you slow down or stop, at the most it
//   reached; turning more than CAMERA.turn degrees starts a new lead that
//   way. It eases round, so a turn swings the view instead of whipping it.
// - The right stick peeks (gamepad.js sets W.padLook): it slides the view
//   up to CAMERA.peek cells that way, and springs back when you let go.
//
// The numbers are in CAMERA, which the dev panel tunes live.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { THREE, S, SPEED, RUN, CAM_OFFSET, camera, state } = W;

  const CAMERA = {
    follow: 7,        // 1/s: how fast the view catches up with where it's aiming
    height: 4,        // 1/s: how fast it follows the ground's height
    lookWalk: 0.6,    // cells ahead of you at walking speed
    lookRun: 1.2,     // cells ahead at running speed
    lookEase: 2.5,    // 1/s: how fast the lead grows and swings round
    turn: 50,         // degrees off the lead's way that count as a new direction
    peek: 2,          // cells the right stick slides the view at full tilt
    peekEase: 6,      // 1/s: how fast the peek goes out and springs back
  };

  const target = new THREE.Vector3(); // what the camera looks at, in world units
  const aim = new THREE.Vector3();
  const lead = { x: 0, y: 0 }, goal = { x: 0, y: 0 }, peek = { x: 0, y: 0 }, last = { x: 0, y: 0 }, vel = { x: 0, y: 0 };
  const MOVING = 0.5; // cells/s: slower than this (or bumping a wall) doesn't steer the lead
  let ground = 0;

  const ease = (rate, dt) => 1 - Math.exp(-dt * rate);

  /** How far ahead to look at a speed (cells/s). */
  function leadAt(speed) {
    if (speed <= SPEED) return CAMERA.lookWalk * speed / SPEED;
    return CAMERA.lookWalk + (CAMERA.lookRun - CAMERA.lookWalk) * Math.min(1, (speed - SPEED) / (RUN - SPEED));
  }

  function updateCamera(dt) {
    const p = state.player;
    // Your speed this frame (a jump across the map, like travel, isn't).
    let vx = (p.x - last.x) / Math.max(dt, 1e-4), vy = (p.y - last.y) / Math.max(dt, 1e-4);
    if (Math.hypot(p.x - last.x, p.y - last.y) > 1) vx = vy = 0;
    last.x = p.x; last.y = p.y;
    const speed = Math.hypot(vx, vy);
    if (speed > MOVING) {
      // Still going the lead's way: keep the longest lead reached, pointed
      // where you're going. A new direction starts over from this speed.
      const dx = vx / speed, dy = vy / speed, len = Math.hypot(goal.x, goal.y);
      const same = len > 1e-3 && (goal.x * dx + goal.y * dy) / len > Math.cos(CAMERA.turn * Math.PI / 180);
      const l = same ? Math.max(len, leadAt(speed)) : leadAt(speed);
      goal.x = dx * l; goal.y = dy * l;
    }
    const k = ease(CAMERA.lookEase, dt);
    lead.x += (goal.x - lead.x) * k;
    lead.y += (goal.y - lead.y) * k;
    const kv = ease(15, dt); // your velocity, lightly smoothed, for the follow's lag below
    vel.x += (vx - vel.x) * kv; vel.y += (vy - vel.y) * kv;

    const look = !state.paused && !state.bigmap && W.padLook;
    const kp = ease(CAMERA.peekEase, dt);
    peek.x += ((look ? look.x * CAMERA.peek : 0) - peek.x) * kp;
    peek.y += ((look ? look.y * CAMERA.peek : 0) - peek.y) * kp;

    ground += (state.jump.ground - ground) * ease(CAMERA.height, dt);
    // The follow trails a moving target by speed / follow; aim that much
    // further on, so the lead you set is the lead you get.
    const fx = vel.x / CAMERA.follow, fy = vel.y / CAMERA.follow;
    aim.set((p.x + lead.x + fx + peek.x) * S, 0.6 + ground * S * 0.6, (p.y + lead.y + fy + peek.y) * S);
    target.lerp(aim, ease(CAMERA.follow, dt));
    camera.position.copy(target).add(CAM_OFFSET);
    camera.lookAt(target);
    camera.updateMatrixWorld();
  }

  /** Jump the camera to the figure (after travelling, waking, or a new run). */
  function snapCameraTo(p) {
    ground = state.jump.ground = p.z || 0;
    lead.x = lead.y = goal.x = goal.y = peek.x = peek.y = vel.x = vel.y = 0;
    last.x = p.x; last.y = p.y;
    target.set(p.x * S, 0.6 + ground * S * 0.6, p.y * S);
  }

  Object.assign(W, { CAMERA, updateCamera, snapCameraTo });
})(window);
