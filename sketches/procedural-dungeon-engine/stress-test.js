// Headless engine check (milestone acceptance criteria), run with:
//   node stress-test.js [expansions=500] [runs=5]
// Random expansions, rerolls and reverts; asserts no overlaps, a registry that
// rebuilds identically, exact replay from history, and at least one cycle.
'use strict';
require('./engine/rng.js');
require('./engine/shapes.js');
require('./engine/expedition.js');
const DE = globalThis.DungeonEngine;

const N = +(process.argv[2] || 500);
const RUNS = +(process.argv[3] || 5);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }

function checkNoOverlap(exp) {
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
  let expansions = 0, loops = 0, reverts = 0;
  while (expansions < N) {
    const open = [];
    for (const id in exp.spaces) for (const e of exp.spaces[id].exits) if (!e.connectionId) open.push([id, e.id]);
    if (open.length === 0) break;
    const [sid, eid] = pick(open);
    let cand = DE.expand(exp, sid, eid);
    if (Math.random() < 0.3) cand = DE.expand(exp, sid, eid); // reroll
    DE.commit(exp, cand);
    if (cand.type === 'loop') loops++;
    expansions++;
    if (Math.random() < 0.05) {
      const leaves = Object.keys(exp.spaces).filter((id) => DE.canRevert(exp, id));
      if (leaves.length) { DE.revert(exp, pick(leaves)); reverts++; }
    }
    if (expansions % 50 === 0) checkNoOverlap(exp);
  }
  checkNoOverlap(exp);
  const res = DE.importRecord(DE.exportRecord(exp));
  assert(res.verified, 'replay mismatch: ' + res.mismatches.slice(0, 5).join(', '));
  assert(DE.exportRecord(res.expedition) === DE.exportRecord(exp), 'replayed record differs');
  const s = DE.stats(exp);
  totalCycles += s.cycles;
  console.log(`run ${run} seed=${exp.rootSeed}: ${expansions} expansions, ${loops} loops, ${reverts} reverts ->`,
    `${s.spaces} spaces, ${s.cells} cells, ${s.cycles} cycles, ${s.openExits} open exits; replay OK`);
}
assert(totalCycles > 0, 'no cycles in any run');
console.log('all checks passed');
