// Seeds, hashing, entropy and the per-space PRNG.
//
//   seed_child = H(seed_parent || exitIndex || entropy)
//
// H is cyrb53 (fast, non-cryptographic, 53-bit) rendered as hex; the PRNG is
// sfc32 seeded from four independent hashes of the seed string.
//
// Classic script (no import/export) on purpose: the sketch must run from a
// plain file:// double-click. Every engine file is an IIFE that hangs its
// public pieces off a shared `DungeonEngine` global. The engine never touches
// the DOM, so the same files also load under Node (see stress-test.js).
(function (global) {
  'use strict';

  function cyrb53(str, salt) {
    let h1 = 0xdeadbeef ^ (salt || 0);
    let h2 = 0x41c6ce57 ^ (salt || 0);
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }

  /** H(a || b || ...) -> 14-char hex seed string. */
  function hash() {
    const parts = Array.prototype.slice.call(arguments).map(String);
    return cyrb53(parts.join('|')).toString(16).padStart(14, '0');
  }

  function sfc32(a, b, c, d) {
    return function next() {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
      let t = (a + b) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      d = (d + 1) | 0;
      t = (t + d) | 0;
      c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    };
  }

  /** Seeded PRNG: the same seed string always yields the same stream. */
  function createRng(seed) {
    const s = String(seed);
    const next = sfc32(cyrb53(s, 1), cyrb53(s, 2), cyrb53(s, 3), cyrb53(s, 4));
    for (let i = 0; i < 12; i++) next(); // warm up
    return {
      next,
      range(min, max) { return min + next() * (max - min); },
      int(min, max) { return Math.floor(min + next() * (max - min + 1)); },
      pick(arr) { return arr[Math.floor(next() * arr.length)]; },
      chance(p) { return next() < p; },
      shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(next() * (i + 1));
          const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
        }
        return a;
      },
    };
  }

  /** Derived stream: H(seed || name), so new consumers never shift layouts. */
  function deriveRng(seed, name) {
    return createRng(hash(seed, name));
  }

  /**
   * Fresh, non-seeded randomness: what keeps unopened doors genuinely unknown.
   * Recorded on commit so the result can be replayed exactly.
   */
  function drawEntropy() {
    const c = global.crypto;
    if (c && c.getRandomValues) {
      const buf = new Uint32Array(2);
      c.getRandomValues(buf);
      return buf[0].toString(16).padStart(8, '0') + buf[1].toString(16).padStart(8, '0');
    }
    return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0') +
      Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  }

  function randomRootSeed() {
    return drawEntropy().slice(0, 8);
  }

  const DE = (global.DungeonEngine = global.DungeonEngine || {});
  DE.hash = hash;
  DE.createRng = createRng;
  DE.deriveRng = deriveRng;
  DE.drawEntropy = drawEntropy;
  DE.randomRootSeed = randomRootSeed;
})(typeof window !== 'undefined' ? window : globalThis);
