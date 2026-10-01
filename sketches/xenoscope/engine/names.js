// Small syllable-collision namer. Not linguistically rigorous — just enough
// texture that every generated body doesn't read as "Planet 3".
(function (global) {
  'use strict';

  const A = ['Ve', 'Xa', 'Ny', 'Or', 'Ka', 'Ith', 'Zu', 'Mor', 'Sel', 'Tha', 'Quo', 'Bry', 'Fen', 'Lu', 'Da', 'Ry', 'Iso'];
  const B = ['ra', 'thi', 'mon', 'sel', 'dar', 'wyn', 'tor', 'lae', 'nis', 'veh', 'dris', 'ona', 'kel', 'sha', 'rin'];
  const C = ['n', 's', 'th', 'x', 'l', 'r', ''];

  function generateName(rng, short = false) {
    let name = rng.pick(A) + rng.pick(B);
    if (!short && rng.chance(0.5)) name += rng.pick(C);
    return name;
  }

  global.Xenoscope = global.Xenoscope || {};
  global.Xenoscope.generateName = generateName;
})(window);
