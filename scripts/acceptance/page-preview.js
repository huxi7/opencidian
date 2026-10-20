/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: page-preview 场景：阅读模式悬停 popover、未解析链接空态、Escape 关闭、编辑模式 Mod 门控。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const wait=ms=>new Promise(r=>setTimeout(r,ms));const ok=(b,m)=>{if(!b)throw Error(m)};
let count=0;const check=(b,m)=>{count++;ok(b,m)};
const findPop=()=>document.querySelector('body > .popover.hover-popover');

const target = app.vault.getFileByPath('Preview Target.md') || await app.vault.create('Preview Target.md', '# 目标标题\n\n这是预览目标的内容 UNIQUE_PREVIEW_MARKER。\n');
const source = app.vault.getFileByPath('Preview Source.md') || await app.vault.create('Preview Source.md', '# 源\n\n链接：[[Preview Target]] 与 [[不存在的笔记XYZ]]\n');
await app.workspace.openFile(source);
await wait(200);
const view = app.workspace.getActiveViewOfType('markdown');
ok(view, 'markdown 视图已打开');

view.mode = 'preview';
view._applyMode();
await wait(250);
const links = [...view.readingEl.querySelectorAll('a.internal-link')];
const link = links.find((a) => a.textContent.trim() === 'Preview Target');
check(!!link, '阅读模式内部链接存在');
check(!!link && !link.classList.contains('is-unresolved'), '已存在的链接不再误判为未解析（回归：wiki 链接切片修复）');
check(!!link && link.getAttribute('data-href') === 'Preview Target.md', 'data-href 解析为目标路径');
link.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, cancelable: true }));
await wait(460);
const pop = findPop();
check(!!pop, '悬停后出现 hover-popover');
check(!!pop && pop.textContent.includes('UNIQUE_PREVIEW_MARKER'), 'popover 渲染目标笔记内容');
check(!!pop && !!pop.querySelector('.markdown-embed > .markdown-embed-content > .markdown-preview-view'), 'popover 使用原版 markdown-embed 结构');
check(!!pop && (pop.querySelector('.inline-title')||{}).textContent === 'Preview Target', 'popover 顶部显示文件名 inline-title');
const popEmbed = pop && pop.querySelector('.markdown-embed');
check(!!popEmbed && getComputedStyle(popEmbed).maxHeight === '400px' && getComputedStyle(popEmbed).overflow === 'auto', '预览限高 400px 且内部滚动');
check(!!pop && getComputedStyle(pop.querySelector('.markdown-preview-view')).padding === '32px', '预览内容 padding 32px（--file-margins）');
if (popEmbed) {
  popEmbed.scrollTop = 30;
  popEmbed.dispatchEvent(new Event('scroll', { bubbles: true }));
  await wait(80);
  check(!!findPop(), '预览内部滚动不关闭 popover');
}
link.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, cancelable: true }));
await wait(420);
check(!findPop(), '移出链接后 popover 关闭');

const unresolved = links.find((a) => a.textContent.trim() === '不存在的笔记XYZ');
check(!!unresolved, '未解析链接存在');
unresolved.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, cancelable: true }));
await wait(460);
const emptyPop = findPop();
check(!!emptyPop && !!emptyPop.querySelector('.mod-empty'), '未解析链接显示空态提示');
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
await wait(60);
check(!findPop(), 'Escape 关闭 popover');

view.mode = 'live';
view._applyMode();
await wait(250);
const wl = view.sourceEl.querySelector('.cm-wikilink[data-href="Preview Target"]');
check(!!wl, '实时预览内部链接存在');
wl.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, cancelable: true }));
await wait(460);
check(!findPop(), '编辑模式未按 Mod 不触发预览');
wl.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, cancelable: true, metaKey: true }));
await wait(460);
check(!!findPop(), '编辑模式按住 Mod 触发预览');
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
await wait(60);
check(!findPop(), 'popover 清理完成');

// ------------------------------------------------ 已悬停时再按 Mod（原版延迟监听）
wl.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, cancelable: true }));
await wait(420);
check(!findPop(), '复现: 未按 Mod 时悬停不弹（仅挂起）');
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true, bubbles: true }));
await wait(120);
check(!!findPop(), '悬停后按下 Mod 立即补弹预览');
document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta', metaKey: false, bubbles: true }));
await wait(120);
check(!findPop(), '松开 Mod 后预览收起');
document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta', metaKey: false, bubbles: true }));

return {pass:true,count};
})()
