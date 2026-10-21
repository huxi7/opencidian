# src/renderer/core/

> L2 | 父级: /src/renderer/CLAUDE.md

应用内核。依赖方向：dom/events/i18n/icons/ipc/tooltip 为叶子；vault/settings 之上是 metadata/fileManager；workspace/app 为装配层；plugins 提供宿主与 obsidian API shim。

成员清单
dom.js: Element/Document 原型的 createEl/setText/addClass 等助手(安装即生效)，并导出 createEl/createDiv/createSpan。
events.js: Events 基类(on/off/once/trigger/offref) + debounce(带 run/cancel)/sleep。
i18n.js: setLanguage/detectLanguage(systemLocale)/t(带 {{var}} 与 _plural 处理)/tt(key,fallback,vars)(设置界面兜底)/getNouns(连字符 key)。
icons.js: resolveIcon/createIcon/setIcon/getIconData/iconExists/getIconIds/addIcon/removeIcon。解析链逐字复刻原版 Zm()：lucide- 前缀 → 运行时图标 → 36 个自有图标(assets/icons-obsidian.json) → 152 条别名映射(assets/icon-aliases.json) → 1874 个 Lucide 图标(assets/icons.json)。
ipc.js: ipcSync/ipcSend/ipcInvoke/ipcOn + Desktop 门面(与主进程通道一一对应)。
tooltip.js: 全局 tooltip 单例(叶子，仅用 DOM 助手)。导入即安装 body 级 pointerover/pointerout 委托(只认鼠标)与 pointerdown/滚动/blur/Escape 收起；文案取 aria-label(其次被暂存的 title)，data-tooltip-delay 默认 1000ms，data-tooltip-position 默认 bottom(放不下翻 mod-top)，data-tooltip-classes 追加类；补 Element.prototype.setTooltip/setTooltipGenerator。
vault.js: Vault/TFile/TFolder/FileSystemAdapter/normalizePath/parentPathOf/isHiddenPath。文件 IO 走 Node fs；watch 用 chokidar。首次扫描与文件监听均拒绝点开头路径段。
vault-utils.js: getUniquePath 等路径纯函数。
metadata.js: MetadataCache。内存态：headings/links/embeds/tags/frontmatter；getFirstLinkpathDest 解析短链。
fileManager.js: 文件创建/重命名/删除/移动，含链接自动更新与 processFrontMatter。generateMarkdownLink 仅对 .md 省略扩展名，附件（png 等）保留（shortest/markdown 两种格式同规则）。附件路径四语义(attachmentFolderPath: '/' 根 | './' 当前文件夹 | './sub' 子文件夹 | 'name' 指定文件夹)；删除走 promptDelete + trashOption(system|local|none)。重命名链接更新对齐原版：alwaysUpdateLinks 为假时弹窗（总是更新/仅此一次/不做更新），计数与文本替换必须在 metadataCache.onFileRename 之前完成。downloadAttachmentsForNote 是薄封装，正文在 attachments-downloader.js。
attachments-downloader.js: 外部附件下载流程（原版 fileManager.downloadAttachmentsForNote + promptForImageDownload）。扫描源文本：frontmatter 的 http(s) 图片值 + 正文 ![](url) 的 http(s)/data 嵌入（掩掉围栏代码块与行内代码，不依赖 metadataCache 位置）。画廊模态（.attachments-gallery）逐项复选框默认勾选，确认后只下载勾选项：data URL 直接解码，远程走 app.requestUrl（缺省落 Desktop.requestUrl）；文件名 URL 末段优先，其次 content-disposition: filename=，再 content-type→Image.<ext>，最后 Image.jpg。改写阶段按 offset 降序替换嵌入为 !generateMarkdownLink，frontmatter 命中值经 processFrontMatter 写成 [[attachment 链接文本]]；单条下载失败只跳过该项。
settings.js: 读写 .obsidian/*.json (app/appearance/hotkeys/core-plugins)，merge 写入保留未知字段；DEFAULT_CORE_PLUGINS 定义于此处。app.json 键名逐字对齐原版(focusNewTab/smartIndentList/defaultViewMode(source|preview)/livePreview/promptDelete/deleteUnlinkedAttachments(ask|always|never)/trashOption(system|local|none)/openBehavior(''|new|daily|file:<path>))；含 1.14 的 settingsPopoutWindow（默认 true，设置独立窗口开关）。hotkeys 值为数组（含空数组）表示用户覆盖，空数组用于压制默认键；null/undefined 删除覆盖并恢复默认。
setting.js: 设置控件层。Setting/SettingGroup/SettingTab 基类与全部控件(Toggle/Dropdown/Slider/Button/ExtraButton/Text/Search/ColorPicker/TextArea/ProgressBar/MomentFormat)；DOM 结构对齐原版(fte 宿主消费)。SettingGroup.addSearch 直接创建裸 SearchComponent 并挂到 .setting-group-search，addSearchControl 提供 .setting-group-search-control 芯片行；不得再包 Setting 行。SettingTab 必须放这里，放 views 会造成 tabs↔view 循环 import。
keymap.js: Keymap/HotkeyManager/hotkeyToString/eventToHotkey/IS_MAC。按键归一化与作用域栈；全局 keydown 入口。
default-hotkeys.js: 30 条原版默认快捷键(id → hotkeys)。
commands.js: CommandManager 注册与分派命令。执行检查回调传 false；编辑器回调经 activeEditorOf 取 workspace.getActiveEditor()（画布卡片正文优先，回落活动叶子视图），回调第二参即该宿主对象。
notices.js: Notice 右上角通知栈。默认 4000ms；hover 暂停、移开后 1000ms 再隐藏；出场 120ms ease-in-out 的 opacity + margin-top 收拢后摘除，容器随最后一个通知一起摘除。addButton 生成 .notice-button-container > .notice-cta。容器与 Notice 都挂在 globalThis。
modals.js: 可复开的 Modal 基座与确认、输入弹窗。确认先结算结果，关闭取消待处理输入。FileNameModal：重命名式文件名弹窗（保存/取消、Enter 提交、非法字符校验），画布转换为文件使用。
menu.js: Menu/MenuItem。上下文菜单、子菜单、键盘导航；分节语义对齐 1.14.4：addSections/setSectionSubmenu/sort（显式声明分节表才排序，相邻节插分隔线，items 包 .menu-group）；setParentElement 在打开期间标记触发元素（has-active-menu）；选中项/Enter/Esc 经 _closeRoot 关闭整条菜单链。子菜单 DOM 不在父菜单内：document mousedown 归属沿 parentMenu 链判断，真实鼠标点按子菜单项不得先关父菜单。
file-menu.js: 文件菜单补全层。app 级 file-menu/files-menu 监听：复制路径▸（Obsidian URL/基于库的相对路径/绝对路径）、默认应用打开/在访达中显示、移动到…（复用 file-explorer-multi 的移动弹窗）；popout 新窗口项受窗口能力门控，本复刻不提供。
suggest.js: 文件与命令建议。输入位于结果前，选择结果与取消关闭分开结算。输入容器带 .search-input-clear-button(非空清空并触发 input，空则关闭)。键盘：上下、PageUp/PageDown(按实测行高整页跳跃)、Home/End、Enter/auxclick、macOS Ctrl+p/n；isComposing 抑制。空态文案 emptyStateText（默认 'No results found.'，子类覆盖），空查询可用 noRecentFilesText 单独文案。
view.js: View 基类(load/onOpen/onClose/getState/setState/_rootEl 契约) + ViewRegistry。
workspace-tab-move.js: 标签组搬移层。moveLeafToTabs 搬既有叶子与 DOM（同组重排/跨组移动都不重开视图），源组搬空交 _removeTabsNode 收敛；createTabsBySplit 只建目标分割与空标签组。
workspace-serialize.js: 布局序列化层。serializeNode/getLayout 递归经 workspace.serializeNode，保留 installStackedSerialization 对 tabs 的 stacked 键装饰。
tab-animation.js: 标签开合动画层。animateTabIn 测量自然宽后从 0 宽/透明展开；animateTabOut 在旧位置留克隆收窄淡出后摘除；时长 200ms ease-in-out（原版 updateTabDisplay）。只做视觉，不改模型顺序。
workspace.js: 布局装配、导航与序列化入口。新文档进入中心，侧栏工具禁止用户关闭。恢复布局后按插件状态补齐入口。 moveLeafToTabs/createTabsBySplit 委托 workspace-tab-move.js，序列化委托 workspace-serialize.js。 侧栏收展：140ms 宽度补间（原版 DD=140ms+swing）、类切换替代重建 DOM（保住 toggle 以做 FLIP）、类切换后立即迁移开关并淡出边界分隔条。 活动编辑器（原版 activeEditor）：getActiveEditor 取登记项（画布卡片宿主，形状 { editor, file, containerEl }）否则回落活动叶子的编辑器视图；setActiveEditor 不登记 markdown 视图、unsetActiveEditor(无参或同项) 清空；切换活动叶子即清空登记。
workspace-sidebar.js: 固定工具映射与关闭判定。恢复旧布局遗漏的入口，插件禁用才撤销对应工具。
workspace-profile.js: 稳定的库名、帮助与设置入口。每次展开读取库注册表，菜单调用真实打开库 IPC。
workspace-model.js: 分割、标签组与叶子模型。视图切换依次关闭旧视图、装载新视图。标签组持有堆叠状态(原版 VD.isStacked)：setStacked 落 mod-stacked 类；标签列表菜单、头叶排布与滑动布局(updateTabDisplay/updateSlidingTabs/scrollIntoView)同层放置。installStackedSerialization 在挂载时给 layout JSON 补 stacked 键(JSON 组装在 workspace.js)。
window-chrome.js: macOS 红绿灯位置同步。按原版 updateStatus（app.js 1553478）从 --traffic-lights-offset-x/y 与 zoomFactor 计算：floor(offset*zoom/2-8)（x +2）；主窗 40px → (14,12)，设置 popout 32px → (10,8)。类变化（is-popout-modal）或缩放后必须重算。\nworkspace-sidebar-chrome.js: 侧栏折叠态外观唯一出口（mod-top 落位、开关迁移、分隔条宽度/透明度、功能区 is-collapsed 底色）；不持有模型状态，只读写 DOM 与 toggle 缓存。
workspace-renderer.js: 分别渲染文档标签和固定工具图标。稳定挂载底栏及左右开关，功能区支持鼠标与键盘。 叶子宿主是 .workspace-tab-container；标签头落位与堆叠排布由标签组的 updateTabDisplay 决定；非堆叠态 _syncTabsHeaders 调 tabs.syncHeaderOrder() 按 children 顺序重排标签头 DOM，模型顺序即视觉顺序；标签增删经 tab-animation.js 做 200ms 宽度/透明度补间（原版 updateTabDisplay），首次渲染跳过；view-header 委托 view-header.js。 标签栏「+」「⌄」按 1.14.4 结构：外层 div 定位、内层 span.clickable-icon 承按钮盒。 左右侧栏带 mod-primary/secondary；根级纵向手柄负右外边距覆盖 1px；折叠只挂 is-collapsed 类。侧栏 chrome 委托 workspace-sidebar-chrome.js。 侧栏开关迁移用原版 y() 的 FLIP（幽灵+偏移动画，140ms swing）。installWindowState 同步 is-maximized/is-fullscreen/--zoom-factor，并经 window-chrome 重算红绿灯；resize/focus/fullscreenchange 触发。
view-header.js: 视图头构造与填充（原版 View 构造器，1.14.4 app.js:1236469）。三块：left 导航钮（←→，checkCallback 门控；空视图同样渲染）、title-container（父路径面包屑 span+“/”分隔，点击在文件树揭示、右键文件夹菜单；标题居中 + mod-fade 三态）、actions。fillViewHeader 同时同步导航禁用态与 actions 重绘。
workspace-interactions.js: 仅中心文档可关闭、新建、拆分或拖拽。侧栏图标不接入文档菜单。 标签落点按原版 getTabInsertLocation 求 index；落点用 workspace-drop-overlay 10px 竖条（::before 内缩 3px、50% accent）、body.is-grabbing、ghost 清理；跨组/分割移动委托 workspace.moveLeafToTabs；覆盖层边缘 max(尺寸/3,40)、center 为 10px 标签插入条。
workspace-regression.js: 19 组内存回归。覆盖导航、分栏、恢复、固定入口与库栏身份；VM 上下文提供 Element/Document/document 替身以装载 dom.js，标签动画与侧栏 chrome 用无动画 mock，拖拽落点测试补 .workspace-tabs 宿主语义。
plugins.js: PluginManager(内部插件宿主)。核心插件模块经 plugins-registry.js 汇总，启停写 core-plugins.json；插件设置页经 manifest.module.settingTab(app, containerEl) 由设置宿主打开。不扫描 .obsidian/plugins、不加载任何第三方代码（社区插件宿主、shim、安全模式与信任模态已整体移除）。
plugins-registry.js: corePluginModules 汇总表(id → 模块)。新增核心插件必须登记在此；已含出链(outgoing-link)、属性(properties)与录音机(audio-recorder)。对象顺序即功能区按钮顺序；1.14.4 顺序 switcher→graph→canvas→daily→templates→command-palette。
app-commands.js: 导航、设置与文档命令。关闭、固定标签操作只作用于中心文档。堆叠命令 workspace:toggle-stacked-tabs 作用于当前中心标签组，侧栏组拒绝执行。
app.js: App 装配。新建与修改均进入元数据解析。initialize 顺序：bootTime → language(须最先，界面模块构造前) → 非 macOS 加 body.styled-scrollbars → vault 身份 → settings → vault+watch → metadata/fileManager/hotkeyManager/plugins → workspace.mount → 插件加载 → _loadWorkspace → _applyTheme → settings 'change' 监听 → Ctrl+滚轮/捏合字号监听（仅外观「快速调整字体大小」开启时改字号，默认关；ctrl+wheel 恒 preventDefault，配合主进程 setVisualZoomLevelLimits(1,1) 锁死整页视觉缩放）→ _runOpeningBehavior。_applyTheme 应用 theme/accent/字体/--indent-size/根字号并调 _applyCustomCss(注入主题与启用的 snippets：现代主题 themes/<x>/theme.css，回退旧版主题 themes/<x>.css，与原版 getThemePath 同规则；style 元素带 data-css-theme)。ipcOn('context-menu') 保存主进程菜单参数并唤醒 _contextParamWaiters（编辑器右键菜单取拼写建议/剪贴板状态）。OBS_ACT 调试钩子支持 open/open-settings/exec(命令)。设置窗口以 app.isSettingsWindow(URL #settings-window) 分流：只跳过看门狗/后台索引/布局加载，其余照常装配。新库默认右栏收起；body 补 obsidian-app/show-inline-title。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
