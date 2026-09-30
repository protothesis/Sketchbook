import { generateSystem, getPositions, computeAspects } from '../engine/index.js';
import { createOrrery } from './scene3d.js';
import { createChart } from './chart.js';

const ASPECT_LABELS = {
  conjunction: 'Conjunction',
  sextile: 'Sextile',
  square: 'Square',
  trine: 'Trine',
  opposition: 'Opposition',
};

const els = {
  seedInput: document.getElementById('seed-input'),
  randomSeedBtn: document.getElementById('random-seed-btn'),
  generateBtn: document.getElementById('generate-btn'),
  playBtn: document.getElementById('play-btn'),
  speedInput: document.getElementById('speed-input'),
  speedLabel: document.getElementById('speed-label'),
  timeLabel: document.getElementById('time-label'),
  systemInfo: document.getElementById('system-info'),
  aspectList: document.getElementById('aspect-list'),
  orreryContainer: document.getElementById('orrery'),
  chartContainer: document.getElementById('chart'),
};

const orrery = createOrrery(els.orreryContainer);
const chart = createChart(els.chartContainer);

let system = null;
let t = 0;
let playing = true;
let speed = 1;
let lastFrame = performance.now();

function randomSeed() {
  return Math.random().toString(36).slice(2, 8);
}

function renderSystemInfo() {
  els.systemInfo.textContent =
    `${system.planets.length} bodies orbiting a ${system.star.class.replace('-', ' ')} star — seed "${system.seed}"`;
}

function renderAspectList(aspects, positions) {
  els.aspectList.innerHTML = '';
  if (aspects.length === 0) {
    const li = document.createElement('li');
    li.className = 'aspect-empty';
    li.textContent = 'No active aspects at this moment.';
    els.aspectList.appendChild(li);
    return;
  }
  aspects.forEach((asp) => {
    const a = positions.find((p) => p.id === asp.a);
    const b = positions.find((p) => p.id === asp.b);
    const li = document.createElement('li');
    li.className = 'aspect-item';
    li.style.setProperty('--aspect-color', asp.color);
    li.textContent = `${a.archetype.glyph} ${a.name} — ${ASPECT_LABELS[asp.aspect]} — ${b.archetype.glyph} ${b.name}`;
    els.aspectList.appendChild(li);
  });
}

function tick() {
  const positions = getPositions(system, t);
  const aspects = computeAspects(positions);
  orrery.update(positions);
  chart.render(positions, aspects);
  renderAspectList(aspects, positions);
  els.timeLabel.textContent = `Cycle ${t.toFixed(2)}`;
}

function regenerate(seed) {
  system = generateSystem(seed);
  els.seedInput.value = system.seed;
  orrery.setSystem(system);
  t = 0;
  renderSystemInfo();
  tick();
}

function frame(now) {
  const dt = (now - lastFrame) / 1000;
  lastFrame = now;
  if (playing && system) {
    t += dt * speed;
    tick();
  }
  orrery.render();
  requestAnimationFrame(frame);
}

els.generateBtn.addEventListener('click', () => regenerate(els.seedInput.value.trim() || randomSeed()));
els.randomSeedBtn.addEventListener('click', () => regenerate(randomSeed()));
els.playBtn.addEventListener('click', () => {
  playing = !playing;
  els.playBtn.textContent = playing ? 'Pause' : 'Play';
});
els.speedInput.addEventListener('input', () => {
  speed = Number(els.speedInput.value);
  els.speedLabel.textContent = `${speed.toFixed(1)}×`;
});

regenerate(randomSeed());
requestAnimationFrame(frame);
