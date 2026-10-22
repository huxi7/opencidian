/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回 {pass,count,checks}，验证输入、落盘与重开。
 * [POS]: notes-settings 场景。仅由 run.mjs 在带标记的临时库执行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/** 独立设置交互验收：OBS_NOTES_SETTINGS=daily-notes|templates|note-composer|zk-prefixer。 */
(async () => {
  const fs = require('fs'), path = require('path'), os = require('os');
  const base = fs.realpathSync(app.vault.adapter.getBasePath());
  const roots = ['/tmp', os.tmpdir()].filter(p => fs.existsSync(p)).map(p => fs.realpathSync(p));
  if (!roots.some(p => base.startsWith(p + path.sep)) || !/obs-copy-acceptance|vault-test|vault-main/.test(base)) {
    throw new Error('Only an isolated temporary acceptance vault is allowed: ' + base);
  }
  const checks=[];
  const check=(condition,label)=>{if(!condition)throw Error(label);checks.push(label);};
  const id = process.env.OBS_NOTES_SETTINGS || 'daily-notes';
  if (!['daily-notes','templates','note-composer','zk-prefixer'].includes(id)) throw new Error('Unknown notes settings tab: ' + id);
  if (!app.plugins.getInternalPlugin(id)?.enabled) await app.plugins.enableInternalPlugin(id);
  app.setting.open(); app.setting.openPluginOptions(id);
  const tab = app.setting.activeTab;
  check(tab?.id === id, '设置页签打开：'+id);
  await new Promise(resolve => setTimeout(resolve, 150));
  const controls = [...tab.containerEl.querySelectorAll('input, select, .checkbox-container')].map(el => ({
    type: el.type || el.tagName, value: el.value ?? el.classList.contains('is-enabled'),
  }));
  const rows = [...tab.containerEl.querySelectorAll('.setting-item')].map(row => ({
    name: row.querySelector('.setting-item-name')?.textContent || '',
    description: row.querySelector('.setting-item-description')?.textContent || '',
  }));
  check(rows.length >= 3, '设置行完整');
  check(controls.length >= 3, '设置控件完整');
  check(rows.every(row=>row.name.trim()), '设置行名称非空');
  const instance=app.plugins.getInternalPlugin(id).instance;
  const key=id==='templates'?'folder':id==='note-composer'?'template':id==='daily-notes'?'folder':'folder';
  const inputIndex=id==='daily-notes'?1:0;
  const input=tab.containerEl.querySelectorAll('input[type=text]')[inputIndex];
  check(!!input, '可编辑文本控件存在');
  const value='Acceptance settings '+id;
  input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));
  await new Promise(resolve=>setTimeout(resolve,150));
  check(instance.getOptions()[key]===value, '输入即时更新插件选项');
  const diskPath = '.obsidian/' + id + '.json';
  const disk = await app.vault.adapter.exists(diskPath) ? JSON.parse(await app.vault.adapter.read(diskPath)) : null;
  const options = app.plugins.getInternalPlugin(id).instance.getOptions();
  check(!!disk, '设置文件已落盘');
  check(disk[key]===value, '输入值写回设置文件');
  if (disk) for (const key of Object.keys(options)) {
    if (Object.hasOwn(disk, key) && JSON.stringify(disk[key]) !== JSON.stringify(options[key])) {
      throw new Error('Saved setting differs from running plugin: ' + id + '.' + key);
    }
  }
  app.setting.openPluginOptions(id);
  const reopened=app.setting.activeTab.containerEl.querySelectorAll('input[type=text]')[inputIndex];
  check(reopened?.value===value, '重开页签读回输入值');
  return { pass:true,count:checks.length,checks,status: 'PASS', stage: 'settings', tab: id, vault: base, options, disk, rows, controls };
})()
