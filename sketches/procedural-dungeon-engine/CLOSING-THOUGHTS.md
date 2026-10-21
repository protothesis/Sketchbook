# Walk mode: closing thoughts

Notes written after the first long stretch of walk-mode work (2026-10-19 to
2026-10-20, merged in protothesis/Sketchbook#17). It's a look back and
some musing about directions. **None of this is a plan.** It's a set of
thoughts to pick from (or ignore) the next time we sit down with it, and
anything here gets designed properly in chat before it's built.

For what exists and how it's tuned, see [`PLAY.md`](PLAY.md). For engine
decisions, see [`NOTES.md`](NOTES.md).

## What we built

Walk mode started as "can we walk around inside the generator?" and became
a small game loop on top of the engine:

- **A third-person walk:** a lantern-lit figure, WASD and a touch stick,
  crouch, and a one-step climb onto low blocks.
- **Doors that generate as you open them,** and closing one collapses the
  whole branch behind it for entropy. That's the engine's reroll, turned
  into a decision.
- **Traces:** a collapsed room is gone but not forgotten. New rooms over
  its footprint carry cracked, imprinted tiles.
- **Light as the main input:** the lantern casts real shadows, ghosts
  notice you only when that light actually reaches them, and crouching
  lowers it.
- **Hash ghosts:** they notice you in two stages, follow slowly and
  relentlessly, wobble and glitch the screen, and get caught in jars.
- **Jars and sigils:** set a jar as a trap, lead a ghost into it, and stand
  a full jar on a sigil for +1 entropy max (up to four per sigil).
- **Smaller pieces:** keys and locked doors ("beyond a lock" rooms),
  doorstones, chalk marks in five colours, a hotbar with group slots,
  minimap and big map.

## What's working

- **The engine's idea became the game's mechanic without being forced.**
  "Space only exists once you open a door" is something you feel in walk
  mode, not just a property of the data. Rerolling became a choice with a
  price.
- **The systems feed each other.** Collapsing leaves traces, cracked floor
  draws ghosts, the lantern draws their attention, crouching and blocks
  break line of sight, jars turn the danger into power at sigils, and that
  power is more entropy to collapse with. It already reads as one loop
  rather than a pile of features.
- **Determinism held up under all of it.** Loot, locks, sigils, blocks and
  ghost spawns each come from the room's seed on their own named stream, so
  adding things never shifted older rolls. Replay, the chart view and every
  playtester's copy agree. Even a door pressed into a wall is a recorded
  engine event (`carve`). That's what kept the playtesting honest.
- **Playtesting drove it.** Most of the good changes came straight from
  play sessions and from your sister's remote ones: the dither, light
  matching shadows, slower ghosts, jars as the only way to collect.

## What's creaking

- **`app/play.js` is about 3,200 lines.** It holds the world, figure,
  collision, ghosts, inventory, HUD, maps and post-processing in one file.
  It's still workable, but it's the next thing to get painful. Splitting it
  into a handful of classic-script files (world, figure, ghosts, inventory,
  HUD/maps, effects) would cost about an hour and change no behaviour.
- **Two saves that can drift apart.** The expedition (shared with the
  chart view) and the run (inventory, jars, marks, ghosts) are saved
  separately. That's useful, but the chart view can change the map under a
  run without the run knowing.
- **No save-format version.** Old saves have been patched case by case
  (door chalk → doorstones, pins dropped, echoes dropped). A version number
  with small migrations would make this calmer as more items arrive.
- **Nothing pushes back yet.** There's no pressure or lose state, so
  entropy, keys and jars have value but no real cost. You can always just
  keep walking.
- **Some things are tracked but unused:** `run.unmade` (ghosts undone by
  collapses), "beyond a lock" rooms, the `showRecord` expedition screen, and
  the imprint layers under cracked tiles. Each is a hook waiting for an
  idea.

## Directions worth thinking about

Not ranked and not committed to: just the threads that felt most alive.

- **Give depth teeth.** Let depth and how much floor is cracked push the
  dungeon toward the uncanny: more ghosts, darker rooms, a shrinking
  lantern, stranger moods. Collapsing would then be a retreat to safer
  ground, not only a reroll. This is the "depth makes it stranger" idea
  in `PLAY.md`.
- **Points of no return.** Past a lock, rooms could refuse to collapse, or
  cost far more to undo. "Beyond a lock" is already marked from seeds,
  ready to hang this on.
- **Something that hunts.** Hash ghosts are a gentle introduction. A second
  entity that actually threatens you (drains charges, steals ghosts out of
  jars, follows sound rather than light) would make hiding and light
  discipline matter.
- **Spend what's piling up:**
  - `run.unmade` could feed a corruption that grows the more you erase.
  - Rooms past a lock could hold the relic, vaults, or a way down.
  - Chalk marks could become a small language, where marks on or around
    sigils do things.
  - Imprint layers could carry the old room's mood or hazards into the new
    one.
- **Extraction.** The record screen still exists. Something like "leave
  with what you've charted" could give a run a shape, with a beginning and
  an end worth recording.
- **Housekeeping before the next big feature:** split `play.js`, add a
  versioned run save, and maybe show traces, marks and "beyond a lock" in
  the chart view too, so the two views tell the same story.

## How we worked

- Bigger features went best when we talked the design through first: a
  few bullets, two or three real questions, then build. Small tweaks went
  straight to code.
- Keeping every number as a named tunable made tuning in play cheap.
- Testing ran on a separate address (127.0.0.1) so it never touched the
  live save in the built-in browser. `tools/serve.py` (no-cache headers)
  keeps every playtester, local or remote, on the same files.
