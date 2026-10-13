// The "board" style: a crisp presentation board (notes/visual-direction.md).
// Faint stepped terrain bands and hairline contours on light paper instead
// of hillshade. Inside the settlement's territory: grass, darker woods,
// patterned fields, and white buildings, squares and roads with no outline,
// so they read against the ground. Outside it: topography and grey outlines.
// Open water is crisp, flat and ended by a hard frame circle.
//
// Same shape as natural.js (see notes/style-system.md). Where the generator
// doesn't provide areas yet (area.territory / forest), the renderer stands
// in with its own.
(function (global) {
  'use strict';
  var VG = (global.VillageGen = global.VillageGen || {});
  VG.styles = VG.styles || {};

  var SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';

  VG.styles.board = {
    id: 'board',
    label: 'Board',
    // Its own paper, so the map around the land matches the land's ground.
    paper: 'paper',
    palette: {
      paper: '#f4f3ef', context: '#8f918a', line: '#a9aaa3', ink: '#22262a', inkSoft: '#5d6166',
      water: '#34565c', shallow: '#9fb8b8', sage: '#a7b18c', grass: '#bcc79b', woods: '#93a06f',
      tree: '#6f7f52', treeEdge: '#55653d', wheat: '#d6c27f', wheatLine: '#b5a061', blush: '#e9cfc6', white: '#ffffff',
      select: '#1f6feb', selectHover: 'rgba(31, 111, 235, 0.6)', selectWay: 'rgba(31, 111, 235, 0.55)', selectPath: 'rgba(31, 111, 235, 0.85)',
      tab: 'rgba(250, 249, 246, 0.92)', tabHover: '#ffffff', known: '#3d7a5c'
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
      rows:    { kind: 'lines',  spacing: 3.2, width: 0.5,  color: 'wheatLine', ground: 'wheat~0.25' },
      vines:   { kind: 'lines',  spacing: 2.2, width: 0.4,  color: 'wheatLine', ground: 'wheat~0.35' },
      stipple: { kind: 'dots',   spacing: 4,   radius: 0.45, color: 'treeEdge', ground: 'grass~0.3', stagger: true },
      orchard: { kind: 'dots',   spacing: 7,   radius: 1.8,  color: 'tree', ground: 'grass~0.25' },
      sparse:  { kind: 'dashes', spacing: 7,   width: 0.5, length: 2.4, color: 'wheatLine', ground: 'wheat~0.5', stagger: true },
      hatch:   { kind: 'lines',  spacing: 7,   width: 0.6,  color: 'line', angle: 45, px: 5 },
      ripple:  { kind: 'lines',  spacing: 6,   width: 0.7,  color: 'water~0.35', px: 4 }
    },
    // Detail inside the territory: the settlement and its land, most of the
    // way out to the frame.
    focus: { area: 'area.territory' },
    // Ends open water (and any layer that doesn't opt out).
    frame: { shape: 'circle', centre: 'origin', r: 0.47 },
    states: {
      highlight: { fade: 1, 'building.*': { fill: '@category', stroke: 'white', width: { px: 1 } } },
      select: { stroke: 'select', width: { px: 2.5 }, hover: 'selectHover', hoverWidth: { px: 2 }, building: { px: 3 },
        way: 'selectWay', wayWidth: { m: 2, px: 5 }, path: 'selectPath', pathWidth: { px: 3 }, pathDash: [{ px: 6 }, { px: 4 }] }
    },
    layers: [
      // Grass under everything inside the territory; its edge is fill only.
      { id: 'territory', match: 'area.territory', draw: 'fill', frame: false, paint: { fill: 'grass' } },
      // Woods: every wood is hatched and outlined (fading out with distance
      // from the territory), then shaded over that. A wood mostly inside
      // the territory is shaded whole, past its edge too; any other is
      // shaded only where it's near the territory (its reach).
      { id: 'forest-hatch', match: 'area.forest', filter: { focusShare: { max: 0.4 } }, draw: 'fill', frame: false, fade: 'focus',
        paint: { pattern: 'hatch', stroke: 'line', width: { px: 0.7 } } },
      { id: 'forest', match: 'area.forest', filter: { focusShare: { min: 0.4 } }, draw: 'fill', frame: false, paint: { fill: 'woods' } },
      { id: 'forest-near', match: 'area.forest', filter: { focusShare: { max: 0.4 } }, draw: 'fill', frame: false, within: 'area.reach',
        paint: { fill: 'woods' } },
      // Topography over the ground and under what's on it: stepped shading
      // inside the territory only; contour lines everywhere, fading out
      // unevenly far from it, and a little stronger closer in.
      { id: 'bands', match: 'terrain', draw: 'terrain.bands', focus: 'inside', frame: false,
        paint: { fill: 'ink', alpha: 0.2 } },
      { id: 'contours', match: 'contour.*', draw: 'stroke', toggle: 'contours', frame: false, fade: 'focus',
        paint: { stroke: 'ink', width: { px: 0.55 }, alpha: { z: [[0.08, 0.3], [1, 0.5]] } },
        byKey: { major: { width: { px: 1 } } } },
      { id: 'fields', match: 'field.*', draw: 'fill', focus: 'inside', toggle: 'fields',
        paint: { fill: 'wheat~0.25', pattern: 'rows', align: 'field' },
        byKey: {
          pasture: { fill: 'grass~0.3', pattern: 'stipple', align: null }, meadow: { fill: 'grass~0.3', pattern: 'stipple', align: null },
          orchard: { fill: 'grass~0.25', pattern: 'orchard' }, olives: { fill: 'grass~0.25', pattern: 'orchard' },
          dates: { fill: 'grass~0.25', pattern: 'orchard' }, vineyard: { fill: 'wheat~0.35', pattern: 'vines' },
          fallow: { fill: 'wheat~0.5', pattern: 'sparse' }
        } },
      { id: 'fields-context', match: 'field.*', draw: 'stroke', focus: 'outside', toggle: 'fields',
        paint: { stroke: 'line', width: { px: 0.6 } } },
      { id: 'plazas', match: 'plaza.*', draw: 'fill', focus: 'inside', paint: { fill: 'white' } },
      // Water, crisp with no outline and ended by the frame. The open sea and
      // lakes mostly inside the territory are solid; other lakes are solid
      // only near it and a light horizontal hatch beyond.
      { id: 'water', match: 'water.*', filter: { sea: true }, draw: 'fill', paint: { fill: 'water' } },
      { id: 'lakes', match: 'water.lake', filter: { focusShare: { min: 0.4 } }, draw: 'fill', paint: { fill: 'water' } },
      { id: 'lakes-hatch', match: 'water.lake', filter: { focusShare: { max: 0.4 } }, draw: 'fill', frame: false, fade: 'focus',
        paint: { pattern: 'ripple' } },
      { id: 'lakes-near', match: 'water.lake', filter: { focusShare: { max: 0.4 } }, draw: 'fill', within: 'area.reach',
        paint: { fill: 'water' } },
      { id: 'river', match: 'water.river', draw: 'river', paint: { stroke: 'water', width: { px: 1.6 } } },
      { id: 'landmarks', match: 'landmark.*', draw: 'landmarks', focus: 'inside',
        paint: { fill: 'line', radius: 1.4, stroke: 'white', width: { px: 0.6 } },
        byKey: { pond: { fill: 'water', radius: 3.2, stroke: 'water' } } },
      // Roads: white with no outline inside, so they read as gaps; outside,
      // a grey edge keeps them visible on the paper.
      { id: 'road-casing', match: 'way.*', draw: 'stroke', focus: 'outside',
        paint: { stroke: 'line' },
        byKey: { road: { width: { m: 6.5 + 1.4, px: 3.2 } }, street: { width: { m: 5 + 1.2, px: 2.4 } },
          lane: { width: { m: 3.4 + 1, px: 2 }, alpha: 0.7 }, track: { stroke: null } } },
      { id: 'bridges', match: 'bridge', draw: 'bridges', paint: { stroke: 'line', width: { m: 8.5, px: 3 } } },
      { id: 'roads', match: 'way.*', draw: 'stroke',
        paint: { stroke: 'white' },
        byKey: { road: { width: { m: 6.5, px: 2 } }, street: { width: { m: 5, px: 1.5 } }, lane: { width: { m: 3.4, px: 1 } },
          track: { width: { m: 2.4, px: 0.8 }, dash: [3, 2.5] } } },
      // Lone and edge trees (not those in a wood, which is drawn as an area),
      // solid crowns fading in between zoom 0.8 and 1.3. Colours are literals.
      { id: 'trees', match: 'tree', draw: 'trees', toggle: 'trees', focus: 'inside', zoom: [0.8, Infinity],
        paint: { colors: ['#6f7f52', '#687a4c', '#76865a', '#6b7b4f'], edges: [], edgeWidth: 0, outside: 'area.forest',
          alpha: { z: [[0.8, 0], [1.3, 1]] },
          shadow: { fill: 'rgba(0, 0, 0, 0.12)', offset: [0.25, 0.3], zoom: [2.5, Infinity] } } },
      // Buildings: white with no outline inside; a grey outline outside.
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
    // A soft paper halo keeps labels clear of the patterns.
    halo: { stroke: 'tab', width: 3 }
  };
})(window);
