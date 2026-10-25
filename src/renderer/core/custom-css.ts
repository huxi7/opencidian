/**
 * [INPUT]: Node fs/path、App 的库路径与外观开关。
 * [OUTPUT]: 导出 applyVaultCss 与 watchVaultCss。
 * [POS]: 库根 obsidian.css 兼容层。只读 CSS；监听支持创建、修改、删除与原子替换。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require('fs');
const path = require('path');

export function applyVaultCss(app: App) {
  let el = document.getElementById('opensidian-vault-css');
  let css = '';
  if (app.settings.appearance.customCss !== false) {
    try { css = fs.readFileSync(path.join(app.vaultPath, 'obsidian.css'), 'utf8'); } catch (_) {}
  }
  if (!css) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('style');
    el.id = 'opensidian-vault-css';
    document.head.appendChild(el);
  }
  el.textContent = css;
}

export function watchVaultCss(app: App) {
  const file = path.join(app.vaultPath, 'obsidian.css');
  const update = () => app._applyCustomCss();
  fs.watchFile(file, { persistent: false, interval: 250 }, update);
  const stop = () => fs.unwatchFile(file, update);
  window.addEventListener('beforeunload', stop, { once: true });
  return stop;
}
