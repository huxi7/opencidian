# OpenSidian

本地 Markdown 笔记应用。参考 Obsidian 独立重建，直接打开已有的 Obsidian 库。

笔记以本地文件保存，支持 `.obsidian` 配置、`.canvas` 白板与 `.base` 数据库。

## 功能

- **Markdown 编辑**：实时预览、源码模式与阅读视图，支持表格、代码高亮、数学公式和 Mermaid 图表。
- **知识关联**：双向链接、反向链接、关系图谱、标签、大纲与全文搜索。
- **白板与数据库**：组合笔记、文字、媒体与连线，用表格、列表、卡片和看板整理内容。
- **工作区**：分栏、标签页、独立文档窗口与布局恢复，支持明暗主题、CSS 片段和中英文。
- **内置工具**：每日笔记、模板、书签、命令面板与文件恢复。

## 下载

[macOS 版](https://github.com/huxi7/opencidian/releases/latest/download/opensidian-macos-arm64.dmg) · [Windows 版](https://github.com/huxi7/opencidian/releases/latest/download/opensidian-windows-x64.exe) · [Linux 版](https://github.com/huxi7/opencidian/releases/latest/download/opensidian-linux-x64.AppImage) · [全部版本](https://github.com/huxi7/opencidian/releases)

- **macOS**：Apple Silicon，打开 DMG 后拖入「应用程序」。
- **Windows**：x64，运行 EXE 安装程序。
- **Linux**：x64，为 AppImage 添加执行权限后运行。

首次启动时，选择已有的笔记文件夹，或新建一个库。无需安装 Node.js。

macOS 包使用 ad-hoc 完整性签名，尚无 Developer ID 签名与 Apple 公证；Windows 包未签名。系统可能显示安全提示。建议先用备份库体验。

macOS 的 ad-hoc 签名不让 Gatekeeper 自动信任下载。若被拦截，先对照 Release 的 `SHA256SUMS` 确认下载完整。确认来自本仓库后，校验应用签名，再单独解除这个应用的下载隔离：

```sh
codesign --verify --deep --strict /Applications/OpenSidian.app && xattr -dr com.apple.quarantine /Applications/OpenSidian.app
```

应用默认检查本仓库的新版本，并提示下载安装包，不会自动安装。可在「设置 → 关于」关闭自动检查；手动检查仍可用。

## 本地开发

需要 Node.js 22.18 或更新版本与 npm。

```sh
git clone https://github.com/huxi7/opencidian.git
cd opencidian
npm ci
npm start
```

`npm start` 先构建再启动。开发时用 `npm run dev` 启用严格类型检查与增量构建；主进程变更后重新启动命令。

## 构建与测试

```sh
npm test                     # 类型检查、构建、单元测试与工作区回归
npm run test:acceptance       # 完整隔离 Electron 验收
npm run dist                 # 为当前系统生成安装包
```

macOS 原生图标编译需要 macOS 26+ 与 Xcode 26+，仅安装 Command Line Tools 不足以打包。

产物位于 `release/`。推送 `vX.Y.Z` 标签后，GitHub 自动验证并发布三平台安装包，详见 [发布说明](scripts/RELEASING.md)。

## 源码结构

| 目录 | 职责 |
| --- | --- |
| [`src/main/`](src/main/) | Electron 窗口、原生菜单与文件写入 |
| [`src/renderer/core/`](src/renderer/core/) | 工作区、命令、设置与库文件索引 |
| [`src/renderer/editor/`](src/renderer/editor/) | CodeMirror 编辑器与实时预览 |
| [`src/renderer/markdown/`](src/renderer/markdown/) | 阅读视图与 Markdown 渲染 |
| [`src/renderer/plugins-core/`](src/renderer/plugins-core/) | 内置核心插件与数据库视图 |
| [`src/renderer/views/`](src/renderer/views/) | 白板、图谱与设置等视图 |
| [`src/renderer/styles/`](src/renderer/styles/) | 界面样式与主题变量 |
| [`scripts/`](scripts/) | 构建、发布与隔离验收 |
| [`assets/`](assets/) | 图标、字体与离线数学渲染资源 |

应用源码使用 TypeScript，基于 Electron 与 CodeMirror。技术栈与模块边界见 [架构地图](CLAUDE.md)。

## 兼容边界

- 兼容 Obsidian 库格式，不承诺全部功能与视觉细节一致。
- 仅提供内置核心插件，不加载社区插件，不提供 Sync、Publish 与账户服务。
- 社区主题下载与更新、Vim 按键映射尚未实现。
- 使用独立的应用数据目录，不读写 Obsidian 应用数据，不注册 `obsidian://` 协议。

本项目与 Obsidian 及其开发商无关联。「Obsidian」商标归其权利人所有。

## 许可证

[AGPL-3.0](LICENSE)。第三方依赖与素材遵循各自的许可证。
