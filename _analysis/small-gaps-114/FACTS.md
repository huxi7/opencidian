# 1.14.4 小缺口事实

静态事实源：`_analysis/obsidian-114/renderer/app.js`、`app.css`、`i18n.js`。
全程不启动原版应用。app.js 为单行压缩包，以下位置为字符偏移。

- `app.js:3061161`：反链读取 `backlink.json` 的 `backlinkInDocument`，同步到 workspace。
- `app.js:3079951`：`A8.getSettingDefinitions` 只有文档底部反链开关。改变默认值并保存插件配置。
- `app.js:3086980`：Markdown 创建 `.embedded-backlinks`；新视图读取 workspace 默认值。
- `app.js:3089565`：Markdown `getState` 保存 `backlinks` 与反链局部状态。
- `app.js:3093620`：切换命令改变当前标签页 `backlinks`，保存布局。
- `app.js:3093924`：显示时创建反链组件，绑定当前 Markdown 文件；关闭时释放组件。
- `app.css:14709-14747`：文档反链顶部分隔线、阅读模式 `3em` 间隔、导航与字号。
- `app.js:819355` 附近的 `vw`：macOS 设置背景透明；启用 `sidebar` vibrancy，停用传 `null`。
- `app.js:1313877`：外观 `translucency` 保存配置，body 使用 `is-translucent`。
- `app.js:3817380`：原生半透明设置项只在 macOS 显示。
- `app.css:3292`、`6570-6590`：半透明 body 背景透明，工作区子层透明，保留原版背景 token。
- `app.js:3919812`：默认应用命令调用 `openWithDefaultApp`；文件菜单 `system` 项使用 `lucide-arrow-up-right`。
- `i18n.js`：`plugins.customCss.desc` 明确根 `obsidian.css`；当前 `customCss` 对象主要实现现代主题、片段与半透明。根 CSS 恢复为兼容扩展，开关写 `appearance.customCss`，不冒充 1.14.4 新增设置。

实现边界：反链结果复用现有 BacklinkView；不声称已补齐原版所有反链导航选项。默认应用 E2E 只验证 IPC 与受保护主进程路径，不启动外部程序。vibrancy 验证主进程调用真实 BrowserWindow API 后保存的成功应用状态，无截图视觉结论。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
