// Exercise the real Electron app and its packaged Windows executable through CDP.
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const artifacts = join(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
const profile = await mkdtemp(join(artifacts, '.desktop-check-'));
const require = createRequire(import.meta.url);
const runtime = require('electron');
const executableOption = process.argv.indexOf('--executable');
if (executableOption >= 0 && !process.argv[executableOption + 1]) throw new Error('--executable requires a file path');
const executable = executableOption >= 0 ? resolve(process.argv[executableOption + 1]) : join(root, 'dist', 'Shuttle Flow-win32-x64', 'Shuttle Flow.exe');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0, closing = false;
  const pending = new Map(), errors = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id); if (!request) return;
      pending.delete(message.id); clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  };
  socket.onclose = () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Desktop debugging connection closed')); }
    pending.clear();
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    if (closing) return reject(new Error('Desktop debugging connection is closing'));
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Desktop CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  return {
    send, errors,
    async evaluate(expression, userGesture = false) {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    },
    close() { closing = true; socket.close(); }
  };
}

async function runApp(binary, source, label, verify) {
  const args = [...(source ? [root] : []), '--desktop-check', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--inspect=0'];
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(binary, args, { cwd: source ? root : dirname(binary), env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '', exited = false;
  child.stderr.on('data', bytes => { log += bytes; });
  const exit = new Promise(resolve => child.once('exit', code => { exited = true; resolve(code); }));
  child.once('error', error => { log += error.message; });
  let page, main;
  try {
    let pagePort, mainURL;
    for (let attempt = 0; attempt < 150; attempt++) {
      pagePort = log.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/)?.[1];
      mainURL = log.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/)?.[1];
      if (pagePort && mainURL) break;
      if (exited) throw new Error(`Desktop exited before loading: ${log}`);
      await sleep(100);
    }
    assert.ok(pagePort && mainURL, `desktop exposes test connections: ${log}`);
    let target;
    for (let attempt = 0; attempt < 100; attempt++) {
      const targets = await (await fetch(`http://127.0.0.1:${pagePort}/json/list`)).json();
      target = targets.find(item => item.type === 'page' && item.url.startsWith('shuttle://game'));
      if (target) break;
      await sleep(100);
    }
    assert.ok(target, `desktop loads the local game: ${log}`);
    page = await connect(target.webSocketDebuggerUrl); main = await connect(mainURL);
    await page.send('Runtime.enable'); await main.send('Runtime.enable');
    await main.evaluate(`globalThis.__desktopElectron = process.mainModule.require('electron')`);
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await page.evaluate(`typeof ShuttleCore==='object'&&document.querySelectorAll('[data-court-style]').length===4`)) break;
      await sleep(100);
    }
    await page.evaluate(`document.getElementById('cover-image').decode()`);
    for (let attempt=0;attempt<150&&!await page.evaluate(`!!globalThis.ShuttleAthletes?.ready`);attempt++) await sleep(100);
    assert.equal(await page.evaluate(`globalThis.ShuttleAthletes?.ready`),true,'native game loads the embedded GLB offline');
    assert.equal(await page.evaluate(`ShuttleAthletes.asset`),'pixel-athlete-v2','source and packaged game load the new character');
    assert.equal(await page.evaluate(`location.origin`), 'shuttle://game');
    assert.deepEqual(await page.evaluate(`({node:typeof require,process:typeof process,core:typeof ShuttleCore.assessHit})`), { node: 'undefined', process: 'undefined', core: 'function' });
    const shell = await main.evaluate(`(()=>{const w=__desktopElectron.BrowserWindow.getAllWindows()[0],p=w.webContents.getLastWebPreferences();return {count:__desktopElectron.BrowserWindow.getAllWindows().length,title:w.getTitle(),menu:w.isMenuBarVisible(),sandbox:p.sandbox,isolated:p.contextIsolation,node:p.nodeIntegration,packaged:__desktopElectron.app.isPackaged};})()`);
    assert.deepEqual(shell, { count: 1, title: 'Shuttle Flow', menu: false, sandbox: true, isolated: true, node: false, packaged: !source });
    const blocked = await page.evaluate(`Promise.all(['shuttle://game/package.json','shuttle://game/desktop/main.cjs','shuttle://game/%2e%2e%2fpackage.json'].map(url=>fetch(url).then(r=>r.status)))`);
    assert.deepEqual(blocked, [404, 404, 404], 'the game protocol cannot expose desktop internals or escape the game directory');
    await verify(page, main);
    assert.deepEqual(page.errors, [], 'desktop has no renderer exceptions');
    const image = await main.evaluate(`(async()=>{const w=__desktopElectron.BrowserWindow.getAllWindows()[0];const image=await w.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});return image.toPNG().toString('base64');})()`);
    await writeFile(join(artifacts, `desktop-${label}.png`), Buffer.from(image, 'base64'));
  } catch (error) {
    console.error(`Desktop check ${label} failed:`, log.slice(-2500)); throw error;
  } finally {
    if (main) {
      await main.send('Runtime.evaluate', { expression: `__desktopElectron.app.quit()` }).catch(() => {});
      main.close();
    }
    page?.close();
    const result = await Promise.race([exit.then(code => ({ code })), sleep(5000).then(() => null)]);
    if (!result && !exited) child.kill();
    await sleep(250);
  }
}

