/**
 * [INPUT]: OBS_ACT eval；主代理统一 build 后启动 Electron，使用临时测试库。
 * [OUTPUT]: 返回 {role, passed, checks, fixture}；失败抛出具名断言。
 * [POS]: 编辑器综合验收。vault-main 可复用，fixture 全部位于独立 acceptance 子目录。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 * OBS_ACT={action:'eval',js:fs.readFileSync('/tmp/obs-copy-acceptance/editor.js','utf8')}
 * 不 build、不启动或终止进程。设置值在 finally 恢复，fixture 留在测试库供复核。
 */
(async () => {
  const fs = require('fs'), path = require('path'), os = require('os');
  const root = fs.realpathSync(app.vault.adapter.getBasePath());
  const tempRoots = ['/tmp', os.tmpdir()].filter(p => fs.existsSync(p)).map(p => fs.realpathSync(p));
  if (!tempRoots.some(p => root.startsWith(p + path.sep)) ||
      !/(?:obs-copy|vault-main|vault-test)/.test(root)) {
    throw new Error('editor acceptance requires a temporary vault, including vault-main');
  }
  const checks = [];
  const assert = (value, label) => {
    if (!value) throw new Error('editor: ' + label);
    checks.push(label);
  };
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (predicate, label) => {
    const deadline = Date.now() + 7000;
    while (!(await predicate())) {
      if (Date.now() > deadline) throw new Error('editor timeout: ' + label);
      await delay(30);
    }
  };
  const settings = app.settings.appSettings;
  const keys = ['foldHeading', 'foldIndent', 'livePreview', 'showLineNumber', 'tabSize'];
  const saved = Object.fromEntries(keys.map(key => [key, settings[key]]));
  const previousLeaf = app.workspace.activeLeaf;
  const leaves = [];
  const fixture = 'acceptance/editor-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const visible = el => el && getComputedStyle(el).display !== 'none';
  const checkMode = (view, mode, label) => {
    assert(view.mode === mode, label + ': model');
    assert(view.editor.cm.dom.dataset.editorMode === mode, label + ': data-editor-mode');
    assert(visible(view.sourceEl) === (mode !== 'preview'), label + ': source visibility');
    assert(visible(view.readingEl) === (mode === 'preview'), label + ': reading visibility');
    assert(view.sourceEl.classList.contains('is-live-preview') ===
      (mode === 'live' && settings.livePreview !== false), label + ': live class');
  };
  const create = async (name, text) => app.vault.create(fixture + '/' + name + '.md', text);
  const openFresh = async (file, mode) => {
    const leaf = app.workspace.getLeaf('tab');
    leaves.push(leaf);
    // 首次 setViewState 只调用一次，覆盖启动恢复曾经遗漏的分支。
    await leaf.setViewState({ type: 'markdown', state: { file: file.path, mode } });
    app.workspace.revealLeaf(leaf);
    checkMode(leaf.view, mode, 'fresh ' + mode);
    return leaf.view;
  };
  const applySettings = async patch => {
    app.settings.updateAppSettings(patch);
    await delay(80);
  };
  const lineIndex = (editor, text) => editor.getValue().split('\n').findIndex(line => line === text);
  const foldAt = async (view, line) => {
    const number = lineIndex(view.editor, line);
    assert(number >= 0, 'fixture line: ' + line);
    view.editor.setSelection({ line: number, ch: 0 });
    view.editor.focus();
    app.commands.executeCommandById('editor:fold-more');
    await delay(70);
  };
  const placeholders = view => view.editor.cm.dom.querySelectorAll('.cm-foldPlaceholder').length;

  try {
    for (const leaf of app.workspace.getLeavesOfType('markdown')) {
      checkMode(leaf.view, leaf.view.mode, 'startup restored ' + leaf.id);
    }
    if (!app.vault.getAbstractFileByPath('acceptance')) await app.vault.createFolder('acceptance');
    await app.vault.createFolder(fixture);
    await applySettings({ foldHeading: true, foldIndent: true, livePreview: true, showLineNumber: false, tabSize: 4 });

    const foldText = [
      '- root', '\t- child', '', '- peer', '',
      '# Parent', 'parent body', '## Child', 'child body', '# End', 'tail', '',
    ].join('\n');
    const file = await create('folding', foldText);
    const view = await openFresh(file, 'source');
    await delay(100);
    const cm = view.editor.cm;
    assert(typeof view.editor.setFolding === 'function', 'setFolding exists');
    assert(cm.dom.querySelector('.cm-foldGutter'), 'fold gutter exists');
    assert(visible(cm.dom.querySelector('.cm-gutters')), 'gutter CSS is visible');
    await foldAt(view, '# Parent');
    assert(placeholders(view) === 1, 'heading collapses nested section');
    await foldAt(view, '- root');
    assert(placeholders(view) === 2, 'Tab indentation folds independently');
    await applySettings({ foldHeading: false });
    assert(placeholders(view) === 1, 'disable heading keeps indentation fold');
    await applySettings({ foldIndent: false });
    assert(placeholders(view) === 0, 'disable indentation unfolds immediately');
    assert(!cm.dom.querySelector('.cm-foldGutter'), 'both disabled remove folding gutter');
    await foldAt(view, '# Parent');
    assert(placeholders(view) === 0, 'disabled heading cannot fold through command');
    await applySettings({ foldHeading: false, foldIndent: true });
    await foldAt(view, '# Parent');
    assert(placeholders(view) === 0, 'indent-only does not enable headings');
    await foldAt(view, '- root');
    assert(placeholders(view) === 1, 'indent-only folds child');
    await applySettings({ foldHeading: true, foldIndent: false });
    assert(placeholders(view) === 0, 'heading-only clears indentation fold');
    await foldAt(view, '- root');
    assert(placeholders(view) === 0, 'heading-only cannot fold list indentation');
    await foldAt(view, '# Parent');
    assert(placeholders(view) === 1, 'heading re-enabled without reopening');
    await applySettings({ foldHeading: false, foldIndent: false, showLineNumber: true });
    assert(cm.dom.querySelector('.cm-lineNumbers') && visible(cm.dom.querySelector('.cm-gutters')), 'line numbers survive disabled folding');
    assert(cm === view.editor.cm && view.editor.getValue() === foldText, 'settings preserve editor instance and text');

    const setext = await create('setext', 'First\n=====\nbody\n\nSecond\n------\nchild\n\n# Last\ntail\n');
    await applySettings({ foldHeading: true, foldIndent: false });
    await view.setState({ file: setext.path, mode: 'source' });
    checkMode(view, 'source', 'different file source');
    await foldAt(view, 'First');
    assert(placeholders(view) === 1, 'Setext heading folds');
    await applySettings({ foldHeading: false });
    assert(placeholders(view) === 0, 'Setext heading unfolds on disable');

    const examples = [
      { lang: 'JS', code: 'const answer = 42;\nconsole.log("<tag>&\\\"safe\\\"");\n// comment\n', selector: '.token.keyword' },
      { lang: 'py', code: 'def greet(name):\n    return "Hello " + name\n', selector: '.token.keyword' },
      { lang: 'json', code: '{"answer": 42, "ready": true}\n', selector: '.token.number' },
      { lang: 'unknown-acceptance', code: '<img src=x onerror=alert(1)> & literal\n', selector: null },
      { lang: '', code: 'plain < & >\n', selector: null },
    ];
    const codeText = '# Code\n\n' + examples.map(example =>
      '```' + example.lang + '\n' + example.code + '```\n\n').join('') + '# End\n';
    const codesFile = await create('highlight', codeText);
    const preview = await openFresh(codesFile, 'preview');
    await wait(() => preview.readingEl.querySelectorAll('pre > code.is-loaded').length === examples.length, 'reading highlighters');
    const reading = Array.from(preview.readingEl.querySelectorAll('pre > code'));
    for (const [index, example] of examples.entries()) {
      assert(reading[index].textContent === example.code, 'reading text preserved: ' + (example.lang || 'plain'));
      assert(example.selector ? reading[index].querySelector(example.selector) : !reading[index].querySelector('.token'),
        'reading tokens: ' + (example.lang || 'plain'));
    }
    assert(!preview.readingEl.querySelector('code img'), 'code HTML remains inert');
    const readingColor = getComputedStyle(reading[0].querySelector('.token.keyword')).color;
    assert(readingColor !== getComputedStyle(reading[0]).color, 'reading token CSS has semantic color');
    const copyBtn = preview.readingEl.querySelector('pre > button.copy-code-button');
    assert(copyBtn && copyBtn.querySelector('svg'), 'reading copy button present');
    copyBtn.click();

    await preview.setState({ file: codesFile.path, mode: 'live' });
    preview.editor.setSelection(0);
    checkMode(preview, 'live', 'switch to live');
    const liveBlocks = () => Array.from(preview.editor.cm.dom.querySelectorAll('.lp-codeblock > code'));
    const scrollToCode = async index => {
      const text = '```' + examples[index].lang;
      const line = codeText.split('\n').findIndex((line, i, all) => line === text && all[i + 1] === examples[index].code.split('\n')[0]);
      preview.editor.scrollTo(line, 0);
      await wait(() => liveBlocks().some(code => code.textContent === examples[index].code && code.classList.contains('is-loaded')), 'live highlighter ' + index);
      return liveBlocks().find(code => code.textContent === examples[index].code);
    };
    for (const [index, example] of examples.entries()) {
      const code = await scrollToCode(index);
      assert(code.textContent === example.code, 'live text preserved: ' + (example.lang || 'plain'));
      assert(example.selector ? code.querySelector(example.selector) : !code.querySelector('.token'),
        'live tokens: ' + (example.lang || 'plain'));
      if (index === 0) assert(getComputedStyle(code.querySelector('.token.keyword')).color === readingColor, 'reading and live share token color');
      if (index === 0) {
        const flair = code.parentElement.querySelector('.code-block-flair');
        assert(flair && flair.textContent.trim().length > 0, 'live code block flair shows language');
        flair.click();
      }
    }
    const keywordLine = codeText.split('\n').findIndex(line => line === 'const answer = 42;');
    preview.editor.setSelection({ line: keywordLine, ch: 3 });
    await delay(100);
    assert(!liveBlocks().some(code => code.textContent === examples[0].code), 'cursor entering code reveals editable source');
    preview.editor.setSelection(0);
    await scrollToCode(0);
    assert(liveBlocks().some(code => code.querySelector('.token.keyword')), 'leaving code restores highlighted widget');
    const embedTarget = await create('embed-target', '# Embed Target\n\nEMBED_CONTENT_MARKER\n');
    const embedHost = await create('embed-host', '# Host\n\n![[embed-target]]\n');
    const embedView = await openFresh(embedHost, 'live');
    await wait(() => {
      const body = embedView.sourceEl.querySelector('.markdown-embed .markdown-preview-view');
      return body && body.textContent.includes('EMBED_CONTENT_MARKER');
    }, 'live note embed renders');
    assert(!!embedView.sourceEl.querySelector('.markdown-embed .markdown-embed-link svg'), 'live embed has open-link button');
    await embedView.setState({ file: embedHost.path, mode: 'preview' });
    await delay(250);
    assert(!!embedView.readingEl.querySelector('.markdown-embed'), 'reading note embed renders');
    await applySettings({ livePreview: false });
    assert(!preview.sourceEl.classList.contains('is-live-preview') && !preview.editor.cm.dom.querySelector('.lp-codeblock'), 'global live preview switch removes widgets');
    await applySettings({ livePreview: true });
    await scrollToCode(0);
    checkMode(preview, 'live', 'global live preview restored');

    // 多个新视图各只加载一次，覆盖 workspace 初次 source/preview 恢复。
    const freshSource = await openFresh(codesFile, 'source');
    assert(!freshSource.editor.cm.dom.querySelector('.lp-codeblock'), 'fresh source has no live widgets');
    const freshPreview = await openFresh(codesFile, 'preview');
    await wait(() => freshPreview.readingEl.querySelector('code .token.keyword'), 'fresh preview highlighted');
    checkMode(freshSource, 'source', 'source remains consistent while inactive');
    checkMode(freshPreview, 'preview', 'preview initial load complete');
    return { role: 'editor', passed: true, checks, fixture };
  } finally {
    app.settings.updateAppSettings(saved);
    for (const leaf of leaves) {
      await leaf.view.save?.();
      leaf.detach();
    }
    if (previousLeaf && app.workspace._leafMap.has(previousLeaf.id)) app.workspace.revealLeaf(previousLeaf);
  }
})()
