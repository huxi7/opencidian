/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回 {pass,count,checks} 断言回执；失败抛出异常。
 * [POS]: basic-plugins 场景。仅由 run.mjs 在带标记的临时库执行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const pause=ms=>new Promise(r=>setTimeout(r,ms));const checks=[];const ok=(b,m)=>{if(!b)throw Error(m);checks.push(m)};
for(const id of ['global-search','word-count','tag-pane','command-palette','switcher'])await app.plugins.enableInternalPlugin(id);
const f=await app.vault.create('Basic-'+Date.now()+'.md','# Basic heading\nuniqueacceptanceword #acceptance\n');await app.workspace.openFile(f);await pause(300);
ok(document.querySelector('.nav-file-title[data-path="'+f.path+'"]')||document.querySelector('[data-path="'+f.path+'"]'),'explorer updates');
await app.commands.findCommand('global-search:open').callback();await pause(100);const s=app.workspace.getLeavesOfType('search')[0].view;s.setQuery('uniqueacceptanceword');await s.runSearch();ok(s.contentEl.textContent.includes(f.basename),'search results');
app.commands.executeCommandById('switcher:open');await pause(40);let field=[...document.querySelectorAll('.prompt-input')].find(x=>x.getBoundingClientRect().height);field.value=f.basename;field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await pause(200);ok(app.workspace.getActiveFile()?.path===f.path,'switcher selection');
app.commands.executeCommandById('command-palette:open');await pause(40);field=[...document.querySelectorAll('.prompt-input')].find(x=>x.getBoundingClientRect().height);ok(field&&document.querySelector('.prompt-results .suggestion-item'),'command palette list');document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await pause(200);
await app.commands.findCommand('tag-pane:open').callback();await pause(250);ok(app.workspace.getLeavesOfType('tag')[0].view.contentEl.textContent.includes('acceptance'),'tag index');await app.workspace.openFile(f);await pause(150);ok(document.querySelector('.status-bar')?.textContent.match(/词|字|word/i),'word count');return {pass:true,count:checks.length,file:f.path,checks};
})()
