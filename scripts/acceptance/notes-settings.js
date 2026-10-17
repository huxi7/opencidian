/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: notes-settings 场景。仅由 run.mjs 在带标记的临时库执行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/** 独立设置截图脚本：OBS_NOTES_SETTINGS=daily-notes|templates|note-composer|zk-prefixer。 */
(async () => {
  const fs = require('fs'), path = require('path'), os = require('os');
  const base = fs.realpathSync(app.vault.adapter.getBasePath());
  const roots = ['/tmp', os.tmpdir()].filter(p => fs.existsSync(p)).map(p => fs.realpathSync(p));
  if (!roots.some(p => base.startsWith(p + path.sep)) || !/obs-copy-acceptance|vault-test|vault-main/.test(base)) {
    throw new Error('Only an isolated temporary acceptance vault is allowed: ' + base);
  }
  const id = process.env.OBS_NOTES_SETTINGS || 'daily-notes';
  if (!['daily-notes','templates','note-composer','zk-prefixer'].includes(id)) throw new Error('Unknown notes settings tab: ' + id);
  if (!app.plugins.getInternalPlugin(id)?.enabled) await app.plugins.enableInternalPlugin(id);
  app.setting.open(); app.setting.openPluginOptions(id);
  const tab = app.setting.activeTab;
  if (tab?.id !== id) throw new Error('Settings tab did not open: ' + id);
  await new Promise(resolve => setTimeout(resolve, 150));
  const controls = [...tab.containerEl.querySelectorAll('input, select, .checkbox-container')].map(el => ({
    type: el.type || el.tagName, value: el.value ?? el.classList.contains('is-enabled'),
  }));
  const rows = [...tab.containerEl.querySelectorAll('.setting-item')].map(row => ({
    name: row.querySelector('.setting-item-name')?.textContent || '',
    description: row.querySelector('.setting-item-description')?.textContent || '',
  }));
  if (rows.length < 3 || controls.length < 3) throw new Error('Plugin settings controls missing: ' + id);
  const diskPath = '.obsidian/' + id + '.json';
  const disk = await app.vault.adapter.exists(diskPath) ? JSON.parse(await app.vault.adapter.read(diskPath)) : null;
  const options = app.plugins.getInternalPlugin(id).instance.getOptions();
  if (disk) for (const key of Object.keys(options)) {
    if (Object.hasOwn(disk, key) && JSON.stringify(disk[key]) !== JSON.stringify(options[key])) {
      throw new Error('Saved setting differs from running plugin: ' + id + '.' + key);
    }
  }
  return { status: 'PASS', stage: 'settings', tab: id, vault: base, options, disk, rows, controls };
})()
