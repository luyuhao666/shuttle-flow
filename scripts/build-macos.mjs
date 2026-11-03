// Build macOS ZIPs without extracting Unix symlinks onto a Windows filesystem.
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadArtifact } from '@electron/get';
import { createPackage, extractFile } from '@electron/asar';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const require = createRequire(import.meta.url);
const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const version = require('electron/package.json').version;
const checksums = require('electron/checksums.json');
const artifacts = join(root, 'artifacts');
const output = join(root, 'dist');
const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
await mkdir(output, { recursive: true }); await mkdir(artifacts, { recursive: true });
const staging = await mkdtemp(join(root, '.mac-build-'));
try {
  const game = join(staging, 'game'); await mkdir(game);
  for (const file of await readdir(root)) {
    if (['.html', '.css', '.js'].includes(extname(file)) && file !== 'server.js' && !file.endsWith('.test.js')) await cp(join(root, file), join(game, file));
  }
  await cp(join(root, 'assets'), join(game, 'assets'), { recursive: true });
  await cp(join(root, 'desktop'), join(game, 'desktop'), { recursive: true, filter: source => !source.endsWith('.test.cjs') });
  await cp(join(root, 'network'), join(game, 'network'), { recursive: true, filter: source => !source.endsWith('.test.mjs') });
  await cp(join(root, 'node_modules', 'ws'), join(game, 'node_modules', 'ws'), { recursive: true });
  await writeFile(join(game, 'package.json'), JSON.stringify({ name: metadata.name, productName: metadata.productName, version: metadata.version, main: metadata.main, type: 'module' }, null, 2));
  const asar = join(staging, 'app.asar'); await createPackage(game, asar);
  // Both platforms receive identical current gameplay, offline audio and embedded GLB.
  for (const file of ['core.js', 'game.js', 'sounds.js', 'index.html', 'desktop/main.cjs', 'assets/characters/pixel-athlete-v2/game-renderer.js']) {
    if (!extractFile(asar, join(...file.split('/'))).equals(await readFile(join(root, file)))) throw new Error(`Stale macOS resource: ${file}`);
  }
  for (const arch of ['arm64', 'x64']) {
    console.log(`Preparing macOS ${arch} runtime...`);
    const runtime = await downloadArtifact({ version, artifactName: 'electron', platform: 'darwin', arch, cacheRoot: join(artifacts, '.electron-downloads'), checksums });
    const archive = join(output, `Shuttle-Flow-macOS-${arch}-${date}.zip`);
    await new Promise((resolveRun, reject) => {
      const child = spawn('python', [join(root, 'scripts', 'package-macos.py'), '--runtime', runtime, '--asar', asar, '--icon', join(root, 'assets', 'desktop', 'icon.png'), '--output', archive, '--arch', arch, '--version', metadata.version, '--report', join(artifacts, `mac-package-${arch}-checks.json`)], { cwd: root, windowsHide: true, stdio: 'inherit' });
      child.once('error', reject); child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`macOS ${arch} packaging failed (${code})`)));
    });
  }
} finally {
  if (dirname(staging) === root && basename(staging).startsWith('.mac-build-')) await rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
