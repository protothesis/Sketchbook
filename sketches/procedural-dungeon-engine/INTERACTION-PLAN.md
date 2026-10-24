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
3. [ ] Hold-to-act ring: doors (open/close/reroll), chalk wipe, sconces
       (light/snuff), waystones.
4. [ ] Hands: lantern slot, one held thing shown on the figure, touch
       collect for tools, keys as a tool (F to unlock).
5. [ ] Carrying blocks and jars; pull removed; run save v4.
6. [ ] Jar swipe: pixies, well entropy, pouring.
