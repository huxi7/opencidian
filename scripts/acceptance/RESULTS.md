# TypeScript 迁移验收

迁移与全量验收：2026-10-24。交付复核：2026-10-25。

## 验证结果

| 范围 | 结果 |
| --- | --- |
| 全部应用源码类型检查与构建 | 通过 |
| Node 测试 | 14 组，583 项断言通过 |
| 工作区 VM 回归 | 30 项通过 |
| 完整隔离 Electron 验收 | 92 个场景，125 次执行，8404 项断言，零失败 |
| macOS 目录包 | 72 项校验通过，真实进程正常退出 |
| 干净源码副本 | 不含本地分析资料，安装、测试与开发启动通过 |

完整 Electron 结果来自 10 月 24 日最后一轮连续执行的完成回执。
10 月 25 日重新执行了 npm test 与当前目录包冒烟。
各类验证分别计数，不合并为同一种测试。

## 复跑

需要 Node.js 22.18 或更新版本。

```sh
npm ci
npm test
npm run test:acceptance -- --output /tmp/opensidian-acceptance
npm run dist:dir
node scripts/smoke-packaged.mjs --no-screenshot
```

Electron 场景使用带标记的临时库，不操作真实笔记。
全量入口保存逐次日志、summary.json 与 summary.txt。

## 本轮修复与边界

- 应用源码改为 TypeScript，主进程与渲染器编译至 dist。
- DOM 工厂、文件模型与原子写入建立类型契约。
- 公式测试改用公开公式说明，解除原版解包文件依赖。
- CodeMirror 多选调用改为 EditorSelection，新增两个真实选区断言。
- 首轮全量有一次 window-save-race 失败，迁移前 JS 基线也能复现。
- 根因是隔离探针没有实际丢弃画布草稿。修正探针后，定向四次执行通过，最后一轮全量通过。
- extract-zip 的 yauzl 固定为 3.4.0，修复 Node 26 下 Electron 安装解压中断。依据见[上游修复](https://github.com/thejoshwolfe/yauzl/issues/169)。
- _analysis 与本地交接记录退出 Git 跟踪，文件仍保留在本地。没有重写既有 Git 历史。
- TypeScript 当前采用迁移兼容配置（strict:false），动态接口仍有 any；本轮不宣称全量严格类型化。
- CSS 与许可证保持原样。目录包未签名，Windows 未真机验证，未执行截图像素比较。

当前目录包 ASAR SHA-256：`d660c802d8d609437d693eba56255b6adfe5ec388f0a146cf46fc6231e963bcf`。
本地交付复核日志位于被忽略的 `_analysis/verification-typescript-20261025/`。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
