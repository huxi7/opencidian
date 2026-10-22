/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的 app；app.setting（Modal 子类实例）；app.fileManager 的删除确认。
 * [OUTPUT]: 返回 {pass,count,checks}；步骤摘要独立保存在 steps。
 * [POS]: modal-ui 场景。锁定应用内模态的视觉与交互契约：mod-dim 大阴影、0.85 遮罩、cover 取色、
 *        视口居中、背景点击关闭与 5px 拖选保护、ESC、关闭后摘除、确认弹窗标题/按钮。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const ok=(b,m)=>{if(!b)throw Error(m);checks.push(m)};
const checks=[];const steps=[];

// ---- 打开应用内设置模态（E2E 下 shouldUsePopout 返回 false）
app.setting.open();await wait(300);
const host=app.setting,container=host.containerEl,bg=host.bgEl,modal=host.modalEl;
ok(container.isConnected,'设置模态已挂载');
ok(container.hasClass('mod-dim'),'设置模态带 mod-dim');
ok(bg.style.opacity==='0.85','遮罩 opacity 0.85（实测 '+bg.style.opacity+'）');
// --background-modifier-cover 取色对齐：探针元素解析变量后与遮罩比较
const probeEl=document.body.createDiv();
probeEl.style.cssText='position:fixed;left:-9999px;top:-9999px;background-color:var(--background-modifier-cover)';
const coverColor=getComputedStyle(probeEl).backgroundColor;
probeEl.detach();
ok(getComputedStyle(bg).backgroundColor===coverColor,'遮罩颜色取 --background-modifier-cover: '+coverColor);
ok(getComputedStyle(modal).boxShadow!=='none','模态有大阴影: '+getComputedStyle(modal).boxShadow.slice(0,40));
const mr=modal.getBoundingClientRect();
ok(Math.abs(mr.left+mr.width/2-window.innerWidth/2)<=2&&Math.abs(mr.top+mr.height/2-window.innerHeight/2)<=2,'模态视口居中');
ok(getComputedStyle(container).position==='fixed','模态容器 fixed 覆盖');
const cr=container.getBoundingClientRect();
ok(Math.abs(cr.width-window.innerWidth)<=1&&Math.abs(cr.height-window.innerHeight)<=1,'模态容器铺满视口');
ok(getComputedStyle(host.closeButtonEl).display!=='none','应用内显示关闭按钮');
ok((host.titleEl.textContent||'').trim().length>0,'模态标题非空: '+host.titleEl.textContent);
steps.push('mod-dim + cover + shadow + centering');

// ---- 背景点击：位移 >=5px 视为拖选，不关闭（macOS 保护）
bg.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,screenX:10,screenY:10}));
bg.dispatchEvent(new MouseEvent('click',{bubbles:true,screenX:120,screenY:120}));
await wait(120);
ok(container.isConnected,'背景拖选 110px 不关闭模态');
bg.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,screenX:20,screenY:20}));
bg.dispatchEvent(new MouseEvent('click',{bubbles:true,screenX:22,screenY:21}));
await wait(250);
ok(!container.isConnected,'轻点背景关闭模态');
steps.push('bg click + drag guard');

// ---- 重开：mod-dim 与遮罩同时复位
app.setting.open();await wait(250);
ok(container.isConnected&&container.hasClass('mod-dim'),'重开后重新挂载并带 mod-dim');
ok(bg.style.opacity==='0.85','重开后遮罩恢复 0.85');
steps.push('reopen restores dim');

// ---- ESC 关闭
document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
await wait(250);
ok(!container.isConnected,'ESC 关闭模态');
steps.push('ESC closes');

// ---- 模态内把「在新窗口中打开设置」切为开：close() 必须先关闭模态，不能因配置已变而滞留
app.setting.open();await wait(250);
window.__SETTINGS_POPOUT_FORCE__=true;            // E2E 下让 shouldUsePopout() 成真
app.settings.updateAppSettings({settingsPopoutWindow:true});
app.setting.close();await wait(300);
ok(!container.isConnected,'配置切到独立窗口后模态正常关闭');
window.__SETTINGS_POPOUT_FORCE__=false;
app.settings.updateAppSettings({settingsPopoutWindow:false});
steps.push('modal closes when switching to popout');

// ---- 确认弹窗：标题、双按钮、mod-dim；取消不删除
const file=await app.vault.create('Modal-'+Date.now()+'.md','# confirm');
app.settings.updateAppSettings({promptDelete:true,trashOption:'none'});
const task=app.fileManager.deleteFile(file);await wait(150);
const warning=document.querySelector('.modal-container .mod-warning');
ok(warning,'删除确认弹窗出现');
const cModal=warning.closest('.modal-container');
ok((cModal.querySelector('.modal-title').textContent||'').trim().length>0,'确认弹窗标题非空: '+cModal.querySelector('.modal-title').textContent);
const buttons=[...cModal.querySelectorAll('button')].filter((b)=>(b.textContent||'').trim());
ok(buttons.length>=2&&buttons.every((b)=>b.textContent.trim().length>0),'确认弹窗按钮均有文案: '+buttons.map((b)=>b.textContent.trim()).join(' / '));
ok(cModal.hasClass('mod-dim'),'确认弹窗同样带 mod-dim');
const cancelBtn=buttons.find((b)=>!b.classList.contains('mod-warning'));
cancelBtn.click();await wait(50);await task;
ok(app.vault.getFileByPath(file.path),'取消后文件仍在');
steps.push('confirm title/buttons + cancel');

return {pass:true,count:checks.length,checks,steps};
})()
