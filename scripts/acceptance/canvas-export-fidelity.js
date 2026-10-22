/**
 * [INPUT]: 临时库、真实画布 PNG 导出、DOM 文本位置与图片卡片。
 * [OUTPUT]: {pass,count,checks}；验证尺寸/预算、弹层视口提交、隐私裁切和叠层 PNG 像素。
 * [POS]: 画布导出保真验收；不弹保存框，PNG 截图仅为用户导出功能内部实现。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const checks = [];
  const check = (value, message) => { if (!value) throw Error(message); checks.push(message); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (fn, message) => { for (let i = 0; i < 200; i++) { if (await fn()) return; await wait(25); } throw Error(message); };
  const fs = require('fs');
  const { ipcRenderer } = require('electron');
  await app.commands.findCommand('canvas:new-file').callback();
  const canvas = app.workspace.activeLeaf.view;
  const text = canvas.createTextNode({ pos: { x: 0, y: 0 }, size: { width: 5000, height: 180 }, text: 'Secret alpha\n\nSecond line', focus: false, save: false });
  const imageFile = await app.vault.create('VisibleImage.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><rect width="30" height="30" fill="#00ee22"/></svg>');
  canvas.createFileNode({ pos: { x: 600, y: 20 }, size: { width: 100, height: 100 }, file: imageFile, focus: false, save: false });
  canvas.deselectAll(); canvas.zoomToFit(); canvas.finishViewportAnimation = true;
  await until(() => !canvas.viewportChanged, '画布视口收敛');
  const decode = async source => {
    const image = new Image(); image.src = source; await image.decode();
    const node = document.createElement('canvas'); node.width = image.width; node.height = image.height;
    const ctx = node.getContext('2d'); ctx.drawImage(image, 0, 0);
    return { width: image.width, height: image.height, pixels: ctx.getImageData(0, 0, image.width, image.height).data };
  };
  const count = (image, predicate, box = { x: 0, y: 0, width: image.width, height: image.height }) => {
    let found = 0;
    for (let y = box.y; y < Math.min(image.height, box.y + box.height); y++) for (let x = box.x; x < Math.min(image.width, box.x + box.width); x++) {
      const offset = (y * image.width + x) * 4;
      if (predicate(image.pixels[offset], image.pixels[offset + 1], image.pixels[offset + 2], image.pixels[offset + 3])) found++;
    }
    return found;
  };
  const normalPath = app.vaultPath + '/Wide.png';
  canvas.promptImageSavePath = () => ({ canceled: false, filePath: normalPath });
  const normalResult = await canvas.generateHDImage({ frame: 'full', scale: 1, pixelRatio: 1, showLogo: false });
  check(normalResult.width === 5200 && normalResult.height === 380, '真实导出长边超过 4096，保留世界尺寸与边距');
  check(normalResult.tiles > 1, '大图使用整窗分块');
  const normal = await decode('data:image/png;base64,' + fs.readFileSync(normalPath).toString('base64'));
  const green = (r, g, b) => g > 180 && r < 50 && b < 90;
  check(count(normal, green) > 500, '普通导出包含真实媒体像素');
  const privatePath = app.vaultPath + '/PrivateWide.png';
  canvas.promptImageSavePath = () => ({ canceled: false, filePath: privatePath });
  const before = { transform: canvas.canvasEl.style.transform, style: canvas.wrapperEl.getAttribute('style'), text: text.text, mounted: text.isContentMounted };
  const privateResult = await canvas.generateHDImage({ frame: 'full', scale: 1, pixelRatio: 1, privacyMode: true, showLogo: false });
  const privateImage = await decode('data:image/png;base64,' + fs.readFileSync(privatePath).toString('base64'));
  check(privateImage.width === normal.width && privateImage.height === normal.height, '隐私模式保持输出尺寸');
  check(count(privateImage, green) > 500, '隐私模式按原版契约保留媒体');
  check(fs.readFileSync(privatePath).compare(fs.readFileSync(normalPath)) !== 0, '隐私模式改变真实文字字形');
  const box = { x: 110, y: 112, width: 250, height: 100 };
  const background = normal.pixels.slice(((box.y + 90) * normal.width + box.x) * 4, ((box.y + 90) * normal.width + box.x) * 4 + 3);
  const ink = (r, g, b) => Math.abs(r - background[0]) + Math.abs(g - background[1]) + Math.abs(b - background[2]) > 60;
  check(count(privateImage, ink, box) > 60, '隐私模式在原文位置保留可见圆角字形，不留空白');
  check(text.text === before.text, '隐私模式不改文本数据');
  check(canvas.canvasEl.style.transform === before.transform, '隐私模式恢复画布 transform');
  check(canvas.wrapperEl.getAttribute('style') === before.style, '隐私模式恢复包装层样式');
  check(text.isContentMounted === before.mounted, '隐私模式恢复正文挂载');
  check(!canvas.screenshotting && !canvas.wrapperEl.classList.contains('is-text-garbled'), '隐私模式释放导出状态');
  let captures = 0;
  const invoke = ipcRenderer.invoke;
  ipcRenderer.invoke = (channel, ...args) => { if (channel === 'canvas-capture-page') captures++; return invoke.call(ipcRenderer, channel, ...args); };
  const deniedPath = app.vaultPath + '/Denied.png';
  canvas.promptImageSavePath = () => ({ canceled: false, filePath: deniedPath });
  try {
    let error;
    try { await canvas.generateHDImage({ frame: 'full', scale: 1, showLogo: false, memoryBudgetBytes: 1024 }); } catch (failure) { error = failure; }
    check(/内存预算/.test(error?.message || ''), '超过预算给出可操作的错误');
    check(captures === 0, '预算拒绝发生在第一张截图和大位图分配之前');
    check(!fs.existsSync(deniedPath), '预算拒绝不落盘残缺 PNG');
    check(!canvas.screenshotting, '预算拒绝不遗留导出状态');
  } finally { ipcRenderer.invoke = invoke; }
  const density=Math.round(devicePixelRatio/require('electron').webFrame.getZoomFactor()*1e5)/1e5;
  const defaultDensity=canvas.renderCanvasImage({box:{minX:0,minY:0,maxX:100,maxY:50},scale:1});
  check(defaultDensity.width===Math.ceil(100*density)&&defaultDensity.height===Math.ceil(50*density),'默认导出按原版五位取整的设备密度输出');
  const retina=canvas.renderCanvasImage({box:{minX:0,minY:0,maxX:100,maxY:50},scale:1,pixelRatio:2});
  check(retina.width===200&&retina.height===100,'Retina 像素密度参与真实 PNG 尺寸');
  const metrics = canvas.renderCanvasImage({ box: { minX: 0, minY: 0, maxX: 20000, maxY: 10 }, scale: 2, showLogo: false });
  check(metrics.width === 16284, '最大长边按原版限制到 16284');
  // 真正通过弹层提交 viewport，隐藏的全图缩放值不能覆盖当前 0.5 倍视口。
  canvas.setViewport(150, 100, -1); canvas.finishViewportAnimation = true;
  await until(() => !canvas.viewportChanged, '半倍视口收敛');
  const viewportPath = app.vaultPath + '/Viewport modal.png';
  canvas.promptImageSavePath = () => ({ canceled: false, filePath: viewportPath });
  const savingViewport = canvas.generateHDImage();
  await until(() => !!document.querySelector('.modal.mod-narrow:not(.is-hidden)'), '导出弹层挂载');
  const modal = document.querySelector('.modal.mod-narrow:not(.is-hidden)');
  const slider = modal.querySelector('input.slider'); slider.value = slider.max; slider.dispatchEvent(new Event('change', { bubbles: true }));
  const frame = modal.querySelector('select'); frame.value = 'viewport'; frame.dispatchEvent(new Event('change', { bubbles: true }));
  check(slider.closest('.setting-item').classList.contains('is-hidden'), '视口弹层隐藏全图缩放控件');
  const expectedViewport = { width: Math.ceil(canvas.canvasRect.width * density), height: Math.ceil(canvas.canvasRect.height * density) };
  modal.querySelector('.modal-button-container .mod-cta').click();
  const viewportResult = await savingViewport;
  const viewportPng = await decode('data:image/png;base64,' + fs.readFileSync(viewportPath).toString('base64'));
  check(Math.abs(viewportPng.width - expectedViewport.width) <= 1 && Math.abs(viewportPng.height - expectedViewport.height) <= 1, '弹层视口 PNG 按当前视口像素保存，忽略隐藏缩放值');
  check(viewportResult.width === viewportPng.width && viewportResult.height === viewportPng.height && canvas.scale === 0.5, '弹层视口回执与 PNG 一致且保留缩放');
  // 使用真实 Markdown 文件卡验证内部 overflow、卡片边界与前景卡片遮挡。
  canvas.selectAll(); canvas.deleteSelection();
  const noteSource = '<div style="height:18px;overflow:hidden;font-size:16px;line-height:18px;color:rgb(240,10,180)">Visible<br><span data-private-test="hidden">HIDDEN SECRET</span></div>\n<div style="height:50px"></div>\n<div style="height:600px;font-size:16px;line-height:18px;color:rgb(240,10,180)">' + 'Overflow secret<br>'.repeat(35) + '</div>';
  const note = await app.vault.create('Privacy clipping.md', noteSource);
  const back = canvas.createFileNode({ pos: { x: 0, y: 0 }, size: { width: 300, height: 160 }, file: note, focus: false, save: false });
  canvas.setViewport(150, 100, 0); canvas.finishViewportAnimation = true;
  await until(() => !canvas.viewportChanged && back.contentEl?.querySelector('[data-private-test="hidden"]'), '真实文件正文和裁切夹具挂载');
  const exportBox = { minX: -20, minY: -20, maxX: 320, maxY: 240 };
  const saveFixture = async (name, privacyMode) => {
    const filePath = app.vaultPath + '/' + name + '.png';
    canvas.promptImageSavePath = () => ({ canceled: false, filePath });
    await canvas.generateHDImage({ frame: 'full', box: exportBox, scale: 1, pixelRatio: 1, privacyMode, showLogo: false });
    return decode('data:image/png;base64,' + fs.readFileSync(filePath).toString('base64'));
  };
  const hidden = back.contentEl.querySelector('[data-private-test="hidden"]').getBoundingClientRect();
  const hiddenWorld = canvas.posFromClient({ x: hidden.left, y: hidden.top });
  const hiddenBox = { x: Math.ceil(hiddenWorld.x - exportBox.minX + 2), y: Math.ceil(hiddenWorld.y - exportBox.minY + 2), width: Math.max(1, Math.floor(hidden.width - 4)), height: Math.max(1, Math.floor(hidden.height - 4)) };
  const pink = (r, g, b) => r > 180 && g < 70 && b > 120;
  const clippedNormal = await saveFixture('Clipping normal', false);
  const clippedPrivate = await saveFixture('Clipping private', true);
  check(count(clippedNormal, pink) > 20 && count(clippedPrivate, pink) > 20, '普通与隐私 PNG 均包含卡片内可见文字，未用空白绕过裁切');
  check(count(clippedNormal, pink, hiddenBox) === 0, '内部隐藏文字区域的普通 PNG 没有墨迹');
  check(count(clippedPrivate, pink, hiddenBox) === 0, '隐私字形遵守内部 overflow 裁切');
  const outside = { x: 22, y: 185, width: 296, height: 60 };
  check(count(clippedNormal, pink, outside) === 0 && count(clippedPrivate, pink, outside) === 0, '长正文的隐私字形不越过卡片下边界');
  const front = canvas.createTextNode({ pos: { x: 0, y: 0 }, size: { width: 300, height: 160 }, text: '', focus: false, save: false });
  front.containerEl.style.backgroundColor = 'rgb(15,100,220)'; canvas.deselectAll();
  await wait(100);
  const coveredNormal = await saveFixture('Covered normal', false);
  const coveredPrivate = await saveFixture('Covered private', true);
  const interior = { x: 24, y: 24, width: 290, height: 150 };
  const blue = (r, g, b) => r < 50 && g > 70 && g < 140 && b > 180;
  check(count(coveredNormal, blue, interior) > 500 && count(coveredPrivate, blue, interior) > 500, '普通与隐私 PNG 均由真实前景卡片遮挡底卡');
  check(count(coveredNormal, pink, interior) === 0 && count(coveredPrivate, pink, interior) === 0, '底卡隐私文字不会叠绘到前景卡片上');
  check(!canvas.wrapperEl.querySelector('.canvas-privacy-glyphs'), '导出后移除全部临时 SVG 字形层');
  check(await app.vault.read(note) === noteSource && front.text === '', '隐私 DOM 层不改写笔记或文本卡片');
  return { pass: true, count: checks.length, checks };
})()
