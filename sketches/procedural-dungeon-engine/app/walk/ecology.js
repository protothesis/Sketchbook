// Walk mode: the ecology, a first pass at emergent behaviour (see
// EMERGENCE.md). Creatures don't know each other by name. Everything in
// the world that matters to a creature is a *presence*: a point with tags
// ('ghost', 'pixie', 'creeper', 'well', 'light', 'lamp', 'player', 'steady', 'waystone'). Your lamp
// is one ('light', 'lamp', 'player', while it's lit), and so are lit
// sconces ('light', 'steady'). Awake waystones are their own kind
// ('waystone'): nothing reacts to them yet. A small table of rules says how a creature
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
  //         With `hold`, a creature within that many cells of one (same
  //         room) is *held* by it: it drops whatever else it was doing
  //         (a ghost forgets you) and stays, circling, `pause` seconds
  //         between goals, at `speed` cells/s.
  //   flee: while one is within `range` cells in the same room, it's pushed
  //         away, harder the closer it is, and won't pick a goal there.
  //         Fleeing a light ('light', 'steady', 'lamp') has no range: it's
  //         being inside that light's pool, with nothing blocking it
  //         (light.js), in any room. Tune the pool, and its pull goes with it.
  const ECOLOGY = {
    rules: [
      { who: 'ghost', what: 'pixie', does: 'seek', chance: 0.9, orbit: [0.3, 0.75], range: 12, rooms: 1,
        hold: 2.5, pause: [0.3, 1], speed: 0.55 },
      { who: 'ghost', what: 'steady', does: 'flee' },   // restored rooms push ghosts back
      { who: 'pixie', what: 'ghost', does: 'flee', range: 2.2 },
      { who: 'pixie', what: 'light', does: 'flee' },    // so you have to chase them down
      { who: 'pixie', what: 'well', does: 'seek', chance: 0.5, orbit: [0.15, 0.6], range: 10, rooms: 0 },
      { who: 'creeper', what: 'steady', does: 'flee' }, // shadows keep off lit sconces
    ],
  };

  const spaceAt = (x, y) => state.exp.registry[DE.key(Math.floor(x), Math.floor(y))];

  /** Everything a creature might respond to, this moment: [{ tags, x, y, spaceId, ref }]. */
  function presences() {
    const out = [];
    for (const g of state.ghosts) out.push({ tags: ['ghost'], x: g.x, y: g.y, ref: g });
    for (const o of state.pixies) out.push({ tags: ['pixie'], x: o.x, y: o.y, ref: o });
    for (const c of state.creepers) out.push({ tags: ['creeper'], x: c.x, y: c.y, ref: c });
    for (const v of state.pushBlocks) if (v.vessel && !v.carried && v.holds === 'pixie' && v.n) out.push({ tags: ['pixie', 'jarred'], x: v.sx / 2 + 0.25, y: v.sy / 2 + 0.25, ref: v });
    // A waystone woken by a pixie still holds one: it draws ghosts like a jar does.
    for (const v of state.pushBlocks) if (v.waystone && !v.carried && v.holds === 'pixie') out.push({ tags: ['pixie', 'jarred'], x: (v.x0 + v.x1) / 2, y: (v.y0 + v.y1) / 2, ref: v });
    for (const w of state.wells) out.push({ tags: ['well'], x: w.cell.x + 0.5, y: w.cell.y + 0.5, ref: w });
    const p = state.player;
    // Lights carry their light (light.js), which is what fleeing them tests.
    out.push(W.lampOn() ? { tags: ['player', 'light', 'lamp'], x: p.x, y: p.y, ref: p, light: W.lampLight() }
      : { tags: ['player'], x: p.x, y: p.y, ref: p });
    for (const sc of state.sconces) if (sc.lit) out.push({ tags: ['light', 'steady'], x: sc.x, y: sc.y, ref: sc, light: W.sconceLight(sc) });
    // Save lanterns are always lit: a sconce in all but name (lanterns.js).
    for (const ln of state.lanterns) out.push({ tags: ['light', 'steady'], x: ln.x, y: ln.y, ref: ln, light: W.lanternLight(ln) });
    for (const st of state.waystones) {
      if (st.awake) out.push({ tags: ['waystone'], x: (st.ws.x0 + st.ws.x1) / 2, y: (st.ws.y0 + st.ws.y1) / 2, ref: st });
    }
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
          if (!ex.connectionId || W.isClosed(ex.connectionId)) continue;
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
      for (let i = 0; i < 8; i++) { // a spot on the orbit that's floor in the target's room, and not shunned
        const a = Math.random() * Math.PI * 2, r = rule.orbit[0] + Math.random() * (rule.orbit[1] - rule.orbit[0]);
        const x = best.x + Math.cos(a) * r, y = best.y + Math.sin(a) * r;
        if (spaceAt(x, y) === best.spaceId && !shuns(kind, x, y, self)) return { x, y, rule, target: best };
      }
    }
    return null;
  }

  /**
   * The presence holding this creature, if any: the nearest one a `hold`
   * seek rule names, within its hold distance and in the same room.
   */
  function heldBy(kind, self) {
    const here = spaceAt(self.x, self.y);
    let best = null, bd = Infinity;
    for (const rule of ECOLOGY.rules) {
      if (rule.who !== kind || rule.does !== 'seek' || !rule.hold) continue;
      for (const o of presences()) {
        if (o.ref === self || !o.tags.includes(rule.what) || o.spaceId !== here) continue;
        const d = Math.hypot(o.x - self.x, o.y - self.y);
        if (d < rule.hold && d < bd) { bd = d; best = { target: o, rule }; }
      }
    }
    return best;
  }

  const LIGHT_TAGS = ['light', 'steady', 'lamp'];

  /**
   * How hard a flee rule pushes off presence `o` at (x, y): 0 (not at all)
   * to 1 (right on it). A light pushes inside its pool, if it reaches you;
   * anything else inside the rule's range, in the same room.
   */
  function fleeFrom(rule, o, x, y, here) {
    const d = Math.hypot(o.x - x, o.y - y);
    if (o.light && LIGHT_TAGS.includes(rule.what)) {
      if (!W.light.litBy(o.light, x, y)) return 0;
      return Math.max(0.1, 1 - d / (W.light.edge(o.light) || 1));
    }
    if (o.spaceId !== here || d >= rule.range) return 0;
    return 1 - d / rule.range;
  }

  /** Would this kind keep away from (x, y)? */
  function shuns(kind, x, y, self) {
    const here = spaceAt(x, y);
    for (const rule of ECOLOGY.rules) {
      if (rule.who !== kind || rule.does !== 'flee') continue;
      for (const o of presences()) {
        if (o.ref !== self && o.tags.includes(rule.what) && fleeFrom(rule, o, x, y, here) > 0) return true;
      }
    }
    return false;
  }

  /** The push away from anything this kind flees, as { x, y } (cells/s per unit speed), or null. */
  function flee(kind, self) {
    const here = spaceAt(self.x, self.y);
    let fx = 0, fy = 0, any = false;
    for (const rule of ECOLOGY.rules) {
      if (rule.who !== kind || rule.does !== 'flee') continue;
      for (const o of presences()) {
        if (o.ref === self || !o.tags.includes(rule.what)) continue;
        const dx = self.x - o.x, dy = self.y - o.y, d = Math.hypot(dx, dy);
        const k = d < 1e-6 ? 0 : fleeFrom(rule, o, self.x, self.y, here);
        if (!k) continue;
        fx += dx / d * k; fy += dy / d * k; any = true;
      }
    }
    return any ? { x: fx, y: fy } : null;
  }

  W.ecology = { ECOLOGY, presences, seek, flee, heldBy, shuns };
  Object.assign(W, { roomGap });
})(window);
