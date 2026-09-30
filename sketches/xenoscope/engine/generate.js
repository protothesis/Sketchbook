import { createRng } from './rng.js';
import { assignArchetype, STAR_CLASSES } from './symbols.js';
import { generateName } from './names.js';

const INNER_KINDS = ['molten', 'rocky', 'desert'];
const MID_KINDS = ['rocky', 'ocean', 'desert'];
const OUTER_KINDS = ['ice', 'ocean', 'gasGiant'];
const FAR_KINDS = ['gasGiant', 'iceGiant', 'ice'];

function pickKindForDistance(rng, t) {
  // t in [0,1], 0 = innermost orbit, 1 = outermost.
  if (t < 0.2) return rng.pick(INNER_KINDS);
  if (t < 0.55) return rng.pick(MID_KINDS);
  if (t < 0.75) return rng.pick(OUTER_KINDS);
  return rng.pick(FAR_KINDS);
}

/**
 * Generate a procedural exoplanet system from a seed. Pure function of the
 * seed string — no DOM, no rendering — so it can be called from a game, a
 * server, or this sketch's UI and always get the same system back.
 */
export function generateSystem(seed, options = {}) {
  const rng = createRng(seed);
  const planetCount = options.planetCount ?? rng.int(3, 8);
  const starClass = rng.pick(STAR_CLASSES);

  const star = {
    name: generateName(rng),
    class: starClass.id,
    color: starClass.color,
    radius: starClass.radius,
  };

  let orbitRadius = rng.range(0.6, 1.4);
  const planets = [];

  for (let i = 0; i < planetCount; i++) {
    orbitRadius *= rng.range(1.35, 1.9); // Titius-Bode-ish spacing, not exact
    const distanceFactor = planetCount > 1 ? i / (planetCount - 1) : 0;
    const kind = pickKindForDistance(rng, distanceFactor);
    const isGiant = kind === 'gasGiant' || kind === 'iceGiant';
    const size = isGiant ? rng.range(4, 9) : rng.range(0.8, 2.4);
    // period ~ radius^1.5 (toy Kepler's third law) in abstract "cycles"
    const period = Math.pow(orbitRadius, 1.5) * rng.range(0.95, 1.05);
    const phase0 = rng.range(0, Math.PI * 2);
    const moonCount = isGiant ? rng.int(0, 5) : rng.chance(0.5) ? rng.int(1, 2) : 0;

    const moons = [];
    for (let m = 0; m < moonCount; m++) {
      moons.push({
        id: `m${m}`,
        name: generateName(rng, true),
        orbitRadius: rng.range(size * 1.8, size * 4),
        period: rng.range(4, 20),
        phase0: rng.range(0, Math.PI * 2),
      });
    }

    const planet = {
      id: `p${i}`,
      index: i,
      name: generateName(rng),
      kind,
      orbitRadius,
      period,
      phase0,
      size,
      moons,
    };
    planet.archetype = assignArchetype(planet);
    planets.push(planet);
  }

  return { seed: String(seed), star, planets };
}
