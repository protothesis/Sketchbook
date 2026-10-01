// Expects the classic (non-module) three.min.js and OrbitControls.js to
// have already loaded as global THREE / OrbitControls.
(function (global) {
  'use strict';

  const KIND_COLORS = {
    molten: 0xff6a3d,
    rocky: 0xb08968,
    desert: 0xe0b26a,
    ocean: 0x3d8ff0,
    ice: 0xbfe8ff,
    gasGiant: 0xe0a86a,
    iceGiant: 0x7fd6d0,
  };

  const SCALE = 4; // compress AU-like orbit units into scene units

  function createOrrery(container) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0a09);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
    camera.position.set(0, 22, 26);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 6;
    controls.maxDistance = 90;

    scene.add(new THREE.AmbientLight(0x404040, 1.2));

    let starMesh = null;
    let starLight = null;
    let planetMeshes = [];
    let orbitLines = [];

    function resize() {
      const w = container.clientWidth;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    new ResizeObserver(resize).observe(container);
    resize();

    function disposeMesh(obj) {
      if (!obj) return;
      scene.remove(obj);
      obj.geometry?.dispose();
      obj.material?.dispose();
    }

    function clearSystem() {
      disposeMesh(starMesh);
      if (starLight) scene.remove(starLight);
      planetMeshes.forEach(disposeMesh);
      orbitLines.forEach(disposeMesh);
      starMesh = null;
      starLight = null;
      planetMeshes = [];
      orbitLines = [];
    }

    function setSystem(system) {
      clearSystem();

      const starGeo = new THREE.SphereGeometry(system.star.radius, 24, 24);
      const starMat = new THREE.MeshBasicMaterial({ color: system.star.color });
      starMesh = new THREE.Mesh(starGeo, starMat);
      scene.add(starMesh);

      starLight = new THREE.PointLight(system.star.color, 3, 0, 0.4);
      scene.add(starLight);

      system.planets.forEach((planet) => {
        const r = planet.orbitRadius * SCALE;
        const points = new Array(65).fill(0).map((_, i) => {
          const a = (i / 64) * Math.PI * 2;
          return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
        });
        const orbitGeo = new THREE.BufferGeometry().setFromPoints(points);
        const orbitMat = new THREE.LineBasicMaterial({ color: 0x554f47, transparent: true, opacity: 0.6 });
        const orbitLine = new THREE.LineLoop(orbitGeo, orbitMat);
        scene.add(orbitLine);
        orbitLines.push(orbitLine);

        const isGiant = planet.kind === 'gasGiant' || planet.kind === 'iceGiant';
        const color = KIND_COLORS[planet.kind] ?? 0xffffff;
        const geo = new THREE.SphereGeometry(planet.size * (isGiant ? 0.35 : 0.55), 16, 16);
        const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData.planetId = planet.id;
        scene.add(mesh);
        planetMeshes.push(mesh);
      });
    }

    function update(positions) {
      positions.forEach((pos) => {
        const mesh = planetMeshes.find((m) => m.userData.planetId === pos.id);
        if (mesh) mesh.position.set(pos.x * SCALE, 0, pos.y * SCALE);
      });
    }

    function render() {
      controls.update();
      renderer.render(scene, camera);
    }

    return { setSystem, update, render };
  }

  global.Xenoscope = global.Xenoscope || {};
  global.Xenoscope.createOrrery = createOrrery;
})(window);