try {
  await runApp(runtime, true, 'source-home', async (page, main) => {
    assert.equal(await page.evaluate(`document.body.dataset.guidance`),'compact','new desktop profile starts quiet');
    await page.evaluate(`document.querySelector('[data-guidance="full"]').click();`);
    await page.evaluate(`document.getElementById('settings-menu').click();document.getElementById('volume').value=37;document.getElementById('volume').dispatchEvent(new Event('input'));document.querySelector('[data-default-shot="clear"][data-default-power="2"]').click();document.querySelector('#settings [data-open-personalization]').click();document.querySelector('[data-court-style="sakura"]').click();for(const [id,color] of [['landingColor-choices','#53b5ee'],['aimColor-choices','#ffcc33']]){const input=document.getElementById(id);input.querySelector('[data-color="' + color + '"]').click();}localStorage.setItem('shuttle-club-best','1234');document.getElementById('personalization-close').click();document.getElementById('settings-close').click();`);
    assert.equal(await page.evaluate(`document.getElementById('appearance-save-status').textContent`), '✓ Saved');
    await page.evaluate(`document.getElementById('personalize-menu').click();(()=>{for(const [role,main,stripe] of [['player','#d44a36','#53b5ee'],['opponent','#17a371','#ffcc33']]){document.querySelector('[data-jersey-role="'+role+'"]').click();for(const [id,color] of [['jerseyColor-choices',main],['jerseyStripe-choices',stripe]]){const input=document.getElementById(id);input.querySelector('[data-color="' + color + '"]').click();}}})()`);
    assert.equal(await page.evaluate(`ShuttleAthletes.last.player.jerseyColor`),'d44a36');assert.equal(await page.evaluate(`ShuttleAthletes.last.opponent.jerseyColor`),'17a371');
    await page.evaluate(`document.getElementById('personalization-close').click();`);
    await main.evaluate(`__desktopElectron.BrowserWindow.getAllWindows()[0].setBounds({x:30,y:30,width:1100,height:760})`);
    await sleep(150);
  });
  const savedWindow = JSON.parse(await readFile(join(profile, 'window-state.json'), 'utf8'));
  assert.equal(savedWindow.bounds.width, 1100); assert.equal(savedWindow.bounds.height, 760);
  if (!process.argv.includes('--source-only')) {
    await access(executable);
    await runApp(executable, false, 'packaged-game', async (page, main) => {
      const initial = await main.evaluate(`__desktopElectron.BrowserWindow.getAllWindows()[0].getBounds()`);
      assert.deepEqual(initial, savedWindow.bounds, 'packaged game restores source window geometry');
      // Exercise native input/fullscreen in an actual visible Windows window.
      await main.evaluate(`(()=>{const w=__desktopElectron.BrowserWindow.getAllWindows()[0];w.show();w.focus();})()`);
      await page.evaluate(`document.getElementById('settings-menu').click()`);
      assert.equal(await page.evaluate(`document.body.dataset.guidance`),'full','guidance persists from source to exe');
      assert.equal(await page.evaluate(`document.querySelector('[data-guidance="full"]').getAttribute('aria-pressed')`),'true');
      await page.evaluate(`document.querySelector('[data-guidance="compact"]').click();`);
      assert.equal(await page.evaluate(`document.getElementById('volume-value').value`), '37%');
      assert.equal(await page.evaluate(`document.querySelector('[data-default-shot="clear"][data-default-power="2"]').getAttribute('aria-pressed')`), 'true');
      await page.evaluate(`document.querySelector('#settings [data-open-personalization]').click()`);
      assert.equal(await page.evaluate(`document.getElementById('current-court-name').textContent`), 'Sakura Pink');
      assert.equal(await page.evaluate(`document.getElementById('landingColor-choices').dataset.selectedColor`), '#53b5ee');
      assert.equal(await page.evaluate(`document.getElementById('aimColor-choices').dataset.selectedColor`), '#ffcc33');
      assert.equal(await page.evaluate(`document.getElementById('jerseyColor-choices').dataset.selectedColor`),'#d44a36','player shirt persists across source-to-exe update');
      assert.equal(await page.evaluate(`document.getElementById('jerseyStripe-choices').dataset.selectedColor`),'#53b5ee');
      assert.equal(await page.evaluate(`ShuttleAthletes.last.player.sockStripeColor`),'2264c8');
      await page.evaluate(`document.querySelector('[data-jersey-role="opponent"]').click();`);
      assert.equal(await page.evaluate(`document.getElementById('jerseyColor-choices').dataset.selectedColor`),'#17a371','opponent has its own persisted shirt');
      assert.equal(await page.evaluate(`document.getElementById('jerseyStripe-choices').dataset.selectedColor`),'#ffcc33');
      assert.equal(await page.evaluate(`ShuttleAthletes.last.opponent.shortsStripeColor`),'c78336');
      assert.equal(await page.evaluate(`localStorage.getItem('shuttle-club-best')`), '1234', 'scores survive source-to-package updates');
      await page.evaluate(`document.getElementById('personalization-close').click();document.getElementById('volume-preview').click()` , true);
      assert.ok(await page.evaluate(`typeof AudioContext==='function'`));
      await page.evaluate(`document.getElementById('settings-close').click();document.getElementById('choose-practice').click();document.getElementById('start').click()` , true);
      // Hidden native windows defer layout observers; capture once to commit a real frame.
      await main.evaluate(`__desktopElectron.BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined,{stayHidden:true,stayAwake:true}).then(()=>true)`);
      await sleep(500);
      assert.ok(await page.evaluate(`document.getElementById('overlay').classList.contains('hidden')&&document.body.classList.contains('focus-game')`));
      const canvasMetrics = await page.evaluate(`(()=>{const c=document.getElementById('court'),r=c.getBoundingClientRect();return {width:c.width,height:c.height,cssWidth:r.width,cssHeight:r.height,dpr:devicePixelRatio};})()`);
      assert.equal(canvasMetrics.width, Math.round(canvasMetrics.cssWidth * canvasMetrics.dpr), JSON.stringify(canvasMetrics));
      assert.equal(canvasMetrics.height, Math.round(canvasMetrics.cssHeight * canvasMetrics.dpr), JSON.stringify(canvasMetrics));
      await page.evaluate(`window.dispatchEvent(new Event('blur'))`);
      assert.ok(await page.evaluate(`!document.getElementById('paused').classList.contains('hidden')`), 'switching away pauses the real desktop game');
      await page.evaluate(`document.getElementById('resume').click()` , true);
      await main.evaluate(`(()=>{const c=__desktopElectron.BrowserWindow.getAllWindows()[0].webContents;c.sendInputEvent({type:'keyDown',keyCode:'F11'});c.sendInputEvent({type:'keyUp',keyCode:'F11'});})()`);
      await sleep(250);
      assert.equal(await main.evaluate(`__desktopElectron.BrowserWindow.getAllWindows()[0].isFullScreen()`), true, 'F11 enters native fullscreen');
      await main.evaluate(`(()=>{const c=__desktopElectron.BrowserWindow.getAllWindows()[0].webContents;c.sendInputEvent({type:'keyDown',keyCode:'Escape'});c.sendInputEvent({type:'keyUp',keyCode:'Escape'});})()`);
      await sleep(250);
      assert.equal(await main.evaluate(`__desktopElectron.BrowserWindow.getAllWindows()[0].isFullScreen()`), false, 'Escape leaves native fullscreen');
      await page.evaluate(`document.getElementById('resume').click();document.getElementById('drill-end').click()` , true);
      assert.ok(await page.evaluate(`!document.getElementById('results').classList.contains('hidden')`));
      await page.evaluate(`document.getElementById('restart').click()` , true);
      await sleep(300);
    });
  }
  console.log('Desktop checks passed: source and packaged executable, local resources and sandbox, stable profile/settings/colors/score, remembered window, practice/audio, blur pause, F11/Escape and native-resolution rendering.');
} finally {
  if (dirname(profile) === artifacts && basename(profile).startsWith('.desktop-check-')) await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}
