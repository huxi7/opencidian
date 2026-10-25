# src/

> L2 | 父级: /CLAUDE.md

主进程与渲染进程的全部源码，按 Electron 进程边界分两棵树。

成员清单
contracts.ts: 主进程与渲染器共用的文件、库、视图和原子写入数据契约。
ipc-contracts.ts: 按通道绑定参数元组和回执，统一窗口、菜单和网络的跨进程协议。
main/ - Electron 主进程 (见 main/CLAUDE.md)
renderer/ - 渲染进程应用主体 (见 renderer/CLAUDE.md)

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
