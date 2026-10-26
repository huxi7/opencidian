/**
 * [INPUT]: Electron 的打包状态与安装包元数据。
 * [OUTPUT]: 导出 getAppVersion，供 IPC、菜单与更新检查共用。
 * [POS]: 应用版本唯一运行时出口；开发态不冒充上游产品版本。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { app } from 'electron';
export function getAppVersion(): string { return app.isPackaged ? app.getVersion() : 'dev'; }
