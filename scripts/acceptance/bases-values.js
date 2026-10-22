/**
 * [INPUT]: 隔离库、Bases 富值公式、视图配置与受控 CSV 保存路径。
 * [OUTPUT]: 返回 {pass,count,checks}，验证可写笔记/只读公式富值、导航与真实 CSV 写盘。
 * [POS]: P3 在真实 Electron 的交付边界。不弹原生保存框，不调用外部程序。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const checks = [], check = (value, message) => { if (!value) throw Error(message); checks.push(message); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (fn, message) => { for (let i = 0; i < 160; i++) { if (fn()) return; await wait(25); } throw Error(message); };
  const fs = require('fs'), path = require('path'), yaml = require('js-yaml');
  await app.vault.createFolder('Data');
  const alpha = await app.vault.create('Data/Alpha.md', yaml.dump({ title: 'Comma, "quote"', done: true, empty: null, related: '[[Data/Beta]]', tags: ['rich-test'] }).replace(/^/, '---\n') + '---\n[[Data/Beta]]\n');
  const beta = await app.vault.create('Data/Beta.md', '---\ntitle: plain\ndone: false\n---\nBeta\n');
  await app.vault.createBinary('Tiny.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1sAAAAASUVORK5CYII=', 'base64'));
  await app.vault.create('Tiny.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="2"><rect width="1" height="2" fill="red"/></svg>');
  await until(() => app.metadataCache.getFileCache(alpha)?.frontmatter?.done === true, '等待属性索引');
  const formulas = {
    readonlyDone: 'done', reference: 'link("Data/Beta.md", "Target")', fileValue: 'file("Data/Beta.md")',
    website: 'link("https://example.com", "Site")', mail: 'link("mailto:alice@example.com")',
    icon: 'icon("lucide-check")', image: 'image("Tiny.png")', svg: 'image("Tiny.svg")',
    html: 'html("<img src=x onerror=window.__baseHtmlExecuted=true>")',
    markdown: 'markdown("**bold** <b>literal</b> [Site](https://example.com)")',
    blocked: 'link("javascript:alert(1)")', values: '[link("Data/Beta.md"), 0, false, null]',
  };
  const properties = { 'note.title': { displayName: 'Note, title' } };
  const view = { type: 'table', name: 'Output', order: ['file.name', 'note.done', 'note.tags', ...Object.keys(formulas).map(name => 'formula.' + name)] };
  const source = yaml.dump({ filters: 'file.inFolder("Data")', formulas, properties, views: [view] });
  const file = await app.vault.create('Values.base', source);
  const leaf = await app.workspace.openFile(file);
  const controller = leaf.view.controller;
  check(controller.result.rows.length === 2, '真实笔记查询产生两行富值');
  const cell = property => controller.container.querySelector('tbody tr').children[controller.result.columns.indexOf(property)];
  check(cell('note.done').querySelector('input[type=checkbox]')?.checked === true, '布尔属性显示真实复选框');
  check(!cell('note.done').querySelector('input').disabled, '笔记复选属性可编辑');
  check(cell('formula.readonlyDone').querySelector('input').disabled, '公式复选值保持只读');
  cell('note.done').querySelector('input').click(); await controller.queue;
  await until(() => app.metadataCache.getFileCache(alpha)?.frontmatter?.done === false && !cell('note.done').querySelector('input').checked, '等待复选属性实际写回');
  check(yaml.load((await app.vault.read(alpha)).split('---')[1]).done === false, '复选属性编辑真实写盘');
  cell('note.done').querySelector('input').click(); await controller.queue;
  await until(() => app.metadataCache.getFileCache(alpha)?.frontmatter?.done === true && cell('note.done').querySelector('input').checked, '等待复选属性恢复');
  check(cell('note.tags').querySelector('a.tag')?.textContent === '#rich-test', '标签列表渲染标签链接');
  check(cell('formula.reference').querySelector('a.internal-link')?.textContent === 'Target', 'Link 值显示自定义文本');
  check(cell('formula.fileValue').querySelector('a.internal-link')?.textContent === 'Beta', 'File 值显示目标笔记名');
  check(!!cell('formula.icon').querySelector('svg'), '图标公式使用现有 SVG 图标表');
  await until(() => cell('formula.image').querySelector('img')?.naturalWidth === 1, '等待库内图片公式载入');
  check(cell('formula.image').querySelector('img').naturalHeight === 1, '图片公式读取真实库内资源');
  await until(() => cell('formula.svg').querySelector('img')?.naturalWidth === 1, '等待 SVG 协议媒体类型与解码');
  check(cell('formula.svg').querySelector('img').naturalHeight === 2, 'SVG 公式通过真实 app 协议解码');
  check(!!cell('formula.html').querySelector('.bases-rich-html') && !cell('formula.html').querySelector('[onerror],script'), 'HTML 渲染真实内容并移除危险事件和脚本');
  check(window.__baseHtmlExecuted !== true, 'HTML 值没有执行事件代码');
  await cell('formula.markdown').querySelector('.bases-rich-markdown').ready;
  check(cell('formula.markdown').querySelector('strong')?.textContent === 'bold', 'Markdown 公式渲染标准行内语法');
  check(cell('formula.markdown').querySelector('b')?.textContent === 'literal' && !cell('formula.markdown').querySelector('script,[onerror]'), 'Markdown 复用阅读器渲染安全行内 HTML');
  check(!cell('formula.blocked').querySelector('a') && cell('formula.blocked').textContent.includes('不支持此链接协议'), '不支持的协议显示明确降级');
  check(cell('formula.values').querySelectorAll('.value-list-element').length === 4, '列表富值逐项渲染，不吞零假空值');
  const { ipcRenderer } = require('electron'), sent = [], send = ipcRenderer.send;
  ipcRenderer.send = function(channel, ...args) { if (channel === 'open-external' || channel === 'open-url') sent.push([channel, ...args]); else return send.call(this, channel, ...args); };
  try {
    cell('formula.website').querySelector('a').click();
    check(sent[0]?.[0] === 'open-external' && sent[0]?.[1] === 'https://example.com', 'HTTP 链接经受保护的既有外链通道');
    cell('formula.mail').querySelector('a').click();
    check(sent[1]?.[0] === 'open-url' && sent[1]?.[1] === 'mailto:alice@example.com', '邮件链接经受保护的既有 URL 通道');
  } finally { ipcRenderer.send = send; }
  cell('formula.reference').querySelector('a').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true, ctrlKey: true }));
  await until(() => app.workspace.getActiveFile()?.path === beta.path, '等待富值链接打开目标');
  check(app.workspace.activeLeaf !== leaf, '修饰点击富值链接新建目标标签');
  const targetLeaf = app.workspace.activeLeaf;
  app.workspace.setActiveLeaf(leaf, { focus: false }); await targetLeaf.detach();
  cell('note.tags').querySelector('a.tag').click();
  await until(() => app.workspace.getLeavesOfType('search').some(item => item.view.getState()?.query === 'tag:#rich-test'), '等待标签打开搜索');
  check(app.workspace.getLeavesOfType('search').some(item => item.view.getState()?.query === 'tag:#rich-test'), '标签富值导航复用全局搜索');
  app.workspace.setActiveLeaf(leaf, { focus: false });
  await app.plugins.disableInternalPlugin('global-search'); controller.render();
  check(!cell('note.tags').querySelector('a') && cell('note.tags').textContent.includes('搜索核心插件未启用'), '搜索插件停用时标签明确降级');
  await app.plugins.enableInternalPlugin('global-search'); controller.render();
  check(!!cell('note.tags').querySelector('a.tag'), '搜索插件恢复后重新提供标签导航');
  await controller.patchView('order', ['file.name', 'note.title', 'note.done', 'note.empty']);
  await controller.patchView('limit', 1);
  const exported = path.join(app.vaultPath, 'Output.csv');
  let promptOptions, prompts = 0;
  controller.promptCsvSavePath = options => { prompts++; promptOptions = options; return { canceled: false, filePath: exported }; };
  const command = app.commands.findCommand('bases:export-csv');
  check(!!command && command.icon === 'lucide-file-down', '命令面板提供真实 CSV 导出动作和图标');
  app.commands.executeCommandById('bases:export-csv');
  const expected = 'file.name,"Note, title",done,empty\nAlpha,"Comma, ""quote""",true,';
  await until(() => fs.existsSync(exported) && fs.readFileSync(exported, 'utf8') === expected, '等待真实 CSV 写盘');
  check(fs.readFileSync(exported, 'utf8') === expected, 'CSV 命令输出真实属性、别名表头、引号与 limit');
  check(promptOptions.defaultPath === 'Output.csv', '保存默认名取当前视图名称');
  check(app.commands.findCommand('bases:export-csv')?.checkCallback(true) === true, '数据库视图中导出命令可用');
  controller.promptCsvSavePath = () => { prompts++; return { canceled: true }; };
  app.commands.executeCommandById('bases:export-csv'); await wait(100);
  check(prompts === 2 && fs.readFileSync(exported, 'utf8') === expected, '命令取消保存不截断已有文件');
  const fresh = path.join(app.vaultPath, 'Fresh.csv');
  controller.promptCsvSavePath = () => ({ canceled: false, filePath: fresh });
  const changed = yaml.load(await app.vault.read(file)); changed.views[0].limit = 2;
  await app.vault.modify(file, yaml.dump(changed));
  app.commands.executeCommandById('bases:export-csv');
  await until(() => fs.existsSync(fresh) && fs.readFileSync(fresh, 'utf8').includes('Beta,plain,false,'), '等待命令重读新配置导出');
  check(fs.readFileSync(fresh, 'utf8').split('\n').length === 3, '命令导出重读磁盘并包含新增结果行');
  await controller.patchView('type', 'future');
  check(app.commands.findCommand('bases:export-csv').checkCallback(true) === false, '未知视图不提供 CSV 命令');
  const mdLeaf = await app.workspace.openFile(alpha, { newLeaf: 'tab' });
  check(app.commands.findCommand('bases:export-csv').checkCallback(true) === false, 'Markdown 视图中导出命令不可用');
  await mdLeaf.detach();
  await app.plugins.disableInternalPlugin('bases');
  check(!app.commands.findCommand('bases:export-csv'), '停用数据库插件撤销 CSV 命令');
  return { pass: true, count: checks.length, checks };
})()
