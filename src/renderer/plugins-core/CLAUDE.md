# src/renderer/plugins-core/

> L2 | 父级: /src/renderer/CLAUDE.md

核心插件。每个文件导出一个模块对象 `{ nameKey?, create(app) }`；create 返回 `{ onload, onunload, registerCommands?, deregister? }`。插件 id 必须与 settings.corePlugins 的键一致，并登记到 core/plugins-registry.js。

成员清单
file-explorer.js: 文件树视图(type file-explorer)。排序/折叠/右键菜单/拖拽移动/inline 重命名/新建文件与文件夹命令。
command-palette.js: 命令面板(type 无视图)。command-palette:open。
switcher.js: 快速切换器(switcher:open)。文件模糊搜索 + 新建同名文件。
backlink.js: 反向链接视图(type backlink)。已链接/未链接提及、搜索框。
outline.js: 大纲视图(type outline)。当前文档标题树，跟随光标高亮。
tag-pane.js: 标签面板视图(type tag)。标签树/排序/嵌套开关。
global-search.js: 全局搜索视图(type search)。关键词/正则/大小写、结果分组与跳转。
editor-status.js: 状态栏编辑模式显示与切换(Reading/Source/Live Preview)。
word-count.js: 状态栏字数统计(中英混排规则)，点击弹详情。
file-recovery.js: 文件恢复插件(原版默认启用)。快照落盘 .obsidian/.file-recovery/ 按天 JSON({路径:[{ts,data}]})；命令 file-recovery:open 打开快照弹窗(文件搜索+时间/大小列表+预览+恢复)；settingTab(间隔秒/保留天数/查看/清空)。
random-note.js: 漫游笔记插件。命令 random-note + ribbon(dice-glyph) 随机打开一篇 md；Mod 点击新标签页。
zk-prefixer.js: 时间戳笔记插件(id zk-prefixer，文案键 plugins.unique-note-creator)。命令 zk-prefixer + ribbon(sheets-in-box)；getUniquePath 冲突按 分/时/日/周/月/年 递增；数据 .obsidian/zk-prefixer.json；settingTab(文件夹/模板/格式样例)。
workspaces.js: 工作区插件。命令 workspaces:load/save/save-and-load/open-modal + ribbon(lucide-layout)；数据 .obsidian/workspaces.json({workspaces,active}，布局含 mtime)；加载用 loadLayout+postLayoutLoad；管理弹窗(存/载/删)与 SuggestModal 选择器。
slides.js: 幻灯片插件。注册 'slides' 视图(views/slides-view.js) + 命令 slides:start 把当前 md 以 slides 视图打开。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
