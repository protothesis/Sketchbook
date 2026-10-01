(function (global) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const SIZE = 420;

  function createChart(container) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
    svg.setAttribute('class', 'chart-svg');
    container.appendChild(svg);

    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const outerR = SIZE / 2 - 30;
    const glyphR = outerR - 18;

    function pointFor(deg, r) {
      const rad = (deg * Math.PI) / 180;
      return [cx + Math.cos(rad) * r, cy + Math.sin(rad) * r];
    }

    function render(positions, aspectsList) {
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      const ring = document.createElementNS(NS, 'circle');
      ring.setAttribute('cx', cx);
      ring.setAttribute('cy', cy);
      ring.setAttribute('r', outerR);
      ring.setAttribute('class', 'chart-ring');
      svg.appendChild(ring);

      for (let deg = 0; deg < 360; deg += 30) {
        const [x1, y1] = pointFor(deg, outerR - 8);
        const [x2, y2] = pointFor(deg, outerR);
        const tick = document.createElementNS(NS, 'line');
        tick.setAttribute('x1', x1);
        tick.setAttribute('y1', y1);
        tick.setAttribute('x2', x2);
        tick.setAttribute('y2', y2);
        tick.setAttribute('class', 'chart-tick');
        svg.appendChild(tick);
      }

      aspectsList.forEach((asp) => {
        const a = positions.find((p) => p.id === asp.a);
        const b = positions.find((p) => p.id === asp.b);
        if (!a || !b) return;
        const [x1, y1] = pointFor(a.longitudeDeg, glyphR);
        const [x2, y2] = pointFor(b.longitudeDeg, glyphR);
        const line = document.createElementNS(NS, 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.setAttribute('stroke', asp.color);
        line.setAttribute('class', `chart-aspect chart-aspect--${asp.aspect}`);
        svg.appendChild(line);
      });

      positions.forEach((p) => {
        const [x, y] = pointFor(p.longitudeDeg, glyphR);
        const g = document.createElementNS(NS, 'g');
        g.setAttribute('class', 'chart-planet');
        g.setAttribute('transform', `translate(${x}, ${y})`);

        const bg = document.createElementNS(NS, 'circle');
        bg.setAttribute('r', 14);
        bg.setAttribute('class', 'chart-planet-bg');
        g.appendChild(bg);

        const glyph = document.createElementNS(NS, 'text');
        glyph.setAttribute('text-anchor', 'middle');
        glyph.setAttribute('dominant-baseline', 'central');
        glyph.setAttribute('class', 'chart-planet-glyph');
        glyph.textContent = p.archetype.glyph;
        g.appendChild(glyph);

        const title = document.createElementNS(NS, 'title');
        title.textContent = `${p.name} — ${p.archetype.title}`;
        g.appendChild(title);

        svg.appendChild(g);
      });
    }

    return { render };
  }

  global.Xenoscope = global.Xenoscope || {};
  global.Xenoscope.createChart = createChart;
})(window);
