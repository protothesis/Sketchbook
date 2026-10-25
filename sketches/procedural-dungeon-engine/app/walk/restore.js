// Walk mode: restoration (GAME-DESIGN.md). Setting the dungeon right pays
// entropy, once. For now: push blocks, each with a matching floor mark where
// it belongs, and unlit sconces on the walls. Crates (loose props) move the
// same way as push blocks but have no home and pay nothing. Either one:
// walk into it and you climb it, like any one-unit block. Hold E and you
// grab it: let go without moving and you lift it over your head (set it
// down again with E); move while holding and you push or pull it along
// that axis. A block you can lift is never stuck.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, DP, RULES, THREE, S, RADIUS, UNIT, WALL_T, ekey, scene, state, savePlayer, easeOut,
    inDoorMouth } = W;

  const SLIDE_TIME = 0.22; // seconds for a push to slide one half-cell
  const LIFT_TIME = 0.38;  // seconds for the arc up over your head, or back down

  const pushGeo = {
    block: new THREE.BoxGeometry(0.5 * S * 0.98, UNIT * S, 0.5 * S * 0.98),
    mark: new THREE.PlaneGeometry(0.5 * S * 0.94, 0.5 * S * 0.94),
  };

  // The floor mark: a square outline with corner ticks, in the block's colour.
  const markTex = {};
  function markTexture(color) {
    if (markTex[color]) return markTex[color];
    const n = 64, cv = document.createElement('canvas');
    cv.width = cv.height = n;
    const g = cv.getContext('2d');
    g.strokeStyle = color;
    g.lineWidth = n * 0.07;
    g.strokeRect(n * 0.12, n * 0.12, n * 0.76, n * 0.76);
    g.lineWidth = n * 0.05;
    g.strokeRect(n * 0.3, n * 0.3, n * 0.4, n * 0.4);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return (markTex[color] = t);
  }

  // A crate's faces: boards in a frame, crossed by a brace (programmer art).
  const crateMat = (() => {
    const n = 64, cv = document.createElement('canvas');
    cv.width = cv.height = n;
    const g = cv.getContext('2d');
    g.fillStyle = '#8a6239';
    g.fillRect(0, 0, n, n);
    g.strokeStyle = '#5e3f22';
    g.lineWidth = 2;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(0, i * n / 4); g.lineTo(n, i * n / 4); g.stroke(); }
    g.fillStyle = '#a77a49';
    const f = n * 0.14;
    g.fillRect(0, 0, n, f); g.fillRect(0, n - f, n, f); g.fillRect(0, 0, f, n); g.fillRect(n - f, 0, f, n);
    g.strokeStyle = '#a77a49';
    g.lineWidth = f * 0.9;
    g.beginPath(); g.moveTo(f, n - f); g.lineTo(n - f, f); g.stroke();
    g.strokeStyle = '#4a311a';
    g.lineWidth = 1.5;
    g.strokeRect(0.75, 0.75, n - 1.5, n - 1.5);
    g.strokeRect(f, f, n - 2 * f, n - 2 * f);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshLambertMaterial({ map: t });
  })();

  const sub = (sx, sy) => ({ x0: sx / 2, y0: sy / 2, x1: sx / 2 + 0.5, y1: sy / 2 + 0.5 });
  const cellOf = (sx, sy) => DE.key(Math.floor(sx / 2), Math.floor(sy / 2));

  function indexBlock(b, add) {
    const k = cellOf(b.sx, b.sy);
    const list = (state.blockAt.get(k) || []).filter((o) => o !== b);
    if (add) list.push(b);
    if (list.length) state.blockAt.set(k, list); else state.blockAt.delete(k);
  }

  function place(b, sx, sy) {
    Object.assign(b, { sx, sy }, sub(sx, sy));
  }

  // ---------------------------------------------------------------------------
  // Loose objects (crates and push blocks) live in one run-wide list,
  // run.objects, by key ("spaceId:seed:id" of the room they came from) ->
  // { kind: 'crate' | 'block' | 'vessel', sx, sy, lv (how many units up it rests:
  // 0 on the floor, up to 2 stacked), for a block color, to, done, paid,
  // and for a vessel holds (null, 'pixie', 'entropy') and n }. A room adds its own the first time it's built, and builds
  // whichever objects sit in its cells now, wherever they came from. An
  // object sitting in a room that's rerolled is despawned (run.despawned);
  // one in your hands, or set down anywhere else, stays. A push block's
  // mark stays in its home room.

  /** A room's own loose objects, as generated: [{ key, kind, from, to?, color? }]. */
  function objectDefs(space) {
    const out = [];
    const id = (x) => space.id + ':' + space.seed + ':' + x;
    for (const pb of DP.pushBlocks(space)) out.push({ key: id(pb.id), kind: 'block', from: pb.from, to: pb.to, color: pb.color });
    for (const pr of DP.props(space).blocks) if (pr.crate) out.push({ key: id(pr.crate.id), kind: 'crate', from: pr.crate });
    const v = DP.vessel(space);
    if (v) out.push({ key: id('vessel'), kind: 'vessel', from: v });
    return out;
  }

  /**
   * Put a room's own objects into run.objects, once: not again after
   * they've moved, been despawned, or (old saves) gained only a position.
   */
  function spawnObjects(space) {
    const run = state.run;
    for (const d of objectDefs(space)) {
      const o = run.objects[d.key];
      if (o && o.kind) continue;
      if (!o && run.despawned.some((x) => x.key === d.key)) continue;
      const rec = o || { sx: d.from.sx, sy: d.from.sy };
      rec.kind = d.kind;
      if (d.kind === 'vessel') { rec.holds = rec.holds || null; rec.n = rec.n || 0; }
      if (d.kind === 'block') {
        Object.assign(rec, { color: d.color, to: d.to, done: !!rec.done });
        // (Saves from before blocks could move: a block home has paid.)
        rec.paid = rec.paid != null ? rec.paid : rec.done ? RULES.restoreCharges : 0;
      }
      run.objects[d.key] = rec;
    }
  }

  /** After the whole world is built: objects whose room no longer exists in any form are dropped. */
  function pruneObjects() {
    const run = state.run;
    for (const k in run.objects) if (!run.objects[k].kind) delete run.objects[k];
  }

  /** Save a built object's state back into run.objects. */
  function saveObject(b) {
    const o = state.run.objects[b.key];
    if (!o) return;
    o.sx = b.sx; o.sy = b.sy; o.lv = Math.round(b.base / UNIT);
    if (b.vessel) { o.holds = b.holds || null; o.n = b.n || 0; } else if (!b.crate) { o.done = b.done; o.paid = +b.paid.toFixed(4); }
  }

  /** The mark materials of push blocks whose home room is built, by key (a block may be elsewhere). */
  const marks = new Map();

  /** A room's push-block marks, and every loose object sitting in it. Called from buildSpace. */
  function addPushBlocks(space, rec, tileAt) {
    rec.tileAt = tileAt;
    spawnObjects(space);
    for (const d of objectDefs(space)) {
      if (d.kind !== 'block') continue;
      // The mark rides its floor tile, so it assembles and dissolves with it.
      const markTile = tileAt[cellOf(d.to.sx, d.to.sy)];
      if (!markTile) continue;
      const markMat = new THREE.MeshBasicMaterial({ map: markTexture(d.color), transparent: true, depthWrite: false, opacity: 0.75 });
      const mark = new THREE.Mesh(pushGeo.mark, markMat);
      mark.rotation.x = -Math.PI / 2;
      mark.position.set((d.to.sx / 2 + 0.25) * S - markTile.position.x, 0.062, (d.to.sy / 2 + 0.25) * S - markTile.position.z);
      markTile.add(mark);
      marks.set(d.key, markMat);
      const o = state.run.objects[d.key];
      if (o && o.done) markMat.opacity = 1;
    }
    for (const key in state.run.objects) {
      const o = state.run.objects[key];
      if (!o.kind || key === state.run.carry || state.exp.registry[cellOf(o.sx, o.sy)] !== space.id) continue;
      if (o.lv == null) o.lv = propLevel(space, o.sx, o.sy); // a jar set down before v6, maybe on a block
      const b = makeObject(key, o);
      inRoom(b, space.id, rec);
      b.mesh.position.set((b.x0 + 0.25) * S, b.base * S, (b.y0 + 0.25) * S);
      state.pushBlocks.push(b);
      indexBlock(b, true);
    }
  }

  /** The level a one-unit prop block under half-cell (sx, sy) lifts something to (0 or 1). */
  function propLevel(space, sx, sy) {
    const r = sub(sx, sy);
    return DP.props(space).blocks.some((b) => b.units === 1 && !b.crate &&
      b.x0 <= r.x0 && b.x1 >= r.x1 && b.y0 <= r.y0 && b.y1 >= r.y1) ? 1 : 0;
  }

  const VESSEL_H = 0.4; // cells: a vessel stands this tall (it can't be climbed or stacked on)

  /** A built object (mesh and collision box) from its run.objects entry. Not yet in any room. */
  function makeObject(key, o) {
    if (o.kind === 'vessel') {
      const base = (o.lv || 0) * UNIT;
      const b = {
        key, push: true, vessel: true, jar: true, units: 1, base, top: base + VESSEL_H,
        holds: o.holds || null, n: o.n || 0, mesh: W.makeVesselMesh(), slide: null,
      };
      place(b, o.sx, o.sy);
      return b;
    }
    const mesh = new THREE.Group();
    let body, bodyMat = null, col = null;
    if (o.kind === 'crate') body = new THREE.Mesh(pushGeo.block, crateMat);
    else {
      // The whole block takes its colour (programmer art for now).
      col = new THREE.Color(o.color);
      bodyMat = new THREE.MeshLambertMaterial({ color: col, emissive: col.clone().multiplyScalar(0.12) });
      body = new THREE.Mesh(pushGeo.block, bodyMat);
    }
    body.castShadow = body.receiveShadow = true;
    body.position.y = UNIT * S / 2;
    mesh.add(body);
    // `paid`: how much of its charge the block has paid and you still
    // hold. Moving it off its mark takes that back; home again pays the rest.
    const base = (o.lv || 0) * UNIT;
    const b = {
      key, push: true, crate: o.kind === 'crate', units: 1, base, top: base + UNIT, color: col, bodyMat,
      to: o.to || null, done: !!o.done, paid: o.paid || 0, mesh, slide: null,
    };
    place(b, o.sx, o.sy);
    if (b.done) settle(b, false);
    return b;
  }

  /** The object now belongs to the room it sits in: its group (so it dissolves with it) and its tile (so it rises with it). */
  function inRoom(b, spaceId, rec = state.spaces.get(spaceId)) { // (a room being built isn't in state.spaces yet)
    b.spaceId = spaceId;
    b.group = rec.group;
    b.tile = rec.tileAt ? rec.tileAt[cellOf(b.sx, b.sy)] : null;
    b.group.add(b.mesh);
  }

  /** On loading a run: the object you were carrying, back in your hands. */
  function buildCarried() {
    const run = state.run;
    if (!run.carry || state.carry) return;
    const o = run.objects[run.carry];
    if (!o || !o.kind) { run.carry = null; return; }
    const b = makeObject(run.carry, o);
    b.spaceId = null;
    state.pushBlocks.push(b);
    hold(b);
  }

  /** A room about to be rerolled: the objects sitting in it are despawned (kept in a list, for later). */
  function despawnObjectsIn(ids) {
    const run = state.run;
    let n = 0;
    for (const key in run.objects) {
      const o = run.objects[key];
      if (key === run.carry) continue;
      const room = state.exp.registry[cellOf(o.sx, o.sy)];
      if (!ids.has(room)) continue;
      run.despawned.push({ key, kind: o.kind, color: o.color || null, holds: o.holds || null, n: o.n || 0, room, at: Math.round(run.walked) });
      if (run.despawned.length > 200) run.despawned.shift();
      delete run.objects[key];
      n++;
    }
    state.pushBlocks = state.pushBlocks.filter((b) => !ids.has(b.spaceId));
    return n;
  }

  /** A block in your hands: out of the world (nothing collides with it), its mesh over your head. */
  function hold(b) {
    b.carried = true;
    b.slide = null;
    b.spaceId = null; // in your hands, not in any room: a reroll can't take it
    state.carry = b;
    state.run.carry = b.key;
    W.refreshHotbar(); // the figure shows it (updateHeld), once any lift arc is done
  }

  // --- grabbing: hold E at a block (actions.js) and the ring fills; then
  // you have hold of it until you let go of E.

  /** The ring filled: you have hold of it. Facing it squarely, along one axis. */
  function startGrab(b) {
    const p = state.player;
    const cx = (b.x0 + b.x1) / 2 - p.x, cy = (b.y0 + b.y1) / 2 - p.y;
    const dir = Math.abs(cx) > Math.abs(cy) ? { x: Math.sign(cx), y: 0 } : { x: 0, y: Math.sign(cy) };
    state.grab = { block: b, dir, off: { x: -cx, y: -cy }, moved: false };
    p.angle = Math.atan2(dir.x, dir.y);
  }

  /** E let go: lift it, or (if you pushed or pulled it) just let go. `cancel`: let go either way. */
  function endGrab(cancel) {
    const g = state.grab;
    if (!g) return;
    state.grab = null;
    if (!cancel && !g.moved && !g.block.slide) liftBlock(g.block);
  }

  /**
   * While you have hold of a block, movement along its axis pushes it
   * (toward it) or pulls it (away), half a cell at a time; you move with
   * it. Sideways does nothing. Called from the main loop with the input.
   */
  function grabInput(inp) {
    const g = state.grab, b = g.block, p = state.player;
    if (b.slide || inp.mag < 0.5) return;
    const along = inp.x * g.dir.x + inp.y * g.dir.y;
    if (Math.abs(along) > 0.6 && (p.z > 0.05 || b.base > 0.01)) { // pushing and pulling: on the floor only
      if (!g.warned) W.showCaption('you can only push or pull on the floor · let go of E to lift it instead');
      g.warned = true;
      return;
    }
    if (along > 0.6) {
      if (move(b, g.dir)) g.moved = true;
      else W.showCaption('it won\'t budge that way');
    } else if (along < -0.6) {
      // Pull: room behind you to step back, then the block follows.
      const back = { x: p.x - g.dir.x * 0.5, y: p.y - g.dir.y * 0.5 };
      const bsx = Math.floor(back.x * 2), bsy = Math.floor(back.y * 2);
      const free = state.exp.registry[cellOf(bsx, bsy)] === b.spaceId &&
        !(state.blockAt.get(cellOf(bsx, bsy)) || []).some((o) => o !== b && o.top > p.z + 0.05 &&
          back.x > o.x0 - RADIUS && back.x < o.x1 + RADIUS && back.y > o.y0 - RADIUS && back.y < o.y1 + RADIUS);
      if (!free) { W.showCaption('no room behind you to pull it'); return; }
      const was = { x: p.x, y: p.y };
      p.x = back.x; p.y = back.y; // out of the way, so the block has somewhere to go
      if (move(b, { x: -g.dir.x, y: -g.dir.y })) g.moved = true;
      else { p.x = was.x; p.y = was.y; W.showCaption('it won\'t budge that way'); }
    }
  }

  /** E held at a block, and let go without moving: lift it, in an arc up over your head. Off its mark, it takes its entropy back. */
  function liftBlock(b) {
    if (b.done) unsettle(b);
    indexBlock(b, false);
    saveObject(b);
    b.mesh.traverse((o) => { o.castShadow = false; });
    b.anim = { t: 0, up: true, from: b.mesh.position.clone() };
    hold(b);
    W.showCaption(b.crate ? 'you lift the crate' : b.vessel ? 'you lift the vessel' : 'you lift the block');
    savePlayer();
  }

  /**
   * What a block would rest on at half-cell (sx, sy): the floor (0), or
   * the top of whatever's highest there, if that one thing covers the whole
   * half-cell (a one-unit block, a taller block, another crate). Null if
   * there's no flat place (a jar, a partial cover, something too tall).
   */
  function restHeight(sx, sy, except) {
    const r = sub(sx, sy);
    let top = 0, cover = null;
    for (const o of state.blockAt.get(cellOf(sx, sy)) || []) {
      if (o === except || !(o.x0 < r.x1 && o.x1 > r.x0 && o.y0 < r.y1 && o.y1 > r.y0)) continue;
      if (o.top > top + 1e-6) { top = o.top; cover = o; }
    }
    if (!cover) return 0;
    if (cover.jar || !(cover.x0 <= r.x0 && cover.x1 >= r.x1 && cover.y0 <= r.y0 && cover.y1 >= r.y1)) return null;
    // Anything else reaching that high there must be under the cover, not beside it.
    return top;
  }

  const STACK_MAX = 3; // units: a stack reaches the ceiling at most
  const levelOf = (z) => Math.round(z / UNIT);

  /**
   * Where E would set the carried block down: the free half-cell ahead,
   * in any room, resting at your level or one up (on the floor, a block's
   * top, another crate), and never higher than STACK_MAX units.
   */
  function blockSpot(p) {
    const b = state.carry;
    if (!b) return null;
    const mine = levelOf(p.z);
    return W.quarterAhead(p, (sx, sy, base) => {
      const lv = levelOf(base);
      if (Math.abs(base - lv * UNIT) > 0.02 || (lv !== mine && lv !== mine + 1) || lv + 1 > STACK_MAX) return false;
      return canMoveTo(b, sx, sy, true, base);
    }, (sx, sy) => restHeight(sx, sy, b));
  }

  /** E with a block in your hands: set it down at `spot`. On its mark, it settles and pays. */
  function setDownBlock(spot) {
    const b = state.carry;
    if (!b) return;
    b.carried = false;
    state.carry = null;
    state.run.carry = null;
    place(b, spot.sx, spot.sy);
    b.base = spot.base || 0;
    b.top = b.base + (b.vessel ? VESSEL_H : UNIT);
    // From over your head back down to where it rests, in an arc. It now
    // belongs to the room it's set down in.
    const from = b.mesh.getWorldPosition(new THREE.Vector3());
    inRoom(b, state.exp.registry[cellOf(spot.sx, spot.sy)]);
    b.group.worldToLocal(from);
    b.mesh.position.copy(from);
    b.mesh.rotation.set(0, 0, 0);
    b.anim = { t: 0, up: false, from };
    indexBlock(b, true);
    if (b.to && spot.sx === b.to.sx && spot.sy === b.to.sy) settle(b, true);
    saveObject(b);
    W.refreshHotbar();
    savePlayer();
  }

  /**
   * Can a push block go onto half-cell (sx, sy)? Bare floor, clear of
   * doorways and the figure, and (pushed or pulled) in its room; set down
   * (`anyRoom`), any room.
   */
  function canMoveTo(b, sx, sy, anyRoom, base = b.base || 0) {
    const room = state.exp.registry[cellOf(sx, sy)];
    if (room === undefined || (!anyRoom && room !== b.spaceId) || inDoorMouth(sx, sy)) return false;
    // It rests at `base` there: nothing else in the way at that height.
    if (restHeight(sx, sy, b) !== base) return false;
    const p = state.player, r = sub(sx, sy);
    if (base >= p.z + FIGURE_H || base + UNIT <= p.z) return true; // above your head or under your feet
    const ex = Math.max(r.x0 - p.x, 0, p.x - r.x1), ey = Math.max(r.y0 - p.y, 0, p.y - r.y1);
    return Math.hypot(ex, ey) >= RADIUS;
  }
  const FIGURE_H = 0.62; // cells, about the figure's height

  /** Is anything resting on top of this block (another block, a jar)? Then it stays put. */
  function loaded(b) {
    for (const o of state.blockAt.get(cellOf(b.sx, b.sy)) || []) {
      if (o !== b && Math.abs((o.base || 0) - b.top) < 0.02 && o.x0 < b.x1 && o.x1 > b.x0 && o.y0 < b.y1 && o.y1 > b.y0) return true;
    }
    return false;
  }

  function move(b, dir) {
    const sx = b.sx + dir.x, sy = b.sy + dir.y;
    if (!canMoveTo(b, sx, sy)) return false;
    const from = b.mesh.position.clone();
    indexBlock(b, false);
    place(b, sx, sy);
    indexBlock(b, true);
    b.slide = { from, t: 0 };
    const home = state.spaces.get(b.spaceId);
    b.tile = (home && home.tileAt[cellOf(sx, sy)]) || b.tile;
    if (b.to) {
      if (sx === b.to.sx && sy === b.to.sy) settle(b, true);
      else if (b.done) unsettle(b);
    }
    saveObject(b);
    savePlayer();
    return true;
  }


  /** Home: its mark lights up, and the room pays entropy (whatever it hasn't paid already). */
  function settle(b, now) {
    b.done = true;
    b.bodyMat.emissive.copy(b.color).multiplyScalar(0.55);
    if (marks.has(b.key)) marks.get(b.key).opacity = 1;
    if (!now) return;
    const gain = W.gainFuel(Math.max(0, RULES.restoreCharges - b.paid));
    b.paid += gain;
    state.run.restored = (state.run.restored || 0) + 1;
    W.showCaption(gain ? 'the block settles into place · entropy flows into your lamp'
      : 'the block settles into place');
    W.refreshHud();
  }

  /** Off its mark again: the mark dims, and the entropy it paid goes back (what you still have). */
  function unsettle(b) {
    b.done = false;
    b.bodyMat.emissive.copy(b.color).multiplyScalar(0.12);
    if (marks.has(b.key)) marks.get(b.key).opacity = 0.75;
    b.paid -= W.takeFuel(b.paid);
    W.showCaption('the block slides off its mark · the room takes its entropy back');
    W.refreshHud();
  }

  /** E at a push block or crate right in front of you, standing on the floor: lift it. */
  function liftNear(p) {
    if (state.carry) return null;
    const fx = Math.sin(p.angle), fy = Math.cos(p.angle), mine = levelOf(p.z);
    let best = null, bestD = RADIUS + 0.15;
    for (const b of state.pushBlocks) {
      if (b.carried || b.top <= p.z + 0.05) continue; // not what you stand on, nor anything lower
      const lv = levelOf(b.base || 0);
      if ((lv !== mine && lv !== mine + 1) || loaded(b)) continue; // in reach, and nothing on it
      const qx = THREE.MathUtils.clamp(p.x, b.x0, b.x1), qy = THREE.MathUtils.clamp(p.y, b.y0, b.y1);
      const d = Math.hypot(qx - p.x, qy - p.y);
      if (d >= bestD) continue;
      const cx = (b.x0 + b.x1) / 2 - p.x, cy = (b.y0 + b.y1) / 2 - p.y;
      if ((cx * fx + cy * fy) / (Math.hypot(cx, cy) || 1) < 0.5) continue; // roughly facing it
      bestD = d;
      best = { action: 'lift', block: b };
    }
    return best;
  }

  /** Slides, lift arcs, and growing and shrinking with the floor as the room assembles. */
  const overhead = new THREE.Vector3();
  function updatePushBlocks(dt) {
    for (const b of state.pushBlocks) {
      if (b.anim) { animateLift(b, dt); continue; }
      if (b.carried) continue; // over your head (items.js updateHeld)
      const tx = (b.x0 + 0.25) * S, tz = (b.y0 + 0.25) * S;
      if (b.slide) {
        b.slide.t = Math.min(1, b.slide.t + dt / SLIDE_TIME);
        const k = easeOut(b.slide.t);
        b.mesh.position.set(b.slide.from.x + (tx - b.slide.from.x) * k, b.base * S, b.slide.from.z + (tz - b.slide.from.z) * k);
        if (b.slide.t >= 1) b.slide = null;
        // Pushing or pulling it, you move with it.
        const g = state.grab;
        if (g && g.block === b) {
          state.player.x = b.mesh.position.x / S + g.off.x;
          state.player.y = b.mesh.position.z / S + g.off.y;
        }
      }
      b.mesh.scale.setScalar(Math.max(0.001, b.tile ? b.tile.scale.x : 1));
    }
  }

  /** The arc from the floor to over your head (up) or back down, with a little heft: slow to start, a rise above the straight line. */
  function animateLift(b, dt) {
    const a = b.anim;
    a.t = Math.min(1, a.t + dt / LIFT_TIME);
    const k = W.easeInOut(a.t);
    W.heldRig.parent.localToWorld(overhead.set(0, 0.6 * S, 0));
    b.group.worldToLocal(overhead);
    const to = a.up ? overhead : new THREE.Vector3((b.x0 + 0.25) * S, b.base * S, (b.y0 + 0.25) * S);
    b.mesh.position.lerpVectors(a.from, to, k);
    b.mesh.position.y += Math.sin(Math.PI * a.t) * 0.12 * S;
    if (a.t < 1) return;
    b.anim = null;
    if (a.up) W.refreshHotbar(); // now it's in your hands (updateHeld)
    else {
      b.mesh.position.copy(to);
      b.mesh.traverse((o) => { o.castShadow = true; });
    }
  }

  // ---------------------------------------------------------------------------
  // Sconces: unlit on a room's walls. E (held) at one lights it from your
  // lantern, which costs a shard of entropy; held at a lit one, snuffs it
  // and gives the shard back. A lit sconce lights the room around it, and
  // within a tile of it your lamp doesn't burn.

  const SCONCE_Y = 0.78;     // cells above the floor
  const SCONCE_OUT = 0.12;   // cells from the wall's inner face to the flame
  const SCONCE_REACH = 0.65; // cells, E reach to a sconce
  const SCONCE_LIGHTS = 3;   // real lights, given to the lit sconces nearest you
  const sconceGeo = {
    plate: new THREE.BoxGeometry(0.11 * S, 0.17 * S, 0.02 * S),
    arm: new THREE.BoxGeometry(0.025 * S, 0.025 * S, SCONCE_OUT * S),
    cup: new THREE.CylinderGeometry(0.05 * S, 0.032 * S, 0.05 * S, 10),
    flame: new THREE.ConeGeometry(0.028 * S, 0.1 * S, 8),
  };
  const ironMat = new THREE.MeshLambertMaterial({ color: 0x3b3530, emissive: 0x0a0806 });
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb35a });
  // A fixed pool, always in the scene (intensity 0 when idle): changing the
  // number of lights would recompile every material.
  const sconceLights = Array.from({ length: SCONCE_LIGHTS }, () => {
    const l = new THREE.PointLight(0xffa04f, 0, 4 * S, 1.6);
    scene.add(l);
    return l;
  });

  /** A room's sconces, mounted on their wall edges (riding the walls as they rise). */
  function addSconces(space, edgeAt) {
    for (const sd of DP.sconces(space)) {
      const edge = edgeAt[ekey(sd.cell.x, sd.cell.y, sd.facing)];
      if (!edge || state.exitAt.has(ekey(sd.cell.x, sd.cell.y, sd.facing))) continue; // that wall is a door now
      const key = space.id + ':' + space.seed + ':' + sd.id;
      const mount = new THREE.Group(); // local +z points into the room
      mount.position.set(0, SCONCE_Y * S, -edge.beyond * WALL_T * S / 2);
      mount.rotation.y = edge.beyond > 0 ? Math.PI : 0;
      const plate = new THREE.Mesh(sconceGeo.plate, ironMat);
      const arm = new THREE.Mesh(sconceGeo.arm, ironMat);
      arm.position.set(0, -0.03 * S, SCONCE_OUT * S / 2);
      const cup = new THREE.Mesh(sconceGeo.cup, ironMat);
      cup.position.set(0, -0.01 * S, SCONCE_OUT * S);
      const flame = new THREE.Mesh(sconceGeo.flame, flameMat);
      flame.position.set(0, 0.06 * S, SCONCE_OUT * S);
      for (const m of [plate, arm, cup]) m.castShadow = true;
      mount.add(plate, arm, cup, flame);
      edge.eg.add(mount);
      const d = DE.DIRS[sd.facing], inset = 0.5 - WALL_T - SCONCE_OUT;
      const sc = {
        key, spaceId: space.id, cell: sd.cell, flame, lit: !!state.run.lit[key], phase: sd.cell.x * 1.7 + sd.cell.y,
        x: sd.cell.x + 0.5 + d.x * inset, y: sd.cell.y + 0.5 + d.y * inset, eg: edge.eg,
      };
      flame.visible = sc.lit;
      state.sconces.push(sc);
    }
  }

  /** E at a sconce in your room, within reach and roughly ahead: light it, or snuff it. */
  function sconceNear(p) {
    const here = state.exp.registry[DE.key(Math.floor(p.x), Math.floor(p.y))];
    const fx = Math.sin(p.angle), fy = Math.cos(p.angle);
    let best = null, bestD = SCONCE_REACH;
    for (const sc of state.sconces) {
      if (sc.spaceId !== here) continue;
      const dx = sc.x - p.x, dy = sc.y - p.y, d = Math.hypot(dx, dy);
      if (d >= bestD || (dx * fx + dy * fy) / (d || 1) < 0.3) continue;
      bestD = d;
      best = { action: sc.lit ? 'snuff' : 'light', sconce: sc };
    }
    return best;
  }

  /** Lighting a sconce takes a shard of your lamp's flame; near it, the lamp never burns again. */
  function lightSconce(sc) {
    const run = state.run;
    if (!W.spendFuel(RULES.sconceCost / RULES.shardsPerCharge)) { W.showCaption('your lamp is too low to share its flame'); return; }
    sc.lit = true;
    sc.flame.visible = true;
    run.lit[sc.key] = true;
    run.restored = (run.restored || 0) + 1;
    W.showCaption(`the sconce catches · −${RULES.sconceCost} shard · your lamp rests near it`);
    savePlayer();
    W.refreshHud();
  }

  /** Snuff a sconce: its shard goes back into your lamp, and off the restored tally. */
  function snuffSconce(sc) {
    const run = state.run;
    sc.lit = false;
    sc.flame.visible = false;
    delete run.lit[sc.key];
    run.restored = Math.max(0, (run.restored || 0) - 1);
    const back = W.gainFuel(RULES.sconceCost / RULES.shardsPerCharge);
    W.showCaption(back > 0 ? 'you snuff the sconce · its shard comes back to your lamp' : 'you snuff the sconce · your entropy is full');
    savePlayer();
    W.refreshHud();
  }

  /** Flames flicker; the nearest lit sconces get the real lights. */
  function updateSconces() {
    const p = state.player, t = state.time;
    const near = state.sconces.filter((sc) => sc.lit && sc.eg.scale.y > 0.5)
      .map((sc) => ({ sc, d: Math.hypot(sc.x - p.x, sc.y - p.y) }))
      .filter((o) => o.d < 12).sort((a, b) => a.d - b.d);
    for (const sc of state.sconces) {
      if (sc.lit) sc.flame.scale.set(1, 1 + 0.18 * Math.sin(t * 13 + sc.phase) + 0.08 * Math.sin(t * 29 + sc.phase * 2), 1);
    }
    sconceLights.forEach((l, i) => {
      const o = near[i];
      if (!o) { l.intensity = 0; return; }
      l.position.set(o.sc.x * S, (SCONCE_Y + 0.08) * S, o.sc.y * S);
      l.intensity = 5 * (1 + 0.08 * Math.sin(t * 17 + o.sc.phase));
    });
  }

  Object.assign(W, { SCONCE_Y, addPushBlocks, buildCarried, pruneObjects, despawnObjectsIn, saveObject, liftNear, liftBlock, startGrab, endGrab, grabInput, blockSpot,
    setDownBlock, updatePushBlocks, addSconces,
    sconceNear, lightSconce, snuffSconce, updateSconces });
})(window);
