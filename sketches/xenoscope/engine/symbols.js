// The invented esoteric layer: planets don't map to Earth's zodiac (these
// are alien systems with no fixed zodiac to inherit) — instead each body's
// archetype is derived from its own generated traits (composition, orbital
// position, moon count). Same system + same traits -> same archetype, always.

export const STAR_CLASSES = [
  { id: 'blue-giant', color: '#9db4ff', radius: 3.2 },
  { id: 'white', color: '#f4f2ff', radius: 1.6 },
  { id: 'yellow', color: '#ffe9a8', radius: 1.2 },
  { id: 'orange-dwarf', color: '#ffb870', radius: 0.9 },
  { id: 'red-dwarf', color: '#ff8a70', radius: 0.6 },
];

export const KIND_ARCHETYPES = {
  molten: { title: 'Ember', glyph: '◉', keywords: ['heat', 'forge', 'impulse'] },
  rocky: { title: 'Anchor', glyph: '●', keywords: ['structure', 'memory', 'ground'] },
  desert: { title: 'Wanderer', glyph: '◐', keywords: ['drought', 'patience', 'isolation'] },
  ocean: { title: 'Depth', glyph: '◍', keywords: ['flow', 'emotion', 'the hidden'] },
  ice: { title: 'Still', glyph: '◇', keywords: ['silence', 'preservation', 'distance'] },
  gasGiant: { title: 'Leviathan', glyph: '⬢', keywords: ['power', 'excess', 'gravity'] },
  iceGiant: { title: 'Veil', glyph: '⬡', keywords: ['mystery', 'cold fire', 'threshold'] },
};

const POSITION_WORDS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Outer'];

export function assignArchetype(planet) {
  const base = KIND_ARCHETYPES[planet.kind];
  const positionWord = POSITION_WORDS[Math.min(planet.index, POSITION_WORDS.length - 1)];
  const moonNote = planet.moons.length === 0 ? 'Orphan' : planet.moons.length >= 3 ? 'Throned' : null;
  const title = moonNote ? `The ${positionWord} ${base.title}, ${moonNote}` : `The ${positionWord} ${base.title}`;
  return { glyph: base.glyph, title, keywords: base.keywords };
}
