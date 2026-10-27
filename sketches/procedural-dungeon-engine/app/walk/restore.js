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

  // Seconds for the arc up over your head, or back down: stone is heavier.
  const LIFT_TIME = { crate: 0.38, vessel: 0.32, block: 0.6, waystone: 0.6 };
  // How fast you walk with it over your head (no running with anything).
  const CARRY_PACE = { crate: 0.85, vessel: 1, block: 0.7, waystone: 0.7 };
  // What each kind of loose object allows. bearsStack: something can be set
  // on top of it (it then rests a whole unit up, however tall the thing
  // is). covers: what's inside is hidden while something rests on top of
  // it: its pixies don't show, and creatures blind to 'covered' (ecology.js)
  // don't notice them. Anything else in blockAt (a jar on the floor) bears
  // nothing.
  const KINDS = {
    crate: { bearsStack: true },
    block: { bearsStack: true },
    waystone: { bearsStack: true, covers: true },
    vessel: { bearsStack: true, covers: true },
  };

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

  /**
   * (Re)index a block under every cell its box overlaps (b.cells
   * remembers which), or take it out. Dragged, its box is off the
   * half-cell grid and can straddle two cells.
   */
  function indexBlock(b, add) {
    for (const k of b.cells || []) {
      const list = (state.blockAt.get(k) || []).filter((o) => o !== b);
      if (list.length) state.blockAt.set(k, list); else state.blockAt.delete(k);
    }
    b.cells = null;
    if (!add) return;
    b.cells = [];
    for (let cy = Math.floor(b.y0); cy < Math.ceil(b.y1); cy++) {
      for (let cx = Math.floor(b.x0); cx < Math.ceil(b.x1); cx++) {
        const k = DE.key(cx, cy);
        b.cells.push(k);
        state.blockAt.set(k, (state.blockAt.get(k) || []).concat(b));
      }
    }
  }

  /** On notch (sx, sy), socketed: no offset. */
  function place(b, sx, sy) {
    Object.assign(b, { sx, sy, ox: 0, oy: 0 }, sub(sx, sy));
  }

  /** The box at its notch plus its offset (ox, oy: cells, within a quarter cell; a dragged block can stop off the grid). */
  function setBox(b) {
    const r = sub(b.sx, b.sy);
    Object.assign(b, { x0: r.x0 + b.ox, x1: r.x1 + b.ox, y0: r.y0 + b.oy, y1: r.y1 + b.oy });
  }

  /** Placed from its saved record: its notch, and wherever off it it was left. */
  function placeSaved(b, o) {
    place(b, o.sx, o.sy);
    b.ox = o.ox || 0;
    b.oy = o.oy || 0;
    setBox(b);
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
    if (DP.hallKeepsStone(space)) out.push({ key: id('waystone'), kind: 'waystone', from: DP.hallStone(space) });
    return out;
  }

  /**
   * The hall within two rooms of this one that lost its waystone and hasn't
   * had it turn up yet (run.stonePaid), or null. The first room grown that
   * near it holds the stone (a reroll before you take it owes it again).
   */
  function owingHall(space) {
    const exp = state.exp, run = state.run;
    let p = exp.spaces[space.parentId];
    for (let n = 0; n < 2 && p; n++, p = exp.spaces[p.parentId]) {
      if (p.archetype !== 'hall') continue;
      if (DP.hallKeepsStone(p) || run.stonePaid[p.id + ':' + p.seed]) return null;
      return p;
    }
    return null;
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
      // A hall's own stone: the starter's comes powered, and so does one whose old fixed stone you woke.
      if (d.kind === 'waystone' && !o) rec.holds = !space.parentId || run.waystones[space.id + ':' + space.seed] ? 'entropy' : null;
      if (d.kind === 'block') {
        Object.assign(rec, { color: d.color, to: d.to, done: !!rec.done });
        // (Saves from before blocks could move: a block home has paid.)
        rec.paid = rec.paid != null ? rec.paid : rec.done ? RULES.restoreCharges : 0;
      }
      run.objects[d.key] = rec;
    }
    // A hall's scattered waystone, turning up near it.
    const hall = owingHall(space), spot = hall && DP.stoneSpot(space);
    if (spot) {
      const hk = hall.id + ':' + hall.seed, key = space.id + ':' + space.seed + ':waystone';
      run.objects[key] = { kind: 'waystone', sx: spot.sx, sy: spot.sy, lv: 0, holds: run.waystones[hk] ? 'entropy' : null, debt: hk };
      run.stonePaid[hk] = key;
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
    if (b.ox || b.oy) { o.ox = +b.ox.toFixed(4); o.oy = +b.oy.toFixed(4); } else { delete o.ox; delete o.oy; }
    if (b.vessel) { o.holds = b.holds || null; o.n = b.n || 0; } else if (b.waystone) { o.holds = b.holds || null; }
    else if (!b.crate) { o.done = b.done; o.paid = +b.paid.toFixed(4); }
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
    if (o.kind === 'waystone') {
      const base = (o.lv || 0) * UNIT;
      const b = { key, push: true, waystone: true, units: 1, base, top: base + UNIT, holds: o.holds || null, mesh: W.makeStoneMesh(key) };
      placeSaved(b, o);
      return b;
    }
    if (o.kind === 'vessel') {
      const base = (o.lv || 0) * UNIT;
      const b = {
        key, push: true, vessel: true, jar: true, units: 1, base, top: base + VESSEL_H,
        holds: o.holds || null, n: o.n || 0, mesh: W.makeVesselMesh(),
      };
      placeSaved(b, o);
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
      to: o.to || null, done: !!o.done, paid: o.paid || 0, mesh,
    };
    placeSaved(b, o);
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
    setShadow(b, 0); // in your hands: no shadow
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
      if (o.debt) delete run.stonePaid[o.debt]; // a hall's scattered stone, lost before it was found a home: it turns up again
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
    // v: speed along dir (cells/s; + pushes); way: the way it last moved;
    // letGo: E is up, it's coming to a stop; settle: easing into a notch.
    state.grab = { block: b, dir, moved: false, v: 0, way: 0, letGo: false, settle: null };
    p.angle = Math.atan2(dir.x, dir.y);
  }

  /** E let go: lift it, or (if you dragged it) let go of it where it is. `cancel`: let go either way. */
  function endGrab(cancel) {
    const g = state.grab;
    if (!g || g.letGo) return;
    if (!g.moved) {
      state.grab = null;
      showNotch(null);
      if (!cancel) liftBlock(g.block);
      return;
    }
    g.letGo = true; // it slows to a stop (grabInput), then maybe settles
  }

  const kindOf = (b) => b.crate ? 'crate' : b.vessel ? 'vessel' : b.waystone ? 'waystone' : 'block';
  // Dragging speed, cells a second: lighter things move quicker; pulling is slower.
  const DRAG = { crate: 0.55 * W.SPEED, vessel: 0.6 * W.SPEED, block: 0.35 * W.SPEED, waystone: 0.35 * W.SPEED };
  const PULL = 0.7;
  // Heft: how fast it gets going (cells/s²); it stops HEFT_STOP times as fast.
  const HEFT = { crate: 8, vessel: 9, block: 3, waystone: 3 };
  const HEFT_STOP = 1.5;
  const SOCKET = 0.1; // cells: stopped this close to a notch (both ways), it settles in

  /** Offsets from the notch, along the grab axis and across it. */
  const alongOf = (g, b) => g.dir.x ? b.ox : b.oy;
  const acrossOf = (g, b) => g.dir.x ? b.oy : b.ox;

  /**
   * Drag physics, once a frame: speed eases toward what the input asks for
   * (heft), then block and figure move by the same amount, as far as both
   * have room. Let go, it slows to a stop, then settles if it's near a
   * notch, or stays right where it is.
   */
  function grabInput(inp, dt) {
    const g = state.grab, b = g.block, p = state.player;
    if (g.settle) { settleStep(g, dt); return; }
    let along = 0;
    if (!g.letGo && inp.mag > 0.3) {
      along = (inp.x * g.dir.x + inp.y * g.dir.y) * inp.mag;
      if (Math.abs(along) < 0.3) along = 0;
    }
    if (along && (p.z > 0.05 || b.base > 0.01)) { // dragging: on the floor only
      if (!g.warned) W.showCaption('you can only push or pull on the floor · let go of E to lift it instead');
      g.warned = true;
      along = 0;
    }
    const k = kindOf(b);
    const want = along * DRAG[k] * (along < 0 ? PULL : 1);
    const speedingUp = want && Math.sign(want) === Math.sign(g.v || want) && Math.abs(want) >= Math.abs(g.v);
    const a = HEFT[k] * (speedingUp ? 1 : HEFT_STOP) * dt;
    g.v = g.v < want ? Math.min(want, g.v + a) : Math.max(want, g.v - a);
    if (g.v) {
      const s = Math.sign(g.v), step = Math.abs(g.v) * dt;
      let d = Math.min(step, roomAhead(b, { x: g.dir.x * s, y: g.dir.y * s }, step));
      d = Math.min(d, figureRoom(g, s * d));
      if (d < step - 1e-9) g.v = 0; // against something: it stops dead
      if (d > 1e-9) {
        shift(b, g.dir.x * s * d, g.dir.y * s * d);
        p.x += g.dir.x * s * d;
        p.y += g.dir.y * s * d;
        g.moved = true;
        g.way = s;
      }
    }
    showNotch(g);
    if (g.letGo && !g.v) startSettle(g);
  }

  /**
   * Stopped after letting go: within SOCKET of its notch both ways, it eases
   * in (and you with it, along the axis); otherwise it stays put, off the grid.
   */
  function startSettle(g) {
    const b = g.block, p = state.player;
    const a = alongOf(g, b), c = acrossOf(g, b);
    const ax = g.dir.x ? 1 : 0, ay = g.dir.y ? 1 : 0; // the grab axis
    let ok = (a || c) && Math.abs(a) <= SOCKET && Math.abs(c) <= SOCKET;
    // Along: you follow it, or (if it moves away from you) it leaves the smallest gap.
    const dd = -a * (g.dir.x + g.dir.y); // along, in grab-dir terms (+ is away from you)
    let follow = true;
    if (ok && a) {
      ok = roomAhead(b, { x: -Math.sign(a) * ax, y: -Math.sign(a) * ay }, Math.abs(a)) >= Math.abs(a) - 1e-6;
      if (ok && figureRoom(g, dd) < Math.abs(dd) - 1e-6) { follow = false; ok = dd > 0; }
    }
    // Across: only the block moves, a hair, if nothing's there (you included).
    if (ok && c) {
      ok = roomAhead(b, { x: -Math.sign(c) * ay, y: -Math.sign(c) * ax }, Math.abs(c)) >= Math.abs(c) - 1e-6;
      const ex = Math.max(b.x0 - c * ay - p.x, 0, p.x - b.x1 + c * ay), ey = Math.max(b.y0 - c * ax - p.y, 0, p.y - b.y1 + c * ax);
      if (ok && Math.hypot(ex, ey) < RADIUS - 1e-3) ok = false;
    }
    if (!ok) { finishGrab(); return; }
    const T = THREE.MathUtils.clamp(2 * Math.max(Math.abs(a), Math.abs(c)) / DRAG[kindOf(b)], 0.08, 0.2);
    g.settle = { bx: -b.ox, by: -b.oy, fx: follow ? -a * ax : 0, fy: follow ? -a * ay : 0, k: 0, T };
  }

  /** The last little ease into the notch. */
  function settleStep(g, dt) {
    const st = g.settle, b = g.block, p = state.player;
    const k0 = easeOut(st.k);
    st.k = Math.min(1, st.k + dt / st.T);
    const f = easeOut(st.k) - k0;
    shift(b, st.bx * f, st.by * f);
    p.x += st.fx * f;
    p.y += st.fy * f;
    showNotch(g);
    if (st.k >= 1) {
      b.ox = b.oy = 0; // exactly
      shift(b, 0, 0);
      finishGrab();
    }
  }

  /** Done with it, wherever it stopped. Socketed on its mark, it's home. */
  function finishGrab() {
    const b = state.grab.block;
    state.grab = null;
    showNotch(null);
    if (b.to) {
      if (!b.ox && !b.oy && b.sx === b.to.sx && b.sy === b.to.sy) { if (!b.done) settle(b, true); }
      else if (b.done) unsettle(b);
    }
    saveObject(b);
    savePlayer();
  }

  /**
   * How far (cells) the figure can follow a block that moves `d` along the
   * grab axis: probed with the same collisions the figure walks by, the
   * block itself left out (it moves the same way).
   */
  function figureRoom(g, d) {
    if (!d) return 0;
    const p = state.player, q = { x: p.x + g.dir.x * d, y: p.y + g.dir.y * d, z: p.z };
    W.resolveCollisions(q, g.block);
    if (state.exp.registry[DE.key(Math.floor(q.x), Math.floor(q.y))] === undefined) return 0;
    return Math.max(0, ((q.x - p.x) * g.dir.x + (q.y - p.y) * g.dir.y) * Math.sign(d));
  }

  /**
   * How far (up to `max` cells) the block can slide along unit axis `m`
   * before it meets anything: a half-cell out of its room or in a doorway's
   * mouth, or another block's box (they can be off the grid too).
   */
  function roomAhead(b, m, max) {
    const hor = m.x !== 0, s = m.x + m.y;
    const u0 = hor ? b.x0 : b.y0, u1 = hor ? b.x1 : b.y1, v0 = hor ? b.y0 : b.x0, v1 = hor ? b.y1 : b.x1;
    let lim = max;
    // Half-cell rows ahead, across the box's width.
    const j0 = Math.floor(v0 * 2 + 1e-6), j1 = Math.ceil(v1 * 2 - 1e-6) - 1;
    const rowFree = (k) => {
      for (let j = j0; j <= j1; j++) {
        const sx = hor ? k : j, sy = hor ? j : k;
        if (state.exp.registry[cellOf(sx, sy)] !== b.spaceId || inDoorMouth(sx, sy)) return false;
      }
      return true;
    };
    if (s > 0) {
      for (let k = Math.ceil(u1 * 2 - 1e-6); k / 2 - u1 < lim; k++) if (!rowFree(k)) { lim = Math.max(0, k / 2 - u1); break; }
    } else {
      for (let k = Math.floor(u0 * 2 + 1e-6) - 1; u0 - (k + 1) / 2 < lim; k--) if (!rowFree(k)) { lim = Math.max(0, u0 - (k + 1) / 2); break; }
    }
    // Other blocks at its height, overlapping it across.
    const base = b.base || 0, cx = Math.floor((b.x0 + b.x1) / 2), cy = Math.floor((b.y0 + b.y1) / 2), seen = new Set();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const o of state.blockAt.get(DE.key(cx + dx, cy + dy)) || []) {
        if (o === b || seen.has(o) || o.top <= base + 0.02 || (o.base || 0) >= b.top - 0.02) continue;
        seen.add(o);
        const ou0 = hor ? o.x0 : o.y0, ou1 = hor ? o.x1 : o.y1, ov0 = hor ? o.y0 : o.x0, ov1 = hor ? o.y1 : o.x1;
        if (!(ov0 < v1 - 1e-6 && ov1 > v0 + 1e-6)) continue;
        if (s > 0 && ou0 >= u1 - 1e-6) lim = Math.min(lim, Math.max(0, ou0 - u1));
        if (s < 0 && ou1 <= u0 + 1e-6) lim = Math.min(lim, Math.max(0, u0 - ou1));
      }
    }
    return lim;
  }

  /**
   * Move a block's box by (dx, dy) cells. Its notch (sx, sy: what's saved,
   * and which room it's in) is always the nearest one, so the offset from
   * it stays within a quarter cell.
   */
  function shift(b, dx, dy) {
    b.ox += dx;
    b.oy += dy;
    const sx0 = b.sx, sy0 = b.sy;
    while (b.ox > 0.25 + 1e-9) { b.sx++; b.ox -= 0.5; }
    while (b.ox < -0.25 - 1e-9) { b.sx--; b.ox += 0.5; }
    while (b.oy > 0.25 + 1e-9) { b.sy++; b.oy -= 0.5; }
    while (b.oy < -0.25 - 1e-9) { b.sy--; b.oy += 0.5; }
    if (Math.abs(b.ox) < 1e-9) b.ox = 0;
    if (Math.abs(b.oy) < 1e-9) b.oy = 0;
    setBox(b);
    indexBlock(b, true);
    b.mesh.position.set((b.x0 + 0.25) * S, b.base * S, (b.y0 + 0.25) * S);
    if (b.sx !== sx0 || b.sy !== sy0) {
      const home = state.spaces.get(b.spaceId);
      b.tile = (home && home.tileAt[cellOf(b.sx, b.sy)]) || b.tile;
      saveObject(b);
    }
  }

  // The notch ahead: a faint outline on the floor where a dragged block
  // would sit socketed, brighter once it's close enough to settle in.
  const notchMat = (() => {
    const n = 64, cv = document.createElement('canvas');
    cv.width = cv.height = n;
    const c = cv.getContext('2d');
    c.strokeStyle = '#ffe2c4';
    c.lineWidth = n * 0.06;
    const a = n * 0.06, l = n * 0.26;
    for (const [x, y, sx, sy] of [[a, a, 1, 1], [n - a, a, -1, 1], [a, n - a, 1, -1], [n - a, n - a, -1, -1]]) {
      c.beginPath(); c.moveTo(x + sx * l, y); c.lineTo(x, y); c.lineTo(x, y + sy * l); c.stroke();
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0 });
  })();
  const notch = new THREE.Mesh(new THREE.PlaneGeometry(0.5 * S * 0.98, 0.5 * S * 0.98), notchMat);
  notch.rotation.x = -Math.PI / 2;
  notch.visible = false;
  scene.add(notch);
  const NOTCH_FAINT = 0.18, NOTCH_NEAR = 0.6;

  /**
   * Show the notch a dragged block is heading for: the nearest one ahead
   * the way it last moved (or the one it's settling into). None if it's off
   * the grid across the axis (dragging can't line it up), or there's no room.
   */
  function showNotch(g) {
    const b = g && g.block;
    if (!b || !g.way || b.base > 0.01 || Math.abs(acrossOf(g, b)) > SOCKET) { notch.visible = false; return; }
    const a = alongOf(g, b), s = g.way * (g.dir.x + g.dir.y); // the way it moves, along the axis's + direction
    let at = 0; // the target, as an offset along the axis from its notch: this one, or half a cell on
    if (!g.settle && s * a >= 0) at = s * 0.5;
    const tsx = b.sx + (g.dir.x ? Math.sign(at) : 0), tsy = b.sy + (g.dir.y ? Math.sign(at) : 0);
    if (at && !canMoveTo(b, tsx, tsy, false, 0, true)) { notch.visible = false; return; }
    const near = !!g.settle || Math.abs(at - a) <= SOCKET;
    notch.visible = true;
    notchMat.opacity = near ? NOTCH_NEAR : NOTCH_FAINT;
    notch.position.set((tsx / 2 + 0.25) * S, 0.068, (tsy / 2 + 0.25) * S);
  }

  // Shadows: what you carry casts none (your lantern is right beside it,
  // and its shadow would sweep the room), so a block's shadow fades out
  // as it leaves the ground and back in as it touches down: full on the
  // surface, gone SHADOW_FADE.height cells above it. Dithered: its shadow
  // is drawn with a screen-door pattern of more or fewer holes (a 4x4
  // ordered dither in the shadow map), not switched.
  const SHADOW_FADE = { height: 0.18 }; // cells above where it rests
  function shadowMatOf(b) {
    if (b.shadowMat) return b.shadowMat;
    const fade = { value: 1 };
    const m = new THREE.MeshDistanceMaterial();
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uShadowFade = fade;
      // Declarations before main (three.js writes it `void main () {`), the test first thing in it.
      sh.fragmentShader = `uniform float uShadowFade;
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
` + sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  if (bayer4(gl_FragCoord.xy) >= uShadowFade) discard;`);
    };
    m.userData.fade = fade;
    b.shadowMat = m;
    return m;
  }
  /** How much shadow a block casts now (0..1), dithered in between. */
  function setShadow(b, k) {
    const m = shadowMatOf(b);
    m.userData.fade.value = k;
    b.mesh.traverse((o) => {
      if (!o.isMesh || o.userData.noShadow) return;
      o.customDistanceMaterial = m;
      o.castShadow = k > 0.001;
    });
  }

  /** E held at a block, and let go without moving: lift it, in an arc up over your head. Off its mark, it takes its entropy back. */
  function liftBlock(b) {
    if (b.done) unsettle(b);
    indexBlock(b, false);
    saveObject(b);
    b.anim = { t: 0, up: true, from: b.mesh.position.clone() }; // its shadow fades out as it rises (animateLift)
    const p = state.player;
    b.liftedFrom = { sx: b.sx, sy: b.sy, base: b.base || 0, px: p.x, py: p.y, pz: p.z };
    hold(b);
    W.showCaption(b.crate ? 'you lift the crate' : b.vessel ? 'you lift the vessel'
      : b.waystone ? (b.holds ? 'you lift the waystone · it leaves your ley lines until you set it down' : 'you lift the waystone') : 'you lift the block');
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
    if (!bearsStack(cover) || !(cover.x0 <= r.x0 && cover.x1 >= r.x1 && cover.y0 <= r.y0 && cover.y1 >= r.y1)) return null;
    // Anything else reaching that high there must be under the cover, not beside it.
    return stackTop(cover);
  }

  const STACK_MAX = 3; // units: a stack reaches the ceiling at most
  const levelOf = (z) => Math.round(z / UNIT);

  /**
   * Where E would set the carried block down: the half-cell right in front
   * of the one you stand in, along the way you most face (no diagonals), in
   * any room, resting at your level or one up (on the floor, a block's top,
   * another crate), and never higher than STACK_MAX units. If you're too
   * close to it, you're nudged back as it lands (`nudge`: where you end
   * up); only if there's no room behind you does it go one further ahead.
   */
  const NUDGE_TIME = 0.14; // seconds to ease back out of the way
  function blockSpot(p) {
    const b = state.carry;
    if (!b) return null;
    const mine = levelOf(p.z);
    const ok = (sx, sy, nudge) => {
      const base = restHeight(sx, sy, b);
      if (base === null) return null;
      const lv = levelOf(base);
      if (Math.abs(base - lv * UNIT) > 0.02 || (lv !== mine && lv !== mine + 1) || lv + 1 > STACK_MAX) return null;
      if (canMoveTo(b, sx, sy, true, base)) return { sx, sy, base };
      if (!nudge || !canMoveTo(b, sx, sy, true, base, true)) return null;
      const to = nudgeClear(p, sub(sx, sy), b);
      return to ? { sx, sy, base, nudge: to } : null;
    };
    const fx = Math.sin(p.angle), fy = Math.cos(p.angle);
    const d = Math.abs(fx) > Math.abs(fy) ? { x: Math.sign(fx), y: 0 } : { x: 0, y: Math.sign(fy) };
    const psx = Math.floor(p.x * 2), psy = Math.floor(p.y * 2);
    // Haven't moved since lifting it, still facing where it came from: back there.
    // (Turn away, and it's the half-cell in front of you like any other time.)
    const f = b.liftedFrom;
    if (f && Math.hypot(p.x - f.px, p.y - f.py) < 0.2 && Math.abs(p.z - f.pz) < 0.05) {
      const rx = f.sx - psx, ry = f.sy - psy;
      if (rx * d.x + ry * d.y > 0 && rx * d.y - ry * d.x === 0) {
        const back = ok(f.sx, f.sy);
        if (back) return back;
      }
    }
    // Otherwise: the half-cell in front of yours (nudging you back if you're in its way), else the one past it.
    for (const k of [1, 2]) {
      const sx = psx + d.x * k, sy = psy + d.y * k;
      if (k === 2 && !W.quarterReachable(sx, sy, p)) break;
      if (k === 1 && !W.quarterReachable(sx, sy, p)) return null; // a wall right in front
      const spot = ok(sx, sy, k === 1);
      if (spot) return spot;
    }
    return null;
  }

  /**
   * Where you'd step back to so a block landing on `r` clears you: straight
   * out from it, just past your radius. Null if something behind you is in
   * the way (or it's off the map).
   */
  function nudgeClear(p, r, b) {
    const ex = Math.max(r.x0 - p.x, 0, p.x - r.x1), ey = Math.max(r.y0 - p.y, 0, p.y - r.y1);
    const gap = RADIUS + 0.02;
    const to = { x: p.x, y: p.y, z: p.z };
    if (ex >= ey) to.x = p.x < r.x0 ? r.x0 - gap : r.x1 + gap;
    else to.y = p.y < r.y0 ? r.y0 - gap : r.y1 + gap;
    if (state.exp.registry[DE.key(Math.floor(to.x), Math.floor(to.y))] === undefined) return null;
    const q = Object.assign({}, to);
    W.resolveCollisions(q, b);
    return Math.hypot(q.x - to.x, q.y - to.y) < 0.01 ? { x: to.x, y: to.y } : null;
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
    // Too close: ease back out of its way (collisions leave it alone meanwhile, main.js).
    if (spot.nudge) state.nudge = { block: b, fx: state.player.x, fy: state.player.y, tx: spot.nudge.x, ty: spot.nudge.y, t: 0 };
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
  function canMoveTo(b, sx, sy, anyRoom, base = b.base || 0, ignoreFigure = false) {
    const room = state.exp.registry[cellOf(sx, sy)];
    if (room === undefined || (!anyRoom && room !== b.spaceId) || inDoorMouth(sx, sy)) return false;
    // It rests at `base` there: nothing else in the way at that height.
    if (restHeight(sx, sy, b) !== base) return false;
    const p = state.player, r = sub(sx, sy);
    if (ignoreFigure || base >= p.z + FIGURE_H || base + UNIT <= p.z) return true; // above your head or under your feet
    const ex = Math.max(r.x0 - p.x, 0, p.x - r.x1), ey = Math.max(r.y0 - p.y, 0, p.y - r.y1);
    return Math.hypot(ex, ey) >= RADIUS;
  }
  const FIGURE_H = 0.62; // cells, about the figure's height

  /** Is anything resting on top of this block (another block, a jar)? Then it stays put. */
  function loaded(b) {
    if (b.carried) return false;
    const top = stackTop(b);
    for (const o of state.blockAt.get(cellOf(b.sx, b.sy)) || []) {
      if (o !== b && Math.abs((o.base || 0) - top) < 0.02 && o.x0 < b.x1 && o.x1 > b.x0 && o.y0 < b.y1 && o.y1 > b.y0) return true;
    }
    return false;
  }
  /** Can something be set on top of `o` (KINDS)? A loose object by its kind; anything else, unless it's a jar. */
  const bearsStack = (o) => (o.push ? !!(KINDS[kindOf(o)] || {}).bearsStack : !o.jar);
  /** Where something set on `o` rests: a whole number of units up (a vessel is a little short of one). */
  const stackTop = (o) => (o.push ? (o.base || 0) + (o.units || 1) * UNIT : o.top);
  /** Is what's in `b` hidden right now: a kind that covers, with something resting on it (KINDS)? */
  const covered = (b) => !!(KINDS[kindOf(b)] || {}).covers && loaded(b);

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

  /** Lift arcs, and growing and shrinking with the floor as the room assembles. */
  const overhead = new THREE.Vector3();
  function updatePushBlocks(dt) {
    const n = state.nudge;
    if (n) {
      n.t = Math.min(1, n.t + dt / NUDGE_TIME);
      const k = easeOut(n.t), p = state.player;
      p.x = n.fx + (n.tx - n.fx) * k;
      p.y = n.fy + (n.ty - n.fy) * k;
      if (n.t >= 1) state.nudge = null;
    }
    for (const b of state.pushBlocks) {
      if (b.anim) { animateLift(b, dt); continue; }
      if (b.carried) continue; // over your head (items.js updateHeld)
      b.mesh.scale.setScalar(Math.max(0.001, b.tile ? b.tile.scale.x : 1));
    }
  }

  /** The arc from the floor to over your head (up) or back down, with a little heft: slow to start, a rise above the straight line. */
  function animateLift(b, dt) {
    const a = b.anim;
    a.t = Math.min(1, a.t + dt / LIFT_TIME[kindOf(b)]);
    const k = W.easeInOut(a.t);
    W.heldRig.parent.localToWorld(overhead.set(0, 0.6 * S, 0));
    b.group.worldToLocal(overhead);
    const to = a.up ? overhead : new THREE.Vector3((b.x0 + 0.25) * S, b.base * S, (b.y0 + 0.25) * S);
    b.mesh.position.lerpVectors(a.from, to, k);
    b.mesh.position.y += Math.sin(Math.PI * a.t) * 0.12 * S;
    // The shadow, by how high it is over where it rests (where it came from, lifting; where it lands, setting down).
    const rest = a.up ? a.from.y : to.y;
    setShadow(b, 1 - THREE.MathUtils.smoothstep((b.mesh.position.y - rest) / S, 0, SHADOW_FADE.height));
    if (a.t < 1) return;
    b.anim = null;
    if (a.up) W.refreshHotbar(); // now it's in your hands (updateHeld)
    else {
      b.mesh.position.copy(to);
      setShadow(b, 1);
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
  // A lit sconce's light, and its pool (light.js): where its light shows on the floor, in bands, and what creatures read as its light.
  const SCONCE_LIGHT = { color: 0xffa04f, intensity: 5, reach: 4, decay: 1.6, pool: 2 }; // reach, pool: cells
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
    const l = new THREE.PointLight(SCONCE_LIGHT.color, 0, SCONCE_LIGHT.reach * S, SCONCE_LIGHT.decay);
    scene.add(l);
    W.light.addPooledLight(l);
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
    shown = near.slice(0, SCONCE_LIGHTS).map((o) => o.sc);
    sconceLights.forEach((l, i) => {
      const o = near[i];
      if (!o) { l.intensity = 0; return; }
      l.position.set(o.sc.x * S, (SCONCE_Y + 0.08) * S, o.sc.y * S);
      l.intensity = SCONCE_LIGHT.intensity * (1 + 0.08 * Math.sin(t * 17 + o.sc.phase));
    });
  }

  /** A sconce's pool (light.js), whether or not it has one of the real lights now; no radius unless it's lit. */
  function sconceLight(sc) {
    return { x: sc.x, y: sc.y, r: sc.lit ? SCONCE_LIGHT.pool : 0, from: { x: sc.x, y: sc.y, h: SCONCE_Y + 0.08 } };
  }
  /** The pools of the sconces that have real lights this frame, nearest first (the ones drawn). */
  let shown = [];
  const sconcePools = () => shown.map(sconceLight);
  // A lit sconce is an entropy light (light.js): your lamp rests in it.
  W.light.addEntropyLights(() => state.sconces.filter((sc) => sc.lit)
    .map((sc) => ({ ref: sc, pool: sconceLight(sc), flame: sc.flame, color: SCONCE_LIGHT.color })));

  /** Your walking speed carrying `b`, as a share of the usual. */
  const carryPace = (b) => CARRY_PACE[kindOf(b)];

  Object.assign(W, { SCONCE_Y, carryPace, addPushBlocks, buildCarried, pruneObjects, despawnObjectsIn, saveObject, liftNear, liftBlock, startGrab, endGrab, grabInput, blockSpot,
    setDownBlock, updatePushBlocks, addSconces, KINDS, covered, SHADOW_FADE,
    sconceNear, lightSconce, snuffSconce, updateSconces, SCONCE_LIGHT, sconceLight, sconcePools });
})(window);
