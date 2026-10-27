# build/
> L2 | 父级: ../CLAUDE.md

成员清单
OpenSidian.icon/: macOS 原生 Icon Composer 资源。黑色底板与晶体分层；系统生成圆角和材质。
icon.png: 透明晶体 PNG。供 Linux 打包器读取。
icon.ico: Windows 应用、安装器和卸载器图标。包含 16–256px 七档。
icons.sha256.json: 源文件与导出资源摘要。打包前拒绝未经重新导出的改动。

OpenSidian.icon/icon.json 定义黑色渐变底板和晶体材质。
OpenSidian.icon/Assets/crystal.svg 由唯一晶体源导出。
用 scripts/make-app-icon.py 同步图层与透明图标。
macOS 打包使用 Xcode 26+ 的 actool。
打包器生成 Assets.car 与系统兼容表示。
仓库不维护预制圆角 PNG 或 ICNS。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
