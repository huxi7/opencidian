#!/usr/bin/env python3
"""生成 OpenSidian 应用图标（原创几何设计：地平线与曜日）。

输出 build/icon.png（1024）与 build/icon.icns（iconutil 打包的 iconset）。
用法：python3 scripts/make-app-icon.py
"""
import os
import shutil
import subprocess
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, 'build')
SIZE = 1024
MARGIN = 64
RADIUS = 200


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make_icon():
    img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 圆角矩形底：竖向深靛渐变
    top, bottom = (54, 60, 86), (30, 34, 50)
    rect = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rect)
    for y in range(SIZE):
        rd.line([(0, y), (SIZE, y)], fill=lerp(top, bottom, y / SIZE) + (255,))
    mask = Image.new('L', (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle([MARGIN, MARGIN, SIZE - MARGIN, SIZE - MARGIN], radius=RADIUS, fill=255)
    img.paste(rect, (0, 0), mask)

    # 曜日：位于地平线之上，琥珀渐变
    horizon = 596
    sun_r = 190
    sun = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sun)
    for r in range(sun_r, 0, -1):
        t = r / sun_r
        color = lerp((250, 205, 96), (232, 150, 58), t)
        sd.ellipse([512 - r, horizon - r, 512 + r, horizon + r], fill=color + (255,))
    img.paste(sun, (0, 0), mask)  # 裁剪到圆角底内

    # 光线：两条细弧
    glow = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.arc([512 - 300, horizon - 300, 512 + 300, horizon + 300], start=200, end=340, fill=(250, 205, 96, 90), width=16)
    img.alpha_composite(glow)

    # 地平线
    draw.rounded_rectangle([512 - 300, horizon - 14, 512 + 300, horizon + 14], radius=14, fill=(240, 242, 248, 235))

    # 星点
    for (x, y, r, a) in [(300, 300, 12, 210), (742, 252, 9, 180), (688, 372, 7, 150)]:
        draw.ellipse([x - r, y - r, x + r, y + r], fill=(226, 232, 240, a))

    return img


def build_iconset(icon):
    iconset = os.path.join(BUILD, 'icon.iconset')
    if os.path.isdir(iconset):
        shutil.rmtree(iconset)
    os.makedirs(iconset)
    plan = [
        (16, 'icon_16x16.png'), (32, 'icon_16x16@2x.png'),
        (32, 'icon_32x32.png'), (64, 'icon_32x32@2x.png'),
        (128, 'icon_128x128.png'), (256, 'icon_128x128@2x.png'),
        (256, 'icon_256x256.png'), (512, 'icon_256x256@2x.png'),
        (512, 'icon_512x512.png'), (1024, 'icon_512x512@2x.png'),
    ]
    for size, name in plan:
        icon.resize((size, size), Image.LANCZOS).save(os.path.join(iconset, name))
    return iconset


def main():
    os.makedirs(BUILD, exist_ok=True)
    icon = make_icon()
    icon.save(os.path.join(BUILD, 'icon.png'))
    iconset = build_iconset(icon)
    if sys.platform == 'darwin':
        out = os.path.join(BUILD, 'icon.icns')
        subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', out], check=True)
        print('icon.icns ->', out)
    print('icon.png ->', os.path.join(BUILD, 'icon.png'))


if __name__ == '__main__':
    main()
