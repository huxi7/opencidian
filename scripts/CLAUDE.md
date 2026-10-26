# scripts/

> L2 | 父级: /CLAUDE.md

构建与开发脚本。TypeScript 先检查类型，再由 esbuild 生成主进程和渲染器 JS。

成员清单
RELEASING.md: 标签版本、三平台范围、发布步骤与失败恢复。
release-config.mjs: 平台清单、标签版本、目录包路径与附件校验，供 CI 和本地打包共用。
package.mjs: 当前平台安装包入口。版本只注入打包元数据，禁止隐式发布。
release.mjs: 读取远端标签说明，上传草稿并比对摘要；三端齐备后公开。
release.test.mjs: 标签、附件完整性、工作流权限边界与运行时版本回归。
canvas-data.test.mjs: 画布 JSON、坏文件切换、块引用回退与演示关闭回归，不启动 Electron。
graph-simulation.test.mjs: 图谱 Worker 回执回归。固定零坐标、坏缓冲区、代次与销毁边界。
cdp-probe.mjs: 本地原版 CDP 只读探针，输出被忽略的分析目录；不参与构建和正式验收。
build-config.mjs: 唯一构建配置源。主进程输出 CommonJS，渲染器和 Worker 输出浏览器包。
type-contracts.test.mjs: 编译正反例，验证 IPC、事件、布局、编辑器与画布契约；防止显式 any 和检查豁免回归。
events.test.mjs: 原型名称、once 重入和防抖 run/cancel/resetTimer 的确定性回归。
test-unit.mjs: 串行运行独立 Node 测试，验证回执并汇总失败。
workspace-regression.mjs: 隔离 VM 验证工作区状态、生命周期、循环布局拒绝与异常关闭保留。
build.mjs: 读取共用配置，编译主进程、主窗口、启动器和图谱 Worker；--watch 增量构建。
dev.mjs: 开发模式。全量严格检查与增量编译共用一套配置；退出释放检查器。主进程变更需重启命令。
with-lock.sh: 构建/验收互斥锁。并行子代理共享 $TMPDIR/opensidian-build.lock，先到先得，超时 30 分钟退出码 75；用法 `sh scripts/with-lock.sh "<命令>"`。

acceptance/: full.sh 是全量入口。真实 Electron 场景，隔离库与日志判定见 acceptance/CLAUDE.md。 子进程带 `E2E=1`：窗口不激活应用（accessory + showInactive + focusable:false）且整窗透明（opacity:0 + 忽略鼠标）——测试完全不可见、不抢焦点；带 `OBS_ACT` 的直连探针也自动进入 E2E（main.ts 兜底）。
make-app-icon.py: 生成应用图标（原创设计：地平线与曜日）→ build/icon.png 与 icon.icns（iconutil）。
smoke-packaged.mjs: 三平台目录包冒烟。版本从标签解析，Linux CI 使用虚拟显示。先核对 ASAR 身份、版本、许可证、当前代码与全部样式哈希，再跑真实启动/编辑器/Bases/公式/CSV/SVG；回执后必须自行退出且 exitCode=0。输出 {pass,count,checks}；--no-screenshot 不截图，超时只清理自身进程组。

bases-formulas.test.mjs: Node 公式单测。固定 UTC、时钟与随机源，对照公开公式说明，覆盖 78 个说明键。
bases-csv.test.mjs: Node CSV 单测。检查转义、富值、取消与写盘失败边界，不启动 Electron。

bases-editing.test.mjs: 数据库编辑单测。52 条覆盖视图身份、并发、类型、日期和属性写回。
window-save.test.mjs: 视图保存单测。32 条覆盖 CAS、迟到保存、dirty 与关闭失败。
canvas-export-limits.test.mjs: 导出预算单测。18 条覆盖密度、取整、长边与分配上限。
render-cancel.test.mjs: 渲染取消单测。9 条覆盖结算、监听释放与迟到结果。
vault-watch.test.mjs: 真实 Chokidar 22 条。扫描空档、身份、增删改与反复启停。
dev-hooks.test.mjs: 双窗口协调 11 条。迟到、失败、超时和回执校验，不启动 Electron。
main-boundaries.test.mjs: 主进程边界14条。真盘 CAS 并发、库外路径拒绝与原生菜单监听释放。

workspace-resize.test.mjs: 尺寸拖动纯逻辑与事件单测。24 条覆盖根侧栏、分配、零位移、布局换代与资源清理。
user-ignore.test.mjs: 忽略规则22条单测。前缀、正则、损坏配置与原地修改即时生效。
audit-storage.test.mjs: 隔离真盘回归。回收站保留、失败保护、移动索引与磁盘碰撞拒绝；复制保持字节且只读取一次；跨 VM 错误按 code 字段识别。
audit-features.test.mjs: 隐式Base默认视图及首次写回。未知键、注释与坏类型保护。
subpath-navigation.test.mjs: 子路径导航与块引用单测。17条覆盖段落块标记、前导锚点剥离与阅读/编辑定位。
[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
