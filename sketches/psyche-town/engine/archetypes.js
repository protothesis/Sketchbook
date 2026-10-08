// The psyche's vocabulary: archetypes (planets), Enneagram types (the shape
// of the ego/sun), named "weather" (aspects between planets that change the
// dynamics), and the life events that hit people. Everything here is data;
// engine/psyche.js and engine/town.js interpret it, and ui/wiki.js renders it
// into the in-app wiki. Text is deliberately brief: a sense of what each thing
// stands for and what you'll see it do in the sim.
(function () {
  var PT = (window.PsycheTown = window.PsycheTown || {});

  // tone: "dark" (distress), "fierce" (charged, outward), "light" (benign).
  // verb: how a person moves through town while this archetype rules them.
  // aura: what being near someone it rules does to *your* planets (per second,
  //   scaled by closeness; only affects archetypes you actually have).
  // orbit/period/breath/base: ranges each person's copy is drawn from.
  //   orbit: distance from the ego (0.3 = very close, 1 = far out)
  //   period: sim seconds per revolution; breath: seconds per swell cycle
  //   base: resting mass
  var ARCHETYPES = [
    { id: "shadow", name: "Shadow", color: "#d4473b", tone: "dark", verb: "prowl", universal: true,
      aura: { child: 1, guardian: 1 },
      orbit: [0.45, 0.6], period: [55, 80], breath: [90, 160], base: [0.1, 0.2],
      stands: "Everything we've disowned about ourselves: rage, envy, hunger, cruelty. Jung held that everyone has one, and that it gets more dangerous the less it's acknowledged.",
      inSim: "Everyone carries a Shadow. In its grip a person heads for the door of whoever wronged them (a break-in) or prowls toward anyone nearby. Neighbours feel it: their Frightened Child and Guardian charge up." },
    { id: "child", name: "Frightened Child", color: "#e8b53a", tone: "dark", verb: "flee",
      aura: { caretaker: 1.2, martyr: 0.8 },
      orbit: [0.4, 0.6], period: [30, 50], breath: [40, 80], base: [0.08, 0.2],
      stands: "The young, unprotected part that experiences threat and abandonment as total. It doesn't reason; it reacts.",
      inSim: "Runs home and trembles there. Its fear leaks into the Shadow, the Abyss and the Guardian, so it's often the first domino. Seeing it calls out other people's Caretakers." },
    { id: "abyss", name: "Abyss", color: "#8a63c9", tone: "dark", verb: "isolate",
      aura: { caretaker: 1.2, mourner: 0.4 },
      orbit: [0.55, 0.8], period: [80, 120], breath: [150, 260], base: [0.06, 0.16],
      stands: "Despair that speaks in the voice of reason: 'there is only one way out.' It narrows the world until there seems to be nothing else.",
      inSim: "Walks slowly to the edge of town, away from everyone. It only becomes lethal when its host is left alone and unattended for long enough. Company, a Caretaker or you sitting with them is what saves people." },
    { id: "guardian", name: "Guardian", color: "#e07b2e", tone: "fierce", verb: "guard",
      aura: {},
      orbit: [0.5, 0.75], period: [45, 70], breath: [70, 120], base: [0.06, 0.16],
      stands: "Protective aggression: the part that holds the doorway for those it loves. It's necessary, and under fear it becomes capable of irreversible things.",
      inSim: "Stands on its own doorstep and confronts any Shadow that comes close. With Armed homes on, a long enough confrontation ends in a death." },
    { id: "caretaker", name: "Caretaker", color: "#3fae84", tone: "light", verb: "tend",
      aura: { shadow: -1, child: -1, abyss: -1 },
      orbit: [0.5, 0.85], period: [50, 90], breath: [80, 140], base: [0.06, 0.18],
      stands: "The Great Mother, the urge to hold and tend. It seizes people too, but its grip calms everyone else's.",
      inSim: "Rushes toward fights and toward whoever is suffering. It drains rage, fear and despair from people nearby, keeps the Abyss from being lethal, and can step between a Guardian and a Shadow." },
    { id: "trickster", name: "Trickster", color: "#d16ba5", tone: "fierce", verb: "roam",
      aura: { trickster: 0.5, shadow: 0.3, fool: 0.5, senex: 0.3 },
      orbit: [0.6, 0.95], period: [18, 30], breath: [20, 40], base: [0.05, 0.14],
      stands: "The boundary-crosser: mischief, chaos and disruption, and sometimes the jolt that breaks a stuck pattern.",
      inSim: "Fast orbit and quick breath, so it flickers in and out. While it rules, its host wanders erratically and stirs up mischief and irritation in people around them." },
    { id: "lover", name: "Lover", color: "#e86f8a", tone: "light", verb: "crowd",
      aura: { lover: 0.4, innocent: 0.3 },
      orbit: [0.5, 0.85], period: [40, 70], breath: [60, 110], base: [0.06, 0.16],
      stands: "Longing, attraction, the pull toward union and beauty. It gives life its colour, and heartbreak is its shadow side.",
      inSim: "Seeks out the busiest places. It's charged by falling in love and by being left. In a trine with the Caretaker it brings 'Tenderness' weather that settles everything." },
    { id: "hero", name: "Hero", color: "#4f8fd9", tone: "fierce", verb: "confront",
      aura: { hero: 0.4, child: -0.4 },
      orbit: [0.55, 0.85], period: [45, 75], breath: [70, 120], base: [0.05, 0.15],
      stands: "The one who rises to the challenge and goes toward the danger. Inflated, it becomes the crusader who needs a villain.",
      inSim: "Heads straight for trouble and confronts Shadows anywhere in town, not just at home. It never kills. Conjunct with the Shadow it becomes 'Crusade': righteous rage." },
    { id: "martyr", name: "Martyr", color: "#b07a5a", tone: "light", verb: "tend",
      aura: { child: -0.6, abyss: -0.6 },
      orbit: [0.55, 0.85], period: [60, 95], breath: [100, 170], base: [0.05, 0.14],
      stands: "Care that costs the carer: self-sacrifice that can become self-erasure.",
      inSim: "Tends people like the Caretaker does, but its host's fatigue climbs the whole time, wearing down their own hold." },
    { id: "critic", name: "Inner Critic", color: "#8e9aa6", tone: "dark", verb: "withdraw",
      aura: { critic: 0.4, child: 0.2 },
      orbit: [0.4, 0.6], period: [35, 55], breath: [60, 100], base: [0.08, 0.18],
      stands: "The internal judge: the voice that measures you and finds you wanting, often an echo of someone else's voice.",
      inSim: "Sends its host home to sit still. It feeds the Abyss and the Frightened Child, and conjunct with the Abyss it forms 'The Verdict'. A Fool nearby takes the air out of it." },
    { id: "hermit", name: "Hermit", color: "#5f7d6e", tone: "light", verb: "retreat",
      aura: {},
      orbit: [0.7, 1.0], period: [90, 130], breath: [140, 220], base: [0.04, 0.12],
      stands: "Healthy withdrawal: solitude chosen in order to restore, not to disappear.",
      inSim: "Takes its host to the park to be alone. Unlike the Abyss this is restorative: fatigue drains fast while it rules." },
    { id: "puer", name: "Puer", color: "#5cc8d6", tone: "light", verb: "roam",
      aura: { puer: 0.4, fool: 0.3 },
      orbit: [0.6, 0.95], period: [22, 38], breath: [30, 60], base: [0.05, 0.14],
      stands: "The eternal youth: possibility, novelty and flight from commitment. It's charming, restless and allergic to the ordinary.",
      inSim: "Skips work and roams between the plaza and the market. It's contagious among the restless. The Senex dampens it." },
    { id: "senex", name: "Senex", color: "#7a6f5d", tone: "light", verb: "routine",
      aura: { puer: -0.4, trickster: -0.4, rebel: 0.3 },
      orbit: [0.6, 0.95], period: [100, 140], breath: [160, 260], base: [0.05, 0.14],
      stands: "The old man: order, duty, tradition and limits. It's the wisdom of structure, and the rigidity of it too.",
      inSim: "Keeps its host on a strict home-and-work loop. It quiets Pueres and Tricksters nearby but provokes Rebels. Square the Trickster it makes 'Rattled' weather." },
    { id: "hungry", name: "Hungry Ghost", color: "#6d8b2f", tone: "dark", verb: "market",
      aura: { hungry: 0.4 },
      orbit: [0.45, 0.7], period: [30, 50], breath: [40, 70], base: [0.05, 0.14],
      stands: "From Buddhist cosmology: a being with a huge belly and a tiny mouth, never satisfied. It's the compulsion that promises relief and delivers more hunger.",
      inSim: "Drives its host back to the market again and again. It feeds the Abyss, and conjunct with the Abyss it forms 'The Hollow', a loop that's hard to break." },
    { id: "rebel", name: "Rebel", color: "#c94f7c", tone: "fierce", verb: "agitate",
      aura: { rebel: 0.6, shadow: 0.2, senex: 0.3, guardian: 0.2 },
      orbit: [0.55, 0.85], period: [40, 65], breath: [60, 110], base: [0.05, 0.15],
      stands: "Refusal: the part that won't comply, for good or ill. It fuels both liberation and self-sabotage.",
      inSim: "Heads to the plaza and stirs things up. It's very contagious, spreading Rebel and a little Shadow through a crowd and putting Guardians and Senexes on edge." },
    { id: "tyrant", name: "Tyrant", color: "#9b2d2d", tone: "dark", verb: "approach",
      aura: { child: 0.8, shadow: 0.5, rebel: 0.4 },
      orbit: [0.5, 0.75], period: [50, 80], breath: [80, 140], base: [0.04, 0.12],
      stands: "Power as domination: control as a defence against feeling powerless. It's the shadow side of the King.",
      inSim: "Walks up to people and diminishes them, so everyone nearby gets a jolt of fear and resentment. Square the Frightened Child it reopens an 'Old Wound'." },
    { id: "mourner", name: "Mourner", color: "#5d6f9a", tone: "light", verb: "linger",
      aura: { mourner: 0.3, caretaker: 0.3 },
      orbit: [0.6, 0.9], period: [80, 120], breath: [130, 220], base: [0.04, 0.12],
      stands: "Grief allowed to move: sorrow that's actually felt, as opposed to despair, which is grief that's stuck.",
      inSim: "Lingers slowly in the park. It draws down the Abyss, and in a trine with it makes 'Grief Moving' weather, despair turning into mourning. Others' Caretakers are drawn to it." },
    { id: "innocent", name: "Innocent", color: "#e9d98f", tone: "light", verb: "crowd",
      aura: { shadow: -0.3, innocent: 0.2 },
      orbit: [0.55, 0.9], period: [35, 60], breath: [50, 90], base: [0.05, 0.15],
      stands: "Trust, openness and wonder: the part that expects the world to be good. Betrayal hits it hardest.",
      inSim: "Seeks company and softens Shadows around it a little. Betrayal charges it, and a shattered Innocent feeds the Frightened Child." },
    { id: "sage", name: "Sage", color: "#2f8f9d", tone: "light", verb: "wander",
      aura: { shadow: -0.4, child: -0.4, critic: -0.4 },
      orbit: [0.7, 1.0], period: [90, 140], breath: [150, 240], base: [0.04, 0.12],
      stands: "Perspective: the part that can watch the storm without becoming it. Jung's Wise Old Man or Woman.",
      inSim: "Wanders slowly, calming the Shadow, Child and Critic in everyone it passes, and it can defuse a confrontation. In a trine with the Shadow it makes 'Integration', where the Shadow is seen rather than acted out." },
    { id: "fool", name: "Fool", color: "#a6c94a", tone: "light", verb: "roam",
      aura: { critic: -0.6, abyss: -0.4, fool: 0.4 },
      orbit: [0.6, 0.95], period: [20, 35], breath: [25, 50], base: [0.05, 0.14],
      stands: "Holy foolishness: play, absurdity and the laugh that breaks a spell. In the tarot it's the zero card, the one with nothing to lose.",
      inSim: "Roams and lightens everyone near it: Inner Critics and Abysses drain, and Fools spread. Opposite the Critic it makes 'Comic Relief'." },
  ];

  // Internal affinities: charge in `from` above a threshold leaks into `to`
  // (or soothes it, if negative). Only applies if a person has both.
  var LINKS = [
    ["child", "shadow", 0.04], ["child", "abyss", 0.035], ["child", "guardian", 0.04],
    ["shadow", "abyss", 0.02], ["abyss", "shadow", 0.015], ["guardian", "shadow", 0.02],
    ["critic", "abyss", 0.04], ["critic", "child", 0.03], ["hungry", "abyss", 0.03],
    ["tyrant", "shadow", 0.03], ["rebel", "shadow", 0.02], ["innocent", "child", 0.02],
    ["caretaker", "shadow", -0.08], ["caretaker", "child", -0.08], ["caretaker", "abyss", -0.08],
    ["sage", "shadow", -0.05], ["sage", "child", -0.05], ["sage", "critic", -0.05],
    ["mourner", "abyss", -0.05], ["fool", "critic", -0.05], ["fool", "abyss", -0.04],
    ["lover", "abyss", -0.03],
  ];

  var ASPECTS = [
    { id: "conjunction", name: "Conjunction", glyph: "☌", angle: 0, orb: 12, color: "#d9d2c0",
      blurb: "Two planets side by side. Their energies fuse, and the stronger one drags the weaker along." },
    { id: "square", name: "Square", glyph: "□", angle: 90, orb: 8, color: "#e07b2e",
      blurb: "A right angle: friction. The stronger planet agitates the weaker one." },
    { id: "trine", name: "Trine", glyph: "△", angle: 120, orb: 8, color: "#3fae84",
      blurb: "A third of the circle apart: ease. Both planets settle a little faster." },
    { id: "opposition", name: "Opposition", glyph: "☍", angle: 180, orb: 12, color: "#c94f7c",
      blurb: "Opposite sides of the ego: a tug of war. If both are heavy, both grow." },
  ];

  // Named weather: specific aspects between specific archetypes.
  // leak: [from, to, w] adds w * mass(from) per second to `to`
  // drain: [id, k] removes k * charge(id) per second
  // calm: k drains every dark archetype by k * charge
  // careMult: scales how much outside care reaches this person
  var WEATHER = [
    { id: "cornered", name: "Cornered", a: "shadow", b: "child", aspect: "conjunction",
      leak: [["child", "shadow", 0.06]],
      blurb: "Fear and rage fuse. A frightened person who feels trapped lashes out, and fear turns to violence much faster than usual." },
    { id: "siege", name: "Siege", a: "guardian", b: "child", aspect: "conjunction",
      leak: [["child", "guardian", 0.06]],
      blurb: "Terror armed. Every shadow at the window is an intruder, and the Guardian charges up fast." },
    { id: "verdict", name: "The Verdict", a: "critic", b: "abyss", aspect: "conjunction",
      leak: [["critic", "abyss", 0.06]],
      blurb: "The Critic's judgement becomes the Abyss's argument: 'you are the problem, and there is one solution.' This is one of the most dangerous weathers." },
    { id: "hollow", name: "The Hollow", a: "hungry", b: "abyss", aspect: "conjunction",
      leak: [["hungry", "abyss", 0.04], ["abyss", "hungry", 0.04]],
      blurb: "Craving and emptiness feed each other: using to escape the void, and the void deepening from the using." },
    { id: "crusade", name: "Crusade", a: "hero", b: "shadow", aspect: "conjunction",
      leak: [["hero", "shadow", 0.05]],
      blurb: "Righteous rage. The Hero's courage powers the Shadow, which now believes it's doing good." },
    { id: "unreachable", name: "Unreachable", a: "abyss", b: "caretaker", aspect: "opposition",
      careMult: 0.4,
      blurb: "Despair and care pull in opposite directions. Kindness doesn't land, and help from outside reaches them at less than half strength." },
    { id: "tenderness", name: "Tenderness", a: "lover", b: "caretaker", aspect: "trine",
      calm: 0.04,
      blurb: "Love and care in harmony. Every distress settles faster." },
    { id: "grief-moving", name: "Grief Moving", a: "mourner", b: "abyss", aspect: "trine",
      leak: [["abyss", "mourner", 0.03]], drain: [["abyss", 0.05]],
      blurb: "Despair turning into grief that can actually be felt. The Abyss drains away into mourning." },
    { id: "comic-relief", name: "Comic Relief", a: "fool", b: "critic", aspect: "opposition",
      drain: [["critic", 0.06]],
      blurb: "The judge gets laughed at. The Inner Critic loses its grip." },
    { id: "rattled", name: "Rattled", a: "trickster", b: "senex", aspect: "square",
      leak: [["trickster", "senex", 0.03], ["senex", "trickster", 0.03]],
      blurb: "Chaos against order. Both get louder, and the person feels jittery and contrary." },
    { id: "old-wound", name: "Old Wound", a: "tyrant", b: "child", aspect: "square",
      leak: [["tyrant", "child", 0.05]],
      blurb: "The inner tyrant presses on the original injury, and the Frightened Child spikes." },
    { id: "integration", name: "Integration", a: "sage", b: "shadow", aspect: "trine",
      drain: [["shadow", 0.05]],
      blurb: "The Shadow seen clearly instead of acted out. Its charge drains away as understanding." },
  ];

  // Enneagram: the shape of the ego (the sun). Each type sets the sun's
  // baseline hold, which events cut deepest, which archetypes orbit close,
  // and where the ego drifts under stress (disintegration) or ease (growth).
  var ENNEAGRAM = [
    { n: 1, name: "Reformer", hold: 0.66, stress: 4, growth: 7, close: ["critic", "senex", "guardian"], vulnerable: ["humiliated", "argument"],
      desire: "to be good, right and in integrity", fear: "being corrupt or bad",
      inSim: "A firm ego with an Inner Critic in a close orbit. Humiliation and clashes with authority cut deep. Under stress it drifts toward Four (moody, withdrawn); at ease toward Seven (lighter, playful)." },
    { n: 2, name: "Helper", hold: 0.62, stress: 8, growth: 4, close: ["caretaker", "martyr", "lover"], vulnerable: ["breakup", "betrayal"],
      desire: "to be loved and needed", fear: "being unwanted",
      inSim: "Caretaker and Martyr orbit close, so they often tend others. Being left or betrayed lands hardest. Under stress they move toward Eight (controlling, aggressive)." },
    { n: 3, name: "Achiever", hold: 0.68, stress: 9, growth: 6, close: ["hero", "critic", "puer"], vulnerable: ["jobloss", "humiliated"],
      desire: "to be valuable and admired", fear: "being worthless",
      inSim: "A strong, performing ego with the Hero close by. Losing work or face hits hard. Under stress they go numb like a Nine." },
    { n: 4, name: "Individualist", hold: 0.56, stress: 2, growth: 1, close: ["mourner", "abyss", "lover"], vulnerable: ["grief", "breakup"],
      desire: "to be uniquely themselves", fear: "having no identity or significance",
      inSim: "A thinner hold, with the Mourner and Abyss in close orbits: a deep feeler. Grief and heartbreak cut deepest. Under stress they cling like a Two; at ease they gain the One's structure." },
    { n: 5, name: "Investigator", hold: 0.64, stress: 7, growth: 8, close: ["hermit", "sage", "child"], vulnerable: ["eviction", "diagnosis"],
      desire: "to be capable and competent", fear: "being helpless or overwhelmed",
      inSim: "The Hermit and Sage orbit close, with a hidden Frightened Child. Threats to resources and the body hit hardest. Under stress they scatter like a Seven." },
    { n: 6, name: "Loyalist", hold: 0.58, stress: 3, growth: 9, close: ["guardian", "child", "senex"], vulnerable: ["betrayal", "breakin"],
      desire: "security and support", fear: "being without support or guidance",
      inSim: "The Guardian and Frightened Child orbit close, so they're quick to fear and quick to defend. Betrayals and break-ins hit hardest. At ease they gain the Nine's calm." },
    { n: 7, name: "Enthusiast", hold: 0.62, stress: 1, growth: 5, close: ["puer", "fool", "hungry"], vulnerable: ["diagnosis", "jobloss"],
      desire: "to be satisfied and free", fear: "being trapped in pain or deprivation",
      inSim: "Puer, Fool and Hungry Ghost orbit close: buoyant, with a compulsive edge. Being trapped (illness, losing work) hits hardest. Under stress they turn critical like a One." },
    { n: 8, name: "Challenger", hold: 0.7, stress: 5, growth: 2, close: ["guardian", "tyrant", "rebel"], vulnerable: ["humiliated", "betrayal"],
      desire: "to protect themselves and stay in control", fear: "being controlled or harmed",
      inSim: "The strongest default hold, with the Guardian, Tyrant and Rebel close. Humiliation and betrayal provoke them. Under stress they withdraw like a Five; at ease they open up like a Two." },
    { n: 9, name: "Peacemaker", hold: 0.6, stress: 6, growth: 3, close: ["innocent", "hermit", "caretaker"], vulnerable: ["breakup", "argument"],
      desire: "inner and outer peace", fear: "loss and separation",
      inSim: "The Innocent and Hermit orbit close. Conflict and separation hit hardest. Under stress they become anxious like a Six." },
  ];

  // Life events. {other} becomes another townsperson, who becomes the
  // target of the recipient's grievance. fx only touches archetypes the
  // person actually has.
  var EVENTS = [
    { id: "jobloss", label: "Job loss", text: "lost their job", fx: { abyss: 0.4, child: 0.2, critic: 0.3, hungry: 0.2 }, w: 1 },
    { id: "breakup", label: "Break-up", text: "was left by {other}", fx: { child: 0.4, shadow: 0.3, lover: 0.3, mourner: 0.2 }, grievance: true, w: 1 },
    { id: "humiliated", label: "Humiliation", text: "was humiliated by {other} in public", fx: { shadow: 0.45, critic: 0.3, child: 0.1, tyrant: 0.2, rebel: 0.2 }, grievance: true, w: 1 },
    { id: "betrayal", label: "Betrayal", text: "was betrayed by {other}", fx: { shadow: 0.35, child: 0.3, guardian: 0.2, innocent: 0.3 }, grievance: true, w: 0.8 },
    { id: "grief", label: "Bereavement", text: "lost someone they loved", fx: { abyss: 0.45, mourner: 0.5, child: 0.15 }, w: 0.8 },
    { id: "eviction", label: "Eviction", text: "got an eviction notice", fx: { child: 0.35, abyss: 0.2, shadow: 0.15, rebel: 0.3 }, w: 0.7 },
    { id: "diagnosis", label: "Bad diagnosis", text: "got frightening news from a doctor", fx: { child: 0.4, abyss: 0.25, hero: 0.15, sage: 0.1 }, w: 0.6 },
    { id: "argument", label: "Row with boss", text: "had a blazing row with their boss", fx: { rebel: 0.4, shadow: 0.2, critic: 0.15, tyrant: 0.15 }, w: 0.8 },
    { id: "craving", label: "Temptation", text: "was offered an easy way to feel better", fx: { hungry: 0.5, puer: 0.2 }, w: 0.6 },
    { id: "sleepless", label: "Sleepless days", text: "hasn't slept properly in days", fatigue: 0.45, w: 0.9 },
    { id: "oldwound", label: "Old wound", text: "had an old wound reopened", amplify: 0.3, w: 0.6 },
    { id: "praised", label: "Praise", text: "was praised in front of everyone", fx: { hero: 0.3, critic: -0.3, lover: 0.15 }, w: 0.5, kind: true },
    { id: "kindness", label: "Kindness", text: "was shown unexpected kindness", fx: { caretaker: 0.3, shadow: -0.2, child: -0.2, abyss: -0.2, innocent: 0.2 }, w: 0.7, kind: true },
    { id: "inlove", label: "Falls in love", text: "fell for someone", fx: { lover: 0.5, fool: 0.2, innocent: 0.2 }, w: 0.5, kind: true },
  ];
  // Not drawn at random: happens to a person when a Shadow breaks in.
  var BREAKIN = { id: "breakin", label: "Break-in", text: "had their home broken into", fx: { guardian: 0.5, child: 0.3, innocent: -0.2 } };

  var CONCEPTS = [
    { id: "ego", name: "Ego (the sun)",
      stands: "The conscious 'I' at the centre of the system, the one who believes they're steering. Its shape (how firm, what it fears) comes from the person's Enneagram type.",
      inSim: "The sun holds the wheel as long as its hold is stronger than every planet's pull. When a planet's pull wins, that planet captures the sun and drives the person's behaviour until its pull fades." },
    { id: "shield", name: "Persona (the shield)",
      stands: "The social mask: routine, manners, the role you play. It isn't a force of its own; it's the layer that keeps the ego composed.",
      inSim: "Drawn as the ring around the sun. Its thickness is the ego's current hold: it thins with fatigue and at night, firms up in company and when someone is caring for you, and cracks when a planet captures the sun." },
    { id: "pull", name: "Pull and capture",
      stands: "How hard an archetype is tugging on the ego right now.",
      inSim: "Pull is mass divided by distance, roughly: big planets pull hard, and so do close ones. Each planet's mass is its resting size plus its own breath (a slow swelling and shrinking) plus any charge from life events. Charge also drags its orbit inward. Because orbits keep moving, the same blow lands harder when that planet happens to be near its closest point." },
    { id: "aspects", name: "Aspects and weather",
      stands: "Borrowed from astrology: the angle between two planets as seen from the sun.",
      inSim: "When two weighty planets line up (conjunction ☌), square off (□), harmonise (△) or oppose each other (☍), they change how charge flows between them. Some pairings have names, like Cornered, The Verdict or Tenderness. Together the active aspects are the person's psychological weather." },
    { id: "chart", name: "Each person's chart",
      stands: "Nobody carries every archetype.",
      inSim: "Everyone has a Shadow. Beyond that, each person draws between 3 and 12 archetypes, weighted toward the ones their Enneagram type keeps close. Someone without a Guardian never defends; someone without a Caretaker can't be moved to tend. Small charts are simple and brittle, while big ones have more weather and more resources." },
  ];

  var BY_ID = {};
  ARCHETYPES.forEach(function (a) { BY_ID[a.id] = a; });
  var EGO = { id: "ego", name: "Ego", color: "#e9d8a6", tone: "light" };

  PT.ARCHETYPES = ARCHETYPES;
  PT.ARCH = BY_ID;
  PT.EGO = EGO;
  PT.LINKS = LINKS;
  PT.ASPECTS = ASPECTS;
  PT.WEATHER = WEATHER;
  PT.ENNEAGRAM = ENNEAGRAM;
  PT.EVENTS = EVENTS;
  PT.BREAKIN = BREAKIN;
  PT.CONCEPTS = CONCEPTS;
  PT.colorOf = function (id) { return id === "ego" ? EGO.color : BY_ID[id].color; };
  PT.nameOf = function (id) { return id === "ego" ? "Ego" : BY_ID[id].name; };
})();
