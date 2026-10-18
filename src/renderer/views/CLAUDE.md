# src/renderer/views/

> L2 | 父级: /src/renderer/CLAUDE.md

内置视图。视图必须遵守 core/view.js 契约：构造只存 leaf，DOM 在 onOpen 建立到 this.contentEl(=view._rootEl)。

成员清单
index.js: registerBuiltinViews(app)。注册 empty/markdown/image/video/audio/pdf，附带扩展名提示；安装 settings host。
markdown-view.js: MarkdownView。换文件先保存，删除后复用视图根。首次加载即同步 source/live/preview DOM 三态、inline-title 改名（元素挂在编辑器 .cm-sizer 内）、行宽 class（is-readable-line-width）挂 source/reading 视图元素并随设置联动、150ms 防抖自动保存（外部修改同步用 _loadedText 判别自家写入的迟到通知，绝不回滚在编辑的文档）、编辑器右键菜单挂载、subpath/line 滚动、view-actions 菜单。
empty-view.js: EmptyView。空标签页动作列表(新建笔记/打开文件等)。
media-view.js: MediaView 及 ImageView/VideoView/AudioView/PdfView。经 adapter.getResourcePath() 取 app:// 文件 URL。
settings-view.js: SettingsHost(app.setting 的实现) + installSettingsHost(app)。克隆原版 fte 宿主：三组导航(options/core/community)、navEl、openTab/closeActiveTab/openTabById/openPluginOptions/updateModalTitle、PluginSettingTab 兼容层(addSettingTab/removePluginTabs 挂载点)。侧栏布局设置弹窗。
settings-tabs.js: AboutTab/EditorTab/FileTab 三个内置页签 + VimTestModal(输入 :q 验证)/ExcludedFilesModal(忽略文件管理)。对齐原版 O7/nte/lte 行结构与顺序；配置写 app.settings.updateAppSettings。
settings-tabs-appearance.js: AppearanceTab + FontManagerModal。对齐原版 Jee：基础颜色/主题色/主题/界面/字体/高级(缩放·原生菜单·窗口边框·硬件加速)/CSS 代码片段；CSS 注入由 app._applyCustomCss 执行。
settings-tabs-plugins.js: HotkeysTab + HotkeyRecorderModal(按键录制)、CorePluginsTab、CommunityPluginsTab。快捷键页对齐原版 w0：工具栏 filter 菜单 + hotkey-filter 芯片承载状态筛选（全部/已分配/由我分配/未分配，选"全部"移除芯片），搜索框右缘 lucide-keyboard 装饰图标进入捕获态按组合键筛选（再次点击或 Esc 退出），冲突芯片带 has-conflict 类、点击清空搜索并按该快捷键筛选；行结构为 setting-command-hotkeys + setting-hotkey(文本+lucide-x)+setting-add/restore-hotkey-button；暴露 setQuery/setHotkeyFilter。核心页对齐 dte：.setting-group-search 裸搜索 + 打开时自动聚焦，齿轮(有 settingTab)/快捷键(有命令)入口仅在启用时显隐，lucide-plus-circle 跳快捷键页并按插件 id 前缀过滤。第三方页对齐 tte 启用布局：行内齿轮(插件页签已注册)/快捷键/卸载(lucide-trash-2 → confirmDialog mod-warning → plugins.uninstallPlugin 删目录)入口；市场不接入。
graph-view.js: 全局/局部图视图生命周期。跟随文件变化，关闭时清理引擎和渲染器。
graph-renderer.js: 画布绘制、命中、拖拽和平移。设备像素统一换算，销毁释放监听与帧。
canvas-view.js: 画布装配。观察挂载尺寸，防抖保存，切换文件前落盘，关闭后释放帧与节点。vault modify 的外部修改按磁盘内容重载并保留视口，自身写入按 _savedText 过滤 watcher 回声。撤销/重做：requestSave 防抖推进全量快照历史（上限 100），applyHistory 经 importData 差量重建且不产生新条目；控件组含快速设置（对齐网格/对齐物体/只读）与撤销/重做按钮。只读标记按原版 localDataManager 存 localStorage('canvas-<路径>')，重命名迁移、删除清理，初次装载恢复。导出图片只在本类暴露 renderCanvasImage(可测试)与 generateHDImage(命令/面板菜单入口)，绘制在 canvas-export.js；视图头部经 installCanvasViewActions 增加「更多选项」按钮打开面板菜单。
diff-view.js: renderDiffView(prev,next)。行级 LCS 对齐，删除/插入按块配对，行内差异标 diff-changed；相等行按原版阈值折叠(N lines folded 可点击展开)。供文件恢复弹窗"显示差异"。
canvas-viewport.js: 画布坐标与缩放。限制缩放目标，按缩放挂载正文，收敛后停止帧。帧内把移动节点的关联边一并加入重绘集合。含物体对齐 getSnapping：候选框取「4 角 + 中心」5 点，逐轴取最近对齐值并返回位移，同时把匹配点画进 svg.canvas-snaps（原版 D3/A3/L3 的参考线）；clearSnapPoints 每次 move 先清，endSnapPointRendering 在 drag 收尾摘除容器。snapToObjects=false 时不吸附也不画线；候选取全部节点而非视口内节点。
canvas-interactions.js: 指针、滚轮、框选、键盘与拖拽原语。键盘含 Escape/Delete、Mod+A 全选、Mod+Z/Mod+Shift+Z/Mod+Y 撤销重做、Shift+1/2 缩放、方向键微移选中节点（Shift 5 倍、对齐网格时吸附），焦点在输入控件内不抢按键。拖动选中集合逐帧调用 getSnapping 得到吸附位移与参考线，候选剔除被拖节点且分组只与分组对齐；参考线由 handleDragWithPan 的 cleanup 清除。几何结果交给视图保存。
canvas-history.js: CanvasHistory 有界快照栈（push 截断重做尾部、超限丢最旧、replace/clear）。撤销/重做的存储层，条目为 getData() 全量对象。
canvas-node.js: 文本、链接与分组节点。输入请求保存，正文可读时挂载。文本卡片菜单追加编辑与转换为文件。
canvas-local-data.js: 画布本地数据（原版 localDataManager 等价物）。localStorage key 'canvas-<路径>' 存 {readonly:true}；load/save/migrate/drop，供视图与快速设置菜单调用。
canvas-file-node.js: 文件卡片（从 canvas-node.js 拆出）。md/canvas 渲染预览、图片直显、其余占位；挂载前对 contentEl 判空。
canvas-edge.js: 连线与标签几何。拖动连接点吸附节点并保存端点。
canvas-menu.js: 文件、链接、分组选择与画布上下文菜单。快速设置菜单三项：对齐网格/对齐物体/只读。另含视图面板菜单 showCanvasPaneMenu（action 段「导出图片」）与 installCanvasViewActions（在 .view-actions 建「更多选项」按钮并弹出该菜单）。
canvas-utils.js: 无状态几何、颜色与多值索引。供节点、边与视口共用。
canvas-export.js: 画布图片导出。renderCanvasImage 用离屏 2D canvas 画背景（.canvas-wrapper 计算色）、边（计算描边色 + 贝塞尔 + 箭头）、卡片（计算底色/边框/圆角 + 折行文本，文件卡片为占位矩形 + 文件名），尺寸上限 4096 并等比缩放，返回 {dataURL,width,height,scale}，空画布返回 null；exportCanvasImage 在其上叠加保存对话框、写 PNG 与「在访达中显示」通知。不画 logo、无视图范围/隐私模式选项。
bookmarks-view.js: 书签树与行内重命名。空分组可见，活动项按文件路径匹配。
slides-presentation.js: SlidesPresentation。全窗口演示宿主（对齐原版 M9：document.body 上的 .slides-container + Escape 关闭；无 reveal.js，分页自有）。按顶层 hr 分页，保留代码围栏和引用内分隔线，每页 renderMarkdown；←/→/点击左右半屏翻页、Esc/关闭按钮销毁覆盖层。演示期间不动底层 markdown 视图，退出后模式、滚动与选区天然保持；导出 splitSlides。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
