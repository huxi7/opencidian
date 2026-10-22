/**
 * [INPUT]: 隔离临时库中的画布与 Electron 截图 IPC。
 * [OUTPUT]: {pass,count,checks}；断言失败抛错。
 * 接缝采样固定 pixelRatio:1；默认与 Retina 密度由 fidelity 场景验证。
 * [POS]: 验证整窗分块 PNG、跨块像素连续、真实正文与网页、取消和异常恢复。
 * 不打开浏览器、访达或保存对话框；截图仅为图片导出功能的内部实现。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const checks = [];
  const ok = (condition, message) => { if (!condition) throw Error(message); checks.push(message); };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (condition, message) => {
    for (let n = 0; n < 80; n++) { if (condition()) return; await wait(50); }
    throw Error(message);
  };
  const fs = require('fs');
  const { ipcRenderer, webFrame } = require('electron');
  const loadPng = async file => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
    await image.decode();
    const el = document.createElement('canvas');
    el.width = image.width; el.height = image.height;
    const ctx = el.getContext('2d'); ctx.drawImage(image, 0, 0);
    return { width: image.width, height: image.height, data: ctx.getImageData(0, 0, image.width, image.height).data };
  };
  await app.commands.findCommand('canvas:new-file').callback();
  await wait(200);
  const canvas = app.workspace.activeLeaf.view;
  ok(app.commands.findCommand('workspace:move-to-new-window')?.checkCallback(true) === true, '真实文档窗口命令在画布可用');
  const node = canvas.createTextNode({ pos: { x: 100, y: 100 }, size: { width: 1800, height: 220 },
    text: '# Browser rendered heading\n\n**Strong text** and `inline code`', focus: false, save: false });
  await wait(200);
  node.containerEl.style.backgroundColor = 'rgb(238, 40, 40)';
  canvas.deselectAll();
  canvas.zoomToFit(); canvas.finishViewportAnimation = true;
  await until(() => !canvas.viewportChanged, '画布视口收敛');
  const saved = { x: canvas.x, y: canvas.y, zoom: canvas.zoom,
    transform: canvas.canvasEl.style.transform, style: canvas.wrapperEl.getAttribute('style'),
    mounted: node.isContentMounted, selection: [...canvas.selection] };
  const file = app.vaultPath + '/Tiles.png';
  canvas.promptImageSavePath = () => ({ canceled: false, filePath: file });
  const result = await canvas.generateHDImage({ frame: 'full', scale: 1, pixelRatio: 1, showLogo: false });
  ok(result && result.tiles > 1, '真实导出跨多个整窗块');
  ok(result.width === 2000 && result.height === 420, '导出包含100世界单位边距');
  ok(fs.existsSync(file), '真实导出写出 PNG');
  const png = await loadPng(file);
  ok(png.width === result.width && png.height === result.height, 'PNG 尺寸与导出返回值一致');
  const pixel = (x, y) => Array.from(png.data.slice((y * png.width + x) * 4, (y * png.width + x) * 4 + 4));
  const red = rgb => rgb[0] > 210 && rgb[1] < 70 && rgb[2] < 70;
  const row = 280;
  let redPixels = 0;
  for (let x = 115; x < 1885; x++) if (red(pixel(x, row))) redPixels++;
  ok(redPixels === 1770, '卡片底色跨所有分块连续，无拼接空白线');
  let ink = 0;
  for (let y = 112; y < 220; y++) for (let x = 115; x < 700; x++) {
    const rgb = pixel(x, y);
    if (!red(rgb) && rgb[3] > 0) ink++;
  }
  ok(ink > 100, '导出包含浏览器真实排版正文');
  ok(canvas.x === saved.x && canvas.y === saved.y && canvas.zoom === saved.zoom, '成功导出不改视口坐标');
  ok(canvas.canvasEl.style.transform === saved.transform, '成功导出恢复画布 transform');
  ok(canvas.wrapperEl.getAttribute('style') === saved.style, '成功导出恢复包装层样式');
  ok(node.isContentMounted === saved.mounted, '成功导出恢复正文挂载');
  ok(!canvas.screenshotting && !canvas.wrapperEl.classList.contains('is-screenshotting'), '成功导出解除截图状态');
  canvas.selectOnly(node); await wait(100);
  const selected = [...canvas.selection];
  canvas.promptImageSavePath = () => ({ canceled: false, filePath: app.vaultPath + '/Private.png' });
  const privateResult = await canvas.generateHDImage({ frame: 'full', scale: 1, pixelRatio: 1, privacyMode: true, showLogo: false });
  ok(fs.readFileSync(privateResult.filePath).compare(fs.readFileSync(file)) !== 0, '隐私导出隐藏真实正文像素');
  ok(canvas.selection.size === selected.length && selected.every(item => canvas.selection.has(item)), '导出保留选择集合');
  ok(!canvas.wrapperEl.classList.contains('is-text-garbled'), '隐私导出恢复正文可见性');
  // 修改真实浏览器缩放，验证 CSS 像素与 Electron DIP 换算。
  const originalZoom = webFrame.getZoomFactor();
  webFrame.setZoomFactor(1.25);
  await wait(250);
  canvas.promptImageSavePath = () => ({ canceled: false, filePath: app.vaultPath + '/Zoomed.png' });
  const zoomed = await canvas.generateHDImage({ frame: 'full', scale: 1, pixelRatio: 1, showLogo: false });
  const zoomedPng = await loadPng(zoomed.filePath);
  ok(zoomedPng.width === png.width && zoomedPng.height === png.height, '界面缩放不改变输出像素尺寸');
  webFrame.setZoomFactor(originalZoom); await wait(250);
  const invoke = ipcRenderer.invoke;
  let captures = 0;
  ipcRenderer.invoke = (channel, ...args) => {
    if (channel === 'canvas-capture-page') captures++;
    return invoke.call(ipcRenderer, channel, ...args);
  };
  try {
    canvas.promptImageSavePath = () => ({ canceled: true });
    ok(await canvas.generateHDImage({ frame: 'full' }) === null, '取消保存直接返回空');
    ok(captures === 0, '取消保存不触发整窗截图');
    canvas.promptImageSavePath = () => ({ canceled: false, filePath: app.vaultPath + '/Failed.png' });
    ipcRenderer.invoke = (channel, ...args) => {
      if (channel === 'canvas-capture-page') return Promise.reject(Error('验收截图异常'));
      return invoke.call(ipcRenderer, channel, ...args);
    };
    let rejected = false;
    try { await canvas.generateHDImage({ frame: 'full', privacyMode: true }); } catch (error) { rejected = /验收截图异常/.test(error.message); }
    ok(rejected, '截图失败向调用方返回真实错误');
    ok(!fs.existsSync(app.vaultPath + '/Failed.png'), '截图失败不落盘简化替代图片');
    ok(!canvas.screenshotting && !canvas.wrapperEl.classList.contains('is-screenshotting'), '异常分支解除截图状态');
    ok(canvas.x === saved.x && canvas.y === saved.y && canvas.zoom === saved.zoom, '异常分支保留视口');
    ok(!canvas.wrapperEl.querySelector('.canvas-privacy-glyphs') && ![...document.querySelectorAll('style')].some(el => el.textContent.includes('.canvas-wrapper.is-screenshotting .canvas-background')), '异常分支移除临时导出样式和隐私字形 DOM');
  } finally { ipcRenderer.invoke = invoke; }
  let invalidRejected = false;
  try { await ipcRenderer.invoke('canvas-capture-page', { x: -1, y: 0, width: 10, height: 10 }); }
  catch (error) { invalidRejected = /范围无效/.test(error.message); }
  ok(invalidRejected, '主进程拒绝越界截图矩形');
  // 复用旧 canvas 场景覆盖本地网页与离屏网页的实际 PNG 像素。
  return { pass: true, count: checks.length, checks, tiles: result.tiles, dimensions: [png.width, png.height] };
})()
