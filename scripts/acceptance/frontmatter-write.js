/**
 * [INPUT]: FileManager 属性写回、真实同库文档窗口、主进程 CAS 与 YAML。
 * [OUTPUT]: 返回 {pass,count,checks}；覆盖竞争、坏 YAML、失败恢复与正文保留。
 * [POS]: 多窗口数据完整性回归。所有文件属于隔离库。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const { ipcRenderer } = require('electron'), yaml = require('js-yaml');
  const checks = [], check = (value, label) => { if (!value) throw Error(label); checks.push(label); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const file = await app.vault.create('Concurrent properties.md', '---\nkeep: original\n---\n# body\n');
  const creationTime = file.stat.ctime;
  await app.workspace.openFile(file);
  const opened = await ipcRenderer.invoke('document-window-open', { type: 'markdown', state: { file: file.path } });
  check(opened.ok, '同库窗口真实就绪');
  try {
    await Promise.all([
      app.fileManager.processFrontMatter(file, async fm => { await wait(60); fm.left = 1; }),
      ipcRenderer.invoke('document-window-probe', { windowId: opened.windowId, action: 'property', key: 'right', value: 2 }),
    ]);
    const source = await app.vault.read(file), fm = yaml.load(/^---\n([\s\S]*?)\n---/.exec(source)[1]);
    check(fm.left === 1 && fm.right === 2 && fm.keep === 'original', '跨窗口并发属性均保留');
    check(source.endsWith('# body\n'), '并发写回保留正文');
    check(Math.abs(file.stat.ctime - creationTime) <= 1, '属性写回保持文件创建时间：' + creationTime + '→' + file.stat.ctime);
    const expected = source;
    const results = await Promise.all(['a', 'b'].map(value => ipcRenderer.invoke('vault-write-cas', { path: file.path, expected, text: expected + value })));
    check(results.filter(result => result.ok).length === 1, '同原文并发 CAS 只允许一个成功');
    check(results.filter(result => result.conflict).length === 1, '过时原文明确返回冲突');
    check([expected + 'a', expected + 'b'].includes(await app.vault.read(file)), 'CAS 不混合两次写入');
  } finally { await ipcRenderer.invoke('document-window-close', opened.windowId); }
  for (const [name, source] of [['broken', '---\nkey: [\n---\nbody'], ['unclosed', '---\nkey: value\nbody'], ['array', '---\n- one\n---\nbody'], ['scalar', '---\nfalse\n---\nbody']]) {
    const bad = await app.vault.create(name + '.md', source); let rejected = false, called = false;
    try { await app.fileManager.processFrontMatter(bad, fm => { called = true; fm.newKey = 1; }); } catch { rejected = true; }
    check(rejected && !called, name + ' 无效属性在调用修改器前拒绝');
    check(await app.vault.read(bad) === source, name + ' 原文件逐字保留');
  }
  const empty = await app.vault.create('Empty attributes.md', '---\n---\n正文\n');
  await app.fileManager.processFrontMatter(empty, fm => { fm.test = true; });
  check((await app.vault.read(empty)).endsWith('正文\n'), '空属性块可正常添加且保留正文');
  const crlf = await app.vault.create('CRLF.md', '\uFEFF---\r\nkeep: yes\r\n---\r\n正文\r\n');
  await app.fileManager.processFrontMatter(crlf, fm => { fm.added = 2; });
  const crlfText = await app.vault.read(crlf);
  check(crlfText.startsWith('\uFEFF---\r\n') && !/(?<!\r)\n/.test(crlfText), '保留 BOM 与 CRLF 换行');
  check(crlfText.endsWith('正文\r\n'), 'CRLF 正文逐字保留');
  let failed = false;
  try { await app.fileManager.processFrontMatter(empty, () => { throw Error('intentional'); }); } catch { failed = true; }
  await app.fileManager.processFrontMatter(empty, fm => { fm.afterFailure = true; });
  check(failed && (await app.vault.read(empty)).includes('afterFailure: true'), '失败不会阻塞后续同文件操作');
  const denied = await ipcRenderer.invoke('vault-write-cas', { path: '../outside.md', expected: '', text: 'bad' });
  check(denied.ok === false, 'CAS 拒绝库外文件');
  return { pass: true, count: checks.length, checks };
})();
