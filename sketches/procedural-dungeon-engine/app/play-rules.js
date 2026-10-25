// Walk mode's game rules: loot, locked doors and the cost of collapsing a
// branch. Pure data + engine calls, no DOM or three.js, so it also loads
// under Node.
//
// Everything placed in the world is derived from a space's seed on its own
// named stream (like `meta`), so it never shifts layouts and a replayed
// expedition holds exactly the same shards, keys and locks. The engine
// itself stays rule-free; this layer only reads its data.
(function (global) {
  'use strict';

  const DE = global.DungeonEngine;
  const DP = (global.DungeonPlay = global.DungeonPlay || {});

  // Tunables. PLAY.md has the reasoning ("moderate" pacing).
  const RULES = {
    // Entropy is measured in charges, as a fluid amount; a shard is a third
    // of one. Rerolls and waystones cost whole charges.
    shardsPerCharge: 3,
    chargesStart: 2,
    chargesMax: 6,            // a smaller tank, so staying full takes restoring (was 8)
    // Shards are a supplement: restoration (push blocks, sconces) is the main
    // income (GAME-DESIGN.md). Was 0.75 / 0.4 / 0.5 before restoration.
    shardChance: { chamber: 0.3, corridor: 0.15, stub: 0.2, hall: 0.3 },
    bigChamberCells: 20,      // chambers this large can hold a second shard
    // Locks come first, keys later: a room's seed only makes it able to
    // hold a key; the walk layer shows that key only while there are more
    // unopened locked doors than keys around (see keyNeeded() in walk/actions.js).
    keyChance: 0.25,
    keyMinDepth: 1,
    lockChance: 0.045,        // at lockMinDepth, rising per level of depth
    lockChancePerDepth: 0.0075,
    lockChanceMax: 0.09,
    lockMinDepth: 3,          // depth of the space the locked door leads out of
    // Doorstones: open a door in any bare wall. About as rare as keys turn out.
    chalkChance: 0.045,
    chalkMinDepth: 2,
    // Jars hold one pixie each; a sigil tile powers up with a pixie jar.
    jarChance: 1 / 15,
    jarMinDepth: 1,
    jarCapacity: 1,
    // Pixies: small winged lights, drifting in about 1 room in 10. Catch one
    // in an empty jar; ghosts are drawn to them, free or jarred.
    pixieChance: 0.1,
    pixieMinDepth: 1,
    stickChance: 1 / 12,      // chalk sticks (3 marks each): semi-rare; you start with one silver
    stickMinDepth: 1,
    chalkColors: ['silver', 'gold', 'crimson', 'teal', 'violet'],
    sigilChance: 0.052,       // ~1 room in 25 (small rooms and the root never get one)
    sigilMinDepth: 1,
    // Entropy wells (GAME-DESIGN.md, section 13): a floor tile that pours
    // entropy into your lamp while you stand in it, up to wellCapacity, and
    // then runs dry. A surge well comes back all at once after
    // wellSurgeCooldown seconds; a trickle well starts refilling
    // wellTrickleDelay seconds after you last drew on it, a full well every
    // wellTrickleTime seconds. Times are walking time (run.walked).
    wellChance: 0.05,         // ~1 room in 20
    wellMinDepth: 1,
    wellSurge: 0.5,           // share of wells that surge (the rest trickle)
    wellCapacity: 1,          // charges
    wellRate: 0.6,            // charges per second while you stand in it
    wellSurgeCooldown: 90,
    wellTrickleDelay: 10,
    wellTrickleTime: 120,
    chargesPerRoom: 1,        // collapse price: a flat charge per room in the branch
    // Lost paths (GAME-DESIGN.md, section 17): retracing one costs a shard
    // per room, at least a charge, and needs the thread: a rare find at
    // depth 3+, kept for good once found.
    retracePerRoom: 1 / 3,
    retraceMin: 1,
    threadChance: 1 / 20,
    threadMinDepth: 3,
    // Props: blocks on a half-cell subgrid, stacked in half-cell-ish units
    // (3 units = floor to ceiling), plus flat floor detail.
    propAttempts: 0.32,       // placement attempts per chamber cell
    propAttemptsCorridor: 0.12,
    blockUnit: 1.3 / 3,       // one stacked unit (cells); a 1-unit block hides a crouched figure
    climbMaxUnits: 1,         // a single step up at a time
    climbMaxTop: 1,           // units: never stand higher than one block (head room)
    // Restoration (GAME-DESIGN.md): a push block out of place and the floor
    // mark where it belongs. Putting one home pays entropy once.
    pushChance: 0.25,
    pushMinDepth: 1,
    pushColors: ['#e0a94a', '#57cdbf', '#c47be0', '#e86a6a'],
    restoreCharges: 2 / 3,    // two shards (was a whole charge)
    // Sconces: unlit, on a room's walls. Lighting one costs a shard of your
    // lamp's entropy, and the room never drains the lamp again.
    sconceChance: 0.35,
    sconceMinDepth: 1,
    sconceSecond: 0.4,        // chambers: chance of a second sconce (halls: hallSconceSecond)
    sconceCost: 1,            // shards
    // The lamp burns entropy (GAME-DESIGN.md, section 10), steadily: a
    // shard's worth every lampSeconds, except within a tile of a lit sconce.
    // Any gain holds the burn for lampGrace seconds. The lamp looks full at
    // lampFullCharges or more and is in danger at lampDanger or less.
    lampSeconds: 18,          // was 12: less hurry, leaning toward careful
    lampGrace: 3,
    lampFullCharges: 3,
    lampDanger: 1,
    // The lamp's three stages, by fuel: uneasy (a little more flicker and
    // wobble) at lampUneasy charges or less, danger (clear flicker) at
    // lampDanger, dying (the flicker settles into a slow, irregular fade,
    // swelling as you move) at lampDying. Blended, never stepped.
    lampUneasy: 2,
    lampDying: 0.5,
    // R relights the lamp (out of fuel, or covered) for this many shards;
    // R while lit covers it, for free. Entropy alone doesn't relight it.
    relightShards: 1,
    // Psychic stamina (GAME-DESIGN.md, section 12): a meter from 0 to 1. A
    // ghost's touch knocks off staminaHit and drains it for as long as you
    // stay in the ghost's (swollen) reach; the dark (an empty or covered
    // lamp, away from a sconce's light) drains it more slowly. Empty: you pass
    // out and wake at your last waystone. It refills once nothing has
    // drained it for staminaRegenDelay seconds and you're in light.
    staminaHit: 0.15,
    staminaDrain: 0.2,        // per second in a ghost's reach: a full meter lasts 5 s
    staminaDarkDrain: 0.08,   // per second in the dark: about 12 s
    staminaCreeperDrain: 0.2, // per second in a bold or hunting shadow creeper's strongest band, times the band's share (creepers.js); adds to the dark's
    staminaRegen: 0.12,       // per second
    staminaRegenDelay: 1.5,
    // Halls (setpieces at waypoints): sizes, and what they always hold.
    hallMin: 7,
    hallMax: 9,
    hallPushBlocks: 3,
    hallSconceSecond: 0.5,
    // Waypoints: the expedition starts with two near and one far. Waking a
    // waystone reveals 0-3 more (waypointOdds; never 0 while none are
    // waiting), alternating near and far, centre to centre from the
    // waystone, with a free ring around each footprint.
    waypointNear: [25, 35],
    waypointFar: [45, 60],
    waypointOdds: [0.1, 0.45, 0.35, 0.1], // chance of 0, 1, 2, 3
    waypointPinJitter: 2,     // cells: the pin sits in or around the footprint
    // Waystones: waking one costs this many charges. Travel rides the ley
    // lines between awake waystones (each joins its leyNeighbours nearest,
    // and the network is always connected), at travelShardsPerHop per line.
    waystoneCharges: 1,
    leyNeighbours: 2,
    travelShardsPerHop: 1,
    detailChance: 0.35,
    // Hash ghosts: about 1 room in 14; rooms on cracked (imprinted) floor
    // get a boost that grows with how much of the room is cracked.
    ghostChance: 1 / 14,
    ghostImprintBase: 0.1,
    ghostImprintBoost: 0.3,
    ghostChanceMax: 0.4,
    // Shadow creepers: about 1 room in 12, from depth 2.
    creeperChance: 1 / 12,
    creeperMinDepth: 2,
  };

  /** Items lying in a space: [{ id, kind: 'shard'|'key'|'chalk'|'jar', cell }]. */
  function loot(space) {
    if (!space.parentId) return [];
    const r = DE.deriveRng(space.seed, 'loot');
    const cells = space.cells.map(DE.parseKey);
    const entry = space.exits[0] && space.exits[0].cell;
    const ws = waystone(space); // halls: nothing lies on the waystone's cell
    const spots = cells.length > 1 && entry
      ? r.shuffle(cells.filter((c) => (c.x !== entry.x || c.y !== entry.y) && (!ws || c.x !== ws.cell.x || c.y !== ws.cell.y)))
      : cells.slice();
    const items = [];
    const chance = space.deadEnd ? RULES.shardChance.stub : RULES.shardChance[space.archetype] || 0;
    let n = 0;
    if (r.chance(chance)) n++;
    if (space.cells.length >= RULES.bigChamberCells && r.chance(chance * 0.6)) n++;
    for (let i = 0; i < n; i++) items.push({ id: 'shard' + i, kind: 'shard', cell: spots[i % spots.length] });
    if (space.depth >= RULES.keyMinDepth && r.chance(RULES.keyChance)) {
      items.push({ id: 'key', kind: 'key', cell: spots[n % spots.length] });
    }
    // Drawn last so adding it never shifted the rolls above.
    if (r.chance(RULES.chalkChance) && space.depth >= RULES.chalkMinDepth) {
      items.push({ id: 'chalk', kind: 'doorstone', cell: spots[(n + 2) % spots.length] }); // id kept from 'door chalk'
    }
    // Drawn after chalk, so neither the chalk nor anything above shifted.
    if (r.chance(RULES.jarChance) && space.depth >= RULES.jarMinDepth) {
      items.push({ id: 'jar', kind: 'jar', cell: spots[(n + 3) % spots.length] });
    }
    // Chalk sticks come after jars (same reason). Each has a seeded colour.
    if (r.chance(RULES.stickChance) && space.depth >= RULES.stickMinDepth) {
      items.push({ id: 'pin', kind: 'chalk', color: r.pick(RULES.chalkColors), cell: spots[(n + 4) % spots.length] }); // id kept from 'map pin'
    }
    // The thread (retrace lost paths), drawn last.
    if (r.chance(RULES.threadChance) && space.depth >= RULES.threadMinDepth) {
      items.push({ id: 'thread', kind: 'thread', cell: spots[(n + 5) % spots.length] });
    }
    return items;
  }

  /**
   * A sigil tile in this space, if it has one: { cell, seed }. Seeded on its
   * own stream; never on a door cell or an item's cell.
   */
  function sigil(space) {
    if (!space.parentId || space.depth < RULES.sigilMinDepth || space.cells.length < 4) return null;
    const r = DE.deriveRng(space.seed, 'sigil');
    if (!r.chance(RULES.sigilChance)) return null;
    const doors = new Set(space.exits.map((e) => DE.key(e.cell.x, e.cell.y)));
    const items = new Set(loot(space).map((it) => DE.key(it.cell.x, it.cell.y)));
    const ws = waystone(space);
    if (ws) items.add(DE.key(ws.cell.x, ws.cell.y));
    const free = space.cells.slice().sort().filter((k) => !doors.has(k) && !items.has(k));
    if (!free.length) return null;
    return { cell: DE.parseKey(free[Math.floor(r.next() * free.length)]), seed: DE.hash(space.seed, 'sigil') };
  }

  /**
   * An entropy well in this space, if it has one: { cell, kind: 'surge' |
   * 'trickle' }. Seeded on its own stream; never on a door, item, sigil or
   * waystone cell, and blocks keep off it.
   */
  function well(space) {
    if (!space.parentId || space.depth < RULES.wellMinDepth || space.cells.length < 4) return null;
    const r = DE.deriveRng(space.seed, 'well');
    if (!r.chance(RULES.wellChance)) return null;
    const kind = r.chance(RULES.wellSurge) ? 'surge' : 'trickle';
    const avoid = new Set(space.exits.map((e) => DE.key(e.cell.x, e.cell.y)));
    for (const it of loot(space)) avoid.add(DE.key(it.cell.x, it.cell.y));
    const sg = sigil(space), ws = waystone(space);
    if (sg) avoid.add(DE.key(sg.cell.x, sg.cell.y));
    if (ws) avoid.add(DE.key(ws.cell.x, ws.cell.y));
    const free = space.cells.slice().sort().filter((k) => !avoid.has(k));
    if (!free.length) return null;
    return { cell: DE.parseKey(free[Math.floor(r.next() * free.length)]), kind };
  }

  /**
   * Props in a space, on a 2x2 subgrid per cell (half-cell units), in
   * absolute grid units:
   *   blocks:  [{ x0, y0, x1, y1, units }]   solid; `units` stacked half-cell
   *            cubes tall (3 = floor to ceiling, a column). Collide, cast
   *            shadows, and (below a column) can be climbed.
   *   details: [{ x0, y0, x1, y1, h, shade }]   flat floor dressing only
   *
   * Shapes: single (1 sub), double (2x1), big (2x2), and in chambers short
   * rows of singles (partitions, sometimes with a gap). Anything may sit
   * against a wall, but nothing goes on a cell with a door or an item.
   * Each placement is kept only if every free sub-cell stays reachable
   * (4-neighbour flood fill), so a 0.5-cell gap is always a real passage.
   * Draws per attempt are fixed, so rerolling a room never shifts another.
   *
   * The layout only ever sees the room's original doors. Doors added later
   * (drawn with chalk, or made by a loop) can't reshuffle it: they just
   * clear any block on their own cell. Removing a block can never trap
   * anyone, while a reshuffle could drop a block onto the figure.
   */
  function props(space) {
    const r = DE.deriveRng(space.seed, 'props');
    const later = (e) => e.loopMade || (e.tags && e.tags.includes('carved'));
    const doorCells = new Set(space.exits.filter((e) => !later(e)).map((e) => DE.key(e.cell.x, e.cell.y)));
    const laterCells = space.exits.filter(later).map((e) => e.cell);
    const lootCells = new Set(loot(space).map((it) => DE.key(it.cell.x, it.cell.y)));
    const sg = sigil(space); // keep a sigil tile clear of blocks
    if (sg) lootCells.add(DE.key(sg.cell.x, sg.cell.y));
    const wl = well(space); // and a well's
    if (wl) lootCells.add(DE.key(wl.cell.x, wl.cell.y));
    const ws = waystone(space); // and the waystone's cell, where you wake
    if (ws) lootCells.add(DE.key(ws.cell.x, ws.cell.y));
    const chamber = (space.archetype === 'chamber' || space.archetype === 'hall') && !space.deadEnd;
    const subs = new Set(), reserved = new Set(), blocked = new Set();
    const sk = (x, y) => x + ',' + y;
    for (const k of space.cells) {
      const c = DE.parseKey(k);
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
        const s = sk(c.x * 2 + i, c.y * 2 + j);
        subs.add(s);
        if (doorCells.has(k) || lootCells.has(k)) reserved.add(s);
      }
    }
    const subList = Array.from(subs).sort();
    const start = subList.find((s) => reserved.has(s)) || subList[0];

    const allReachable = () => {
      const seen = new Set([start]);
      const q = [start];
      while (q.length) {
        const [x, y] = q.pop().split(',').map(Number);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = sk(x + dx, y + dy);
          if (subs.has(n) && !blocked.has(n) && !seen.has(n)) { seen.add(n); q.push(n); }
        }
      }
      return seen.size === subs.size - blocked.size;
    };

    const blocks = [];
    const attempts = Math.max(1, Math.round(space.cells.length * (chamber ? RULES.propAttempts : RULES.propAttemptsCorridor)));
    for (let a = 0; a < attempts; a++) {
      // Fixed draws per attempt.
      const kindRoll = r.next(), hRoll = r.next(), pick = r.next(), dirRoll = r.next(), lenRoll = r.next(), gapRoll = r.next();
      const [ax, ay] = subList[Math.floor(pick * subList.length)].split(',').map(Number);
      const horiz = dirRoll < 0.5;
      const kind = !chamber ? 'single'
        : kindRoll < 0.3 ? 'single' : kindRoll < 0.48 ? 'double' : kindRoll < 0.78 ? 'big' : 'row';
      let units = hRoll < 0.55 ? 1 : hRoll < 0.85 ? 2 : 3;
      let shape;
      if (kind === 'single') shape = [[0, 0]];
      else if (kind === 'double') shape = horiz ? [[0, 0], [1, 0]] : [[0, 0], [0, 1]];
      else if (kind === 'big') shape = [[0, 0], [1, 0], [0, 1], [1, 1]];
      else {
        units = hRoll < 0.6 ? 1 : 2;
        const len = 3 + Math.floor(lenRoll * 4);
        const gap = gapRoll < 0.4 ? 1 + Math.floor((gapRoll / 0.4) * (len - 2)) : -1;
        shape = [];
        for (let i = 0; i < len; i++) if (i !== gap) shape.push(horiz ? [i, 0] : [0, i]);
      }
      const cells = shape.map(([dx, dy]) => sk(ax + dx, ay + dy));
      if (cells.some((s) => !subs.has(s) || blocked.has(s) || reserved.has(s))) continue;
      cells.forEach((s) => blocked.add(s));
      if (!allReachable()) { cells.forEach((s) => blocked.delete(s)); continue; }
      const rect = (list) => {
        const xs = list.map((s) => +s.split(',')[0]), ys = list.map((s) => +s.split(',')[1]);
        return { x0: Math.min(...xs) / 2, y0: Math.min(...ys) / 2, x1: (Math.max(...xs) + 1) / 2, y1: (Math.max(...ys) + 1) / 2, units };
      };
      // Rows stay modular (one cube per sub) so they read as built pieces.
      if (kind === 'row') cells.forEach((s) => blocks.push(rect([s])));
      else blocks.push(rect(cells));
    }

    // Clear blocks off cells that gained a door after the room was made.
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if (laterCells.some((c) => b.x0 < c.x + 1 && b.x1 > c.x && b.y0 < c.y + 1 && b.y1 > c.y)) blocks.splice(i, 1);
    }

    // Floor detail on its own stream, skipping blocked sub-cells.
    const d = DE.deriveRng(space.seed, 'detail');
    const details = [];
    for (const k of space.cells.slice().sort()) {
      const c = DE.parseKey(k);
      const n = d.next() < RULES.detailChance ? d.int(1, 3) : 0;
      for (let i = 0; i < 3; i++) {
        const u = d.next(), v = d.next(), dw = d.range(0.08, 0.3), dd = d.range(0.06, 0.22), sh = d.next();
        if (i >= n) continue;
        const x0 = c.x + 0.06 + u * (0.88 - dw), y0 = c.y + 0.06 + v * (0.88 - dd);
        if (blocked.has(sk(Math.floor((x0 + dw / 2) * 2), Math.floor((y0 + dd / 2) * 2)))) continue;
        details.push({ x0, y0, x1: x0 + dw, y1: y0 + dd, h: 0.012 + sh * 0.02, shade: sh });
      }
    }
    return { blocks, details };
  }

  /**
   * Does a hash ghost start in this space? Returns its cell, or null.
   * Seeded per space; a room's imprint is fixed once it exists (traces only
   * ever form where no live room stands), so this is stable for a space.
   */
  function ghostSpawn(space, exp) {
    if (!space.parentId) return null;
    const r = DE.deriveRng(space.seed, 'ghost');
    const roll = r.next(), pick = r.next();
    let cracked = 0;
    for (const k of space.cells) if (DE.imprintAt(exp, k).length) cracked++;
    const p = Math.min(RULES.ghostChanceMax, RULES.ghostChance +
      (cracked ? RULES.ghostImprintBase + RULES.ghostImprintBoost * cracked / space.cells.length : 0));
    if (roll >= p) return null;
    const cells = space.cells.slice().sort();
    return DE.parseKey(cells[Math.floor(pick * cells.length)]);
  }

  /** Does a pixie start in this space? Returns its cell, or null. */
  function pixieSpawn(space) {
    if (!space.parentId || space.depth < RULES.pixieMinDepth) return null;
    const r = DE.deriveRng(space.seed, 'pixie');
    const roll = r.next(), pick = r.next();
    if (roll >= RULES.pixieChance) return null;
    const cells = space.cells.slice().sort();
    return DE.parseKey(cells[Math.floor(pick * cells.length)]);
  }

  /** Does a shadow creeper start in this space? Returns its cell, or null. */
  function creeperSpawn(space) {
    if (!space.parentId || space.depth < RULES.creeperMinDepth) return null;
    const r = DE.deriveRng(space.seed, 'creeper');
    const roll = r.next(), pick = r.next();
    if (roll >= RULES.creeperChance) return null;
    const cells = space.cells.slice().sort();
    return DE.parseKey(cells[Math.floor(pick * cells.length)]);
  }

  /** Is this unresolved exit a locked door? Seeded per exit, never the entry. */
  function isLocked(space, exit) {
    return !exit.connectionId && lockedBySeed(space, exit);
  }

  /** Was this exit generated locked (whether or not it has been opened since)? */
  function lockedBySeed(space, exit) {
    if (exit.index === 0 && space.parentId) return false;
    if (exit.tags && exit.tags.includes('carved')) return false; // drawn doors are never locked
    if (space.depth < RULES.lockMinDepth) return false;
    const p = Math.min(RULES.lockChanceMax,
      RULES.lockChance + (space.depth - RULES.lockMinDepth) * RULES.lockChancePerDepth);
    return DE.deriveRng(space.seed, 'lock|' + exit.index).chance(p);
  }

  /**
   * Is this the first room past a locked door? Worked out from seeds alone
   * (the door it was opened through was generated locked), so any client
   * can tell, and replays agree.
   */
  function pastLock(exp, space) {
    const parent = space.parentId && exp.spaces[space.parentId];
    if (!parent) return false;
    const exit = parent.exits.find((e) => e.id === space.viaExitId);
    return !!exit && lockedBySeed(parent, exit);
  }

  /** The space a door opened into, if it is that space's way in from here. */
  function childThrough(exp, spaceId, exit) {
    if (!exit.connectionId) return null;
    const c = exp.connections[exit.connectionId];
    if (c.loop) return null;
    const other = c.a.spaceId === spaceId ? c.b : c.a;
    const sp = exp.spaces[other.spaceId];
    return sp && sp.parentId === spaceId && sp.viaExitId === exit.id ? sp : null;
  }

  /**
   * A push block out of place in this room, and the floor mark where it
   * belongs: [{ id, from: { sx, sy }, to: { sx, sy }, color }] in half-cell
   * units (one block fills one half-cell), or []. The two lie in one row or
   * column with a clear run between them and room to stand behind the
   * block, so one straight push puts it home. Seeded on its own stream;
   * never on a door, item or sigil cell or a prop, and the block never cuts
   * off any part of the floor.
   */
  function pushBlocks(space) {
    if (!space.parentId || space.deadEnd) return [];
    const hall = space.archetype === 'hall';
    if (!hall && space.depth < RULES.pushMinDepth) return [];
    const r = DE.deriveRng(space.seed, 'push');
    const want = hall ? RULES.hallPushBlocks : r.chance(RULES.pushChance) ? 1 : 0;
    if (!want) return [];
    const sk = (x, y) => x + ',' + y;
    const avoid = new Set(space.exits.map((e) => DE.key(e.cell.x, e.cell.y)));
    for (const it of loot(space)) avoid.add(DE.key(it.cell.x, it.cell.y));
    const sg = sigil(space);
    if (sg) avoid.add(DE.key(sg.cell.x, sg.cell.y));
    const wl = well(space);
    if (wl) avoid.add(DE.key(wl.cell.x, wl.cell.y));
    const ws = waystone(space);
    if (ws) avoid.add(DE.key(ws.cell.x, ws.cell.y));
    const blocked = new Set();
    for (const b of props(space).blocks) {
      for (let y = b.y0 * 2; y < b.y1 * 2; y++) for (let x = b.x0 * 2; x < b.x1 * 2; x++) blocked.add(sk(x, y));
    }
    const floor = new Set(), free = [];
    for (const k of space.cells) {
      const c = DE.parseKey(k);
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
        const s = sk(c.x * 2 + i, c.y * 2 + j);
        if (blocked.has(s)) continue;
        floor.add(s);
        if (!avoid.has(k)) free.push(s);
      }
    }
    free.sort();
    // Earlier blocks' starts and homes count as solid for later ones, and
    // their runs stay clear, so no block can get in another's way. (For
    // the first block both are empty, so single-block rooms are unchanged.)
    const solid = new Set(), taken = new Set();
    const connectedWithout = (s0) => { // is every floor half-cell still reachable with a block on s0?
      const start = Array.from(floor).find((s) => s !== s0 && !solid.has(s));
      const seen = new Set([start]), q = [start];
      while (q.length) {
        const [x, y] = q.pop().split(',').map(Number);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = sk(x + dx, y + dy);
          if (floor.has(n) && n !== s0 && !solid.has(n) && !seen.has(n)) { seen.add(n); q.push(n); }
        }
      }
      return seen.size === floor.size - 1 - solid.size;
    };
    const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const out = [];
    for (let n = 0; n < want; n++) {
      const pool = taken.size ? free.filter((s) => !taken.has(s)) : free;
      const poolSet = new Set(pool);
      for (let a = 0; a < 30 && pool.length; a++) {
        const [tx, ty] = pool[Math.floor(r.next() * pool.length)].split(',').map(Number);
        const [dx, dy] = DIRS4[Math.floor(r.next() * 4)];
        const dist = r.int(2, 4);
        const run = []; // target, the half-cells between, the block's start, and where you stand to push
        for (let i = 0; i <= dist + 1; i++) run.push(sk(tx - dx * i, ty - dy * i));
        if (!run.every((s, i) => (i <= dist ? poolSet.has(s) : floor.has(s) && !solid.has(s)))) continue;
        if (!connectedWithout(run[dist]) || !connectedWithout(run[0])) continue;
        const [fx, fy] = run[dist].split(',').map(Number);
        const colors = RULES.pushColors.filter((c) => !out.some((o) => o.color === c)); // a hall's blocks differ
        out.push({ id: 'push' + n, from: { sx: fx, sy: fy }, to: { sx: tx, sy: ty }, color: r.pick(colors) });
        solid.add(run[0]); solid.add(run[dist]);
        run.forEach((s) => taken.add(s));
        break;
      }
    }
    return out;
  }

  /**
   * Unlit sconces on this room's walls: [{ id, cell, facing }], the wall
   * edge of `cell` that faces out of the room. Seeded on its own stream,
   * from the walls the room was made with (doors added later by loops or
   * doorstones don't shift the choice; walk mode just leaves out a sconce
   * whose wall has since become a door).
   */
  function sconces(space) {
    if (!space.parentId || space.deadEnd) return [];
    const r = DE.deriveRng(space.seed, 'sconce');
    let n;
    if (space.archetype === 'hall') n = r.chance(RULES.hallSconceSecond) ? 2 : 1; // a setpiece always has one
    else if (space.depth < RULES.sconceMinDepth || !r.chance(RULES.sconceChance)) return [];
    else n = space.archetype === 'chamber' && r.chance(RULES.sconceSecond) ? 2 : 1;
    const own = new Set(space.cells);
    const later = (e) => e.loopMade || (e.tags && e.tags.includes('carved'));
    const doorEdges = new Set(space.exits.filter((e) => !later(e)).map((e) => e.cell.x + ',' + e.cell.y + ',' + e.facing));
    const walls = [];
    for (const k of space.cells.slice().sort()) {
      const c = DE.parseKey(k);
      for (const f of DE.FACINGS) {
        const nb = DE.step(c, f);
        // Not on south walls: the camera looks north, so it only ever sees their backs.
        if (f === 'S' || own.has(DE.key(nb.x, nb.y)) || doorEdges.has(c.x + ',' + c.y + ',' + f)) continue;
        walls.push({ cell: c, facing: f });
      }
    }
    const out = [];
    for (let i = 0; i < n && walls.length; i++) {
      const w = walls.splice(Math.floor(r.next() * walls.length), 1)[0];
      out.push({ id: 'sconce' + i, cell: w.cell, facing: w.facing });
    }
    return out;
  }

  /**
   * A room is committed (fixed) once a door out of it has ever been opened,
   * or a loop has opened a door into it. Until then it's provisional and can
   * be rerolled. Committing is for good: rerolling the room beyond doesn't
   * undo it. Derived from the expedition's history (space ids are never
   * reused), so it needs no saved state. The root is always committed.
   */
  const openedFrom = new WeakMap(); // exp -> { n: history length, ids: Set of spaces a door was opened from }
  function committed(exp, space) {
    if (!space.parentId || space.archetype === 'hall') return true; // halls hold from the moment you arrive
    let c = openedFrom.get(exp);
    if (!c || c.n !== exp.history.length) {
      c = { n: exp.history.length, ids: new Set() };
      for (const ev of exp.history) if (ev.type === 'commit') c.ids.add(ev.parentId);
      openedFrom.set(exp, c);
    }
    return c.ids.has(space.id) || space.exits.some((e) => e !== space.exits[0] && e.connectionId);
  }

  /** The provisional room through this door, if closing it would reroll one. */
  function rerollThrough(exp, spaceId, exit) {
    const child = childThrough(exp, spaceId, exit);
    return child && !committed(exp, child) ? child : null;
  }

  /** Every space at or beyond `spaceId` in the generation tree, deepest first. */
  function branch(exp, spaceId) {
    const kids = {};
    for (const id in exp.spaces) {
      const p = exp.spaces[id].parentId;
      if (p) (kids[p] = kids[p] || []).push(id);
    }
    const out = [];
    const walk = (id) => { out.push(exp.spaces[id]); (kids[id] || []).forEach(walk); };
    walk(spaceId);
    return out.sort((a, b) => b.depth - a.depth);
  }

  function collapseCost(spaces) {
    const cells = spaces.reduce((n, s) => n + s.cells.length, 0);
    // Flat: one charge per room in the branch, whatever its size.
    const charges = spaces.length * RULES.chargesPerRoom;
    return { rooms: spaces.length, cells, cost: charges, charges };
  }

  /** Revert a whole branch, deepest first. History records each revert. */
  function collapse(exp, spaceId) {
    const spaces = branch(exp, spaceId);
    for (const s of spaces) DE.revert(exp, s.id);
    return spaces;
  }

  /**
   * A hall's waystone: { cell, x0, y0, x1, y1, wake: { x, y, angle } }. A
   * slab standing in the middle of the floor cell nearest the hall's centre
   * (never a door's), facing the camera. `wake` is where you stand when you
   * travel to it or wake there. Halls only.
   */
  function waystone(space) {
    if (space.archetype !== 'hall') return null;
    const doors = new Set(space.exits.map((e) => DE.key(e.cell.x, e.cell.y)));
    const c0 = centerOf(space);
    let best = null, bd = Infinity;
    for (const k of space.cells) {
      const c = DE.parseKey(k);
      if (doors.has(k)) continue;
      const d = Math.hypot(c.x + 0.5 - c0.x, c.y + 0.5 - c0.y);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) return null;
    return {
      cell: best, x0: best.x + 0.31, y0: best.y + 0.4, x1: best.x + 0.69, y1: best.y + 0.58,
      wake: { x: best.x + 0.5, y: best.y + 0.88, angle: Math.PI },
    };
  }

  /** The middle of a space's cells, as a grid point. */
  function centerOf(space) {
    const cells = space.cells.map(DE.parseKey);
    return {
      x: cells.reduce((a, c) => a + c.x + 0.5, 0) / cells.length,
      y: cells.reduce((a, c) => a + c.y + 0.5, 0) / cells.length,
    };
  }

  /**
   * The next set of waypoints, revealed from `from` (a grid point): hall
   * footprints, each with a free ring around it, ready for DE.reserve().
   * With no `count`, the starting set (two near, one far, all round the
   * root). With a `count` (a waystone waking), that many, near and far by
   * turns, fanned out past `from`. Seeded by the root seed and the number
   * of reserves so far. The pin (where the "?" goes on the map) sits in or
   * around the footprint, not at its centre.
   */
  function waypointSet(exp, from, count) {
    const r = DE.deriveRng(exp.rootSeed, 'waypoints|' + (exp.counters.reserve || 0));
    const deg = Math.PI / 180;
    let plan;
    if (count == null) {
      const base = r.range(0, Math.PI * 2);
      plan = [['near', base], ['near', base + 120 * deg], ['far', base + 240 * deg]];
    } else {
      const outward = Math.hypot(from.x, from.y) > 4 ? Math.atan2(from.y, from.x) : r.range(0, Math.PI * 2);
      const fan = [0, -1, 1].map((k) => outward + k * r.range(40, 75) * deg);
      plan = ['near', 'far', 'near'].slice(0, count).map((tier, i) => [tier, fan[i] + r.range(-20, 20) * deg]);
    }
    const taken = new Set();
    const free = (k) => exp.registry[k] === undefined && !DE.reservedAt(exp, k) && !taken.has(k);
    const set = [];
    for (const [tier, angle] of plan) {
      const [lo, hi] = tier === 'near' ? RULES.waypointNear : RULES.waypointFar;
      for (let a = 0; a < 24; a++) {
        const h = DE.hallCells(r, RULES.hallMin, RULES.hallMax);
        const ang = angle + r.range(-25, 25) * deg, dist = r.range(lo, hi);
        const ox = Math.round(from.x + Math.cos(ang) * dist - h.w / 2), oy = Math.round(from.y + Math.sin(ang) * dist - h.d / 2);
        const ok = h.cells.every((c) => {
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!free(DE.key(c.x + ox + dx, c.y + oy + dy))) return false;
          return true;
        });
        if (!ok) continue;
        const cells = h.cells.map((c) => DE.key(c.x + ox, c.y + oy));
        cells.forEach((k) => taken.add(k));
        const j = RULES.waypointPinJitter;
        const pin = { x: +(ox + h.w / 2 + r.range(-j, j)).toFixed(2), y: +(oy + h.d / 2 + r.range(-j, j)).toFixed(2) };
        set.push({ seed: DE.hash(exp.rootSeed, 'hall', ox, oy), kind: 'hall', tier, cells, pin });
        break;
      }
    }
    return set;
  }

  /**
   * How many waypoints waking this hall's waystone reveals (RULES.waypointOdds),
   * seeded by the hall. Never 0 while no waypoint is left waiting.
   */
  function waypointCount(exp, space) {
    const roll = DE.deriveRng(space.seed, 'waypoints').next();
    let n = 0, acc = 0;
    RULES.waypointOdds.forEach((p, i) => { if (roll >= acc) n = i; acc += p; });
    const waiting = Object.values(exp.reserves || {}).some((r) => !r.spaceId && r.pin);
    return n === 0 && !waiting ? 1 : n;
  }

  /** Root-to-space seed chain, for the level-complete screen. */
  function seedChain(exp, spaceId) {
    return DE.pathToRoot(exp, spaceId).reverse().map((id) => {
      const s = exp.spaces[id];
      const parent = s.parentId && exp.spaces[s.parentId];
      const exit = parent && parent.exits.find((e) => e.id === s.viaExitId);
      return {
        id, seed: s.seed, depth: s.depth, archetype: s.deadEnd ? 'dead end' : s.archetype,
        mood: s.meta.mood,
        parentSeed: parent ? parent.seed : null, exitIndex: exit ? exit.index : null, entropy: s.entropy,
      };
    });
  }

  Object.assign(DP, { RULES, loot, sigil, well, props, ghostSpawn, pixieSpawn, creeperSpawn, isLocked, lockedBySeed, pastLock, childThrough, committed, rerollThrough, pushBlocks, sconces, waystone, centerOf, waypointSet, waypointCount, branch, collapseCost, collapse, seedChain });
})(typeof window !== 'undefined' ? window : globalThis);
