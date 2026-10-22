// Walk mode: where you're going and how you get back (GAME-DESIGN.md,
// sections 8 and 9). Waypoints (reserved hall footprints, a "?" on the map)
// and waystones in halls: wake one to reveal new waypoints, and travel
// between awake ones on the map. The lamp is in lamp.js.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, DP, RULES, THREE, S, UNIT, state, save, savePlayer, chargeText } = W;

  // ---------------------------------------------------------------------------
  // Waypoints

  /** Reveal waypoints from a point (count: see DP.waypointSet). Returns how many. */
  function revealWaypoints(from, count) {
    const set = DP.waypointSet(state.exp, from, count);
    for (const r of set) DE.reserve(state.exp, r);
    return set.length;
  }

  /** An expedition with no waypoints yet gets its starting set, from the root. */
  function ensureWaypoints() {
    const exp = state.exp;
    if (Object.values(exp.reserves || {}).some((r) => r.kind === 'hall')) return;
    revealWaypoints(DP.centerOf(exp.spaces.s0));
    save();
  }

  /** You just opened a door into a hall: a waypoint's, or a rare unmarked one. */
  function arrive(space) {
    // Shown as you step in (instead of the room's log line), so it isn't missed.
    const what = space.reserveId ? 'a waypoint' : 'an unmarked hall';
    state.arrival = { spaceId: space.id, text: `${what} · a dormant waystone stands here` };
  }

  /** Waypoints still waiting: [{ id, pin: { x, y }, tier }]. */
  function waitingPins() {
    return Object.values(state.exp.reserves || {}).filter((r) => !r.spaceId && r.pin);
  }

  // ---------------------------------------------------------------------------
  // Waystones: a small monolith with arcane markings, half a cell wide and
  // 2.5 block units tall. Awake, the markings glow.

  const STONE_H = 2.5 * UNIT;
  const stoneGeo = new THREE.BoxGeometry(1, 1, 1); // scaled to the slab
  const stoneSide = new THREE.MeshLambertMaterial({ color: 0x45424b });
  const glyphTex = {};
  /** Seeded markings: [map (stone with pale cuts), emissive (just the cuts)]. */
  function glyphTextures(seed) {
    if (glyphTex[seed]) return glyphTex[seed];
    const w = 48, h = 128;
    const out = ['#47434d', '#000'].map((bg, i) => {
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const g = cv.getContext('2d');
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = i ? '#fff' : '#b9b0cc';
      g.lineWidth = 2.2;
      g.lineCap = 'round';
      const r = DE.createRng(DE.hash('glyphs', seed));
      for (let row = 0; row < 5; row++) {
        const cx = w / 2, cy = 14 + row * 25, s = 8;
        g.beginPath();
        const kind = r.int(0, 4);
        if (kind === 0) g.arc(cx, cy, s, 0, Math.PI * 2);
        else if (kind === 1) { g.moveTo(cx, cy - s); g.lineTo(cx + s, cy + s); g.lineTo(cx - s, cy + s); g.closePath(); }
        else if (kind === 2) { g.moveTo(cx - s, cy - s); g.lineTo(cx + s, cy + s); g.moveTo(cx + s, cy - s); g.lineTo(cx - s, cy + s); }
        else if (kind === 3) { g.arc(cx, cy, s, Math.PI * 0.2, Math.PI * 1.4); g.moveTo(cx, cy - s); g.lineTo(cx, cy + s); }
        else { g.moveTo(cx - s, cy); g.lineTo(cx, cy - s); g.lineTo(cx + s, cy); g.lineTo(cx, cy + s); g.closePath(); }
        if (r.chance(0.5)) { g.moveTo(cx - s - 3, cy + s + 4); g.lineTo(cx + s + 3, cy + s + 4); }
        g.stroke();
      }
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    });
    return (glyphTex[seed] = out);
  }

  const DORMANT = new THREE.Color(0x000000), AWAKE = new THREE.Color(0xa58cff);

  /** A hall's waystone, standing on its cell's tile (so it rises with the room). */
  function addWaystone(space, rec, tileAt) {
    const ws = DP.waystone(space);
    if (!ws) return;
    const key = space.id + ':' + space.seed;
    const [map, emap] = glyphTextures(space.seed);
    const face = new THREE.MeshLambertMaterial({ map, emissiveMap: emap, emissive: DORMANT.clone() });
    // Box faces: +x, -x, +y, -y, +z (south, toward the camera), -z.
    const mesh = new THREE.Mesh(stoneGeo, [stoneSide, stoneSide, stoneSide, stoneSide, face, face]);
    mesh.castShadow = mesh.receiveShadow = true;
    const tile = tileAt[DE.key(ws.cell.x, ws.cell.y)];
    mesh.scale.set((ws.x1 - ws.x0) * S, STONE_H * S, (ws.y1 - ws.y0) * S);
    mesh.position.set(((ws.x0 + ws.x1) / 2) * S - tile.position.x, STONE_H * S / 2 + 0.05, ((ws.y0 + ws.y1) / 2) * S - tile.position.z);
    tile.add(mesh);
    const stone = {
      key, spaceId: space.id, ws, face, phase: ws.cell.x * 0.7 + ws.cell.y,
      awake: !space.parentId || !!state.run.waystones[key], // the starter's is always awake
    };
    // Solid, and too tall to climb.
    const blk = { x0: ws.x0, y0: ws.y0, x1: ws.x1, y1: ws.y1, units: 2.5, top: STONE_H, spaceId: space.id, stone: true };
    const k = DE.key(ws.cell.x, ws.cell.y);
    state.blockAt.set(k, (state.blockAt.get(k) || []).concat(blk));
    state.waystones = state.waystones.filter((o) => o.key !== key).concat(stone);
  }

  const STONE_REACH = 0.75;
  /** E at a waystone in your room, within reach and roughly ahead. */
  function waystoneNear(p) {
    if (p.z > 0.05) return null;
    const here = state.exp.registry[DE.key(Math.floor(p.x), Math.floor(p.y))];
    const fx = Math.sin(p.angle), fy = Math.cos(p.angle);
    for (const st of state.waystones) {
      if (st.spaceId !== here) continue;
      const cx = (st.ws.x0 + st.ws.x1) / 2, cy = (st.ws.y0 + st.ws.y1) / 2;
      const dx = cx - p.x, dy = cy - p.y, d = Math.hypot(dx, dy);
      if (d >= STONE_REACH || (dx * fx + dy * fy) / (d || 1) < 0.2) continue;
      return { action: st.awake ? 'travel' : 'wake', stone: st };
    }
    return null;
  }

  /** Wake a waystone: it joins the network, becomes your hearth, and may reveal waypoints. */
  function wakeWaystone(st) {
    const run = state.run, cost = RULES.waystoneCharges;
    if (!W.spendFuel(cost)) { W.showCaption(`not enough entropy to wake it: ${chargeText(cost)}`); return; }
    run.chargesSpent += cost;
    st.awake = true;
    run.waystones[st.key] = true;
    run.hearth = st.key;
    const sp = state.exp.spaces[st.spaceId];
    const n = revealWaypoints(DP.centerOf(sp), DP.waypointCount(state.exp, sp));
    save();
    W.showCaption(`the waystone wakes · −${chargeText(cost)} · ` +
      (n ? `${n} new waypoint${n === 1 ? '' : 's'} on your map` : 'nothing new stirs'));
    savePlayer();
    W.refreshHud();
  }

  /** E at an awake waystone: the map opens on the others; pick one to go there. */
  function travelFrom(st) {
    state.run.hearth = st.key;
    savePlayer();
    if (!state.waystones.some((o) => o.awake && o !== st)) {
      W.showCaption('the waystone hums · no other waystone is awake yet');
      return;
    }
    W.openBigMap({ travelFrom: st });
  }

  /** Stand at a waystone's wake spot and look at it. */
  function placeAt(st) {
    const p = state.player, w = st.ws.wake;
    Object.assign(p, { x: w.x, y: w.y, z: 0, vz: 0, angle: w.angle });
    state.climb = null;
    W.snapCamera();
  }

  function travelTo(st) {
    placeAt(st);
    state.run.hearth = st.key;
    state.run.travels = (state.run.travels || 0) + 1;
    W.showCaption(`you step out by the waystone in ${st.spaceId}`);
    savePlayer();
  }

  /** Where you wake: your last waystone, if it's still there, else the start. */
  function hearth() {
    return state.waystones.find((o) => o.key === state.run.hearth && o.awake) ||
      state.waystones.find((o) => o.spaceId === 's0') || null;
  }

  /** Awake markings pulse slowly. */
  function updateWaystones() {
    const t = state.time;
    for (const st of state.waystones) {
      if (st.awake) st.face.emissive.copy(AWAKE).multiplyScalar(0.75 + 0.25 * Math.sin(t * 1.6 + st.phase));
      else st.face.emissive.copy(DORMANT);
    }
  }

  Object.assign(W, { revealWaypoints, ensureWaypoints, arrive, waitingPins, addWaystone, waystoneNear,
    wakeWaystone, travelFrom, travelTo, placeAt, hearth, updateWaystones });
})(window);
