/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回 {pass,count,checks} 断言回执；失败抛出异常。
 * [POS]: notes 场景。仅由 run.mjs 在带标记的临时库执行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/**
 * notes 角色 OBS_ACT eval 验收。
 * 仅允许 /tmp 或系统临时目录中含 obs-copy-acceptance / vault-test / vault-main 的独立库。
 * 首次运行创建 Notes-Acceptance-<时间戳>，落盘 manifest.json/result.json；不删除 fixture。
 * 阶段由 OBS_NOTES_STAGE 指定：run（默认）/ reload / daily-notes / templates /
 * note-composer / zk-prefixer / template-picker / extract-heading / result。
 * 截图阶段不再创建 fixture，复用 .obsidian/notes-acceptance-manifest.json。
 * 主代理先统一 build；本脚本不 build、不启动/终止进程、不访问真实 Obsidian 数据。
 */
(async () => {
  const fs = require('fs'), path = require('path'), os = require('os'), moment = require('moment');
  const vaultRoot = fs.realpathSync(app.vault.adapter.getBasePath());
  const tempRoots = ['/tmp', os.tmpdir()].filter(p => fs.existsSync(p)).map(p => fs.realpathSync(p));
  if (!tempRoots.some(p => vaultRoot.startsWith(p + path.sep)) ||
      !/obs-copy-acceptance|vault-test|vault-main/.test(vaultRoot)) {
    throw new Error('notes acceptance requires an isolated temporary vault: ' + vaultRoot);
  }
  const stage = process.env.OBS_NOTES_STAGE || 'run';
  const manifestFile = '.obsidian/notes-acceptance-manifest.json';
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async (name, predicate) => {
    for (let i = 0; i < 100; i++) { if (await predicate()) return; await pause(50); }
    throw new Error('Timed out: ' + name);
  };
  const results = [];
  const assert = (name, condition) => {
    if (!condition) throw new Error('Assertion failed: ' + name);
    results.push(name);
  };
  const instance = id => app.plugins.getInternalPlugin(id)?.instance;
  const enable = async id => {
    if (!app.plugins.getInternalPlugin(id)?.enabled) await app.plugins.enableInternalPlugin(id);
    assert(id + ' enabled', !!instance(id));
    return instance(id);
  };
  const openFile = async file => {
    app.setting.close();
    await app.workspace.openFile(file, { eState: { mode: 'source' } });
    const view = app.workspace.getActiveViewOfType('markdown');
    assert('open markdown ' + file.path, view?.file?.path === file.path && !!view.editor);
    return view;
  };
  const openSettings = id => {
    app.setting.open(); app.setting.openPluginOptions(id);
    const tab = app.setting.activeTab;
    assert('settings tab ' + id, tab?.id === id);
    return tab.containerEl;
  };
  const input = (root, index, value) => {
    const element = root.querySelectorAll('input[type=text]')[index];
    assert('text control ' + index, !!element);
    element.value = value; element.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const execute = id => assert('command ' + id, app.commands.executeCommandById(id) === true);
  const queryPrompt = async (name, query) => {
    await waitFor(name, () => [...document.querySelectorAll('.prompt-input')].find(el=>el.getBoundingClientRect().height>0));
    const field = [...document.querySelectorAll('.prompt-input')].find(el=>el.getBoundingClientRect().height>0);
    field.value = query; field.dispatchEvent(new Event('input', { bubbles: true }));
    return field;
  };
  const choose = async (query, modifiers = {}) => {
    const field = await queryPrompt('prompt ' + query, query);
    await pause(30);
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...modifiers }));
  };
  let manifest = null;
  if (await app.vault.adapter.exists(manifestFile)) manifest = JSON.parse(await app.vault.adapter.read(manifestFile));
  if (stage !== 'run') {
    if (!manifest) throw new Error('Run notes.js with OBS_NOTES_STAGE=run first.');
    for (const id of ['daily-notes','templates','note-composer','random-note','zk-prefixer']) await enable(id);
    if (stage === 'reload') {
      for (const [id, expected] of Object.entries(manifest.options)) {
        for (const [key, value] of Object.entries(expected)) assert('reload ' + id + '.' + key, instance(id).getOptions()[key] === value);
      }
      for (const file of manifest.files) assert('fixture persisted ' + file, !!app.vault.getFileByPath(file));
      assert('extracted data persisted', (await app.vault.read(app.vault.getFileByPath(manifest.extracted))).includes('EXTRACT-ME'));
      assert('merged data persisted', (await app.vault.read(app.vault.getFileByPath(manifest.target))).includes('UNSAVED-MERGE'));
      assert('local trash persisted', await app.vault.adapter.exists(manifest.trash));
      openSettings('daily-notes');
    } else if (['daily-notes','templates','note-composer','zk-prefixer'].includes(stage)) openSettings(stage);
    else if (stage === 'template-picker') {
      await openFile(app.vault.getFileByPath(manifest.source)); execute('insert-template');
      await queryPrompt('template picker', '');
    } else if (stage === 'extract-heading') {
      const view = await openFile(app.vault.getFileByPath(manifest.heading));
      const line = view.editor.getValue().split('\n').findIndex(text => /^#{1,6}\s/.test(text));
      assert('heading fixture has a heading', line >= 0);
      view.editor.setSelection({ line, ch: 0 }); execute('note-composer:extract-heading');
      await waitFor('heading extraction prompt', () => [...document.querySelectorAll('.prompt-input')].find(el=>el.getBoundingClientRect().height>0));
    } else if (stage === 'result') await openFile(app.vault.getFileByPath(manifest.target));
    else throw new Error('Unknown notes acceptance stage: ' + stage);
    return { pass: true, status: 'PASS', stage, count: results.length, checks: results, assertions: results, fixture: manifest.base };
  }
  const ids = ['daily-notes','templates','note-composer','random-note','zk-prefixer'];
  for (const id of ids) await enable(id);
  app.settings.updateAppSettings({ newFileLocation: 'current', useMarkdownLinks: false });
  const base = 'Notes-Acceptance-' + Date.now();
  const folder = async name => app.vault.createFolder(base + (name ? '/' + name : ''));
  await folder(''); for (const name of ['Templates','Daily','Unique','Excluded']) await folder(name);
  const create = async (name, text) => {
    const file = await app.vault.create(base + '/' + name, text);
    await app.metadataCache.parseFile(file); return file;
  };
  const template = await create('Templates/Variables.md', '# {{title}}\n{{date:YYYY}} {{time:HH:mm}}');
  const propertyTemplate = await create('Templates/Properties.md', '---\ntags: [added, shared]\nkind: template\n---\n{{title}}|{{date}}|{{time}}');
  const badTemplate = await create('Templates/Invalid.md', '---\nbroken: [\n---\nBAD');
  const composerTemplate = await create('Templates/Composer.md', '{{fromTitle}} → {{newTitle}}\n{{CONTENT}}');
  const source = await create('Source.md', '');
  const heading = await create('Heading.md', '# Section\nBODY\n\n## Child\nCHILD\n\n# Next\nKEEP');
  const target = await create('MergeTarget.md', '---\ntags: [target]\n---\nTARGET');
  await create('Excluded/Hidden.md', 'EXCLUDE');
  const random = await create('RandomEligible.md', 'RANDOM');
  app.metadataCache.rebuildIndices();
  let ui = openSettings('daily-notes');
  input(ui, 0, 'YYYY/MM/DD'); input(ui, 1, base + '/Daily'); input(ui, 2, template.path);
  assert('daily setting immediate', instance('daily-notes').getFormat() === 'YYYY/MM/DD');
  ui = openSettings('templates');
  input(ui, 0, base + '/Templates'); input(ui, 1, '[DATE]'); input(ui, 2, '[TIME]');
  assert('template setting immediate', instance('templates').getOptions().dateFormat === '[DATE]');
  ui = openSettings('note-composer');
  const toggle = ui.querySelector('.checkbox-container');
  assert('merge confirm toggle', !!toggle);
  if (toggle.classList.contains('is-enabled')) toggle.click();
  const select = ui.querySelector('select'); select.value = 'embed'; select.dispatchEvent(new Event('change', { bubbles: true }));
  input(ui, 0, composerTemplate.path);
  assert('composer settings immediate', instance('note-composer').getOptions().replacementText === 'embed' && !instance('note-composer').getOptions().askBeforeMerging);
  ui = openSettings('zk-prefixer');
  input(ui, 0, base + '/Unique'); input(ui, 1, template.path); input(ui, 2, 'YYYY.MM.DD.HHmm');
  assert('unique preview immediate', ui.querySelector('.u-pop')?.textContent === moment().format('YYYY.MM.DD.HHmm'));
  app.setting.close();
  const dailyPath = instance('daily-notes').getDailyNotePath(); execute('daily-notes');
  await waitFor('today daily note', () => app.workspace.getActiveFile()?.path === dailyPath);
  const today = app.vault.getFileByPath(dailyPath);
  assert('daily template replaced', (await app.vault.read(today)).startsWith('# ' + moment().format('YYYY/MM/DD')));
  const pair = await Promise.all([instance('daily-notes').getDailyNote(), instance('daily-notes').getDailyNote()]);
  assert('one daily for concurrent requests', pair[0].path === today.path && pair[1].path === today.path);
  const previous = await instance('daily-notes').getDailyNote(moment().subtract(1, 'day'));
  execute('daily-notes:goto-prev'); await waitFor('previous daily', () => app.workspace.getActiveFile()?.path === previous.path);
  execute('daily-notes:goto-next'); await waitFor('next daily', () => app.workspace.getActiveFile()?.path === today.path);
  let view = await openFile(source), editor = view.editor;
  editor.setValue('---\ntags: [old, shared]\nkeep: yes\n---\nBODY:'); editor.setSelection(editor.getValue().length);
  execute('insert-template'); await choose('Properties');
  await waitFor('template text inserted', () => editor.getValue().includes('Source|DATE|TIME'));
  assert('template properties retained and merged', editor.getValue().includes('keep:') && editor.getValue().includes('added') && editor.getValue().includes('old'));
  editor.setSelection(editor.getValue().length); execute('insert-current-date'); execute('insert-current-time');
  assert('date time command cursor', editor.getValue().endsWith('DATETIME') && editor.posToOffset(editor.getCursor('head')) === editor.getValue().length);
  await view.save();
  const beforeInvalid = editor.getValue(); await instance('templates').insertTemplate(badTemplate, editor, source);
  assert('invalid template no mutation', editor.getValue() === beforeInvalid);
  editor.setValue('EXTRACT-ME\nKEEP'); editor.setSelection(0, 10);
  execute('note-composer:split-file'); await choose('Extracted', { metaKey: true });
  const extractedPath = base + '/Extracted.md';
  await waitFor('extracted file and source replacement', () => !!app.vault.getFileByPath(extractedPath) && editor.getValue().startsWith('![['));
  await view.save();
  const extracted = app.vault.getFileByPath(extractedPath), extractedText = await app.vault.read(extracted);
  assert('composer template once', extractedText.includes('Source → Extracted') && extractedText.split('EXTRACT-ME').length === 2);
  assert('source replacement persisted', (await app.vault.read(source)).startsWith('![['));
  view = await openFile(heading); editor = view.editor;
  editor.setValue('# Fresh\nNEW-HEADING\n\n# Next\nKEEP'); editor.setSelection(0);
  execute('note-composer:extract-heading'); await choose('FreshExtracted', { metaKey: true });
  await waitFor('fresh heading extraction', () => editor.getValue().includes('FreshExtracted'));
  assert('heading uses unsaved editor', (await app.vault.read(app.vault.getFileByPath(base + '/FreshExtracted.md'))).includes('NEW-HEADING'));
  await view.save();
  const mergeSource = await create('MergeSource.md', 'DISK-OLD');
  const backlink = await create('Backlink.md', '[[MergeSource|alias]] [label](MergeSource.md)'); app.metadataCache.rebuildIndices();
  app.settings.updateAppSettings({ trashOption: 'local' });
  view = await openFile(mergeSource); view.editor.setValue('---\ntags: [source]\n---\nUNSAVED-MERGE');
  ui = openSettings('note-composer'); input(ui, 0, ''); app.setting.close();
  execute('note-composer:merge-file'); await choose('MergeTarget');
  await waitFor('merged source removed', () => !app.vault.getFileByPath(mergeSource.path));
  assert('merged unsaved text', (await app.vault.read(target)).includes('UNSAVED-MERGE'));
  assert('backlinks redirected', (await app.vault.read(backlink)).includes('[[MergeTarget|alias]]'));
  assert('target editor remains attached after merge', !!app.workspace.getActiveViewOfType('markdown')?.editor.cm.dom.isConnected);
  const trashList = await app.vault.adapter.list('.trash');
  const trash = trashList.files.filter(file => /\/MergeSource(?: \d+)?\.md$/.test(file)).pop(); assert('local trash backup', (await app.vault.adapter.read(trash)).includes('UNSAVED-MERGE'));
  execute('zk-prefixer'); await waitFor('unique command created note', () => app.workspace.getActiveFile()?.path.startsWith(base + '/Unique/'));
  const firstUnique = app.workspace.getActiveFile();
  const unique = await Promise.all([instance('zk-prefixer').onCreateNote(), instance('zk-prefixer').onCreateNote()]);
  assert('three unique markdown filenames', new Set([firstUnique.path, ...unique.map(file => file.path)]).size === 3 && unique.every(file => file.extension === 'md'));
  assert('unique template', (await app.vault.read(firstUnique)).startsWith('# ' + firstUnique.basename));
  view = await openFile(source); view.editor.setSelection(view.editor.getValue().length); execute('insert-unique-link');
  assert('unique link inserted', /\[\[\d{4}\.\d{2}\.\d{2}\.\d{4}\]\]$/.test(view.editor.getValue())); await view.save();
  const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  app.settings.updateAppSettings({ userIgnoreFilters: ['/^' + escape(base + '/Excluded/').replaceAll('/', '\\/') + '/', '/^(?!' + escape(random.path).replaceAll('/', '\\/') + '$)/', '/[/'] });
  execute('random-note'); await waitFor('random excludes all but eligible', () => app.workspace.getActiveFile()?.path === random.path);
  app.settings.updateAppSettings({ userIgnoreFilters: ['/.*/'] }); execute('random-note'); await pause(100);
  assert('all excluded keeps active file', app.workspace.getActiveFile()?.path === random.path);
  app.settings.updateAppSettings({ userIgnoreFilters: [base + '/Excluded/'] });
  const options = Object.fromEntries(ids.filter(id => id !== 'random-note').map(id => [id, { ...instance(id).getOptions() }]));
  for (const [id, expected] of Object.entries(options)) {
    const disk = JSON.parse(await app.vault.adapter.read('.obsidian/' + id + '.json'));
    for (const key of Object.keys(expected)) assert('settings saved ' + id + '.' + key, disk[key] === expected[key]);
  }
  manifest = { base, source: source.path, heading: heading.path, target: target.path, extracted: extracted.path, trash, options,
    files: [source.path, heading.path, target.path, today.path, previous.path, firstUnique.path, ...unique.map(file => file.path), extracted.path] };
  await app.vault.adapter.write(manifestFile, JSON.stringify(manifest, null, 2));
  const report = { pass: true, status: 'PASS', stage, count: results.length, checks: results, assertions: results, fixture: base,
    settings: Object.keys(options), screenshotStages: ['daily-notes','templates','note-composer','zk-prefixer','template-picker','extract-heading','result'] };
  // 默认留在设置页供 OBS_SCREENSHOT 捕获；其余截图阶段复用 manifest。
  openSettings('zk-prefixer');
  report.count = results.length;
  await app.vault.adapter.write('.obsidian/notes-acceptance-result.json', JSON.stringify(report, null, 2));
  return report;
})()
