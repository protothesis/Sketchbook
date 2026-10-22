// Walk mode: restoration (GAME-DESIGN.md). Setting the dungeon right pays
// entropy, once. For now: push blocks, each with a matching floor mark where
// it belongs.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, DP, RULES, THREE, S, RADIUS, UNIT, state, savePlayer, easeOut, maxCharges,
    inDoorMouth } = W;

  const SLIDE_TIME = 0.22; // seconds for a push to slide one half-cell

  const pushGeo = {
    block: new THREE.BoxGeometry(0.5 * S * 0.98, UNIT * S, 0.5 * S * 0.98),
    inset: new THREE.PlaneGeometry(0.5 * S * 0.6, 0.5 * S * 0.6),
    mark: new THREE.PlaneGeometry(0.5 * S * 0.94, 0.5 * S * 0.94),
  };
  const stoneMat = new THREE.MeshLambertMaterial({ color: 0x8c8474, emissive: 0x15120d });

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

      const mesh = new THREE.Group();
      const body = new THREE.Mesh(pushGeo.block, stoneMat);
      body.castShadow = body.receiveShadow = true;
      body.position.y = UNIT * S / 2;
      const insetMat = new THREE.MeshLambertMaterial({ color: col, emissive: col.clone().multiplyScalar(0.15) });
      const inset = new THREE.Mesh(pushGeo.inset, insetMat);
      inset.rotation.x = -Math.PI / 2;
      inset.position.y = UNIT * S + 0.004;
      mesh.add(body, inset);
      rec.group.add(mesh);

      const b = {
        key, spaceId: space.id, push: true, units: 1, top: UNIT, color: col,
        to: pb.to, done: !!(saved && saved.done), mesh, insetMat, markMat,
        tile: tileAt[cellOf(pb.from.sx, pb.from.sy)], slide: null,
      };
      const at = saved ? { sx: saved.sx, sy: saved.sy } : pb.from;
      place(b, at.sx, at.sy);
      mesh.position.set((b.x0 + 0.25) * S, 0, (b.y0 + 0.25) * S);
      if (b.done) settle(b, false);
      indexBlock(b, true);
      state.pushBlocks.push(b);
    }
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
    if (sx === b.to.sx && sy === b.to.sy) settle(b, true);
    state.run.pushed[b.key] = { sx, sy, done: b.done };
    savePlayer();
    return true;
  }

  /** Walking into a push block for a beat shoves it one half-cell. */
  function pushBlock(b, dir) {
    if (b.done) return;
    if (!move(b, dir)) W.showCaption('it won\'t budge that way');
  }

  /** Home: the block locks in place, its mark lights up, and the room pays entropy. */
  function settle(b, now) {
    b.done = true;
    b.insetMat.emissive.copy(b.color).multiplyScalar(0.9);
    b.markMat.opacity = 1;
    if (!now) return;
    const run = state.run, gain = Math.max(0, Math.min(RULES.restoreCharges, maxCharges() - run.charges));
    run.charges += gain;
    run.restored = (run.restored || 0) + 1;
    W.showCaption(gain ? `the block settles into place · +${gain} charge${gain === 1 ? '' : 's'} of entropy`
      : 'the block settles into place · your entropy is full');
    W.refreshHud();
  }

  /**
   * E at a push block right in front of you: pull it one half-cell toward
   * you, stepping back to make room. That's how a block pushed into a
   * corner comes back out.
   */
  function pullNear(p) {
    if (p.z > 0.05) return null;
    const fx = Math.sin(p.angle), fy = Math.cos(p.angle);
    let best = null, bestD = RADIUS + 0.15;
    for (const b of state.pushBlocks) {
      if (b.done) continue;
      const qx = THREE.MathUtils.clamp(p.x, b.x0, b.x1), qy = THREE.MathUtils.clamp(p.y, b.y0, b.y1);
      const d = Math.hypot(qx - p.x, qy - p.y);
      if (d >= bestD) continue;
      const cx = (b.x0 + b.x1) / 2 - p.x, cy = (b.y0 + b.y1) / 2 - p.y;
      if ((cx * fx + cy * fy) / (Math.hypot(cx, cy) || 1) < 0.5) continue; // roughly facing it
      const dir = Math.abs(cx) > Math.abs(cy) ? { x: -Math.sign(cx), y: 0 } : { x: 0, y: -Math.sign(cy) };
      bestD = d;
      best = { action: 'pull', block: b, dir };
    }
    return best;
  }

  function pull(near) {
    const p = state.player, b = near.block, d = near.dir;
    const back = { x: p.x + d.x * 0.5, y: p.y + d.y * 0.5 };
    // Room to step back: still this room's floor, and no block where you'd stand.
    const bsx = Math.floor(back.x * 2), bsy = Math.floor(back.y * 2);
    const free = state.exp.registry[cellOf(bsx, bsy)] === b.spaceId &&
      !(state.blockAt.get(cellOf(bsx, bsy)) || []).some((o) => o.top > p.z + 0.05 &&
        back.x > o.x0 - RADIUS && back.x < o.x1 + RADIUS && back.y > o.y0 - RADIUS && back.y < o.y1 + RADIUS);
    if (!free) { W.showCaption('no room behind you to pull it'); return; }
    p.x = back.x; p.y = back.y; // step back first, so the block has somewhere to go
    if (!move(b, d)) { p.x -= d.x * 0.5; p.y -= d.y * 0.5; W.showCaption('it won\'t budge that way'); }
  }

  /** Slides, and growing and shrinking with the floor as the room assembles. */
  function updatePushBlocks(dt) {
    for (const b of state.pushBlocks) {
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

  Object.assign(W, { addPushBlocks, pushBlock, pullNear, pull, updatePushBlocks });
})(window);
