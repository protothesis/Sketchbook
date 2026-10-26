# Action list, 2026-10-25

Two voice memos merged into one plan, then corrected in chat.

- **Oct 24, 11:53 PM** (13 min): the lamp's light as a hard cutoff; storage
  containers.
- **Oct 25, 4:31 PM** (31 min): room archetypes (storeroom, vault, safes),
  placed waystones, power sources, atmosphere regions, two kinds of depth,
  gating rules for generation, dev tools.

The source transcripts live outside the repo, in the Voice Transcriber
library (`reconstructed.md` for each).

The problem under most of it, in the Oct 25 memo's words: the dungeon still
feels random and flat, and the only goal is the next waystone. Containers,
regions and depth are all answers to that.

## Now: three pieces, in parallel (all merged)

They don't share files, and none of them waits on #26.

- A: dev panel, PR #28.
- B: lamp edge, PR #30, then reworked into light pools in PR #31.
- C: mood regions, PR #32 (GAME-DESIGN §18).

### A. Dev panel, first iteration (Oct 25)

A debug menu: give yourself any item, teleport, spawn or place creatures,
and **live sliders** for the tuning numbers, with no restart and no asking
for edits.

- The numbers already live in named tables on `DungeonPlay.walk`
  (`CREEPER`, `LIGHT`, `WELL`, …; `CREEPER.debugBands` is already a dev
  switch). A generic panel over those tables gives most of the sliders.
- Generation numbers need a "regenerate from here" to take effect.
- A new file (`app/walk/dev.js`) plus a hook. The user will come back with
  specifics after trying it.
- Later: a test level or a batch of rooms, hand-authored rooms or level
  editing.

### B. The lamp: light with a hard edge (Oct 24)

- No additive ring popping on at low fuel (`LIGHT.ringBelow` and
  `ringRadius` in `lamp.js` go away).
- Light as it is today, then a hard cutoff into the ambient shadow fill at
  the edge of its reach. The radius is always there, also at full fuel, and
  shrinks as fuel drops. Try it smaller overall.
