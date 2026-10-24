// Walk mode: the loop around a run (GAME-DESIGN.md, section 17). The title
// screen, the pause menu, and what a faint costs: every room opened since
// your last waystone checkpoint collapses into traces, and the run rolls
// back to that checkpoint. A lost room can be charted again at its door
// (actions.js). The save slots themselves are in saves.js.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, $, STORAGE_KEY, PLAYER_KEY, SAVES, state, freshRun, migrateRun, savePlayer, saveCheckpoint,
    el } = W;

  // ---------------------------------------------------------------------------
  // Faints

  // Tallies that a faint doesn't roll back (the rest of the run does).
  const TALLIES = ['walked', 'gutters', 'collapses', 'roomsCollapsed', 'chargesSpent', 'travels', 'relights',
    'covers', 'lampBurned', 'unmade', 'faints', 'roomsLost', 'recharts', 'pixiesCaught', 'wellDrawn'];
  const idNum = (id) => +id.slice(1);

  /**
   * Pass out for good: every room that wasn't standing at the checkpoint
   * collapses (deepest and latest first, each a trace marked 'faint'), and
   * the run and the figure go back to the checkpoint's. Returns how many
   * rooms were lost. Without a checkpoint for this expedition, nothing is.
   */
  function faint() {
    const exp = state.exp, live = state.run;
    const cp = SAVES.read('checkpoint');
    if (cp.status !== 'ok' || cp.snap.rootSeed !== exp.rootSeed) return 0;
    const keep = new Set(Object.keys(cp.snap.record.spaces));
    const left = new Set(Object.keys(exp.spaces).filter((id) => !keep.has(id)));
    let lost = 0;
    while (left.size) {
      const leaf = Array.from(left).filter((id) => DE.canRevert(exp, id)).map((id) => exp.spaces[id])
        .sort((a, b) => b.depth - a.depth || idNum(b.id) - idNum(a.id))[0];
      if (!leaf) break; // can't happen: a lost room's children were all opened after it
      DE.revert(exp, leaf.id, 'faint');
      left.delete(leaf.id);
      lost++;
    }
    const run = Object.assign(freshRun(exp.rootSeed), cp.snap.run);
    for (const k of TALLIES) if (live[k] !== undefined) run[k] = live[k];
    if (lost) { run.faints = (run.faints || 0) + 1; run.roomsLost = (run.roomsLost || 0) + lost; }
    W.setExpedition(exp, { run, player: cp.snap.player });
    return lost;
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
  function legacySave() {
    if (SAVES.BUILD !== 1) return null;
    try {
      const text = localStorage.getItem(STORAGE_KEY);
      const pl = JSON.parse(localStorage.getItem(PLAYER_KEY) || 'null');
      if (!text || !pl || !pl.run) return null;
      const record = JSON.parse(text);
      if (pl.rootSeed !== record.rootSeed) return null;
      const run = Object.assign(freshRun(record.rootSeed), migrateRun(pl.run, pl.v));
      return SAVES.make({ record, run, player: { x: pl.x, y: pl.y, angle: pl.angle || 0 } });
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
    W.setExpedition(res.expedition, { run: snap.run, player: snap.player });
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
      text: 'Your run in progress will be replaced (export it first to keep it).',
      buttons: [
        { label: 'New run', primary: true, onClick: () => newRun() },
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
  // slot only: the checkpoint stays where your last waystone left it.

  function openPause() {
    if (state.paused || state.menu || !state.exp) return;
    savePlayer();
    W.openDialog({
      kicker: 'paused',
      title: 'Paused',
      text: `Seed ${state.exp.rootSeed}. Your run saves as you play; using a waystone is a checkpoint. ` +
        'Faint, and everything opened since your last checkpoint is lost.',
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

  Object.assign(W, { faint, showTitle, hideTitle, loadSnapshot, newRun, openPause, quitToMenu, bootGame: boot });
})(window);
