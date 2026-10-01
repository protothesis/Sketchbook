# vendor/

Third-party code checked in directly so this sketch has no runtime CDN
dependency (works offline, pinned version, nothing to break if a CDN
changes) — and so it can be opened straight from `file://` with no local
server, which rules out ES modules (`<script type="module">` is blocked by
browsers when the page itself is `file://`).

- `three/build/three.min.js` — three.js r160's classic/UMD build, which
  defines a global `THREE`. Unmodified. Note: three.js prints a console
  deprecation warning for this build ("use ES Modules instead") — harmless
  here since the version is pinned and won't be upgraded out from under us.
- `three/examples/js/controls/OrbitControls.js` — OrbitControls, converted
  from the upstream ES module to a classic script. Only two lines changed:
  the top `import { ... } from 'three'` became `const { ... } = THREE`
  (destructuring off the global instead of importing), and the bottom
  `export { OrbitControls }` became `window.OrbitControls = OrbitControls`.
  The control logic in between is untouched.

Both come from the [three.js](https://github.com/mrdoob/three.js) npm
package (`three@0.160.0`); see `three/LICENSE`.
