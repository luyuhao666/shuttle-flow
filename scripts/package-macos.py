"""Preserve official Mach-O binaries, executable modes and framework symlinks in ZIP."""
import argparse
import copy
import hashlib
import json
import plistlib
import posixpath
import shutil
import stat
import struct
import zipfile
from pathlib import Path

parser = argparse.ArgumentParser()
for name in ('runtime', 'asar', 'icon', 'output', 'arch', 'version', 'report'):
    parser.add_argument('--' + name, required=True)
args = parser.parse_args()
output = Path(args.output)
bundle = 'Shuttle Flow.app/'
source_bundle = 'Electron.app/'
main_binary = 'Contents/MacOS/Electron'
chip = 'Apple 芯片（M1 / M2 / M3 / M4 / M5 等）' if args.arch == 'arm64' else 'Intel 处理器'
instructions = f'''Shuttle Flow · Mac 分享版

适用电脑：{chip}，macOS 13 或更新版本。
无需 Node.js、浏览器或开发工具，可离线游玩。
可在 Mac 的苹果菜单 → 关于本机查看芯片与 macOS 版本。

启动方法
1. 在 Mac 上双击 ZIP 解压（不要先在 Windows 上解压再传文件夹）。
2. 将 Shuttle Flow.app 拖入“应用程序”文件夹，然后双击打开。
3. 当前为未签名、未公证的个人分享版；如果提示开发者无法验证，
   在尝试打开后进入“系统设置 → 隐私与安全性”，选择“仍要打开”。
   Apple 官方说明：https://support.apple.com/102445
4. 当前包在 Windows 上构建并验证结构，尚未在 Mac 真机验证启动。

基本操作
WASD / 方向键：移动；空格：起跳。
鼠标左键：高远球；Shift + 左键：吊球 / 挡网。
鼠标右键：点杀 / 跳杀，低位接杀时可平抽。
触控板可用双指点按作为右键（需开启 macOS 的辅助点按设置）。
鼠标横向位置：瞄准；数字键 1 / 2 / 3：本球力度。
P / Esc：暂停；M：切换音效；F11（部分键盘需 Fn + F11）：全屏。
也可点击游戏内全屏按钮；Command + Q 退出游戏。
游戏内“?”有完整帮助，切换窗口会自动暂停。

存档保存在本机 ~/Library/Application Support/ShuttleFlow。
包内不含作者存档；将完整 ZIP 发送给相同芯片类型的朋友即可。
'''


def add_file(target, name, data, mode=0o644):
    entry = zipfile.ZipInfo(name)
    entry.create_system = 3
    entry.external_attr = (stat.S_IFREG | mode) << 16
    entry.compress_type = zipfile.ZIP_DEFLATED
    target.writestr(entry, data)


with zipfile.ZipFile(args.runtime) as original, zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=5) as target:
    for entry in original.infolist():
        if entry.filename == source_bundle + 'Contents/Resources/default_app.asar':
            continue
        if entry.filename.startswith(source_bundle):
            relative = entry.filename[len(source_bundle):]
            name = bundle + relative
        else:
            name = entry.filename
        if '..' in name.split('/') or name.startswith('/'):
            raise ValueError('Unexpected runtime path: ' + name)
        if entry.filename == source_bundle + 'Contents/Info.plist':
            plist = plistlib.loads(original.read(entry))
            plist.update(CFBundleDisplayName='Shuttle Flow', CFBundleName='Shuttle Flow',
                         CFBundleIdentifier='com.shuttleflow.game', CFBundleShortVersionString=args.version,
                         CFBundleVersion=args.version, CFBundleIconFile='shuttle.icns',
                         LSApplicationCategoryType='public.app-category.sports-games')
            # Leave the original executable/helper names and binaries intact. This
            # preserves their native signatures and Chromium helper lookup paths.
            plist.pop('ElectronAsarIntegrity', None)
            add_file(target, name, plistlib.dumps(plist))
            continue
        info = copy.copy(entry)
        info.filename = name
        info.compress_type = zipfile.ZIP_DEFLATED
        with original.open(entry) as source, target.open(info, 'w') as destination:
            shutil.copyfileobj(source, destination, 1024 * 1024)
    add_file(target, bundle + 'Contents/Resources/app.asar', Path(args.asar).read_bytes())
    png = Path(args.icon).read_bytes()
    # ic08 is the native ICNS element for a 256x256 PNG.
    icon = b'icns' + struct.pack('>I', len(png) + 16) + b'ic08' + struct.pack('>I', len(png) + 8) + png
    add_file(target, bundle + 'Contents/Resources/shuttle.icns', icon)
    add_file(target, '打开游戏说明.txt', ('\ufeff' + instructions).encode('utf-8'))

