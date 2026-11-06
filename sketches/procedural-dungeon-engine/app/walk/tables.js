// Walk mode: tables (HANDS-PLAN.md, step 5). Surfaces you place collectables
// on. A loose object like a chest (restore.js: run.objects, with its own
// `cells`, carried with whatever is on it), but too tall to stand on and with
// nothing stacked on it.
//
//   table     programmer art: a plain wooden table. Takes any collectable.
//   endtable  a small end table with a placemat and a drawer. Takes only
//             kitchenware (the teacup, the saucer, the spoon). Set with all
//             three on it, it's +1 entropy max for as long as it stays set
//             (the sigils' buff, items.js updateSigils, adds it in).
//
// Each holds up to TABLE.places things, one a place. Y with a collectable in
// hand places one on the table in front of you (it's in release.js's
// ACCEPTS, as 'collectable'); X tapped at a table takes the last one back
// into your hand; X held grabs it, like any object.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { THREE, S, state, savePlayer } = W;

  const TABLE = {
    height: 0.42,  // cells: a little under a block unit, and never stood on
    places: 4,     // things on top, one each
    kitchen: W.RULES.kitchenware, // what an end table takes (engine/contents.js); all three on it and it's set
    setBuff: 1,    // entropy max while an end table is set
  };
  const KITCHEN = new Set(TABLE.kitchen);
  const PLACES = [[-0.1, -0.1], [0.1, -0.1], [-0.1, 0.1], [0.1, 0.1]]; // cells from the middle of the top

  const woodMat = new THREE.MeshLambertMaterial({ color: 0x8a6440, emissive: 0x140c06 });
  const darkWoodMat = new THREE.MeshLambertMaterial({ color: 0x5e3f26, emissive: 0x0e0804 });
  const knobMat = new THREE.MeshLambertMaterial({ color: 0xc9a35a, emissive: 0x2a1e08 });
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c, emissive: 0x000000 });
  const geo = {
    top: new THREE.BoxGeometry(0.46 * S, 0.04 * S, 0.46 * S),
    leg: new THREE.BoxGeometry(0.04 * S, 1, 0.04 * S), // scaled to its height
    endTop: new THREE.BoxGeometry(0.42 * S, 0.05 * S, 0.42 * S),
    endLeg: new THREE.CylinderGeometry(0.022 * S, 0.014 * S, 1, 8),
    apron: new THREE.BoxGeometry(0.38 * S, 0.08 * S, 0.38 * S),
    drawer: new THREE.BoxGeometry(0.22 * S, 0.055 * S, 0.01 * S),
    knob: new THREE.SphereGeometry(0.012 * S, 8, 6),
    mat: new THREE.PlaneGeometry(0.32 * S, 0.26 * S).rotateX(-Math.PI / 2),
    matEdge: new THREE.PlaneGeometry(0.36 * S, 0.3 * S).rotateX(-Math.PI / 2),
  };

  /** A table's mesh, its origin at the middle of its half-cell, on the floor. `top` holds what's on it. */
  function makeTableMesh(kind) {
    const g = new THREE.Group(), H = TABLE.height * S;
    const legs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    if (kind === 'endtable') {
      const top = new THREE.Mesh(geo.endTop, darkWoodMat);
      top.position.y = H - 0.025 * S;
      const apron = new THREE.Mesh(geo.apron, darkWoodMat);
      apron.position.y = H - 0.05 * S - 0.04 * S;
      const drawer = new THREE.Mesh(geo.drawer, woodMat);
      drawer.position.set(0, apron.position.y, 0.19 * S + 0.005 * S); // the side facing south: the camera's
      const knob = new THREE.Mesh(geo.knob, knobMat);
      knob.position.set(0, apron.position.y, 0.2 * S + 0.01 * S);
      g.add(top, apron, drawer, knob);
      for (const [x, z] of legs) {
        const l = new THREE.Mesh(geo.endLeg, darkWoodMat);
        l.scale.y = H - 0.05 * S;
        l.position.set(x * 0.17 * S, (H - 0.05 * S) / 2, z * 0.17 * S);
        g.add(l);
      }
      // The placemat: cloth with a pale edge. It glows a little when the table is set.
      const edge = new THREE.Mesh(geo.matEdge, mat(0xd8c9a8));
      edge.position.y = H + 0.002 * S;
      const cloth = mat(0x8a3b3b);
      const m = new THREE.Mesh(geo.mat, cloth);
      m.position.y = H + 0.004 * S;
      g.add(edge, m);
      g.userData.cloth = cloth;
    } else {
      const top = new THREE.Mesh(geo.top, woodMat);
      top.position.y = H - 0.02 * S;
      g.add(top);
      for (const [x, z] of legs) {
        const l = new THREE.Mesh(geo.leg, woodMat);
        l.scale.y = H - 0.04 * S;
        l.position.set(x * 0.2 * S, (H - 0.04 * S) / 2, z * 0.2 * S);
        g.add(l);
      }
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    const onTop = new THREE.Group();
    onTop.position.y = H + 0.006 * S;
    g.add(onTop);
    g.userData.onTop = onTop;
    return g;
  }

  /** What's on a table: its run.objects entry's cells (or `fallback`, for a preview). */
  const cellsOf = (b, fallback) => {
    const o = state.run && state.run.objects[b.key];
    return o ? (o.cells = o.cells || []) : fallback || [];
  };
  /** An end table with all its kitchenware on it. */
  const isSet = (b, cells = cellsOf(b)) => b.table === 'endtable' && TABLE.kitchen.every((k) => cells.some((c) => c && c.kind === 'curio' && c.type === k));

  /** Show what's on a table, on its top. */
  function dressTable(b, cells = cellsOf(b)) {
    const top = b.mesh.userData.onTop;
    if (!top) return;
    top.clear();
    cells.forEach((c, i) => {
      if (!c || i >= PLACES.length) return;
      const m = W.itemMesh(Object.assign({}, c, { cell: { x: 0, y: 0 } }), b.key + ':top' + i);
      m.scale.setScalar(0.85);
      m.position.set(PLACES[i][0] * S, 0, PLACES[i][1] * S);
      top.add(m);
    });
    const cloth = b.mesh.userData.cloth;
    if (cloth) cloth.emissive.setHex(isSet(b, cells) ? 0x3a1a0a : 0x000000);
  }

  /** The entropy max set end tables add: those in the world, not in your hands. */
  function tableBuff() {
    let n = 0;
    for (const b of state.pushBlocks) if (b.table === 'endtable' && !b.carried && isSet(b)) n += TABLE.setBuff;
    return n;
  }

  /** Place one of the collectable in your hand on table b. */
  function placeOn(b) {
    const run = state.run, h = state.handColl;
    const out = h && W.takeOut(run, h.grid, h.i, true);
    if (!out) return;
    const cells = cellsOf(b);
    cells.push(Object.assign({}, out, { n: 1 }));
    dressTable(b);
    W.showCaption(`you set ${W.cellName(out)} on the ${b.table === 'endtable' ? 'end table' : 'table'}`);
    W.selectedSlot(); // the last of it gone from your hand: empty hands
    savePlayer();
    W.refreshHud();
    W.refreshHotbar();
  }
  /** X tapped at a table: the last thing put on it, back into your hand. */
  function takeBack(b) {
    const run = state.run, cells = cellsOf(b), c = cells[cells.length - 1];
    if (!c) return;
    if (!W.fits(run, c)) { W.showCaption('no room for it with your collectables'); W.shakeHotbar(); return; }
    cells.pop();
    W.receive(run, c);
    dressTable(b);
    const at = W.collStops(run).find((s) => { const x = collCell(run, s); return x && x.kind === c.kind && (x.type || '') === (c.type || ''); });
    if (at && !state.carry) { state.handColl = at; W.hold('hand-coll'); }
    W.showCaption('you take back ' + W.cellName(c));
    savePlayer();
    W.refreshHud();
    W.refreshHotbar();
  }
  const collCell = (run, s) => (s.grid === 'coll' ? W.inv(run).coll[s.i] : s.grid === 'purse' ? W.purseCells(run)[s.i] : W.layoutItems(run)[s.i]);
  /** The last thing on a table, or null. */
  const topOf = (b) => { const c = cellsOf(b); return c[c.length - 1] || null; };

  // A table accepts a collectable placed on it (release.js's list).
  W.ACCEPTS.push({
    name: 'table',
    find(p, what, from) {
      if (what !== 'collectable') return null;
      const b = W.objectAhead(p, (x) => !!x.table);
      if (!b) return null;
      const name = b.table === 'endtable' ? 'end table' : 'table';
      if (cellsOf(b).length >= TABLE.places) return { table: b, blocked: `the ${name} is full`, line: { cls: 'blocked', text: `the ${name} is full` } };
      if (b.table === 'endtable' && !(from && from.kind === 'curio' && KITCHEN.has(from.type))) {
        return { table: b, blocked: 'the end table takes only kitchenware', line: { cls: 'blocked', text: 'the end table takes only kitchenware' } };
      }
      return { table: b, line: { cls: 'jar', text: `set it on the ${name}` } };
    },
    take(t) { placeOn(t.table); },
  });

  Object.assign(W, { TABLE, makeTableMesh, dressTable, tableBuff, takeBack, topOf, isSetTable: isSet });
})(window);
