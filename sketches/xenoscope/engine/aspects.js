(function (global) {
  'use strict';

  const ASPECTS = [
    { id: 'conjunction', angle: 0, orb: 6, color: '#e0b34f' },
    { id: 'sextile', angle: 60, orb: 4, color: '#4fae7c' },
    { id: 'square', angle: 90, orb: 5, color: '#d15b4f' },
    { id: 'trine', angle: 120, orb: 6, color: '#4f8de0' },
    { id: 'opposition', angle: 180, orb: 6, color: '#b34fd1' },
  ];

  /**
   * Given a positions array (from getPositions), find every pair of bodies
   * whose angular separation falls within an aspect's orb. Each pair is
   * classified into at most one aspect (the closest-matching one).
   */
  function computeAspects(positions) {
    const results = [];
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i];
        const b = positions[j];
        let diff = Math.abs(a.longitudeDeg - b.longitudeDeg);
        if (diff > 180) diff = 360 - diff;

        let best = null;
        for (const asp of ASPECTS) {
          const delta = Math.abs(diff - asp.angle);
          if (delta <= asp.orb && (!best || delta < best.delta)) {
            best = { asp, delta };
          }
        }
        if (best) {
          results.push({
            a: a.id,
            b: b.id,
            aspect: best.asp.id,
            angle: diff,
            orbUsed: best.delta,
            color: best.asp.color,
          });
        }
      }
    }
    return results;
  }

  global.Xenoscope = global.Xenoscope || {};
  global.Xenoscope.ASPECTS = ASPECTS;
  global.Xenoscope.computeAspects = computeAspects;
})(window);
