// Headless engine check (milestone acceptance criteria), run with:
//   node stress-test.js [expansions=500] [runs=5]
// Random expansions, rerolls, reverts (some tagged, quiet, and restored or
// re-tagged later) and carved doors (some walled up again); asserts no
// overlaps, a registry that rebuilds identically, exact replay from history,
// that a restored space is the one that was lost, and at least one cycle.
'use strict';
require('./engine/rng.js');
require('./engine/shapes.js');
require('./engine/expedition.js');
const DE = globalThis.DungeonEngine;

const N = +(process.argv[2] || 500);
const RUNS = +(process.argv[3] || 5);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }

// Claim a hall footprint a few cells out from a random room, as walk mode's
// waypoints do.
function tryReserve(exp) {
  const ids = Object.keys(exp.spaces);
  const c = DE.parseKey(pick(exp.spaces[pick(ids)].cells));
  const rng = DE.createRng(DE.randomRootSeed());
  const h = DE.hallCells(rng, 6, 8);
  const a = Math.random() * Math.PI * 2, d = 6 + Math.random() * 10;
  const ox = Math.round(c.x + Math.cos(a) * d), oy = Math.round(c.y + Math.sin(a) * d);
  const cells = h.cells.map((p) => DE.key(p.x + ox, p.y + oy));
  if (!DE.canReserve(exp, cells)) return false;
  DE.reserve(exp, { seed: DE.hash('hall', ox, oy), kind: 'hall', cells });
  return true;
}

function checkNoOverlap(exp) {
  // Nothing grows into a footprint that's still waiting; a reserved space
  // that was built has exactly its footprint.
  for (const id in exp.reserves) {
    const r = exp.reserves[id];
    if (r.spaceId) assert(exp.spaces[r.spaceId].cells.join(';') === r.cells.join(';'), 'reserved space ' + r.spaceId + ' differs from ' + id);
    else for (const k of r.cells) assert(exp.registry[k] === undefined, 'cell ' + k + ' of waiting ' + id + ' built on');
  }
  const seen = {};
  for (const id in exp.spaces) {
    for (const k of exp.spaces[id].cells) {
      assert(!seen[k], 'cell ' + k + ' owned by ' + seen[k] + ' and ' + id);
      seen[k] = id;
    }
  }
  assert(sameMap(DE.rebuildRegistry(exp), exp.registry), 'registry does not rebuild identically');
}
function sameMap(a, b) {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}

let totalCycles = 0;
for (let run = 0; run < RUNS; run++) {
  const exp = DE.createExpedition(DE.randomRootSeed());
  let expansions = 0, loops = 0, reverts = 0, reserves = 0, restores = 0, uncarves = 0;
  while (expansions < N) {
    const open = [];
    for (const id in exp.spaces) for (const e of exp.spaces[id].exits) if (!e.connectionId && e.kind !== 'surface') open.push([id, e.id]);
    if (open.length === 0) break;
    const [sid, eid] = pick(open);
    let cand = DE.expand(exp, sid, eid);
    if (Math.random() < 0.3) cand = DE.expand(exp, sid, eid); // reroll
    DE.commit(exp, cand);
    if (cand.type === 'loop') loops++;
    expansions++;
    if (Math.random() < 0.05) {
      const leaves = Object.keys(exp.spaces).filter((id) => DE.canRevert(exp, id));
      if (leaves.length) { DE.revert(exp, pick(leaves), Math.random() < 0.5 ? 'lost' : undefined, Math.random() < 0.5); reverts++; }
    }
    // Restore a lost space now and then: same id, seed and cells. Re-tag
    // some (quiet traces leave no imprint).
    if (Math.random() < 0.05) {
      const t = pick(Object.values(exp.traces).filter((t) => t.cause === 'lost').concat([null]));
      if (t && DE.restorable(exp, t.id)) {
        const want = t;
        const id = DE.restore(exp, t.id);
        const sp = exp.spaces[id];
        assert(id === want.id && sp.seed === want.seed && sp.cells.join(';') === want.cells.join(';'), 'restore of ' + want.id + ' differs');
        assert(!exp.traces[want.id], 'restored trace ' + want.id + ' still there');
        restores++;
      } else if (t) {
        DE.tagTraces(exp, [t.id], pick(['corrupt', 'faded']), Math.random() < 0.5);
        for (const k of t.cells) assert(DE.imprintAt(exp, k).every((x) => !x.quiet), 'quiet trace leaves an imprint');
      }
    }
    if (expansions % 40 === 0) tryReserve(exp) && reserves++;
    // Carve a door now and then, and sometimes wall it up again (loops too).
    if (Math.random() < 0.04) {
      const sp = exp.spaces[pick(Object.keys(exp.spaces))];
      const c = DE.parseKey(pick(sp.cells)), f = pick(DE.FACINGS);
      if (DE.canCarve(exp, sp.id, c, f)) {
        const ex = DE.carve(exp, sp.id, c, f);
        if (Math.random() < 0.5) {
          if (Math.random() < 0.5) { const cand = DE.expand(exp, sp.id, ex.id); if (cand.type === 'loop') DE.commit(exp, cand); }
          DE.uncarve(exp, sp.id, ex.id);
          assert(!sp.exits.includes(ex), 'uncarved exit still there');
          uncarves++;
        }
      }
    }
    if (expansions % 50 === 0) checkNoOverlap(exp);
  }
  checkNoOverlap(exp);
  const res = DE.importRecord(DE.exportRecord(exp));
  assert(res.verified, 'replay mismatch: ' + res.mismatches.slice(0, 5).join(', '));
  assert(DE.exportRecord(res.expedition) === DE.exportRecord(exp), 'replayed record differs');
  const s = DE.stats(exp);
  totalCycles += s.cycles;
  const built = Object.values(exp.reserves).filter((r) => r.spaceId).length;
  console.log(`run ${run} seed=${exp.rootSeed}: ${expansions} expansions, ${loops} loops, ${reverts} reverts, ${reserves} reserves (${built} built), ${restores} restores, ${uncarves} uncarves ->`,
    `${s.spaces} spaces, ${s.cells} cells, ${s.cycles} cycles, ${s.openExits} open exits; replay OK`);
}
assert(totalCycles > 0, 'no cycles in any run');

