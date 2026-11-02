// Model/motion QA and real integrated-game capture, using isolated test profiles.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, dirname, basename } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import validator from 'gltf-validator';
import { verifyPixelAthleteMotion } from './lib/verify-pixel-athlete-motion.mjs';
import { PIXEL_MOTIONS } from './lib/pixel-athlete-motion.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = join(root, 'assets', 'characters', 'pixel-athlete-v2'), artifacts = join(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
const protectedFiles = ['core.js', 'game.js', 'index.html', 'style.css', 'scripts/athlete-game.mjs',
  'assets/characters/anime-athlete-v1/athlete.glb', 'assets/characters/anime-athlete-v1/game-renderer.js'];
const hashes = async () => Object.fromEntries(await Promise.all(protectedFiles.map(async name =>
  [name, createHash('sha256').update(await readFile(join(root, name))).digest('hex')])));
const before = await hashes();
const data = await readFile(join(directory, 'athlete.glb'));
const report = await validator.validateBytes(new Uint8Array(data), { uri: 'athlete.glb', maxIssues: 100 });
await writeFile(join(artifacts, 'pixel-athlete-glb-validation.json'), JSON.stringify(report, null, 2));
assert.equal(report.issues.numErrors, 0, JSON.stringify(report.issues.messages));
assert.equal(report.issues.numWarnings, 0, JSON.stringify(report.issues.messages));
const gltf = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
assert.equal(gltf.scene.getObjectByName('BadmintonRacket').parent.name, 'RightHand');
assert.ok(gltf.scene.getObjectByName('RacketContact'));
const bounds = new THREE.Box3(); gltf.scene.updateMatrixWorld(true);
let bones = 0;
gltf.scene.traverse(o => {
  if (o.isBone) bones++;
  if (o.isSkinnedMesh) {
    o.geometry.computeBoundingBox(); bounds.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
    const weight = o.geometry.attributes.skinWeight;
    for (let i = 0; i < weight.count; i++) assert.ok(Math.abs(weight.getX(i) + weight.getY(i) + weight.getZ(i) + weight.getW(i) - 1) < 1e-5);
  }
});
assert.equal(bones, 29); assert.ok(Math.abs(bounds.min.y - .035) < 1e-6);
assert.ok(Math.abs(bounds.max.y - 1.931166648864746) < 1e-6, 'keeps the original floor-to-crown height');
const motionMetrics = verifyPixelAthleteMotion(gltf);
await writeFile(join(artifacts, 'pixel-athlete-motion-checks.json'), JSON.stringify(motionMetrics, null, 2));
const runtime = createRequire(import.meta.url)('electron'), sleep = ms => new Promise(r => setTimeout(r, ms));
async function run(label, entry, args, callback) {
  const profile = await mkdtemp(join(artifacts, '.pixel-check-'));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(runtime, [entry, ...args, '--remote-debugging-port=0', `--user-data-dir=${profile}`],
    { cwd: root, env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '', socket, sequence = 0; const pending = new Map(), errors = [], external = [], listeners = new Map();
  child.stderr.on('data', b => { log += b; });
  const exited = new Promise(r => child.once('exit', r));
  try {
    let port;
    for (let i = 0; i < 150; i++) { port = log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/)?.[1]; if (port) break; await sleep(100); }
    assert.ok(port, log);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((r, j) => { socket.onopen = r; socket.onerror = j; });
    socket.onmessage = event => {
      const m = JSON.parse(event.data);
      if (m.id) {
        const p = pending.get(m.id); if (!p) return; pending.delete(m.id); clearTimeout(p.timer);
        if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result);
      } else {
        if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
        if (m.method === 'Network.requestWillBeSent' && /^https?:/.test(m.params.request.url)) external.push(m.params.request.url);
        listeners.get(m.method)?.(m.params);
      }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(method)); }, 20000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      assert.ok(!r.exceptionDetails, JSON.stringify(r.exceptionDetails)); return r.result.value;
    };
    await send('Runtime.enable'); await send('Network.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 960, deviceScaleFactor: 1, mobile: false });
    await callback({ send, evaluate, listeners });
    assert.deepEqual(errors, [], `no renderer errors in ${label}`); assert.deepEqual(external, [], 'no remote dependencies');
  } catch (e) { console.error(label, log.slice(-2000)); throw e; }
  finally {
    socket?.close(); pending.forEach(p => clearTimeout(p.timer)); child.kill(); await Promise.race([exited, sleep(3000)]);
    if (dirname(profile) === artifacts && basename(profile).startsWith('.pixel-check-')) await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}
