# Idea ledger, 2026-11-01

Every distinct idea for walk mode found in the voice memos and design docs,
checked against the code and CHANGELOG as of `21b0e9b` (2026-10-28). A
snapshot for planning, not a living plan: GAME-DESIGN.md and PLAY.md stay
the reference for what's decided and built.

**Since the snapshot** (merged by 2026-11-05; the rows and tally below
are left as they were):

- Inventory (PR #45, #48): a menu with tabs, item, equipment and
  collectable grids, coins and a coin purse, a backpack, and chests. This
  covers the inventory menu, treasure chest, coins and purse, and part of
  equipment slots and capacity.
- Regions with structure, mood and size layers (PR #47), shown on the map.
  This touches layered material regions and regions that know their size.
- Dev panel places, picks and deletes with a click (PR #44), partway to a
  test level.

**Status:** ✅ built · 🟡 partly built, or decided and designed but not
built · ⬜ not started.

**Sources** (voice memos live in the Voice Transcriber library,
`Documents/00 Projects/Voice Transcriber/library/<folder>/reconstructed.md`,
except Oct 22, which is in this repo):

| Tag | Source |
| --- | --- |
| V22 | Oct 22 memo, [`playtest-2026-10-22-voice-memo.md`](playtest-2026-10-22-voice-memo.md) |
| V24 | Oct 24 memo, `2026-10-24_2353_oct-24-at-11-53-pm` (light cutoff, storage) |
| V25 | Oct 25 memo, `2026-10-25_1631_oct-25-at-4-31-pm` (archetypes, regions, dev tools) |
| V29 | Oct 29 memo, `2026-10-29_1726_oct-29-at-5-26-pm` (ecology, sound, collectibles), **not yet folded into any doc** |
| GD | [`GAME-DESIGN.md`](../GAME-DESIGN.md) (§ numbers) |
| PL | [`PLAY.md`](../PLAY.md) playtest notes and future directions |
| CT | [`CLOSING-THOUGHTS.md`](../CLOSING-THOUGHTS.md) |
| EM | [`EMERGENCE.md`](../EMERGENCE.md) |
| DU | [`dusting-2026-10-27.md`](dusting-2026-10-27.md) |
| MV | Movement chat, 2026-10-26 (PLAY.md future directions) |
| DS | [`DESIGN.md`](../DESIGN.md) future directions |

## Tally

Counted by row below. An idea raised in several sources counts once in
"All" and once under each source. Built rows tend to bundle several
related ideas (e.g. "halls, waypoints, reserved footprints"), so the built
share is if anything understated.

| | Rows | ✅ | 🟡 | ⬜ | Built |
| --- | --: | --: | --: | --: | --: |
| Oct 22 memo | 13 | 10 | 0 | 3 | 77% |
| Oct 24 memo | 12 | 3 | 1 | 8 | 25% |
| Oct 25 memo | 18 | 4 | 3 | 11 | 22% |
| Oct 29 memo (new) | 26 | 0 | 1 | 25 | 0% |
| Design docs only | 48 | 10 | 4 | 34 | 21% |
| **All** | **114** | **26** | **9** | **79** | **23%** (31% with 🟡) |

Weighted by size it reads differently: nearly everything built is the core
loop (lamp, rooms, restoration basics, travel, saves, two hostile
creatures), and most of what's open is breadth (things to collect, places
to put them, creatures and sound).

## Objects, containers and collecting

| | Idea | Source |
| --- | --- | --- |
| ✅ | Push blocks with marks, crates, carrying and stacking | GD §3, IP |
| ✅ | Jars, vessels, hourglass as equipment | V22, GD §14, §17 |
| ✅ | Waystones as carried blocks you power | V25, GD §19 |
| 🟡 | Containers: rules decided (anything-goes slots; display cases react to sets), none built | V24, notes/action-list |
| 🟡 | Equipment slots (only the hourglass so far) | GD §17, §19 |
| ⬜ | Treasure chest: slots, seeded junk or useful | V24 |
| ⬜ | Inventory menu | IP, action-list |
| ⬜ | Inventory weight and capacity | V24 |
| ⬜ | Linked storage at waystones (ender-chest style) | V24 |
| ⬜ | Dish cabinet and dish sets | V24, GD §3 |
| ⬜ | Library shelves and books | V24, V25, GD §3 |
| ⬜ | Specimen cabinet / table / naturalist display frames | V24, GD §3, V29 |
| ⬜ | Pedestals and platforms that power up with the right object | V24 |
| ⬜ | Open-ended display and decoration | V24 |
| ⬜ | Storeroom that wakes when stocked with crates | V25 |
| ⬜ | Crate stashes: configurations anywhere give a subtle bonus | V25 |
| ⬜ | Coins (metals, sizes, markings) and a coin purse | V25 |
| ⬜ | Vault where coin piles grow | V25 |
| ⬜ | Safes: codes found elsewhere, or a lockpick minigame | V25 |
| ⬜ | Movable power sources (light, warp gates, fans, sconces) | V25 |
| ⬜ | Candles (pay while lit, burn down) and lanterns on spots | GD §3 |
| ⬜ | Statue heads, furniture upright, water turned back on | GD §3 |
| ⬜ | Vortex satchel | GD §19 |
| ⬜ | Maps as items (reveal a waypoint) | GD §8, PL |
| ⬜ | Seeds: harvest with a vessel, plant, genomes, crossing | GD §4 |
| ⬜ | Collectible cards for everything catalogued; a card meta-game | V29 |

## Restoration and the room

| | Idea | Source |
| --- | --- | --- |
| ✅ | Sconces that shelter the lamp | GD §3, §10 |
| ✅ | Dusting: duster, layered dither dust, clouds, motes | V25, GD §3, DU |
| ✅ | Chits and the pre-pool | DU |
| ✅ | Crusted crystals that glint | DU |
| ⬜ | Cobwebs high up (climb or jump to reach), webbed crystals | DU |
| ⬜ | Clean-room bonus: last dust forms a crystal | DU |
| ⬜ | Broom | GD §3, DU |
| ⬜ | Footprints in dust; dust returning on unused routes | DU, GD §11 |
| ⬜ | Walked paths stay lit (desire paths) | GD §11 |
| ⬜ | Restored rooms strengthen lamps and sconces; neighbours reinforce; sconces start dimmer | V29 |
| ⬜ | Setpieces ask for things from elsewhere; reward for full restoration | GD §9 |
| ⬜ | Wells you restore before they flow | GD §13 |
| ⬜ | Observatory: restore a telescope, chart the planets | V29 |

## Dungeon and generation

| | Idea | Source |
| --- | --- | --- |
| ✅ | Commit on exit, rerolls, traces and corruption | GD §1 |
| ✅ | Halls, waypoints, reserved footprints, rarer unmarked halls | GD §8, V22 |
| ✅ | Save lanterns, faints that don't rewind, packs, lost paths | GD §17, §19 |
| ✅ | Mood regions and junctions | V25, GD §18 |
| ✅ | Locks, keys, doorstones, chalk | PL |
| 🟡 | Moods with mechanics (dusty → dust is the only one) | V25, GD §18 |
| 🟡 | Soft gating by depth or progress (locks and doorstones by depth only) | V25 |
| ⬜ | Layered material regions; regions that know their size | V25, GD §18 |
| ⬜ | Room-shape engine pass (irregular shapes like halls) | V22, DS |
| ⬜ | Layers / impossible space behind pressed doors | GD §5, V25 |
| ⬜ | One-way passages, the space inside the wall, false doors | GD §5 |
| ⬜ | Two kinds of depth (along a layer vs down through layers) | V25 |
| ⬜ | Darker and stranger farther from anchors | GD §16, CT, PL |
| ⬜ | Points of no return past locks | CT, PL |
| ⬜ | Waypoint variety: false flags, threats; chapters | GD §8 |
| ⬜ | Routes: rooms generated for traversal | DS, MV |
| ⬜ | Hazards and trip hazards | MV |
| ⬜ | Secrets in a procedural map | GD open questions |
| ⬜ | Bigger rerolls earned | GD §1 |
| ⬜ | Extraction / leaving with what you charted | CT |
| ⬜ | Day/night cycle, driven by the astrology sketch's planets | V29 |

## Creatures and ecology

| | Idea | Source |
| --- | --- | --- |
| ✅ | Ghosts stay; can't reroll a room with one in it | V22, GD §12 |
| ✅ | Pixies, caught in jars, lure ghosts | V22, GD §14 |
| ✅ | Tag-and-rule ecology; light in the web | V22, EM |
| ✅ | A second, threatening creature (shadow creepers) | CT, GD §6, V24 |
| ✅ | Creatures tuned to the light's edge | V24 |
| ⬜ | Ecology debug overlay (who seeks or flees what) | EM step 2 |
| ⬜ | Stimuli with strength and reach; senses and drives | EM step 3 |
| ⬜ | More verbs: follow, consume, carry, startle | EM step 4 |
| ⬜ | A creature designed for the web (lives in the dark, eats pixies) | EM step 5 |
| ⬜ | Materials with rules (wood, glass, stone…) | EM step 6 |
| ⬜ | Something that undoes restoration | GD §6 |
| ⬜ | Something that hunts by sound | CT |
| ⬜ | Creepers spawn from wall cracks; a block over the crack seals it | V29 (recalled) |
| ⬜ | Atmospheric particle layer per room: fog, motes, wind | V29 |
| ⬜ | Living particle critters: gnats, flies, fireflies | V29 |
| ⬜ | Critters affect creatures (creepers avoid fireflies, gather at flies) | V29 |
| ⬜ | Self-regulating food chains (flies → dragonflies) | V29 |
| ⬜ | Uncanny equivalents of real wildlife | V29 |
| ⬜ | Ants that lay trails; squishable, trails break | V29 |
| ⬜ | Ground swarms that flock (pill bugs, beetles) | V29 |
| ⬜ | Outpourings of fleeing critters when something's wrong | V29 |
| ⬜ | Bestiary: spot and log every creature | V29 |
| ⬜ | Restoring a room reveals hostile creatures as benign | V29 |
| ⬜ | Befriended creatures as automation (a creature with a broom keeps rooms swept) | V29 |

## Player, abilities and travel

| | Idea | Source |
| --- | --- | --- |
| ✅ | Psychic stamina, ghost touch and dark drain, swelling reach | V22, GD §12 |
| ✅ | Lamp as a fluid meter with felt stages; hard-edged banded light pools | V22, V24, GD §10 |
| ✅ | Cover and relight the lamp | GD §10 |
| ✅ | Wells: surge and trickle, clocks in the world | V22, GD §13 |
| ✅ | Ley lines, a shard per line, links that stay | V22, GD §9 |
| ✅ | Awake waystones glow (light, emissive glyphs, shaft) | V22 |
| ✅ | Jump; camera pass | MV |
| ✅ | Gamepad | — |
| 🟡 | Dash (decided likely), phase dash | MV |
| 🟡 | Noise from movement (decided, parked until something listens) | MV, EM |
| 🟡 | Tell, don't label (wells done; ghost "?" "!!" still dev art) | GD §15 |
| ⬜ | Temporary entropy with potency | V22, GD §13 |
| ⬜ | Abilities or items that make travel cheaper or farther | V22, GD §9 |
| ⬜ | Active travel (steer or rhythm taps); re-tuning links | GD §9, PL |
| ⬜ | Different drain rates for ghosts and dark; things that restore stamina | GD §12 |
| ⬜ | Movement feel: acceleration, stopping, turning | MV |
| ⬜ | Astrology / psyche profile per seed shaping responses | V29 |
| ⬜ | Fiction: the player as an expedition ecologist | V29 |

## Sound

| | Idea | Source |
| --- | --- | --- |
| ⬜ | Any audio at all (dusting: swipe, puff, chit, pour, crystal) | DU |
| ⬜ | Rooms start hollow (wind, drips) and warm into music as restored | V29 |
| ⬜ | Each critter or particle system carries its own sound | V29 |
| ⬜ | Musical objects: powered radios / record players; caged singing specimens | V29 |
| ⬜ | Musical building blocks that combine (lighter than note blocks) | V29 |
| ⬜ | Hidden modular-synth graph driven by object placement | V29 |

## Tools and process

| | Idea | Source |
| --- | --- | --- |
| ✅ | Dev panel: give items, teleport, spawn, live sliders | V25 |
| 🟡 | Click a creature to tune it live (tables are global, not per creature) | V25 |
| 🟡 | Doc sources: notes point to memos, but per-idea footnotes don't exist | V29 |
| ⬜ | Test level, batch of rooms, hand-authored rooms | V25 |
| ⬜ | Cross-linked, wiki-style design docs with collapsible sections | V29 |
| ⬜ | Chart view shows traces, marks, "beyond a lock" | CT |

## Doc drift spotted while reading

- GAME-DESIGN.md "The loop" steps 7–8 still say "decided, not built" for
  save lanterns and waystone blocks; both were built 2026-10-26.
- GAME-DESIGN §9 still describes waking dormant waystones in halls as
  current; §19 replaced that.
- §10 and §12 still say "wake at your last waystone".
- README.md was last touched 2026-10-22.