with zipfile.ZipFile(output) as archive, zipfile.ZipFile(args.runtime) as original:
    assert archive.testzip() is None, 'ZIP content integrity failure'
    names = set(archive.namelist())
    assert len(names) == len(archive.infolist()), 'Duplicate ZIP entries'
    plist = plistlib.loads(archive.read(bundle + 'Contents/Info.plist'))
    assert plist['CFBundleExecutable'] == 'Electron'
    assert plist['LSMinimumSystemVersion'] == '13.0'
    assert bundle + 'Contents/Resources/default_app.asar' not in names
    assert archive.read(bundle + 'Contents/Resources/app.asar') == Path(args.asar).read_bytes()
    main = archive.getinfo(bundle + main_binary)
    assert (main.external_attr >> 16) & 0o111, 'Lost executable mode'
    binary = archive.read(main)
    assert binary == original.read(source_bundle + main_binary), 'Original Mach-O changed'
    assert binary[:4] == b'\xcf\xfa\xed\xfe'
    cpu = struct.unpack_from('<I', binary, 4)[0]
    assert cpu == (0x0100000C if args.arch == 'arm64' else 0x01000007), 'Incorrect CPU architecture'
    links = []
    executables = 0
    link_targets = {e.filename: archive.read(e).decode('utf-8') for e in archive.infolist() if stat.S_ISLNK(e.external_attr >> 16)}

    def resolve_link(path):
        # Frameworks use linked directory components such as Versions/Current.
        for _ in range(40):
            parts = path.split('/')
            for i in range(len(parts)):
                component = '/'.join(parts[:i + 1])
                if component in link_targets:
                    destination = link_targets[component]
                    assert not destination.startswith('/'), 'Absolute framework link'
                    path = posixpath.normpath(posixpath.join(posixpath.dirname(component), destination, *parts[i + 1:]))
                    assert path.startswith(bundle), 'Framework link escapes app'
                    break
            else:
                return path
        raise AssertionError('Circular framework link')

    for entry in archive.infolist():
        mode = entry.external_attr >> 16
        if stat.S_ISLNK(mode):
            link = archive.read(entry).decode('utf-8')
            resolved = resolve_link(entry.filename)
            assert not link.startswith('/') and resolved.startswith(bundle), 'Unsafe symlink'
            assert resolved in names or resolved + '/' in names or any(n.startswith(resolved + '/') for n in names), 'Broken framework symlink'
            links.append(entry.filename)
        if stat.S_ISREG(mode) and mode & 0o111:
            executables += 1
    assert len(links) >= 10 and executables >= 5, 'Missing framework links or executable permissions'
    report = dict(archive=str(output.resolve()), bytes=output.stat().st_size,
                  sha256=hashlib.file_digest(output.open('rb'), 'sha256').hexdigest(),
                  arch=args.arch, minimumMacOS=plist['LSMinimumSystemVersion'], files=len(names),
                  symlinks=len(links), executables=executables, machOUnchanged=True,
                  asarMatches=True, developerSigned=False, notarized=False, nativeMacTested=False)
    Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))
