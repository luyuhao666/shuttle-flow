import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';
import { createPackage } from '@electron/asar';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const require = createRequire(import.meta.url);
const electronVersion = require('electron/package.json').version;
const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const output = join(root, 'dist');
const portable = join(output, 'Shuttle Flow-win32-x64');
const reuseRuntime = process.argv.includes('--reuse-runtime');
if (!portable.startsWith(root + sep) || dirname(portable) !== output) throw new Error('Invalid desktop output path');
if (reuseRuntime) {
  const binary = join(portable, 'Shuttle Flow.exe'); await access(binary);
  const installedVersion = execFileSync(binary, ['-p', 'process.versions.electron'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, encoding: 'utf8'
  }).trim();
  if (installedVersion !== electronVersion) throw new Error(`Existing runtime ${installedVersion} does not match ${electronVersion}; use a full build.`);
}
execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts', 'create-desktop-icon.ps1')], { stdio: 'inherit', windowsHide: true });
await mkdir(output, { recursive: true });
const staging = await mkdtemp(join(root, '.desktop-build-'));
try {
  // Package the same front-end files; no fork or generated copy is edited by hand.
  for (const file of await readdir(root)) {
    if (['.html', '.css', '.js'].includes(extname(file)) && file !== 'server.js' && !file.endsWith('.test.js')) await cp(join(root, file), join(staging, file));
  }
  await cp(join(root, 'assets'), join(staging, 'assets'), { recursive: true });
  await cp(join(root, 'desktop'), join(staging, 'desktop'), { recursive: true, filter: source => !source.endsWith('.test.cjs') });
  await writeFile(join(staging, 'package.json'), JSON.stringify({ name: metadata.name, productName: metadata.productName, version: metadata.version, description: metadata.description, main: metadata.main, type: 'module' }, null, 2));
  await writeFile(join(staging, 'README.txt'), 'Shuttle Flow\r\nRun Shuttle Flow.exe. Keep the entire folder together.\r\nF11: fullscreen. P: pause. Settings save automatically.\r\nSettings > Language: English / Simplified Chinese.\r\n');
  const paths = reuseRuntime ? [portable] : await packager({ dir: staging, out: output, name: 'Shuttle Flow', platform: 'win32', arch: 'x64', electronVersion, download: { checksums: require('electron/checksums.json') }, asar: true, overwrite: true, prune: false, icon: join(root, 'assets', 'desktop', 'icon.ico'), appCopyright: 'Shuttle Flow', win32metadata: { ProductName: 'Shuttle Flow', FileDescription: 'Shuttle Flow badminton game' } });
  if (reuseRuntime) {
    const archive = join(staging, 'game.asar'); await createPackage(staging, archive);
    await cp(archive, join(portable, 'resources', 'app.asar'));
    await cp(join(staging,'README.txt'),join(portable,'README.txt'));
  }
  console.log(`Windows desktop game: ${join(paths[0], 'Shuttle Flow.exe')}`);
  await writeFile(join(portable, '打开游戏说明.txt'), '\uFEFF' + [
    'Shuttle Flow · 羽毛球游戏', '',
    '适用电脑：Windows 10 / 11，64 位。',
    '无需安装 Node.js、浏览器或其他开发工具，可离线游玩。', '',
    '启动方法',
    '1. 收到 ZIP 后，右键选择“全部解压缩”。',
    '2. 打开解压后的 Shuttle Flow-win32-x64 文件夹。',
    '3. 双击 Shuttle Flow.exe 开始游戏。',
    '请保留整个文件夹，不要只移动或发送 exe，也不要在压缩包里直接运行。', '',
    '基本操作',
    'WASD / 方向键：移动；空格：起跳。',
    '鼠标左键：高远球；Shift + 左键：吊球 / 挡网。',
    '鼠标右键：点杀 / 跳杀，低位接杀时可平抽。',
    '轮到你发球：停稳后左键发高远球，右键发小球。',
    '鼠标横向位置：瞄准；数字键 1 / 2 / 3：本球轻 / 中 / 重力度。',
    'F11：全屏；P / Esc：暂停；M：切换音效。',
    '游戏内“?”有完整帮助，切换窗口会自动暂停。',
    '界面默认英语；Settings > Language 可切换 English / 简体中文，自动保存。', '',
    '音量、球场、落点颜色和最高分自动保存在本机 %APPDATA%\\ShuttleFlow。',
    '每位玩家使用自己的设置和记录；游戏包不包含作者的存档。', '',
    '分享方法：发送完整 ZIP，对方解压后启动即可。'
  ].join('\r\n') + '\r\n');
} finally {
  // Delete only this build's generated staging directory under the workspace.
  if (dirname(staging) === root && basename(staging).startsWith('.desktop-build-')) await rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
