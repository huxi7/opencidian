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
