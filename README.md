# OpenSidian

本地 Markdown 笔记应用。参考 Obsidian 桌面版 1.14.4 独立重建，直接打开 Obsidian 库。

使用 TypeScript 开发，基于 Electron 与 CodeMirror 6，笔记以本地文件保存，支持 `.obsidian` 配置、`.canvas` 白板与 `.base` 数据库。

## 功能

- **Markdown 编辑**：实时预览、源码模式与阅读视图，支持表格编辑、代码高亮、数学公式和 Mermaid 图表。
- **知识关联**：双向链接、反向链接、关系图谱、标签、大纲与全文搜索。
- **白板**：组合笔记、文字、媒体与连线，支持分组、嵌入和图片导出。
- **数据库**：表格、列表、卡片与看板视图，支持筛选、排序、分组、公式和 CSV 导出。
- **工作区**：分栏、标签页、独立文档窗口与布局恢复，支持明暗主题、CSS 片段和中英文。
- **内置工具**：每日笔记、模板、书签、命令面板与文件恢复。

## 本地开发

需要 Node.js 22.18 或更新版本与 npm。

```sh
git clone https://github.com/huxi7/opencidian.git
cd opencidian
npm ci
npm start
```

首次启动时，选择已有的笔记文件夹，或新建一个库。`npm start` 会先构建再启动应用。

开发时使用 `npm run dev` 启用类型检查与增量构建。主进程变更后，重新启动开发命令。

## 打包

```sh
npm run dist:dir   # 生成应用目录包
npm run dist       # 生成 DMG 与 ZIP
```

当前打包配置面向 macOS，产物输出至 `release/`。构建未签名。

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
| [`scripts/`](scripts/) | 构建、打包检查与隔离验收 |
| [`assets/`](assets/) | 图标、字体与离线数学渲染资源 |

技术栈与模块边界见 [架构地图](CLAUDE.md)。

## 验收

```sh
npm test                     # 类型检查、构建、Node 测试与工作区回归
npm run test:acceptance       # 完整隔离 Electron 验收
```

Electron 验收使用隔离的临时库，窗口不可见且不抢焦点。场景说明与已有记录见 [验收目录](scripts/acceptance/CLAUDE.md) 和 [验收记录](scripts/acceptance/RESULTS.md)。

## 兼容边界

- 兼容 Obsidian 库格式，以桌面版 1.14.4 为对照；不承诺全部功能与视觉细节一致。
- 仅提供内置核心插件，不加载社区插件；不提供 Sync、Publish、Web Viewer、斜杠命令、密钥链、账户与 Insider 构建。
- 社区主题下载与更新、Vim 按键映射尚未实现。Windows 尚未真机验证。
- 应用使用独立的数据目录，不读写 Obsidian 应用的用户数据目录，不注册 `obsidian://` 协议。

本项目与 Obsidian 及其开发商无关联。「Obsidian」商标归其权利人所有。

## 许可证

Copyright © 2026 OpenSidian contributors.

[AGPL-3.0-or-later](LICENSE)。第三方依赖与素材遵循各自的许可证。