// Mood regions: on (the default), most rooms carry on their parent's mood;
// off, the params carry no mood keys (rooms roll as they did before).
{
  const exp = DE.createExpedition(DE.randomRootSeed());
  for (let i = 0; i < 200; i++) {
    const open = [];
    for (const id in exp.spaces) for (const e of exp.spaces[id].exits) if (!e.connectionId && e.kind !== 'surface') open.push([id, e.id]);
    if (!open.length) break;
    const [sid, eid] = pick(open);
    DE.commit(exp, DE.expand(exp, sid, eid));
  }
  const kids = Object.values(exp.spaces).filter((s) => s.parentId && !s.reserveId);
  const same = kids.filter((s) => s.meta.mood === exp.spaces[s.parentId].meta.mood).length / kids.length;
  assert(same > 0.5, 'mood regions: only ' + (100 * same).toFixed(0) + '% of rooms keep their parent\'s mood');
  const was = DE.MOOD_REGIONS.inherit;
  DE.MOOD_REGIONS.inherit = 0;
  assert(!Object.keys(DE.deriveParams('x')).some((k) => k.startsWith('mood')), 'mood regions off still sets params');
  DE.MOOD_REGIONS.inherit = was;
  console.log(`mood regions: ${(100 * same).toFixed(0)}% of rooms keep their parent's mood`);
}

// Lost paths hold their ground: once 'hold' is on, rooms lost to a faint
// keep their cells; nothing else is built there (or opens into them), the
// path comes back whole, and the history replays exactly.
{
  let held = 0, blocked = 0;
  for (let run = 0; run < 5; run++) {
    const exp = DE.createExpedition(DE.randomRootSeed());
    DE.holdLostPaths(exp);
    const openExits = () => {
      const out = [];
      for (const id in exp.spaces) for (const e of exp.spaces[id].exits) if (!e.connectionId && e.kind !== 'surface') out.push([id, e.id]);
      return out;
    };
    const grow = (n) => {
      for (let i = 0; i < n; i++) {
        const open = openExits();
        if (!open.length) return;
        const [sid, eid] = pick(open);
        try { DE.commit(exp, DE.expand(exp, sid, eid)); } catch (e) { assert(/lost path/.test(e.message), e.message); blocked++; }
      }
    };
    grow(60);
    // Lose a branch, deepest first, as a faint does.
    const root = pick(Object.values(exp.spaces).filter((s) => s.parentId && s.depth >= 2));
    const branch = [];
    const walk = (id) => { branch.push(exp.spaces[id]); for (const s of Object.values(exp.spaces)) if (s.parentId === id) walk(s.id); };
    walk(root.id);
    const lostCells = new Map();
    for (const s of branch) for (const k of s.cells) lostCells.set(k, s.id);
    const left = new Set(branch.map((s) => s.id));
    while (left.size) {
      const leaf = Array.from(left).find((id) => DE.canRevert(exp, id));
      assert(leaf, 'lost branch: nothing revertible');
      DE.revert(exp, leaf, 'lost', true);
      left.delete(leaf);
    }
    for (const k of lostCells.keys()) assert(DE.heldAt(exp, k), 'lost cell not held: ' + k);
    held += lostCells.size;
    grow(200);
    for (const id in exp.spaces) for (const k of exp.spaces[id].cells) assert(!lostCells.has(k), 'built on held ground: ' + k);
    // It all comes back, parents first, on its own ground.
    const traces = branch.map((s) => exp.traces[s.id]).sort((a, b) => a.depth - b.depth);
    for (const t of traces) {
      assert(DE.restorable(exp, t.id), 'held path would not come back: ' + t.id);
      DE.restore(exp, t.id);
      assert(exp.spaces[t.id].cells.join(';') === t.cells.join(';'), 'came back on other ground: ' + t.id);
    }
    const res = DE.importRecord(DE.exportRecord(exp));
    assert(res.verified, 'held: replay mismatch ' + res.mismatches.slice(0, 5).join(', '));
  }
  console.log(`held ground: ${held} cells held across 5 runs, ${blocked} doors onto held ground left shut; all paths came back; replay OK`);
}
console.log('all checks passed');
