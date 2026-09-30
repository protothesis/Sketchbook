function normalizeDeg(d) {
  return ((d % 360) + 360) % 360;
}

/**
 * Query a system's state at fictional time `t` (in abstract "cycles" — the
 * same units as each body's `period`). Orbits are simplified to circular and
 * coplanar for this sketch: position is fully determined by phase0, period,
 * and t, so any moment (past, future, "now") can be queried directly without
 * simulating the moments in between.
 */
export function getPositions(system, t) {
  return system.planets.map((p) => {
    const angle = p.phase0 + (2 * Math.PI * t) / p.period;
    const longitudeDeg = normalizeDeg((angle * 180) / Math.PI);
    return {
      id: p.id,
      name: p.name,
      kind: p.kind,
      archetype: p.archetype,
      angle,
      longitudeDeg,
      x: Math.cos(angle) * p.orbitRadius,
      y: Math.sin(angle) * p.orbitRadius,
      moons: p.moons.map((m) => {
        const mAngle = m.phase0 + (2 * Math.PI * t) / m.period;
        return { id: m.id, name: m.name, angle: mAngle };
      }),
    };
  });
}
