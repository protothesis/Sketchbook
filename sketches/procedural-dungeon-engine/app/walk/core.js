// Walk mode: a third-person 3D client of the engine (see PLAY.md).
//
// Every unresolved exit is a closed door. Pushing one open calls expand +
// commit straight away, and the new space assembles itself outward from the
// threshold. Standing at a door you opened, you can spend entropy charges to close
// it and collapse everything beyond (engine reverts); reopening it rerolls.
// Game rules (loot, locks, costs) live in engine/contents.js.
//
// Logic runs in grid units (1 = one cell, y = grid y); rendering scales by S
// into three.js world space, with grid y mapped to world z. Shares the map
// view's autosave, so both pages are the same expedition.
//
// Walk mode is split into classic scripts (no modules: the page has to open
// from file://), which play.html loads in this order:
//
//   saves, core, world, figure, light, items, hourglass, dust, restore, waystones, lanterns, packs, lamp, actions,
//   input, ecology, creatures, markers, wells, pixies, ghosts, creepers, fx, hud, choice, game, main, dev
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
  const PLAYER_KEY = 'dungeon-engine:player';       // the run, before save slots (no longer read)
  const SAVES = DP.saves;

  // Tunables, in cells unless noted. PLAY.md has the reasoning.
  const S = 2;              // world units per cell
  const WALL_H = 1.3;
  const WALL_T = 0.08;
  const DOOR_W = 0.6;
  const DOOR_H = 1.0;
  const JAMB = (1 - DOOR_W) / 2;
  const RADIUS = 0.2;
  // Moving about, read every frame (so the dev panel can tune it live).
  const PLAYER = {
    speed: 2.4,          // cells/s, walking
    run: 4.0,            // cells/s, running
    crouchSpeed: 1.1,    // cells/s: a crawl
    crouchScale: 0.55,   // figure height when crouched (standing is ~0.64 cells tall)
    hideRange: 0.2,      // cells: crouch this near a block taller than you and you hide
    gravity: 30,         // cells/s^2: falling, and rising once jump is let go
    useRange: 0.6,       // cells: E / tap reach to a door's midpoint
    pickupRange: 0.42,   // cells: walk this close to an item and you take it
    doorSwing: 0.6,      // seconds a door takes to swing open
  };
  const UNIT = RULES.blockUnit; // one stacked block unit, in cells
  // Jumping (figure.js): take-off speed (cells/s), gravity while jump is held
  // and you're still rising, the most rising speed left once it's let go, a
  // hop's take-off speed (a block in your hands, or a press let go before
  // you landed), and the forgiveness: seconds after walking off an edge you can still jump,
  // seconds a press waits for you to land, and cells a block's top can be
  // above your feet and still catch you. A quick, low arc: the peak comes
  // just after you clear a block's lip, so you come down on it. `foot`: you
  // stand on a block while this much of you (cells from your center) is
  // over it, so you step off once your body has cleared the edge. `ease`
  // (1/s): how fast the figure catches up when a lip lifts you, instead of
  // popping up.
  const JUMP = { v: 5.0, riseG: 20, cut: 0.5, hop: 2.2, coyote: 0.1, buffer: 0.12, ledge: 0.1, foot: 0.17, ease: 18 };
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
    jump: { held: false, buffer: 0, coyote: 0, hop: false, air: false, ground: 0, lift: 0 }, // see figure.js
    ghosts: [],          // live hash ghosts (see ghosts.js)
    ghostTouch: false,   // in a ghost's reach this frame (drains psychic stamina)
    pixies: [],          // free pixies (see pixies.js)
    creepers: [],        // shadow creepers (see creepers.js)
    creeperDrain: 0,     // 0..1: the nearest creeper's pull on your psychic stamina this frame
    wells: [],           // entropy wells in built rooms (see wells.js)
    sigils: new Map(),   // spaceId -> { cell, mat, stage } for built rooms
    buff: 0,             // powered sigils: +1 entropy max each
    buffReady: false,    // false until the first sigil pass (no caption on load)
    sel: 'hands',        // the carousel stop in your hand (items.js slots); 'hands' for empty hands (how you start)
    lastSel: null,       // the last slot you had in hand (B takes it out again)
    handColl: null,      // a collectable taken in hand from the menu: { grid: 'coll' | 'purse' | 'items', i } (items.js)
    marks: [],           // chalk marks drawn in the world
    fx: { wobble: 0, glitch: 0, flash: 0, touching: false, heldNear: -9, heldTouch: -9, // screen effects, 0..1
      levels: {},        // per effect profile (FX_PROFILES in fx.js): how strong it is right now
      bursts: {},        // per profile: a burst on top, decaying fast (fxBurst)
      faint: null },     // passing out and waking: { shatter, static, streakT, black, waking } (lamp.js)
    run: null,           // inventory + run stats, see freshRun()
    hold: { sig: null, t: 0, spent: false }, // holding E on a hold action (actions.js)
    pushBlocks: [],      // push blocks in built rooms (see restore.js)
    carry: null,         // the push block in your hands (restore.js)
    grab: null,          // the push block you have hold of, E held: { block, dir, off, moved } (restore.js)
    sconces: [],         // sconces in built rooms (see restore.js)
    waystones: [],       // waystones in built halls (see waystones.js)
    lanterns: [],        // save lanterns in built halls (see lanterns.js)
    choice: null,        // a choice up on screen, picked with A / D and confirmed with E held (choice.js)
    gutter: null,        // { phase, t, total } while you pass out (lamp.js)
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
      pixieSeen: [], // "spaceId:seed:pixie" for rooms whose pixie roll has happened
      pixies: [],    // free pixies' saved positions: [{ id, x, y }]
      creeperSeen: [], // "spaceId:seed:creeper" for rooms whose creeper roll has happened
      creepers: [],  // shadow creepers' saved positions: [{ id, x, y }]
      wells: {},     // entropy wells drawn on: { "spaceId:seed:well": { level, drawn } } (see wells.js)
      jars: [],      // jars carried: [{ id, holds }] (holds: null, 'pixie' or 'entropy', one charge)
      jarSeq: 0,
      chalks: { silver: 3 }, // chalk carried, by colour, in strokes (3 per stick)
      marks: [],             // chalk marks drawn: [{ sx, sy, color, rot, base }] (quarter-tiles)
      doorstones: 0,         // open a door in a bare wall
      objects: {},           // loose objects (crates, push blocks), run-wide: { "spaceId:seed:id": { kind, sx, sy, ... } } (restore.js)
      despawned: [],         // objects that went with a rerolled room: [{ key, kind, color, room, at }], for later use
      lit: {},               // sconces lit: { "spaceId:seed:id": true }
      waystones: {},         // halls whose fixed waystone was woken, before waystones were blocks: their stone starts powered
      stonePaid: {},         // halls whose scattered waystone has turned up: { "hallId:seed": object key } (packs.js, restore.js)
      lanterns: {},          // save lanterns saved at, ever: { "spaceId:seed": true } (the first save reveals waypoints)
      hearth: null,          // "spaceId:seed" of the hall whose lantern you last saved at: where you wake
      packs: [],             // what you carried when you fainted, where you fell (packs.js)
      retraced: {},          // first rooms of retraced paths of more than one room: { "spaceId:seed": true }; no rerolling them
      packSeq: 0,
      surfaced: false,       // went up the surface door (the record shows until you go back down)
      faints: 0,             // faints that cost rooms (see game.js)
      roomsLost: 0,          // rooms lost to them
      retraces: 0,           // lost paths retraced
      pathsLetGo: 0,         // lost paths let go
      equipment: {},         // gear: { hourglass: { holds }, purse: { cells }, backpack: {} }; only protected kinds stay through a faint (inventory.js)
      inv: { items: [], equip: [], coll: [] }, // the inventory's grids: where each stack sits, and the collectables (inventory.js)
      dropped: [],           // things you dropped, lying where you stood: [{ id, kind, n, ..., x, y, spaceId, seed }] (inventory.js)
      dropSeq: 0,
      dust: {},              // dust taken off: { "spaceId:seed": { "sx,sy,h": layers } } (dust.js)
      crust: {},             // swipes taken off crusted shards: { item key: n } (RULES.crustLayers wakes one)
      chits: [],             // entropy chits lying loose: [{ x, y, z, s: "spaceId:seed" }]
      dustPool: 0,           // chits gathered toward the next shard (DUST.perShard pours one)
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

  /**
   * The provisional room through this door, if closing it would reroll one
   * (DP.rerollThrough). Not the first room of a path you retraced that had
   * more than one room: that's ground you paid to bring back.
   */
  function rerollThrough(exp, spaceId, ex) {
    const child = DP.rerollThrough(exp, spaceId, ex);
    return child && !(state.run.retraced || {})[child.id + ':' + child.seed] ? child : null;
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
    state.run.ghosts = state.ghosts.map((g) => ({ id: g.id, x: +g.x.toFixed(3), y: +g.y.toFixed(3), mode: g.mode }));
    state.run.pixies = state.pixies.map((o) => ({ id: o.id, x: +o.x.toFixed(3), y: +o.y.toFixed(3) }));
    state.run.creepers = state.creepers.map((c) => ({ id: c.id, x: +c.x.toFixed(3), y: +c.y.toFixed(3) }));
    return SAVES.make({ record: state.exp, run: state.run, player: { x: p.x, y: p.y, angle: p.angle }, runVersion: RUN_VERSION });
  }
  /** The resume slot (every second, on pagehide, on quitting to the menu). */
  function savePlayer() {
    if (!state.exp || state.menu === 'title') return;
    SAVES.write('resume', snapshot());
  }
  /** The checkpoint slot: written when you save at a lantern. Where you wake, and which rooms stand. */
  function saveCheckpoint() {
    if (!state.exp) return;
    const snap = snapshot();
    SAVES.write('checkpoint', snap);
    SAVES.write('resume', snap);
  }

  // The run's format version, within one build. Saves are stamped with
  // DP.saves.BUILD too, and a save from another build isn't loaded at all,
  // so only changes to `run` made within a build need a step here: when
  // `run` changes shape, bump RUN_VERSION and add RUN_MIGRATIONS[old] (a
  // function that brings a run from version old to old + 1). The steps for
  // runs from before build 2 went with them (NOTES.md, "Versioning").
  const RUN_VERSION = 10;
  const RUN_MIGRATIONS = {};
  /** Bring a saved run up to RUN_VERSION, in place. */
  function migrateRun(run, version) {
    for (let v = version == null ? RUN_VERSION : version; v < RUN_VERSION; v++) if (RUN_MIGRATIONS[v]) RUN_MIGRATIONS[v](run);
    return run;
  }

  Object.assign(W, { DE, DP, RULES, THREE, $, STORAGE_KEY, PLAYER_KEY, S, WALL_H, WALL_T,
    DOOR_W, DOOR_H, JAMB, RADIUS, PLAYER, UNIT,
    JUMP, SWING_ANGLE,
    REVEAL_STEP, REVEAL_DUR, DISSOLVE_DUR, DITHER_RADIUS, DITHER_APPROACH, CAM_OFFSET, SEAM,
    LOCK_SEAM, OPEN_SEAM, LANTERN, LANTERN_RANGE, OPP, ekey, canvas, renderer, scene, camera, state, world,
    freshRun, rebuildExitIndex, isLockedNow, isClosed, rerollThrough, ownsDoorPanel, CHALK, chargeText, el, save, migrateRun,
    savePlayer, saveCheckpoint, snapshot, SAVES, RUN_VERSION });
})(window);
