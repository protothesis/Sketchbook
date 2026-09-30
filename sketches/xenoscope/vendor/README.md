# vendor/

Third-party code checked in directly so this sketch has no runtime CDN
dependency (works offline, pinned version, nothing to break if a CDN
changes).

- `three/build/three.module.min.js` — three.js r160, minified ES module build.
- `three/examples/jsm/controls/OrbitControls.js` — matching OrbitControls.

Both are unmodified from the [three.js](https://github.com/mrdoob/three.js)
npm package (`three@0.160.0`); see `three/LICENSE`.
