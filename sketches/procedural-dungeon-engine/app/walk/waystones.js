// Walk mode: where you're going and how you get back (GAME-DESIGN.md,
// sections 8 and 9). Waypoints (reserved hall footprints, a "?" on the map)
// and waystones in halls: wake one to reveal new waypoints, and travel
// between awake ones on the map, along ley lines, for entropy. The lamp is
// in lamp.js.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, DP, RULES, THREE, S, UNIT, scene, state, save, chargeText } = W;

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

  // An awake waystone is hard to miss: its glyphs shine (an additive copy
  // laid over each face, so they ignore light and shadow), a faint shaft of
  // light rises from it (a quieter cousin of a sigil's beam), and the
  // nearest awake ones get a real violet-blue light (a fixed pool, like the
  // sconces', so waking more never recompiles materials).
  const GLOW = {
    color: 0x8f86ff,
    lights: 2,           // pooled
    intensity: 5,
    range: 3.6,          // cells
    shaftRadius: 0.32,   // cells
    shaftHeight: 3.2,    // cells
    shaftOpacity: 0.16,
  };
  const glowLights = Array.from({ length: GLOW.lights }, () => {
    const l = new THREE.PointLight(GLOW.color, 0, GLOW.range * S, 1.6);
    scene.add(l);
    return l;
  });
  const shaftTex = (() => {
    const cv = document.createElement('canvas');
    cv.width = 4; cv.height = 64;
    const g = cv.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.75, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = grad; g.fillRect(0, 0, 4, 64);
    return new THREE.CanvasTexture(cv);
  })();
  const shaftGeo = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true);
  const glyphPlane = new THREE.PlaneGeometry(1, 1);

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
    // The shining glyphs: the cut marks again, additive, just off each face.
    const shine = new THREE.MeshBasicMaterial({
      map: emap, color: 0xc8bcff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    for (const side of [1, -1]) {
      const g = new THREE.Mesh(glyphPlane, shine);
      g.position.z = side * 0.502;
      if (side < 0) g.rotation.y = Math.PI;
      mesh.add(g); // scaled with the slab, so it covers the face exactly
    }
    const shaft = new THREE.Mesh(shaftGeo, new THREE.MeshBasicMaterial({
      map: shaftTex, color: GLOW.color, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    shaft.scale.set(GLOW.shaftRadius * S, GLOW.shaftHeight * S, GLOW.shaftRadius * S);
    shaft.position.set(mesh.position.x, GLOW.shaftHeight * S / 2, mesh.position.z);
    tile.add(shaft);
    const stone = {
      key, spaceId: space.id, ws, face, shine, shaft, phase: ws.cell.x * 0.7 + ws.cell.y,
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
    linkStone(st);
    run.hearth = st.key;
    const sp = state.exp.spaces[st.spaceId];
    const n = revealWaypoints(DP.centerOf(sp), DP.waypointCount(state.exp, sp));
    save();
    W.showCaption(`the waystone wakes · −${chargeText(cost)} · ` +
      (n ? `${n} new waypoint${n === 1 ? '' : 's'} on your map` : 'nothing new stirs') + ' · checkpoint');
    W.saveCheckpoint();
    W.refreshHud();
  }

  // ---------------------------------------------------------------------------
  // Ley lines: the travel network. Links are made when you wake a stone:
  // it joins its RULES.leyNeighbours nearest awake stones, and the links
  // stay (run.ley), so the network grows in the order you woke them. Every
  // new stone links to one already in the network, so it's always in one
  // piece. Travel rides the lines: the trip goes by the fewest lines (the
  // shorter way on a tie), and each line costs RULES.travelShardsPerHop
  // shards. (Later: re-tuning links on purpose.)

  const centre = (st) => ({ x: (st.ws.x0 + st.ws.x1) / 2, y: (st.ws.y0 + st.ws.y1) / 2 });
  let leyCache = { sig: '', edges: [] };

  /** Link a newly woken stone to its nearest awake stones, for good. */
  function linkStone(st) {
    const run = state.run;
    leyLines(); // a save from before stored links builds them first
    const c = centre(st);
    const others = state.waystones.filter((o) => o.awake && o !== st)
      .sort((a, b) => Math.hypot(centre(a).x - c.x, centre(a).y - c.y) - Math.hypot(centre(b).x - c.x, centre(b).y - c.y));
    for (const o of others.slice(0, RULES.leyNeighbours)) {
      if (!run.ley.some(([a, b]) => (a === st.key && b === o.key) || (a === o.key && b === st.key))) run.ley.push([o.key, st.key]);
    }
  }

  /** The network's lines: [[a, b]] (waystone records), from run.ley. */
  function leyLines() {
    const run = state.run;
    if (!run.ley) run.ley = tidyNetwork().map(([a, b]) => [a.key, b.key]);
    const sig = run.rootSeed + '|' + run.ley.length + '|' + state.waystones.length;
    if (sig === leyCache.sig) return leyCache.edges;
    const byKey = new Map(state.waystones.map((o) => [o.key, o]));
    const edges = run.ley.map(([a, b]) => [byKey.get(a), byKey.get(b)]).filter(([a, b]) => a && b && a.awake && b.awake);
    leyCache = { sig, edges };
    return edges;
  }

  /**
   * For a save from before stored links: the tidiest network over the stones
   * already awake (each joins its nearest, plus a minimum spanning tree).
   */
  function tidyNetwork() {
    const awake = state.waystones.filter((o) => o.awake).sort((a, b) => (a.key < b.key ? -1 : 1));
    const n = awake.length, pts = awake.map(centre);
    const dist = (i, j) => Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
    const seen = new Set(), edges = [];
    const add = (i, j) => {
      const k = Math.min(i, j) + ',' + Math.max(i, j);
      if (i === j || seen.has(k)) return;
      seen.add(k);
      edges.push([awake[i], awake[j]]);
    };
    for (let i = 0; i < n; i++) {
      const near = [...Array(n).keys()].filter((j) => j !== i).sort((a, b) => dist(i, a) - dist(i, b));
      near.slice(0, RULES.leyNeighbours).forEach((j) => add(i, j));
    }
    // Prim's: join the pieces, cheapest line first.
    const inTree = new Set(n ? [0] : []);
    while (inTree.size < n) {
      let best = null;
      for (const i of inTree) for (let j = 0; j < n; j++) {
        if (inTree.has(j)) continue;
        if (!best || dist(i, j) < best.d) best = { i, j, d: dist(i, j) };
      }
      add(best.i, best.j);
      inTree.add(best.j);
    }
    return edges;
  }

  /** The way from one waystone to another along the lines: { path: [stones], hops, shards }, or null. */
  function leyRoute(from, to) {
    const edges = leyLines();
    const nbr = new Map();
    for (const [a, b] of edges) {
      nbr.set(a, (nbr.get(a) || []).concat(b));
      nbr.set(b, (nbr.get(b) || []).concat(a));
    }
    // Fewest hops, then shortest: Dijkstra on (hops, distance).
    const best = new Map([[from, { hops: 0, d: 0, prev: null }]]);
    const open = [from];
    while (open.length) {
      open.sort((u, v) => best.get(u).hops - best.get(v).hops || best.get(u).d - best.get(v).d);
      const u = open.shift(), bu = best.get(u);
      if (u === to) break;
      for (const v of nbr.get(u) || []) {
        const cu = centre(u), cv = centre(v);
        const cand = { hops: bu.hops + 1, d: bu.d + Math.hypot(cu.x - cv.x, cu.y - cv.y), prev: u };
        const bv = best.get(v);
        if (!bv || cand.hops < bv.hops || (cand.hops === bv.hops && cand.d < bv.d)) {
          best.set(v, cand);
          if (!open.includes(v)) open.push(v);
        }
      }
    }
    if (!best.has(to)) return null;
    const path = [];
    for (let c = to; c; c = best.get(c).prev) path.unshift(c);
    const hops = path.length - 1;
    return { path, hops, shards: hops * RULES.travelShardsPerHop };
  }

  /** E at an awake waystone: the map opens on the others; pick one to go there. */
  function travelFrom(st) {
    state.run.hearth = st.key;
    W.saveCheckpoint(); // using a waystone is a checkpoint, even if you stay
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

  /** Ride the ley lines to another awake waystone, paying for every line. */
  function travelTo(st, from) {
    const route = from && leyRoute(from, st);
    const cost = route ? route.shards / RULES.shardsPerCharge : 0;
    if (route && !W.spendFuel(cost)) {
      W.showCaption(`not enough entropy to ride ${route.hops} line${route.hops === 1 ? '' : 's'}: ${route.shards} shard${route.shards === 1 ? '' : 's'}`);
      return false;
    }
    placeAt(st);
    state.run.hearth = st.key;
    state.run.travels = (state.run.travels || 0) + 1;
    state.run.chargesSpent += cost;
    W.showCaption(`you step out by the waystone in ${st.spaceId}` +
      (route ? ` · ${route.hops} line${route.hops === 1 ? '' : 's'} · −${route.shards} shard${route.shards === 1 ? '' : 's'}` : '') + ' · checkpoint');
    W.saveCheckpoint();
    W.refreshHud();
    return true;
  }

  /** Where you wake: your last waystone, if it's still there, else the start. */
  function hearth() {
    return state.waystones.find((o) => o.key === state.run.hearth && o.awake) ||
      state.waystones.find((o) => o.spaceId === 's0') || null;
  }

  /** Awake markings pulse slowly and shine; the nearest awake stones get the lights. */
  function updateWaystones() {
    const t = state.time, p = state.player;
    for (const st of state.waystones) {
      const pulse = 0.75 + 0.25 * Math.sin(t * 1.6 + st.phase);
      if (st.awake) st.face.emissive.copy(AWAKE).multiplyScalar(pulse);
      else st.face.emissive.copy(DORMANT);
      st.shine.opacity = st.awake ? 0.9 * pulse : 0;
      st.shaft.material.opacity = st.awake ? GLOW.shaftOpacity * (0.8 + 0.2 * Math.sin(t * 1.1 + st.phase)) : 0;
      st.shaft.visible = st.awake;
    }
    const lit = state.waystones.filter((o) => o.awake)
      .map((o) => ({ o, d: Math.hypot(centre(o).x - p.x, centre(o).y - p.y) }))
      .sort((a, b) => a.d - b.d);
    glowLights.forEach((l, i) => {
      const it = lit[i];
      if (!it) { l.intensity = 0; return; }
      const c = centre(it.o);
      l.position.set(c.x * S, 1.1 * S, c.y * S);
      l.intensity = GLOW.intensity * (0.85 + 0.15 * Math.sin(t * 1.6 + it.o.phase));
    });
  }

  Object.assign(W, { GLOW, revealWaypoints, ensureWaypoints, arrive, waitingPins, addWaystone, waystoneNear,
    wakeWaystone, travelFrom, travelTo, placeAt, hearth, updateWaystones, leyLines, leyRoute });
})(window);
