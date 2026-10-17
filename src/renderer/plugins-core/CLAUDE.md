# src/renderer/plugins-core/

> L2 | 父级: /src/renderer/CLAUDE.md

核心插件。每个文件导出一个模块对象 `{ nameKey?, create(app) }`；create 返回 `{ onload, onunload, registerCommands?, deregister? }`。插件 id 必须与 settings.corePlugins 的键一致，并登记到 core/plugins-registry.js。

成员清单
file-explorer.js: 文件树视图(type file-explorer)。排序/折叠/右键菜单/拖拽移动/inline 重命名/新建文件与文件夹命令。拖拽移动失败经 tt('plugins.file-explorer.msg-error-move-failed', …) 提示（locale 目前无该键，落到中文兜底）。
command-palette.js: 命令面板与 terminal 功能区入口。启停对称注册和撤销。
switcher.js: 快速切换器与 file-search 功能区入口。复用 switcher:open，禁用删除按钮和命令。
backlink.js: 反链分节、上下文与筛选。折叠跨重绘保留；关闭释放全部事件与计时器。
outgoing-link.js: 出链面板视图(type outgoing-link)。逐条列出当前文件的已解析与未解析出链；图标按标题/块/文件/未解析切换，已解析出链的副文本显示目标文件夹，未解析出链带 is-unresolved 与“尚未创建”提示。仅 Links 分节（原版还有 Unlinked mentions，本实现未覆盖）；不自动创建窗格，由命令 outgoing-links:open / outgoing-links:open-for-current 打开；关闭释放订阅与计时器，禁用撤销视图与命令。
outline.js: 按标题层级建立大纲。跳级归最近父标题，同名标题按行号跳转，关闭释放资源。
tag-pane.js: 标签面板视图(type tag)。标签树/排序/嵌套开关。
properties.js: 属性插件(id properties，原版 properties)。all-properties 汇总全部属性键与出现文件数，四种排序(名称正/倒、频次高/低，默认频次高到低)，点击属性打开全局搜索 ["键"](Mod 点击切换 token)；file-properties 只读复用 markdown/properties.js 的行渲染并跟随活动文件；命令 properties:open / properties:open-local 与状态栏属性计数(点击打开 file-properties)。不自动创建窗格；禁用撤销视图、命令与状态栏条目。
global-search.js: 全局搜索视图(type search)。关键词/正则/大小写、结果分组与跳转。
editor-status.js: 状态栏视图状态图标与切换菜单(Reading/Source/Live Preview，tooltip，mod-clickable)。
page-preview.js: 内部链接悬停预览 popover。四类来源(editor/preview/search/tab-header)可配 Mod 门控，未解析链接空态，设置写 page-preview.json。
word-count.js: 状态栏字数统计(中英混排规则)，点击弹详情。
canvas.js: 注册画布视图、四个命令与新建功能区按钮。canvas:new-file 建空画布；canvas:export-as-image 仅在当前叶子是画布时可用（执行时渲染后弹保存对话框写 PNG）；canvas:jump-to-group 仅在画布含分组时可用；canvas:convert-to-file 仅在单选文本卡片时可用。Mod 点击新标签并聚焦，禁用撤销按钮与注册。
bookmarks.js: 持久化文件、目录、搜索与分组书签。目录改名同步子路径。
daily-notes.js: 串行创建日期笔记与嵌套目录。模板变量及 createMarkdownNote 供其余笔记插件复用。
templates.js: 模板功能区执行已有插入命令。展开变量、合并属性；属性函数供重组复用。
note-composer.js: 提取或合并未保存文本。目标确认落盘后替换来源并重定向反链，遵循回收策略。
graph.js: 图谱视图、命令与功能区入口。普通点击复用中心，Mod 点击新标签并聚焦；禁用撤销按钮和命令。
graph-engine.js: 协调查询、元数据变化、图谱选项与节点操作。
graph-controls.js: 筛选、颜色、显示与力学控件。变更交给引擎。
graph-data.js: 根据 Vault 清单构图。计算局部邻域和孤立节点。
graph-query.js: 文件、正文、路径与标签查询。供筛选及颜色组复用。
graph-simulation.js: 节点力学模拟（对齐原版 d3-force 参数）。斥力为 Barnes-Hut 四叉树近似（theta²=0.81），碰撞按包围盒裁剪半径 120 的候选对；受力遍历内联为复用栈。拓扑变化时缓存节点度数。
graph-quadtree.js: 力学空间索引。buildQuadtree/visitAfter；重合点存 next 链；供 Barnes-Hut 斥力与半径碰撞共用同一棵树。
graph-options.js: 默认选项和 graph.json 读写，供视图与引擎共用。
graph-utils.js: 无状态颜色、插值、矩形与键盘常量。
file-recovery.js: 文件恢复插件(原版默认启用)。快照范围为 md/canvas/base；间隔单位分钟(默认 5，0 表示每次变更即存)，旧 intervalSeconds 配置读取时按 60 秒=1 分钟迁移。快照落盘 .obsidian/.file-recovery/ 按天原子替换 JSON({路径:[{ts,data}]})；命令 file-recovery:open 打开快照弹窗(文件搜索+时间/大小列表+预览+恢复+复制+显示差异)；settingTab(间隔分钟/保留天数/查看/清空)。
random-note.js: 漫游笔记插件。命令 random-note + ribbon(dice-glyph) 随机打开一篇 md；Mod 点击新标签页。
zk-prefixer.js: 时间戳笔记插件(id zk-prefixer，文案键 plugins.unique-note-creator)。命令 zk-prefixer + ribbon(sheets-in-box)；getUniquePath 冲突按 分/时/日/周/月/年 递增；数据 .obsidian/zk-prefixer.json；settingTab(文件夹/模板/格式样例)。
workspaces.js: 工作区插件。命令 workspaces:load/save/save-and-load/open-modal + ribbon(lucide-layout)；数据 .obsidian/workspaces.json({workspaces,active}，布局含 mtime)；保存前等待编辑落盘，加载先关闭旧视图，再用 loadLayout+postLayoutLoad；管理弹窗(存/载/删)与 SuggestModal 选择器。
slides.js: 幻灯片插件。命令 slides:start 把当前 md 交给 SlidesPresentation(views/slides-presentation.js) 全窗口演示；不注册视图类型；包装层暴露 getPresentation()。原版 file-menu 菜单项因本项目无 file-menu 来源而省略。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
