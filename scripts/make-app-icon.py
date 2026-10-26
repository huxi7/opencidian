#!/usr/bin/env python3
"""[INPUT]: assets/app-icon.png 的最终 RGBA 母版与 build/icon.svg 设计稿。
[OUTPUT]: build/icon.png、icon.ico、icon.icns 与 SHA-256 清单。
[POS]: 图标唯一导出入口。保留母版圆角，不重绘图案或叠加蒙版。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

安装依赖：python3 -m pip install -r scripts/icon-requirements.txt
导出：python3 scripts/make-app-icon.py；只校验：追加 --check。
SVG 保留可编辑设计稿；批准后的 PNG 是跨平台像素事实源。
"""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / 'build'
MASTER = ROOT / 'assets/app-icon.png'
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
FILES = ['assets/app-icon.png', 'build/icon.svg', 'build/icon.png',
         'build/icon.ico', 'build/icon.icns']
MANIFEST = BUILD / 'icons.sha256.json'


def check_image(image, expected=None):
    image = image.convert('RGBA')
    w, h = image.size
    assert w == h, '图标必须为正方形'
    alpha = image.getchannel('A')
    assert all(alpha.getpixel(p) == 0 for p in [(0, 0), (w-1, 0), (0, h-1), (w-1, h-1)]), '四角必须透明'
    assert alpha.getpixel((w//2, h//2)) == 255, '图标中心必须不透明'
    assert any(0 < value < 255 for value in alpha.getdata()), '边缘必须含抗锯齿透明度'
    if expected is not None:
        # 比较全部通道；不能让透明通道掩盖 RGB 差异。
        assert not any(ImageChops.difference(image, expected).getextrema()[i][1] for i in range(4)), '图标像素偏离母版'


def hashes():
    return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in FILES}


def verify(master):
    assert (BUILD / 'icon.png').read_bytes() == MASTER.read_bytes(), 'PNG 必须逐字节保留母版'
    check_image(Image.open(BUILD / 'icon.png'), master)
    ico = Image.open(BUILD / 'icon.ico')
    assert ico.ico.sizes() == {(size, size) for size in ICO_SIZES}, 'ICO 尺寸不完整'
    for size in ICO_SIZES:
        check_image(ico.ico.getimage((size, size)), master.resize((size, size), Image.Resampling.LANCZOS))
    icns = Image.open(BUILD / 'icon.icns')
    sizes = icns.info['sizes']
    assert {w * scale for w, h, scale in sizes} >= {32, 64, 128, 256, 512, 1024}, 'ICNS 尺寸不完整'
    for size in sizes:
        frame = icns.icns.getimage(size).convert('RGBA')
        check_image(frame, master.resize(frame.size, Image.Resampling.BICUBIC))
    assert json.loads(MANIFEST.read_text()) == hashes(), '图标摘要清单过时'
    print(json.dumps({'pass': True, 'ico': ICO_SIZES, 'icns': sizes, 'sha256': hashes()}, ensure_ascii=True))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    master = Image.open(MASTER)
    assert master.mode == 'RGBA' and master.size == (1024, 1024), '母版必须为 1024px RGBA'
    check_image(master)
    if not args.check:
        (BUILD / 'icon.png').write_bytes(MASTER.read_bytes())
        master.save(BUILD / 'icon.ico', format='ICO', sizes=[(size, size) for size in ICO_SIZES])
        master.save(BUILD / 'icon.icns', format='ICNS')
        MANIFEST.write_text(json.dumps(hashes(), indent=2) + '\n')
    verify(master)


if __name__ == '__main__':
    main()
