// Walk mode: where you're going and how you get around (GAME-DESIGN.md,
// sections 8, 9 and 19). Waypoints (reserved hall footprints, a "?" on the
// map), and waystones: 1x1 blocks of dark glass with a sigil on their faces.
// They're loose objects like crates (restore.js: hold E to grab, lift, drag,
// one at a time, heavy as stone). Powered (F with a full jar, or with your
// lamp in hand for a charge, once), the sigil glows and the stone joins the
// network: each powered stone links to its nearest, rebuilt from where they
// stand whenever one moves, so moving stones rewires it. A tap of E at a
// powered stone opens the travel map. Saving, and where you wake, are the
// save lanterns' (lanterns.js); the lamp is in lamp.js.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, DP, RULES, THREE, S, UNIT, RADIUS, scene, state, save, chargeText } = W;

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
    state.arrival = { spaceId: space.id, text: `${what} · a save lantern burns low here` };
  }

  /** Waypoints still waiting: [{ id, pin: { x, y }, tier }]. */
  function waitingPins() {
    return Object.values(state.exp.reserves || {}).filter((r) => !r.spaceId && r.pin);
  }

  // ---------------------------------------------------------------------------
  // The stone: dark glass, a seeded sigil on each side, glowing when powered

  const stoneGeo = new THREE.BoxGeometry(0.5 * S * 0.96, UNIT * S, 0.5 * S * 0.96);
  const stoneMat = new THREE.MeshPhongMaterial({ color: 0x17141f, specular: 0x8f86b8, shininess: 90, emissive: 0x050408 });
  const sigilPlane = new THREE.PlaneGeometry(0.5 * S * 0.8, UNIT * S * 0.8);
  const sigilTex = {};
  /** A seeded star in a ring ({n/k}), white on clear. */
  function sigilTexture(key) {
    if (sigilTex[key]) return sigilTex[key];
    const n = 96, cv = document.createElement('canvas');
    cv.width = cv.height = n;
    const g = cv.getContext('2d');
    const r = DE.createRng(DE.hash('stone-sigil', key));
    const pts = r.pick([5, 6, 7, 8]), skip = pts === 6 ? 2 : r.pick([2, 3].filter((k) => k < pts / 2));
    const rot = r.next() * Math.PI * 2, R = n * 0.36, c = n / 2;
    g.strokeStyle = '#fff';
    g.lineWidth = 3;
    g.lineJoin = g.lineCap = 'round';
    g.beginPath(); g.arc(c, c, n * 0.44, 0, Math.PI * 2); g.stroke();
    g.beginPath();
    for (let i = 0; i <= pts; i++) {
      const a = rot + (i * skip % pts) / pts * Math.PI * 2;
      const x = c + Math.cos(a) * R, y = c + Math.sin(a) * R;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
    if (pts === 6) { // a hexagram is two triangles
      g.beginPath();
      for (let i = 0; i <= 3; i++) {
        const a = rot + (i * 2 + 1) / 6 * Math.PI * 2;
        const x = c + Math.cos(a) * R, y = c + Math.sin(a) * R;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.stroke();
    }
    g.beginPath(); g.arc(c, c, n * 0.06, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
    const t = new THREE.CanvasTexture(cv);
    return (sigilTex[key] = t);
  }

  const DORMANT_SIGIL = new THREE.Color(0x4a4458);
  const SIGIL = { entropy: new THREE.Color(0xa58cff), pixie: new THREE.Color(0xd8ccff) };

  /** A waystone's mesh: the glass block, and its sigil on all four sides (restore.js makeObject). */
  function makeStoneMesh(key) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(stoneGeo, stoneMat);
    body.position.y = UNIT * S / 2;
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    // Additive, so a dormant sigil reads as a faint etching and a powered one glows regardless of light.
    const mat = new THREE.MeshBasicMaterial({
      map: sigilTexture(key), color: DORMANT_SIGIL.clone(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const half = 0.5 * S * 0.96 / 2 + 0.003;
    for (const [x, z, ry] of [[0, half, 0], [0, -half, Math.PI], [half, 0, Math.PI / 2], [-half, 0, -Math.PI / 2]]) {
      const m = new THREE.Mesh(sigilPlane, mat);
      m.position.set(x, UNIT * S / 2, z);
      m.rotation.y = ry;
      g.add(m);
    }
    g.userData.sigil = mat;
    return g;
  }

  // ---------------------------------------------------------------------------
  // The stones in the world: state.waystones, rebuilt each frame from the
  // loose objects. A record: { key, b (the object), spaceId, awake (powered
  // and standing in the world), ws: { x0, y0, x1, y1, wake } }.

  /** Where you stand when you arrive at a stone: beside it, on free floor (south first, facing it). */
  function wakeSpot(b) {
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
      const x = cx + dx * 0.55, y = cy + dy * 0.55;
      if (freeFloor(x, y)) return { x, y, angle: Math.atan2(-dx, -dy) };
    }
    return { x: cx, y: cy + 0.55, angle: Math.PI };
  }
  function freeFloor(x, y) {
    if (state.exp.registry[DE.key(Math.floor(x), Math.floor(y))] === undefined) return false;
    for (const o of state.blockAt.get(DE.key(Math.floor(x), Math.floor(y))) || []) {
      if (o.top > 0.05 && x > o.x0 - RADIUS && x < o.x1 + RADIUS && y > o.y0 - RADIUS && y < o.y1 + RADIUS) return false;
    }
    return true;
  }

  function refreshStones() {
    const prev = new Map(state.waystones.map((r) => [r.key, r]));
    state.waystones = state.pushBlocks.filter((b) => b.waystone).map((b) => {
      const r = prev.get(b.key) || { key: b.key, phase: (b.sx * 0.7 + b.sy) % 6.28 };
      r.b = b;
      r.spaceId = b.spaceId;
      r.awake = !!b.holds && !b.carried && !b.anim && !!b.spaceId;
      if (!r.ws || r.ws.x0 !== b.x0 || r.ws.y0 !== b.y0) {
        r.ws = { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, get wake() { return wakeSpot(b); } };
      }
      return r;
    });
  }

  /** A record for a built stone object. */
  const stoneOf = (b) => state.waystones.find((r) => r.b === b) || null;

  // The two powered stones nearest you get a real violet light (a fixed
  // pool, like the sconces', so powering more never recompiles materials).
  const GLOW = {
    color: 0x8f86ff,
    lights: 2,           // pooled
    intensity: 3.5,
    range: 3,            // cells
    height: 0.7,         // cells above the floor
  };
  const glowLights = Array.from({ length: GLOW.lights }, () => {
    const l = new THREE.PointLight(GLOW.color, 0, GLOW.range * S, 1.6);
    scene.add(l);
    return l;
  });

  /** Each frame: the stones, their sigils pulsing while powered, and the nearest powered ones lit. */
  function updateWaystones() {
    refreshStones();
    const t = state.time, p = state.player;
    for (const st of state.waystones) {
      const mat = st.b.mesh.userData.sigil;
      if (!mat) continue;
      const pulse = 0.75 + 0.25 * Math.sin(t * 1.6 + st.phase);
      if (st.b.holds) mat.color.copy(SIGIL[st.b.holds] || SIGIL.entropy).multiplyScalar(st.awake ? pulse : 0.55);
      else mat.color.copy(DORMANT_SIGIL);
    }
    const lit = state.waystones.filter((o) => o.awake)
      .map((o) => ({ o, d: Math.hypot(centre(o).x - p.x, centre(o).y - p.y) }))
      .sort((a, b) => a.d - b.d);
    glowLights.forEach((l, i) => {
      const it = lit[i];
      if (!it) { l.intensity = 0; return; }
      const c = centre(it.o);
      l.color.setHex(GLOW.color);
      l.distance = GLOW.range * S;
      l.position.set(c.x * S, ((it.o.b.base || 0) + GLOW.height) * S, c.y * S);
      l.intensity = GLOW.intensity * (0.85 + 0.15 * Math.sin(t * 1.6 + it.o.phase));
    });
  }

  // ---------------------------------------------------------------------------
  // Powering: once, like lighting a sconce

  /** F at an unpowered stone: pour a jar into it (its entropy or its pixie), or give it a charge from your lamp (`jar` null). */
  function powerStone(b, jar) {
    const run = state.run;
    if (jar) {
      b.holds = jar.holds;
      jar.holds = null;
    } else {
      const cost = RULES.waystoneCharges;
      if (!W.spendFuel(cost)) { W.showCaption(`not enough entropy to wake it: ${chargeText(cost)}`); return; }
      run.chargesSpent += cost;
      b.holds = 'entropy';
    }
    W.saveObject(b);
    refreshStones();
    const n = state.waystones.filter((o) => o.awake).length;
    W.showCaption((b.holds === 'pixie' ? 'the pixie lights the sigil' : 'the sigil wakes') +
      (jar ? '' : ` · −${chargeText(RULES.waystoneCharges)}`) +
      (n > 1 ? ' · it joins your ley lines' : ' · no other waystone is awake yet'));
    W.savePlayer();
    W.refreshHud();
  }

  // ---------------------------------------------------------------------------
  // Ley lines: the travel network. Every powered stone standing in the world
  // links to its RULES.leyNeighbours nearest, plus whatever joins the pieces
  // into one network (a minimum spanning tree), worked out from where they
  // stand. Travel rides the lines: the fewest lines first (the shorter way on
  // a tie), RULES.travelShardsPerHop shards a line.

  const centre = (st) => ({ x: (st.ws.x0 + st.ws.x1) / 2, y: (st.ws.y0 + st.ws.y1) / 2 });
  let leyCache = { sig: '', edges: [] };

  /** The network's lines: [[a, b]] (stone records). */
  function leyLines() {
    const awake = state.waystones.filter((o) => o.awake).sort((a, b) => (a.key < b.key ? -1 : 1));
    const sig = awake.map((o) => o.key + '@' + o.ws.x0.toFixed(2) + ',' + o.ws.y0.toFixed(2)).join('|');
    if (sig === leyCache.sig) return leyCache.edges;
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
    leyCache = { sig, edges };
    return edges;
  }

  /** The way from one stone to another along the lines: { path: [stones], hops, shards }, or null. */
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

  /** A tap of E at a powered stone: the map opens on the others; pick one to go there. */
  function travelFrom(st) {
    if (!st || !st.awake) return;
    if (!state.waystones.some((o) => o.awake && o !== st)) {
      W.showCaption('the waystone hums · no other waystone is awake yet');
      return;
    }
    W.openBigMap({ travelFrom: st });
  }

  /** Stand at a spot ({ ws: { wake } }: a stone's or a lantern's) and look at what's there. */
  function placeAt(st) {
    const p = state.player, w = st.ws.wake;
    Object.assign(p, { x: w.x, y: w.y, z: 0, vz: 0, angle: w.angle });
    W.snapCamera();
  }

  /** Ride the ley lines to another powered stone, paying for every line. */
  function travelTo(st, from) {
    const route = from && leyRoute(from, st);
    const cost = route ? route.shards / RULES.shardsPerCharge : 0;
    if (route && !W.spendFuel(cost)) {
      W.showCaption(`not enough entropy to ride ${route.hops} line${route.hops === 1 ? '' : 's'}: ${route.shards} shard${route.shards === 1 ? '' : 's'}`);
      return false;
    }
    placeAt(st);
    state.run.travels = (state.run.travels || 0) + 1;
    state.run.chargesSpent += cost;
    W.showCaption(`you step out by the waystone in ${st.spaceId}` +
      (route ? ` · ${route.hops} line${route.hops === 1 ? '' : 's'} · −${route.shards} shard${route.shards === 1 ? '' : 's'}` : ''));
    W.savePlayer();
    W.refreshHud();
    return true;
  }

  /** How many waystones lie in these rooms (their spaces or traces: anything with `cells`), by run.objects. */
  function stonesIn(rooms) {
    const cells = new Set();
    for (const r of rooms) for (const k of r.cells) cells.add(k);
    let n = 0;
    for (const key in state.run.objects) {
      const o = state.run.objects[key];
      if (o.kind === 'waystone' && key !== state.run.carry && cells.has(DE.key(Math.floor(o.sx / 2), Math.floor(o.sy / 2)))) n++;
    }
    return n;
  }

  Object.assign(W, { GLOW, revealWaypoints, ensureWaypoints, arrive, waitingPins, makeStoneMesh, updateWaystones,
    stoneOf, powerStone, travelFrom, travelTo, placeAt, leyLines, leyRoute, stonesIn });
})(window);
