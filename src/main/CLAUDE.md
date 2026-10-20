# src/main/

> L2 | 父级: /src/CLAUDE.md

Electron 主进程。按运行入口与开发验收分离：窗口生命周期、app:// 协议、IPC 通道、原生菜单、vault 注册表。渲染进程通过 `window.app.commands.executeCommandById` 接收菜单命令。

成员清单
main.js: 应用主进程装配。要点：`DATA_DIR=userData`（应用名 OpenSidian）保存 vault 注册表(opensidian.json，首次启动从旧 "Obsidian Copy" 目录迁移)；`APP_ORIGIN=app://opensidian.app/` 服务 src/renderer 与 dist/；`FILE_ORIGIN=app://<16hex>/` 流式读取任意 vault 文件(支持 Range)；`openVaultPath()` 打开/新建 vault；`windows[id]` 映射 vault 窗口；`frameWindowOptions()` 按 opensidian.json 的 frame 键选 hidden/custom/native 边框；`setWindowOpenHandler` 把 about:blank popup 交给 settings-window.js（设置独立窗口）；disable-gpu 读写(启动时 app.disableHardwareAcceleration)；locale ipc(app.getLocale)；env 钩子 `OBS_VAULT_PATH`(直开 vault)/`OBS_SCREENSHOT`(截图自检)/`OBS_ACT`(调试动作：open/open-settings/exec/eval)；starter 窗口在 E2E 下 focusable=false/opacity=0/backgroundThrottling=false。

settings-window.js: 设置独立窗口管理器。每库至多一窗（Map<vaultId>，「设置」单实例复用聚焦）；对齐 1.14.4 setWindowOpenHandler("about:blank"+"popup")：跟随「窗口边框」的 frame/titleBarStyle、900x700(min 600x400)、首次相对主窗居中；窗口标题取页面 document.title（渲染层产出 设置 - 库名 - 应用版本）。

dev-hooks.js: OBS_* 门控的动作、DOM 探针与截图。只向 OBS_VAULT_PATH 对应窗口注入验收，切库窗口不重放动作；第二窗口（starter）以独立 prefix/logTag 挂载，支持浅色截图与加载完成竞态兜底。

原生 macOS 菜单保留 Settings 入口，直接分派 app:open-settings。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
