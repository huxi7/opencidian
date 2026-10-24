# 项目审查验收（2026-10-24）

当前阶段：并行修复后等待源码冻结和最终全量。
原版事实只读静态包。所有Electron验收使用隔离库及 --no-screenshot。

本轮基线 a39bf9a，工作区干净。build + canvas-dummy 75条通过。
命令：`sh scripts/with-lock.sh 'npm run build && node scripts/acceptance/run.mjs canvas-dummy --no-screenshot'`。
原始日志：`_analysis/project-audit-20261024/verification/baseline.log`。

历史结果、旧失败和旧包哈希保留于 [RESULTS-20261023.md](RESULTS-20261023.md)。
当前功能评估和缺陷清单见 [_analysis/project-audit-20261024/REPORT.md](../../_analysis/project-audit-20261024/REPORT.md)。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

## 文件安全与排除边界

- 回收站按system/local/none分派；系统失败降级临时库本地回收，失败不永久删除。
- 文件移动同步父子树。文本/附件排他创建；重命名拒绝已有磁盘目标。
- 定向audit-storage22条通过；Node新39、watch22、save32，分别通过。
- 统一metadataCache.isUserIgnored供插件使用；user-ignore单测22条通过。
- 原始失败与修后输出保存于verification/storage-*、node-user-ignore.json。
- 重命名预检仍有外部进程在检查后写入的竞争间隙，未宣称原子排他重命名。

## 文档加载与编辑命令

读取/JSON校验成功才接管文件；失败保留来源，冷开只序列化失败路径而不授予保存权限。
行交换执行真实正文事务；增量折叠按原版选区逐层执行。
首轮8场景515条通过，其中audit-interface61；冷开布局补修后新版audit-interface65条通过。
不能将分阶段补跑写成最终代码单次连续8场景通过，最终全量另列。
原失败和修后输出位于verification/interface-*，含坏Canvas原文被覆盖、折叠与冷开布局复现。
