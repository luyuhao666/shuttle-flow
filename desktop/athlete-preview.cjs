// Separate viewer entry; never opens or writes the game's settings profile.
const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const checking = process.argv.includes('--athlete-check');
const pixelPreview = process.argv.includes('--pixel-athlete');
const gameCheck = checking && process.argv.includes('--game-browser-check');
const profileArgument = process.argv.find(value => value.startsWith('--user-data-dir='));
app.setName('ShuttleFlowAthletePreview');
app.setPath('userData', profileArgument ? path.resolve(profileArgument.slice('--user-data-dir='.length)) : path.join(root, 'artifacts', pixelPreview ? '.pixel-athlete-preview-profile' : '.athlete-preview-profile'));
const entry = gameCheck ? path.join(root, 'index.html') : path.join(root, 'assets', 'characters', pixelPreview ? 'pixel-athlete-v2' : 'anime-athlete-v1', 'preview.html');
let window;
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window = new BrowserWindow({ width: 1400, height: 960, minWidth: 600, minHeight: 650,
    title: 'Shuttle Flow · 3D 角色预览', backgroundColor: '#edf0e7', show: !checking,
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false, offscreen: checking }
  });
  window.removeMenu(); window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== pathToFileURL(entry).href) event.preventDefault(); });
  if (checking) window.webContents.once('did-finish-load', () => window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }));
  window.loadFile(entry);
  window.on('closed', () => { window = null; });
});
app.on('window-all-closed', () => app.quit());
