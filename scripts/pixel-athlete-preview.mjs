import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PIXEL_MOTIONS } from './lib/pixel-athlete-motion.mjs';

const canvas = document.getElementById('viewport'), loading = document.getElementById('loading');
const bytes = Uint8Array.from(atob(__ATHLETE_GLB__), c => c.charCodeAt(0));
const url = URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' }));
document.getElementById('download').href = url;
window.addEventListener('pagehide', () => URL.revokeObjectURL(url));
async function initialize() {
  try {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.10;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#e9ece9');
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 30);
    const controls = new OrbitControls(camera, canvas); controls.target.set(0, 1.0, 0);
    controls.enableDamping = true; controls.enablePan = false; controls.minZoom = .65; controls.maxZoom = 5;
    controls.maxPolarAngle = Math.PI * .70;
    scene.add(new THREE.HemisphereLight('#fff7e9', '#7997a7', 2.1));
    const key = new THREE.DirectionalLight('#fff0db', 2.3); key.position.set(-3, 5, 4); scene.add(key);
    const fill = new THREE.DirectionalLight('#d1e5fa', .9); fill.position.set(3, 2, -4); scene.add(fill);
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer, '');
    const model = gltf.scene; scene.add(model);
    model.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
    const racket = model.getObjectByName('BadmintonRacket'); racket.visible = true;
    const skeleton = new THREE.SkeletonHelper(model); skeleton.visible = false; scene.add(skeleton);
    // Restrained ground pad keeps the static silhouette easy to judge.
    const pad = new THREE.Mesh(new THREE.CircleGeometry(.54, 48), new THREE.MeshBasicMaterial({ color: '#d2dcd6' }));
    pad.rotation.x = -Math.PI / 2; pad.position.y = .028; scene.add(pad);
    let currentView = 'three-quarter';
    const mixer = new THREE.AnimationMixer(model), actions = new Map(gltf.animations.map(c => [c.name, mixer.clipAction(c)]));
    let active, animation = 'BindPose', paused = false;
    const notes = { Idle: '弓腰屈膝候球，持拍手保持准备姿态。', Sidestep: '低重心左右往返，迈步脚与跟进脚交替支撑。',
      Run: '原地跑动预览，手臂保持持拍姿态。', Jump: '下蹲、蹬地、腾空、落地缓冲。', Forehand: '侧身引拍、转髋挥拍、随挥回收。',
      Backhand: '胸前引拍，肘部外展，挥拍后沿胸前回收。', Smash: '起跳引拍、高点下压、落地回收。',
      Lunge: '前脚跨出接球，后脚支撑，随后收回。', Serve: '低手引拍向前上方送出。', BindPose: '静态外观，保持建模姿态。' };
    function setPaused(value) {
      paused = value;
      document.getElementById('pause').textContent = value ? '继续' : '暂停';
      document.getElementById('pause').setAttribute('aria-pressed', String(value));
    }
    function progress() {
      const duration = PIXEL_MOTIONS[animation]?.duration ?? 0, time = active?.time ?? 0;
      document.getElementById('timeline').value = duration ? String(time / duration) : '0';
      document.getElementById('motion-time').textContent = `${time.toFixed(2)} / ${duration.toFixed(2)} 秒`;
    }
    function selectAnimation(name, immediate = false) {
      showCourt(false);
      if (name === 'BindPose') { mixer.stopAllAction(); model.traverse(o => { if (o.isSkinnedMesh) o.skeleton.pose(); }); active = null; }
      else {
        const next = actions.get(name); if (!next) return;
        if (immediate) mixer.stopAllAction();
        next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).setLoop(THREE.LoopOnce, 1);
        next.clampWhenFinished = true; next.play();
        if (active && active !== next && !immediate) next.crossFadeFrom(active, .12, false);
        active = next; mixer.update(0);
      }
      animation = name; setPaused(name === 'BindPose');
      pad.position.y = name === 'BindPose' ? .028 : 0;
      document.querySelectorAll('[data-animation]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.animation === name)));
      document.getElementById('motion-note').textContent = notes[name];
      view(currentView === 'face' ? 'three-quarter' : currentView); progress();
    }
    function seek(seconds) {
      if (!active) return;
      const duration = PIXEL_MOTIONS[animation].duration;
      mixer.stopAllAction(); active.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).setLoop(THREE.LoopOnce, 1).play();
      active.clampWhenFinished = true; active.time = THREE.MathUtils.clamp(seconds, 0, duration - .000001); mixer.update(0);
      setPaused(true); model.updateMatrixWorld(true); progress();
    }
    for (const [name, label] of [['BindPose', '静态外观'], ...Object.entries(PIXEL_MOTIONS).map(([n, m]) => [n, m.label])]) {
      const button = document.createElement('button'); button.dataset.animation = name; button.textContent = label;
      button.setAttribute('aria-pressed', 'false'); button.addEventListener('click', () => selectAnimation(name));
      document.getElementById('animations').append(button);
    }
    function showCourt(value) {
      document.getElementById('court-preview').hidden = !value;
      document.getElementById('court-toggle').setAttribute('aria-pressed', String(value));
      document.getElementById('court-toggle').textContent = value ? '返回模型' : '球场效果';
      const caption = document.querySelector('.caption');
      caption.style.color = value ? '#f3f2df' : '';
      document.getElementById('caption-note').textContent = value ? '现有球场 · 角色外观比较截图' : '像素风 3D 运动员 · 动作预览';
      document.getElementById('caption-note').style.color = value ? '#d5e3d8' : '';
    }
    function view(name) {
      showCourt(false);
      currentView = name;
      const views = { front: [0, 1.06, 4], side: [4, 1.06, 0], back: [0, 1.06, -4], 'three-quarter': [2.6, 1.42, 4], face: [0, 1.74, 4] };
      const high = ['Jump', 'Smash', 'Forehand'].includes(animation), halfHeight = high ? 1.48 : 1.12;
      camera.position.set(...views[name]); camera.zoom = name === 'face' ? 4 : 1;
      controls.target.set(0, name === 'face' ? 1.74 : high ? 1.25 : 1.0, 0);
      camera.top = halfHeight; camera.bottom = -halfHeight;
      resize(); controls.update();
      document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === name)));
    }
    function resize() {
      const r = canvas.parentElement.getBoundingClientRect(), pixels = Number(document.getElementById('pixels').value);
      renderer.setPixelRatio(pixels === 1 ? Math.min(devicePixelRatio || 1, 2) : 1);
      renderer.setSize(Math.max(1, Math.round(r.width / pixels)), Math.max(1, Math.round(r.height / pixels)), false);
      canvas.style.imageRendering = pixels > 1 ? 'pixelated' : 'auto';
      const halfHeight = ['Jump', 'Smash', 'Forehand'].includes(animation) ? 1.48 : 1.12, aspect = r.width / r.height;
      camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect;
      camera.top = halfHeight; camera.bottom = -halfHeight; camera.updateProjectionMatrix();
    }
    document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.view === 'face') selectAnimation('BindPose', true); view(b.dataset.view);
    }));
    document.getElementById('pause').addEventListener('click', () => setPaused(!paused));
    document.getElementById('replay').addEventListener('click', () => selectAnimation(animation, true));
    document.getElementById('previous-frame').addEventListener('click', () => seek((active?.time ?? 0) - 1 / 30));
    document.getElementById('next-frame').addEventListener('click', () => seek((active?.time ?? 0) + 1 / 30));
    document.getElementById('timeline').addEventListener('input', e => seek(Number(e.target.value) * (PIXEL_MOTIONS[animation]?.duration ?? 0)));
    document.getElementById('pixels').addEventListener('change', resize);
    document.getElementById('court-toggle').addEventListener('click', () => showCourt(document.getElementById('court-preview').hidden));
    document.getElementById('rotate').addEventListener('change', e => { controls.autoRotate = e.target.checked; });
    document.getElementById('racket').addEventListener('change', e => { racket.visible = e.target.checked; });
    document.getElementById('skeleton').addEventListener('change', e => { skeleton.visible = e.target.checked; });
    document.getElementById('reset').addEventListener('click', () => { controls.autoRotate = false; document.getElementById('rotate').checked = false; view('three-quarter'); });
    new ResizeObserver(resize).observe(canvas.parentElement); resize(); selectAnimation('Idle', true);
    let last = performance.now();
    function render(now) {
      const dt = Math.min(.05, Math.max(0, (now - last) / 1000)); last = now;
      if (!paused && active) {
        mixer.update(dt * Number(document.getElementById('speed').value));
        if (active.time >= PIXEL_MOTIONS[animation].duration) {
          if (document.getElementById('loop').checked) { active.reset().play(); mixer.update(0); }
          else setPaused(true);
        }
      }
      progress(); controls.update(); skeleton.updateMatrixWorld(true); renderer.render(scene, camera); requestAnimationFrame(render);
    }
    requestAnimationFrame(render); loading.hidden = true;
    window.pixelAthletePreview = { ready: true, renderer, model, skeleton, controls, camera, mixer, view, selectAnimation, seek,
      pose(name, seconds = 0) { selectAnimation(name, true); seek(seconds); },
      capture() { renderer.render(scene, camera); return canvas.toDataURL('image/png'); },
      snapshot() { return { view: currentView, animation, paused, time: active?.time ?? 0, animations: [...actions.keys()], bones: skeleton.bones.length, calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles, width: canvas.width, height: canvas.height, racket: racket.visible }; } };
  } catch (error) { console.error(error); loading.textContent = '无法显示角色，请使用支持 WebGL 2 的浏览器并开启硬件加速。'; }
}
initialize();
