# Bases 工具栏与窗口化事实

只读事实源：`../obsidian-114/renderer/app.js`、`app.css`、`i18n.js`。
JavaScript 位置为原始字符串字符偏移。未启动原版。

| 位置 | 事实 |
| --- | --- |
| app.js 2535260，w1 | 工具栏顺序：视图、结果、排序、分组、筛选、属性、搜索、新建。搜索行紧随头部。 |
| app.js 2526696，v1 | 视图按钮显示布局图标、名称、chevrons-up-down。左键选视图；右键配置当前视图。 |
| app.js 2527648，g1 | 配置页先显示名称和布局，再显示布局选项。 |
| app.js 2516301，o1/a1 | 点击结果数配置 limit；工具栏不常驻数字输入框。 |
| app.js 2520670，c1/u1 | 排序图标 arrow-up-down。按行修改即时保存，无“应用”按钮。 |
| app.js 2501697，ZJ/JJ | 分组图标 stretch-horizontal。分组页含 groupBy 与组显示顺序。 |
| app.js 2474010，MJ | 筛选图标 list-filter。所有视图默认折叠，当前视图默认展开。两部分分别保存。 |
| app.js 2479404，AJ/PJ | 属性图标 list。属性页有搜索和显示清单。 |
| app.js 2518999，s1 | 搜索为临时状态。Escape 清除并关闭搜索行。 |
| app.js 2513191，i1 | 点击新建立即创建笔记，再在锚定浮层编辑。模板仅复制属性，不复制正文。 |
| app.js 2371943，L$ | 从非否定规则推导属性。比较支持 ==/>=/<=；inFolder 推导目录；显示属性补 Null。 |
| app.js 2351802，p$ | newItemFolder/newItemTemplate 为顶层配置键。 |
| app.js 2283893，BX | 函数调用浮层显示参数名、类型、可选与变参标记，并突出当前参数。 |
| app.js 2287007，funcCompletion | 函数补全信息显示参数与 formulas.funcs 说明。 |
| i18n.js 120115，funcs | 78 个原始函数说明键；earliest/latest、min/max 分别共用说明。 |
| app.js 3214348 | rowHeight 的 medium/tall/extra 倍数为 2/4/8，默认 1。基础行高回退 30px。 |
| app.js 3220540，getViewOptions | 表格配置提供短、中、高、超高四档行高。 |
| app.css 2032–2066 | 头部 40px；左右 padding 2px；筛选菜单宽 520px。 |
| app.css 14960–15090 | 宽度小于 590px 时隐藏操作标签，保留图标与视图名称。 |
| app.css 15096–15290 | 菜单含标题、关闭按钮、搜索、分区和动作；通用菜单宽 300px。 |
| app.css 8948–8965 | cm-tooltip-docstring 使用 11px 等宽字、消息背景与参数高亮。 |
| app.css 16449–16467 | 表格行和单元格固定行高。单元格 overflow:hidden，富内容默认裁切。 |
| app.css 16524–16566 | 单行使用 nowrap；mod-multiline 顶对齐。行高由统一配置决定，非逐行自然增高。 |

## 模块接口

`bases-ui.js` 生成八组工具栏，不持有 Vault 订阅。
即时排序保存后重建菜单，保留未选属性的草稿行。
改名成功后的选择由控制器事务更新；拒写不切到输入的新名称。
视图切换、搜索和菜单关闭释放当前菜单事件。
`bases-ui-filters.js` 以条件组、属性条件和公式编辑筛选。
新选属性通过库级类型选择数字/布尔输入；原始表达式不因打开而改写。
未修改表达式保留原始字符串；未知结构显示原因。
`bases-ui-formula.js` 使用 CodeMirror 6 和现有语义颜色。
`bases-ui-functions.js` 保存原版参数定义及 78 个说明键。
函数调用浮层高亮活动参数，补全信息显示原始说明。
`bases-ui-new-item.js` 立即创建真实 Untitled 笔记。
浮层复用 Editor，正文经主进程 CAS 保存。
提交携带 path/expected/text；成功刷新 stat 并发 modify。
视图 save/setState/onClose 传播保存失败，不销毁草稿。
停用和直接销毁先另存并读回验证草稿；失败保留控制器。
插件 onUnload 返回 false 时，宿主取消停用。
目录优先级：显式配置、模板目录、筛选推导、默认新笔记位置。
组内入口将实际组键写入笔记；只读分组不显示假入口。
模板复制属性，不复制正文；筛选排除新文件时显示提示。
外部修改冲突保留输入，用户可另存草稿再载入最新文本。
`bases-virtual.js` 为表格提供固定行高窗口化。
列表、卡片和看板按实际网格行高度窗口化。
图片载入和宽度变化触发行高重测；末端滚动保持位置。
同范围及重叠网格行复用 DOM，避免取消活动数学/嵌入。
出窗和销毁显式调用富值释放钩子。
`bases-ui-group-window.js` 再限制整页分组 DOM。
垂直布局按组测高；看板按横向列窗口化。
换窗销毁旧组虚拟器，关闭释放监听、观察器和动画帧。
标量分组用 Map；混合和富值保留原有宽松相等路径。

