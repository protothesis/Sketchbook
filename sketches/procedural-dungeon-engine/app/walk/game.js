// Walk mode: the loop around a run (GAME-DESIGN.md, section 17). The title
// screen, the pause menu, and what a faint costs. A faint moves you, it
// doesn't rewind: you wake at the save lantern you last saved at, every room
// opened since that save becomes a lost path (suspended, exactly as you left
// it), and what you carried stays where you fell (packs.js). Nothing you did
// is undone. At a lost path's door: retrace it (F with a charged hourglass
// in hand, for entropy and its pixie) or reroll it (E held: the door opens on
// something new, and the path turns to corruption). Your equipment (the
// hourglass) isn't in the pack: it stays with you. The save slots are in saves.js.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, RULES, $, STORAGE_KEY, PLAYER_KEY, SAVES, state, freshRun, migrateRun, save, savePlayer,
    saveCheckpoint, rebuildExitIndex, el, RUN_VERSION } = W;

  // ---------------------------------------------------------------------------
  // Lost paths
  //
  // A room lost to a faint is a trace tagged 'lost': quiet (no cracks, no
  // ghosts), waiting for your choice. Each later faint dims a path you
  // haven't chosen for ('lost-dim'), and the next fades it ('faded': gone,
  // no choice, no corruption). Letting a path go tags it 'corrupt', a loud
  // trace like a reroll's. Retracing restores its rooms (DE.restore).

  const PENDING = new Set(['lost', 'lost-dim']);
  const idNum = (id) => +id.slice(1);

  /**
   * The lost paths waiting for a choice: [{ root, traces (parents first),
   * door: { spaceId, exitId } | null, dim }]. A path is a lost room whose
   * parent wasn't lost with it, plus everything lost beyond it. Cached
   * until the history moves on.
   */
  let pathCache = { exp: null, n: -1, paths: [] };
  function lostPaths() {
    const exp = state.exp;
    if (pathCache.exp === exp && pathCache.n === exp.history.length) return pathCache.paths;
    const pending = Object.values(exp.traces || {}).filter((t) => PENDING.has(t.cause) && !exp.spaces[t.id]);
    const byId = new Map(pending.map((t) => [t.id, t]));
    const kids = new Map();
    for (const t of pending) if (byId.has(t.parentId)) kids.set(t.parentId, (kids.get(t.parentId) || []).concat(t));
    const paths = [];
    for (const root of pending) {
      if (byId.has(root.parentId)) continue;
      const traces = [];
      const walk = (t) => { traces.push(t); (kids.get(t.id) || []).forEach(walk); };
      walk(root);
      traces.sort((a, b) => a.depth - b.depth || b.revertedAt - a.revertedAt); // parents first
      const sp = exp.spaces[root.parentId];
      const ex = sp && sp.exits.find((e) => e.id === root.viaExitId);
      const door = ex && !ex.connectionId ? { spaceId: sp.id, exitId: ex.id } : null;
      paths.push({ root, traces, door, dim: root.cause === 'lost-dim' });
    }
    pathCache = { exp, n: exp.history.length, paths };
    return paths;
  }

  /**
   * The lost path waiting behind this unopened door, or null: its own door,
   * or any door that opens onto ground the path holds (DE.heldAt).
   */
  function lostPathAt(spaceId, exitId) {
    const own = lostPaths().find((p) => p.door && p.door.spaceId === spaceId && p.door.exitId === exitId);
    if (own) return own;
    const sp = state.exp.spaces[spaceId], ex = sp && sp.exits.find((e) => e.id === exitId);
    if (!ex || ex.connectionId || ex.kind === 'surface') return null;
    const b = DE.step(ex.cell, ex.facing), t = DE.heldAt(state.exp, DE.key(b.x, b.y));
    return (t && lostPaths().find((p) => p.traces.includes(t))) || null;
  }

  /** What retracing a path costs: a shard per room, at least a charge. */
  function retracePrice(path) {
    return Math.max(RULES.retraceMin, path.traces.length * RULES.retracePerRoom);
  }

  /**
   * Retrace a lost path: every room comes back as it was, parents first. A
   * room whose footprint is taken can't, and neither can anything beyond
   * it: those turn to corruption. Returns { back, gone } (room counts).
   */
  function retrace(path) {
    const exp = state.exp;
    const back = [], gone = [];
    for (const t of path.traces) {
      if (DE.restorable(exp, t.id)) { DE.restore(exp, t.id); back.push(t.id); } else gone.push(t.id);
    }
    DE.tagTraces(exp, gone, 'corrupt', false);
    rebuildExitIndex();
    for (const id of back) W.buildSpace(exp.spaces[id], true);
    // The path is back, but its door stays shut: a closed door like any
    // other (no lost-path shimmer), for you to open when you choose.
    const door = path.door && state.doors.get(path.door.spaceId + '/' + path.door.exitId);
    const ex = path.door && exp.spaces[path.door.spaceId] && exp.spaces[path.door.spaceId].exits.find((e) => e.id === path.door.exitId);
    if (ex && ex.connectionId && back.length) {
      const run = state.run;
      if (!run.closed) run.closed = [];
      if (!run.closed.includes(ex.connectionId)) run.closed.push(ex.connectionId);
      // A path of more than one room is held once retraced: its first room can't be rerolled.
      const first = path.traces.length > 1 && exp.spaces[path.root.id];
      if (first) (run.retraced = run.retraced || {})[first.id + ':' + first.seed] = true;
    }
    if (door && back.length) {
      door.dir = 0; door.t = 0;
      door.pivot.rotation.y = 0;
      door.seam.visible = true;
      door.seam.material = door.point.material = W.seamMat;
      door.shimmer.visible = false;
      door.panel.material = W.doorMat;
    }
    W.refreshArrows();
    save();
    return { back: back.length, gone: gone.length };
  }

  /** Open a lost path's door on something new: the whole path turns to corruption. */
  function letGo(path) {
    DE.tagTraces(state.exp, path.traces.map((t) => t.id), 'corrupt', false);
    state.run.pathsLetGo = (state.run.pathsLetGo || 0) + 1;
    W.prunePacks(); // a pack on the path goes with it
  }

  // ---------------------------------------------------------------------------
  // Faints

  /**
   * Pass out for good. Lost paths you never chose for dim, or fade. What you
   * carry is packed up where you fell (and an object in your hands is set
   * down there). Every room that wasn't standing at your last save becomes
   * part of a lost path (deepest and latest first), as it is: nothing in it,
   * and nothing in the run, goes back. Its creatures will roll again if you
   * retrace it. Returns { lost (rooms), pack }.
   */
  function faint() {
    const exp = state.exp, run = state.run;
    const pending = Object.values(exp.traces || {}).filter((t) => PENDING.has(t.cause) && !exp.spaces[t.id]);
    DE.tagTraces(exp, pending.filter((t) => t.cause === 'lost-dim').map((t) => t.id), 'faded', true);
    DE.tagTraces(exp, pending.filter((t) => t.cause === 'lost').map((t) => t.id), 'lost-dim', true);
    dropCarried();
    const pack = W.packUp();
    const cp = SAVES.read('checkpoint');
    const keep = cp.status === 'ok' && cp.snap.rootSeed === exp.rootSeed
      ? new Set(Object.keys(cp.snap.record.spaces)) : new Set(Object.keys(exp.spaces));
    const left = new Set(Object.keys(exp.spaces).filter((id) => !keep.has(id)));
    const lostIds = new Set(left);
    let lost = 0;
    while (left.size) {
      const leaf = Array.from(left).filter((id) => DE.canRevert(exp, id)).map((id) => exp.spaces[id])
        .sort((a, b) => b.depth - a.depth || idNum(b.id) - idNum(a.id))[0];
      if (!leaf) break; // can't happen: a lost room's children were all opened after it
      DE.revert(exp, leaf.id, 'lost', true);
      left.delete(leaf.id);
      lost++;
    }
    // A lost room's ghost, pixie and creeper rolls happen again when it comes back.
    const fresh = (k) => !lostIds.has(k.split(':')[0]);
    run.ghostSeen = run.ghostSeen.filter(fresh);
    run.pixieSeen = run.pixieSeen.filter(fresh);
    run.creeperSeen = run.creeperSeen.filter(fresh);
    if (run.closed) run.closed = run.closed.filter((id) => exp.connections[id]);
    W.prunePacks();
    if (lost) { run.faints = (run.faints || 0) + 1; run.roomsLost = (run.roomsLost || 0) + lost; }
    W.setExpedition(exp, { run, player: null });
    return { lost, pack };
  }

  /** A faint with something in your hands: it's set down where you fell (ahead if there's room, else underfoot). */
  function dropCarried() {
    const run = state.run;
    if (!run.carry) return;
    const o = run.objects[run.carry], p = state.player;
    if (o) {
      const spot = W.blockSpot(p);
      Object.assign(o, spot ? { sx: spot.sx, sy: spot.sy, lv: Math.round(spot.base / W.UNIT) } : { sx: Math.floor(p.x * 2), sy: Math.floor(p.y * 2), lv: 0 });
      delete o.ox; delete o.oy;
    }
    run.carry = null;
  }

  // ---------------------------------------------------------------------------
  // The title screen: Continue (the resume slot), New run, import / export

  const titleEl = $('title');
  const statusEl = $('title-status');
  const continueBtn = $('title-continue');
  const exportBtn = $('title-export');
  const fileEl = $('title-file');

  /**
   * A save from before save slots: the record the chart view shares, plus
   * the run key. Nothing in build 1 changes what those histories build, so
   * build 1 brings one over (once: it then lives in the slots).
   */
  /** A snapshot's run, brought up to RUN_VERSION (snapshots from before runVersion are version 3). */
  const snapRun = (snap) => migrateRun(JSON.parse(JSON.stringify(snap.run)), snap.runVersion || 3);

  function legacySave() {
    if (SAVES.BUILD !== 1) return null;
    try {
      const text = localStorage.getItem(STORAGE_KEY);
      const pl = JSON.parse(localStorage.getItem(PLAYER_KEY) || 'null');
      if (!text || !pl || !pl.run) return null;
      const record = JSON.parse(text);
      if (pl.rootSeed !== record.rootSeed) return null;
      const run = Object.assign(freshRun(record.rootSeed), migrateRun(pl.run, pl.v));
      return SAVES.make({ record, run, player: { x: pl.x, y: pl.y, angle: pl.angle || 0 }, runVersion: RUN_VERSION });
    } catch (e) { return null; }
  }

  function ago(iso) {
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (!(s >= 0)) return '';
    if (s < 90) return 'just now';
    if (s < 5400) return Math.round(s / 60) + ' minutes ago';
    if (s < 129600) return Math.round(s / 3600) + ' hours ago';
    return Math.round(s / 86400) + ' days ago';
  }

  function showTitle(message) {
    if (state.dialog) W.closeDialog();
    state.menu = 'title';
    state.paused = true;
    W.keys.clear();
    const r = SAVES.read('resume');
    statusEl.innerHTML = '';
    if (message) statusEl.append(el('span', 'title-note', message), document.createElement('br'));
    if (r.status === 'ok') {
      const s = r.snap;
      const rooms = Object.keys(s.record.spaces || {}).length;
      statusEl.append(`A run in progress: seed ${s.rootSeed} · ${rooms} room${rooms === 1 ? '' : 's'} charted · saved ${ago(s.savedAt)}.`);
    } else if (r.status === 'old') {
      statusEl.append(el('span', 'title-warn',
        `Your save is from an older build of the game (build ${r.snap.build}; this is build ${SAVES.BUILD}), so it can't be continued here. ` +
        'Export it to keep it, or start a new run.'));
    } else if (r.status === 'bad') {
      statusEl.append(el('span', 'title-warn', 'Your save couldn’t be read. Start a new run, or import a save file.'));
    } else {
      statusEl.append('No run in progress.');
    }
    continueBtn.hidden = r.status !== 'ok';
    exportBtn.hidden = !r.snap;
    titleEl.hidden = false;
    (r.status === 'ok' ? continueBtn : $('title-new')).focus();
  }

  function hideTitle() {
    state.menu = null;
    state.paused = false;
    titleEl.hidden = true;
  }

  /** Load a snapshot into the game. False (and the title says why) if it won't rebuild. */
  function loadSnapshot(snap) {
    let res;
    try { res = DE.importRecord(snap.record); } catch (e) { res = null; }
    if (!res || !res.verified) {
      showTitle('That save didn’t rebuild the same way, so it wasn’t loaded.');
      return false;
    }
    hideTitle();
    W.setExpedition(res.expedition, { run: snapRun(snap), player: snap.player });
    // A run needs a checkpoint to faint back to: its own, or here and now.
    const cp = SAVES.read('checkpoint');
    if (cp.status !== 'ok' || cp.snap.rootSeed !== snap.rootSeed) saveCheckpoint();
    return true;
  }

  function newRun(record) {
    hideTitle();
    if (record) {
      W.setExpedition(DE.importRecord(record).expedition, null);
      W.showCaption('a new run on an imported record · seed ' + state.exp.rootSeed);
    } else {
      W.newExpedition();
    }
    saveCheckpoint(); // the start is the first checkpoint
  }

  continueBtn.addEventListener('click', () => {
    const r = SAVES.read('resume');
    if (r.status === 'ok') loadSnapshot(r.snap);
    else showTitle();
  });
  $('title-new').addEventListener('click', () => {
    if (SAVES.read('resume').status !== 'ok') { newRun(); return; }
    W.openDialog({
      kicker: 'new run',
      title: 'Start a new run?',
      text: 'There is one run at a time: a new run replaces the one in progress, its map and its ' +
        'checkpoint, for good. Export it first if you want to keep it.',
      buttons: [
        { label: 'Replace it with a new run', primary: true, onClick: () => newRun() },
        { label: 'Export it first', onClick: () => exportBtn.click() },
        { label: 'Keep my run', quiet: true },
      ],
    });
  });
  exportBtn.addEventListener('click', () => {
    const r = SAVES.read('resume');
    const blob = new Blob([SAVES.exportFile()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dungeon-walk-${r.snap ? r.snap.rootSeed : 'save'}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('title-import').addEventListener('click', () => fileEl.click());
  fileEl.addEventListener('change', () => {
    const f = fileEl.files && fileEl.files[0];
    fileEl.value = '';
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const got = SAVES.parseFile(String(reader.result));
      if (got.status === 'ok') {
        SAVES.write('resume', got.resume);
        if (got.checkpoint) SAVES.write('checkpoint', got.checkpoint); else SAVES.clear('checkpoint');
        loadSnapshot(got.resume);
      } else if (got.status === 'record') {
        newRun(got.record);
      } else if (got.status === 'old') {
        showTitle(`That save is from another build of the game (build ${got.build}; this is build ${SAVES.BUILD}), so it can't be loaded.`);
      } else {
        showTitle('That file isn’t a save this game can read.');
      }
    };
    reader.readAsText(f);
  });

  // ---------------------------------------------------------------------------
  // The pause menu (Esc, or the Menu button). Quitting writes the resume
  // slot only: the checkpoint stays where your last save left it.

  function openPause() {
    if (state.paused || state.menu || !state.exp) return;
    savePlayer();
    W.openDialog({
      kicker: 'paused',
      title: 'Paused',
      text: `Seed ${state.exp.rootSeed}. Your run saves as you play. Save at a hall's lantern to choose where you wake. ` +
        'Faint, and the rooms opened since your last save are lost until you retrace them, and your pack stays where you fell.',
      buttons: [
        { label: 'Resume', primary: true },
        { label: 'Quit to main menu', onClick: quitToMenu },
      ],
    });
  }

  function quitToMenu() {
    savePlayer();
    showTitle();
  }

  $('menu-btn').addEventListener('click', (e) => { openPause(); e.currentTarget.blur(); });

  /** At boot: bring a save from before slots over, then show the title. */
  function boot() {
    if (SAVES.read('resume').status === 'none') {
      const legacy = legacySave();
      if (legacy) { SAVES.write('resume', legacy); SAVES.write('checkpoint', legacy); }
    }
    showTitle();
  }

  Object.assign(W, { faint, lostPaths, lostPathAt, retracePrice, retrace, letGo, showTitle, hideTitle, loadSnapshot, newRun, openPause, quitToMenu, bootGame: boot });
})(window);
