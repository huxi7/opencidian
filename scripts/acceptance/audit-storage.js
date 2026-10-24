/**
 * [INPUT]: 隔离库中的真实 Vault/FileManager、文件树及磁盘适配器。
 * [OUTPUT]: 返回 {pass,count,checks}，覆盖可恢复删除、移动与排他创建。
 * [POS]: 数据安全集成验收。不调用系统回收站，不接触用户文件。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const fs = require('fs'), path = require('path');
  const checks = [], check = (ok, message) => { if (!ok) throw Error(message); checks.push(message); };
  const rejects = async (action, message) => { let failed = false; try { await action(); } catch { failed = true; } check(failed, message); };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const root = app.vault.getBasePath(), prefix = 'Storage-' + Date.now().toString(36);
  const absolute = relative => path.join(root, relative);
  check(fs.existsSync(absolute('.obs-copy-acceptance-fixture')), '只在验收标记的隔离库执行');
  const original = { ...app.settings.appSettings };
  try {
    Object.assign(app.settings.appSettings, { promptDelete: false, trashOption: 'local' });
    const name = prefix + '.md', text = '# 必须可恢复\n';
    const local = await app.vault.create(name, text);
    await app.fileManager.deleteFile(local);
    check(!fs.existsSync(absolute(name)), '本地回收从原位置移走文件');
    check(fs.readFileSync(absolute('.trash/' + name), 'utf8') === text, '本地回收真实保留正文');
    check(!app.vault.getFileByPath(name) && !app.vault.getFileByPath('.trash/' + name), '回收文件从可见模型撤销且隐藏回收站');
    const second = await app.vault.create(name, '# 第二份\n'); await app.fileManager.deleteFile(second, true);
    check(fs.readFileSync(absolute('.trash/' + prefix + ' 2.md'), 'utf8') === '# 第二份\n', '跳过确认仍本地回收且同名递增');
    check(fs.readFileSync(absolute('.trash/' + name), 'utf8') === text, '同名回收不覆盖首份文件');
    const from = await app.vault.createFolder(prefix + '-A'), to = await app.vault.createFolder(prefix + '-B');
    const moving = await app.vault.create(from.path + '/Note.md', '# 移动\n');
    check(await app.fileManager.moveFile(moving, to), '文件管理器移动成功');
    check(!from.children.includes(moving) && to.children.includes(moving) && moving.parent === to, '移动立即同步父子树');
    check(fs.readFileSync(absolute(to.path + '/Note.md'), 'utf8') === '# 移动\n', '移动后磁盘正文不变');
    const explorer = app.workspace.getLeavesOfType('file-explorer')[0]?.view;
    check(!!explorer?.treeEl, '文件树真实面板已装载');
    explorer._collapsed.clear(); explorer.render();
    const selector = '.nav-file-title[data-path="' + moving.path + '"]';
    const row = explorer.treeEl.querySelector(selector);
    check(row?.parentElement.closest('.nav-folder')?.getAttribute('data-path') === to.path, '文件树把移动项画到目标父目录');
    check(explorer.treeEl.querySelectorAll(selector).length === 1, '文件树只显示一个移动项');
    const folder = await app.vault.createFolder(from.path + '/Sub');
    const child = await app.vault.create(folder.path + '/Nested.md', '# 子文件\n');
    await app.vault.rename(folder, to.path + '/Sub');
    check(!from.children.includes(folder) && to.children.includes(folder) && child.path === to.path + '/Sub/Nested.md', '文件夹移动同步祖先树与子路径');
    await app.fileManager.deleteFile(folder);
    check(fs.readFileSync(absolute('.trash/Sub/Nested.md'), 'utf8') === '# 子文件\n', '本地回收文件夹保留子文件');
    const collision = prefix + '-External.md'; fs.writeFileSync(absolute(collision), '# 外部原文\n');
    await rejects(() => app.vault.create(collision, '# 不得覆盖\n'), '排他创建拒绝刚写入磁盘的同名笔记');
    check(fs.readFileSync(absolute(collision), 'utf8') === '# 外部原文\n', '创建失败保留外部原文');
    const racePath = prefix + '-Race.md';
    const raced = await Promise.allSettled([app.vault.create(racePath, 'A'), app.vault.create(racePath, 'B')]);
    check(raced.filter(result => result.status === 'fulfilled').length === 1, '并发同名创建仅一个成功');
    await pause(400);
    check(app.vault.getRoot().children.filter(file => file.path === racePath).length === 1, '监听回显后仍只有一个同名模型');
    check(!app.vault.getAbstractFileByPath('.trash'), '监听回显仍不暴露回收站目录');
    Object.assign(app.settings.appSettings, { trashOption: 'system' });
    const system = await app.vault.create(prefix + '-System.md', '# 安全降级\n');
    await app.fileManager.deleteFile(system);
    check(fs.readFileSync(absolute('.trash/' + system.name), 'utf8') === '# 安全降级\n', 'E2E系统回收经真实IPC安全降级库内回收');
    check(!fs.existsSync(absolute(system.path)) && !app.vault.getFileByPath(system.path), '系统回收降级成功后撤销原文件与模型');
    Object.assign(app.settings.appSettings, { trashOption: 'none' });
    const permanent = await app.vault.create(prefix + '-Permanent.md', 'explicit'); await app.fileManager.deleteFile(permanent);
    check(!fs.existsSync(absolute(permanent.path)) && !fs.existsSync(absolute('.trash/' + permanent.name)), '显式none才永久删除');
    return { pass: true, count: checks.length, checks };
  } finally { app.settings.appSettings = original; }
})()
