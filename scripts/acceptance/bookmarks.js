/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: bookmarks 场景。仅由 run.mjs 在带标记的临时库执行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const wait=ms=>new Promise(r=>setTimeout(r,ms));const ok=(b,m)=>{if(!b)throw Error(m)};
await app.plugins.enableInternalPlugin('bookmarks');
const file=app.vault.getFileByPath('A.md')||await app.vault.create('A.md','# A\nBookmarked content');await app.workspace.openFile(file);
const p=app.plugins.getInternalPlugin('bookmarks').instance;
await p.openBookmarksPane();await wait(100);
const v=app.workspace.getLeavesOfType('bookmarks')[0].view;
v._buttons.children[1].click();await wait(100);
const group=p.items[p.items.length-1];const title=v._treeEl.querySelector('[contenteditable="true"]');
ok(title&&title.getBoundingClientRect().height>0,'new empty group visible and editable');
title.textContent='Acceptance group';title.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await wait(100);
ok(group.title==='Acceptance group','group renamed');
p.addItem({type:'file',path:file.path,ctime:Date.now(),title:'Named bookmark'},group);await wait(100);
const row=v._treeEl.querySelector('[data-file="'+file.path+'"]');ok(row,'file in group rendered');row.click();await wait(150);ok(app.workspace.getActiveFile()?.path===file.path,'bookmark opens file');
ok(row.classList.contains('is-active')||v._treeEl.querySelector('[data-file="'+file.path+'"].is-active'),'custom named active bookmark');
const temp=p.addItem({type:'search',query:'acceptance',ctime:Date.now()},group);p.removeItem(temp);
const disk=app.settings.readJson('bookmarks.json');ok(disk.items.some(i=>i.title==='Acceptance group'&&i.items.length===1),'bookmarks saved');
await app.saveLayout();return {pass:true,items:disk.items};
})()
