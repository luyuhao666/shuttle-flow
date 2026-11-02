// Validate the exported GLB, then exercise its offline preview in real Electron.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname, basename } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import validator from 'gltf-validator';
import { ANIMATION_NAMES, JOINT_COUNT } from './lib/athlete-model.mjs';
import { verifyAthleteMotion } from './lib/verify-athlete-motion.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = join(root, 'assets', 'characters', 'anime-athlete-v1');
const artifacts = join(root, 'artifacts'); await mkdir(artifacts, { recursive: true });
const data = await readFile(join(directory, 'athlete.glb'));
const report = await validator.validateBytes(new Uint8Array(data), { uri: 'athlete.glb', maxIssues: 100 });
await writeFile(join(artifacts, 'athlete-glb-validation.json'), JSON.stringify(report, null, 2));
assert.equal(report.issues.numErrors, 0, JSON.stringify(report.issues.messages));
assert.equal(report.issues.numWarnings, 0, JSON.stringify(report.issues.messages));
const gltf = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
assert.deepEqual(gltf.animations.map(clip => clip.name), ANIMATION_NAMES);
assert.ok(gltf.scene.getObjectByName('RacketContact'));
const motionMetrics = verifyAthleteMotion(gltf);
await writeFile(join(artifacts, 'athlete-motion-checks.json'), JSON.stringify(motionMetrics, null, 2));
const mixer = new THREE.AnimationMixer(gltf.scene), bounds = {};
for (const clip of gltf.animations) {
  mixer.stopAllAction(); const action = mixer.clipAction(clip).reset().play();
  let extent = 0;
  for (const fraction of [0, .25, .48, .75, 1]) {
    action.time = Math.min(clip.duration * fraction, clip.duration - .00001); mixer.update(0);
    gltf.scene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    gltf.scene.traverse(object => {
      if (!object.isMesh) return;
      if (object.isSkinnedMesh) {
        object.skeleton.update(); object.computeBoundingBox(); box.union(object.boundingBox.clone().applyMatrix4(object.matrixWorld));
      } else { object.geometry.computeBoundingBox(); box.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld)); }
    });
    const size = box.getSize(new THREE.Vector3());
    assert.ok(size.toArray().every(value => Number.isFinite(value) && value < 4), `${clip.name} valid deformed bounds: ${size.toArray()}`);
    assert.ok(box.min.y > -.20, `${clip.name} does not fall substantially through the floor: ${box.min.y}`);
    extent = Math.max(extent, size.length());
  }
  bounds[clip.name] = extent;
}

