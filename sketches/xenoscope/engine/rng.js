// Deterministic RNG: a string seed always reproduces the same system.
// (xfnv1a hash -> mulberry32 PRNG, both public-domain small-hash recipes.)
//
// Classic script (no import/export) on purpose: this sketch must run from a
// plain file:// double-click, where browsers block ES module loading. Each
// engine/ui file is an IIFE that hangs its public pieces off a shared
// `Xenoscope` global instead.
(function (global) {
  'use strict';

  function hashStringToSeed(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return () => {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return h >>> 0;
    };
  }

  function mulberry32(seed) {
    let a = seed;
    return function next() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createRng(seedString) {
    const seed = hashStringToSeed(String(seedString))();
    const next = mulberry32(seed);
    return {
      next,
      range(min, max) {
        return min + next() * (max - min);
      },
      int(min, max) {
        return Math.floor(this.range(min, max + 1));
      },
      pick(arr) {
        return arr[this.int(0, arr.length - 1)];
      },
      chance(p) {
        return next() < p;
      },
    };
  }

  global.Xenoscope = global.Xenoscope || {};
  global.Xenoscope.createRng = createRng;
})(window);
