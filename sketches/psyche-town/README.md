# Psyche Town

**Started:** 2026-10-04
**Status:** prototype

A Sims-like little town where each person is quietly contested by
autonomous forces of the psyche (Jungian-flavoured complexes). When one of
them overpowers the ego, the person changes colour and starts behaving
differently. Click anyone to see their inner "constellation" and the chain
of events that got them there.

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

## How it works (first pass)

- **Complexes** (`engine/psyche.js`): Ego, Persona, Shadow, Frightened
  Child, Abyss, Guardian, Caretaker. Each autonomous complex has a charge
  (0–1) that decays toward the person's temperament. Charge above a
  threshold leaks along affinity links (fear → rage, fear → despair, rage ↔
  despair, Caretaker soothes the rest).
- **Who's in charge**: the Ego keeps the wheel while its *hold* (resilience,
  worn down by fatigue and night, propped up by the Persona and by being
  cared for) beats every complex. When a complex exceeds the hold it takes
  over, and it feeds on itself a little so grips have momentum.
- **Behaviour** (`engine/town.js`): the ruling complex steers. The Shadow
  goes to its grievance's door (a break-in) or prowls. The Child runs home.
  The Abyss drifts to the edge of town, away from everyone. The Guardian
  holds the doorstep and confronts nearby Shadows. The Caretaker rushes to
  fights and to whoever is suffering.
- **Contagion**: the Shadow raises fear and Guardian charge in people
  nearby. Suffering moves people inclined to tend toward the Caretaker. A
  gripped Caretaker drains rage, fear and despair from everyone around them.
- **Life events** arrive at random (job loss, break-ups, humiliation,
  grief, eviction, sleeplessness, kindness) and are logged per person, so
  "how they got here" is always readable.
- **Inspector** (`ui/constellation.js`): an Obsidian-style force graph of
  the person's complexes. Node size is charge, flowing links show where
  charge is currently leaking, and the ruler gets the "in charge" ring while
  the Ego is pulled off-centre toward it.
- **You can intervene**: *Sit with them* (sustained care), *Confront*
  (watch it escalate), or *Give them a hard day*.
- Controls: Hardship, Care, Armed homes, speed, new town.

Open `index.html` directly. There's no build step or server.

## Possible directions

- Teach responses: scenarios where you have to de-escalate, with feedback.
- More complexes (Trickster, Lover, the Puer, Hero), and relationships
  (bonds, grudges, family) so contagion follows real ties.
- Personal history/trauma that makes particular events hit harder.
- An LLM "inner voice" per complex, so clicking someone also shows what
  each force is *saying* to them.
- Port the psyche model into the solarpunk worldbuilding project as a
  community-level layer (how do a town's institutions catch people?).
