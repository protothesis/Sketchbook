// Walk mode: what a region is built of (DE.MATERIALS). Each material has
// its own colours, a faint surface texture on walls and floor tiles, and
// its own dressing: the scattered floor details (DP.props) take its shape
// (rubble, loose bricks, boards, pearls, shards, clods and roots), and now
// and then a wall carries a piece of it too. Colour alone washes out under
// the lamp, so shape and texture do most of the telling.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, DP, THREE, S, WALL_H, WALL_T, JAMB, DOOR_W, DOOR_H, ekey } = W;

  /**
   * Colours as [h, s, l] (0..1). `wall`, `floor`, `block` (prop blocks) and
   * `decor` (its floor and wall dressing). `gloss`: Phong instead of
   * Lambert, { shininess, specular }, so the lamp leaves a highlight.
   * `wallDecor`: the chance a plain wall segment carries a piece.
   */
  const LOOK = {
    stone:    { wall: [0.08, 0.05, 0.30], floor: [0.08, 0.05, 0.17], block: [0.08, 0.05, 0.24], decor: [0.08, 0.06, 0.27], wallDecor: 0.22 },
    brick:    { wall: [0.025, 0.42, 0.27], floor: [0.03, 0.28, 0.15], block: [0.03, 0.34, 0.2], decor: [0.025, 0.45, 0.3], wallDecor: 0.25 },
    timber:   { wall: [0.075, 0.42, 0.23], floor: [0.075, 0.38, 0.15], block: [0.07, 0.38, 0.18], decor: [0.08, 0.4, 0.27], wallDecor: 0.35 },
    pearl:    { wall: [0.72, 0.13, 0.6], floor: [0.68, 0.08, 0.33], block: [0.7, 0.1, 0.48], decor: [0.62, 0.16, 0.74], wallDecor: 0.25,
      gloss: { shininess: 40, specular: 0x6a6878 } },
    obsidian: { wall: [0.76, 0.3, 0.045], floor: [0.76, 0.25, 0.04], block: [0.76, 0.28, 0.06], decor: [0.77, 0.35, 0.08], wallDecor: 0.2,
      gloss: { shininess: 90, specular: 0xa498c8 } },
    earth:    { wall: [0.08, 0.3, 0.19], floor: [0.08, 0.27, 0.13], block: [0.08, 0.28, 0.16], decor: [0.09, 0.25, 0.3], wallDecor: 0.3 },
  };
  const lookOf = (space) => LOOK[space.meta && space.meta.material] || LOOK.stone;

  // ---------------------------------------------------------------------------
  // Textures: light greys on white, so the material colour (which multiplies
  // them) sets the tone and the pattern only darkens it a little. Walls tile
  // seamlessly at one cell square; floors fill one tile, in three variants.

  const N = 128;
  function canvas() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, N, N);
    return { cv, g };
  }
  function texture(cv, repeat) {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }
  const ink = (a) => `rgba(0,0,0,${a})`;
  const chalk = (a) => `rgba(255,255,255,${a})`;
  // Draw at x, and again a tile's width either side, so a pattern wraps.
  function wrapped(fn) { for (const dx of [-N, 0, N]) for (const dy of [-N, 0, N]) fn(dx, dy); }
  function speckle(g, r, n, a) {
    for (let i = 0; i < n; i++) {
      g.fillStyle = r.chance(0.5) ? ink(a * r.next()) : chalk(a * r.next());
      g.fillRect(r.next() * N, r.next() * N, 1 + r.int(0, 1), 1 + r.int(0, 1));
    }
  }
  function line(g, pts, w, style) {
    g.lineWidth = w; g.strokeStyle = style; g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
  }

  /** Rows of blocks of varying width; rows of the given heights (summing to N). */
  function courses(g, r, rows, minW, maxW, mortar, a) {
    let y = 0;
    for (const h of rows) {
      let x = r.next() * maxW;
      const xs = [];
      while (x < N && xs.length < 40) { xs.push(x); x += r.range(minW, maxW); }
      g.fillStyle = ink(a);
      g.fillRect(0, y, N, mortar); // bed joint
      for (const bx of xs) wrapped((dx) => g.fillRect(bx + dx, y, mortar, h)); // head joints
      // Each block a slightly different shade.
      for (let i = 0; i < xs.length; i++) {
        const x0 = xs[i], x1 = xs[i + 1] != null ? xs[i + 1] : xs[0] + N;
        g.fillStyle = r.chance(0.5) ? ink(r.next() * a * 0.5) : chalk(r.next() * a * 0.4);
        wrapped((dx) => g.fillRect(x0 + mortar + dx, y + mortar, x1 - x0 - mortar, h - mortar));
      }
      y += h;
    }
  }

  const PAINT = {
    stone: {
      wall(g, r) {
        const rows = []; let left = N;
        while (left > 0) { const h = Math.min(left, r.int(18, 34)); rows.push(left - h < 14 ? left : h); left -= rows[rows.length - 1]; }
        courses(g, r, rows, 26, 60, 2, 0.28);
        speckle(g, r, 260, 0.18);
      },
      floor(g, r) {
        // Two to four flagstones, split by a crooked joint or two.
        const cx = r.range(0.3, 0.7) * N, cy = r.range(0.3, 0.7) * N;
        line(g, [[cx + r.range(-8, 8), 0], [cx, cy], [cx + r.range(-8, 8), N]], 2.5, ink(0.3));
        if (r.chance(0.7)) line(g, [[0, cy + r.range(-8, 8)], [cx, cy]], 2.5, ink(0.3));
        if (r.chance(0.5)) line(g, [[cx, cy], [N, cy + r.range(-10, 10)]], 2.5, ink(0.3));
        speckle(g, r, 300, 0.2);
      },
    },
    brick: {
      wall(g, r) {
        // Running bond: eight courses, each offset half a brick.
        const h = N / 8, bw = N / 4;
        for (let i = 0; i < 8; i++) {
          const y = i * h, off = (i % 2) * bw / 2;
          g.fillStyle = ink(0.3);
          g.fillRect(0, y, N, 2);
          for (let x = off; x < N + bw; x += bw) {
            wrapped((dx) => g.fillRect(x + dx, y, 2, h));
            g.fillStyle = r.chance(0.5) ? ink(r.next() * 0.16) : chalk(r.next() * 0.12);
            wrapped((dx) => g.fillRect(x + 2 + dx, y + 2, bw - 2, h - 2));
            g.fillStyle = ink(0.3);
          }
        }
        speckle(g, r, 160, 0.12);
      },
      floor(g, r) {
        // Pairs of bricks turning by quarters: a basket weave.
        const q = N / 4;
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
          const across = (i + j) % 2 === 0;
          g.fillStyle = r.chance(0.5) ? ink(r.next() * 0.14) : chalk(r.next() * 0.1);
          g.fillRect(i * q, j * q, q, q);
          g.fillStyle = ink(0.28);
          if (across) g.fillRect(i * q, j * q + q / 2 - 1, q, 2); else g.fillRect(i * q + q / 2 - 1, j * q, 2, q);
          g.strokeStyle = ink(0.28); g.lineWidth = 2; g.strokeRect(i * q + 1, j * q + 1, q - 2, q - 2);
        }
      },
    },
    timber: {
      wall(g, r) {
        // Upright planks with dark gaps and wavy grain.
        const n = 5, pw = N / n;
        for (let i = 0; i < n; i++) {
          const x = i * pw;
          g.fillStyle = r.chance(0.5) ? ink(r.next() * 0.14) : chalk(r.next() * 0.1);
          g.fillRect(x, 0, pw, N);
          for (let k = 0; k < 3; k++) {
            const gx = x + r.range(4, pw - 4), amp = r.range(1, 3), ph = r.next() * 6;
            const pts = []; for (let y = 0; y <= N; y += 8) pts.push([gx + Math.sin(y / 14 + ph) * amp, y]);
            line(g, pts, 1, ink(0.16));
          }
          g.fillStyle = ink(0.4);
          g.fillRect(x, 0, 2, N);
          if (r.chance(0.5)) { g.fillStyle = ink(0.45); g.beginPath(); g.arc(x + pw / 2, r.next() * N, 2.5, 0, 7); g.fill(); } // a nail
        }
      },
      floor(g, r) {
        // Boards across the tile, their ends staggered.
        const n = 4, bh = N / n;
        for (let j = 0; j < n; j++) {
          const y = j * bh;
          g.fillStyle = r.chance(0.5) ? ink(r.next() * 0.14) : chalk(r.next() * 0.1);
          g.fillRect(0, y, N, bh);
          for (let k = 0; k < 2; k++) {
            const gy = y + r.range(4, bh - 4), ph = r.next() * 6;
            const pts = []; for (let x = 0; x <= N; x += 8) pts.push([x, gy + Math.sin(x / 16 + ph) * 1.5]);
            line(g, pts, 1, ink(0.14));
          }
          g.fillStyle = ink(0.4);
          g.fillRect(0, y, N, 2);
          g.fillRect(r.range(0.2, 0.8) * N, y, 2, bh);
        }
      },
    },
    pearl: {
      wall(g, r) {
        // Overlapping scallops, like the inside of a shell.
        const w = N / 4, h = N / 8;
        for (let j = 0; j < 9; j++) for (let i = 0; i < 5; i++) {
          const x = i * w + (j % 2) * w / 2, y = j * h;
          wrapped((dx, dy) => {
            g.beginPath(); g.arc(x + dx, y + dy, w / 2, 0, Math.PI);
            g.strokeStyle = ink(0.16); g.lineWidth = 1.5; g.stroke();
            g.beginPath(); g.arc(x + dx, y + dy + 2, w / 2 - 3, 0.3, Math.PI - 0.3);
            g.strokeStyle = chalk(0.5); g.lineWidth = 1; g.stroke();
          });
        }
      },
      floor(g, r) {
        // Faint rings from a point, like nacre.
        const cx = r.range(0.2, 0.8) * N, cy = r.range(0.2, 0.8) * N;
        for (let k = 1; k < 12; k++) {
          g.beginPath(); g.arc(cx, cy, k * 11 + r.range(-2, 2), 0, 7);
          g.strokeStyle = k % 2 ? ink(0.1) : chalk(0.4); g.lineWidth = 1.5; g.stroke();
        }
      },
    },
    obsidian: {
      wall(g, r) {
        // Sharp facets: straight fractures, with a bright edge on one side.
        for (let k = 0; k < 9; k++) {
          const x = r.next() * N, y = r.next() * N, a = r.next() * Math.PI, len = r.range(30, 90);
          const pts = [[x, y], [x + Math.cos(a) * len, y + Math.sin(a) * len]];
          wrapped((dx, dy) => {
            const p = pts.map(([px, py]) => [px + dx, py + dy]);
            line(g, p, 2, ink(0.35));
            line(g, p.map(([px, py]) => [px + 1.5, py + 1.5]), 1, chalk(0.7));
          });
        }
      },
      floor(g, r) {
        for (let k = 0; k < 5; k++) {
          const x = r.next() * N, y = r.next() * N, a = r.next() * Math.PI, len = r.range(30, 80);
          line(g, [[x, y], [x + Math.cos(a) * len, y + Math.sin(a) * len]], 2, ink(0.35));
          line(g, [[x + 1.5, y + 1.5], [x + 1.5 + Math.cos(a) * len, y + 1.5 + Math.sin(a) * len]], 1, chalk(0.6));
        }
      },
    },
    earth: {
      wall(g, r) {
        // Mottled packed earth, a few pebbles, and roots threading through.
        for (let k = 0; k < 40; k++) {
          const x = r.next() * N, y = r.next() * N, rad = r.range(4, 16);
          g.fillStyle = r.chance(0.5) ? ink(r.next() * 0.14) : chalk(r.next() * 0.12);
          wrapped((dx, dy) => { g.beginPath(); g.arc(x + dx, y + dy, rad, 0, 7); g.fill(); });
        }
        for (let k = 0; k < 14; k++) {
          g.fillStyle = r.chance(0.5) ? ink(0.3) : chalk(0.35);
          g.beginPath(); g.arc(r.next() * N, r.next() * N, r.range(1.5, 3.5), 0, 7); g.fill();
        }
        for (let k = 0; k < 2; k++) {
          let x = r.next() * N, y = 0; const pts = [[x, y]];
          while (y < N) { y += r.range(6, 14); x += r.range(-6, 6); pts.push([x, y]); }
          line(g, pts, 1.5, ink(0.3));
        }
      },
      floor(g, r) {
        for (let k = 0; k < 30; k++) {
          g.fillStyle = r.chance(0.5) ? ink(r.next() * 0.16) : chalk(r.next() * 0.12);
          g.beginPath(); g.arc(r.next() * N, r.next() * N, r.range(4, 14), 0, 7); g.fill();
        }
        for (let k = 0; k < 18; k++) {
          g.fillStyle = r.chance(0.5) ? ink(0.3) : chalk(0.3);
          g.beginPath(); g.arc(r.next() * N, r.next() * N, r.range(1.5, 3), 0, 7); g.fill();
        }
      },
    },
  };

  const texCache = {};
  /** { wall, floors: [3] } textures for a material, made once. */
  function textures(name) {
    if (texCache[name]) return texCache[name];
    const p = PAINT[name] || PAINT.stone;
    const w = canvas();
    p.wall(w.g, DE.createRng(DE.hash('material wall', name)));
    const floors = [0, 1, 2].map((i) => {
      const f = canvas();
      p.floor(f.g, DE.createRng(DE.hash('material floor', name, String(i))));
      return texture(f.cv, false);
    });
    return (texCache[name] = { wall: texture(w.cv, true), floors });
  }

  // Wall pieces get world-scaled UVs (one texture repeat per cell, along the
  // wall and up it) so courses line up from segment to segment and a jamb
  // shows a slice of the pattern rather than all of it squeezed.
  function worldUV(geometry, centerY) {
    const pos = geometry.attributes.position, nrm = geometry.attributes.normal, uv = geometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const along = Math.abs(nrm.getX(i)) > 0.5 ? pos.getZ(i) : pos.getX(i);
      uv.setXY(i, along / S + 0.5, (pos.getY(i) + centerY) / S);
    }
    uv.needsUpdate = true;
  }
  worldUV(W.geo.wall, WALL_H * S / 2);
  worldUV(W.geo.jamb, WALL_H * S / 2);
  worldUV(W.geo.lintel, (DOOR_H + (WALL_H - DOOR_H) / 2) * S);
  worldUV(W.geo.post, WALL_H * S / 2);

  const color = ([h, s, l], dl = 0) => new THREE.Color().setHSL(h, s, Math.max(0, l + dl));
  function surface(look, opts) {
    return look.gloss
      ? new THREE.MeshPhongMaterial(Object.assign({ shininess: look.gloss.shininess, specular: look.gloss.specular }, opts))
      : new THREE.MeshLambertMaterial(opts);
  }

  /** A space's materials (world.js caches them per space). */
  function spaceMaterials(space, sealed) {
    const look = lookOf(space), tex = textures(space.meta && space.meta.material);
    return {
      // Past a locked door the floor carries a faint gold warmth.
      floor: [-0.02, 0, 0.02].map((dl, i) => surface(look, {
        color: color(look.floor, dl), map: tex.floors[i], emissive: sealed ? 0x1c1404 : 0x000000,
      })),
      wall: W.withDither(surface(look, { color: color(look.wall), map: tex.wall })),
      // Blocks never dissolve; the figure shows through them instead.
      block: surface(look, { color: color(look.block) }),
    };
  }

  // ---------------------------------------------------------------------------
  // Dressing

  const unit = new THREE.BoxGeometry(1, 1, 1);
  const pebble = new THREE.IcosahedronGeometry(1, 0);
  const bead = new THREE.SphereGeometry(1, 10, 8);
  const shard = new THREE.ConeGeometry(1, 1, 4).translate(0, 0.5, 0); // base at the origin
  const root = new THREE.CylinderGeometry(1, 0.6, 1, 5).translate(0, -0.5, 0); // hangs from the origin

  const decorCache = {};
  /** Shared decor materials per material: [floor shades x2, wall (dithered)]. */
  function decorMats(name) {
    if (decorCache[name]) return decorCache[name];
    const look = LOOK[name] || LOOK.stone;
    const floor = [-0.05, 0.03].map((dl) => surface(look, { color: color(look.decor, dl) }));
    const wall = W.withDither(surface(look, { color: color(look.decor, 0.02) }));
    return (decorCache[name] = { floor, wall });
  }

  function piece(geo, mat, sx, sy, sz) {
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(sx, sy, sz);
    m.receiveShadow = true;
    return m;
  }

  /**
   * Floor dressing for one detail rect (DP.props details), as a group
   * centred on the rect, its base on the floor. `r` is a seeded rng.
   */
  const FLOOR = {
    stone(d, r, mats) { // rubble: a few small stones, turned
      const g = new THREE.Group(), n = 1 + r.int(0, 2);
      for (let i = 0; i < n; i++) {
        const w = r.range(0.05, 0.12) * S, h = r.range(0.025, 0.07) * S;
        const m = piece(unit, mats.floor[r.int(0, 1)], w, h, w * r.range(0.6, 1.1));
        m.position.set(r.range(-0.5, 0.5) * d.w, h / 2, r.range(-0.5, 0.5) * d.d);
        m.rotation.y = r.next() * Math.PI;
        g.add(m);
      }
      return g;
    },
    brick(d, r, mats) { // a few loose bricks, one maybe on another
      const g = new THREE.Group(), n = 2 + r.int(0, 2), turn = r.next() * Math.PI;
      const bw = 0.16 * S, bh = 0.05 * S, bd = 0.08 * S;
      for (let i = 0; i < n; i++) {
        const m = piece(unit, mats.floor[r.int(0, 1)], bw, bh, bd);
        const up = i === n - 1 && r.chance(0.4);
        m.position.set((i % 2) * bw * 0.5 + r.range(-0.02, 0.02) * S, up ? bh * 1.5 : bh / 2, (Math.floor(i / 2) - 0.5) * bd * (up ? 0.5 : 1.1));
        m.rotation.y = r.range(-0.25, 0.25);
        g.add(m);
      }
      g.rotation.y = turn;
      return g;
    },
    timber(d, r, mats) { // a loose board, sometimes two crossed
      const g = new THREE.Group(), n = r.chance(0.3) ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const len = r.range(0.28, 0.5) * S, th = 0.02 * S;
        const m = piece(unit, mats.floor[r.int(0, 1)], len, th, 0.07 * S);
        m.position.set(0, th / 2 + i * th, 0);
        m.rotation.y = r.next() * Math.PI;
        g.add(m);
      }
      return g;
    },
    pearl(d, r, mats) { // a cluster of pearls, half sunk
      const g = new THREE.Group(), n = 2 + r.int(0, 3);
      for (let i = 0; i < n; i++) {
        const rad = r.range(0.02, 0.045) * S;
        const m = piece(bead, mats.floor[1], rad, rad, rad);
        m.position.set(r.range(-0.5, 0.5) * d.w, rad * 0.3, r.range(-0.5, 0.5) * d.d);
        g.add(m);
      }
      return g;
    },
    obsidian(d, r, mats) { // shards standing up out of the floor, leaning
      const g = new THREE.Group(), n = 1 + r.int(0, 2);
      for (let i = 0; i < n; i++) {
        const w = r.range(0.025, 0.05) * S, h = r.range(0.08, 0.2) * S;
        const m = piece(shard, mats.floor[r.int(0, 1)], w, h, w);
        m.position.set(r.range(-0.5, 0.5) * d.w, 0, r.range(-0.5, 0.5) * d.d);
        m.rotation.set(r.range(-0.4, 0.4), r.next() * Math.PI, r.range(-0.4, 0.4));
        g.add(m);
      }
      return g;
    },
    earth(d, r, mats) { // clods, and now and then a root lying across
      const g = new THREE.Group(), n = 1 + r.int(0, 1);
      for (let i = 0; i < n; i++) {
        const rad = r.range(0.035, 0.07) * S;
        const m = piece(pebble, mats.floor[r.int(0, 1)], rad, rad * 0.55, rad);
        m.position.set(r.range(-0.5, 0.5) * d.w, rad * 0.25, r.range(-0.5, 0.5) * d.d);
        m.rotation.y = r.next() * Math.PI;
        g.add(m);
      }
      if (r.chance(0.4)) {
        const len = r.range(0.25, 0.45) * S, rad = 0.012 * S;
        const m = piece(root, mats.floor[0], rad, len, rad);
        m.rotation.set(0, r.next() * Math.PI, Math.PI / 2);
        m.position.set(len / 2, rad, 0);
        g.add(m);
      }
      return g;
    },
  };

  /** Dressing for a floor detail (`d`: { x0, y0, x1, y1 }), positioned relative to its tile. */
  function floorDecor(space, d, i, tile) {
    const name = (space.meta && space.meta.material) || 'stone';
    const r = DE.createRng(DE.hash('decor', space.seed, String(i)));
    const cx = (d.x0 + d.x1) / 2, cy = (d.y0 + d.y1) / 2;
    const g = (FLOOR[name] || FLOOR.stone)({ w: (d.x1 - d.x0) * S, d: (d.y1 - d.y0) * S }, r, decorMats(name));
    g.position.set(cx * S - tile.position.x, 0.05, cy * S - tile.position.z);
    return g;
  }

  /**
   * Wall dressing, in a wall segment's own frame (x along the wall, y up,
   * +z into the room): a group to add to the segment's edge group, so it
   * reveals, dissolves and dithers with the wall.
   */
  const WALL = {
    stone(r, m) { // a stone or two standing proud of the face
      const g = new THREE.Group(), n = 1 + r.int(0, 1);
      for (let i = 0; i < n; i++) {
        const w = r.range(0.18, 0.3) * S, h = r.range(0.1, 0.16) * S, dz = 0.035 * S;
        const p = piece(unit, m, w, h, dz);
        p.position.set(r.range(-0.3, 0.3) * S, r.range(0.15, WALL_H - 0.2) * S, dz / 2);
        g.add(p);
      }
      return g;
    },
    brick(r, m) { // a patch of bricks proud of the wall, staggered
      const g = new THREE.Group(), bw = 0.16 * S, bh = WALL_H * S / 16, dz = 0.025 * S;
      const x0 = r.range(-0.3, 0.2) * S, y0 = r.range(0.2, WALL_H - 0.35) * S, rows = 2 + r.int(0, 1);
      for (let j = 0; j < rows; j++) {
        const n = 1 + r.int(0, 2);
        for (let i = 0; i < n; i++) {
          const p = piece(unit, m, bw * 0.94, bh * 0.85, dz);
          p.position.set(x0 + i * bw + (j % 2) * bw / 2, y0 + j * bh, dz / 2);
          g.add(p);
        }
      }
      return g;
    },
    timber(r, m) { // an upright post, or a rail along the wall
      const g = new THREE.Group(), dz = 0.04 * S;
      if (r.chance(0.55)) {
        const p = piece(unit, m, 0.08 * S, WALL_H * S, dz);
        p.position.set(r.range(-0.35, 0.35) * S, WALL_H * S / 2, dz / 2);
        g.add(p);
      } else {
        const p = piece(unit, m, S, 0.07 * S, dz);
        p.position.set(0, r.range(0.55, 1.05) * S, dz / 2);
        g.add(p);
      }
      return g;
    },
    pearl(r, m) { // pearls grown into the wall
      const g = new THREE.Group(), n = 3 + r.int(0, 3);
      const cx = r.range(-0.3, 0.3) * S, cy = r.range(0.25, WALL_H - 0.25) * S;
      for (let i = 0; i < n; i++) {
        const rad = r.range(0.025, 0.05) * S;
        const p = piece(bead, m, rad, rad, rad * 0.7);
        p.position.set(cx + r.range(-0.1, 0.1) * S, cy + r.range(-0.1, 0.1) * S, 0);
        g.add(p);
      }
      return g;
    },
    obsidian(r, m) { // a shard jutting out and up
      const g = new THREE.Group(), n = 1 + r.int(0, 1);
      for (let i = 0; i < n; i++) {
        const w = r.range(0.03, 0.06) * S, h = r.range(0.15, 0.3) * S;
        const p = piece(shard, m, w, h, w);
        p.position.set(r.range(-0.3, 0.3) * S, r.range(0.3, WALL_H - 0.3) * S, 0);
        p.rotation.set(r.range(0.7, 1.2), 0, r.range(-0.5, 0.5));
        g.add(p);
      }
      return g;
    },
    earth(r, m) { // roots hanging from the top of the wall
      const g = new THREE.Group(), n = 1 + r.int(0, 2);
      for (let i = 0; i < n; i++) {
        const len = r.range(0.35, 0.85) * S, rad = r.range(0.018, 0.03) * S;
        const p = piece(root, m, rad, len, rad);
        p.position.set(r.range(-0.35, 0.35) * S, WALL_H * S, rad);
        p.rotation.set(r.range(0, 0.15), 0, r.range(-0.12, 0.12));
        g.add(p);
      }
      return g;
    },
  };

  /** Plain wall segments of a space that carry a piece of its material (not ones with a sconce). */
  function addWallDecor(space, walls) {
    const name = (space.meta && space.meta.material) || 'stone';
    const look = LOOK[name] || LOOK.stone, make = WALL[name] || WALL.stone, m = decorMats(name).wall;
    const busy = new Set(DP.sconces(space).map((sd) => ekey(sd.cell.x, sd.cell.y, sd.facing)));
    for (const w of walls) {
      if (busy.has(w.key)) continue;
      const r = DE.createRng(DE.hash('wall decor', space.seed, w.key));
      if (!r.chance(look.wallDecor)) continue;
      const g = make(r, m);
      g.position.z = -w.beyond * WALL_T * S / 2; // the room-side face
      if (w.beyond > 0) g.rotation.y = Math.PI; // turn to face the room
      w.eg.add(g);
    }
  }

  Object.assign(W, { MATERIAL_LOOK: LOOK, spaceMaterials, floorDecor, addWallDecor });
})(window);
