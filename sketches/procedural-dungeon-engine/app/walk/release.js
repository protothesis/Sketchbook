// Walk mode: release and accept (HANDS-PLAN.md, step 4). A full jar (or
// the hourglass) swung always empties: what's in it comes out at a point in
// front of you, and whatever is there that ACCEPTS that kind takes it. The
// jar doesn't know about vessels or waystones; each thing that takes
// something says so here, in ACCEPTS, in the order they're tried:
//
//   a lost path's door  takes the hourglass's pixie: the retrace
//   a dormant waystone  takes a pixie or entropy, and wakes
//   a vessel            takes a pixie or entropy, if it's empty or holds
//                       that kind and has room
//
// Nothing there takes it: entropy spills as a PUDDLE, a little well your
// lamp drinks while you stand in it (it shrinks as it pours into the lamp),
// and a pixie flies off, free again.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, RULES, THREE, S, state, savePlayer } = W;

  const holdsName = (h) => (h === 'pixie' ? 'the pixie' : 'the entropy');

  /**
   * Things that accept what a jar releases. find(p, what, from, name) gives
   * { line } (the prompt) and whatever take() needs, `blocked` if it would
   * take it but can't right now (nothing is released then), or null.
   */
  const ACCEPTS = [
    {
      name: 'lost door',
      find(p, what, from, name) {
        if (what !== 'pixie' || name !== 'hourglass') return null;
        const door = W.doorNear(p);
        if (!door || (door.action !== 'letgo' && door.action !== 'lostdoor')) return null;
        const n = door.path.traces.length, why = W.retraceBlocked(door);
        return why ? { blocked: why, door, line: { cls: 'blocked', text: `retrace your lost path · ${why}` } }
          : { door, line: { cls: 'collapse', text: `retrace your lost path · ${n} room${n === 1 ? '' : 's'} · ${W.chargeText(door.price)} and the hourglass's pixie` } };
      },
      take(t) { W.retraceThrough(t.door, !t.door.own); },
    },
    {
      name: 'waystone',
      find(p, what) {
        const st = W.stoneAhead(p);
        return st ? { stone: st, line: { cls: 'jar', text: `release ${holdsName(what)} into the waystone · it wakes` } } : null;
      },
      take(t, what, from) { W.powerStone(t.stone, from); },
    },
    {
      name: 'vessel',
      find(p, what) {
        const v = W.vesselAhead(p);
        if (!v || (v.n && (v.holds !== what || v.n >= RULES.vesselCapacity))) return null;
        return { vessel: v, line: { cls: 'jar', text: `release ${holdsName(what)} into the vessel (${v.n || 0}/${RULES.vesselCapacity})` } };
      },
      take(t, what, from, name) { W.deposit(from, t.vessel, name); },
    },
  ];

  /** What would take a release right now: { accept, ...found }, or null (it spills). */
  function acceptorAt(p, what, from, name) {
    for (const a of ACCEPTS) {
      const t = a.find(p, what, from, name);
      if (t) return Object.assign({ accept: a }, t);
    }
    return null;
  }
  /** The prompt for releasing `from` here. */
  function releaseLine(p, from, name) {
    const t = acceptorAt(p, from.holds, from, name);
    if (t) return t.line;
    return from.holds === 'pixie' ? { cls: 'jar', text: `let ${name === 'hourglass' ? "the hourglass's" : 'the'} pixie go` }
      : { cls: 'jar', text: 'spill the jar · a puddle your lamp can drink' };
  }
  /** Release what's in `from` (a jar, or the hourglass) in front of you. */
  function release(p, from, name = 'jar') {
    const what = from.holds;
    if (!what) return;
    const t = acceptorAt(p, what, from, name);
    if (t && t.blocked) { W.showCaption(t.blocked); return; }
    if (t) { t.accept.take(t, what, from, name); savePlayer(); W.refreshHud(); return; }
    const at = W.dropSpot(p);
    from.holds = null;
    if (what === 'entropy') {
      addPuddle(at, 1);
      W.showCaption('the entropy spills · stand in it and your lamp drinks it');
    } else {
      state.run.freedSeq = (state.run.freedSeq || 0) + 1;
      W.addPixie({ id: 'freed:' + state.run.freedSeq, x: at.x, y: at.y });
      W.showCaption(`you let ${name === 'hourglass' ? "the hourglass's" : 'the'} pixie go · it flits off`);
    }
    savePlayer();
    W.refreshHud();
  }

  // --- puddles: a spill of entropy, lying where it landed (the floor, or a
  // block's top), saved with the run in its room. It shows with its room
  // and goes with it when the room is rerolled.

  const PUDDLE = { reach: 0.34, radius: 0.3 }; // cells: drinking reach, and a full puddle's size
  const puddleGeo = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2);
  const puddleMat = new THREE.MeshBasicMaterial({ color: 0x9a63ff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
  const meshes = new Map(); // puddle id -> mesh
  const spaceAt = (x, y) => state.exp.spaces[state.exp.registry[DE.key(Math.floor(x), Math.floor(y))]];

  function addPuddle(at, amount) {
    const run = state.run, sp = spaceAt(at.x, at.y);
    if (!sp) return;
    run.puddleSeq = (run.puddleSeq || 0) + 1;
    const pd = { id: 'pd' + run.puddleSeq, x: +at.x.toFixed(3), y: +at.y.toFixed(3), base: at.base || 0, amount, spaceId: sp.id, seed: sp.seed };
    (run.puddles = run.puddles || []).push(pd);
    const rec = state.spaces.get(sp.id);
    if (rec) showPuddle(pd, rec.group);
  }
  function showPuddle(pd, group) {
    const m = new THREE.Mesh(puddleGeo, puddleMat);
    m.position.set(pd.x * S, (pd.base || 0) * S + 0.015, pd.y * S);
    m.renderOrder = 3;
    group.add(m);
    meshes.set(pd.id, m);
    sizePuddle(pd);
  }
  function sizePuddle(pd) {
    const m = meshes.get(pd.id);
    if (m) m.scale.setScalar(PUDDLE.radius * S * Math.sqrt(Math.max(0.05, pd.amount)));
  }
  /** buildSpace: the puddles lying in this room. */
  function addPuddles(space, group) {
    for (const pd of state.run.puddles || []) if (pd.spaceId === space.id && pd.seed === space.seed) showPuddle(pd, group);
  }
  /** Stand in a puddle: it pours into your lamp, like a well. */
  let poured = 0, wasDrinking = false;
  const at = new THREE.Vector3();
  function updatePuddles(dt) {
    const run = state.run, p = state.player;
    if (!run || !run.puddles || !run.puddles.length || state.paused || state.bigmap) return;
    let drank = false;
    for (const pd of run.puddles.slice()) {
      const m = meshes.get(pd.id);
      if (!m || !m.parent) continue; // its room isn't built
      if (Math.abs(p.z - (pd.base || 0)) > 0.12 || Math.hypot(p.x - pd.x, p.y - pd.y) > PUDDLE.reach) continue;
      const got = W.gainFuel(Math.min(RULES.wellRate * dt, pd.amount), true);
      if (got <= 0) continue;
      drank = true;
      pd.amount -= got;
      poured += got;
      at.set(pd.x * S, (pd.base || 0) * S + 0.1, pd.y * S);
      W.feedFrom(at, 0x9a63ff);
      if (pd.amount <= 0.001) {
        m.parent.remove(m);
        meshes.delete(pd.id);
        run.puddles = run.puddles.filter((o) => o !== pd);
      } else sizePuddle(pd);
    }
    if (poured >= 1 / RULES.shardsPerCharge - 1e-6 || (!drank && poured > 0.02)) { W.popEntropy(poured); poured = 0; }
    if (wasDrinking && !drank) savePlayer();
    wasDrinking = drank;
  }

  Object.assign(W, { ACCEPTS, acceptorAt, releaseLine, release, addPuddles, updatePuddles, PUDDLE });
})(window);
