/**
 * [INPUT]: 隔离库、真实命令分派、Markdown/Canvas 文件视图与可控读取失败。
 * [OUTPUT]: 返回换行结果、加载失败保留与重试恢复的 {pass,count,checks} 回执。
 * [POS]: 界面审计回归。断言实际编辑文本和磁盘原文，防止错误文件被空视图接管。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const checks = [], failures = [];
  const check = (condition, message) => { if (condition) checks.push(message); else failures.push(message); };
  const stamp = Date.now();
  const create = (name, text) => app.vault.create('Audit-interface-' + stamp + '-' + name, text);
  const run = id => app.commands.executeCommandById('editor:' + id);
  const persistedLeaf = async id => {
    await app.saveLayout();
    const layout = JSON.parse(require('fs').readFileSync(require('path').join(app.vaultPath, '.obsidian/workspace.json'), 'utf8'));
    const find = node => node?.id === id ? node : (node?.children || []).map(find).find(Boolean);
    return [layout.main, layout.left, layout.right].map(find).find(Boolean);
  };
  const note = await create('commands.md', 'Alpha\nBeta\nGamma\nDelta');
  await app.workspace.openFile(note);
  const markdown = app.workspace.activeLeaf.view;
  const editor = markdown.editor;
  editor.setCursor({ line: 1, ch: 2 });
  check(run('swap-line-up') !== false, '上移行命令可执行');
  check(editor.getValue() === 'Beta\nAlpha\nGamma\nDelta', '上移行真实交换相邻文本');
  check(editor.getCursor().line === 0 && editor.getCursor().ch === 2, '上移行光标跟随原文本');
  editor.setValue('Alpha\nBeta\nGamma\nDelta');
  editor.setCursor({ line: 1, ch: 2 });
  check(run('swap-line-down') !== false, '下移行命令可执行');
  check(editor.getValue() === 'Alpha\nGamma\nBeta\nDelta', '下移行真实交换相邻文本');
  check(editor.getCursor().line === 2 && editor.getCursor().ch === 2, '下移行光标跟随原文本');
  editor.setValue('Alpha\nBeta\nGamma\nDelta');
  editor.setSelection({ line: 1, ch: 1 }, { line: 2, ch: 3 });
  run('swap-line-up');
  check(editor.getValue() === 'Beta\nGamma\nAlpha\nDelta', '多行选区整体上移');
  check(editor.getRange(editor.getCursor('from'), editor.getCursor('to')) === 'eta\nGam', '上移保持多行选区内容');
  run('swap-line-down');
  check(editor.getValue() === 'Alpha\nBeta\nGamma\nDelta', '多行选区整体下移复原');
  editor.setCursor({ line: 0, ch: 1 });
  run('swap-line-up');
  check(editor.getValue() === 'Alpha\nBeta\nGamma\nDelta', '首行上移不改内容');
  editor.setCursor({ line: 3, ch: 1 });
  run('swap-line-down');
  check(editor.getValue() === 'Alpha\nBeta\nGamma\nDelta', '末行下移不改内容');
  await markdown.save();
  check(await app.vault.read(note) === editor.getValue(), '换行结果通过正常保存写入磁盘');

  await markdown.setState({ mode: 'source' });
  app.settings.updateAppSettings({ foldHeading: true, foldIndent: true });
  editor.setValue('# Outer\nouter body\n## Middle\nmiddle body\n### Inner\ninner body\n## Sibling\nsibling body\n# End\nend body');
  const foldSteps = [];
  const pause = async () => { await new Promise(resolve => setTimeout(resolve, 45)); foldSteps.push({ text: content(), count: placeholders(), cursor: editor.getCursor() }); };
  const content = () => editor.cm.contentDOM.textContent;
  const placeholders = () => editor.cm.dom.querySelectorAll('.cm-foldPlaceholder').length;
  editor.setCursor({ line: 6, ch: 0 });
  run('fold-more'); await pause();
  check(placeholders() === 1 && !content().includes('sibling body'), '无关兄弟标题独立折叠');
  editor.setCursor({ line: 5, ch: 2 });
  run('fold-more'); await pause();
  check(placeholders() === 2 && !content().includes('inner body'), '折叠更多从光标所在内层开始');
  run('fold-more'); await pause();
  check(!content().includes('Inner') && placeholders() === 2, '再次折叠更多折起中层且保留兄弟');
  run('fold-more'); await pause();
  check(!content().includes('Middle') && placeholders() === 1, '第三次折叠更多折起外层');
  run('fold-more'); await pause();
  check(placeholders() === 1 && !content().includes('Middle'), '折叠更多达到最外层不反向展开');
  run('fold-less'); await pause();
  check(content().includes('Middle') && !content().includes('Inner'), '展开更少只展开最外一层');
  check(!content().includes('sibling body'), '展开更少保留无关兄弟折叠');
  run('fold-less'); await pause();
  check(content().includes('Inner') && !content().includes('inner body'), '展开更少下一次只展开中层');
  run('fold-less'); await pause();
  check(content().includes('inner body') && placeholders() === 1, '逐层展开到内层仍保留兄弟折叠');
  run('unfold-all'); await pause();
  check(placeholders() === 0 && content().includes('sibling body'), '展开全部仍完整展开文档');
  await markdown.save();

  const unreadable = await create('read-error.md', '# Disk original\n\nMust survive');
  const originalRead = app.vault.cachedRead;
  const denyRead = file => {
    app.vault.cachedRead = async function (candidate) {
      if (candidate === file) throw new Error('AUDIT_READ_FAILURE');
      return originalRead.call(this, candidate);
    };
  };
  const before = editor.getValue();
  denyRead(unreadable);
  try {
    const result = await markdown.setState({ file: unreadable.path });
    check(result === false, 'Markdown读取失败拒绝文件切换');
    check(markdown.file === note, 'Markdown读取失败保留来源文件身份');
    check(editor.getValue() === before, 'Markdown读取失败保留现有正文');
  } finally { app.vault.cachedRead = originalRead; }
  editor.replaceRange(' preserved', { line: 0, ch: 5 });
  await markdown.save();
  check(await app.vault.read(unreadable) === '# Disk original\n\nMust survive', '失败后编辑保存不覆盖目标Markdown');
  check((await app.vault.read(note)).includes('preserved'), '失败后编辑仍保存到来源Markdown');
  await markdown.setState({ file: unreadable.path });
  check(markdown.file === unreadable && editor.getValue().includes('Must survive'), 'Markdown读取恢复后可重试装载');

  const holdRead = file => {
    const pending = []; let released = false;
    app.vault.cachedRead = function (candidate) {
      if (candidate !== file || released) return originalRead.call(this, candidate);
      return new Promise(resolve => pending.push(resolve));
    };
    return {
      async reached() { for (let attempt = 0; !pending.length && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 10)); check(pending.length > 0, '目标读取已挂起，迟到输入可确定性复现'); },
      async release() { released = true; const text = await originalRead.call(app.vault, file); pending.splice(0).forEach(resolve => resolve(text)); },
    };
  };
  const lateNote = await create('late-input.md', '# Target note\nuntouched');
  const noteGate = holdRead(lateNote);
  try {
    const loading = markdown.setState({ file: lateNote.path });
    await noteGate.reached();
    editor.replaceRange(' late input', { line: 0, ch: editor.getLine(0).length });
    await noteGate.release(); await loading;
    check((await app.vault.read(unreadable)).includes('late input'), 'Markdown目标读取期间的来源新输入先保存');
    check(editor.getValue() === '# Target note\nuntouched' && markdown.file === lateNote, 'Markdown来源新输入不串入目标正文');
  } finally { await noteGate.release(); app.vault.cachedRead = originalRead; }

  const goodData = { nodes: [{ id: 'keep', type: 'text', text: 'Canvas original', x: 0, y: 0, width: 250, height: 100 }], edges: [] };
  const good = await create('good.canvas', JSON.stringify(goodData));
  const badText = '{"nodes": [ BAD JSON';
  const bad = await create('bad.canvas', badText);
  const canvasLeaf = await app.workspace.openFile(good, { newLeaf: 'always' });
  const canvas = canvasLeaf.view;
  check(canvas.nodes.get('keep')?.text === 'Canvas original', '有效Canvas卡片已装载');
  const failed = await canvas.setState({ file: bad.path });
  check(failed === false, '坏JSON拒绝Canvas文件切换');
  check(canvas.file === good, '坏JSON保留来源Canvas文件身份');
  check(canvas.nodes.get('keep')?.text === 'Canvas original', '坏JSON保留来源Canvas卡片');
  const node = canvas.nodes.get('keep') || canvas.createTextNode({ x: 0, y: 0, width: 250, height: 100 });
  node.setText('Changed after failed load');
  canvas.requestSave();
  await canvas.save();
  check(await app.vault.read(bad) === badText, '坏JSON失败后编辑不会以空画布覆盖原文');
  check(JSON.parse(await app.vault.read(good)).nodes.some(item => item.text === 'Changed after failed load'), '坏JSON失败后编辑仍写回来源Canvas');

  // 使用另一目标注入IO失败，避开元数据与自身保存回声。
  const ioCanvas = await create('read-error.canvas', JSON.stringify(goodData));
  const savedData = JSON.stringify(canvas.getData());
  denyRead(ioCanvas);
  try {
    check(await canvas.setState({ file: ioCanvas.path }) === false, 'Canvas读取失败拒绝文件切换');
    check(canvas.file === good && JSON.stringify(canvas.getData()) === savedData, 'Canvas读取失败保留文件与卡片');
  } finally { app.vault.cachedRead = originalRead; }
  await canvas.setState({ file: ioCanvas.path });
  check(canvas.file === ioCanvas && canvas.nodes.get('keep')?.text === 'Canvas original', 'Canvas读取恢复后可重试装载');

  const lateCanvas = await create('late-input.canvas', JSON.stringify(goodData));
  const canvasGate = holdRead(lateCanvas);
  try {
    const loading = canvas.setState({ file: lateCanvas.path });
    await canvasGate.reached();
    canvas.nodes.get('keep').setText('Canvas late input'); canvas.requestSave();
    await canvasGate.release(); await loading;
    check(JSON.parse(await app.vault.read(ioCanvas)).nodes[0].text === 'Canvas late input', 'Canvas目标读取期间的来源新输入先保存');
    check(canvas.file === lateCanvas && canvas.nodes.get('keep').text === 'Canvas original', 'Canvas来源新输入不串入目标卡片');
  } finally { await canvasGate.release(); app.vault.cachedRead = originalRead; }
  for (const [index, invalid] of ['null', '[]', '{"nodes":{}}', '{"edges":{}}'].entries()) {
    const shape = await create('invalid-shape-' + index + '.canvas', invalid);
    check(await canvas.setState({ file: shape.path }) === false && canvas.file === lateCanvas, 'Canvas拒绝非法结构并保留来源 ' + invalid);
    check(await app.vault.read(shape) === invalid, 'Canvas非法结构原文保持完整 ' + invalid);
  }

  // 空宿主冷开失败不得生成可保存的目标文件绑定。
  const cold = app.workspace.getLeaf('tab');
  denyRead(unreadable);
  try { await cold.setViewState({ type: 'markdown', state: { file: unreadable.path } }); }
  finally { app.vault.cachedRead = originalRead; }
  check(cold.view.file === null, 'Markdown冷开失败不绑定未读文件');
  check(cold.view.contentEl.textContent.includes(unreadable.path), 'Markdown冷开失败显示目标路径');
  const savedCold = await persistedLeaf(cold.id);
  check(savedCold.state.state.file === unreadable.path, 'Markdown冷开失败保存布局保留重试目标路径');
  check(cold.view.getDisplayText().includes(unreadable.name), 'Markdown冷开错误标签保留目标文件名');
  check(await cold.view.save() !== false, 'Markdown冷开失败无目标可写');
  check((await app.vault.read(unreadable)).includes('Must survive'), 'Markdown冷开失败后原文完整');
  const restoredNote = app.workspace.getLeaf('tab');
  await restoredNote.setViewState(savedCold.state);
  check(restoredNote.view.file === unreadable && restoredNote.view.editor.getValue().includes('Must survive'), 'Markdown冷开失败后从磁盘布局恢复可重试');

  const coldCanvas = app.workspace.getLeaf('tab');
  // 旧实现已污染bad时恢复测试夹具，让冷开独立验证原始坏文件。
  if (await app.vault.read(bad) !== badText) await app.vault.modify(bad, badText);
  await coldCanvas.setViewState({ type: 'canvas', state: { file: bad.path } });
  check(coldCanvas.view.file === null, 'Canvas冷开坏JSON不绑定目标文件');
  check(coldCanvas.view.contentEl.textContent.includes(bad.path), 'Canvas冷开坏JSON显示目标路径');
  const savedColdCanvas = await persistedLeaf(coldCanvas.id);
  check(savedColdCanvas.state.state.file === bad.path, 'Canvas冷开失败保存布局保留重试目标路径');
  check(coldCanvas.view.getDisplayText().includes(bad.name), 'Canvas冷开错误标签保留目标文件名');
  await coldCanvas.view.save();
  check(await app.vault.read(bad) === badText, 'Canvas冷开坏JSON关闭前保存不改原文');
  await app.vault.modify(bad, JSON.stringify(goodData));
  const restoredCanvas = app.workspace.getLeaf('tab');
  await restoredCanvas.setViewState(savedColdCanvas.state);
  check(restoredCanvas.view.file === bad && restoredCanvas.view.nodes.get('keep')?.text === 'Canvas original', 'Canvas坏JSON修正后从磁盘布局恢复可重试');
  await coldCanvas.view.setState({ file: bad.path });
  check(coldCanvas.view.wrapperEl.isConnected, 'Canvas冷开失败恢复后画布正文重新挂载');
  if (failures.length) throw new Error('界面审计失败 ' + JSON.stringify({ count: checks.length, failures, foldSteps }));
  return { pass: true, count: checks.length, checks };
})()