const profile = await mkdtemp(join(artifacts, '.athlete-check-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const runtime = createRequire(import.meta.url)('electron');
const browser = spawn(runtime, [join(root, 'desktop', 'athlete-preview.cjs'), '--athlete-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`
], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let log = '', socket, sequence = 0;
browser.stderr.on('data', chunk => { log += chunk; });
const pending = new Map(), errors = [], external = [];
const exited = new Promise(resolve => browser.once('exit', resolve));
try {
  let port;
  for (let i = 0; i < 120; i++) {
    port = log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/)?.[1];
    if (port) break; await sleep(100);
  }
  assert.ok(port, `Electron preview startup: ${log.slice(-1600)}`);
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const item = pending.get(message.id); if (!item) return;
      pending.delete(message.id); clearTimeout(item.timeout);
      if (message.error) item.reject(new Error(JSON.stringify(message.error))); else item.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    else if (message.method === 'Network.requestWillBeSent' && /^https?:/.test(message.params.request.url)) external.push(message.params.request.url);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value;
  };
  await send('Runtime.enable'); await send('Network.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 940, deviceScaleFactor: 1, mobile: false });
  assert.equal(await evaluate('location.href'), pathToFileURL(join(directory, 'preview.html')).href);
  for (let i = 0; i < 180; i++) { if (await evaluate('!!window.athletePreview?.ready')) break; await sleep(100); }
  assert.equal(await evaluate('!!window.athletePreview?.ready'), true, `Preview loads: ${log.slice(-1500)}`);
  assert.equal(await evaluate('athletePreview.snapshot().bones'), JOINT_COUNT);
  const saveCanvas = async name => {
    const result = await evaluate('athletePreview.capture()');
    await writeFile(join(artifacts, `athlete-3d-${name}.png`), Buffer.from(result.split(',')[1], 'base64'));
  };
  for (const view of ['front', 'side', 'back', 'three-quarter']) {
    await evaluate(`athletePreview.pose('Idle',0);athletePreview.view(${JSON.stringify(view)})`);
    await saveCanvas(view);
  }
  for (const name of ANIMATION_NAMES) {
    await evaluate(`document.querySelector('[data-animation="${name}"]').click()`);
    assert.equal(await evaluate('athletePreview.snapshot().animation'), name);
    await evaluate(`athletePreview.view('three-quarter');athletePreview.pose('${name}',${gltf.animations.find(c => c.name === name).duration * .48})`);
    await saveCanvas(name.toLowerCase());
  }
  for (const [animation, view, moments] of [
    ['Jump', 'side', [.10, .22, .40, .50, .64, .77, .90]],
    ['Sidestep', 'front', [.125, .375, .625, .875]],
    ['Backhand', 'three-quarter', [.20, .48, .74]],
    ['Backhand', 'side', [.28, .48]]
  ]) {
    const duration = gltf.animations.find(clip => clip.name === animation).duration;
    for (const moment of moments) {
      await evaluate(`athletePreview.mixer.timeScale=1;athletePreview.pose('${animation}',${duration * moment});athletePreview.view('${view}')`);
      await saveCanvas(`${animation.toLowerCase()}-${view}-${Math.round(moment * 100)}`);
    }
  }
  await evaluate("document.getElementById('racket').click()");
  assert.equal(await evaluate("athletePreview.model.getObjectByName('BadmintonRacket').visible"), false);
  await evaluate("document.getElementById('racket').click();document.getElementById('skeleton').click()");
  assert.equal(await evaluate('athletePreview.skeleton.visible'), true);
  await evaluate("document.getElementById('skeleton').click();document.getElementById('rotate').click()");
  assert.equal(await evaluate('athletePreview.controls.autoRotate'), true);
  await evaluate("document.getElementById('reset').click();document.getElementById('speed').value=.5;document.getElementById('speed').dispatchEvent(new Event('input'))");
  assert.equal(await evaluate('athletePreview.mixer.timeScale'), .5);
  assert.equal(await evaluate('athletePreview.controls.autoRotate'), false);
  // Reset test poses and exercise ordinary live playback and pause/resume.
  await evaluate("document.getElementById('pause').click();document.querySelector('[data-animation=Run]').click()");
  const t1 = await evaluate('athletePreview.mixer.time'); await sleep(160);
  assert.ok(await evaluate('athletePreview.mixer.time') > t1);
  await evaluate("document.getElementById('pause').click()");
  const t2 = await evaluate('athletePreview.mixer.time'); await sleep(160);
  assert.equal(await evaluate('athletePreview.mixer.time'), t2);
  await evaluate("athletePreview.pose('Idle',0);athletePreview.view('three-quarter')");
  const desktop = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(artifacts, 'athlete-3d-preview-desktop.png'), Buffer.from(desktop.data, 'base64'));
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 2, mobile: true });
  await sleep(180);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
  assert.ok(await evaluate('athletePreview.snapshot().width') > 500);
  const mobile = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(artifacts, 'athlete-3d-preview-mobile.png'), Buffer.from(mobile.data, 'base64'));
  assert.deepEqual(errors, [], 'preview has no uncaught renderer errors');
  assert.deepEqual(external, [], 'standalone preview does not request external assets');
  if (process.argv.includes('--motion-previews')) {
    const frameDirectory = join(artifacts, 'athlete-motion-frames'); await mkdir(frameDirectory, { recursive: true });
    await send('Emulation.setDeviceMetricsOverride', { width: 930, height: 640, deviceScaleFactor: 1, mobile: false });
    await sleep(100);
    const previews = [];
    for (const [animation, view] of [['Jump', 'side'], ['Sidestep', 'front'], ['Backhand', 'three-quarter']]) {
      const duration = gltf.animations.find(clip => clip.name === animation).duration;
      const frames = Math.round(duration * 25);
      for (let frame = 0; frame < frames; frame++) {
        await evaluate(`athletePreview.mixer.timeScale=1;athletePreview.pose('${animation}',${duration * frame / frames});athletePreview.view('${view}')`);
        const result = await evaluate('athletePreview.capture()');
        await writeFile(join(frameDirectory, `${animation.toLowerCase()}-${String(frame).padStart(3, '0')}.png`), Buffer.from(result.split(',')[1], 'base64'));
      }
      previews.push({ animation, view, duration, frames });
    }
    await writeFile(join(frameDirectory, 'frames.json'), JSON.stringify(previews, null, 2));
  }
  const result = { glbErrors: report.issues.numErrors, glbWarnings: report.issues.numWarnings, bones: JOINT_COUNT,
    animations: ANIMATION_NAMES, bounds, motionMetrics, offline: true, desktopAndMobile: true, previewErrors: errors };
  await writeFile(join(artifacts, 'athlete-3d-checks.json'), JSON.stringify(result, null, 2));
  console.log('Athlete verified: GLB specification, imported skeleton and all animation poses, offline WebGL preview, controls, desktop/mobile layout and screenshots.');
} catch (error) {
  console.error('Preview log:', log.slice(-2000)); throw error;
} finally {
  socket?.close(); browser.kill(); await Promise.race([exited, sleep(3000)]);
  if (dirname(profile) === artifacts && basename(profile).startsWith('.athlete-check-')) {
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}
