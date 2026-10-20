/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: dialogs 场景。覆盖设置重开、确认删除、命令面板、全局 tooltip 与 Notice 布局；
 *        并锁住 modal/prompt 无动画、tooltip 200ms、Notice 100ms 滑入与 token 阴影。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const wait=ms=>new Promise(r=>setTimeout(r,ms));const ok=(b,m)=>{if(!b)throw Error(m)};
const checks=[];
app.setting.open();app.setting.openTabById('appearance');app.setting.close();app.setting.open();await wait(250);
ok(app.setting.modalEl.isConnected&&getComputedStyle(app.setting.modalEl).display!=='none','settings reopens');
const bgEl=app.setting.bgEl||document.querySelector('.modal-container .modal-bg');
ok(!!bgEl&&getComputedStyle(bgEl).transitionDuration.split(',')[0].trim()==='0s','modal-bg has no transition (1.14.4)');
const a=app.setting.tabHeadersEl.getBoundingClientRect(),b=app.setting.tabContentContainer.getBoundingClientRect();ok(b.left>=a.right-1&&Math.abs(a.top-b.top)<2,'settings horizontal');app.setting.close();await wait(170);checks.push('settings reopens');
const f=await app.vault.create('Dialog-'+Date.now()+'.md','# confirm');app.settings.updateAppSettings({promptDelete:true,trashOption:'none'});
const task=app.fileManager.deleteFile(f);await wait(100);const cta=document.querySelector('.modal:not(.is-hidden) .mod-warning');ok(cta,'confirmation visible');cta.click();await task;ok(!app.vault.getFileByPath(f.path),'confirm resolves true');checks.push('confirm resolves true');
app.commands.executeCommandById('switcher:open');await wait(40);const prompt=document.querySelector('.prompt:not(.is-hidden)');ok(prompt,'switcher opens');const promptStyle=getComputedStyle(prompt);ok(promptStyle.animationName==='none'&&promptStyle.transitionDuration.split(',')[0].trim()==='0s','prompt opens without animation (1.14.4)');const input=prompt.querySelector('.prompt-input'),results=prompt.querySelector('.prompt-results');ok(input.getBoundingClientRect().bottom<=results.getBoundingClientRect().top+3,'prompt input before results');checks.push('prompt input first');
// ---- Suggest：清空按钮 + PageDown（命令面板，库为空但命令存在）
app.commands.executeCommandById('command-palette:open');await wait(60);
const openPrompts=document.querySelectorAll('.prompt:not(.is-hidden)');
const palette=openPrompts[openPrompts.length-1];ok(palette&&palette!==prompt,'command palette opens');
const paletteInput=palette.querySelector('.prompt-input');
const clearButton=palette.querySelector('.prompt-input-container .search-input-clear-button');ok(clearButton,'palette has clear button');
const allCount=palette.querySelectorAll('.suggestion-item').length;ok(allCount>3,'palette lists commands');
paletteInput.value='zzzzqqq';paletteInput.dispatchEvent(new Event('input'));await wait(20);ok(palette.querySelector('.suggestion-empty'),'empty state renders');
clearButton.click();await wait(20);
ok(paletteInput.value==='','clear button empties input');
ok(palette.querySelectorAll('.suggestion-item').length===allCount,'clear button restores the full list');checks.push('prompt clear button');
// ---- 复杂建议项布局：标题进内容列，热键同行靠右（原版 app.css 9003-9045）
paletteInput.value='open';paletteInput.dispatchEvent(new Event('input',{bubbles:true}));await wait(30);
const complexItems=[...palette.querySelectorAll('.suggestion-item.mod-complex')];ok(complexItems.length>0,'palette uses complex items');
ok(complexItems.every(el=>el.querySelector(':scope > .suggestion-content > .suggestion-title')),'complex title inside content column');
const withKey=complexItems.find(el=>el.querySelector(':scope > .suggestion-hotkey'));ok(withKey,'hotkey is a direct child of the item');
ok(getComputedStyle(withKey).flexDirection==='row','complex item lays out in a row');
const titleRect=withKey.querySelector('.suggestion-title').getBoundingClientRect();
const keyRect=withKey.querySelector('.suggestion-hotkey').getBoundingClientRect();
ok(keyRect.left>=titleRect.right-2,'hotkey right of title');
ok(Math.abs((keyRect.top+keyRect.height/2)-(titleRect.top+titleRect.height/2))<10,'hotkey on the same row');
paletteInput.value='';paletteInput.dispatchEvent(new Event('input',{bubbles:true}));await wait(20);
checks.push('palette complex item layout');
for (const key of ['PageDown','PageDown','PageUp']) { paletteInput.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true})); }
await wait(20);ok(palette.isConnected&&palette.querySelector('.suggestion-item.is-selected'),'PageUp/PageDown keeps selection');checks.push('PageUp/PageDown');
paletteInput.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(80);ok(!document.querySelector('.prompt:not(.is-hidden)'),'palette closes');
// 关闭面板，避免遮挡 tooltip 与 notice 断言
input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(60);
// ---- 全局 tooltip：出现、文案、位于目标下方、移出即隐藏
const target=document.body.createDiv({cls:'acceptance-tooltip-target',text:'hover me'});
target.setAttr('aria-label','Tooltip acceptance text');target.setAttr('data-tooltip-delay','0');
target.style.cssText='position:fixed;top:140px;left:320px;width:120px;height:24px;z-index:1';
target.dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'mouse'}));
await wait(30);const tooltip=document.querySelector('.tooltip');ok(tooltip,'tooltip appears');
const tooltipStyle=getComputedStyle(tooltip);
ok(tooltipStyle.animationDuration.split(',')[0].trim()==='0.2s','tooltip pops in 200ms (1.14.4)');
ok(tooltipStyle.padding==='8px 12px','tooltip padding 8/12 (--tooltip-padding)');
ok(tooltip.textContent.includes('Tooltip acceptance text'),'tooltip text from aria-label');
ok(tooltip.querySelector('.tooltip-arrow'),'tooltip has arrow');
const targetRect=target.getBoundingClientRect(),tooltipRect=tooltip.getBoundingClientRect();
ok(tooltipRect.top>=targetRect.bottom-1,'tooltip below target');
ok(tooltipRect.top-targetRect.bottom<24,'tooltip gap is small');
ok(Math.abs((tooltipRect.left+tooltipRect.width/2)-(targetRect.left+targetRect.width/2))<24,'tooltip horizontally centered');
target.dispatchEvent(new PointerEvent('pointerout',{bubbles:true,pointerType:'mouse',relatedTarget:document.body}));
await wait(30);ok(!document.querySelector('.tooltip'),'tooltip hides on pointerout');
target.detach();checks.push('tooltip show/hide/position');
// ---- Notice：右上角、hover 暂停自动隐藏、隐藏后容器摘除
const notice=new Notice('Acceptance notice',4000);await wait(160);
const container=document.querySelector('.notice-container');ok(container,'notice container exists');
ok(container.querySelector('.notice-message'),'notice message element');
const containerRect=container.getBoundingClientRect();ok(Math.abs(containerRect.top-22)<=1,'notice container top is 22px');
ok(Math.abs(containerRect.right-window.innerWidth)<=1,'notice container right aligned');
const noticeRect=container.querySelector('.notice').getBoundingClientRect();
ok(noticeRect.right<=window.innerWidth&&noticeRect.right>=window.innerWidth-30,'notice hugs the right edge');
const noticeStyle=getComputedStyle(container.querySelector('.notice'));
ok(noticeStyle.transitionProperty.includes('transform')&&noticeStyle.transitionDuration.split(',')[0].trim()==='0.1s','notice slides in over 100ms');
ok(noticeStyle.padding==='8px 12px','notice padding 8/12 (--notice-padding)');
const noticeProbe=document.body.createDiv();
noticeProbe.style.cssText='position:absolute;visibility:hidden;box-shadow:var(--shadow-s);border-radius:var(--radius-m)';
ok(getComputedStyle(noticeProbe).boxShadow===noticeStyle.boxShadow&&getComputedStyle(noticeProbe).borderRadius===noticeStyle.borderRadius,'notice shadow=shadow-s / radius=radius-m');
noticeProbe.detach();
// 监听挂在 .notice 本体，直接对元素派发事件即可(不依赖事件冒泡)
const noticeEl=container.querySelector('.notice');
noticeEl.dispatchEvent(new MouseEvent('mouseenter'));
await wait(4500);ok(container.isConnected,'notice persists while hovered');
noticeEl.dispatchEvent(new MouseEvent('mouseleave'));
await wait(5500);ok(!document.querySelector('.notice-container'),'notice container removed when empty');
void notice;checks.push('notice layout + hover pause');
return {pass:true,checks};
})()
