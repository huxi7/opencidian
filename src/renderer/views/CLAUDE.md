# src/renderer/views/

> L2 | 父级: /src/renderer/CLAUDE.md

内置视图。视图必须遵守 core/view.js 契约：构造只存 leaf，DOM 在 onOpen 建立到 this.contentEl(=view._rootEl)。

成员清单
index.js: registerBuiltinViews(app)。注册 empty/markdown/image/video/audio/pdf，附带扩展名提示；安装 settings host。
markdown-view.js: MarkdownView。source/live/preview 三态、inline-title 改名、150ms 防抖自动保存、外部修改同步、subpath/line 滚动、view-actions 菜单。
empty-view.js: EmptyView。空标签页动作列表(新建笔记/打开文件等)。
media-view.js: MediaView 及 ImageView/VideoView/AudioView/PdfView。经 adapter.getResourcePath() 取 app:// 文件 URL。
settings-view.js: SettingsHost(app.setting 的实现) + installSettingsHost(app)。克隆原版 fte 宿主：三组导航(options/core/community)、navEl、openTab/closeActiveTab/openTabById/openPluginOptions/updateModalTitle、PluginSettingTab 兼容层(addSettingTab/removePluginTabs 挂载点)。侧栏布局设置弹窗。
settings-tabs.js: AboutTab/EditorTab/FileTab 三个内置页签 + VimTestModal(输入 :q 验证)/ExcludedFilesModal(忽略文件管理)。对齐原版 O7/nte/lte 行结构与顺序；配置写 app.settings.updateAppSettings。
settings-tabs-appearance.js: AppearanceTab + FontManagerModal。对齐原版 Jee：基础颜色/主题色/主题/界面/字体/高级(缩放·原生菜单·窗口边框·硬件加速)/CSS 代码片段；CSS 注入由 app._applyCustomCss 执行。
settings-tabs-plugins.js: HotkeysTab + HotkeyRecorderModal(按键录制)、CorePluginsTab(搜索+齿轮→openPluginOptions)、CommunityPluginsTab(安全模式语义+已安装插件列表；市场不接入)。
slides-view.js: SlidesView(type slides)，由 plugins-core/slides.js 注册。按 --- 分页(frontmatter 后，markdown-it hr 令牌定位)，每页 renderMarkdown；←/→/点击左右半屏翻页、Esc/关闭按钮回 markdown 视图；导出 splitSlides。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
