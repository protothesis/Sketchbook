// Headless engine check (milestone acceptance criteria), run with:
//   node stress-test.js [expansions=500] [runs=5]
// Random expansions, rerolls and reverts (some tagged 'faint' and re-charted
// later); asserts no overlaps, a registry that rebuilds identically, exact
// replay from history, that a re-charted space is the one that was lost, and
// at least one cycle.
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
  let expansions = 0, loops = 0, reverts = 0, reserves = 0, recharts = 0, uncarves = 0;
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
      if (leaves.length) { DE.revert(exp, pick(leaves), Math.random() < 0.5 ? 'faint' : undefined); reverts++; }
    }
    // Re-chart a lost space now and then: same id, seed and cells.
    if (Math.random() < 0.05) {
      const t = pick(Object.values(exp.traces).filter((t) => t.cause === 'faint').concat([null]));
      const r = t && exp.spaces[t.parentId] && DE.rechartable(exp, t.parentId, t.viaExitId, 'faint');
      if (r) {
        const want = r.trace;
        const id = DE.rechart(exp, t.parentId, t.viaExitId, 'faint');
        const sp = exp.spaces[id];
        assert(id === want.id && sp.seed === want.seed && sp.cells.join(';') === want.cells.join(';'), 're-chart of ' + want.id + ' differs');
        assert(!exp.traces[want.id], 're-charted trace ' + want.id + ' still there');
        recharts++;
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
  console.log(`run ${run} seed=${exp.rootSeed}: ${expansions} expansions, ${loops} loops, ${reverts} reverts, ${reserves} reserves (${built} built), ${recharts} re-charts, ${uncarves} uncarves ->`,
    `${s.spaces} spaces, ${s.cells} cells, ${s.cycles} cycles, ${s.openExits} open exits; replay OK`);
}
assert(totalCycles > 0, 'no cycles in any run');
console.log('all checks passed');
