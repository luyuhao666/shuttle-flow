'use strict';
const { app, BrowserWindow, Menu, protocol, net, screen, session, dialog } = require('electron');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { fitWindowState } = require('./window-state.cjs');

const root = path.resolve(__dirname, '..');
const gameURL = 'shuttle://game/';
const checking = app.commandLine.hasSwitch('desktop-check');
app.setName('Shuttle Flow');
app.setAppUserModelId('ShuttleFlow.Desktop');
// One origin and profile for both source and packaged builds, independent of install path.
const profileOverride = app.commandLine.getSwitchValue('user-data-dir');
const profile = profileOverride && path.isAbsolute(profileOverride) ? profileOverride : path.join(app.getPath('appData'), 'ShuttleFlow');
mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.setPath('sessionData', profile);
protocol.registerSchemesAsPrivileged([{ scheme: 'shuttle', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const allowedExtensions = new Set(['.html', '.js', '.css', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico', '.wav', '.mp3', '.ogg', '.woff', '.woff2']);
const blockedDirectories = new Set(['desktop', 'scripts', 'node_modules', 'artifacts', 'dist']);
const policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

function gameFile(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'shuttle:' || parsed.host !== 'game') return null;
  const name = decodeURIComponent(parsed.pathname === '/' ? '/index.html' : parsed.pathname).slice(1);
  const segments = name.split('/');
  if (!name || name.includes('\\') || segments.some(part => !part || part === '.' || part === '..' || part.startsWith('.')) || blockedDirectories.has(segments[0]) || name === 'server.js' || name.endsWith('.test.js') || !allowedExtensions.has(path.extname(name).toLowerCase())) return null;
  const target = path.resolve(root, name);
  return target.startsWith(root + path.sep) ? target : null;
}

async function serveGame(request) {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
  try {
    const file = gameFile(request.url);
    if (!file) return new Response('Not found', { status: 404 });
    const response = await net.fetch(pathToFileURL(file).href);
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', policy);
    headers.set('Cache-Control', 'no-store');
    return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
  } catch { return new Response('Not found', { status: 404 }); }
}

let window;
const stateFile = path.join(profile, 'window-state.json');
function createWindow() {
  let saved;
  try { saved = JSON.parse(readFileSync(stateFile, 'utf8')); } catch { /* Start centered on first run. */ }
  const primary = screen.getPrimaryDisplay();
  const displays = [primary, ...screen.getAllDisplays().filter(item => item.id !== primary.id)];
  const state = fitWindowState(saved, displays.map(item => item.workArea));
  window = new BrowserWindow({
    ...state.bounds, minWidth: state.minWidth, minHeight: state.minHeight,
    title: 'Shuttle Flow', backgroundColor: '#0b2528', show: false,
    icon: path.join(root, 'assets', 'desktop', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: !checking }
  });
  // Apply saved outer bounds explicitly; Windows can round constructor dimensions at high DPI.
  window.setBounds(state.bounds);
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== gameURL && url !== gameURL + 'index.html') event.preventDefault();
  });
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;
    if (input.key === 'F11') { event.preventDefault(); window.setFullScreen(!window.isFullScreen()); }
    if (input.key === 'Escape' && window.isFullScreen()) window.setFullScreen(false);
    if (!app.isPackaged && input.key === 'F12') { event.preventDefault(); window.webContents.toggleDevTools(); }
  });
  window.once('ready-to-show', () => {
    if (state.maximized) window.maximize();
    if (!checking) window.show();
  });
  window.on('close', () => {
    try { writeFileSync(stateFile, JSON.stringify({ bounds: window.getNormalBounds(), maximized: window.isMaximized() })); } catch { /* A read-only profile must not prevent exit. */ }
    session.defaultSession.flushStorageData();
  });
  window.on('closed', () => { window = null; });
  window.loadURL(gameURL).catch(error => {
    console.error(error);
    if (!checking) dialog.showErrorBox('Game could not start', 'Could not load the game. Extract the complete game folder and try again.');
    app.quit();
  });
}

// QA uses a separate temporary profile and may run beside an existing game.
if (!checking && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([
      { role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }
    ]) : null);
    protocol.handle('shuttle', serveGame);
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  }).catch(error => { console.error(error); app.quit(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
