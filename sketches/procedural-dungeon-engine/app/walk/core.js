// Walk mode: a third-person 3D client of the engine (see PLAY.md).
//
// Every unresolved exit is a closed door. Pushing one open calls expand +
// commit straight away, and the new space assembles itself outward from the
// threshold. Standing at a door you opened, you can spend entropy charges to close
// it and collapse everything beyond (engine reverts); reopening it rerolls.
// Game rules (loot, locks, costs) live in play-rules.js.
//
// Logic runs in grid units (1 = one cell, y = grid y); rendering scales by S
// into three.js world space, with grid y mapped to world z. Shares the map
// view's autosave, so both pages are the same expedition.
//
// Walk mode is split into classic scripts (no modules: the page has to open
// from file://), which play.html loads in this order:
//
//   saves, core, world, figure, items, restore, waystones, lamp, actions,
//   input, ecology, wells, pixies, ghosts, fx, hud, game, main
//
// (saves.js is the odd one out: it knows nothing of W, and hangs its save
// slots on DungeonPlay.saves, so it can move to another client.)
//
// Each file is its own IIFE sharing one namespace, DungeonPlay.walk ("W").
// A file takes what it needs from earlier files by destructuring W at the
// top, and hands what other files use to W at the bottom. A call into a
// later file goes through W at call time (W.showCaption(...)), because that
// file hasn't loaded yet when this one runs.
//
// This file: tunables, the three.js renderer, scene and camera, the run
// state, and saving (the slots themselves are in saves.js).
(function (global) {
  'use strict';

  const W = (global.DungeonPlay.walk = {});

  const DE = global.DungeonEngine;
  const DP = global.DungeonPlay;
  const RULES = DP.RULES;
  const THREE = global.THREE;
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = 'dungeon-engine:expedition'; // the record, for the chart view
  const PLAYER_KEY = 'dungeon-engine:player';       // the run, before save slots (read once, see game.js)
  const SAVES = DP.saves;

  // Tunables, in cells unless noted. PLAY.md has the reasoning.
  const S = 2;              // world units per cell
  const WALL_H = 1.3;
  const WALL_T = 0.08;
  const DOOR_W = 0.6;
  const DOOR_H = 1.0;
  const JAMB = (1 - DOOR_W) / 2;
  const RADIUS = 0.2;
  const SPEED = 2.4;
  const RUN = 4.0;
  const CROUCH_SPEED = 1.1; // a crawl
  const CROUCH_SCALE = 0.55; // figure height when crouched (standing is ~0.64 cells tall)
  const HIDE_RANGE = 0.2;
  const UNIT = RULES.blockUnit; // one stacked block unit, in cells
  const CLIMB_TIME = 0.42;      // seconds to step up onto a block
  const GRAVITY = 9;            // cells/s^2 when stepping off an edge   // cells between the figure and a block to count as hidden
  const PUSH_TIME = 0.35;   // seconds of walking into a door to open it
  const USE_RANGE = 0.6;    // E / tap reach to a door's midpoint
  const PICKUP_RANGE = 0.42;
  const DOOR_SWING = 0.6;   // seconds
  const SWING_ANGLE = THREE.MathUtils.degToRad(92);
  const REVEAL_STEP = 0.07; // seconds of delay per cell from the door
  const REVEAL_DUR = 0.45;
  const DISSOLVE_DUR = 0.7;
  const DITHER_RADIUS = 0.27; // fraction of the shorter screen side
  const DITHER_APPROACH = 2.5; // cells: south walls start a light dither this close
  const CAM_OFFSET = new THREE.Vector3(0, 10.5, 7.5);
  const SEAM = 0xc4502a;    // the map view's open-doorway orange
  const LOCK_SEAM = 0x6fa8d8;
  const OPEN_SEAM = 0x5fbf7a; // opened doorways (the arrow), as on the maps
  const BG = 0x07060a;
  const LANTERN = 16;       // point-light intensity (three.js physical units)
  const LANTERN_RANGE = 13 * S;

  const OPP = DE.OPPOSITE;
  const ekey = (x, y, f) => x + ',' + y + ',' + f;

  // ---------------------------------------------------------------------------
  // three.js scaffolding

  const canvas = $('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.Fog(BG, 13, 28);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  // Barely any ambient: what the lantern can't reach stays dark.
  scene.add(new THREE.AmbientLight(0x8a90b8, 0.06));

  // ---------------------------------------------------------------------------
  // State

  const state = {
    exp: null,
    exitAt: new Map(),   // "x,y,f" -> { spaceId, exit }
    spaces: new Map(),   // spaceId -> { group, edges[], tiles[], revealStart|null }
    dying: [],           // collapsed space records still dissolving
    doors: new Map(),    // "spaceId/exitId" -> door
    items: new Map(),    // "spaceId:seed:itemId" -> { mesh, item, spaceId, tile }
    blockAt: new Map(),  // "x,y" -> [{ x0, y0, x1, y1, h, spaceId }] for collision
    player: { x: 0.5, y: 0.5, z: 0, vz: 0, angle: 0, spaceId: null, phase: 0 },
    climb: null,         // { fx, fy, fz, tx, ty, tz, t } while stepping up
    ghosts: [],          // live hash ghosts (see ghosts.js)
    ghostTouch: false,   // in a ghost's reach this frame (drains psychic stamina)
    pixies: [],          // free pixies (see pixies.js)
    wells: [],           // entropy wells in built rooms (see wells.js)
    jars: [],            // jars standing in the world (see "Inventory")
    sigils: new Map(),   // spaceId -> { cell, mat, stage } for built rooms
    buff: 0,             // powered sigils: +1 entropy max each
    buffReady: false,    // false until the first sigil pass (no caption on load)
    sel: null,           // the selected hotbar slot's key
    variant: {},         // per group slot: the variant in use (e.g. chalk colour)
    expanded: null,      // the group slot whose picker is open
    marks: [],           // chalk marks drawn in the world
    fx: { wobble: 0, glitch: 0, flash: 0, touching: false, heldNear: -9, heldTouch: -9 }, // screen effects, 0..1
    run: null,           // inventory + run stats, see freshRun()
    push: { key: null, t: 0 },
    hold: { sig: null, t: 0, spent: false }, // holding E on a hold action (actions.js)
    pushBlocks: [],      // push blocks in built rooms (see restore.js)
    carry: null,         // the push block in your hands (restore.js)
    grab: null,          // the push block you have hold of, E held: { block, dir, off, moved } (restore.js)
    sconces: [],         // sconces in built rooms (see restore.js)
    waystones: [],       // waystones in built halls (see waystones.js)
    gutter: null,        // { t } while the lamp is guttering out
    lampGrace: 0,        // seconds the lamp holds its burn after a gain
    time: 0,
    minimap: true,
    bigmap: null,        // { cx, cy, px } while the enlarged map is open
    crouch: false,
    crouchAmt: 0,        // 0 standing .. 1 crouched, eased
    hidden: false,
    paused: false,
    menu: null,          // 'title' | 'pause' while a menu is up (see game.js)
    recordMode: null,    // 'checkpoint' | 'extracted' while the record screen is up
  };
  const world = new THREE.Group();
  scene.add(world);

  function freshRun(rootSeed) {
    return {
      rootSeed, fuel: RULES.chargesStart, keys: 0, // fuel: entropy, in charges (see lamp.js)
      shardsFound: 0, keysFound: 0, keysUsed: 0, chalk: 0, chalkFound: 0, chalkUsed: 0,
      collapses: 0, roomsCollapsed: 0, chargesSpent: 0,
      walked: 0, collected: [], unlocked: [], extracted: null,
      closed: [],    // connection ids of opened doors you've shut again
      carry: null,   // the push block or crate in your hands (its run.objects key), or null
      keyRooms: [],  // "spaceId:seed" of rooms whose key showed up (locks first, keys later)
      unmade: { count: 0, log: [] }, // hash ghosts undone by a collapse (or in a jar that shattered); no use yet
      ghostSeen: [], // "spaceId:seed:ghost" for rooms whose ghost roll has happened
      ghosts: [],    // saved positions: [{ id, x, y, mode }]
      stamina: 1,    // psychic stamina, 0..1 (see lamp.js)
      lampOn: true,  // false while covered or out (R relights it)
      ley: null,     // ley lines made so far: [["spaceId:seed", "spaceId:seed"]] (null: not yet built, see waystones.js)
      pixieSeen: [], // "spaceId:seed:pixie" for rooms whose pixie roll has happened
      pixies: [],    // free pixies' saved positions: [{ id, x, y }]
      wells: {},     // entropy wells drawn on: { "spaceId:seed:well": { level, drawn } } (see wells.js)
      jars: [],      // jars carried: [{ id, holds }] (holds: null, 'pixie' or 'entropy', one charge)
      placedJars: [], // jars set down: [{ id, sx, sy, holds }] (half-cell coordinates)
      jarSeq: 0,
      chalks: { silver: 3 }, // chalk carried, by colour, in strokes (3 per stick)
      marks: [],             // chalk marks drawn: [{ sx, sy, color, rot, base }] (quarter-tiles)
      doorstones: 0,         // open a door in a bare wall
      objects: {},           // loose objects (crates, push blocks), run-wide: { "spaceId:seed:id": { kind, sx, sy, ... } } (restore.js)
      despawned: [],         // objects that went with a rerolled room: [{ key, kind, color, room, at }], for later use
      lit: {},               // sconces lit: { "spaceId:seed:id": true }
      waystones: {},         // waystones woken: { "spaceId:seed": true } (the starter's is always awake)
      hearth: null,          // "spaceId:seed" of the waystone you last woke or used: where you wake
      surfaced: false,       // went up the surface door (the record shows until you go back down)
      faints: 0,             // faints that cost rooms (see game.js)
      roomsLost: 0,          // rooms lost to them
      retraces: 0,           // lost paths retraced
      pathsLetGo: 0,         // lost paths let go
      thread: false,         // found the thread: lost paths can be retraced (kept through faints)
    };
  }

  function rebuildExitIndex() {
    state.exitAt.clear();
    for (const id in state.exp.spaces) {
      for (const ex of state.exp.spaces[id].exits) {
        state.exitAt.set(ekey(ex.cell.x, ex.cell.y, ex.facing), { spaceId: id, exit: ex });
      }
    }
  }

  /** Locked and not yet unlocked by this run (unlocked doors are checkpoints). */
  function isLockedNow(space, ex) {
    return !ex.connectionId && DP.isLocked(space, ex) && !state.run.unlocked.includes(space.id + '/' + ex.id);
  }

  /** An opened door (a connection) you've shut again: solid until you open it. */
  function isClosed(connectionId) {
    return !!connectionId && !!state.run.closed && state.run.closed.includes(connectionId);
  }

  function ownsDoorPanel(spaceId, ex) {
    if (!ex.connectionId) return true;
    const c = state.exp.connections[ex.connectionId];
    return c.a.spaceId === spaceId && c.a.exitId === ex.id;
  }

  const CHALK = {
    silver: { css: '#d6dbe2', hex: 0xd6dbe2, sym: '↑', name: 'arrow' },
    gold: { css: '#ecc35c', hex: 0xecc35c, sym: '△', name: 'triangle' },
    crimson: { css: '#e86060', hex: 0xe86060, sym: '✕', name: 'cross' },
    teal: { css: '#57cdbf', hex: 0x57cdbf, sym: '≈', name: 'waves' },
    violet: { css: '#ba95ff', hex: 0xba95ff, sym: '☾', name: 'crescent' },
  };

  const chargeText = (n) => {
    const v = Math.round(n * 10) / 10;
    return `${v} charge${v === 1 ? '' : 's'}`;
  };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---------------------------------------------------------------------------
  // Persistence: the record for the chart view, and the save slots (saves.js)

  /** The record for the chart view (it only reads it now; walk mode's saves are the slots). */
  function save() {
    if (!state.exp) return;
    try { localStorage.setItem(STORAGE_KEY, DE.exportRecord(state.exp)); } catch (e) { /* storage unavailable */ }
  }
  /** A snapshot of the game as it stands (live objects: write it straight away). */
  function snapshot() {
    const p = state.player;
    state.run.marks = state.marks.map((m) => ({ sx: m.sx, sy: m.sy, color: m.color, rot: m.rot, base: m.base }));
    state.run.placedJars = state.jars.map((j) => ({ id: j.id, sx: j.sx, sy: j.sy, holds: j.holds }));
    state.run.ghosts = state.ghosts.map((g) => ({ id: g.id, x: +g.x.toFixed(3), y: +g.y.toFixed(3), mode: g.mode }));
    state.run.pixies = state.pixies.map((o) => ({ id: o.id, x: +o.x.toFixed(3), y: +o.y.toFixed(3) }));
    return SAVES.make({ record: state.exp, run: state.run, player: { x: p.x, y: p.y, angle: p.angle }, runVersion: RUN_VERSION });
  }
  /** The resume slot (every second, on pagehide, on quitting to the menu). */
  function savePlayer() {
    if (!state.exp || state.menu === 'title') return;
    SAVES.write('resume', snapshot());
  }
  /** The checkpoint slot: progress, written when you use a waystone. */
  function saveCheckpoint() {
    if (!state.exp) return;
    const snap = snapshot();
    SAVES.write('checkpoint', snap);
    SAVES.write('resume', snap);
  }

  // The old run save's format versions, for bringing a save from before
  // save slots over (game.js). Saves are stamped with DP.saves.BUILD now:
  // when `run` changes shape, bump that instead of adding a step here.
  // Saves from before versioning count as version 0.
  const RUN_VERSION = 5;
  const RUN_MIGRATIONS = [
    // 0 -> 1: door chalk became doorstones; map pins and echoes are gone.
    (run) => {
      if (typeof run.chalk === 'number' && run.chalk > 0) { run.doorstones = (run.doorstones || 0) + run.chalk; run.chalk = 0; }
      delete run.pins;
      delete run.echoes;
    },
    // 1 -> 2: whole charges plus shards became one fluid amount of fuel.
    (run) => {
      run.fuel = (run.charges || 0) + (run.shards || 0) / RULES.shardsPerCharge;
      delete run.charges;
      delete run.shards;
    },
    // 2 -> 3: jars held up to three ghosts; now one pixie. Any filled jar
    // keeps a pixie, so a jar that powered a sigil still does.
    (run) => {
      for (const j of (run.jars || []).concat(run.placedJars || [])) j.fill = j.fill > 0 ? 1 : 0;
    },
    // 3 -> 4: a jar says what it holds (a pixie, or a charge of entropy
    // swiped from a well) instead of a pixie count.
    (run) => {
      for (const j of (run.jars || []).concat(run.placedJars || [])) {
        j.holds = j.fill > 0 ? 'pixie' : null;
        delete j.fill;
      }
    },
    // 4 -> 5: moved crates and push blocks (run.pushed, by room) become
    // run-wide loose objects. Their kind, colour and mark come back from
    // their room's generation when it's built (restore.js spawnObjects).
    (run) => {
      run.objects = Object.assign({}, run.pushed || {});
      delete run.pushed;
      run.despawned = run.despawned || [];
    },
  ];
  /** Bring a saved run up to RUN_VERSION, in place. */
  function migrateRun(run, version) {
    for (let v = version || 0; v < RUN_VERSION; v++) RUN_MIGRATIONS[v](run);
    return run;
  }

  Object.assign(W, { DE, DP, RULES, THREE, $, STORAGE_KEY, PLAYER_KEY, S, WALL_H, WALL_T,
    DOOR_W, DOOR_H, JAMB, RADIUS, SPEED, RUN, CROUCH_SPEED, CROUCH_SCALE, HIDE_RANGE, UNIT,
    CLIMB_TIME, GRAVITY, PUSH_TIME, USE_RANGE, PICKUP_RANGE, DOOR_SWING, SWING_ANGLE,
    REVEAL_STEP, REVEAL_DUR, DISSOLVE_DUR, DITHER_RADIUS, DITHER_APPROACH, CAM_OFFSET, SEAM,
    LOCK_SEAM, OPEN_SEAM, LANTERN, LANTERN_RANGE, OPP, ekey, canvas, renderer, scene, camera, state, world,
    freshRun, rebuildExitIndex, isLockedNow, isClosed, ownsDoorPanel, CHALK, chargeText, el, save, migrateRun,
    savePlayer, saveCheckpoint, snapshot, SAVES, RUN_VERSION });
})(window);