## 验收预算

夹具使用隔离库中的 1000 和 10000 篇真实 Markdown。
批量写入期间暂停测试库监听，静默索引后恢复真实监听。
夹具准备不计入查询预算；修改刷新使用真实文件事件。
千条打开预算 3000ms，重复绘制预算 1500ms。
万条打开预算 10000ms，重复绘制预算 5000ms。
记录层挂载最多 120 行；看板两列最多 160 项。
滚动换窗预算 1000ms；修改刷新预算 10000ms。
每篇笔记一个分组时，再逐一验证四类布局。
整页最多挂载 20 组、2500 DOM 节点、60 虚拟器。
分组打开预算 10000ms；滚到末组必须显示真实最大分数。
全部预算均为失败断言，指标另存 JSON。

## 实测回执

```sh
sh scripts/with-lock.sh 'npm run build && node scripts/acceptance/run.mjs bases-ui --no-screenshot && node scripts/acceptance/run.mjs bases-views --no-screenshot && node scripts/acceptance/run.mjs bases-new-item --no-screenshot && node scripts/acceptance/run.mjs bases-perf --no-screenshot --timeout 180000'
```

最新连续运行：UI 57、布局 125、新建初轮 21、性能 98 均通过。
日志：`/tmp/opensidian-bases-row-height-final.log`。
UI 回执：`bases-ui-run-result-RVarH2/run.log`。
布局回执：`bases-views-run-result-vWzD99/run.log`。
新建回执：`bases-new-item-run-result-izTM49/run.log`。
性能回执：`bases-perf-run-result-ChWx8b/run.log`。
回执公共父目录：`/tmp/obs-copy-acceptance/`。
指标：`/private/tmp/obs-copy-acceptance/obs-copy-bases-perf-NfxkdF/.opensidian-bases-perf.json`。

P0 最终追加：新建 36 条通过。
回执：`/tmp/obs-copy-acceptance/bases-new-item-run-result-paUNJp/run.log`。
日志：`/tmp/opensidian-bases-new-cas-final.log`。
竞争测试让两次真实主进程 CAS 请求按顺序竞争。
验证关闭、切文件、移除标签拒绝，以及草稿另存失败拒停。
网格最终回归：UI 57、布局 125、性能 98 全绿。
回执后缀：POgmkX、Nq3Y0c、h0vZiK。
日志：`/tmp/opensidian-bases-cas-grid-regression.log`。
P3 富值生命周期场景 32 条通过，回执后缀 bMLFMD。
该场景验证数学/图表/嵌入活动宿主连续稳定 200ms。

静态和 DOM 核对不等于逐像素视觉验收。

## 最终改名与筛选类型回归

仅修配置改名后的选择提交和筛选标量类型。
改名主进程拒写或最新文档发现同名时，保持原视图。
新建数值筛选保存数字 8；布尔筛选保存 false。
无效数字阻止应用，不将默认 0 或字符串误写到磁盘。
布局与新建流程仅复用类型解析器，保存事务保持原边界。

```sh
sh scripts/with-lock.sh 'npm run build && node scripts/acceptance/run.mjs bases-ui --no-screenshot && node scripts/acceptance/run.mjs bases-views --no-screenshot && node scripts/acceptance/run.mjs bases-new-item --no-screenshot'
```

最新结果：UI 68、布局 125、新建 36，共 229 条通过。
回执后缀：UX9Gu6、3pFINg、v1HxZz。
JSONL：`/tmp/opensidian-bases-last-two-fixes.jsonl`。
完整日志：`/tmp/opensidian-bases-last-two-fixes.log`。
目标回归完成时渲染包 SHA256 快照：`994a596c529dd1b9fe54d451d58849418fc8e70e94396bde08d4d0d95072b3b5`。
后续主线构建会替换 dist；最终目录包哈希以主线打包回执为准。
目录包须以这次构建重新打包，再执行打包冒烟。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
