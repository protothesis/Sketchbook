// Public API surface for embedding this engine elsewhere (a game, a server,
// another tool). Everything here is a pure function over plain data — no
// DOM, no rendering, no globals — so it ports cleanly to another runtime.
export { generateSystem } from './generate.js';
export { getPositions } from './ephemeris.js';
export { computeAspects, ASPECTS } from './aspects.js';
export { STAR_CLASSES, KIND_ARCHETYPES } from './symbols.js';
