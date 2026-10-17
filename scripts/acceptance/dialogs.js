/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: dialogs 场景。仅由 run.mjs 在带标记的临时库执行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const wait=ms=>new Promise(r=>setTimeout(r,ms));const ok=(b,m)=>{if(!b)throw Error(m)};
app.setting.open();app.setting.openTabById('appearance');app.setting.close();app.setting.open();await wait(250);
ok(app.setting.modalEl.isConnected&&getComputedStyle(app.setting.modalEl).display!=='none','settings reopens');
const a=app.setting.tabHeadersEl.getBoundingClientRect(),b=app.setting.tabContentContainer.getBoundingClientRect();ok(b.left>=a.right-1&&Math.abs(a.top-b.top)<2,'settings horizontal');app.setting.close();await wait(170);
const f=await app.vault.create('Dialog-'+Date.now()+'.md','# confirm');app.settings.updateAppSettings({promptDelete:true,trashOption:'none'});
const task=app.fileManager.deleteFile(f);await wait(100);const cta=document.querySelector('.modal:not(.is-hidden) .mod-warning');ok(cta,'confirmation visible');cta.click();await task;ok(!app.vault.getFileByPath(f.path),'confirm resolves true');
app.commands.executeCommandById('switcher:open');await wait(40);const prompt=document.querySelector('.prompt:not(.is-hidden)');ok(prompt,'switcher opens');const input=prompt.querySelector('.prompt-input'),results=prompt.querySelector('.prompt-results');ok(input.getBoundingClientRect().bottom<=results.getBoundingClientRect().top+3,'prompt input before results');
return {pass:true,checks:['settings reopens','horizontal settings','confirm resolves true','prompt input first']};
})()
