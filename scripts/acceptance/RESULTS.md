# TypeScript 严格类型验收

日期：2026-10-25。

## 类型范围

应用源码为 215 个 TypeScript 文件，src 中没有 JavaScript。
严格配置覆盖 20 个文件：全部主进程、共享协议、IPC、事件、库文件、布局校验与文件视图分派。
构建执行全应用兼容检查和该范围的 strict:true 检查。
开发模式同时监听两套检查。

主进程和库文件模型无显式 any。
Events 的默认事件表保留一处动态兼容类型。
已声明 VaultEvents 的宿主按名称和参数元组检查。
其余界面模块仍使用兼容配置，不代表全项目已严格类型化。

剩余 JavaScript 来自构建工具、验收脚本和第三方 MathJax。
dist 中的 JavaScript 是编译产物，不纳入 Git。
MathJax 通过 .gitattributes 标记为第三方资源。

## 验证结果

| 范围 | 结果 |
| --- | --- |
| 全应用兼容检查与 20 文件严格检查 | 通过 |
| Node 测试 | 16 组，627 项断言通过，含 21 项类型正反例 |
| 工作区 VM 回归 | 34 项通过 |
| 完整隔离 Electron 验收 | 92 个场景，125 次执行，8404 项断言，零失败 |
| 最终文件系统补验 | 2 次执行，24 项断言，零失败 |
| 开发模式 | 两套类型检查、增量编译及应用装配通过，进程正常退出 |
| macOS arm64 目录包 | 73 项校验通过，真实进程正常退出 |

完整 Electron 验收使用本轮集成构建。
跨 VM 错误码识别修复在最终构建重跑 audit-storage 和 vault-hidden。
最终源码另过全部 Node、工作区与严格检查；目录包也来自最终构建。
各类验证分别计数。

## 逻辑改进

- IPC 将通道名、参数元组和回执绑定，保留同步与异步差异。
- 文件树区分文件和文件夹，监听返回明确就绪结果。
- Markdown 复制只读取一次，去掉重复二进制读取。
- 防抖结算和取消后释放参数与宿主引用。
- 事件字典消除 constructor 与 __proto__ 名称碰撞。
- 布局使用迭代校验，拒绝祖先循环、坏比例和坏状态。
- 关闭抛出 null 或字符串时保留视图和草稿。
- 原生菜单弹出失败后释放监听，令牌使用真实数字协议。
- 文件系统错误按 code 字段识别，兼容跨 VM 的 Error。
- 无父窗口对话框使用正确重载；窗口边框只接受合法值。

## 复跑

需要 Node.js 22.18 或更新版本。

```sh
npm ci
npm test
npm run test:acceptance -- --output /tmp/opensidian-acceptance
npm run dist:dir
node scripts/smoke-packaged.mjs --no-screenshot
```

验收使用带标记的临时库，不操作真实笔记，不执行截图比较。
目录包未签名，Windows 未真机验证。

目录包 ASAR SHA-256：`c69eb73f04abedd9fd5c3eab42669c4105de59c9b9a066e89ae3dcf6f4afd5d2`。
本地原始日志位于被忽略的 `_analysis/verification-strict-20261025/`。
源码文件均不超过 800 行，L1/L2/L3 地图已同步。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
