# Emergent behaviour: a briefing

How to build systems where things interact in ways nobody wrote down, and
how that applies to this dungeon. Written 2026-10-22, alongside the first
pass (`app/walk/ecology.js`). The design context is in
[`GAME-DESIGN.md`](GAME-DESIGN.md), section 14.

## What it is

Emergence is behaviour that comes out of a system without being written
into any one part of it. Every piece follows a few local rules; the
interesting patterns happen *between* them.

- **Boids** (Craig Reynolds, 1986): every bird follows three rules (keep
  some distance, match your neighbours' heading, drift toward their
  centre). Nobody writes "flock", but you get flocks that split around
  obstacles and rejoin.
- **Breath of the Wild's "chemistry engine"**: a few elements (fire, wind,
  electricity, water) and materials (wood burns, metal conducts, grass
  spreads fire). Nobody wrote "set the grass alight to make an updraft and
  glide over the wall", but players find it.
- **Dwarf Fortress, Rain World, Noita**: creatures with needs and
  materials with properties, all running at once. The stories players tell
  about them were never scripted.

The opposite is **scripted behaviour**: "when the player places a jar,
ghosts within 5 cells go to it." That works, does exactly one thing, and
never surprises you. Emergence trades some control for surprise and for
a world that feels alive.

## The recipe

Nearly every emergent system has the same five parts.

1. **Things have properties, not identities.** A pixie isn't special-cased
   anywhere; it *wears tags*: `pixie`. A jarred pixie wears `pixie` and
   `jarred`. A sconce might wear `light`. Rules look at tags, never at
   "is this a pixie jar".
2. **A few generic verbs.** Seek, flee, follow, avoid, consume, ignite,
   carry. Each one is written once and works for anything.
3. **Rules are data.** "Who responds to what, how, how strongly": a table,
   not code. Ours today:

   | who | responds to | how | detail |
   | --- | --- | --- | --- |
   | ghost | pixie | seek | 70% of wander goals, circles it, within 12 cells and a room |
   | pixie | ghost | flee | within 2.2 cells, harder when closer |
   | pixie | well | seek | 50% of goals, its own room |

4. **A shared medium.** Things only affect each other through space: the
   room they're in, how far apart they are, whether light reaches. Space is
   what turns rules into situations.
5. **The player is one of the things.** The richest emergence happens when
   the player's own tools are entities in the web, not commands from
   outside it. A jar the player sets down is just another `pixie` in the
   room, so ghosts treat it like one.

## Why it multiplies

With **T** tags and **R** rules, you get far more than R behaviours,
because rules **chain**. Ours already does:

- pixies seek wells, and
- ghosts seek pixies, so
- **ghosts haunt wells.**

No rule says that. It falls out of two rules and some space. That's the
first second-order effect in the game, and it creates a real decision: the
well you need is where the ghosts gather. Every new tag or rule can
connect to all the existing ones, so the possibilities grow much faster
than the rule count.

## Principles

- **Consistency over cleverness.** A rule always applies. If ghosts seek
  pixies, they seek jarred ones, wild ones and ones you're carrying past.
  Players learn rules by watching, then exploit them, and exploiting a
  system is the fun. One exception ("except in closets") breaks the
  learning.
- **Make causes visible.** Emergence the player can't read looks like
  randomness. Every creature should show what it's doing and why: the
  ghost's "?" and "!!" do this today. A ghost circling a jar should *look*
  drawn to it. When we add a rule, we add a tell.
- **Few rules, orthogonal.** Each rule should do one thing that the others
  don't. Two rules that both pull ghosts toward the player are one rule
  with extra bugs.
- **Damp the loops.** Rules that feed each other can run away (ghosts
  attract more ghosts, a fire that never stops). Use caps, cooldowns,
  decay and chances below 100%. That's why seek is a 70% chance per goal,
  not "always": ghosts drift off and come back instead of locking on.
- **Watch for dominant strategies.** Catching ghosts in jars was one: one
  move that beat the threat every time. The fix was to change what the
  rule *does* (draw, not trap), not to forbid it.
- **Script the stage, not the play.** Placement (where wells and pixies
  spawn) is seeded and designed. What creatures do afterwards is run
  state. Design the ingredients and the arena, then let it run.

## Building it here, step by step

The first pass is a **tag + rule table** with two verbs (seek, flee). It's
small on purpose. These are the next steps, roughly in order, each one
playable on its own:

1. **Fold the hard-coded behaviours into the table.** Ghosts noticing your
   lamp is special-case code today. Make light a presence: the lamp wears
   `light` (and so do lit sconces and awake waystones), and "ghost notices
   light" becomes a rule. Then a pixie could seek light too, and follow
   your lamp, which draws ghosts to *you*. Interesting tension, from one
   row.
2. **A debug overlay.** Lines from each creature to what it's seeking or
   fleeing. Emergent systems are hard to tune blind.
3. **Stimuli with strength and reach,** instead of bare points: light that
   walls block, sound that carries through doors, a scent that lingers
   where something has been. Creatures get *senses* (what they can detect)
   and *drives* (what they want). That's the step from "a table of
   reactions" to "an ecosystem".
4. **More verbs:** `follow` (keep a distance, like boids), `consume` (a
   ghost drains a well, so a haunted well runs dry), `carry`, `startle`.
5. **One more creature, designed for the web,** not on its own: say,
   something that lives in the dark, flees light, and eats pixies. Each new
   creature should touch at least two existing tags.
6. **Materials, later.** The same idea for objects: wood, metal, glass,
   stone, with rules about light, sound and force. The push blocks and
   jars are the first candidates.

## Ways to structure the AI, from simplest

- **Rule table + steering** (what we have): rules produce a goal or a push;
  pushes add up like vectors. Cheap, readable, good for a handful of
  creatures.
- **Needs and drives:** each creature has meters (hunger, fear,
  curiosity) that rise and fall, and the strongest one picks the goal.
  Gives creatures moods you can read.
- **Utility AI:** score every possible action by how much the creature
  wants it right now, take the best. Flexible; harder to predict.
- **Behaviour trees / state machines:** good for a creature with a
  scripted *routine* (a ghost's notice-then-chase), poor for open-ended
  interaction. Our ghosts are one, with the ecology deciding where they
  wander.

A good mix: a small state machine for each creature's *mode* (wander,
alert, chase), with the rule table deciding *where* it goes in each mode.

## Pitfalls

- **Invisible causes:** the player sees a ghost go somewhere and can't
  tell why. Fix with tells and readable motion, not tutorials.
- **Mush:** too many weak rules and everything just drifts. Prefer a few
  strong ones.
- **Cost:** every creature checks every presence. Fine at this scale; a
  spatial index per room fixes it later if needed.
- **Determinism:** the ecology uses run-time randomness, not seeds. A
  replay rebuilds the dungeon exactly, but not where creatures went. That's
  deliberate (they're saved with the run), and worth keeping in mind if
  replays ever need to show creatures.

## Further reading

- Craig Reynolds, *Flocks, Herds, and Schools* (1987), and his steering
  behaviours paper (1999).
- The GDC talk on Breath of the Wild's physics and chemistry (2017).
- Tanya X. Short and Tarn Adams (eds.), *Procedural Storytelling in Game
  Design*, especially the chapters on simulation.
- Rain World's developers on its AI ecosystem.
