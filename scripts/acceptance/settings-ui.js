/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: settings-ui 场景：编辑器（拼写词典/语言/默认模式同步/Vim 弹窗结构）、文件页（路径建议、忽略文件、重建缓存）、关于页启动时间弹窗。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const wait=ms=>new Promise(r=>setTimeout(r,ms));const ok=(b,m)=>{if(!b)throw Error(m)};
let count=0;const check=(b,m)=>{count++;ok(b,m)};
const rowByName=(root,re)=>[...root.querySelectorAll('.setting-item')].find((el)=>{
  const n=el.querySelector('.setting-item-name');return n&&re.test(n.textContent||'');});
const modalByTitle=(re)=>[...document.querySelectorAll('.modal:not(.is-hidden)')].find((m)=>{
  const t=m.querySelector('.modal-title');return t&&re.test(t.textContent||'');});

/* ---------------- 编辑器页 ---------------- */
app.setting.open();app.setting.openTabById('editor');await wait(150);
const editorTab=app.setting.activeTab.containerEl;
check(!!editorTab&&editorTab.isConnected,'编辑器页打开');
const spellRow=rowByName(editorTab,/拼写检查$|Spell ?check$/);
check(!!spellRow,'拼写检查行存在');
const extra=spellRow.querySelector('.extra-setting-button');
check(!!extra,'拼写检查行有词典入口');
extra.click();await wait(150);
const dictModal=modalByTitle(/拼写检查词典|Spellcheck dictionary/);
check(!!dictModal,'词典弹窗打开');
check(!!dictModal.querySelector('.modal-close-button'),'词典弹窗有标题与关闭钮');
dictModal.querySelector('.modal-close-button').click();await wait(60);

const langRow=rowByName(editorTab,/拼写检查语言|Spellcheck languages/);
check(!!langRow,'拼写检查语言行存在');

const file=await app.vault.create('settings-ui.md','# t\n');
await app.workspace.openFile(file);await wait(180);
const view=app.workspace.getActiveViewOfType('markdown');
const modeRow=rowByName(editorTab,/默认编辑模式|Default editing mode/);
check(!!modeRow,'默认编辑模式行存在');
const select=modeRow.querySelector('select');
select.value='source';select.dispatchEvent(new Event('change',{bubbles:true}));await wait(80);
check(view.getMode()==='source','切换默认编辑模式后已打开叶子同步');
select.value='live-preview';select.dispatchEvent(new Event('change',{bubbles:true}));await wait(80);
check(view.getMode()==='live','恢复实时预览');

/* ---------------- 文件页 ---------------- */
app.setting.openTabById('file');await wait(150);
const fileTab=app.setting.activeTab.containerEl;
check(!!fileTab&&fileTab.isConnected,'文件页打开');
check(fileTab.querySelectorAll('input[type=text]').length>=3,'三个路径输入框存在');
const ignoreRow=rowByName(fileTab,/忽略文件|Excluded files/);
check(!!ignoreRow,'忽略文件行存在');
const manageBtn=[...ignoreRow.querySelectorAll('button')].find((b)=>/管理|Manage/.test(b.textContent||''));
check(!!manageBtn,'忽略文件行有管理按钮');
manageBtn.click();await wait(150);
const exModal=modalByTitle(/忽略文件|Excluded files/);
check(!!exModal,'忽略文件弹窗打开');
const addBtn=[...exModal.querySelectorAll('button')].find((b)=>/添加|Add/.test(b.textContent||''));
check(!!addBtn,'忽略文件弹窗有添加按钮');
addBtn.click();await wait(40);
check(!!exModal.querySelector('.mod-warning:not(.is-hidden)'),'空值给出错误提示');
const inp=exModal.querySelector('input');
inp.value='/^draft-/';inp.dispatchEvent(new Event('input',{bubbles:true}));
addBtn.click();await wait(80);
check(!!exModal.querySelector('.flair.mod-flat'),'regex 条件显示徽标');
[...exModal.querySelectorAll('button')].find((b)=>/取消|Cancel/.test(b.textContent||'')).click();await wait(60);

const rebuildRow=rowByName(fileTab,/重建仓库缓存|Rebuild vault cache/i);
check(!!rebuildRow&&!!rebuildRow.querySelector('button.mod-destructive'),'重建缓存按钮为 mod-destructive');

/* ---------------- 关于页 ---------------- */
app.setting.openTabById('about');await wait(150);
const aboutTab=app.setting.activeTab.containerEl;
check(!!aboutTab&&aboutTab.isConnected,'关于页打开');
const timerBtn=[...aboutTab.querySelectorAll('.extra-setting-button')].find((b)=>/立即检查|Check/.test(b.getAttribute('aria-label')||''))
  || aboutTab.querySelector('.extra-setting-button');
check(!!timerBtn,'启动检查按钮存在');
timerBtn.click();await wait(200);
const stModal=modalByTitle(/Startup time/i);
check(!!stModal,'启动时间弹窗打开');
check(!!stModal&&/ms/.test(stModal.textContent||''),'启动时间弹窗显示耗时');
stModal.querySelector('.modal-close-button').click();await wait(60);
app.setting.close();
return {pass:true,count};
})()
