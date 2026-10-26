// Walk mode: pixies. Small violet lights with wings, drifting about a room
// (about 1 room in 10). F with an empty jar near one catches it. A jarred
// pixie powers a sigil, and ghosts are drawn to pixies, free or jarred,
// so a jar set down is how you move ghosts around a room. How they behave
// toward other things comes from the ecology's rules (ecology.js): they
// flee ghosts and linger at entropy wells.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, DP, THREE, S, scene, state, savePlayer, passable } = W;

  const PIXIE = {
    speed: 0.6,         // cells/s, wandering
    fleeSpeed: 1.5,     // cells/s at the closest, pushed away from a ghost
    height: 0.62,       // cells: hover height
    catchRange: 0.75,   // cells: F with an empty jar this close catches one
    pause: [0.6, 2],    // s, between wander goals
  };

  const geo = {
    body: new THREE.SphereGeometry(0.045 * S, 12, 8),
    wing: new THREE.PlaneGeometry(0.09 * S, 0.06 * S),
  };
  const bodyMat = new THREE.MeshBasicMaterial({ color: 0xd9b3ff });
  const wingMat = new THREE.MeshBasicMaterial({ color: 0xc9b8ff, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
  const glowTex = (() => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 32;
    const g = cv.getContext('2d');
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.4)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(cv);
  })();
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xb070ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });

  function addPixie(o) {
    const mesh = new THREE.Group();
    mesh.add(new THREE.Mesh(geo.body, bodyMat));
    const wings = [-1, 1].map((side) => {
      const w = new THREE.Mesh(geo.wing, wingMat);
      w.position.x = side * 0.045 * S;
      mesh.add(w);
      return w;
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(0.3 * S);
    mesh.add(glow);
    scene.add(mesh);
    const px = Object.assign({ target: null, pause: 0, phase: Math.random() * 10 }, o, { mesh, wings });
    state.pixies.push(px);
    return px;
  }

  function removePixie(px) {
    scene.remove(px.mesh);
    state.pixies = state.pixies.filter((o) => o !== px);
  }
  function clearPixies() { for (const o of state.pixies.slice()) removePixie(o); }

  /** A room's pixie, rolled once per room, ever (like its ghost). */
  function spawnPixie(space) {
    const pid = space.id + ':' + space.seed + ':pixie';
    if (state.run.pixieSeen.includes(pid)) return;
    state.run.pixieSeen.push(pid);
    const c = DP.pixieSpawn(space);
    if (c) addPixie({ id: pid, x: c.x + 0.5, y: c.y + 0.5 });
  }

  const spaceAt = (x, y) => state.exp.registry[DE.key(Math.floor(x), Math.floor(y))];

  /** Move toward a step, only into cells it can fly between (it flies over blocks). */
  function stepTo(px, nx, ny) {
    const ox = Math.floor(px.x), oy = Math.floor(px.y), cx = Math.floor(nx), cy = Math.floor(ny);
    const ok = spaceAt(nx, ny) !== undefined &&
      ((cx === ox && cy === oy) || (Math.abs(cx - ox) + Math.abs(cy - oy) === 1 && passable(ox, oy, cx, cy)));
    if (ok) { px.x = nx; px.y = ny; return true; }
    return false;
  }

  function updatePixies(dt) {
    const frozen = state.paused || !!state.bigmap;
    for (const px of state.pixies) {
      px.phase += dt;
      if (!frozen) {
        const away = W.ecology.flee('pixie', px);
        if (away) {
          px.target = null;
          stepTo(px, px.x + away.x * PIXIE.fleeSpeed * dt, px.y + away.y * PIXIE.fleeSpeed * dt) ||
            stepTo(px, px.x + away.x * PIXIE.fleeSpeed * dt, px.y) || stepTo(px, px.x, px.y + away.y * PIXIE.fleeSpeed * dt);
        } else if (px.pause > 0) px.pause -= dt;
        else {
          if (!px.target) {
            const s = W.ecology.seek('pixie', px);
            if (s) px.target = s;
            else {
              const sp = state.exp.spaces[spaceAt(px.x, px.y)];
              if (sp) {
                const c = DE.parseKey(sp.cells[Math.floor(Math.random() * sp.cells.length)]);
                px.target = { x: c.x + 0.15 + Math.random() * 0.7, y: c.y + 0.15 + Math.random() * 0.7 };
              }
            }
          }
          if (px.target) {
            const dx = px.target.x - px.x, dy = px.target.y - px.y, d = Math.hypot(dx, dy);
            const st = Math.min(d, PIXIE.speed * dt);
            const moved = d > 0.02 && stepTo(px, px.x + dx / d * st, px.y + dy / d * st);
            if (d <= 0.05 || !moved) { // there, or a wall in the way: rest, then pick again
              px.target = null;
              px.pause = PIXIE.pause[0] + Math.random() * (PIXIE.pause[1] - PIXIE.pause[0]);
            }
          }
        }
      }
      // Bob, flutter, and a little figure-eight around where it is.
      const t = px.phase;
      px.mesh.position.set((px.x + Math.sin(t * 1.3) * 0.05) * S, (PIXIE.height + Math.sin(t * 2.1) * 0.06) * S, (px.y + Math.sin(t * 2.6) * 0.04) * S);
      const flap = Math.sin(t * 38) * 0.9;
      px.wings[0].rotation.y = flap; px.wings[1].rotation.y = -flap;
    }
  }

  /** The nearest free pixie within catching range of you, or null. */
  function pixieNear(p) {
    let best = null, bd = PIXIE.catchRange;
    for (const px of state.pixies) {
      const d = Math.hypot(px.x - p.x, px.y - p.y);
      if (d < bd) { bd = d; best = px; }
    }
    return best;
  }

  /** Catch a pixie in a carried empty jar, or the hourglass (a swipe of it, F). */
  function catchPixie(px, jar, caption = 'you catch the pixie in a jar · ghosts are drawn to it') {
    jar.holds = 'pixie';
    removePixie(px);
    state.run.pixiesCaught = (state.run.pixiesCaught || 0) + 1;
    W.showCaption(caption);
    savePlayer();
    W.refreshHud();
  }

  /** Pixies in rooms that collapse go with them. */
  function dropPixiesIn(ids) {
    for (const px of state.pixies.slice()) if (ids.has(spaceAt(px.x, px.y))) removePixie(px);
  }

  Object.assign(W, { PIXIE, addPixie, clearPixies, spawnPixie, updatePixies, pixieNear, catchPixie, dropPixiesIn });
})(window);
