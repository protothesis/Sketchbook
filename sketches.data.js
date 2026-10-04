// Manifest consumed by the root index.html gallery. Plain JS (not JSON)
// loaded via a classic <script> tag on purpose: fetch()/XHR for local files
// is blocked by browsers under file:// (no server), and this repo's gallery
// needs to work from a straight double-click, not just on GitHub Pages.
window.SKETCHES = [
  {
    slug: "xenoscope",
    title: "Xenoscope",
    description: "Procedurally generated exoplanet systems with an invented astrological aspect chart — a horoscope for a sky that only exists because you seeded it.",
    date: "2026-09-30",
    status: "prototype",
    tags: ["procgen", "astrology", "threejs", "simulation", "worldbuilding"],
    demo: "sketches/xenoscope/index.html",
  },
  {
    slug: "psyche-town",
    title: "Psyche Town",
    description: "A Sims-like town where autonomous forces of the psyche (Shadow, Abyss, Guardian…) seize people and, usually, let them go. Click anyone to see who's in charge.",
    date: "2026-10-04",
    status: "prototype",
    tags: ["canvas", "simulation", "psychology", "jung", "agents"],
    demo: "sketches/psyche-town/index.html",
  },
];
