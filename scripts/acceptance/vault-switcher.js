/**
 * [INPUT]: 独立临时 vault、预置的 3 个未打开仓库、真实主进程 IPC。
 * [OUTPUT]: 打开 starter 第二窗口并等待其验收回执；本窗口只断言库注册表与入口。
 * [POS]: vault-switcher 场景的主窗脚本。第二窗口断言在 vault-switcher.starter.js。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const fs = require('fs');
  const path = require('path');
  const { ipcRenderer } = require('electron');
  const checks = [];
  const check = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

  const list = ipcRenderer.sendSync('vault-list') || {};
  const all = Object.values(list).filter(entry => entry && typeof entry.path === 'string');
  const byPath = target => all.find(entry => path.resolve(entry.path) === path.resolve(target));
  const seeded = ['A', 'B', 'C'].map(letter =>
    path.join(path.dirname(app.vaultPath), 'vault-switcher-seeded-' + letter));

  check(!!byPath(app.vaultPath), '主库已登记');
  check(byPath(app.vaultPath).ts > 0, '主库 ts 用于置顶');
  for (const target of seeded) {
    check(!!byPath(target), '预置仓库已登记: ' + path.basename(target));
    check(fs.existsSync(target), '预置仓库目录存在: ' + path.basename(target));
  }

  // 复现用户入口：侧栏底部库名 → 菜单 → 管理仓库…（原版 #951 同一入口）。
  const switcher = document.querySelector('.workspace-drawer-vault-switcher');
  check(!!switcher, '侧栏底部库名存在');
  switcher.click();
  await pause(60);
  const menu = document.querySelector('.menu');
  check(!!menu, '库菜单展开');
  const manage = Array.from(menu.querySelectorAll('.menu-item'))
    .find(item => item.textContent.includes('管理仓库'));
  check(!!manage, '库菜单含管理仓库');
  manage.click();
  await pause(120);
  check(!document.querySelector('.menu'), '点击后菜单关闭');
  check(!!fs.existsSync(path.join('src', 'renderer', 'starter.html')), 'starter.html 存在');

  // 第二窗口的断言与浅/深截图在 800-1100ms 后开始；留足执行时间再让主钩子收尾。
  await pause(6500);
  return { pass: true, checks, vault: app.vaultPath };
})()
