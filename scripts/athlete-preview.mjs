import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const labels = { Idle: '站立', Run: '跑动', Sidestep: '并步', Jump: '起跳', Forehand: '正手', Backhand: '反手', Smash: '跳杀' };
const canvas = document.getElementById('viewport'), loading = document.getElementById('loading');
const base64 = __ATHLETE_GLB__;
const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
const blobURL = URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' }));
document.getElementById('download').href = blobURL;
window.addEventListener('pagehide', () => URL.revokeObjectURL(blobURL));

async function initialize() {
try {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#edf0e7');
  const camera = new THREE.PerspectiveCamera(33, 1, .01, 40);
  const controls = new OrbitControls(camera, canvas); controls.target.set(0, .99, 0);
  controls.enableDamping = true; controls.enablePan = false;
  controls.minDistance = 2.15; controls.maxDistance = 7; controls.maxPolarAngle = Math.PI * .70;
  scene.add(new THREE.HemisphereLight('#fff9e9', '#899b81', 2.0));
  const key = new THREE.DirectionalLight('#fff3dc', 2.7); key.position.set(-3, 5, 4);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -2, right: 2, top: 3, bottom: -2, near: .1, far: 12 });
  key.shadow.bias = -.00025; key.shadow.normalBias = .018; scene.add(key);
  const fill = new THREE.DirectionalLight('#dcebf0', 1.25); fill.position.set(3, 2, -3); scene.add(fill);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#edf0e7', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(.61, .64, .027, 80), new THREE.MeshStandardMaterial({ color: '#d5decb', roughness: .9 }));
  pedestal.position.y = -.0135; pedestal.receiveShadow = true; scene.add(pedestal);
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer, '');
  const model = gltf.scene; scene.add(model);
  model.traverse(object => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; object.frustumCulled = false; } });
  const skeleton = new THREE.SkeletonHelper(model); skeleton.visible = false; scene.add(skeleton);
  const mixer = new THREE.AnimationMixer(model), actions = new Map();
  let active, animationName = 'Idle', paused = false, currentView = 'three-quarter';
  for (const clip of gltf.animations) {
    actions.set(clip.name, mixer.clipAction(clip));
    const button = document.createElement('button'); button.textContent = labels[clip.name] ?? clip.name;
    button.dataset.animation = clip.name; button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => selectAnimation(clip.name)); document.getElementById('animations').append(button);
  }
  function selectAnimation(name, immediate = false) {
    const next = actions.get(name); if (!next) return;
    if (immediate) mixer.stopAllAction();
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    if (active && active !== next && !immediate) next.crossFadeFrom(active, .22, false);
    active = next; animationName = name;
    view(currentView);
    for (const button of document.querySelectorAll('[data-animation]')) button.setAttribute('aria-pressed', String(button.dataset.animation === name));
  }
  function view(name) {
    currentView = name;
    const positions = { front: [0, 1.12, 4.5], side: [4.5, 1.12, 0], back: [0, 1.12, -4.5], 'three-quarter': [2.6, 1.45, 3.7] };
    const high = ['Jump', 'Forehand', 'Backhand', 'Smash'].includes(animationName);
    const [x, y, z] = positions[name], factor = high ? 1.32 : 1;
    camera.position.set(x * factor, y + (high ? .14 : 0), z * factor); controls.target.set(0, high ? 1.14 : 1.0, 0); controls.update();
    for (const button of document.querySelectorAll('[data-view]')) button.setAttribute('aria-pressed', String(button.dataset.view === name));
  }
  for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => view(button.dataset.view));
  function setPaused(value) {
    paused = value; const button = document.getElementById('pause');
    button.textContent = paused ? '继续动作' : '暂停动作'; button.setAttribute('aria-pressed', String(paused));
  }
  document.getElementById('pause').addEventListener('click', () => setPaused(!paused));
  document.getElementById('speed').addEventListener('input', event => {
    mixer.timeScale = Number(event.target.value); document.getElementById('speed-value').value = `${mixer.timeScale.toFixed(2).replace(/0$/, '')}×`;
  });
  document.getElementById('rotate').addEventListener('change', event => { controls.autoRotate = event.target.checked; });
  document.getElementById('racket').addEventListener('change', event => { model.getObjectByName('BadmintonRacket').visible = event.target.checked; });
  document.getElementById('skeleton').addEventListener('change', event => { skeleton.visible = event.target.checked; });
  document.getElementById('reset').addEventListener('click', () => {
    controls.autoRotate = false; document.getElementById('rotate').checked = false; view('three-quarter');
  });
  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas.parentElement); resize(); view('three-quarter'); selectAnimation('Idle', true);
  let last = performance.now();
  function render(now) {
    const dt = Math.min(.05, Math.max(0, (now - last) / 1000)); last = now;
    if (!paused) mixer.update(dt);
    controls.update(dt); skeleton.updateMatrixWorld(true); renderer.render(scene, camera); requestAnimationFrame(render);
  }
  requestAnimationFrame(render); loading.hidden = true;
  document.getElementById('model-note').textContent = '骨骼绑定 · 7 种基础动作 · GLB 模型';
  // A small preview API supports export QA and future integration exploration, not gameplay.
  window.athletePreview = {
    ready: true, renderer, model, mixer, skeleton, camera, controls, view,
    snapshot() { return { animation: animationName, paused, animations: [...actions.keys()],
      bones: skeleton.bones.length, meshes: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      width: canvas.width, height: canvas.height, errors: [] }; },
    pose(name, time = 0) { selectAnimation(name, true); setPaused(true); mixer.update(time); model.updateMatrixWorld(true); skeleton.updateMatrixWorld(true); renderer.render(scene, camera); },
    capture() { renderer.render(scene, camera); return canvas.toDataURL('image/png'); }
  };
} catch (error) {
  console.error(error); loading.hidden = false;
  loading.textContent = '无法显示 3D 角色。请使用支持 WebGL 2 的浏览器，并开启硬件加速。';
}
}
initialize();
