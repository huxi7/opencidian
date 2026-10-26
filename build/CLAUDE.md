# build/
> L2 | 父级: ../CLAUDE.md

成员清单
icon.svg: 附件最终矢量设计稿。保留连续圆角和原始水晶图案。
icon.png: assets/app-icon.png 的逐字节副本。供 Linux 打包器读取。
icon.ico: Windows 应用、安装器和卸载器图标。包含 16–256px 七档。
icon.icns: macOS 应用和 DMG 卷图标。包含 32–1024px 帧及 Retina 表示。
icons.sha256.json: 最终资源摘要。打包前拒绝未重新确认的资源变更。

PNG 母版固定批准像素；SVG 保留后续编辑入口。
用 scripts/make-app-icon.py 导出，不重绘或叠加圆角。
--check 比较各帧像素，不依赖 PNG 压缩字节跨环境一致。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
