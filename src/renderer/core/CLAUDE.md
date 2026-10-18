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
fileManager.js: 文件创建/重命名/删除/移动，含链接自动更新与 processFrontMatter。generateMarkdownLink 仅对 .md 省略扩展名，附件（png 等）保留（shortest/markdown 两种格式同规则）。附件路径四语义(attachmentFolderPath: '/' 根 | './' 当前文件夹 | './sub' 子文件夹 | 'name' 指定文件夹)；删除走 promptDelete + trashOption(system|local|none)。重命名链接更新对齐原版：alwaysUpdateLinks 为假时弹窗（总是更新/仅此一次/不做更新），计数与文本替换必须在 metadataCache.onFileRename 之前完成。
settings.js: 读写 .obsidian/*.json (app/appearance/hotkeys/core-plugins/community-plugins)，merge 写入保留未知字段；DEFAULT_CORE_PLUGINS 定义于此处。app.json 键名逐字对齐原版(focusNewTab/smartIndentList/defaultViewMode(source|preview)/livePreview/promptDelete/deleteUnlinkedAttachments(ask|always|never)/trashOption(system|local|none)/openBehavior(''|new|daily|file:<path>))。
setting.js: 设置控件层。Setting/SettingGroup/SettingTab 基类与全部控件(Toggle/Dropdown/Slider/Button/ExtraButton/Text/Search/ColorPicker/TextArea)；DOM 结构对齐原版(fte 宿主消费)。SettingTab 必须放这里，放 views 会造成 tabs↔view 循环 import。
keymap.js: Keymap/HotkeyManager/hotkeyToString/eventToHotkey/IS_MAC。按键归一化与作用域栈；全局 keydown 入口。
default-hotkeys.js: 30 条原版默认快捷键(id → hotkeys)。
commands.js: CommandManager 注册与分派命令。执行检查回调传 false，编辑器回调带活动视图。
notices.js: Notice 右上角通知栈。默认 4000ms；hover 暂停、移开后 1000ms 再隐藏；出场 120ms opacity + margin-top 收拢后摘除，容器随最后一个通知一起摘除。addButton 生成 .notice-button-container > .notice-cta。容器与 Notice 都挂在 globalThis。
modals.js: 可复开的 Modal 基座与确认、输入弹窗。确认先结算结果，关闭取消待处理输入。FileNameModal：重命名式文件名弹窗（保存/取消、Enter 提交、非法字符校验），画布转换为文件使用。
menu.js: Menu/MenuItem。上下文菜单、子菜单、键盘导航；setParentElement 在打开期间标记触发元素（has-active-menu）；选中项/Enter/Esc 经 _closeRoot 关闭整条菜单链。
suggest.js: 文件与命令建议。输入位于结果前，选择结果与取消关闭分开结算。输入容器带 .search-input-clear-button(非空清空并触发 input，空则关闭)。键盘：上下、PageUp/PageDown(按实测行高整页跳跃)、Home/End、Enter/auxclick、macOS Ctrl+p/n；isComposing 抑制。空态文案 tt('setting.third-party-plugin.label-no-results-found')。
view.js: View 基类(load/onOpen/onClose/getState/setState/_rootEl 契约) + ViewRegistry。
workspace.js: 布局装配、导航与序列化。新文档进入中心，侧栏工具禁止用户关闭。恢复布局后按插件状态补齐入口。
workspace-sidebar.js: 固定工具映射与关闭判定。恢复旧布局遗漏的入口，插件禁用才撤销对应工具。
workspace-profile.js: 稳定的库名、帮助与设置入口。每次展开读取库注册表，菜单调用真实打开库 IPC。
workspace-model.js: 分割、标签组与叶子模型。视图切换依次关闭旧视图、装载新视图。
workspace-renderer.js: 分别渲染文档标签和固定工具图标。稳定挂载底栏及左右开关，功能区支持鼠标与键盘。
workspace-interactions.js: 仅中心文档可关闭、新建、拆分或拖拽。侧栏图标不接入文档菜单。
workspace-regression.js: 19 组内存回归。覆盖导航、分栏、恢复、固定入口与库栏身份。
plugins.js: PluginManager(内部+社区插件)与 buildObsidianApi() shim。内部插件模块经 plugins-registry.js 汇总。安全模式对齐原版：localStorage 键 enable-plugin-<appId>（null=未表态，库内已有插件时弹信任模态 mod-trust-folder）；setEnable(false) 只卸载保留 community-plugins.json，disableCommunityPlugin 才从配置移除；enableCommunityPlugin 有安全模式守卫。插件设置页经 manifest.module.settingTab(app, containerEl) 由设置宿主打开。
plugins-registry.js: corePluginModules 汇总表(id → 模块)。新增核心插件必须登记在此；已含出链(outgoing-link)、属性(properties)与录音机(audio-recorder)。
app-commands.js: 导航、设置与文档命令。关闭、固定标签操作只作用于中心文档。
app.js: App 装配。新建与修改均进入元数据解析。initialize 顺序：bootTime → language(须最先，界面模块构造前) → 非 macOS 加 body.styled-scrollbars → vault 身份 → settings → vault+watch → metadata/fileManager/hotkeyManager/plugins → workspace.mount → 插件加载 → _loadWorkspace → _applyTheme → settings 'change' 监听 → Ctrl+滚轮字号 → _runOpeningBehavior。_applyTheme 应用 theme/accent/字体/--indent-size/根字号并调 _applyCustomCss(注入 themes/<x>/theme.css 与启用的 snippets)。ipcOn('context-menu') 保存主进程菜单参数并唤醒 _contextParamWaiters（编辑器右键菜单取拼写建议/剪贴板状态）。OBS_ACT 调试钩子支持 open/open-settings/exec(命令)。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
