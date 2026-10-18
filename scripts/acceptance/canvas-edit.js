/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: canvas-edit 场景。覆盖文本卡片的内嵌 CM6 实时预览编辑器：挂载即出现 .cm-editor（无 textarea）、
 *        编辑器与 editorEl.value 句柄写正文 → 数据与画布 JSON 落盘、实时预览装饰（标题/加粗）、Escape 与 Mod+Enter 退出、
 *        单击已聚焦卡片进编辑（原版 hg）、未聚焦（blocker 路径）与聚焦未编辑（正文内）两条拖拽路径、
 *        只读画布不可写且切换只读立刻退出编辑、缩放断点卸载/重建编辑器、正文编辑进撤销栈、
 *        空卡片本地化占位、关闭视图释放编辑器实例与 DOM。
 *        活动编辑器（本批新增）：卡片聚焦/进入编辑时 workspace.getActiveEditor() 指向卡片宿主、
 *        editor:toggle-bold 命令包裹卡片选区、退出编辑后回落到中心笔记、笔记内 Mod+B 仍作用于笔记。
 *        仅由 run.mjs 在带标记的临时库执行，不做视觉验收。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const checks = [];
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const check = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  const until = async (predicate, label) => {
    for (let n = 0; n < 40; n++) { if (predicate()) { checks.push(label); return; } await wait(25); }
    throw new Error(label);
  };

  await app.commands.findCommand('canvas:new-file').callback();
  await wait(250);
  const view = app.workspace.activeLeaf.view;
  check(view.canvasRect.width > 0, '画布已测量尺寸');
  const file = view.file;

  // ---- 新建文本卡片：正文是 CM6 编辑器，不是 textarea ----
  view.cardMenuEl.children[0].click();
  await wait(300);
  const node = [...view.nodes.values()][0];
  check(!!node && node.getData().type === 'text', '卡片菜单建立文本节点');
  const content = node.contentEl;
  check(!!content.querySelector('.markdown-source-view.mod-cm6 .cm-editor'), '正文挂载 CM6 编辑器');
  check(content.querySelectorAll('textarea').length === 0, '正文不再使用 textarea');
  check(!content.querySelector('.markdown-preview-view'), '旧的 markdown 预览层已移除');
  check(!!node.editor && !!node.editor.cm && typeof node.editor.getValue === 'function', '节点持有 Editor 实例');
  check(node.editor.cm.contentDOM.getAttribute('contenteditable') === 'true', '新建卡片直接进入编辑态');
  check(getComputedStyle(node.contentBlockerEl).display === 'none', '编辑态 blocker 隐藏');
  check(document.activeElement === node.editor.cm.contentDOM, '编辑态编辑器获得焦点');

  // ---- 写入正文：数据、编辑器与画布 JSON ----
  node.editor.setValue('# 标题\n\n正文 **粗**');
  await wait(80);
  check(node.text.includes('正文 **粗**'), '编辑器官写同步到节点数据');
  check(node.editor.getValue() === node.text, '编辑器内容与节点数据一致');
  check(node.editorEl.value === node.text, '句柄读回正文');
  await wait(700);
  const saved = JSON.parse(await app.vault.read(file));
  check(saved.nodes.some((n) => (n.text || '').includes('正文 **粗**')), '正文写入画布 JSON');

  // ---- 实时预览装饰与画布内布局 ----
  node.moveAndResize({ x: node.x, y: node.y, width: 420, height: 300 });
  await wait(200);
  check(!!content.querySelector('.cm-editor .cm-line.HyperMD-header-1'), '实时预览渲染标题行');
  check(!!content.querySelector('.cm-editor .cm-strong'), '实时预览渲染加粗');
  check(node.sourceEl.hasClass('is-live-preview'), '正文挂 is-live-preview');
  check(getComputedStyle(node.sourceEl).getPropertyValue('--file-margins').trim() === '0', '正文不吃 file-margins');
  check(!node.sourceEl.hasClass('is-readable-line-width'), '正文不套行宽 class');
  check(getComputedStyle(node.sourceEl.querySelector('.cm-sizer')).maxWidth === 'none', '正文不设 700px 行宽上限');
  check(getComputedStyle(node.sourceEl.querySelector('.cm-editor > .cm-scroller')).flexDirection === 'column', '正文套用卡片内滚动布局');
  const editorRect = node.sourceEl.querySelector('.cm-editor').getBoundingClientRect();
  const nodeRect = node.nodeEl.getBoundingClientRect();
  check(editorRect.height > nodeRect.height * 0.9 && editorRect.width > nodeRect.width * 0.8, '编辑区铺满卡片');

  // ---- Escape 退出编辑：blocker 恢复、仍是渲染态 ----
  const key = (target, k, extra = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
  key(node.editorEl, 'Escape');
  await wait(150);
  check(!node.isEditing && !node.nodeEl.hasClass('is-editing'), 'Escape 退出编辑');
  check(node.editor.cm.contentDOM.getAttribute('contenteditable') === 'false', '退出编辑后正文不可写');
  check(getComputedStyle(node.contentBlockerEl).display !== 'none', '退出编辑后 blocker 恢复');
  check(!!content.querySelector('.cm-editor .cm-line.HyperMD-header-1'), '未编辑时仍是渲染态');
  check(node.editor.getValue().includes('标题') && node.text.includes('标题'), '退出编辑后正文留在编辑器与数据');

  // ---- 双击进入编辑 / Mod+Enter 退出 ----
  content.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  await wait(120);
  check(node.isEditing, '双击进入编辑');
  check(node.editor.cm.contentDOM.getAttribute('contenteditable') === 'true', '编辑态可写');
  key(node.editorEl, 'Enter', { metaKey: true });
  await wait(100);
  check(!node.isEditing && node.editor.cm.contentDOM.getAttribute('contenteditable') === 'false', 'Mod+Enter 退出编辑');

  // ---- 单击已聚焦卡片进编辑（原版 hg） ----
  view.selectOnly(node);
  await wait(80);
  check(node.nodeEl.hasClass('is-focused') && !node.isEditing, '聚焦但未编辑');
  check(getComputedStyle(node.contentBlockerEl).display === 'none', '聚焦时 blocker 让位');
  content.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  await wait(120);
  check(node.isEditing, '单击已聚焦卡片进入编辑');
  key(node.editorEl, 'Escape');
  await wait(100);

  // ---- 拖拽路径一：未聚焦卡片（blocker 承指针）----
  view.options.snapToGrid = false;
  view.options.snapToObjects = false;
  const rect = view.canvasRect;
  const pointer = (target, type, domPoint) => target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, isPrimary: true, pointerType: 'mouse', pointerId: 21, button: 0,
    buttons: type === 'pointerup' ? 0 : 1, clientX: domPoint.x + rect.cx, clientY: domPoint.y + rect.cy,
  }));
  const center = (dx = 0, dy = 0) => view.domFromPos({ x: node.x + node.width / 2 + dx, y: node.y + node.height / 2 + dy });
  view.deselectAll();
  await wait(80);
  let before = { x: node.x, y: node.y };
  pointer(node.contentBlockerEl, 'pointerdown', center());
  pointer(window, 'pointermove', center(90, 50));
  await wait(60);
  pointer(window, 'pointerup', center(90, 50));
  await wait(120);
  check(node.x > before.x && node.y > before.y, '未聚焦卡片经 blocker 可拖动');

  // ---- 拖拽路径二：聚焦未编辑卡片，从正文内拖动（指针守卫已放开编辑器）----
  view.selectOnly(node);
  await wait(80);
  before = { x: node.x, y: node.y };
  pointer(content.querySelector('.cm-content'), 'pointerdown', center());
  pointer(window, 'pointermove', center(-120, -60));
  await wait(60);
  pointer(window, 'pointerup', center(-120, -60));
  await wait(120);
  check(node.x < before.x && node.y < before.y, '聚焦未编辑时正文内也能拖动');
  await wait(700);
  const dragged = JSON.parse(await app.vault.read(file)).nodes.find((n) => n.id === node.id);
  check(dragged.x === node.x && dragged.y === node.y, '拖动结果写入画布 JSON');

  // ---- 只读画布 ----
  content.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  await wait(120);
  check(node.isEditing, '（前置）进入编辑态');
  view.setReadonly(true);
  await wait(100);
  check(!node.isEditing && !node.nodeEl.hasClass('is-editing'), '切只读立刻退出编辑');
  check(node.editor.cm.contentDOM.getAttribute('contenteditable') === 'false', '只读画布正文不可写');
  content.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  await wait(120);
  check(!node.isEditing, '只读画布双击不进入编辑');
  view.deselectAll();
  before = { x: node.x, y: node.y };
  pointer(node.contentBlockerEl, 'pointerdown', center());
  pointer(window, 'pointermove', center(80, 40));
  pointer(window, 'pointerup', center(80, 40));
  await wait(150);
  check(node.x === before.x && node.y === before.y, '只读画布不拖动卡片');
  view.setReadonly(false);
  await wait(80);

  // ---- 缩放断点：卸载正文与编辑器，放大回来重建 ----
  const editorBefore = node.editor;
  view.setViewport(view.x, view.y, -2.5);
  await wait(200);
  check(node.editor === null, '缩小到断点以下卸载编辑器');
  check(!node.contentEl.isConnected && node.isSmall === true, '正文脱离 DOM 并显示占位');
  check(node.text.includes('标题'), '卸载后正文留在数据里');
  view.setViewport(view.x, view.y, 0);
  await until(() => node.editor && node.editor !== editorBefore, '放大回来重建编辑器');
  check(node.editor.getValue().includes('标题'), '重建的编辑器带上正文');
  check(node.isSmall === false, '可读缩放重新挂载正文');

  // ---- 正文编辑进撤销栈 ----
  content.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  await wait(120);
  check(node.isEditing, '（前置）再次进入编辑态');
  const beforeUndo = node.text;
  node.editorEl.value = beforeUndo + '\n改过了';
  await wait(450);
  check(node.text.endsWith('改过了'), '二次编辑（句柄写入）同步到数据');
  check(view.history.canUndo(), '正文编辑推进撤销栈');
  view.undo();
  await wait(200);
  const undone = [...view.nodes.values()].find((n) => n.id === node.id);
  check(!!undone && undone.text === beforeUndo, '撤销恢复编辑前正文');
  check(!!undone.editor && undone.editor.getValue() === beforeUndo, '撤销同步到已挂载编辑器');
  view.redo();
  await wait(200);
  check([...view.nodes.values()].find((n) => n.id === node.id).text.endsWith('改过了'), '重做恢复编辑后正文');
  key(node.editorEl, 'Escape');
  await wait(100);

  // ---- 空卡片：本地化占位文案 ----
  const empty = view.createTextNode({ pos: { x: node.x + 900, y: node.y + 600 }, focus: false });
  await until(() => empty.editor && !empty.editor.getValue(), '空卡片挂载空编辑器');
  await wait(200);
  const placeholder = empty.contentEl.querySelector('.cm-placeholder');
  check(!!placeholder && /添加文字|Add text/.test(placeholder.textContent || ''), '空卡片显示本地化占位文案');

  // ---- 活动编辑器：卡片进入编辑即登记，命令作用卡片；退出后回落中心笔记 ----
  const note = await app.fileManager.createNewMarkdownFile(app.vault.getRoot(), 'Canvas Editor Target', 'target word');
  const noteLeaf = await app.workspace.openFile(note, { newLeaf: 'split' });
  app.workspace.setActiveLeaf(noteLeaf, { focus: true });
  await wait(200);
  const noteView = noteLeaf.view;
  check(app.workspace.activeLeaf === noteLeaf, '中心笔记开在新标签组并成为活动叶子');
  check(noteView.editor.getValue().includes('target'), '（前置）笔记正文已装入编辑器');
  check(app.workspace.getActiveEditor() === noteView, '无卡片登记时活动编辑器回落活动叶子视图');
  view.selectOnly(node);
  node.startEditing();
  await wait(150);
  check(node.isEditing, '（前置）卡片重新进入编辑态');
  check(app.workspace.activeLeaf === noteLeaf, '卡片聚焦不改变活动叶子');
  check(app.workspace.getActiveEditor() === node, '卡片聚焦后登记为活动编辑器');
  check(app.workspace.activeEditor === node, '原版属性形式 workspace.activeEditor 指向卡片');
  check(app.workspace.getActiveEditor().editor === node.editor, '登记宿主带编辑器与文件形状');
  check(app.workspace.getActiveEditor().file === view.file, '登记宿主的 file 是画布文件');
  check(app.workspace.getActiveEditor().containerEl === node.containerEl, '登记宿主带 containerEl');

  // ---- 卡片内编辑命令：editor:toggle-bold 包裹卡片选区（原版 activeEditor 语义）----
  node.editor.setSelection({ line: 0, ch: 2 }, { line: 0, ch: 4 });
  check(app.commands.executeCommandById('editor:toggle-bold') === true, 'Mod+B 命令在卡片内可用');
  await wait(150);
  check(node.text.startsWith('# **标题**'), '卡片正文被加粗包裹');
  check(node.editor.getValue().startsWith('# **标题**'), '包裹结果同步到卡片编辑器');
  // 真实按键路径：焦点在卡片编辑器内按 Mod+B 生效（选区落在标记内即还原）
  node.editor.setSelection({ line: 0, ch: 4 }, { line: 0, ch: 6 });
  key(node.editor.cm.contentDOM, 'b', { metaKey: true });
  await wait(150);
  check(node.text.startsWith('# 标题') && !node.text.includes('**标题**'), '卡片编辑器内 Mod+B 真实按键作用于卡片');

  // ---- 退出编辑：登记清空，回落中心笔记 ----
  key(node.editorEl, 'Escape');
  await wait(150);
  check(!node.isEditing, '（前置）Escape 退出卡片编辑');
  check(app.workspace.getActiveEditor() === noteView, '退出编辑后活动编辑器回落中心笔记');
  check(app.workspace.getActiveEditor().file.path === note.path, '回落对象带笔记文件');

  // ---- 中心笔记 Mod+B 仍作用于笔记（editor 场景回归）----
  noteView.editor.focus();
  noteView.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 6 });
  noteView.editor.cm.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', metaKey: true, bubbles: true, cancelable: true }));
  await wait(200);
  check(noteView.editor.getValue().startsWith('**target** '), '中心笔记 Mod+B 仍作用于笔记正文');
  app.workspace.setActiveLeaf(view.leaf, { focus: true });
  await wait(80);

  // ---- 关闭视图：销毁编辑器实例与 DOM ----
  const liveEditor = node.editor;
  const editorPrototype = Object.getPrototypeOf(liveEditor);
  const originalDestroy = editorPrototype.destroy;
  let destroyCalls = 0;
  editorPrototype.destroy = function patchedDestroy(...args) {
    destroyCalls += 1;
    return originalDestroy.apply(this, args);
  };
  await app.workspace.activeLeaf.setViewState({ type: 'empty', state: {} });
  await wait(250);
  editorPrototype.destroy = originalDestroy;
  check(destroyCalls >= 1, '关闭画布视图时销毁编辑器');
  check(node.editor === null && node.editorEl === null, '节点不再持有编辑器引用');
  check(app.workspace.getActiveEditor() === null, '关闭画布视图后清空活动编辑器登记');
  check(!node.nodeEl.isConnected, '节点 DOM 已卸载');
  check(!liveEditor.cm.dom.isConnected, '编辑器 DOM 已摘除');

  return { pass: true, checks, count: checks.length, file: file.path, editor: 'cm6-live-preview' };
})()
