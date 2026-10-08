# Psyche Town

**Started:** 2026-10-04
**Status:** active

Each person's psyche is a little orrery. The ego is the sun, shaped by an
Enneagram type and wrapped in the persona's shield. Archetypes are planets
on their own orbits, swelling and shrinking on their own rhythms. Whichever
planet pulls hardest on the sun, if it out-pulls the ego's hold, is in
charge. The angles between planets make the person's psychological weather.

Three pages:

- **Town** (`index.html`): a Sims-like town of people seized, and usually
  released, by these forces. Click anyone to see their orrery and the
  chain of events that got them there.
- **Lab** (`lab.html`): one psyche up close. Throw life events at them,
  sit with them, let them sleep, reroll their type and chart.
- **Wiki** (`wiki.html`): every archetype, Enneagram type, named weather
  and concept, generated from the same data the sim runs on. Tapping
  anything in an orrery, a tug-of-war bar or a weather chip opens the
  same entries in a side drawer.

## The idea

We're less rational than we like to think. Much of what people do comes
from **autonomous forces** that seize them, often set off by something bad
that just happened, and usually **temporary**. The sim tries to make that
easy to feel at a glance:

- A person in the grip of rage isn't a fixed "criminal". They're someone
  whose Shadow got loud after a humiliation or a break-up, and given time
  and safety it will usually let go.
- Despair can wear the voice of reason ("there is only one way out"). In
  the sim, the Abyss only becomes lethal when its host is isolated and
  unattended. Being held in a protective situation is what saves people.
- A frightened homeowner's Guardian meeting someone else's Shadow at the
  door is the worst collision in the town. Toggling **Armed homes** changes
  whether that ends in a death or in an ugly fight both people survive.
  Each lost life also reports roughly how long the grip would have taken to
  release if the person had simply been kept safe.

The long-term hope is to also model how people *typically* respond to these
forces, and to let the user practise better responses (sitting with
someone, not escalating, stepping between people).

## How it works

**The psyche** (`engine/psyche.js`, data in `engine/archetypes.js`):

- **Planets.** Everyone carries a Shadow. Beyond that, each person draws 3
  to 12 of 20 archetypes, weighted toward the ones their Enneagram type
  keeps close. The 20 are Shadow, Frightened Child, Abyss, Guardian,
  Caretaker, Trickster, Lover, Hero, Martyr, Inner Critic, Hermit, Puer,
  Senex, Hungry Ghost, Rebel, Tyrant, Mourner, Innocent, Sage and Fool.
- **Orbits.** Each planet has a distance from the ego, an eccentricity, a
  period, and a *breath*: its own slow cycle of swelling and shrinking.
- **Mass and pull.** mass = resting size × breath + charge from life
  events. pull ≈ mass / distance². Charge also drags a planet's orbit
  inward, so the same blow lands harder when that planet happens to be
  near its closest point.
- **Hold and the shield.** The ego's hold starts from its Enneagram
  baseline. Fatigue and night wear it down; company, being cared for and
  an at-ease "growth" lean firm it up. It's drawn as the persona shield
  ring, whose thickness is the hold, and it cracks when a planet captures
  the sun. Capture uses hysteresis, and a ruling planet feeds itself a
  little, so grips have momentum but decay.
- **Weather.** Aspects between weighty planets (conjunction ☌, square □,
  trine △, opposition ☍) change how charge flows between them. Twelve
  pairings are named, such as Cornered (Shadow ☌ Child), The Verdict
  (Critic ☌ Abyss), Tenderness (Lover △ Caretaker) and Integration
  (Sage △ Shadow). Every other pair gets a generic effect: fusion,
  friction, ease or a tug of war.
- **Enneagram.** The type sets the baseline hold, which events cut deepest
  (×1.5), and which planets orbit close. Under stress the ego leans toward
  its disintegration point, and that type's sore spots start to hurt too.
  At ease it leans toward its growth point, and its hold firms up.

**The town** (`engine/town.js`):

- **Movement.** Whoever rules a person picks how they move. The Shadow
  goes to its grievance's door (a break-in), the Child runs home, the
  Abyss drifts to the edge of town, the Guardian holds its doorstep, the
  Caretaker goes to fights and suffering, the Hungry Ghost goes back to
  the market, the Rebel agitates in the plaza, and so on.
- **Auras.** A gripped person radiates their archetype's aura into the
  psyches of people nearby (only into archetypes those people actually
  have). The Shadow frightens, the Caretaker and Sage calm, the Fool
  deflates Inner Critics, and the Rebel spreads.
- **Irreversible outcomes.**
  - A Guardian at home who confronts a Shadow for too long with
    **Armed homes** on kills them. Heroes, and unarmed Guardians, fight
    instead, and both people live.
  - The Abyss is lethal only when its host is left alone, unattended, for
    long enough.
  - Every loss reports how long the grip would likely have taken to pass.
- **Controls.** Hardship, Care (how common and heavy the caring
  archetypes are, and how strongly care soothes), Armed homes, and the
  per-person actions: sit with them, confront, give them a hard day.

Everything opens directly from disk; there's no build step or server.

## Possible directions

- Teach responses: scenarios where you have to de-escalate, with feedback.
- Relationships (bonds, grudges, family) so contagion follows real ties.
- Tuning and robustness: the town's Shadow ⇄ Child ⇄ Guardian loops run a
  little hot, and the Care slider still has only a modest effect.
- Personal history/trauma that makes particular events hit harder.
- An LLM "inner voice" per complex, so clicking someone also shows what
  each force is *saying* to them.
- Port the psyche model into the solarpunk worldbuilding project as a
  community-level layer (how do a town's institutions catch people?).
