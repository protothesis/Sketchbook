# Hands, items and prompts: plan

Agreed in conversation, 2026-11-05, after a lot of controller play. Built in
small playtestable steps; tick them off as they land. PLAY.md describes
what's built; this file is the plan until it's all in. It supersedes the
"Hands" parts of [`INTERACTION-PLAN.md`](INTERACTION-PLAN.md) (the
carousel, F as the one use button, B toggling the hand).

**Controller first.** Feel is designed and judged on a gamepad. Keyboard
and mouse keep working (keys map onto the pad's actions), touch is legacy:
kept only while it's cheap, never designed for.

## What was wrong

- RT with empty hands does nothing, and that happens a lot (most of all
  right after setting a block down: lifting it put the duster away).
- The duster, which you use constantly, shares one carousel with chalk,
  jars, keys and empty hands, so you're always cycling past things to get
  to it, or past it to get to them.
- F means "use the item" except where the world takes over (a waystone
  wakes from F whatever you hold), so you can't predict a press.
- "Equipment" lumps a tool you swing, an item you aim and two passive bags.
- Collectables can be held but do nothing; dropping anything is a menu
  chore.
- You can't tell when you're in range to act on something (sconces worst
  of all: a playtester couldn't find the spot).

## The rules

- **X acts on the world. RT and Y act with what's in your hand, and the
  item decides what that does.** The world can respond to it; it never
  changes what the button does.
- **One thing in hand** (the lamp aside, always in the other hand), from
  one of two slots:
  - **The tool slot (RT):** the duster; more tools later.
  - **The item slot (Y):** an item, or a collectable.
- **First press draws.** RT with the duster away draws it **and swings**
  (a swing at nothing is harmless, so RT is never a dead press). Y with
  the item away draws it; the next press uses it (using an item usually
  spends something). RT and Y swap what's in hand.
- **B gets rid of it.** Tap B: put away what's in hand. Hold B (the ring):
  drop it, in front of you (see Dropping).
- **Your hand comes back.** Setting down a block (or anything else that
  emptied your hands for a moment) brings back what you had out.
- **Every Y press swings.** One generic arc, whatever's in hand (parented
  to it), so a press always visibly does something. The item decides the
  effect.

## Categories

| Kind | What | Lives | In hand via |
|---|---|---|---|
| Tools | the duster | tool slot | RT |
| Items | chalk, jars, keys, doorstones, the hourglass | items grid, backpack | Y |
| Collectables | coins, curios | collectables grid, purse, backpack | Y |
| Gear | the coin purse, the backpack | worn; never in hand | — |

"Protected through a faint" is a flag, not a category: the duster and the
hourglass keep it. The hourglass moves from equipment to items.

## Items: one verb, and the world accepts

| Item | Y does | What can accept it |
|---|---|---|
| Chalk | marks the spot in front of you | (walls, later) |
| Jar, empty | catches what the swing touches | a pixie; entropy from a well; later bugs, particles |
| Jar, full | **releases** what's in it, always | a vessel; a waystone (entropy); otherwise the floor |
| Hourglass | a jar for one pixie that you can't lose | as a jar; also a lost path's door (that's the retrace) |
| Key | swings | a locked door (unlocks it; the key is spent) |
| Doorstone | swings | a bare wall (opens a door there) |

- **Release, not "pour into X".** A full jar always empties. What's in it
  lands at a point in front of you, and whatever is there that **accepts**
  that kind takes it. Things declare what they accept (vessel: pixie or
  entropy; waystone: entropy; lost-path door: pixie; locked door: key;
  wall: doorstone; later shelves, tables, cabinets). Items don't know
  about the things they meet.
- **Nothing accepts it:** entropy makes a small **puddle**, a miniature
  well: stand in it and your lamp soaks it up, and it shrinks as you do
  (that's how a jar refuels your lamp now). A pixie flies off free.
- Keys and doorstones stay items you use, with a good *ka-chunk* (sound,
  a turn, a shove) rather than becoming automatic.

## Collectables: Y places

Collectables have no use, so their verb is **place**: the thing goes down
in front of you, or into or onto whatever in front accepts it (a shelf, a
table, a cabinet; see the surface prototype). X at one takes the most
recent thing back into your hand. At a glance, a collectable reads as
placeable, not usable: its Y slot is framed differently (round, say), and
the figure holds it out in an open hand rather than gripped at its side.

## Dropping (hold B)

- Drops what's in hand **where a carried block would go**: the spot in
  front of you, at your level, or on the top of the block in front of you.
  Nothing there to put it on (a wall): at your feet.
- In a d-pad strip, B drops the highlighted thing the same way, one per
  press.
- **Sharing a quarter tile.** Things have a size: small (coins, curios,
  chalk, keys, doorstones) or large (jars, the hourglass). A quarter tile
  holds one large thing or a small pile (a handful). Adding to a pile
  re-lays the whole cluster from a seeded pattern, like candles in
  Minecraft. A full quarter passes it to the next free one in front, or
  says there's no room. First pass: a fixed small count; the real
  footprint and pile rules come with the surface prototype.

## The d-pad strips

- **Hold a d-pad direction** and a strip opens, on the thing currently
  assigned, in its place in the lineup. The right stick scrolls it (the
  camera peek is off while a strip is open). **Let go** and the
  highlighted thing is assigned to its slot (the item slot for ◀ and ▼).
  - ◀ the tool slot (just the duster for now). ▼ collectables. ▶ items.
    ▲ free. (Swapped on 2026-11-05, from ◀ items and ▶ tools.)
- **Bags are a row below.** If you have one, its icon sits under the
  strip; push the stick down (still holding) to move into the bag's strip,
  up to come back. The backpack shows under both ◀ and ▼; the purse only
  under ▼. (Bags inside bags, later: the same down-a-row move.)
- **Strips only pick and drop.** No moving, swapping or sorting: that's
  the inventory menu's job. So putting a thing in the main grids is how
  you make it quick to reach; bags are storage.
- **The world doesn't pause** while a strip is open (first pass).
- **LB / RB** step through the item slot's current category (items or
  collectables, whichever you last picked from) without opening a strip:
  close to the old carousel.

## The HUD

The carousel becomes two slot icons, the tool slot (RT) and the item slot
(Y), with the one in hand lit, and the button glyph on each.

## The prompt over the target

X already acts on one focused target (the one you're most squarely
facing). Show it: float the button glyph **over the target itself**,
fading in and out with range, and flash the target once in a dither as it
comes into reach. (No bounding-box frames: see the build order.) Only ever that one target, so the
room never lights up. The same marker shows Y when what's in hand would
do something there (a key at a locked door). Applies to sconces,
waystones, save lanterns, doors, chests, vessels and blocks. (We removed
the old focus brackets on 2026-10-24; this comes back in the world, not
on the HUD.) Retune reach and facing at the same time, starting with
sconces.

## The waystone

X wakes a dormant waystone (from your lamp), and X uses an awake one. A
jar of entropy released at a dormant one wakes it too (it accepts
entropy). No item-specific press.

## Parked

- **Swinging the lamp** with empty hands (RT): RT draws the duster now, so
  there's no button for it. Keep in mind if the lamp grows a use.
- Surfaces with real footprints and pile counts; shelves, tables, cabinets
  that accept things; taking things back out in some order.
- Nested bags.

## Build order

1. [x] **The prompt over the target**, and sconce reach and facing.
   (The button floats over the target, and the target flashes once in a
   warm dither as it comes into reach. Sconces work from right under
   them. The Y marker for the item in hand comes with step 2.)
   **Not wanted:** brackets or a box drawn round the target's bounds
   (tried first, 2026-11-05). If a highlight is ever needed beyond the
   flash, it's a trace of the object's own outline, not its box.
2. [x] **Hands:** RT draws and swings the duster; Y draws, then uses; tap
   B puts away, hold B drops in front; your hand comes back after a block;
   the waystone on X; the generic Y swing; the two-slot HUD; LB / RB in
   the item slot's category; the hourglass becomes an item.
   (Keyboard: Q the duster, F the item slot, G put away / hold to drop.
   For now: the hourglass is an item-slot stop but still lives in the
   equipment grid; a collectable reaches the item slot only from the
   menu (Y on it) until the strips; Y with one just swings until step 5;
   dropped things sharing a quarter take seven set spots, no capacity
   yet. The Y marker over a target is still to do.)
3. [x] **The d-pad strips**, with bag rows and B to drop. (Let go takes
   the thing in hand, not just onto the slot. Centred, cells the menu's
   size, a grid row per bag with only the current row open, no text but
   the Equip / Drop buttons. Keyboard: hold 3 / 4 / 5, 1 / 2, G; no bag
   rows.)
4. [ ] **Release and accept:** jars and the hourglass fill and release;
   vessels, waystones, lost-path doors, locked doors and walls accept;
   entropy puddles your lamp soaks up.
5. [ ] **Placing collectables**, and a prototype surface (a shelf or
   table) that accepts them, with X to take back.
