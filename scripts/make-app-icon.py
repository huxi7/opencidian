#!/usr/bin/env python3
"""[INPUT]: assets/app-symbol.svg 唯一晶体源与原生 Icon Composer 配置。
[OUTPUT]: 透明 PNG、Windows ICO、Icon Composer 图层与 SHA-256 清单。
[POS]: 跨平台图标唯一导出入口；macOS 底板和材质交给 actool，不预制圆角。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

安装依赖：python3 -m pip install -r scripts/icon-requirements.txt
导出：python3 scripts/make-app-icon.py；只校验：追加 --check。
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
from PIL import Image, ImageChops
import resvg_py

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / 'build'
SYMBOL = ROOT / 'assets/app-symbol.svg'
MASTER = ROOT / 'assets/app-icon.png'
COMPOSER = BUILD / 'OpenSidian.icon'
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
FILES = ['assets/app-symbol.svg', 'assets/app-icon.png', 'build/icon.png',
         'build/icon.ico', 'build/OpenSidian.icon/icon.json',
         'build/OpenSidian.icon/Assets/crystal.svg']
MANIFEST = BUILD / 'icons.sha256.json'


def render_symbol():
    return Image.open(io.BytesIO(resvg_py.svg_to_bytes(
        svg_string=SYMBOL.read_text(encoding='utf-8'), width=1024, height=1024,
        skip_system_fonts=True))).convert('RGBA')


def composer_layer():
    # 原生画布只放晶体；底色、轮廓和反光由 Icon Composer 合成。
    return SYMBOL.read_bytes()


def check_image(image, expected=None):
    image = image.convert('RGBA')
    w, h = image.size
    assert w == h, '图标必须为正方形'
    alpha = image.getchannel('A')
    assert all(alpha.getpixel(p) == 0 for p in [(0, 0), (w-1, 0), (0, h-1), (w-1, h-1)]), '四角必须透明'
    assert alpha.getpixel((w//2, h//2)) == 255, '晶体中心必须不透明'
    assert any(0 < value < 255 for value in alpha.getdata()), '边缘必须含抗锯齿透明度'
    if expected is not None:
        assert image.size == expected.size, '图标尺寸偏离母版'
        assert not any(channel[1] for channel in ImageChops.difference(image, expected).getextrema()), '图标像素偏离晶体源'


def hashes():
    return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in FILES}


def verify(master):
    assert (BUILD / 'icon.png').read_bytes() == MASTER.read_bytes(), 'Linux PNG 必须逐字节保留透明晶体'
    check_image(Image.open(MASTER), master)
    ico = Image.open(BUILD / 'icon.ico')
    assert ico.ico.sizes() == {(size, size) for size in ICO_SIZES}, 'ICO 尺寸不完整'
    for size in ICO_SIZES:
        check_image(ico.ico.getimage((size, size)), master.resize((size, size), Image.Resampling.LANCZOS))
    assert (COMPOSER / 'Assets/crystal.svg').read_bytes() == composer_layer(), '原生图层必须保留唯一晶体源'
    config = json.loads((COMPOSER / 'icon.json').read_text(encoding='utf-8'))
    assert config['supported-platforms']['squares'] == ['macOS'], '原生图标只面向 macOS'
    assert config['groups'][0]['layers'][0]['image-name'] == 'crystal.svg', '原生图层必须指向透明晶体'
    assert json.loads(MANIFEST.read_text(encoding='utf-8')) == hashes(), '图标摘要清单过时'
    print(json.dumps({'pass': True, 'ico': ICO_SIZES, 'mac': 'Icon Composer / actool', 'sha256': hashes()}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    master = render_symbol()
    check_image(master)
    if not args.check:
        master.save(MASTER)
        (BUILD / 'icon.png').write_bytes(MASTER.read_bytes())
        master.save(BUILD / 'icon.ico', format='ICO', sizes=[(size, size) for size in ICO_SIZES])
        (COMPOSER / 'Assets').mkdir(parents=True, exist_ok=True)
        (COMPOSER / 'Assets/crystal.svg').write_bytes(composer_layer())
        MANIFEST.write_text(json.dumps(hashes(), indent=2) + '\n', encoding='utf-8')
    verify(master)


if __name__ == '__main__':
    main()
