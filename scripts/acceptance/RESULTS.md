# 窗口外壳跨平台修复

日期：2026-11-01。以下结果来自本轮源码。

## 修复范围

Windows/Linux 的无边框窗口使用右上角按钮。
三个按钮各宽 42px，总净空 126px。
主窗口、文档窗口、设置窗口和启动页共用外壳。
原生边框不再重复绘制应用按钮。
启动页保持固定尺寸，禁用最大化。
最大化、还原、全屏和页面重载同步窗口状态。

上下分屏时，右开关与净空跟随顶边标签组。
全屏时隐藏按钮并释放右侧净空。
设置独立窗口保留标题，内容让出标题栏。
macOS 保留现有红绿灯坐标与布局。
custom 继续使用现有融合布局，不宣称完整复刻模式差异。

## 本轮验证

| 范围 | 结果 |
| --- | --- |
| 严格类型检查与构建 | 通过 |
| Node 回归 | 24 组、822 项通过 |
| 工作区 VM 回归 | 34 项通过 |
| macOS 隔离 Electron 回归 | 7 场景、12 次执行、1321 项通过 |
| 跨平台 DOM 与 CSS 矩阵 | 198 项通过 |

Electron 回归覆盖侧栏、工具栏、分屏、设置、仓库选择、
文档窗口与重启恢复。全部使用 --no-screenshot。
原始回执在 `_analysis/window-chrome-20261101/`。

平台矩阵使用真实 Chromium、应用 CSS 与共享窗口构造器。
它替换平台标识和 IPC，不伪造元素尺寸。
矩阵覆盖三平台、hidden/custom/native、按钮操作通道、
最大化图标、全屏、上下分屏、侧栏折叠、125%/150% 缩放。
设置标题与固定尺寸窗口的禁用操作也有断言。

本轮运行宿主为 macOS。
Windows/Linux 的原生拖动、贴靠、系统 DPI 和桌面环境仍待真机验收。
本轮未生成、安装或发布新安装包。

复跑：

```sh
npm test
node scripts/acceptance/run.mjs platform-chrome --no-screenshot
sh scripts/acceptance/full.sh --skip-build --only sidebar-chrome,sidebar-shell,sidebar-toolbars,layout-split,settings-window,vault-switcher,document-window --output _analysis/window-chrome-20261101
```

以下为 2026-10-26 的历史严格类型验收。

# 全量 TypeScript 严格类型验收

日期：2026-10-26。

## 类型范围

全部 228 个 TypeScript 文件启用 strict:true。
应用 src 中没有 JavaScript，没有显式 any。
没有使用 @ts-nocheck 或 @ts-ignore 跳过检查。
类型正反例和 AST 检查阻止这些约束退化。

tsconfig.json 是唯一类型检查配置。
构建前执行检查；开发模式只启动一个检查器。
第三方声明保留 skipLibCheck，不代表已修复依赖声明。
外部 JSON、DOM 和 Worker 回执按各自边界收窄。

工作区事件按名称绑定参数元组。
配置、元数据、编辑器和表格使用共享契约。
白板、图谱、搜索和 Bases 不再依赖动态 any。
CSS 与主题结构保持不变。

## 验证结果

| 范围 | 结果 |
| --- | --- |
| 全应用严格检查与构建 | 通过 |
| 最终 Node 测试 | 18 组、713 项通过，含 35 项类型约束检查 |
| 最终工作区 VM 回归 | 34 项通过 |
| 全量隔离 Electron 首轮 | 93 场景、126 次执行，124 次通过、2 次失败 |
| 修复后最终补验 | 5 场景、6 次执行、282 项通过，零失败 |
| macOS arm64 目录包 | 73 项通过，真实进程正常退出 |

首轮两个失败分别为 editor-menu 与 strict-regression。
前者定位到原生菜单参数缺失时误禁用粘贴。
后者是新增测试过早读取尚未写入的布局文件。
修复粘贴回退，并让测试等待布局文件生成。
标签关闭测试通过停用插件走真实关闭生命周期。

补验覆盖 editor、editor-menu、editor-paste、
properties-editing（含重启验证）和 strict-regression。
补验使用最终构建；首轮其余场景不重复计数。
以通过的补验替换首轮失败项，覆盖 8430 项有效断言。
原始失败日志保留；不把首轮描述为一次全绿。

目录包来自最终源码，核对运行文件与全部样式哈希。
ASAR SHA-256：`4f3496a917448d7f5eb40d6b48b00ad1fc96751a5335c70a441b6c7943d04c04`。

## 修复边界

- 图谱 Worker 保留固定坐标 0，拒绝损坏位置缓冲区。
- 白板统一校验 JSON，坏输入不接管文件或保存基线。
- 搜索从活动宿主读取编辑器，筛选变化进入布局保存链。
- 文件树停用撤销命令；标签视图关闭取消延迟重绘。
- 恢复快照前保存失败时，保留原文和未保存草稿。
- Markdown 块引用回退使用 lineCount 属性。
- 演示关闭按钮接入销毁入口。
- 原生菜单参数超时时，编辑器保留粘贴入口。

## 复跑

需要 Node.js 22.18 或更新版本。

```sh
npm ci
npm test
npm run test:acceptance -- --output /tmp/opensidian-acceptance
npm run dist:dir
node scripts/smoke-packaged.mjs --no-screenshot
```

验收使用隔离临时库，不操作真实笔记，不截图。
目录包未签名；Windows 未真机验证。
没有发布新的 GitHub Release。

本地原始日志与源码哈希位于被忽略的
`_analysis/verification-strict-all-20261026/`。
分析资料、构建产物和本地交接记录不纳入 Git。
源码文件均不超过 800 行，L1/L2/L3 地图已同步。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
