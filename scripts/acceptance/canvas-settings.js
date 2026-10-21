/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例；vault 内自建 Note.md、文件夹「画布」与一张带文件卡的白板。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: canvas-settings 场景：核心插件 canvas 的设置页签「白板设定」（原版 app.js 3431431 附近的 getSettingDefinitions）。
 *        覆盖：核心插件页齿轮入口 → 打开页签 → 八条设置项的名称/顺序/控件形态/默认值 → 改值落盘 .obsidian/canvas.json →
 *        打开中的画布视图立即生效（卡片标签可见性、缩放阈值、Mod 行为、滚轮行为）→ 新白板默认位置与文件夹 →
 *        关闭重开画布后仍读同一份配置。
 *        数值与文案逐条对照原版：缩放阈值 min=-0.7 max=2.4 step=0.01，显示格式 round(100*1.2^z)%；
 *        Mod 行为六项（menu/card/note/media/webpage/group）；卡片标签三项（always/hover/never）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const checks = [];
  const ok = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  const until = async (predicate, label) => {
    for (let n = 0; n < 120; n++) { if (predicate()) { checks.push(label); return; } await wait(25); }
    throw new Error(label);
  };
  const text = (el) => String((el && el.textContent) || '').trim();
  const rowsOf = (root) => [...root.querySelectorAll('.setting-items > .setting-item')];
  const nameOf = (row) => text(row.querySelector('.setting-item-name'));
  const descOf = (row) => text(row.querySelector('.setting-item-description'));
  const isMac = navigator.platform.startsWith('Mac') || navigator.userAgent.includes('Macintosh');
  /** 名称可以是中文或英文（验收机语言不确定）。 */
  const nameIs = (row, zh, en) => nameOf(row) === zh || nameOf(row) === en;
  const selectOf = (row) => row.querySelector('select.dropdown');
  const toggleOf = (row) => row.querySelector('input[type=checkbox]');
  /** 开关的开关态由 .checkbox-container.is-enabled 表达（core/setting.js 的 ToggleComponent 语义）。 */
  const toggleOn = (row) => !!row.querySelector('.checkbox-container.is-enabled');
  const sliderOf = (row) => row.querySelector('input[type=range].slider');
  const textOf = (row) => row.querySelector('input[type=text]');
  const optionsOf = (select) => [...select.options].map((o) => o.value);
  const labelOf = (select, value) => text([...select.options].find((o) => o.value === value));
  const setSelect = (select, value) => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const setToggle = (row, value) => {
    const input = toggleOf(row);
    if (toggleOn(row) === value) return;
    input.checked = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const canvasJson = () => {
    try { return app.settings.readJson('canvas.json') || {}; } catch (e) { return {}; }
  };

  /* ------------------------------------------------------------ 建库与白板 */
  await app.vault.create('Note.md', '# Note\n\n正文内容。\n');
  await app.vault.createFolder('画布');
  const data = {
    nodes: [{ id: 'f1', type: 'file', file: 'Note.md', x: 0, y: 0, width: 400, height: 400 }],
    edges: [],
  };
  const canvasFile = await app.vault.create('Settings.canvas', JSON.stringify(data));
  await app.workspace.openFile(canvasFile);
  await wait(700);
  const view = app.workspace.activeLeaf.view;
  ok(view.getViewType() === 'canvas', '白板视图已打开');
  const labelEl = () => view.nodes.get('f1').nodeEl.querySelector('.canvas-node-label');
  ok(!!labelEl(), '文件卡默认带卡片标签');
  ok(view.options.snapToGrid === true && view.options.snapToObjects === true,
    '画布视图读到默认选项（对齐网格/对齐物体开启）');

  /* ------------------------------------------------- A. 入口：核心插件页齿轮 */
  app.setting.open();
  await wait(150);
  const pluginsTab = app.setting.openTabById('plugins');
  await wait(150);
  ok(!!pluginsTab && app.setting.activeTab === pluginsTab, '核心插件页打开');
  const pluginRows = rowsOf(pluginsTab.containerEl);
  const canvasRow = pluginRows.find((row) => nameOf(row) === '白板' || nameOf(row) === 'Canvas');
  ok(!!canvasRow, '核心插件页有白板行');
  const gear = [...canvasRow.querySelectorAll('.extra-setting-button')].find((b) => b.querySelector('svg.lucide-settings'));
  ok(!!gear && gear.style.display !== 'none', '白板行的设置齿轮可见');
  gear.click();
  await wait(200);
  const tab = app.setting.activeTab;
  ok(!!tab && tab.id === 'canvas', '点击齿轮打开白板设置页签');
  const root = tab.containerEl;
  const group = root.querySelector('.setting-group');
  ok(!!group, '白板设定页有设置组');
  const heading = text(root.querySelector('.setting-item-heading .setting-item-name'));
  ok(heading === '白板设定' || heading === 'Canvas settings', '页签标题为白板设定');
  const rows = rowsOf(root);
  ok(rows.length === 8, '白板设定共八条设置项');

  /* ------------------------------------------------- B. 条目名称与顺序（原版） */
  ok(nameIs(rows[0], '新白板文件的默认位置', 'Default location for new canvas files'), '第一条：新白板文件的默认位置');
  ok(nameIs(rows[1], '用于创建新白板文件的文件夹', 'Folder to create new canvas files in'), '第二条：用于创建新白板文件的文件夹');
  ok(nameIs(rows[2], '默认鼠标滚轮行为', 'Default mouse wheel behavior'), '第三条：默认鼠标滚轮行为');
  ok(nameOf(rows[3]).indexOf('行为') !== -1 || nameOf(rows[3]).indexOf('behavior') !== -1, '第四条：默认 Mod 行为');
  ok(nameIs(rows[4], '显示卡片标签', 'Show card names'), '第五条：显示卡片标签');
  ok(nameIs(rows[5], '对齐网格', 'Snap to grid'), '第六条：对齐网格');
  ok(nameIs(rows[6], '对齐物体', 'Snap to objects'), '第七条：对齐物体');
  ok(nameIs(rows[7], '隐藏卡片内容的缩放阈值', 'Zoom threshold for hiding card content'), '第八条：隐藏卡片内容的缩放阈值');
  ok(descOf(rows[0]) === '', '新白板位置行没有说明文字（原版该行只有 name 与控件）');
  ok(descOf(rows[1]).length > 0, '新白板文件夹带说明文字');
  ok(descOf(rows[5]).length > 0, '对齐网格带说明文字');
  ok(descOf(rows[6]).length > 0, '对齐物体带说明文字');
  ok(descOf(rows[7]).length > 0, '缩放阈值带说明文字');

  /* ---------------------------------------------------- C. 控件形态与默认值 */
  const locationSelect = selectOf(rows[0]);
  ok(!!locationSelect, '新白板位置是下拉');
  ok(optionsOf(locationSelect).join('|') === 'root|current|folder', '新白板位置三项：root/current/folder');
  ok(locationSelect.value === 'root', '新白板位置默认 root（原版 defaultValue）');
  ok(labelOf(locationSelect, 'root') === '仓库的根目录' || labelOf(locationSelect, 'root') === 'Vault folder',
    '新白板位置 root 选项文案取自文件设置');
  const folderRow = rows[1];
  ok(!!textOf(folderRow), '新白板文件夹是文本框');
  ok(folderRow.style.display === 'none', '位置非 folder 时文件夹行隐藏（原版 visible 判定）');
  const wheelSelect = selectOf(rows[2]);
  ok(!!wheelSelect, '滚轮行为是下拉');
  ok(optionsOf(wheelSelect).join('|') === 'pan|zoom', '滚轮行为两项：pan/zoom');
  ok(wheelSelect.value === 'pan', '滚轮行为默认 pan');
  const modSelect = selectOf(rows[3]);
  ok(!!modSelect, 'Mod 行为是下拉');
  ok(optionsOf(modSelect).join('|') === 'menu|card|note|media|webpage|group', 'Mod 行为六项与原版一致');
  ok(modSelect.value === 'menu', 'Mod 行为默认 menu（原版 defaultModDragBehavior||menu）');
  ok(nameOf(rows[3]).indexOf(isMac ? '⌘' : 'Ctrl') !== -1, 'Mod 行为名称带平台修饰键');
  const labelSelect = selectOf(rows[4]);
  ok(!!labelSelect, '卡片标签是下拉');
  ok(optionsOf(labelSelect).join('|') === 'always|hover|never', '卡片标签三项：always/hover/never');
  ok(labelSelect.value === 'always', '卡片标签默认 always');
  const gridToggle = toggleOf(rows[5]);
  ok(!!gridToggle && toggleOn(rows[5]), '对齐网格是开关且默认开');
  const objectToggle = toggleOf(rows[6]);
  ok(!!objectToggle && toggleOn(rows[6]), '对齐物体是开关且默认开');
  const zoomSlider = sliderOf(rows[7]);
  ok(!!zoomSlider, '缩放阈值是滑杆');
  ok(parseFloat(zoomSlider.getAttribute('min')) === -0.7, '缩放阈值 min=-0.7');
  ok(parseFloat(zoomSlider.getAttribute('max')) === 2.4, '缩放阈值 max=2.4');
  ok(parseFloat(zoomSlider.getAttribute('step')) === 0.01, '缩放阈值 step=0.01');
  ok(parseFloat(zoomSlider.value) === 0, '缩放阈值默认 0');

  /* ------------------------------------------------ D. 改值 → 落盘 + 立即生效 */
  setSelect(labelSelect, 'never');
  await wait(120);
  ok(canvasJson().cardLabelVisibility === 'never', '卡片标签改 never 落盘 .obsidian/canvas.json');
  ok(view.options.cardLabelVisibility === 'never', '卡片标签改值立即灌进打开的画布视图');
  await until(() => !labelEl(), '卡片标签可见性立即生效（never 摘除标签）');
  setSelect(labelSelect, 'always');
  await wait(120);
  await until(() => !!labelEl(), '卡片标签可见性立即生效（always 恢复标签）');

  setToggle(rows[5], false);
  await wait(120);
  ok(canvasJson().snapToGrid === false, '对齐网格关掉后落盘');
  ok(view.options.snapToGrid === false, '对齐网格立即生效');
  setToggle(rows[5], true);
  await wait(120);
  ok(canvasJson().snapToGrid === true, '对齐网格开回来后落盘');

  setToggle(rows[6], false);
  await wait(120);
  ok(canvasJson().snapToObjects === false, '对齐物体关掉后落盘');
  ok(view.options.snapToObjects === false, '对齐物体立即生效');
  setToggle(rows[6], true);
  await wait(120);

  setSelect(wheelSelect, 'zoom');
  await wait(120);
  ok(canvasJson().defaultWheelBehavior === 'zoom', '滚轮行为改 zoom 落盘');
  ok(view.options.defaultWheelBehavior === 'zoom', '滚轮行为立即生效');
  const scaleBefore = view.scale;
  const rect = view.wrapperEl.getBoundingClientRect();
  view.wrapperEl.dispatchEvent(new WheelEvent('wheel', {
    bubbles: true, cancelable: true, clientX: rect.left + 12, clientY: rect.top + 12, deltaX: 0, deltaY: -120,
  }));
  await wait(320);
  ok(view.scale !== scaleBefore, '滚轮行为=zoom 时滚轮真的缩放');
  setSelect(wheelSelect, 'pan');
  await wait(120);

  setSelect(modSelect, 'card');
  await wait(120);
  ok(canvasJson().defaultModDragBehavior === 'card', 'Mod 行为改 card 落盘');
  ok(view.options.defaultModDragBehavior === 'card', 'Mod 行为立即生效');
  setSelect(modSelect, 'note');
  await wait(120);
  ok(canvasJson().defaultModDragBehavior === 'note', 'Mod 行为改 note 落盘');

  // 缩放阈值：原版显示格式 round(100 * 1.2^z)%
  zoomSlider.value = '1';
  zoomSlider.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(60);
  const tip = document.body.querySelector('.tooltip.mod-slider-tooltip');
  ok(!!tip && text(tip) === '120%', '缩放阈值提示按 round(100*1.2^z)% 显示（1 → 120%）');
  zoomSlider.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(120);
  ok(Math.abs((canvasJson().zoomBreakpoint || 0) - 1) < 0.001, '缩放阈值落盘 1');
  ok(Math.abs((view.options.zoomBreakpoint || 0) - 1) < 0.001, '缩放阈值立即灌进画布视图');
  ok(Math.abs(view.zoomBreakpoint - (-1.7 - 1)) < 0.001, '缩放阈值经 zoomBreakpoint 派生（原版 mee - option）');
  zoomSlider.value = '0';
  zoomSlider.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(60);
  const tip0 = document.body.querySelector('.tooltip.mod-slider-tooltip');
  ok(!!tip0 && text(tip0) === '100%', '缩放阈值 0 时提示为 100%');
  zoomSlider.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(120);
  ok(Math.abs((canvasJson().zoomBreakpoint || 0)) < 0.001, '缩放阈值复位为 0 并落盘');

  /* ------------------------------------------------- E. 新白板位置与文件夹 */
  setSelect(locationSelect, 'folder');
  await wait(120);
  ok(canvasJson().newFileLocation === 'folder', '新白板位置改 folder 落盘');
  ok(folderRow.style.display !== 'none', '位置为 folder 时文件夹行显示');
  const folderInput = textOf(folderRow);
  folderInput.value = '画布';
  folderInput.dispatchEvent(new Event('input', { bubbles: true }));
  folderInput.dispatchEvent(new Event('blur', { bubbles: true }));
  await wait(150);
  ok(canvasJson().newFileFolderPath === '画布', '新白板文件夹路径落盘');
  const newFileCmd = app.commands.findCommand('canvas:new-file');
  await newFileCmd.callback();
  await wait(700);
  const created = app.vault.getFiles().find((f) => f.extension === 'canvas' && f.path !== canvasFile.path);
  ok(!!created && created.path.startsWith('画布/'), '新白板按设定建在指定文件夹');
  if (created) await app.vault.delete(created, true);
  await wait(150);

  setSelect(locationSelect, 'current');
  await wait(120);
  ok(canvasJson().newFileLocation === 'current', '新白板位置改 current 落盘');
  await newFileCmd.callback();
  await wait(700);
  const createdCurrent = app.vault.getFiles().find((f) => f.extension === 'canvas' && f.path !== canvasFile.path);
  ok(!!createdCurrent && !createdCurrent.path.includes('/'), '新白板按 current 建在当前文件所在文件夹（根）');
  if (createdCurrent) await app.vault.delete(createdCurrent, true);
  await wait(150);

  setSelect(locationSelect, 'root');
  await wait(120);
  ok(folderRow.style.display === 'none', '位置回到 root 时文件夹行隐藏');
  await newFileCmd.callback();
  await wait(700);
  const createdRoot = app.vault.getFiles().find((f) => f.extension === 'canvas' && f.path !== canvasFile.path);
  ok(!!createdRoot && !createdRoot.path.includes('/'), '新白板按 root 建在仓库根');
  if (createdRoot) await app.vault.delete(createdRoot, true);
  await wait(150);

  /* ------------------------------------------- F. 关页重开：读同一份配置 */
  app.setting.close();
  await wait(200);
  setSelect(labelSelect, 'hover');
  await wait(120);
  const savedLabel = canvasJson().cardLabelVisibility;
  ok(savedLabel === 'hover', '卡片标签改 hover 落盘');
  await app.workspace.openFile(canvasFile);
  await wait(700);
  const view2 = app.workspace.activeLeaf.view;
  ok(view2.getViewType() === 'canvas', '重开白板视图');
  ok(view2.options.cardLabelVisibility === 'hover', '重开的画布视图读到同一份 .obsidian/canvas.json');
  const label2 = view2.nodes.get('f1').nodeEl.querySelector('.canvas-node-label');
  ok(!!label2 && label2.classList.contains('mod-hover-label'), '重开后卡片标签按 hover 呈现');

  app.setting.open();
  await wait(150);
  app.setting.openPluginOptions('canvas');
  await wait(200);
  const rows2 = rowsOf(app.setting.activeTab.containerEl);
  ok(rows2.length === 8, '重开白板设定页仍是八条');
  ok(selectOf(rows2[4]).value === 'hover', '重开白板设定页显示已保存的卡片标签值');
  ok(selectOf(rows2[2]).value === 'pan', '重开白板设定页显示已保存的滚轮行为值');
  ok(toggleOn(rows2[5]), '重开白板设定页显示已保存的对齐网格值');
  app.setting.close();
  await wait(150);

  await app.saveLayout();
  return { pass: true, checks, count: checks.length, options: canvasJson() };
})()
