// Real Chromium pages, production game/client, and a real host socket. The
// desktop-only host bridge is supplied by this harness; Electron is checked
// separately. No game rules or network messages are replaced.
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve, sep, basename } from 'node:path';
import { createRequire } from 'node:module';
import { networkInterfaces } from 'node:os';
import assert from 'node:assert/strict';
import { WebSocketServer, WebSocket as RelaySocket } from 'ws';
import { createLanServer } from '../network/server.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = join(root, 'artifacts', 'lan');
await mkdir(artifacts, { recursive: true });
const profile = await mkdtemp(join(artifacts, '.browser-'));
const room = await createLanServer({ port: 0, host: '127.0.0.1', court: 'sky' });
const electron = process.argv.includes('--electron');
const packaged = process.argv.includes('--packaged');
const jitter = process.argv.includes('--jitter');
if (jitter && electron) { await room.close(); throw new Error('--jitter uses the browser test bridge; run native tests separately.'); }
if (electron) await room.close(); // Reuse the selected free port for the actual desktop host.
// A test-only ordered relay varies delivery delay on real WebSocket messages.
// The production room, clients, actions and rules are unchanged.
let relay;
const relaySockets = new Set(), relayTimers = new Set();
if (jitter) {
  relay = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((resolve, reject) => { relay.once('listening', resolve); relay.once('error', reject); });
  relay.on('connection', downstream => {
    const upstream = new RelaySocket('ws://127.0.0.1:' + room.port + '/shuttle-flow');
    relaySockets.add(downstream); relaySockets.add(upstream);
    const pipe = (from, to) => {
      let index = 0, deadline = 0;
      from.on('message', bytes => {
        const delay = [15, 65, 65, 65, 15, 15, 15, 15][index++ % 8];
        deadline = Math.max(deadline + .1, performance.now() + delay);
        const timer = setTimeout(() => {
          relayTimers.delete(timer); if (to.readyState === RelaySocket.OPEN) to.send(bytes.toString());
        }, Math.max(0, deadline - performance.now()));
        relayTimers.add(timer);
      });
    };
    // Hold the browser hello until the loopback upstream is connected.
    const pending = [];
    const queue = bytes => pending.push(bytes);
    downstream.on('message', queue);
    upstream.once('open', () => {
      downstream.off('message', queue); pipe(downstream, upstream);
      for (const bytes of pending) upstream.send(bytes.toString());
    });
    pipe(upstream, downstream);
    for (const [from, to] of [[upstream, downstream], [downstream, upstream]]) {
      from.on('error', () => {});
      from.on('close', () => { relaySockets.delete(from); if (to.readyState !== RelaySocket.CLOSED) to.close(); });
    }
  });
}
const joinPort = relay ? relay.address().port : room.port;
const binary = electron ? packaged ? join(root, 'dist/Shuttle Flow-win32-x64/Shuttle Flow.exe') : createRequire(import.meta.url)('electron') : process.env.SHUTTLE_CHECK_BROWSER || join(root, 'artifacts/browser-runtime/chrome-headless-shell-win64/chrome-headless-shell.exe');
const children = [];
function launch(directory) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(binary, electron ? [
    ...(!packaged ? [root] : []), '--desktop-check', '--inspect=0', '--remote-debugging-port=0', '--user-data-dir=' + directory
  ] : ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader',
  '--in-process-gpu', '--disable-audio-output', '--remote-debugging-port=0', '--no-first-run',
  '--user-data-dir=' + directory, 'about:blank'], { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  children.push(child); child.log = ''; child.stderr.on('data', b => { child.log += b; }); return child;
}
const browser = launch(electron ? join(profile, 'host') : profile);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!await predicate()) { if (Date.now() > deadline) throw new Error('Timed out: ' + label); await sleep(50); }
}
const clients = [], errors = [], diagnostics = [];
async function cdp(url) {
  const socket = new WebSocket(url); let sequence = 0;
  const pending = new Map(), listeners = new Map();
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const m = JSON.parse(event.data);
    if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (p) { clearTimeout(p.timer); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } }
    else for (const fn of listeners.get(m.method) ?? []) fn(m.params);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timeout')); }, 12000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const api = { send, socket,
    on(method, callback) { if (!listeners.has(method)) listeners.set(method, []); listeners.get(method).push(callback); },
    async evaluate(expression) {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    },
    async click(id) { return api.evaluate('document.getElementById(' + JSON.stringify(id) + ').click()'); },
    async shot(name) {
      const data = api.main ? await api.main.evaluate('(async()=>{const w=process.mainModule.require("electron").BrowserWindow.getAllWindows()[0];const image=await w.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});return image.toPNG().toString("base64");})()') : (await send('Page.captureScreenshot', { format: 'png' })).data;
      await writeFile(join(artifacts, name), Buffer.from(data, 'base64'));
    }
  };
  clients.push(api); return api;
}
async function page(port, host) {
  let target;
  if (electron) await until(async () => {
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    target = targets.find(t => t.type === 'page' && t.url.startsWith('shuttle://game'));
    return Boolean(target);
  }, 'native page');
  else target = await (await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', { method: 'PUT' })).json();
  const p = await cdp(target.webSocketDebuggerUrl);
  if (electron) {
    const child = children[host ? 0 : 1];
    const mainURL = child.log.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/)?.[1];
    assert.ok(mainURL, child.log);
    p.main = await cdp(mainURL);
  }
  p.on('Runtime.exceptionThrown', e => errors.push(e.exceptionDetails.exception?.description ?? e.exceptionDetails.text));
  p.on('Log.entryAdded', e => diagnostics.push(e.entry.text));
  p.on('Network.webSocketFrameError', e => diagnostics.push(e.errorMessage));
  await p.send('Log.enable'); await p.send('Network.enable');
  await p.send('Page.enable'); await p.send('Runtime.enable'); await p.send('Debugger.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await p.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  if (host && !electron) {
    const fakeRoom = { port: joinPort, token: room.token, addresses: ['26.12.34.56', '192.168.1.2'] };
    await p.send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.shuttleDesktop={hostLan:async options=>{window.__hostOptions=options;return ' + JSON.stringify(fakeRoom) + ';},stopLan:async()=>{}};' });
  }
  const source = await readFile(join(root, 'game.js'), 'utf8');
  const lineNumber = source.split('\n').findIndex(line => line.startsWith('function frame(now)'));
  let hooked = false;
  const bp = await p.send('Debugger.setBreakpointByUrl', { urlRegex: 'game\\.js$', lineNumber });
  let hook = 'window.__lanCheck={client:lanClient,snapshot:()=>({state,player,opponent,match,delivery,lanActive,lanFailed,currentPanel,cue:contactCue()}),hit,jump,keys,localize:v=>i18n.setLanguage(v),bot:null,startBot(){if(this.bot)return;this.bot=setInterval(()=>{const v=lanClient.sample();if(!v||v.phase!=="playing"||state!=="playing")return;keys.clear();if(v.stage==="serve"){if(v.match.server==="player"&&v.still.every(n=>n>.2))hit("clear");return;}if(v.delivery?.phase!=="incoming")return;const target=isInterceptable(v.delivery)?incomingPosition({...v.delivery,age:v.delivery.age+.12}):v.delivery.target;const a=player;if(Math.abs(target.x-a.x)>.012)keys.add(target.x>a.x?"KeyD":"KeyA");if(Math.abs(target.y-a.y)>.012)keys.add(target.y>a.y?"KeyS":"KeyW");const pred=contactPrediction();if(pred&&assessHit(pred.player,pred.ball).grade)hit("clear");},12);},stopBot(){clearInterval(this.bot);this.bot=null;keys.clear();}};';
  if (jitter) hook += `
    window.__visualAudit={frames:0,rawRewinds:0,displayRewinds:0};
    const auditDraw=draw;let auditPrevious=null;
    draw=(...args)=>{auditDraw(...args);if(!lanActive)return;
      const raw=lanClient.sample(),shown=lanClient.presentation();
      if(raw?.phase!=='playing'||raw.stage!=='rally'){auditPrevious=null;return;}
      const key=raw.round+':'+raw.flightId;
      if(auditPrevious?.key===key){const a=window.__visualAudit;a.frames++;
        if(raw.delivery.age<auditPrevious.raw-.00001)a.rawRewinds++;
        if(shown.delivery.age<auditPrevious.shown-.00001)a.displayRewinds++;}
      auditPrevious={key,raw:raw.delivery.age,shown:shown.delivery.age};};`;
  p.on('Debugger.paused', async e => {
    try {
      const result = await p.send('Debugger.evaluateOnCallFrame', { callFrameId: e.callFrames[0].callFrameId,
        expression: electron ? hook.replace('client:lanClient,', 'client:lanClient,pump(){update(1/60);draw();},') : hook });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      await p.send('Debugger.removeBreakpoint', { breakpointId: bp.breakpointId });
      await p.send('Debugger.resume'); hooked = true;
    } catch (error) { errors.push(String(error)); }
  });
  if (!electron) await p.send('Page.navigate', { url: pathToFileURL(join(root, 'index.html')).href });
  await until(() => hooked, 'game hook');
  await p.send('Debugger.disable');
  // Windows does not schedule requestAnimationFrame for a window that has
  // never been shown. Pump the unchanged production update/draw functions
  // during hidden QA; the authoritative clock remains in the main process.
  if (electron) await p.evaluate('window.__lanPump=setInterval(()=>__lanCheck.pump(),16)');
  await until(() => p.evaluate('!!globalThis.ShuttleAthletes?.ready'), '3D athletes', 20000);
  return p;
}
const report = { runtime: electron ? packaged ? 'packaged-electron' : 'source-electron' : jitter ? 'chromium-jitter' : 'chromium' };
async function debuggingPort(directory) {
  let result;
  await until(async () => {
    try { result = Number((await readFile(join(directory, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); return result > 0; } catch { return false; }
  }, 'browser startup');
  return result;
}
try {
  const port = await debuggingPort(electron ? join(profile, 'host') : profile);
  const a = await page(port, true);
  let guestPort = port;
  if (electron) { launch(join(profile, 'guest')); guestPort = await debuggingPort(join(profile, 'guest')); }
  const b = await page(guestPort, false);
  const state = () => a.evaluate('__lanCheck.client.state');
  for (const p of [a, b]) { await p.click('choose-match'); await p.click('lan-open'); }
  assert.equal(await b.evaluate('document.getElementById("lan-create").disabled'), !electron);
  await b.evaluate('document.getElementById("lan-address").value="not-an-ip"'); await b.click('lan-join');
  assert.match(await b.evaluate('document.getElementById("lan-status").textContent'), /valid IPv4/);
  await a.shot('room-desktop-en.png');
  for (const [width, height] of [[1024, 640], [844, 390], [390, 844], [568, 320]]) {
    await a.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await a.evaluate('__lanCheck.localize("zh-CN")');
    const layout = await a.evaluate('(()=>{const p=document.getElementById("lan-panel"),r=p.getBoundingClientRect(),f=document.getElementById("lan-leave").getBoundingClientRect();return {title:document.getElementById("lan-title").textContent,scroll:p.scrollWidth>p.clientWidth+2,footer:f.bottom<=innerHeight&&f.top>=0,bounds:r.right<=innerWidth&&r.left>=0};})()');
    assert.equal(layout.title, '局域网对战'); assert.equal(layout.scroll, false); assert.equal(layout.footer, true); assert.equal(layout.bounds, true);
    await a.shot('room-' + width + 'x' + height + '-zh.png');
  }
  await a.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await a.evaluate('__lanCheck.localize("en");document.getElementById("lan-port").value=' + joinPort);
  await a.click('lan-create');
  await until(() => a.evaluate('__lanCheck.client.connected'), 'host connected');
  const address = electron ? Object.values(networkInterfaces()).flat().find(n => n?.family === 'IPv4' && !n.internal && !n.address.startsWith('169.254.'))?.address ?? '127.0.0.1' : '127.0.0.1';
  report.joinAddress = address;
  await b.evaluate('document.getElementById("lan-address").value=' + JSON.stringify(address + ':' + joinPort));
  await b.click('lan-join');
  try { await until(() => b.evaluate('__lanCheck.client.connected'), 'guest connected'); }
  catch (error) { console.error(JSON.stringify({ address, status: await b.evaluate('document.getElementById("lan-status").textContent'), diagnostics, errors })); throw error; }
  await until(() => a.evaluate('!document.getElementById("lan-ready").disabled'), 'two slots');
  await a.shot('room-connected-en.png');
  await a.click('lan-ready'); assert.equal((await state()).phase, 'lobby');
  await b.click('lan-ready');
  await until(() => a.evaluate('__lanCheck.snapshot().state==="playing"'), 'start');
  await sleep(300);
  await a.evaluate('__lanCheck.hit("clear")');
  await until(async () => (await state()).stage === 'rally', 'serve reaches server');
  const before = await b.evaluate('__lanCheck.snapshot().player.x');
  await b.evaluate('window.__keyLog=[];window.addEventListener("keydown",e=>window.__keyLog.push([e.code,e.target.id]));');
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyA', key: 'a' }); await sleep(250);
  const moveProbe = await b.evaluate('({keys:[...__lanCheck.keys],log:window.__keyLog,active:document.activeElement.id,s:__lanCheck.snapshot(),input:__lanCheck.client.state.input})');
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyA', key: 'a' });
  const after = await b.evaluate('__lanCheck.snapshot().player.x');
  assert.ok(after < before - .02, JSON.stringify({ before, after, moveProbe }));
  report.keyboardMovement = true;
  await a.click('pause'); await until(async () => (await state()).phase === 'paused', 'pause');
  await until(() => b.evaluate('__lanCheck.snapshot().state==="paused"'), 'peer paused');
  await b.evaluate('__lanCheck.client.pause(true)'); await a.click('resume');
  await until(() => a.evaluate('document.getElementById("resume").disabled'), 'friend must resume');
  await a.shot('paused-waiting-for-friend.png'); await b.click('resume');
  await until(async () => (await state()).phase === 'playing', 'both resumed');
  await a.evaluate('__lanCheck.startBot()'); await b.evaluate('__lanCheck.startBot()');
  await until(async () => (await state()).longest >= 6, 'six-shot human rally through actual frontend', 45000);
  report.longestRally = (await state()).longest;
  await a.shot('match-host-en.png'); await b.evaluate('__lanCheck.localize("zh-CN")'); await b.shot('match-guest-zh.png');
  const sa = await a.evaluate('__lanCheck.snapshot()'), sb = await b.evaluate('__lanCheck.snapshot()');
  assert.equal(sa.match.player, sb.match.computer); assert.equal(sa.match.computer, sb.match.player);
  assert.ok(sa.player.y > 0 && sa.opponent.y < 0 && sb.player.y > 0 && sb.opponent.y < 0);
  report.mirroredScoresAndViews = true;
  await a.evaluate('__lanCheck.stopBot()'); await b.evaluate('__lanCheck.stopBot()');
  // Finish this live match through ordinary legal serves and missed returns.
  await a.evaluate('__lanCheck.startBot()');
  // If the last guest stroke wins the rally, they still need to serve before
  // the host can win service back. Do not leave that human serve unattended.
  await b.evaluate('window.__serveOnly=setInterval(()=>{const v=__lanCheck.client.sample();if(v?.phase==="playing"&&v.stage==="serve"&&v.match.server==="player"&&v.still.every(n=>n>.2))__lanCheck.hit("clear");},50)');
  await until(async () => (await state()).phase === 'over', 'full real-time match', 65000);
  await until(() => a.evaluate('__lanCheck.snapshot().state==="over"'), 'results');
  await a.shot('match-results-en.png'); await b.shot('match-results-zh.png');
  report.finalScore = [(await state()).match.player, (await state()).match.computer];
  await b.evaluate('clearInterval(window.__serveOnly)');
  await a.click('restart'); await b.click('restart'); await until(async () => (await state()).phase === 'playing', 'rematch');
  await until(() => a.evaluate('__lanCheck.snapshot().state==="playing"'), 'rematch received');
  report.rematch = true;
  await a.evaluate('window.dispatchEvent(new Event("blur"))');
  await until(async () => (await state()).phase === 'paused', 'blur pauses shared match'); report.blurPause = true;
  await a.click('pause-menu');
  await until(() => b.evaluate('__lanCheck.snapshot().lanFailed'), 'disconnect shown'); await b.shot('disconnected-zh.png');
  await b.click('lan-leave'); await b.click('choose-practice'); await b.click('start');
  await until(() => b.evaluate('__lanCheck.snapshot().state==="playing"&&!__lanCheck.snapshot().lanActive'), 'single player after leaving');
  report.offlineAfterLeave = true; assert.deepEqual(errors, []);
  if (jitter) {
    report.presentation = await Promise.all([a, b].map(p => p.evaluate('window.__visualAudit')));
    for (const sample of report.presentation) {
      assert.ok(sample.frames > 100, 'enough live frames sampled under real delivery jitter');
      assert.equal(sample.displayRewinds, 0, 'actual court paint never rewinds a flight');
    }
  }
  report.errors = errors;
  await writeFile(join(artifacts, report.runtime + '-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  for (const c of clients) c.socket.close();
  for (const child of children) child.kill();
  await room.close();
  for (const timer of relayTimers) clearTimeout(timer);
  for (const socket of relaySockets) socket.terminate();
  if (relay) await new Promise(resolve => relay.close(resolve));
  await Promise.all(children.map(child => new Promise(resolve => { if (child.exitCode !== null) resolve(); else { child.once('exit', resolve); setTimeout(resolve, 3000); } })));
  const cleanup = resolve(profile);
  if (!cleanup.startsWith(resolve(artifacts) + sep) || !basename(cleanup).startsWith('.browser-')) throw new Error('Invalid QA cleanup path');
  await rm(cleanup, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