- Banding (like the creeper's discs) is an optional style experiment.
- A truly hard edge on a three.js point light needs a shader mask; light
  falloff alone won't give it.
- **Creepers read the light's edge** (`lightReach`, `lamp.js`), so this
  changes how they behave. Check them after; tuning per creature type
  follows.

### C. Atmosphere regions, proof of concept (Oct 25)

- Today each room rolls its mood on its own
  (`space.meta.mood = m.pick(MOODS)`, `engine/expedition.js`). The moods:
  still, damp, humming, cold, echoing, dusty, breathing, tilted, warm,
  hollow.
- Proposed: a room inherits its parent's mood with high odds, and sometimes
  a new region starts from it. Maybe some moods tend to lead into others
  (junctions).
- **It must be tunable and easy to revert** (user, 2026-10-25): one knob,
  where off gives exactly today's generation. Draw the region roll on its
  own stream, so turning it off leaves every existing seed as it was.
- Turned on, it changes what seeds generate, so existing saves won't
  replay the same. Accepted.
- Not yet: mechanics per mood (dusty → dusting, §3's broom), layered
  material regions (the memo itself asks for the simple version first).

## Next: a design conversation (held 2026-10-26)

**What a save keeps** (GAME-DESIGN §17), together with **containers**.
They're the same question: do a chest's contents and a filled shelf
survive a faint? Is a container's contents world or run?

**Decided** (written up in GAME-DESIGN §17 and §19):

- **A faint moves you, it doesn't rewind.** Nothing in the world is undone:
  restoration, rooms, container contents, placed stones. Rooms since your
  save are suspended exactly as you left them; retrace to get them back.
- **Your pack stays where you fell,** marked with a flame on the maps
  while its path is still there.
- **Save lanterns** replace waystones in halls: dim, always lit, E saves
  (a bright flash, then back to dim). The only respawn. They shelter the
  lamp. Waypoints are lantern halls.
- **Waystones become carried 1x1 blocks,** powered from a jar (entropy and
  pixies differ). You build and rewire the travel network yourself.
- **Rerolls: no exception** to the commit rule.

What's already decided about containers (user, 2026-10-25):

- **Most are anything-goes.** The basic container is a few inventory slots,
  much like the player's, to take from and add to.
- Some may have slots that take only certain sizes or types of thing.
  Rarely is a general-purpose container specific.
- **Display containers allow anything but react to sets.** A bookshelf
  takes most items but reacts only to being full of books. Freeform
  placement, encouraged sets. This is GAME-DESIGN §3's sockets and "sets
  and combinations" growing up.

## Then: build, in this order

1. **Faint without rewind, and save lanterns** (GAME-DESIGN §17, §19).
   Built 2026-10-26, with hold-only doors and a choice at lost doors.
   Drop the run rollback, leave the pack where you fell (flame on the
   maps), and swap halls' waystones for save lanterns. They go together:
   the lantern is what you wake at.
2. **Waystone blocks** (§19). Replaces the doorstone-style "placed
   waystones" from the Oct 25 memo. Settle tap vs. hold for E (lift vs.
   travel) first.
3. **Inventory menu.** Parked in INTERACTION-PLAN until now.
4. **Chest** (Oct 24). Opens to show a number of slots. Seeded: some empty,
   some junk, some useful.
5. **Storeroom** (Oct 25). A late room with crates and places to stash
   them. Bring enough crates and it wakes or pays a bonus, never said
   outright. It needs block hauling, so it comes after #26 (fixed in
   PR #27). Watch for tedium: the memo itself worries that hauling crates
   from far away is a chore.

## Needs its own conversation

**Inventory and carrying weight.** Most games make inventory effectively
unlimited. The user was just frustrated by a game that didn't, but suspects
there's a way to make the limit a meaningful or fun choice. Blocks already
weigh on movement (carrying one: no running, no climbing). Abilities or
equipment could raise capacity and strength later.

- Keep inventory weight only if there's a simple hook to layer it on (one
  carried-load value feeding movement, which blocks would also use);
  otherwise park it.
- **Equipment slots** belong here too. The coin purse and the vortex
  satchel (carry a few blocks weightlessly, §19) both want one. The dropped
  pack on a faint (§17) also raises the stakes of carrying a lot.

## Later (each needs more thought)

- **Specimen cabinet** (Oct 24): jars and vessels on display; a platform
  where a vessel powers it up further.
- **Coins** (Oct 25): many kinds (metal, size, markings); a coin purse that
  is equipment, not a hotbar item, with its own sub-inventory; the **vault**
  they were looted from, where piles grow as you bring them back; **safes**
  for coins (or anything), opened by a code found elsewhere or a twitch
  lockpick.
- Dish cabinets, library shelves, display cases, pedestals that want
  statues (Oct 24).
- Open-ended display and decoration (Oct 24). Worth talking over with
  Melanie.
- Linked or fast-travel storage: a chest by a waystone reachable from
  others, like Minecraft's ender chests (Oct 24).

## Idea library

- **Movable power sources** (Oct 25): blocks that power what's next to them
  (lights, warp gates, motors, fans, sconces). They overlap with the Oct 24
  pedestals that "power up".
- **Crate stashes anywhere** (Oct 25): crates in certain numbers or
  configurations give a subtle bonus.
- **Two kinds of depth** (Oct 25): farther along a layer is more dangerous
  and chaotic (PLAY.md "Depth makes it stranger", GAME-DESIGN §16); deeper
  into layers is more uncanny (§5 "Layers", pressed doors into impossible
  space; large, comparable to seed genomes).
- **Gating rules for generation** (Oct 25): doors or room types that appear
  only after 100 rooms, three layers deep and back, or a certain find.
  Small versions exist already (doorstones from depth 2, locks).
- Atmosphere mechanics and layered material regions (after C).
