// The "board" style: a crisp presentation board (notes/visual-direction.md).
// Flat stepped terrain bands and hairline contours instead of hillshade, land
// use told apart by pattern rather than colour, white buildings on settled
// ground, streets as the paper-white gaps between things, and quiet
// spaced-out capitals. Full detail inside the settlement's boundary, context
// outlines outside it, all ending at a hard frame circle.
//
// Same shape as natural.js (see notes/style-system.md). Where the generator
// doesn't provide areas yet (area.boundary / settled / forest), the renderer
// stands in with its own.
(function (global) {
  'use strict';
  var VG = (global.VillageGen = global.VillageGen || {});
  VG.styles = VG.styles || {};

  var SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  var ROADS = ['track', 'lane', 'street', 'road'];

  VG.styles.board = {
    id: 'board',
    label: 'Board',
    paper: 'theme',
    palette: {
      paper: '#f5f3ee', context: '#8f918a', line: '#a9aaa3', ink: '#22262a', inkSoft: '#5d6166',
      water: '#34565c', shallow: '#9fb8b8', forest: '#4b5a3a', sage: '#a7b18c',
      wheat: '#cdb980', blush: '#e9cfc6', white: '#ffffff', road: '#fbfaf7',
      select: '#1f6feb', selectHover: 'rgba(31, 111, 235, 0.6)', selectWay: 'rgba(31, 111, 235, 0.55)', selectPath: 'rgba(31, 111, 235, 0.85)',
      tab: 'rgba(251, 250, 247, 0.92)', tabHover: '#ffffff', known: '#3d7a5c'
    },
    // Shown only by the "what's here" highlight (and the legend).
    categoryColors: {
      residential: 'blush', commercial: 'wheat', craft: 'wheat~0.4', civic: 'shallow', religious: 'shallow~0.3',
      agricultural: 'sage', industrial: 'line'
    },
    fonts: {
      street:   { weight: 500, size: 9.5, family: SANS, caps: true, tracking: 0.12 },
      building: { weight: 600, size: 9.5, family: SANS, caps: true, tracking: 0.1 },
      room:     { weight: 500, family: SANS },
      place:    { weight: 600, size: 17, family: SANS, caps: true, tracking: 0.28 },
      placeSub: { weight: 500, size: 10, family: SANS, caps: true, tracking: 0.16 },
      tab:      { weight: 600, size: 9.5, family: SANS, caps: true, tracking: 0.12 },
      landing:  { weight: 600, size: 9, family: SANS, caps: true, tracking: 0.12 },
      scale:    { size: 10, family: SANS, caps: true, tracking: 0.08 }
    },
    patterns: {
      rows:    { kind: 'lines',  spacing: 3.2, width: 0.45, color: 'wheat', ground: 'wheat~0.55' },
      vines:   { kind: 'lines',  spacing: 2.2, width: 0.35, color: 'wheat', ground: 'wheat~0.6' },
      stipple: { kind: 'dots',   spacing: 4,   radius: 0.4,  color: 'sage', ground: 'sage~0.55', stagger: true },
      orchard: { kind: 'dots',   spacing: 7,   radius: 1.6,  color: 'sage', ground: 'sage~0.65' },
      sparse:  { kind: 'dashes', spacing: 7,   width: 0.45, length: 2.4, color: 'wheat', ground: 'wheat~0.75', stagger: true },
      crowns:  { kind: 'crowns', spacing: 8,   radius: 2.7,  color: 'sage~0.15', ground: 'sage~0.45', edge: 'forest~0.35', edgeWidth: 0.3 }
    },
    focus: { area: 'area.boundary' },
    frame: { shape: 'circle', centre: 'origin', r: 0.47 },
    states: {
      highlight: { fade: 1, 'building.*': { fill: '@category', stroke: 'white', width: { px: 1 } } },
      select: { stroke: 'select', width: { px: 2.5 }, hover: 'selectHover', hoverWidth: { px: 2 }, building: { px: 3 },
        way: 'selectWay', wayWidth: { m: 2, px: 5 }, path: 'selectPath', pathWidth: { px: 3 }, pathDash: [{ px: 6 }, { px: 4 }] }
    },
    layers: [
      { id: 'bands', match: 'terrain', draw: 'terrain.bands',
        paint: { ground: 'paper', fill: 'context', alpha: 0.22, water: 'water' } },
      { id: 'contours', match: 'contour.*', draw: 'stroke', toggle: 'contours',
        paint: { stroke: 'line', width: { px: 0.5 }, alpha: 0.75 }, byKey: { major: { width: { px: 0.9 } } } },
      // Faint ground under everything inside the boundary; its edge is fill only.
      { id: 'territory', match: 'area.boundary', draw: 'fill', paint: { fill: 'paper', alpha: 0.75 } },
      { id: 'forest', match: 'area.forest', draw: 'fill', focus: 'inside', toggle: 'trees',
        paint: { fill: 'sage~0.15', pattern: 'crowns' } },
      { id: 'forest-context', match: 'area.forest', draw: 'stroke', focus: 'outside', toggle: 'trees',
        paint: { stroke: 'line', width: { px: 0.6 }, dash: [1.5, 2.5] } },
      { id: 'fields', match: 'field.*', draw: 'fill', focus: 'inside', toggle: 'fields',
        paint: { fill: 'wheat~0.55', pattern: 'rows', align: 'field' },
        byKey: {
          pasture: { fill: 'sage~0.55', pattern: 'stipple', align: null }, meadow: { fill: 'sage~0.55', pattern: 'stipple', align: null },
          orchard: { fill: 'sage~0.65', pattern: 'orchard' }, olives: { fill: 'sage~0.65', pattern: 'orchard' },
          dates: { fill: 'sage~0.65', pattern: 'orchard' }, vineyard: { fill: 'wheat~0.6', pattern: 'vines' },
          fallow: { fill: 'wheat~0.75', pattern: 'sparse' }
        } },
      { id: 'fields-context', match: 'field.*', draw: 'stroke', focus: 'outside', toggle: 'fields',
        paint: { stroke: 'line', width: { px: 0.6 } } },
      { id: 'settled', match: 'area.settled', draw: 'fill', focus: 'inside', paint: { fill: 'wheat~0.74' } },
      { id: 'plazas', match: 'plaza.*', draw: 'fill', focus: 'inside',
        paint: { fill: 'wheat~0.9' }, byKey: { green: { fill: 'sage~0.45' } } },
      { id: 'river', match: 'water.river', draw: 'river', paint: { stroke: 'water', width: { px: 1.6 } } },
      // The coastline hairline runs on past the frame.
      { id: 'shore', match: 'shore', draw: 'shore', frame: false, paint: { stroke: 'water', width: { px: 0.8 } } },
      { id: 'landmarks', match: 'landmark.*', draw: 'landmarks', focus: 'inside',
        paint: { fill: 'line', radius: 1.4, stroke: 'white', width: { px: 0.6 } },
        byKey: { pond: { fill: 'water', radius: 3.2 } } },
      // Roads: a thin grey casing, then paper-white fills, so streets read
      // as gaps; main roads get an ink edge up close. Tracks are a dashed hairline.
      { id: 'road-casing', match: 'way.*', draw: 'stroke',
        paint: { stroke: 'line' },
        byKey: { road: { width: { m: 6.5 + 1.4, px: 3.4 } }, street: { width: { m: 5 + 1.2, px: 2.6 } },
          lane: { width: { m: 3.4 + 1, px: 2 }, alpha: 0.7 }, track: { stroke: null } } },
      { id: 'road-edge', match: 'way.road', draw: 'stroke', zoom: [1.2, Infinity],
        paint: { stroke: 'ink', alpha: 0.6, width: { m: 6.5 + 1.2, px: 3.4 } } },
      { id: 'bridges', match: 'bridge', draw: 'bridges', paint: { stroke: 'ink', width: { m: 8.5, px: 3 } } },
      { id: 'roads', match: 'way.*', draw: 'stroke',
        paint: { stroke: 'road' },
        byKey: { road: { width: { m: 6.5, px: 2 } }, street: { width: { m: 5, px: 1.4 } }, lane: { width: { m: 3.4, px: 0.9 } },
          track: { stroke: 'context', width: { px: 0.7 }, dash: [3, 2.5] } } },
      { id: 'trees', match: 'tree', draw: 'trees', toggle: 'trees', focus: 'inside', zoom: [1.6, Infinity],
        paint: { colors: ['#6f7c58', '#65724f', '#7d8862', '#727f5a'], edges: ['#4b5a3a', '#4b5a3a', '#4b5a3a', '#4b5a3a'],
          edgeWidth: 0.1, shadow: { fill: 'rgba(0,0,0,0)', offset: [0, 0], zoom: [Infinity, Infinity] } } },
      // Buildings: white, no outline, inside; a grey outline outside.
      { id: 'buildings', match: 'building.*', draw: 'fill', focus: 'inside', paint: { fill: 'white' } },
      { id: 'buildings-context', match: 'building.*', draw: 'stroke', focus: 'outside', paint: { stroke: 'context', width: { px: 0.6 } } },
      // Close up, floor plans (natural's function, in board colours).
      { id: 'interiors', match: 'room', draw: 'buildings', toggle: 'interiors', zoom: [7, Infinity],
        paint: {
          stroke: 'line', width: { px: 0.6 }, ridges: null,
          open: { fill: 'white', stroke: 'ink', width: { m: 0.3, px: 1.2 }, zoom: [7, Infinity], selected: 3 },
          rooms: { stroke: 'line', width: { m: 0.12, px: 0.8 }, text: 'inkSoft', font: 'room', textZoom: [11, Infinity],
            textScale: 0.14, maxSize: 1, minPx: 7 },
          mills: { stroke: 'ink', width: { px: 1 }, size: 0.9, zoom: [Infinity, Infinity] },
          doors: { fill: 'ink', halfWidth: 0.6, depth: 0.4, zoom: [Infinity, Infinity] }
        } },
      { id: 'selection', match: null, draw: 'selection', paint: {} },
      // Screen space from here on.
      { id: 'label-destination', match: 'label.destination', draw: 'labels.destination', toggle: 'labels',
        paint: {
          font: 'tab', color: 'ink', known: 'known', fill: 'tab', fillHover: 'tabHover', stroke: 'ink', strokeHover: 'ink',
          width: 0.8, widthHover: 1.6, padX: 8, height: 19, radius: 2,
          landing: { font: 'landing', color: 'water', text: '⚓ landing', dy: 12 }, reach: 0.4
        } },
      { id: 'label-street', match: 'label.street', draw: 'labels.street', toggle: 'labels', zoom: [1.6, Infinity],
        paint: { font: 'street', color: 'inkSoft', minLength: 40 } },
      { id: 'label-building', match: 'label.building', draw: 'labels.building', toggle: 'labels', zoom: [1.3, Infinity],
        paint: { font: 'building', color: 'ink', categories: ['religious', 'civic'], types: ['inn', 'manor', 'mill'],
          more: [[3, ['tavern']]], all: 5, gap: 8 } },
      { id: 'label-place', match: 'label.place', draw: 'labels.place', toggle: 'labels', zoom: [0, 1.6],
        paint: { font: 'place', color: 'ink', sub: { font: 'placeSub', color: 'inkSoft', dy: 18 }, alpha: { z: [[0.8, 1], [1.6, 0]] },
          above: 1.1, minY: 30 } },
      { id: 'scale-bar', match: null, draw: 'scaleBar',
        paint: { ground: 'tab', color: 'ink', width: 1, font: 'scale', target: 110 } }
    ],
    // A soft paper halo keeps labels clear of hatching.
    halo: { stroke: 'tab', width: 3 }
  };
})(window);
