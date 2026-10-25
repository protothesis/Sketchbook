// Walk mode: save slots (NOTES.md, "Saves"). Knows nothing about the game
// beyond the shape of a snapshot, so it can move to another client as is:
//
//   Snapshot { format: 'dungeon-walk-save', build, savedAt, rootSeed,
//              record (the expedition, as plain data), run, player }
//   File     { format: 'dungeon-walk-savefile', build, savedAt, resume, checkpoint }
//
// Two slots. `resume` is written all the time (every second, on pagehide,
// on quitting to the menu): it's how closing the laptop and coming back
// works. `checkpoint` is progress: written when you use a waystone, and
// what a faint rolls back to.
//
// Every snapshot carries BUILD. A save from another build isn't loaded (the
// generator may have changed, and replaying its history would build a
// different dungeon); the title screen offers a new run instead. So bump
// BUILD whenever a change alters what a history builds, rather than gating
// the change behind params for old records. Within one build, replay is
// exact. A change to the shape of `run` alone doesn't need a new build: the
// snapshot carries `runVersion` (walk mode's RUN_VERSION, core.js), and an
// older run is migrated as it loads (snapshots without one are version 3).
//
// The backend is swappable (setBackend): anything with get / set / remove
// of strings by key. localStorage by default.
(function (global) {
  'use strict';

  const DP = (global.DungeonPlay = global.DungeonPlay || {});

  const BUILD = 1;
  const FORMAT = 'dungeon-walk-save';
  const FILE_FORMAT = 'dungeon-walk-savefile';
  const KEYS = { resume: 'dungeon-engine:save:resume', checkpoint: 'dungeon-engine:save:checkpoint' };

  const localBackend = {
    get: (k) => global.localStorage.getItem(k),
    set: (k, v) => global.localStorage.setItem(k, v),
    remove: (k) => global.localStorage.removeItem(k),
  };
  let backend = localBackend;
  function setBackend(b) { backend = b || localBackend; }

  /** A snapshot of { record, run, player }, stamped with this build. */
  function make(o) {
    return {
      format: FORMAT, build: BUILD, savedAt: new Date().toISOString(),
      rootSeed: o.record.rootSeed, record: o.record, run: o.run, player: o.player,
      runVersion: o.runVersion,
    };
  }

  // Serializing a big record every second is the expensive part, and it
  // only changes with its history, so its JSON is kept per slot.
  const recordCache = {};
  function recordJson(slot, record) {
    const sig = record.rootSeed + '|' + record.history.length;
    const c = recordCache[slot];
    if (c && c.record === record && c.sig === sig) return c.json;
    const json = JSON.stringify(record);
    recordCache[slot] = { record, sig, json };
    return json;
  }

  function serialize(slot, snap) {
    const rest = Object.assign({}, snap);
    delete rest.record;
    const head = JSON.stringify(rest);
    return head.slice(0, -1) + ',"record":' + recordJson(slot, snap.record) + '}';
  }

  /** Write a snapshot to a slot. Returns false if storage refused it. */
  function write(slot, snap) {
    try { backend.set(KEYS[slot], serialize(slot, snap)); return true; } catch (e) { return false; }
  }

  /**
   * Is this a snapshot we can load? 'ok', 'old' (another build: not
   * loaded), or 'bad' (not a save at all, or damaged).
   */
  function check(snap) {
    if (!snap || snap.format !== FORMAT || !snap.record || !snap.run || !snap.player) return 'bad';
    if (snap.build !== BUILD) return 'old';
    return 'ok';
  }

  /** A slot's snapshot and its status ('none' if empty). */
  function read(slot) {
    let text = null;
    try { text = backend.get(KEYS[slot]); } catch (e) { /* storage unavailable */ }
    if (!text) return { status: 'none', snap: null };
    let snap = null;
    try { snap = JSON.parse(text); } catch (e) { return { status: 'bad', snap: null }; }
    return { status: check(snap), snap };
  }

  function clear(slot) {
    delete recordCache[slot];
    try { backend.remove(KEYS[slot]); } catch (e) { /* storage unavailable */ }
  }

  /** Both slots as one save file (JSON text). */
  function exportFile() {
    const resume = read('resume'), checkpoint = read('checkpoint');
    return JSON.stringify({
      format: FILE_FORMAT, build: BUILD, savedAt: new Date().toISOString(),
      resume: resume.snap, checkpoint: checkpoint.snap,
    });
  }

  /**
   * Read a save file: { status, resume, checkpoint }. Takes a save file, a
   * single snapshot (used for both slots), or a bare expedition record
   * (status 'record': the caller starts a fresh run on it).
   */
  function parseFile(text) {
    let o;
    try { o = JSON.parse(text); } catch (e) { return { status: 'bad' }; }
    if (o && o.format === FILE_FORMAT) {
      const st = check(o.resume);
      if (st !== 'ok') return { status: st, build: o.resume && o.resume.build };
      return { status: 'ok', resume: o.resume, checkpoint: check(o.checkpoint) === 'ok' ? o.checkpoint : null };
    }
    if (o && o.format === FORMAT) {
      const st = check(o);
      return st === 'ok' ? { status: 'ok', resume: o, checkpoint: o } : { status: st, build: o.build };
    }
    if (o && o.version === 1 && o.rootSeed && Array.isArray(o.history)) return { status: 'record', record: o };
    return { status: 'bad' };
  }

  DP.saves = { BUILD, KEYS, setBackend, make, write, read, check, clear, exportFile, parseFile };
})(window);
