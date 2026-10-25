// Walk mode: restoration (GAME-DESIGN.md). Setting the dungeon right pays
// entropy, once. For now: push blocks, each with a matching floor mark where
// it belongs, and unlit sconces on the walls. Crates (loose props) move the
// same way as push blocks but have no home and pay nothing. Either can be
// pushed (walk into it) or lifted (E) and carried over your head, then set
// down again (E): a block you can lift is never stuck.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, DP, RULES, THREE, S, RADIUS, UNIT, WALL_T, ekey, scene, state, savePlayer, easeOut,
    inDoorMouth } = W;

  const SLIDE_TIME = 0.22; // seconds for a push to slide one half-cell

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

  /**
   * A room's push blocks and their marks, built with the room. The block's
   * position and whether it's home are kept in run.pushed, by room seed.
   */
  function addPushBlocks(space, rec, tileAt) {
    for (const pb of DP.pushBlocks(space)) {
      const key = space.id + ':' + space.seed + ':' + pb.id;
      const saved = state.run.pushed[key];
      const col = new THREE.Color(pb.color);
      // The mark rides its floor tile, so it assembles and dissolves with it.
      const markTile = tileAt[cellOf(pb.to.sx, pb.to.sy)];
      const markMat = new THREE.MeshBasicMaterial({ map: markTexture(pb.color), transparent: true, depthWrite: false, opacity: 0.75 });
      const mark = new THREE.Mesh(pushGeo.mark, markMat);
      mark.rotation.x = -Math.PI / 2;
      mark.position.set((pb.to.sx / 2 + 0.25) * S - markTile.position.x, 0.062, (pb.to.sy / 2 + 0.25) * S - markTile.position.z);
      markTile.add(mark);

      // The whole block takes its colour (programmer art for now).
      const mesh = new THREE.Group();
      const bodyMat = new THREE.MeshLambertMaterial({ color: col, emissive: col.clone().multiplyScalar(0.12) });
      const body = new THREE.Mesh(pushGeo.block, bodyMat);
      body.castShadow = body.receiveShadow = true;
      body.position.y = UNIT * S / 2;
      mesh.add(body);
      rec.group.add(mesh);

      // `paid`: how much of its charge the block has paid and you still
      // hold. Moving it off its mark takes that back; home again pays the
      // rest. (Saves from before blocks could move: a block home has paid.)
      const b = {
        key, spaceId: space.id, push: true, units: 1, top: UNIT, color: col,
        to: pb.to, done: !!(saved && saved.done), mesh, bodyMat, markMat,
        tile: tileAt[cellOf(pb.from.sx, pb.from.sy)], slide: null,
        paid: saved ? (saved.paid != null ? saved.paid : saved.done ? RULES.restoreCharges : 0) : 0,
      };
      b.group = rec.group;
      const at = saved ? { sx: saved.sx, sy: saved.sy } : pb.from;
      place(b, at.sx, at.sy);
      mesh.position.set((b.x0 + 0.25) * S, 0, (b.y0 + 0.25) * S);
      if (b.done) settle(b, false);
      addBlock(b);
    }
    // Crates: no mark and no reward; only where they've been pushed is kept.
    for (const pr of DP.props(space).blocks) {
      if (!pr.crate) continue;
      const key = space.id + ':' + space.seed + ':' + pr.crate.id;
      const saved = state.run.pushed[key];
      const mesh = new THREE.Group();
      const body = new THREE.Mesh(pushGeo.block, crateMat);
      body.castShadow = body.receiveShadow = true;
      body.position.y = UNIT * S / 2;
      mesh.add(body);
      rec.group.add(mesh);
      const b = {
        key, spaceId: space.id, push: true, crate: true, units: 1, top: UNIT, to: null, done: false, paid: 0,
        mesh, tile: tileAt[cellOf(pr.crate.sx, pr.crate.sy)], slide: null,
      };
      b.group = rec.group;
      const at = saved || pr.crate;
      place(b, at.sx, at.sy);
      mesh.position.set((b.x0 + 0.25) * S, 0, (b.y0 + 0.25) * S);
      addBlock(b);
    }
  }

  /** Into the world, or back into your hands if it's the one you were carrying (run.carry). */
  function addBlock(b) {
    state.pushBlocks.push(b);
    if (state.run.carry === b.key) hold(b);
    else indexBlock(b, true);
  }

  /** A block in your hands: out of the world (nothing collides with it), its mesh over your head. */
  function hold(b) {
    b.carried = true;
    b.slide = null;
    state.carry = b;
    state.run.carry = b.key;
    W.refreshHotbar(); // the figure shows it (updateHeld)
  }

  /** E at a push block or crate right in front of you: lift it. Off its mark, it takes its entropy back. */
  function liftBlock(b) {
    if (b.done) unsettle(b);
    indexBlock(b, false);
    state.run.pushed[b.key] = { sx: b.sx, sy: b.sy, done: false, paid: +b.paid.toFixed(4) };
    hold(b);
    W.showCaption(b.crate ? 'you lift the crate' : 'you lift the block');
    savePlayer();
  }

  /** Where E would set the carried block down: a free half-cell of floor ahead, in its own room. */
  function blockSpot(p) {
    const b = state.carry;
    return b ? W.quarterAhead(p, (sx, sy, base) => base === 0 && canMoveTo(b, sx, sy)) : null;
  }

  /** E with a block in your hands: set it down at `spot`. On its mark, it settles and pays. */
  function setDownBlock(spot) {
    const b = state.carry;
    if (!b) return;
    b.carried = false;
    state.carry = null;
    state.run.carry = null;
    place(b, spot.sx, spot.sy);
    b.mesh.scale.setScalar(1);
    b.mesh.position.set((b.x0 + 0.25) * S, 0, (b.y0 + 0.25) * S);
    b.group.add(b.mesh);
    indexBlock(b, true);
    if (!b.crate && spot.sx === b.to.sx && spot.sy === b.to.sy) settle(b, true);
    state.run.pushed[b.key] = b.crate ? { sx: b.sx, sy: b.sy } : { sx: b.sx, sy: b.sy, done: b.done, paid: +b.paid.toFixed(4) };
    W.refreshHotbar();
    savePlayer();
  }

  /** Can a push block move onto half-cell (sx, sy)? Same room, bare floor, clear of doorways and the figure. */
  function canMoveTo(b, sx, sy) {
    if (state.exp.registry[cellOf(sx, sy)] !== b.spaceId || inDoorMouth(sx, sy)) return false;
    const r = sub(sx, sy);
    for (const o of state.blockAt.get(cellOf(sx, sy)) || []) {
      if (o !== b && o.x0 < r.x1 && o.x1 > r.x0 && o.y0 < r.y1 && o.y1 > r.y0) return false;
    }
    const p = state.player;
    const ex = Math.max(r.x0 - p.x, 0, p.x - r.x1), ey = Math.max(r.y0 - p.y, 0, p.y - r.y1);
    return Math.hypot(ex, ey) >= RADIUS;
  }

  function move(b, dir) {
    const sx = b.sx + dir.x, sy = b.sy + dir.y;
    if (!canMoveTo(b, sx, sy)) return false;
    const from = b.mesh.position.clone();
    indexBlock(b, false);
    place(b, sx, sy);
    indexBlock(b, true);
    b.slide = { from, t: 0 };
    if (b.crate) {
      state.run.pushed[b.key] = { sx, sy };
      savePlayer();
      return true;
    }
    if (sx === b.to.sx && sy === b.to.sy) settle(b, true);
    else if (b.done) unsettle(b);
    state.run.pushed[b.key] = { sx, sy, done: b.done, paid: +b.paid.toFixed(4) };
    savePlayer();
    return true;
  }

  /** Walking into a push block for a beat shoves it one half-cell (even off its mark). */
  function pushBlock(b, dir) {
    if (!move(b, dir)) W.showCaption('it won\'t budge that way');
  }

  /** Home: its mark lights up, and the room pays entropy (whatever it hasn't paid already). */
  function settle(b, now) {
    b.done = true;
    b.bodyMat.emissive.copy(b.color).multiplyScalar(0.55);
    b.markMat.opacity = 1;
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
    b.markMat.opacity = 0.75;
    b.paid -= W.takeFuel(b.paid);
    W.showCaption('the block slides off its mark · the room takes its entropy back');
    W.refreshHud();
  }

  /** E at a push block or crate right in front of you, standing on the floor: lift it. */
  function liftNear(p) {
    if (p.z > 0.05 || state.carry) return null;
    const fx = Math.sin(p.angle), fy = Math.cos(p.angle);
    let best = null, bestD = RADIUS + 0.15;
    for (const b of state.pushBlocks) {
      if (b.carried) continue;
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

  /** Slides, and growing and shrinking with the floor as the room assembles. */
  function updatePushBlocks(dt) {
    for (const b of state.pushBlocks) {
      if (b.carried) continue; // over your head (items.js updateHeld)
      const tx = (b.x0 + 0.25) * S, tz = (b.y0 + 0.25) * S;
      if (b.slide) {
        b.slide.t = Math.min(1, b.slide.t + dt / SLIDE_TIME);
        const k = easeOut(b.slide.t);
        b.mesh.position.set(b.slide.from.x + (tx - b.slide.from.x) * k, 0, b.slide.from.z + (tz - b.slide.from.z) * k);
        if (b.slide.t >= 1) b.slide = null;
      }
      b.mesh.scale.setScalar(Math.max(0.001, b.tile ? b.tile.scale.x : 1));
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

  Object.assign(W, { SCONCE_Y, addPushBlocks, pushBlock, liftNear, liftBlock, blockSpot, setDownBlock, updatePushBlocks, addSconces,
    sconceNear, lightSconce, snuffSconce, updateSconces });
})(window);