const verifyStaticPreview = () => run('static preview', join(root, 'desktop', 'athlete-preview.cjs'), ['--athlete-check', '--pixel-athlete'], async ({ send, evaluate }) => {
  for (let i = 0; i < 150 && !await evaluate('!!window.pixelAthletePreview?.ready'); i++) await sleep(100);
  assert.equal(await evaluate('!!window.pixelAthletePreview?.ready'), true);
  assert.equal(await evaluate('document.getElementById("pixels").value'), '1', 'clear view is the default');
  assert.equal(await evaluate('pixelAthletePreview.snapshot().animation'), 'Idle');
  await evaluate("pixelAthletePreview.pose('BindPose')");
  await evaluate("document.getElementById('court-toggle').click();document.getElementById('court-preview').decode()");
  assert.equal(await evaluate('document.getElementById("court-preview").hidden'), false);
  assert.ok(await evaluate('document.getElementById("court-preview").naturalWidth') >= 1200);
  await evaluate("document.getElementById('court-toggle').click()");
  for (const view of ['front', 'side', 'back', 'three-quarter', 'face']) {
    await evaluate(`pixelAthletePreview.view('${view}')`); await sleep(80);
    const image = await evaluate('pixelAthletePreview.capture()');
    await writeFile(join(artifacts, `pixel-athlete-${view}.png`), Buffer.from(image.split(',')[1], 'base64'));
  }
  await evaluate("document.getElementById('racket').click()");
  assert.equal(await evaluate('pixelAthletePreview.snapshot().racket'), false);
  await evaluate("document.getElementById('racket').click()");
  await evaluate("pixelAthletePreview.view('three-quarter')");
  let shot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(artifacts, 'pixel-athlete-preview-desktop.png'), Buffer.from(shot.data, 'base64'));
  await evaluate("document.getElementById('skeleton').click()");
  assert.equal(await evaluate('pixelAthletePreview.skeleton.visible'), true);
  await evaluate("document.getElementById('skeleton').click();document.getElementById('rotate').click()");
  assert.equal(await evaluate('pixelAthletePreview.controls.autoRotate'), true);
  await evaluate("document.getElementById('reset').click();document.getElementById('pixels').value='1';document.getElementById('pixels').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate('pixelAthletePreview.controls.autoRotate'), false);
  const width = await evaluate('pixelAthletePreview.snapshot().width'); assert.ok(width > 1000);
  await evaluate("document.getElementById('pixels').value='2';document.getElementById('pixels').dispatchEvent(new Event('change'))");
  assert.ok(await evaluate('pixelAthletePreview.snapshot().width') <= width / 2 + 1);
  await evaluate("document.getElementById('pixels').value='1';document.getElementById('pixels').dispatchEvent(new Event('change'))");
  for (const [name, motion] of Object.entries(PIXEL_MOTIONS)) {
    await evaluate(`pixelAthletePreview.pose('${name}',${motion.duration * .48});pixelAthletePreview.view('three-quarter')`);
    const image = await evaluate('pixelAthletePreview.capture()');
    await writeFile(join(artifacts, `pixel-athlete-motion-${name.toLowerCase()}.png`), Buffer.from(image.split(',')[1], 'base64'));
    assert.equal(await evaluate('pixelAthletePreview.snapshot().animation'), name);
  }
  await evaluate("pixelAthletePreview.pose('Backhand',.3);document.getElementById('next-frame').click()");
  assert.ok(Math.abs(await evaluate('pixelAthletePreview.snapshot().time') - .3 - 1 / 30) < .0001);
  await evaluate("document.getElementById('previous-frame').click()");
  assert.ok(Math.abs(await evaluate('pixelAthletePreview.snapshot().time') - .3) < .0001);
  await evaluate("document.getElementById('timeline').value='.5';document.getElementById('timeline').dispatchEvent(new Event('input'))");
  assert.ok(Math.abs(await evaluate('pixelAthletePreview.snapshot().time') - PIXEL_MOTIONS.Backhand.duration / 2) < .001);
  await evaluate("document.getElementById('replay').click()"); const time = await evaluate('pixelAthletePreview.snapshot().time');
  await sleep(180); assert.ok(await evaluate('pixelAthletePreview.snapshot().time') > time);
  await evaluate("document.getElementById('pause').click()"); const stopped = await evaluate('pixelAthletePreview.snapshot().time');
  await sleep(100); assert.equal(await evaluate('pixelAthletePreview.snapshot().time'), stopped);
  await evaluate("pixelAthletePreview.pose('Backhand',.3);document.getElementById('speed').value='.25';document.getElementById('pause').click()");
  const slowStart = await evaluate('pixelAthletePreview.snapshot().time');
  await sleep(240); const slowDelta = await evaluate('pixelAthletePreview.snapshot().time') - slowStart;
  assert.ok(slowDelta > .01 && slowDelta < .15, `quarter-speed playback advanced ${slowDelta}`);
  await evaluate("document.getElementById('speed').value='1'");
  await evaluate("pixelAthletePreview.pose('Idle',0)");
  if (process.argv.includes('--motion-previews')) {
    const framesDirectory = join(artifacts, 'pixel-athlete-motion-frames');
    await mkdir(framesDirectory, { recursive: true });
    await send('Emulation.setDeviceMetricsOverride', { width: 920, height: 640, deviceScaleFactor: 1, mobile: false });
    await sleep(120);
    const specs = [];
    for (const [name, motion] of Object.entries(PIXEL_MOTIONS)) {
      const frames = Math.ceil(motion.duration * 25), view = name === 'Sidestep' ? 'front' : name === 'Jump' ? 'side' : 'three-quarter';
      for (let frame = 0; frame < frames; frame++) {
        const data = await evaluate(`pixelAthletePreview.pose('${name}',${frame / frames * motion.duration});pixelAthletePreview.view('${view}');pixelAthletePreview.capture()`);
        await writeFile(join(framesDirectory, `${name.toLowerCase()}-${String(frame).padStart(3, '0')}.png`), Buffer.from(data.split(',')[1], 'base64'));
      }
      specs.push({ animation: name, label: motion.label, frames, duration: motion.duration, view });
    }
    await writeFile(join(framesDirectory, 'frames.json'), JSON.stringify(specs, null, 2));
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 2, mobile: true });
  await evaluate("document.getElementById('pixels').value='1';document.getElementById('pixels').dispatchEvent(new Event('change'))");
  await sleep(180); assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
  shot = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(artifacts, 'pixel-athlete-preview-mobile.png'), Buffer.from(shot.data, 'base64'));
});
await run('integrated court character', root, ['--desktop-check'], async ({ send, evaluate }) => {
  // Wait for the real game document and embedded model to finish loading.
  for (let i = 0; i < 150 && !await evaluate("document.readyState==='complete'&&!!globalThis.ShuttleAthletes?.ready"); i++) await sleep(100);
  assert.equal(await evaluate("document.readyState==='complete'&&!!globalThis.ShuttleAthletes?.ready"), true);
  assert.equal(await evaluate('ShuttleAthletes.asset'), 'pixel-athlete-v2', 'real game uses the new asset without interception');
  await evaluate("document.getElementById('choose-practice').click();document.getElementById('start').click()");
  await sleep(180);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'p', code: 'KeyP', windowsVirtualKeyCode: 80 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'p', code: 'KeyP', windowsVirtualKeyCode: 80 });
  await sleep(100);
  const image = await evaluate("document.getElementById('court').toDataURL('image/png')");
  await writeFile(join(artifacts, 'pixel-athlete-court-preview.png'), Buffer.from(image.split(',')[1], 'base64'));
  await writeFile(join(directory, 'court-preview.png'), Buffer.from(image.split(',')[1], 'base64'));
  assert.equal(await evaluate('ShuttleAthletes.last.player.bones'), 29);
});
await verifyStaticPreview();
const after = await hashes(); assert.deepEqual(after, before, 'verification did not rewrite the live game or original model');
await writeFile(join(artifacts, 'pixel-athlete-checks.json'), JSON.stringify({ glbErrors: report.issues.numErrors,
  glbWarnings: report.issues.numWarnings, bones, bodyBounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
  originalHeightPreserved: true, offlinePreview: true, desktopAndMobile: true, courtAppearanceCaptured: true,
  gameplayIntegrated: true, verificationDidNotRewriteGameOrOriginalModel: true, protectedFileHashes: after, motionsRefined: true, motionMetrics,
  animationNames: Object.keys(PIXEL_MOTIONS), arbitraryPoseCollisionGuaranteed: false }, null, 2));
console.log('Pixel athlete verified: GLB, original height, nine motions, actual shoe support, knees, sidestep support, backhand clearance, offline playback/slow motion/frame stepping, mobile layout and production game integration.');
