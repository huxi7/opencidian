/**
 * [INPUT]: Electron 窗口和 IPC 事件的基础类型。
 * [OUTPUT]: 声明本应用附加的窗口状态与同步事件参数。
 * [POS]: 主进程运行时扩展的类型声明，不改变 Electron 行为。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export {};
declare global {
  namespace Electron {
    interface BrowserWindow {
      vaultId?: string;
      loaded?: boolean;
      _opensidianVibrancy?: boolean;
      setTrafficLightPosition?: (position: { x: number; y: number }) => void;
    }
    interface IpcMainEvent { args?: unknown[]; }
  }
}
