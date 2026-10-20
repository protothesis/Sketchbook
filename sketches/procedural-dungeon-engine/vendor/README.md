# vendor/

Third-party code checked in so walk mode (`play.html`) works offline and from
a `file://` double-click, with no CDN dependency.

- `three/three.min.js`: three.js r160's classic/UMD build, which defines a
  global `THREE`. It's unmodified and copied from
  `sketches/xenoscope/vendor/three/build/`. three.js logs a harmless console
  deprecation warning for this build ("use ES Modules instead"). r160 is the
  last release that ships it.
