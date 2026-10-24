// Walk mode: what E does at a door or wall. Open, unlock, collapse a branch
// for entropy, re-chart a room lost to a faint, or press a doorstone to a
// wall.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, DP, RULES, RADIUS, USE_RANGE, state, rebuildExitIndex, isLockedNow, chargeText, save,
    savePlayer, doorMat, doorOpenMat, seamMat, buildSpace, refreshArrows, dissolveSpace, edgeEnds, blockNear,
    climb, removeMarkFromWorld, markNear, wipeMarksIn, jarNear, pickUpJar, shatterJarsIn, toolNear,
    takeItem, pullNear, pull, sconceNear, lightSconce, waystoneNear, wakeWaystone, travelFrom } = W;

  // ---------------------------------------------------------------------------
  // Doors: open, unlock, or close + collapse

  /**
   * The door in the player's own room within reach, and what can be done
   * with it: 'open' | 'rechart' | 'locked' | 'collapse'. Collapse (a
   * reroll) is only offered into a room that's still provisional; rechart,
   * at an unopened door whose room was lost to a faint and could stand
   * there again (pushing the door still opens something new). Loop doors,
   * the way back into a room, and doors into committed rooms have no action.
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
      if (!ex.connectionId) action = ex.kind === 'surface' ? 'surface' : isLockedNow(sp, ex) ? 'locked' : 'open';
      else if ((child = DP.rerollThrough(exp, sp.id, ex))) action = 'collapse';
      if (!action) continue;
      bestD = d;
      best = { space: sp, exit: ex, action, child };
    }
    if (best && best.action === 'open' && W.lostRoomThrough(sp.id, best.exit.id)) {
      best.action = 'rechart';
      best.lost = W.lostRoomThrough(sp.id, best.exit.id).trace;
      best.price = RULES.rechartCharges;
      best.affordable = best.price <= state.run.fuel + 1e-6;
    }
    if (best && best.action === 'collapse') {
      const branch = DP.branch(exp, best.child.id);
      best.price = DP.collapseCost(branch);
      best.affordable = best.price.charges <= state.run.fuel + 1e-6;
      // Ghosts stay: a room can't be rerolled while one is in it.
      best.haunted = W.ghostIn(new Set(branch.map((s) => s.id)));
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
    doorNear(p) || waystoneNear(p) || toolNear(p) || jarNear(p) || markNear(p) || pullNear(p) ||
    sconceNear(p) || blockNear(p);

  function act(near) {
    if (!near || state.paused || state.climb) return;
    if (near.action === 'climb') { climb(near.block, near.dir); return; }
    if (near.action === 'surface') { askSurface(); return; }
    if (near.action === 'wake') { wakeWaystone(near.stone); return; }
    if (near.action === 'travel') { travelFrom(near.stone); return; }
    if (near.action === 'carve') { carveDoor(near); return; }
    if (near.action === 'pickjar') { pickUpJar(near.jar); return; }
    if (near.action === 'take') { takeItem(near.key, near.it); return; }
    if (near.action === 'pull') { pull(near); return; }
    if (near.action === 'light') { lightSconce(near.sconce); return; }
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
    } else if (near.action === 'rechart') {
      if (!near.affordable) {
        W.showCaption(`not enough entropy to re-chart ${near.lost.id}: ${chargeText(near.price)}, you have ${chargeText(run.fuel)}`);
        return;
      }
      if (openDoor(near.space.id, near.exit.id, true)) {
        W.spendFuel(near.price);
        run.chargesSpent += near.price;
        run.recharts = (run.recharts || 0) + 1;
        savePlayer();
        W.refreshHud();
      }
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
      if (near.haunted) {
        W.showCaption(`a hash ghost lingers in ${near.child.id} · it won't let the room unmake`);
        return;
      }
      if (!near.affordable) {
        W.showCaption(`not enough entropy to reroll: ${chargeText(near.price.charges)}, you have ${chargeText(run.fuel)}`);
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

  /**
   * Open a door: generate what's beyond, or (rechart) build the room lost
   * there to a faint again. Returns true if it opened.
   */
  function openDoor(spaceId, exitId, rechart) {
    const exp = state.exp;
    const needKey = keyNeeded();
    const settling = !DP.committed(exp, exp.spaces[spaceId]); // opening a door out commits this room
    let cand;
    try {
      if (rechart) {
        const lost = DE.rechartable(exp, spaceId, exitId, 'faint');
        if (!lost) { W.showCaption('the lost room can’t come back · something stands in its place'); return false; }
        cand = lost.cand;
      } else cand = DE.expand(exp, spaceId, exitId);
      DE.commit(exp, cand);
    } catch (e) {
      W.showCaption(e.message);
      return false;
    }
    rebuildExitIndex();
    const door = state.doors.get(spaceId + '/' + exitId);
    if (door) {
      door.dir = 1;
      door.seam.visible = false;
      door.panel.material = doorOpenMat;
    }
    refreshArrows(); // also: a new room can take a lost room's place
    if (cand.type === 'loop') {
      buildSpace(exp.spaces[cand.targetId], false);
      W.showCaption('this door opens onto ' + cand.targetId + '. you have been here' + (settling ? ` · ${spaceId} holds now` : ''));
    } else {
      const sp = cand.space;
      if (rechart) W.showCaption(`${sp.id} comes back as it was · −${chargeText(RULES.rechartCharges)}`);
      else if (settling) W.showCaption(`${spaceId} holds now · no rerolling it`);
      if (needKey && DP.loot(sp).some((it) => it.kind === 'key')) state.run.keyRooms.push(sp.id + ':' + sp.seed);
      buildSpace(sp, true);
      if (sp.archetype === 'hall' && !rechart) W.arrive(sp);
    }
    save();
    W.refreshHud();
    return true;
  }

  /** The surface door: a placeholder way out of the game loop. */
  function askSurface() {
    const sp = state.exp.spaces.s0, ex = sp && sp.exits.find((e) => e.kind === 'surface');
    if (!ex) return;
    W.openDialog({
      kicker: 'the surface door',
      title: 'Up to the surface (quit game)?',
      text: 'Your expedition is saved. The dungeon will be here when you come back down.',
      buttons: [
        { label: 'Go up', primary: true, onClick: () => {
          state.run.surfaced = true;
          save();
          savePlayer();
          W.showRecord(sp.id, ex.id, 'surface');
        } },
        { label: 'Stay below', quiet: true },
      ],
    });
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

    const unravelled = W.banishGhostsIn(ids); // none, normally: a haunted room can't be rerolled
    const shattered = shatterJarsIn(ids);
    W.dropPixiesIn(ids);
    wipeMarksIn(ids);
    DP.collapse(exp, near.child.id);
    W.spendFuel(near.price.charges);
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

  Object.assign(W, { doorNear, wallNear, carveDoor, actionNear, act, openDoor, askSurface });
})(window);
