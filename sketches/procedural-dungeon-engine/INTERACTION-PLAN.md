# Interaction cleanup: plan

Agreed in conversation, 2026-10-24. Built in small playtestable steps;
tick them off here as they land. PLAY.md / GAME-DESIGN.md describe what's
built; this file is the plan until it's all in.

## The rules

- **E interacts with the world. F uses what's in your hand.** Always. A
  tool never works by itself: a locked door must be unlocked with the key
  in hand (F), then opened as usual (E or push).
- **One focused target.** E acts on a single thing, picked by facing, then
  distance (not a priority list). It gets a faint outline, and the prompt
  names it. Two prompt lines: one for E's target, one for F's.
- **Hold to change the world, tap for the rest.** A ring (like the ghost
  timer: a circle with the action's icon) fills while you hold.
  - Hold: open or close any door (the push time, 0.35 s; pushing into a
    door fills the same ring), wipe chalk, light or snuff a sconce, wake a
    waystone.
  - Longer hold: closing a door into a provisional room rerolls it (the
    prompt says so and shows the cost).
  - Tap: lift, set down, travel.
- **Collect by touch what you use up; E for what stays in the world.**
  Tools (chalk, doorstones, keys) lie flat and are collected by walking
  over them. Objects (jars, blocks) take E. Only shards still float.

## Hands

- You hold one thing at a time (the lantern aside, always in the off
  hand). The figure shows it: an object over its head, a tool at its side.
- **Slot 1 is the lantern: empty hands.** F with it selected covers or
  relights the lamp; R stays as a shortcut.
- A tool collected with empty hands goes into them; otherwise into the bag.
- **Keys are a tool** on the hotbar; the key count by the lamp goes.
- The hotbar stays uncapped until there's an inventory menu (later; its
  size may become an ability).

## Carrying

- E lifts a push block or a jar; E sets it down ahead, with a preview of
  where. Pull goes away: a block you can lift is never stuck.
- Holding a block: no F, no climbing, no running, and no switching slots
  (the hotbar shakes). A block never goes in the bag.

## Jars

- F swipes the jar in your hand (the swipe always plays). A pixie swiped
  is caught. In a well, the swipe fills the jar with entropy: one charge,
  drawn from the well.
- F with an entropy jar pours it into the lamp: all or nothing. It tops
  the lamp up to max and the jar is empty either way.
- Each fill (empty, pixie, entropy) is its own hotbar group. "Auto" goes.

## Sconces

- Lighting costs a shard and pays nothing back (its gift is that the lamp
  rests near it). Snuffing (hold E) returns the shard and takes it off the
  restored tally. Clean both ways.

## Crates

- A plain push block with no home and no reward: just something to move.
  Some of the rooms' single 1x1 blocks become crates (seeded), with a wood
  crate look. Can't be climbed.

## Save

- Run save v4: jars store their contents (`pixie` | `entropy`), a carried
  block is saved; keys stay a count.

## Touch

- To be deprecated eventually; keep it working: holding the prompt button
  does a hold action, "use" stays as F.

## Parked

- More movable things (reshaping a room's blocks, thinning walls), the
  inventory menu, hotbar size as an ability.

## Build order

1. [x] Crates.
2. [x] Focus target + outline + two prompt lines. (The outline is corner
       brackets around the target's box, not a silhouette.)
3. [x] Hold-to-act ring: doors (open/close/reroll), chalk wipe, sconces
       (light/snuff), waystones. (Unlocking is a hold for now; it moves to
       F with the key in hand in step 4.)
4. [x] Hands: lantern slot, one held thing shown on the figure, touch
       collect for tools, keys as a tool (F to unlock). (F unlocking is a
       tap, like every F. The thread stays a pickup for now.)
5. [x] Carrying blocks and jars; pull removed. (Lifting a block that's
       home is a 0.5 s hold. The carried block is `run.carry`, additive, so
       the v4 bump moves to step 6 with the jar contents.)
6. [x] Jar swipe: pixies, well entropy, pouring; run save v4. (A jar
       fills only from a full well; with an empty jar in hand a well waits
       for the swipe instead of pouring into the lamp. Snapshots now carry
       `runVersion` and migrate on load, so this didn't need a new BUILD.)

## Playtest round 2 (2026-10-24)

- [x] No E prompt line or focus brackets (keyboard; touch keeps the E line,
      it's the button). The focus is still worked out in code; the hold
      ring sits above it.
- [x] Dragging: smooth along the grab axis, slower than walking by weight,
      easing into the nearest half-cell on release.
- [x] Dropping: back where it was lifted if you haven't moved; otherwise
      the half-cell straight ahead along your cardinal facing.
- [x] A faint while carrying no longer leaves a duplicate (a rebuild
      starts with empty hands; the checkpoint says what you carry).
- [x] Travelling from an awake waystone is a hold (0.5 s).
- Kept: the set-down preview box.
- [x] Dragging glitches (popping, jerks) fixed: the collision box now moves
      with the block, and block and figure move together, both checked
      first (issue #26).

## Playtest round 1 (2026-10-24)

Agreed after the first play of steps 1-6.

**Quick fixes**
- Held items at their true size (as on the ground), and casting no
  shadows.
- A new item goes into the bag, never into your hands.
- No ring for pushing a block or climbing; doors keep theirs.

**Grab, push, pull, climb.** One rule for every movable block (crates
and restoration blocks alike):
- Walking into one climbs it, like any one-unit block.
- Hold E: when the ring fills you **grab** it. Let go without moving and
  you **lift** it (with a short arc up over your head; setting down arcs
  back). Move while holding and you **push or pull** it along that axis;
  let go while moving and you just let go of it.
- Hands full (carrying): no climbing or jumping.

**Objects travel.** Crates, blocks and vessels can leave their room:
one run-wide list of loose objects (`run.objects`), placed by cell. A
room adds its crates and blocks to it the first time it's built. What
happens to an object depends on where it is now, never where it came
from: one held, carried or in the bag, or set down in another room,
stays when its origin room is rerolled. One sitting in a room when that
room is rerolled is **despawned**: removed from the world and kept in a
list (`run.despawned`) for some later use. A restoration block's mark
stays in its home room. Run save v5.

**Stacking.** Set a block down at the level you stand on, or one level
up: from the floor, on the floor or a one-unit top; from on a block, on
a one- or two-unit top. Stacks reach 3 units. You still only stand one
unit up.

**Jars and vessels.**
- **Jar**: a plain tool. Walk over it to collect it; F swipes it (catch a
  pixie, scoop a full well, pour into the lamp). A full jar stays in the
  bag.
- **Vessel**: a world object (lift, carry, set down; never in the bag)
  that holds one kind of thing, up to 3. F with a full jar at a vessel
  pours it in; F with an empty jar takes one back out. A vessel of
  pixies powers a sigil and draws ghosts, as a placed pixie jar does now.
- Loot spawns a vessel or a jar item. Old saves: placed jars become
  vessels, carried jars become jar items.

**Build order**
1. [x] Quick fixes.
2. [x] Grab / push / pull / climb, the lift hold and its animation.
3. [x] Objects across rooms (run save v5).
4. [x] Stacking.
5. [x] Jars and vessels. (Run save v6. Sigils: +1 entropy max per
       pixie in a vessel on them.)
