# src/main/

> L2 | 父级: /src/CLAUDE.md

Electron 主进程。单文件实现：窗口生命周期、app:// 协议、IPC 通道、原生菜单、vault 注册表。渲染进程通过 `window.app.commands.executeCommandById` 接收菜单命令。

成员清单
main.js: 全部主进程逻辑。要点：`DATA_DIR=userData` 保存 vault 注册表(obsidian.json)；`APP_ORIGIN=app://obsidian.md/` 服务 src/renderer 与 dist/；`FILE_ORIGIN=app://<16hex>/` 流式读取任意 vault 文件(支持 Range)；`openVaultPath()` 打开/新建 vault；`windows[id]` 映射 vault 窗口；`frameWindowOptions()` 按 obsidian.json 的 frame 键选 hidden/custom/native 边框；disable-gpu 读写(启动时 app.disableHardwareAcceleration)；locale ipc(app.getLocale)；env 钩子 `OBS_VAULT_PATH`(直开 vault)/`OBS_SCREENSHOT`(截图自检)/`OBS_ACT`(调试动作：open/open-settings/exec/eval)。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
