# src/renderer/views/

> L2 | 父级: /src/renderer/CLAUDE.md

内置视图。视图必须遵守 core/view.js 契约：构造只存 leaf，DOM 在 onOpen 建立到 this.contentEl(=view._rootEl)。

成员清单
index.js: registerBuiltinViews(app)。注册 empty/markdown/image/video/audio/pdf，附带扩展名提示；安装 settings host。
markdown-view.js: MarkdownView。换文件先保存，删除后复用视图根。首次加载即同步 source/live/preview DOM 三态、inline-title 改名、150ms 防抖自动保存、外部修改同步、subpath/line 滚动、view-actions 菜单。
empty-view.js: EmptyView。空标签页动作列表(新建笔记/打开文件等)。
media-view.js: MediaView 及 ImageView/VideoView/AudioView/PdfView。经 adapter.getResourcePath() 取 app:// 文件 URL。
settings-view.js: SettingsHost(app.setting 的实现) + installSettingsHost(app)。克隆原版 fte 宿主：三组导航(options/core/community)、navEl、openTab/closeActiveTab/openTabById/openPluginOptions/updateModalTitle、PluginSettingTab 兼容层(addSettingTab/removePluginTabs 挂载点)。侧栏布局设置弹窗。
settings-tabs.js: AboutTab/EditorTab/FileTab 三个内置页签 + VimTestModal(输入 :q 验证)/ExcludedFilesModal(忽略文件管理)。对齐原版 O7/nte/lte 行结构与顺序；配置写 app.settings.updateAppSettings。
settings-tabs-appearance.js: AppearanceTab + FontManagerModal。对齐原版 Jee：基础颜色/主题色/主题/界面/字体/高级(缩放·原生菜单·窗口边框·硬件加速)/CSS 代码片段；CSS 注入由 app._applyCustomCss 执行。
settings-tabs-plugins.js: HotkeysTab + HotkeyRecorderModal(按键录制)、CorePluginsTab(搜索+齿轮→openPluginOptions)、CommunityPluginsTab(安全模式语义+已安装插件列表；市场不接入)。
graph-view.js: 全局/局部图视图生命周期。跟随文件变化，关闭时清理引擎和渲染器。
graph-renderer.js: 画布绘制、命中、拖拽和平移。设备像素统一换算，销毁释放监听与帧。
canvas-view.js: 画布装配。观察挂载尺寸，防抖保存，切换文件前落盘，关闭后释放帧与节点。
canvas-viewport.js: 画布坐标与缩放。限制缩放目标，按缩放挂载正文，收敛后停止帧。
canvas-interactions.js: 指针、滚轮、框选、键盘与拖拽原语。几何结果交给视图保存。
canvas-node.js: 文本、文件、链接与分组节点。输入请求保存，正文可读时挂载。
canvas-edge.js: 连线与标签几何。拖动连接点吸附节点并保存端点。
canvas-menu.js: 文件、链接、分组选择与画布上下文菜单。
canvas-utils.js: 无状态几何、颜色与多值索引。供节点、边与视口共用。
bookmarks-view.js: 书签树与行内重命名。空分组可见，活动项按文件路径匹配。
slides-view.js: SlidesView(type slides)，由 plugins-core/slides.js 注册。按顶层 hr 分页，保留代码围栏和引用内分隔线，每页 renderMarkdown；←/→/点击左右半屏翻页、Esc/关闭按钮恢复 markdown 模式、滚动与选区；导出 splitSlides。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
