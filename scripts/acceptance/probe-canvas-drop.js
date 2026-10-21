/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例；场景自建 Note.md、Board.canvas（两节点一条边）与一张空白板。
 * [OUTPUT]: 打印 PROBE-CANVAS-DROP 诊断：文件树拖入后画布内所有带背景/边框的元素与计算样式；
 *          残留虚影体检：依次点击卡片菜单三个按钮后报告 .is-dummy 数量与每张卡片的矩形；并留下整屏截图。
 * [POS]: scripts/acceptance 的临时诊断场景（定位「拖入/加文件后画布出现蓝色方框」与「残留虚影」），不参与断言锁。
 *        判读要点：原版把临时节点建在拖拽工厂里（app.js 3346799 的 oM），纯点击不建、收尾必清；
 *        画布内唯一允许的 accent 元素是选中卡片自身的 1px accent 边框（原版 selectOnly 行为）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const checks = [];
  const pick = (el, props) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const out = {};
    for (const p of props) out[p] = cs.getPropertyValue(p);
    return out;
  };
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
  };
  const BOX = ['background-color', 'border', 'border-color', 'border-width', 'box-shadow', 'position', 'z-index', 'display', 'opacity'];
  const dummies = () => [...document.querySelectorAll('.canvas-node.is-dummy')].map((el) => ({
    cls: String(el.className).slice(0, 80),
    rect: rectOf(el),
    style: pick(el, ['width', 'height', 'transform']),
    styles: pick(el, BOX),
  }));

  app.settings.updateAppearance({ theme: 'moonstone' });
  await wait(300);
  await app.vault.create('Note.md', '# Note\n\n正文内容。\n');
  const board = await app.vault.create('Board.canvas', JSON.stringify({
    nodes: [
      { id: 'n1', type: 'text', text: '卡片一', x: -300, y: -150, width: 250, height: 60 },
      { id: 'n2', type: 'file', file: 'Note.md', x: 100, y: -150, width: 400, height: 400 },
    ],
    edges: [{ id: 'e1', fromNode: 'n1', fromSide: 'right', toNode: 'n2', toSide: 'left' }],
  }));
  await app.commands.findCommand('canvas:new-file').callback();
  await wait(600);
  const view = app.workspace.activeLeaf.view;
  const canvas = view.canvas || view;
  const report = { viewType: view.getViewType() };

  const before = document.querySelectorAll('.canvas-node').length;
  report.nodesBefore = before;

  // 模拟文件树拖入：内部载荷 text/plain 为 {path,type} JSON。
  const dt = new DataTransfer();
  dt.setData('text/plain', JSON.stringify({ path: 'Note.md', type: 'file' }));
  const wrapper = document.querySelector('.canvas-wrapper');
  const rect = wrapper.getBoundingClientRect();
  const ev = new DragEvent('drop', {
    bubbles: true, cancelable: true, dataTransfer: dt,
    clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
  });
  wrapper.dispatchEvent(ev);
  await wait(900);

  report.nodesAfter = document.querySelectorAll('.canvas-node').length;
  report.selectionBox = !!document.querySelector('.canvas-selection');
  report.dummy = document.querySelectorAll('.is-dummy').length;
  report.dropOverlay = !!document.querySelector('.workspace-drop-overlay');
  report.bodyGrabbing = document.body.classList.contains('is-grabbing');

  const all = [...document.querySelectorAll('.canvas *')].filter((el) => {
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor;
    const hasBg = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
    const hasBorder = cs.borderTopWidth !== '0px' || cs.borderBottomWidth !== '0px';
    return hasBg || hasBorder;
  }).map((el) => ({
    cls: (el.className && String(el.className)).slice(0, 90),
    tag: el.tagName.toLowerCase(),
    rect: rectOf(el),
    styles: pick(el, BOX),
  }));
  report.painted = all;
  const blues = [...document.querySelectorAll('.canvas, .canvas *')].map((el) => {
    const cs = getComputedStyle(el);
    const hit = [cs.backgroundColor, cs.borderTopColor, cs.borderBottomColor, cs.color, cs.outlineColor].filter((c) => /rgb\((\d+), (\d+), (\d+)\)/.test(c) && (() => { const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(c); const r = +m[1], g = +m[2], b = +m[3]; return b > r + 40 && b > g + 25; })());
    return hit.length ? { cls: String(el.className).slice(0, 80), tag: el.tagName.toLowerCase(), rect: rectOf(el), bg: cs.backgroundColor, border: cs.borderTopColor + ' ' + cs.borderTopWidth, color: cs.color } : null;
  }).filter(Boolean);
  report.blueElements = blues;
  report.canvasHtml = (document.querySelector('.canvas')?.outerHTML || '').slice(0, 4000);
  const card = document.querySelector('.canvas-node');
  const cw = document.querySelector('.canvas-wrapper');
  const chain = [];
  let el = cw;
  while (el && el !== document.documentElement) {
    const cs = getComputedStyle(el);
    chain.push({ cls: String(el.className || '').slice(0, 60), bg: cs.backgroundColor, bgImage: cs.backgroundImage.slice(0, 60) });
    el = el.parentElement;
  }
  report.bgChain = chain;
  report.vars = {
    canvasBackground: getComputedStyle(document.body).getPropertyValue('--canvas-background').trim(),
    backgroundPrimary: getComputedStyle(document.body).getPropertyValue('--background-primary').trim(),
    base00: getComputedStyle(document.body).getPropertyValue('--color-base-00').trim(),
    theme: document.body.className,
  };
  report.cardDom = card ? card.outerHTML.slice(0, 2500) : null;
  report.cardInner = card ? [...card.querySelectorAll('*')].map((el) => el.tagName.toLowerCase() + '.' + String(el.className || '')).slice(0, 40) : null;

  // 残留虚影体检：依次点击卡片菜单三个按钮（纯点击 = 原版 oM 懒建工厂，不应建虚影）。
  const clickWithoutMove = (target) => {
    const r = target.getBoundingClientRect();
    const init = {
      bubbles: true, cancelable: true, isPrimary: true, pointerType: 'mouse', pointerId: 91,
      button: 0, buttons: 1, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2,
    };
    target.dispatchEvent(new PointerEvent('pointerdown', init));
    target.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: init.clientX, clientY: init.clientY }));
  };
  const menuButtons = [...document.querySelectorAll('.canvas-card-menu .canvas-card-menu-button')];
  const health = [];
  for (const [index, label] of ['添加卡片', '添加笔记', '添加媒体'].entries()) {
    if (!menuButtons[index]) break;
    clickWithoutMove(menuButtons[index]);
    await wait(400);
    health.push({
      label,
      dummyCount: document.querySelectorAll('.canvas-node.is-dummy').length,
      dummies: dummies(),
      nodeCount: document.querySelectorAll('.canvas-node').length,
    });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(250);
  }
  report.residualDummyHealth = health;
  report.dummyTotal = document.querySelectorAll('.canvas-node.is-dummy').length;
  report.dummyPointerEvents = [...document.querySelectorAll('.canvas-node.is-dummy')].map((el) => getComputedStyle(el).pointerEvents);
  report.minimap = !!document.querySelector('svg.canvas-minimap');

  console.log('PROBE-CANVAS-DROP ' + JSON.stringify(report, null, 1));
  return { pass: true, checks, scene: 'canvas-drop' };
})()
