/**
 * [INPUT]: 共享写入契约、库身份与原文、Node fs/child_process；macOS 系统 cp 保留创建时间。
 * [OUTPUT]: registerVaultWriteIpc 注册按文件串行的比较后原子写回。
 * [POS]: 多窗口写入边界。旧原文拒写，渲染器重读重试；坏请求不触碰文件。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'fs';
import type { VaultWriteRequest } from '../contracts.js';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
const copyMetadata = promisify(execFile);
function registerVaultWriteIpc({ ipcMain, vaultPathForSender }) {
  const queues = new Map();
  ipcMain.handle('vault-write-cas', async (event: Electron.IpcMainInvokeEvent, request: VaultWriteRequest) => {
    try {
      const root = vaultPathForSender(event.sender);
      if (!root || typeof request?.path !== 'string' || typeof request.expected !== 'string' || typeof request.text !== 'string') return { ok: false, error: '无效库写入请求' };
      const absolute = await fs.promises.realpath(path.resolve(root, request.path));
      const relative = path.relative(await fs.promises.realpath(root), absolute);
      if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return { ok: false, error: '文件不在当前库中' };
      const previous = queues.get(absolute) || Promise.resolve();
      const operation = previous.catch(() => {}).then(async () => {
        if (await fs.promises.readFile(absolute, 'utf8') !== request.expected) return { ok: false, conflict: true };
        const stat = await fs.promises.stat(absolute);
        const temporary = path.join(path.dirname(absolute), '.opensidian-write-' + crypto.randomBytes(8).toString('hex'));
        try {
          // Electron 33 的 macOS copyFile 不保留创建时间；系统复制保留该元数据。
          if (process.platform === 'darwin') await copyMetadata('/bin/cp', ['-p', absolute, temporary]);
          else await fs.promises.copyFile(absolute, temporary, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE);
          await fs.promises.writeFile(temporary, request.text, { encoding: 'utf8', mode: stat.mode });
          // 生成临时文件期间仍可能收到外部编辑，覆盖前再次核对。
          if (await fs.promises.readFile(absolute, 'utf8') !== request.expected) return { ok: false, conflict: true };
          await fs.promises.rename(temporary, absolute);
          return { ok: true };
        } finally { await fs.promises.unlink(temporary).catch(() => {}); }
      });
      queues.set(absolute, operation);
      try { return await operation; } finally { if (queues.get(absolute) === operation) queues.delete(absolute); }
    } catch (error) { return { ok: false, error: error.message }; }
  });
}
export { registerVaultWriteIpc };
