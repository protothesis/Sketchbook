// The "natural" style: the original look. A hillshaded elevation ramp under
// soft vector contours, crop-coloured fields, cased cream roads, buildings
// coloured by category and round tree crowns, fading into paper at the edge.
//
// A style is plain data (see notes/style-system.md): colours are palette
// names or literals, widths are { m, px } (metres, never thinner than px
// screen pixels), zoom is [min, max) of view.scale, and any value can be
// stops over view.scale ({ z: [[scale, value], …] }). Layers draw bottom to
// top with the named function from VG.render.draw.
(function (global) {
  'use strict';
  var VG = (global.VillageGen = global.VillageGen || {});
  VG.styles = VG.styles || {};

  VG.styles.natural = {
    id: 'natural',
    label: 'Natural',
    paper: 'theme',
    palette: {
      water: 'rgb(140, 188, 210)', shore: 'rgba(70, 120, 150, 0.55)',
      contour: 'rgba(110, 86, 60, 0.22)', contourMajor: 'rgba(110, 86, 60, 0.36)',
      fieldEdge: 'rgba(96, 120, 70, 0.55)', furrow: 'rgba(120, 92, 50, 0.22)',
      grove: '#6f9b55', olive: '#7f9466',
      green: '#b5d293', greenEdge: 'rgba(90,120,60,0.5)', square: '#ece0c6', squareEdge: 'rgba(150,130,100,0.6)',
      pond: '#8fbcd6', stone: '#6d7d8a', stoneEdge: '#4b5a66',
      bridge: '#6b625a',
      wall: 'rgba(70, 50, 36, 0.75)', ridge: 'rgba(255, 240, 220, 0.45)', mill: '#5d4b3b', door: '#5a3d2a',
      floor: '#f4ead7', floorWall: '#4a3a2c', roomWall: '#6b5644', roomText: '#5b4636',
      treeShadow: 'rgba(40, 50, 30, 0.18)',
      select: '#1f6feb', selectHover: 'rgba(31, 111, 235, 0.6)', selectWay: 'rgba(31, 111, 235, 0.55)', selectPath: 'rgba(31, 111, 235, 0.85)',
      halo: 'rgba(250, 246, 236, 0.9)', tab: 'rgba(250, 246, 236, 0.86)', tabHover: 'rgba(255, 252, 244, 0.97)',
      tabEdge: 'rgba(120, 100, 80, 0.55)', tabInk: '#6b5a48', known: '#2f7d62', landing: '#56708a',
      ink: '#2e2620', inkSoft: '#5b4a3a', inkStrong: '#3b2f25', scaleGround: 'rgba(250, 246, 236, 0.85)'
    },
    categoryColors: {
      residential: '#d4876a', commercial: '#d8a24e', craft: '#b9875d', civic: '#7d8fba', religious: '#9b80bb',
      agricultural: '#a88c5c', industrial: '#8d939b'
    },
    fonts: {
      street:   { weight: 500, size: 11, family: 'system-ui, sans-serif' },
      building: { weight: 600, size: 11.5, family: 'system-ui, sans-serif' },
      room:     { weight: 500, family: 'system-ui, sans-serif' },
      place:    { weight: 600, size: 24, family: 'Georgia, "Times New Roman", serif' },
      placeSub: { style: 'italic', size: 13, family: 'Georgia, serif' },
      tab:      { style: 'italic', size: 12, family: 'Georgia, serif' },
      landing:  { style: 'italic', size: 11, family: 'Georgia, serif' },
      scale:    { size: 11, family: 'system-ui, sans-serif' }
    },
    // Interaction overrides, shared by every layer that shows them.
    states: {
      highlight: { fade: 0.25 },
      select: { stroke: 'select', width: { px: 2.5 }, hover: 'selectHover', hoverWidth: { px: 2 }, building: { px: 3 },
        way: 'selectWay', wayWidth: { m: 2, px: 5 }, path: 'selectPath', pathWidth: { px: 3 }, pathDash: [{ px: 6 }, { px: 4 }] }
    },
    layers: [
      { id: 'terrain', match: 'terrain', draw: 'terrain.hypso',
        paint: {
          waterShallow: [140, 188, 210], waterDeep: [84, 138, 175], depth: 0.12,
          // Hillshade: light direction, relief exaggeration (flattened as
          // reliefPerKm passes `flatten`), and the shading's gain and range.
          light: [-0.55, -0.65, 0.52], exaggeration: 1.7, flatten: 60, shade: [0.74, 1.14], shadeGain: 1.15,
          shoreGlow: [20, 18, 8], shoreSpan: 0.012
        },
        // Keyed by the environment's biome.
        byKey: {
          temperate: { ramp: [[0, [176, 201, 138]], [0.12, [196, 213, 150]], [0.3, [221, 222, 166]], [0.48, [230, 212, 160]],
            [0.66, [214, 186, 142]], [0.82, [190, 160, 128]], [0.93, [176, 166, 158]], [1, [236, 232, 226]]] },
          highland: { ramp: [[0, [168, 196, 140]], [0.2, [190, 205, 150]], [0.4, [207, 200, 150]], [0.6, [190, 172, 134]],
            [0.78, [168, 150, 128]], [0.9, [160, 156, 152]], [1, [240, 238, 234]]] },
          arid: { ramp: [[0, [222, 206, 158]], [0.25, [232, 212, 160]], [0.5, [224, 190, 138]], [0.75, [204, 164, 118]],
            [0.9, [184, 146, 112]], [1, [214, 196, 176]]] }
        } },
      { id: 'contours', match: 'contour.*', draw: 'contours', toggle: 'contours',
        paint: { stroke: 'contour', width: { px: 0.8 } },
        byKey: { major: { stroke: 'contourMajor', width: { px: 1.3 } } } },
      { id: 'river', match: 'water.river', draw: 'river', paint: { stroke: 'water', width: { px: 2.2 } } },
      { id: 'shore', match: 'shore', draw: 'shore', paint: { stroke: 'shore', width: { px: 1.2 } } },
      { id: 'fields', match: 'field.*', draw: 'fields', toggle: 'fields',
        paint: {
          fill: '#c8c08a', alpha: 0.92, rows: true, spacing: 3.2, grove: 'grove',
          outline: { stroke: 'fieldEdge', width: { m: 0.8, px: 1 }, zoom: [0.25, Infinity] },
          // Close up: furrow rows, and a grid of little trees for orchards and groves.
          detail: { stroke: 'furrow', width: { m: 0.35, px: 0.8 }, zoom: [0.9, Infinity], treeRadius: 2.2, treeSpacing: 7 }
        },
        byKey: {
          wheat: { fill: '#e2c56e' }, barley: { fill: '#e9d993' }, oats: { fill: '#d6cd8d' }, rye: { fill: '#cdb46c' },
          flax: { fill: '#aab7d4' }, fallow: { fill: '#c7a37f' }, pasture: { fill: '#a6c88a', rows: false },
          meadow: { fill: '#bad697', rows: false }, vegetables: { fill: '#8db36e' }, orchard: { fill: '#a2c486' },
          vineyard: { fill: '#b9a868', spacing: 2.2 }, millet: { fill: '#d9b96e' }, dates: { fill: '#a9b37c' },
          olives: { fill: '#aab590', grove: 'olive' }
        } },
      { id: 'plazas', match: 'plaza.*', draw: 'plazas',
        paint: { fill: 'square', stroke: 'squareEdge', width: { m: 0.4, px: 1 } },
        byKey: { green: { fill: 'green', stroke: 'greenEdge' } } },
      { id: 'landmarks', match: 'landmark.*', draw: 'landmarks',
        paint: { fill: 'stone', radius: 1.4, stroke: 'stoneEdge', width: { m: 0.3, px: 1 } },
        byKey: { pond: { fill: 'pond', radius: 3.2 } } },
      // Roads: every casing, then bridge decks, then every fill, so junctions
      // merge cleanly. `order` is bottom to top; a way's own width is its `m`.
      { id: 'road-casing', match: 'way.*', draw: 'casing',
        paint: { order: ['track', 'lane', 'street', 'road'], pad: { m: 1.4, px: 1.2 } },
        byKey: { road: { stroke: '#9a8a72', px: 2.6 }, street: { stroke: '#a39276', px: 1.8 },
          lane: { stroke: '#ad9c80', px: 1.2 }, track: { stroke: null } } },
      { id: 'bridges', match: 'bridge', draw: 'bridges', paint: { stroke: 'bridge', width: { m: 8.5, px: 4 } } },
      { id: 'roads', match: 'way.*', draw: 'ways',
        paint: { order: ['track', 'lane', 'street', 'road'] },
        byKey: { road: { stroke: '#fbf5e6', px: 2.6 }, street: { stroke: '#f8f0dd', px: 1.8 },
          lane: { stroke: '#f1e6cd', px: 1.2 }, track: { stroke: '#b89b72', px: 0.9, dash: [{ m: 3, px: 4 }, { m: 2.5, px: 3 }] } } },
      { id: 'trees-baked', match: 'tree', draw: 'trees.baked', toggle: 'trees', zoom: [0, 0.9],
        paint: { colors: ['#6a9656', '#5a8650', '#8ea35f', '#78a862'], minRadius: 0.7 } },
      { id: 'buildings', match: 'building.*', draw: 'buildings',
        paint: {
          stroke: 'wall', width: { m: 0.18, px: 0.9 },
          ridges: { stroke: 'ridge', width: { m: 0.25, px: 1 }, inset: 0.12, zoom: [1.1, Infinity] },
          // Opened up to show rooms: everything past `zoom`, or the selected one past `selected`.
          open: { fill: 'floor', stroke: 'floorWall', width: { m: 0.35, px: 1.4 }, zoom: [7, Infinity], selected: 3 },
          rooms: { stroke: 'roomWall', width: { m: 0.15, px: 1 }, text: 'roomText', font: 'room', textZoom: [11, Infinity],
            textScale: 0.16, maxSize: 1.1, minPx: 7 },
          mills: { stroke: 'mill', width: { m: 0.6, px: 1.5 }, size: 0.9, zoom: [0.8, Infinity] },
          doors: { fill: 'door', halfWidth: 0.6, depth: 0.5, zoom: [4, Infinity] }
        },
        // Keyed by the environment's biome: flat roofs and adobe homes.
        byBiome: { arid: { ridges: null, categoryColors: { residential: '#dcb68e' } } } },
      { id: 'trees', match: 'tree', draw: 'trees', toggle: 'trees', zoom: [0.9, Infinity],
        paint: {
          colors: ['#6a9656', '#5a8650', '#8ea35f', '#78a862'], edges: ['#4f7a40', '#466f3e', '#6f8546', '#5a8b48'],
          edgeWidth: 0.12, shadow: { fill: 'treeShadow', offset: [0.3, 0.35], zoom: [2, Infinity] }
        } },
      // The land dissolves into paper at the map's edge: a ring from `inner` to
      // `outer` (shares of the map's size), stops of [position, paper opacity].
      { id: 'vignette', match: null, draw: 'vignette', paint: { inner: 0.34, outer: 0.5, stops: [[0, 0], [0.7, 0.55], [1, 1]] } },
      { id: 'selection', match: null, draw: 'selection', paint: {} },
      // Screen space from here on.
      { id: 'label-destination', match: 'label.destination', draw: 'labels.destination', toggle: 'labels',
        paint: {
          font: 'tab', color: 'tabInk', known: 'known', fill: 'tab', fillHover: 'tabHover', stroke: 'tabEdge', strokeHover: 'tabInk',
          width: 1, widthHover: 1.6, padX: 7, height: 20, radius: 10,
          landing: { font: 'landing', color: 'landing', text: '⚓ landing', dy: 12 }, reach: 0.4
        } },
      { id: 'label-street', match: 'label.street', draw: 'labels.street', toggle: 'labels', zoom: [1.4, Infinity],
        paint: { font: 'street', color: 'inkSoft', minLength: 40 } },
      { id: 'label-building', match: 'label.building', draw: 'labels.building', toggle: 'labels', zoom: [1.1, Infinity],
        // Always for these; taverns from 3, everything named from 5.
        paint: { font: 'building', color: 'inkStrong', categories: ['religious', 'civic'], types: ['inn', 'manor', 'mill'],
          more: [[3, ['tavern']]], all: 5, gap: 9 } },
      { id: 'label-place', match: 'label.place', draw: 'labels.place', toggle: 'labels', zoom: [0, 1.6],
        paint: { font: 'place', color: 'ink', sub: { font: 'placeSub', color: 'inkSoft', dy: 22 }, alpha: { z: [[0.8, 1], [1.6, 0]] },
          above: 1.1, minY: 30 } },
      { id: 'scale-bar', match: null, draw: 'scaleBar',
        paint: { ground: 'scaleGround', color: 'inkStrong', width: 1.5, font: 'scale', target: 110 } }
    ],
    // Shared by every label layer.
    halo: { stroke: 'halo', width: 3.5 }
  };
})(window);
