#!/usr/bin/env python3
"""[INPUT]: 当前平台安装包、目录包与 build/icon.* 最终资源。
[OUTPUT]: 安装包内部图标比对与安装包 SHA-256 回执。
[POS]: CI 图标验收。解包实际 DMG、NSIS 和 AppImage，不安装应用。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
"""
import hashlib
import json
from pathlib import Path
import plistlib
import shutil
import struct
import subprocess
import sys
import tempfile
from PIL import Image, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parents[1]
CHECKS = []


def check(value, label):
    if not value:
        raise AssertionError(label)
    CHECKS.append(label)


def same_file(actual, expected):
    check(actual.read_bytes() == expected.read_bytes(), str(actual) + ': 与最终资源逐字节一致')


def run(args, **kwargs):
    return subprocess.check_output([str(arg) for arg in args], **kwargs)


def ico_frames():
    data = (ROOT / 'build/icon.ico').read_bytes()
    frames = {}
    for i in range(struct.unpack_from('<H', data, 4)[0]):
        w, h, colors, reserved, planes, depth, length, offset = struct.unpack_from('<BBBBHHII', data, 6 + 16*i)
        frames[w or 256] = data[offset:offset+length]
    return frames


def verify_pe(binary):
    import pefile
    pe = pefile.PE(str(binary))
    try:
        resources = {}
        for kind in pe.DIRECTORY_ENTRY_RESOURCE.entries:
            if kind.id != 3:
                continue
            for item in kind.directory.entries:
                for language in item.directory.entries:
                    entry = language.data.struct
                    resources[item.id] = pe.get_data(entry.OffsetToData, entry.Size)
        # rcedit 与 NSIS 将 ICO 帧原样写入 RT_ICON。
        expected = ico_frames()
        for size, data in expected.items():
            check(data in resources.values(), f'{binary.name}: 内嵌 {size}px 最终图标')
    finally:
        pe.close()


def verify_png(file):
    actual = Image.open(file).convert('RGBA')
    master = Image.open(ROOT / 'assets/app-icon.png').convert('RGBA')
    check(actual.width == actual.height and actual.width >= 16, str(file) + ': 有效尺寸')
    # Linux 打包器使用自身缩放器；在黑、白底上比较，容许滤波差异。
    expected = master.resize(actual.size, Image.Resampling.LANCZOS)
    check(actual.getpixel((0, 0))[3] == 0, str(file) + ': 透明边缘')
    for color in ['white', 'black']:
        bg = Image.new('RGBA', actual.size, color)
        a = Image.alpha_composite(bg, actual).convert('RGB')
        b = Image.alpha_composite(bg, expected).convert('RGB')
        error = max(ImageStat.Stat(ImageChops.difference(a, b)).rms)
        check(error < 6, f'{file.name}: {color} 背景像素 RMS={error:.3f} < 6')


def verify_mac(temp):
    installer = ROOT / 'release/opensidian-macos-arm64.dmg'
    mount = temp / 'volume'
    run(['hdiutil', 'attach', installer, '-readonly', '-nobrowse', '-mountpoint', mount, '-plist'])
    try:
        app = mount / 'OpenSidian.app/Contents'
        info = plistlib.loads((app / 'Info.plist').read_bytes())
        icon = info['CFBundleIconFile']
        if not icon.endswith('.icns'):
            icon += '.icns'
        same_file(app / 'Resources' / icon, ROOT / 'build/icon.icns')
        same_file(mount / '.VolumeIcon.icns', ROOT / 'build/icon.icns')
        same_file(app / 'Resources/app.asar', ROOT / 'release/mac-arm64/OpenSidian.app/Contents/Resources/app.asar')
    finally:
        run(['hdiutil', 'detach', mount])
    return installer


def verify_windows(temp):
    installer = ROOT / 'release/opensidian-windows-x64.exe'
    verify_pe(installer)
    verify_pe(ROOT / 'release/win-unpacked/OpenSidian.exe')
    seven = shutil.which('7z') or r'C:\Program Files\7-Zip\7z.exe'
    run([seven, 'x', installer, '-o' + str(temp / 'nsis'), '-y'])
    archives = list((temp / 'nsis').rglob('app-64.7z'))
    check(len(archives) == 1, 'NSIS 包含唯一 x64 应用归档')
    unpacked = temp / 'app'
    run([seven, 'x', archives[0], '-o' + str(unpacked), '-y'])
    verify_pe(unpacked / 'OpenSidian.exe')
    same_file(unpacked / 'resources/app.asar', ROOT / 'release/win-unpacked/resources/app.asar')
    uninstallers = list((temp / 'nsis').rglob('*uninstaller*.exe'))
    check(bool(uninstallers), 'NSIS 包含卸载程序')
    for uninstaller in uninstallers:
        verify_pe(uninstaller)
    return installer


def verify_linux(temp):
    installer = ROOT / 'release/opensidian-linux-x86_64.AppImage'
    run([installer, '--appimage-extract'], cwd=temp)
    app = temp / 'squashfs-root'
    verify_png(app / '.DirIcon')
    icons = list((app / 'usr/share/icons').rglob('*.png'))
    check(bool(icons), 'AppImage 包含桌面图标')
    for icon in icons:
        verify_png(icon)
    desktop = list(app.glob('*.desktop'))
    check(len(desktop) == 1 and 'Icon=opensidian' in desktop[0].read_text(), '桌面入口指向 OpenSidian 图标')
    same_file(app / 'resources/app.asar', ROOT / 'release/linux-unpacked/resources/app.asar')
    return installer


if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='opensidian-icons-') as folder:
        platform = {'darwin': verify_mac, 'win32': verify_windows, 'linux': verify_linux}[sys.platform]
        installer = platform(Path(folder))
        print(json.dumps({'pass': True, 'count': len(CHECKS), 'checks': CHECKS,
                          'installer': installer.name,
                          'sha256': hashlib.sha256(installer.read_bytes()).hexdigest()}, ensure_ascii=False))
