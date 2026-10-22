/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回 {pass,count,checks} 断言回执；失败抛出异常。
 * [POS]: download-attachments 场景。仅由 run.mjs 在带标记的临时库执行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/**
 * download-attachments 角色 OBS_ACT eval 验收。
 * 仅允许 /tmp 或系统临时目录中含 obs-copy-acceptance 的独立库。
 * 覆盖：命令注册与 checkCallback 门控（md 可用；txt / 非 md 活动文件不可用）、画廊模态结构与命名、
 * 取消不落盘、部分勾选只下载勾选项、字节完整性、嵌入与 frontmatter 改写、Notice 计数、
 * 无附件笔记的提示路径。stub app.requestUrl，不访问真实网络。
 * 本脚本不 build、不启动/终止进程、不访问真实 Obsidian 数据。
 */
(async () => {
  const fs = require('fs'), path = require('path'), os = require('os');
  const vaultRoot = fs.realpathSync(app.vault.adapter.getBasePath());
  const tempRoots = ['/tmp', os.tmpdir()].filter((p) => fs.existsSync(p)).map((p) => fs.realpathSync(p));
  if (!tempRoots.some((p) => vaultRoot.startsWith(p + path.sep)) || !/obs-copy-acceptance/.test(vaultRoot)) {
    throw new Error('download-attachments acceptance requires an isolated temporary vault: ' + vaultRoot);
  }
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (name, predicate) => {
    for (let i = 0; i < 100; i += 1) { if (await predicate()) return; await pause(50); }
    const seen = [...document.querySelectorAll('.notice-message')].map((el) => el.textContent).join(' | ');
    const counts = 'containers=' + document.querySelectorAll('.modal-container').length + ' open=' + document.querySelectorAll('.modal-container.is-open').length + ' galleries=' + document.querySelectorAll('.attachments-gallery').length + ' items=' + document.querySelectorAll('.download-attachment-item').length;
    throw new Error('Timed out: ' + name + ' [' + counts + ']' + (seen ? ' (notices: ' + seen + ')' : ''));
  };
  const results = [];
  const assert = (name, condition) => {
    if (!condition) throw new Error('Assertion failed: ' + name);
    results.push(name);
  };
  const ID = 'editor:download-attachments';
  const DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';
  const PNG_BYTES = [137, 80, 78, 71, 13, 10, 26, 10]; // iVBORw0KGgo= 解码结果
  const REMOTE_BYTES = [1, 2, 3, 4];
  const openFile = async (file) => {
    await app.workspace.openFile(file, { eState: { mode: 'source' } });
    await pause(60);
  };
  const modalEl = () => document.querySelector('.modal-container.is-open .modal');
  const galleryItems = () => [...document.querySelectorAll('.modal-container.is-open .attachments-gallery .download-attachment-item')];
  const itemNames = () => galleryItems().map((item) => item.querySelector('.download-attachment-name').textContent);
  const notices = () => [...document.querySelectorAll('.notice-message')].map((el) => el.textContent);
  const clearNotices = () => { for (const el of [...document.querySelectorAll('.notice-container')]) el.remove(); };
  const bytesOf = async (file) => new Uint8Array(await app.vault.readBinary(file));
  const equals = (bytes, expected) => bytes.length === expected.length && expected.every((value, i) => bytes[i] === value);

  // --- fixture -------------------------------------------------------------
  const dlSource = [
    '---',
    'title: Download fixture',
    'cover: https://example.com/cover.jpg',
    '---',
    'BEFORE',
    '![tiny](' + DATA_URL + ')',
    'MIDDLE',
    '![alt](https://example.com/photo.png)',
    'AFTER',
  ].join('\n');
  const plainSource = '# Plain\n\nno external attachments here\n';
  const dl = await app.vault.create('DL.md', dlSource);
  const plain = await app.vault.create('Plain.md', plainSource);
  const txt = await app.vault.create('note.txt', 'plain text');
  const pic = await app.vault.createBinary('pic.png', new Uint8Array([9, 9, 9]));
  let calls = 0;
  const requested = [];
  app.requestUrl = async ({ url }) => {
    calls += 1;
    requested.push(url);
    return { status: 200, headers: { 'content-type': 'image/png' }, body: new Uint8Array(REMOTE_BYTES).buffer };
  };

  // --- 命令门控 -------------------------------------------------------------
  const command = app.commands.findCommand(ID);
  assert('command registered', !!command);
  await openFile(dl);
  assert('active file is DL.md', app.workspace.getActiveFile()?.path === 'DL.md');
  assert('checkCallback available for md', command.checkCallback(true) === true);
  await openFile(txt);
  assert('no active file for txt view', app.workspace.getActiveFile() === null);
  assert('checkCallback unavailable for txt', command.checkCallback(true) === false);
  assert('execute refused for txt', app.commands.executeCommandById(ID) === false);
  await openFile(pic);
  assert('active file becomes non-md image', app.workspace.getActiveFile()?.path === 'pic.png');
  assert('checkCallback unavailable for non-md active file', command.checkCallback(true) === false);

  // --- run 1：模态结构与取消 -------------------------------------------------
  await openFile(dl);
  assert('execute returns true for md', app.commands.executeCommandById(ID) === true);
  await waitFor('download modal', () => !!modalEl() && galleryItems().length > 0);
  const modal = modalEl();
  assert('modal title', /下载附件|Download attachments/i.test(modal.querySelector('.modal-title').textContent));
  assert('modal is mod-scrollable-content', modal.classList.contains('mod-scrollable-content'));
  const items = galleryItems();
  assert('gallery lists three attachments', items.length === 3);
  assert('items checked by default', items.every((item) => item.classList.contains('is-selected') && item.querySelector('input[type=checkbox]').checked));
  const names = itemNames();
  assert('gallery names', names.includes('Image.png') && names.includes('photo.png') && names.includes('cover.jpg'));
  assert('no fetch before confirm', calls === 0);
  modal.querySelector('.modal-close-button').click();
  await waitFor('modal closed', () => !modalEl());
  await pause(120);
  assert('cancel creates no attachments', !app.vault.getFileByPath('Image.png') && !app.vault.getFileByPath('photo.png') && !app.vault.getFileByPath('cover.jpg'));
  assert('cancel keeps note text', (await app.vault.read(dl)) === dlSource);

  // --- run 2：部分勾选 -------------------------------------------------------
  assert('execute after cancel', app.commands.executeCommandById(ID) === true);
  await waitFor('modal reopened', () => galleryItems().length === 3);
  const photoItem = galleryItems().find((item) => item.querySelector('.download-attachment-name').textContent === 'photo.png');
  photoItem.querySelector('input[type=checkbox]').click();
  assert('unchecked item marked', !photoItem.classList.contains('is-selected') && !photoItem.querySelector('input[type=checkbox]').checked);
  const confirmBtn = document.querySelector('.modal-container.is-open .modal-button-container .mod-cta');
  assert('confirm button labelled download', !!confirmBtn && /下载|Download/i.test(confirmBtn.textContent));
  confirmBtn.click();
  await waitFor('downloads written', () => !!app.vault.getFileByPath('Image.png') && !!app.vault.getFileByPath('cover.jpg'));
  await waitFor('modal closed after download', () => !modalEl());
  assert('remote fetch only for checked url', calls === 1 && requested[0] === 'https://example.com/cover.jpg');
  assert('unchecked attachment not downloaded', !app.vault.getFileByPath('photo.png'));
  assert('data url bytes saved', equals(await bytesOf(app.vault.getFileByPath('Image.png')), PNG_BYTES));
  assert('remote bytes saved', equals(await bytesOf(app.vault.getFileByPath('cover.jpg')), REMOTE_BYTES));

  // --- 笔记改写 -------------------------------------------------------------
  const dlText = await app.vault.read(dl);
  assert('embed replaced with internal link', dlText.split('\n').includes('![[Image.png|tiny]]'));
  assert('unchecked embed left untouched', dlText.includes('![alt](https://example.com/photo.png)'));
  assert('data url removed from note', !dlText.includes('data:image/png'));
  assert('frontmatter value linked', /cover:.*\[\[cover\.jpg\]\]/.test(dlText));
  assert('other frontmatter keys kept', dlText.includes('title: Download fixture'));
  assert('surrounding text kept', dlText.includes('BEFORE') && dlText.includes('MIDDLE') && dlText.includes('AFTER'));
  assert('download notice count', notices().some((text) => /已下载.*2|Downloaded 2/.test(text)));

  // --- 无附件笔记 ------------------------------------------------------------
  clearNotices();
  await openFile(plain);
  assert('execute on plain note', app.commands.executeCommandById(ID) === true);
  await pause(250);
  assert('plain note shows no gallery', galleryItems().length === 0 && !modalEl());
  assert('plain note notice', notices().some((text) => /不存在外部附件|no external attachments/i.test(text)));
  assert('plain note untouched', (await app.vault.read(plain)) === plainSource);
  delete app.requestUrl;

  return { pass: true, status: 'PASS', count: results.length, checks: results, assertions: results, vault: vaultRoot };
})()
