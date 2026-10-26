// Walk mode: what E does at a door or wall. Open, unlock, collapse a branch
// for entropy, choose at the door to a path lost to a faint (retrace it or
// reroll it), or press a doorstone to a wall. A tap of E opens or closes a
// door, from either side, like any door (walking into one does nothing).
// Rerolling is its own act: E held at a closed door into a room that's
// still provisional, from the side you came in by.
(function (global) {
  'use strict';

  const W = global.DungeonPlay.walk;
  const { DE, DP, RULES, RADIUS, USE_RANGE, UNIT, DOOR_W, DOOR_H, PUSH_TIME, state, rebuildExitIndex, isLockedNow, chargeText, save,
    savePlayer, doorMat, doorOpenMat, seamMat, buildSpace, refreshArrows, dissolveSpace, edgeEnds, blockNear,
    climb, removeMarkFromWorld, markNear, wipeMarksIn,
    liftNear, sconceNear, lightSconce } = W;

  // ---------------------------------------------------------------------------
  // Doors: open, unlock, or close + collapse

  /**
   * The door in the player's own room right in front of you, close, and
   * what can be done with it: 'open' | 'lostdoor' | 'locked' | 'close' |
   * 'reopen' | 'reroll'. An opened door closes ('close') and a closed one
   * opens again ('reopen'), from either side, with a tap. A closed door
   * into a room that's still provisional, from the side you came in by,
   * is 'reroll': a tap opens it, E held rerolls the room (`onTap`).
   * 'lostdoor', at the door to a path lost to a faint, puts up a choice
   * (retrace it or reroll it). `things`: icons of what's yours beyond it (a
   * pack, a lantern, a waystone), which a reroll would lose (`lose`).
   */
  function doorNear(p) {
    const exp = state.exp;
    const sp = exp.spaces[exp.registry[DE.key(Math.floor(p.x), Math.floor(p.y))]];
    if (!sp) return null;
    let best = null, bestD = USE_RANGE;
    const fx = Math.sin(p.angle), fy = Math.cos(p.angle);
    for (const ex of sp.exits) {
      const [ax, ay, bx, by] = edgeEnds(ex.cell.x, ex.cell.y, ex.facing);
      const dx = (ax + bx) / 2 - p.x, dy = (ay + by) / 2 - p.y, d = Math.hypot(dx, dy);
      if (d >= bestD || (dx * fx + dy * fy) / (d || 1) < DOOR_FACING) continue; // close, and facing it
      let action = null, child = null;
      if (p.z > 0.05) continue; // no doors from on top of a block
      if (!ex.connectionId) action = ex.kind === 'surface' ? 'surface' : isLockedNow(sp, ex) ? 'locked' : 'open';
      else if (!W.isClosed(ex.connectionId)) action = 'close';
      else if ((child = DP.rerollThrough(exp, sp.id, ex))) action = 'reroll';
      else action = 'reopen';
      if (!action) continue;
      bestD = d;
      best = { space: sp, exit: ex, action, child };
    }
    const path = best && best.action === 'open' && W.lostPathAt(sp.id, best.exit.id);
    if (path) {
      best.action = 'lostdoor';
      best.path = path;
      best.price = W.retracePrice(path);
      best.thread = !!state.run.thread;
      best.affordable = best.price <= state.run.fuel + 1e-6;
      best.things = thingsIn(new Set(path.traces.map((t) => t.id)), path.traces);
    }
    if (best && best.action === 'reroll') {
      const branch = DP.branch(exp, best.child.id);
      const ids = new Set(branch.map((s) => s.id));
      best.price = DP.collapseCost(branch);
      best.affordable = best.price.charges <= state.run.fuel + 1e-6;
      // Ghosts stay: a room can't be rerolled while one is in it.
      best.haunted = W.ghostIn(ids);
      best.things = thingsIn(ids, branch);
      best.lose = best.things.length > 0;
      const cid = best.exit.connectionId;
      best.onTap = () => reopenDoor(cid);
      // Can't reroll it now: it's a plain door (the prompt says why).
      if (best.haunted || !best.affordable) {
        best.action = 'reopen';
        best.why = best.haunted ? `a hash ghost lingers in ${best.child.id} · no rerolling it`
          : `not enough entropy to reroll it · ${chargeText(best.price.charges)}`;
      }
    }
    return best;
  }
  const DOOR_FACING = 0.5; // cos of how far off straight at a door you can be and still use it

  /**
   * What's yours in these rooms (ids; `rooms`: their spaces or traces), as
   * icon kinds (choice.js): a pack, a hall's save lantern, a waystone.
   */
  function thingsIn(ids, rooms) {
    const out = [];
    for (let i = W.packsIn(ids).length; i > 0; i--) out.push('pack');
    for (const r of rooms) if (r.archetype === 'hall') out.push('lantern');
    for (let i = W.stonesIn(rooms); i > 0; i--) out.push('waystone');
    return out;
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

  /**
   * The box around what E would act on, in cells: { x0, y0, x1, y1, z0, z1 }
   * (z up from the floor). It's the focus outline, and its middle is the
   * point the focus scorer aims at.
   */
  function focusBox(near) {
    const pad = (x, y, r, z0, z1) => ({ x0: x - r, y0: y - r, x1: x + r, y1: y + r, z0, z1 });
    const blk = (b, z0, z1) => ({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, z0, z1 });
    switch (near.action) {
      case 'save': return blk(near.lantern.ws, 0, 3 * UNIT);
      case 'erase': {
        const m = near.mark, z = m.base || 0;
        return { x0: m.sx / 2, y0: m.sy / 2, x1: m.sx / 2 + 0.5, y1: m.sy / 2 + 0.5, z0: z, z1: z + 0.02 };
      }
      case 'lift': return blk(near.block, 0, near.block.top);
      case 'setblock': {
        if (!near.spot) return null;
        const z = near.spot.base || 0, h = near.block.top - (near.block.base || 0);
        return { x0: near.spot.sx / 2, y0: near.spot.sy / 2, x1: near.spot.sx / 2 + 0.5, y1: near.spot.sy / 2 + 0.5, z0: z, z1: z + h };
      }
      case 'light': case 'snuff': return pad(near.sconce.x, near.sconce.y, 0.08, W.SCONCE_Y - 0.1, W.SCONCE_Y + 0.12);
      case 'climb': return blk(near.block, near.block.base || 0, near.block.top);
      default: { // a door
        const [ax, ay, bx, by] = edgeEnds(near.exit.cell.x, near.exit.cell.y, near.exit.facing);
        const mx = (ax + bx) / 2, my = (ay + by) / 2, h = ax === bx ? 0 : DOOR_W / 2, v = ax === bx ? DOOR_W / 2 : 0;
        return { x0: mx - h - 0.04, y0: my - v - 0.04, x1: mx + h + 0.04, y1: my + v + 0.04, z0: 0, z1: DOOR_H };
      }
    }
  }

  /**
   * What E would do right now: one focused thing. Each kind offers its best
   * candidate within its own reach, and the one you're most squarely facing
   * wins, nearer breaking ties (F uses the hotbar item: useNear).
   */
  const FACING_WEIGHT = 0.6; // cells of distance one unit of (1 - cos) is worth
  function actionNear(p) {
    // A choice is up (choice.js): E confirms the option picked.
    if (state.choice) return W.choiceNear();
    // Holding on to a block: that's what E is about until you let go.
    if (state.grab) {
      if (state.grab.letGo) return null; // let go: it's coming to rest
      const near = { action: 'grabbed', block: state.grab.block };
      near.box = focusBox(Object.assign({}, near, { action: 'lift' }));
      return near;
    }
    // An object in your hands (a block, a crate, a vessel): E only sets it down.
    if (state.carry) {
      const spot = W.blockSpot(p), near = { action: 'setblock', spot, block: state.carry };
      near.box = focusBox(near);
      return near;
    }
    const fx = Math.sin(p.angle), fy = Math.cos(p.angle);
    let best = null, bestScore = Infinity;
    for (const find of [doorNear, W.lanternNear, markNear, liftNear, sconceNear, blockNear]) {
      const near = find(p);
      if (!near) continue;
      const b = near.box = focusBox(near);
      const dx = (b.x0 + b.x1) / 2 - p.x, dy = (b.y0 + b.y1) / 2 - p.y, d = Math.hypot(dx, dy);
      const cos = d < 0.05 ? 1 : (dx * fx + dy * fy) / d;
      const score = d + FACING_WEIGHT * (1 - cos);
      if (score < bestScore) { bestScore = score; best = near; }
    }
    // A powered waystone: E held grabs it, as any object; a tap travels.
    if (best && best.action === 'lift' && best.block.waystone && best.block.holds) {
      const blk = best.block;
      best.onTap = () => W.travelFrom(W.stoneOf(blk));
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Hold to act: anything that changes the world needs E held (or the E
  // prompt pressed and held on touch) while a ring fills; the rest is a tap.
  // Doors are the exception, everyday enough for a tap: open, close, open
  // again. Where a thing has both (a closed door you could reroll, a powered
  // waystone), letting go before the ring fills is the tap (`onTap`), and
  // the ring only shows once you've held a moment.

  const HOLD = {
    erase: 0.4, light: 0.5, snuff: 0.5, lift: 0.4, save: 0.5,
    reroll: 1.0, // it costs entropy and can't be undone
  };
  const TAP_GRACE = 0.15; // seconds of a hold before its ring shows, where a tap does something else
  HOLD.lostdoor = RULES.lostDoorHold; // then a choice (choice.js)
  HOLD.choose = RULES.choiceHold;
  // The ring's icon, per action.
  const HOLD_ICON = {
    open: '⇥', reopen: '⇥', close: '⇤', locked: '⚷', erase: '✕', light: '✦', snuff: '○',
    reroll: '↻', lostdoor: '⇄', lift: '✋', save: '✧',
  };

  /** Can't be done right now: a tap says why instead of filling a ring. */
  function blockedNow(near) {
    const a = near.action;
    return a === 'locked' ||
      (a === 'choose' && !!near.opt.off) || (a === 'setblock' && !near.spot);
  }
  /** Seconds E must be held for this action, or 0 for a tap. Losing something of yours takes longer. */
  const holdTime = (near) => (blockedNow(near) ? 0
    : (HOLD[near.action] || 0) * (near.lose && near.action !== 'choose' ? RULES.rerollLoseFactor : 1));

  // What's being held: the action and its box (and a choice's pick), so a different target restarts the ring.
  const holdSig = (near) => near.action + (near.sel != null ? '#' + near.sel : '') + ':' +
    Object.values(near.box || {}).map((v) => v.toFixed(2)).join(',');

  /**
   * E pressed (key down or the prompt pressed): taps act now; holds start
   * the ring. Where a hold has a tap of its own (`onTap`: a closed door you
   * could reroll, a powered waystone), the tap happens on letting go.
   */
  function pressE() {
    const near = actionNear(state.player);
    const h = state.hold;
    h.sig = null; h.t = 0; h.spent = false; h.down = true;
    h.tap = near && near.onTap && holdTime(near) ? near : null;
    if (near && !holdTime(near)) { h.spent = true; act(near); }
  }
  /** E let go: a grabbed block is lifted (or let go, if you moved it); a hold let go early does its tap. `cancel` (focus lost): just let go. */
  function releaseE(cancel) {
    const h = state.hold;
    const tap = !cancel && h.down && !h.spent && h.tap;
    h.down = false; h.sig = null; h.t = 0; h.spent = false; h.tap = null;
    if (state.grab) W.endGrab(cancel);
    if (tap && !state.paused) tap.onTap();
  }

  /**
   * Each frame: fill the ring while E is held on the same target, and act
   * when it's full. One hold, one action; release to go again. Returns the
   * ring's progress (0-1), icon and what's at stake (`things`, `lose`), for
   * the HUD. A door to a lost path shows its things from the first moment.
   */
  function tickHold(near, dt) {
    const h = state.hold;
    h.ring = null;
    if (h.down && !h.spent && near && holdTime(near)) {
      const sig = holdSig(near);
      if (sig !== h.sig) { h.sig = sig; h.t = 0; }
      h.t += dt;
      const need = holdTime(near);
      if (!near.onTap || h.t >= TAP_GRACE) {
        h.ring = { v: Math.min(1, h.t / need), icon: near.icon || HOLD_ICON[near.action] || '',
          things: near.action === 'choose' ? null : near.things || null, lose: !!near.lose };
      }
      if (h.t >= need) { h.spent = true; act(near); }
    }
    return h.ring;
  }

  /** Shut an opened door: it's a wall again (to you, ghosts and light) until you open it. */
  function closeDoor(cid) {
    const run = state.run;
    if (!run.closed) run.closed = [];
    if (!run.closed.includes(cid)) run.closed.push(cid);
    const c = state.exp.connections[cid];
    const door = c && state.doors.get(c.a.spaceId + '/' + c.a.exitId);
    if (door) door.dir = -1;
    W.showCaption('you close the door');
    savePlayer();
    W.refreshHud();
  }
  function reopenDoor(cid) {
    const run = state.run;
    run.closed = (run.closed || []).filter((id) => id !== cid);
    const c = state.exp.connections[cid];
    const door = c && state.doors.get(c.a.spaceId + '/' + c.a.exitId);
    if (door) {
      door.dir = 1;
      door.seam.visible = false;
      door.panel.material = doorOpenMat;
    }
    savePlayer();
    W.refreshHud();
  }

  function act(near) {
    if (!near || state.paused || state.climb) return;
    if (near.action === 'close') { closeDoor(near.exit.connectionId); return; }
    if (near.action === 'reopen') { reopenDoor(near.exit.connectionId); return; }
    if (near.action === 'snuff') { W.snuffSconce(near.sconce); return; }
    if (near.action === 'climb') { climb(near.block, near.dir); return; }
    if (near.action === 'surface') { askSurface(); return; }
    if (near.action === 'save') { W.saveAt(near.lantern); return; }
    if (near.action === 'choose') {
      if (near.opt.off) { W.showCaption(near.opt.off); return; }
      W.closeChoice();
      near.opt.act();
      return;
    }
    if (near.action === 'carve') { carveDoor(near); return; }
    if (near.action === 'lift') { W.startGrab(near.block); return; } // the ring filled: you have hold of it
    if (near.action === 'grabbed') return;
    if (near.action === 'setblock') {
      if (!near.spot) { W.showCaption('no room to set it down here'); return; }
      W.setDownBlock(near.spot);
      return;
    }
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
    } else if (near.action === 'lostdoor') {
      lostDoorChoice(near);
    } else if (near.action === 'locked') {
      // A key in hand unlocks it (F); E can't.
      W.showCaption(run.keys > 0 ? `locked · ${W.verbF} with your key in hand to unlock it` : 'locked. you need a key');
    } else if (near.action === 'reroll') {
      collapseThrough(near);
    }
  }

  /**
   * The door to a lost path: retrace it (the thread, and a shard a room) or
   * reroll it (something new opens, and the path is gone, with whatever of
   * yours is on it).
   */
  function lostDoorChoice(near) {
    const n = near.path.traces.length, rooms = `${n} room${n === 1 ? '' : 's'}`;
    const off = !near.thread ? 'you need the thread to find the way back'
      : !near.affordable ? `not enough entropy: ${chargeText(near.price)}, you have ${chargeText(state.run.fuel)}` : null;
    // A side door: it opens onto ground the path holds, not the path's own door.
    const own = near.path.door && near.path.door.spaceId === near.space.id && near.path.door.exitId === near.exit.id;
    W.openChoice({
      title: own ? `your lost path · ${rooms}${near.path.dim ? ' · fading' : ''}`
        : `your lost path lies beyond this door · ${rooms}${near.path.dim ? ' · fading' : ''}`,
      things: near.things,
      box: near.box,
      sel: off ? 1 : 0,
      options: [
        { label: 'retrace', icon: '↺', detail: `as you left it · ${chargeText(near.price)}`, off, act: () => retraceThrough(near, !own) },
        { label: own ? 'reroll' : 'open anyway', icon: '↻', detail: own ? 'something new · the path is gone' : 'the path is gone', lose: true,
          act: () => openDoor(near.space.id, near.exit.id) },
      ],
    });
  }

  function retraceThrough(near, side) {
    const run = state.run;
    W.spendFuel(near.price);
    run.chargesSpent += near.price;
    run.retraces = (run.retraces || 0) + 1;
    const r = W.retrace(near.path);
    W.showCaption(`the thread pulls taut · ${r.back} room${r.back === 1 ? '' : 's'} as you left ${r.back === 1 ? 'it' : 'them'}` +
      (r.gone ? ` · ${r.gone} couldn't come back` : '') + ` · −${chargeText(near.price)}` +
      (side && r.back ? ' · this door opens onto it now' : ''));
    savePlayer();
    W.refreshHud();
  }

  /** F with a key in hand at a locked door: the key turns. Open it as usual after. */
  function unlockDoor(near) {
    const run = state.run;
    const doorKey = near.space.id + '/' + near.exit.id;
    run.keys--;
    run.keysUsed++;
    run.unlocked.push(doorKey);
    const door = state.doors.get(doorKey);
    if (door) {
      door.locked = false;
      door.panel.material = doorMat;
      door.seam.material = door.point.material = seamMat;
    }
    W.showCaption('the key turns · the door is unlocked');
    savePlayer();
    W.refreshHud();
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
   * Open a door on something new. At a lost path's door, that lets the path
   * go: it turns to corruption first, so the new room grows over it.
   * Returns true if it opened.
   */
  function openDoor(spaceId, exitId) {
    const exp = state.exp;
    const needKey = keyNeeded();
    const settling = !DP.committed(exp, exp.spaces[spaceId]); // opening a door out commits this room
    const path = W.lostPathAt(spaceId, exitId);
    if (path) W.letGo(path);
    let cand;
    try {
      cand = DE.expand(exp, spaceId, exitId);
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
      if (path) W.showCaption(`you let the lost path go · it sours into the stone` + (settling ? ` · ${spaceId} holds now` : ''));
      else if (settling) W.showCaption(`${spaceId} holds now · no rerolling it`);
      if (needKey && DP.loot(sp).some((it) => it.kind === 'key')) state.run.keyRooms.push(sp.id + ':' + sp.seed);
      buildSpace(sp, true);
      if (sp.archetype === 'hall') W.arrive(sp);
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
    const despawned = W.despawnObjectsIn(ids); // crates, blocks and vessels sitting in them; one in your hands stays
    const packs = W.dropPacksIn(ids);
    W.dropPixiesIn(ids);
    W.dropCreepersIn(ids);
    wipeMarksIn(ids);
    DP.collapse(exp, near.child.id);
    if (run.closed) run.closed = run.closed.filter((id) => exp.connections[id]);
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
      (despawned ? ` · ${despawned === 1 ? 'a block goes with it' : despawned + ' blocks go with it'}` : '') +
      (packs ? ` · ${packs === 1 ? 'your pack goes with it' : packs + ' packs go with it'}` : ''));
    save();
    savePlayer();
    W.refreshHud();
  }

  Object.assign(W, { doorNear, wallNear, carveDoor, unlockDoor, focusBox, actionNear, holdTime, pressE, releaseE, tickHold,
    closeDoor, reopenDoor, act, openDoor, askSurface });
})(window);
