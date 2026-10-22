// Walk mode: the ecology, a first pass at emergent behaviour (see
// EMERGENCE.md). Creatures don't know each other by name. Everything in
// the world that matters to a creature is a *presence*: a point with tags
// ('ghost', 'pixie', 'well'). A small table of rules says how a creature
// of one kind responds to a tag: seek it (go and circle it, for a while)
// or flee it (keep away while it's close). Creatures ask the ecology what
// to do; they never ask "is there a pixie jar here".
//
// So "ghosts are drawn to pixies" is one row, and it covers a free pixie
// and a jarred one alike, because both wear the 'pixie' tag. Add "pixies
// seek wells" and ghosts end up haunting wells too, without a rule saying
// so: that second-order effect is the emergence.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, state } = W;

  // who: the creature asking; what: the tag it responds to.
  //   seek: with `chance`, its next wander goal is a point `orbit` cells
  //         from the nearest such presence within `range` cells and `rooms`
  //         rooms (0: its own room). It pauses there, then picks again, so
  //         it drifts off and comes back.
  //   flee: while one is within `range` cells in the same room, it's pushed
  //         away, harder the closer it is.
  const ECOLOGY = {
    rules: [
      { who: 'ghost', what: 'pixie', does: 'seek', chance: 0.7, orbit: [0.45, 1.1], range: 12, rooms: 1 },
      { who: 'pixie', what: 'ghost', does: 'flee', range: 2.2 },
      { who: 'pixie', what: 'well', does: 'seek', chance: 0.5, orbit: [0.15, 0.6], range: 10, rooms: 0 },
    ],
  };

  const spaceAt = (x, y) => state.exp.registry[DE.key(Math.floor(x), Math.floor(y))];

  /** Everything a creature might respond to, this moment: [{ tags, x, y, spaceId, ref }]. */
  function presences() {
    const out = [];
    for (const g of state.ghosts) out.push({ tags: ['ghost'], x: g.x, y: g.y, ref: g });
    for (const o of state.pixies) out.push({ tags: ['pixie'], x: o.x, y: o.y, ref: o });
    for (const j of state.jars) if (j.fill > 0) out.push({ tags: ['pixie', 'jarred'], x: j.sx / 2 + 0.25, y: j.sy / 2 + 0.25, ref: j });
    for (const w of state.wells) out.push({ tags: ['well'], x: w.cell.x + 0.5, y: w.cell.y + 0.5, ref: w });
    for (const o of out) o.spaceId = spaceAt(o.x, o.y);
    return out;
  }

  /** Rooms between two spaces through open doors (Infinity past `max`). */
  function roomGap(a, b, max) {
    if (a === b) return 0;
    const exp = state.exp;
    let frontier = [a];
    const seen = new Set([a]);
    for (let d = 1; d <= max; d++) {
      const nxt = [];
      for (const id of frontier) {
        for (const ex of exp.spaces[id].exits) {
          if (!ex.connectionId) continue;
          const c = exp.connections[ex.connectionId];
          const o = c.a.spaceId === id ? c.b.spaceId : c.a.spaceId;
          if (o === b) return d;
          if (!seen.has(o)) { seen.add(o); nxt.push(o); }
        }
      }
      frontier = nxt;
    }
    return Infinity;
  }

  /**
   * A wander goal from the seek rules, or null to wander as usual:
   * { x, y, rule, target }. `self` is the creature ({ x, y }).
   */
  function seek(kind, self) {
    const here = spaceAt(self.x, self.y);
    if (here === undefined) return null;
    for (const rule of ECOLOGY.rules) {
      if (rule.who !== kind || rule.does !== 'seek' || Math.random() >= rule.chance) continue;
      let best = null, bd = rule.range;
      for (const o of presences()) {
        if (o.ref === self || !o.tags.includes(rule.what) || o.spaceId === undefined) continue;
        const d = Math.hypot(o.x - self.x, o.y - self.y);
        if (d >= bd || roomGap(here, o.spaceId, rule.rooms) > rule.rooms) continue;
        bd = d; best = o;
      }
      if (!best) continue;
      for (let i = 0; i < 6; i++) { // a spot on the orbit that's floor in the target's room
        const a = Math.random() * Math.PI * 2, r = rule.orbit[0] + Math.random() * (rule.orbit[1] - rule.orbit[0]);
        const x = best.x + Math.cos(a) * r, y = best.y + Math.sin(a) * r;
        if (spaceAt(x, y) === best.spaceId) return { x, y, rule, target: best };
      }
    }
    return null;
  }

  /** The push away from anything this kind flees, as { x, y } (cells/s per unit speed), or null. */
  function flee(kind, self) {
    const here = spaceAt(self.x, self.y);
    let fx = 0, fy = 0, any = false;
    for (const rule of ECOLOGY.rules) {
      if (rule.who !== kind || rule.does !== 'flee') continue;
      for (const o of presences()) {
        if (o.ref === self || !o.tags.includes(rule.what) || o.spaceId !== here) continue;
        const dx = self.x - o.x, dy = self.y - o.y, d = Math.hypot(dx, dy);
        if (d >= rule.range || d < 1e-6) continue;
        const k = 1 - d / rule.range;
        fx += dx / d * k; fy += dy / d * k; any = true;
      }
    }
    return any ? { x: fx, y: fy } : null;
  }

  W.ecology = { ECOLOGY, presences, seek, flee };
  Object.assign(W, { roomGap });
})(window);
