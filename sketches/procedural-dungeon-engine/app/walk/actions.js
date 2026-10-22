// Walk mode: what E does at a door or wall. Open, unlock, collapse a branch
// for entropy, or press a doorstone to a wall.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, DP, RADIUS, USE_RANGE, state, rebuildExitIndex, isLockedNow, chargeText, save,
    savePlayer, doorMat, doorOpenMat, seamMat, buildSpace, refreshArrows, dissolveSpace, edgeEnds, blockNear,
    climb, removeMarkFromWorld, markNear, wipeMarksIn, jarNear, pickUpJar, shatterJarsIn, toolNear,
    takeItem, pullNear, pull } = W;

  // ---------------------------------------------------------------------------
  // Doors: open, unlock, or close + collapse

  /**
   * The door in the player's own room within reach, and what can be done
   * with it: 'open' | 'locked' | 'collapse'. Collapse (a reroll) is only
   * offered into a room that's still provisional. Loop doors, the way back
   * into a room, and doors into committed rooms have no action.
   */
  function doorNear(p) {
    const exp = state.exp;
    const sp = exp.spaces[exp.registry[DE.key(Math.floor(p.x), Math.floor(p.y))]];
    if (!sp) return null;
    let best = null, bestD = USE_RANGE;
    for (const ex of sp.exits) {
      const [ax, ay, bx, by] = edgeEnds(ex.cell.x, ex.cell.y, ex.facing);
      const d = Math.hypot(p.x - (ax + bx) / 2, p.y - (ay + by) / 2);
      if (d >= bestD) continue;
      let action = null, child = null;
      if (p.z > 0.05) continue; // no doors from on top of a block
      if (!ex.connectionId) action = isLockedNow(sp, ex) ? 'locked' : 'open';
      else if ((child = DP.rerollThrough(exp, sp.id, ex))) action = 'collapse';
      if (!action) continue;
      bestD = d;
      best = { space: sp, exit: ex, action, child };
    }
    if (best && best.action === 'collapse') {
      best.price = DP.collapseCost(DP.branch(exp, best.child.id));
      best.affordable = best.price.charges <= state.run.charges;
    }
    return best;
  }

  /** A plain wall right in front of the figure that a doorstone could open. */
  function wallNear(p) {
    if (state.run.doorstones <= 0 || p.z > 0.05) return null;
    const exp = state.exp;
    const cx = Math.floor(p.x), cy = Math.floor(p.y);
    const sid = exp.registry[DE.key(cx, cy)];
    if (sid === undefined) return null;
    const fx = Math.sin(p.angle), fy = Math.cos(p.angle);
    let best = null, bestD = RADIUS + 0.2;
    for (const f of DE.FACINGS) {
      const d = DE.DIRS[f];
      if (d.x * fx + d.y * fy < 0.6) continue; // must be facing it
      const dist = f === 'N' ? p.y - cy : f === 'S' ? cy + 1 - p.y : f === 'W' ? p.x - cx : cx + 1 - p.x;
      if (dist >= bestD || !DE.canCarve(exp, sid, { x: cx, y: cy }, f)) continue;
      bestD = dist;
      best = { action: 'carve', spaceId: sid, cell: { x: cx, y: cy }, facing: f };
    }
    return best;
  }

  /** Press a doorstone to the wall: the engine carves a real, unopened exit. */
  function carveDoor(near) {
    const exp = state.exp, run = state.run;
    DE.carve(exp, near.spaceId, near.cell, near.facing);
    run.doorstones--;
    run.chalkUsed++; // (doors drawn: the tally's name predates doorstones)
    rebuildExitIndex();
    buildSpace(exp.spaces[near.spaceId], false);
    W.showCaption('a door opens in the wall');
    save();
    savePlayer();
    W.refreshHud();
  }

  /** What E would do right now, in priority order (F uses the hotbar item: useNear). */
  const actionNear = (p) =>
    doorNear(p) || toolNear(p) || jarNear(p) || markNear(p) || pullNear(p) || blockNear(p);

  function act(near) {
    if (!near || state.paused || state.climb) return;
    if (near.action === 'climb') { climb(near.block, near.dir); return; }
    if (near.action === 'carve') { carveDoor(near); return; }
    if (near.action === 'pickjar') { pickUpJar(near.jar); return; }
    if (near.action === 'take') { takeItem(near.key, near.it); return; }
    if (near.action === 'pull') { pull(near); return; }
    if (near.action === 'erase') {
      removeMarkFromWorld(near.mark);
      W.showCaption('you wipe the chalk away');
      savePlayer();
      return;
    }
    const run = state.run;
    const doorKey = near.space.id + '/' + near.exit.id;
    if (near.action === 'open') {
      openDoor(near.space.id, near.exit.id);
    } else if (near.action === 'locked') {
      if (run.keys <= 0) { W.showCaption('locked. you need a key'); return; }
      run.keys--;
      run.keysUsed++;
      run.unlocked.push(doorKey);
      const door = state.doors.get(doorKey);
      if (door) {
        door.locked = false;
        door.panel.material = doorMat;
        door.seam.material = door.point.material = seamMat;
      }
      // The door just opens now. The record / leave-the-dungeon screen
      // (showRecord) is kept for whatever a lock leads to later.
      W.showCaption('the key turns');
      openDoor(near.space.id, near.exit.id);
      savePlayer();
      W.refreshHud();
    } else if (near.action === 'collapse') {
      if (!near.affordable) {
        W.showCaption(`not enough entropy to reroll: ${chargeText(near.price.charges)}, you have ${run.charges}`);
        return;
      }
      collapseThrough(near);
    }
  }

  /**
   * Locks first, keys later: a key-capable room only shows its key while
   * there are more unopened locked doors around than keys (held + lying).
   */
  function keyNeeded() {
    const exp = state.exp;
    let locks = 0, lying = 0;
    for (const id in exp.spaces) for (const ex of exp.spaces[id].exits) if (isLockedNow(exp.spaces[id], ex)) locks++;
    for (const it of state.items.values()) if (it.item.kind === 'key') lying++;
    return locks > state.run.keys + lying;
  }

  function openDoor(spaceId, exitId) {
    const exp = state.exp;
    const needKey = keyNeeded();
    const settling = !DP.committed(exp, exp.spaces[spaceId]); // opening a door out commits this room
    let cand;
    try {
      cand = DE.expand(exp, spaceId, exitId);
      DE.commit(exp, cand);
    } catch (e) {
      W.showCaption(e.message);
      return;
    }
    rebuildExitIndex();
    const door = state.doors.get(spaceId + '/' + exitId);
    if (door) {
      door.dir = 1;
      door.seam.visible = false;
      door.panel.material = doorOpenMat;
    }
    refreshArrows();
    if (cand.type === 'loop') {
      buildSpace(exp.spaces[cand.targetId], false);
      W.showCaption('this door opens onto ' + cand.targetId + '. you have been here' + (settling ? ` · ${spaceId} holds now` : ''));
    } else {
      if (settling) W.showCaption(`${spaceId} holds now · no rerolling it`);
      const sp = cand.space;
      if (needKey && DP.loot(sp).some((it) => it.kind === 'key')) state.run.keyRooms.push(sp.id + ':' + sp.seed);
      buildSpace(sp, true);
    }
    save();
    W.refreshHud();
  }

  /** Close an opened door and erase every space beyond it, for entropy. */
  function collapseThrough(near) {
    const exp = state.exp;
    const run = state.run;
    const spaces = DP.branch(exp, near.child.id);
    const ids = new Set(spaces.map((s) => s.id));
    // Spaces outside the branch that connect into it (loops) must rebuild:
    // their doorways become walls or unopened doors again.
    const touched = new Set();
    for (const s of spaces) {
      for (const ex of s.exits) {
        if (!ex.connectionId) continue;
        const c = exp.connections[ex.connectionId];
        for (const end of [c.a, c.b]) if (!ids.has(end.spaceId)) touched.add(end.spaceId);
      }
    }
    const loopsIntoParent = spaces.some((s) => s.exits.some((ex) => {
      if (!ex.connectionId || (s.id === near.child.id && ex.index === 0)) return false;
      const c = exp.connections[ex.connectionId];
      return c.a.spaceId === near.space.id || c.b.spaceId === near.space.id;
    }));
    if (!loopsIntoParent) touched.delete(near.space.id);

    const unravelled = W.banishGhostsIn(ids);
    const shattered = shatterJarsIn(ids);
    wipeMarksIn(ids);
    DP.collapse(exp, near.child.id);
    run.charges -= near.price.charges;
    run.chargesSpent += near.price.charges;
    run.collapses++;
    run.roomsCollapsed += spaces.length;
    rebuildExitIndex();

    const maxDepth = spaces[0].depth;
    spaces.forEach((s) => dissolveSpace(s.id, maxDepth - s.depth));
    for (const id of touched) if (exp.spaces[id]) buildSpace(exp.spaces[id], false);
    const door = state.doors.get(near.space.id + '/' + near.exit.id);
    if (door) door.dir = -1;
    refreshArrows();

    W.showCaption(`collapsed ${spaces.length} room${spaces.length === 1 ? '' : 's'} · −${chargeText(near.price.charges)}` +
      (unravelled ? ` · ${unravelled === 1 ? 'a hash ghost comes undone' : unravelled + ' hash ghosts come undone'}` : '') +
      (shattered.n ? ` · ${shattered.n === 1 ? 'a jar shatters' : shattered.n + ' jars shatter'}` : ''));
    save();
    savePlayer();
    W.refreshHud();
  }

  Object.assign(W, { doorNear, wallNear, carveDoor, actionNear, act, openDoor });
})(window);
