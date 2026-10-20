/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: settings-ui 场景：编辑器（拼写词典/语言/默认模式同步/Vim 弹窗结构）、文件页（路径建议、忽略文件、重建缓存）、关于页启动时间弹窗；
 *        并锁住导航无 hover、开关无 hover 阴影、按钮/输入无过渡与输入 focus 焦点环。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const wait=ms=>new Promise(r=>setTimeout(r,ms));const ok=(b,m)=>{if(!b)throw Error(m)};
let count=0;const check=(b,m)=>{count++;ok(b,m)};
const cssRules=()=>{const out=[];const walk=(list)=>{for(const r of list){if(r.cssRules&&r.cssRules.length)walk(r.cssRules);else if(r.selectorText)out.push(r);}};for(const ss of document.styleSheets){try{walk(ss.cssRules);}catch(e){}}return out;};
const colorOf=(name)=>{const probe=document.createElement('div');probe.style.color='var('+name+')';document.body.appendChild(probe);const c=getComputedStyle(probe).color;probe.remove();return c;};
const rowByName=(root,re)=>[...root.querySelectorAll('.setting-item')].find((el)=>{
  const n=el.querySelector('.setting-item-name');return n&&re.test(n.textContent||'');});
const modalByTitle=(re)=>[...document.querySelectorAll('.modal:not(.is-hidden)')].find((m)=>{
  const t=m.querySelector('.modal-title');return t&&re.test(t.textContent||'');});

/* ---------------- 编辑器页 ---------------- */
app.setting.open();app.setting.openTabById('editor');await wait(150);
const editorTab=app.setting.activeTab.containerEl;
check(!!editorTab&&editorTab.isConnected,'编辑器页打开');
// 导航/开关/按钮的 hover 与过渡（原版 1.14.4 桌面：hover 不变色、无过渡）
const activeNav=document.querySelector('.vertical-tab-nav-item.is-active');
check(!!activeNav,'设置页有活动导航项');
const navStyle=getComputedStyle(activeNav);
check(navStyle.fontSize==='13px'&&navStyle.borderRadius==='8px','导航字号 13px、圆角 8px（原版 10329）:: '+navStyle.fontSize+' / '+navStyle.borderRadius);
check(navStyle.backgroundColor===colorOf('--background-modifier-hover'),'活动导航底色=background-modifier-hover');
const navHoverRules=cssRules().filter((r)=>r.selectorText.includes('.vertical-tab-nav-item:hover')&&r.style.getPropertyValue('background-color'));
check(navHoverRules.length===0,'设置导航悬停不变色（原版无 :hover 规则）');
const toggle=editorTab.querySelector('.checkbox-container');
check(!!toggle,'编辑器页有开关');
check(!getComputedStyle(toggle).boxShadow.includes('0.14'),'开关无悬停重阴影（原版单层 inset）');
const toggleHoverRules=cssRules().filter((r)=>r.selectorText.includes('.checkbox-container:hover')&&r.style.getPropertyValue('box-shadow'));
check(toggleHoverRules.length===0,'开关无 hover 阴影规则');
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
const baseInput=fileTab.querySelector('input[type=text]');
check(getComputedStyle(baseInput).transitionDuration.split(',')[0].trim()==='0s','输入框无基础过渡（桌面 --input-transition:none）');
const inputFocusRules=cssRules().filter((r)=>r.selectorText&&r.selectorText.includes('input:focus')&&r.style.getPropertyValue('box-shadow'));
check(inputFocusRules.length>0&&inputFocusRules.some((r)=>r.style.getPropertyValue('box-shadow').includes('var(--input-border-width-focus')),'输入框 focus 有 2px 焦点环规则（原版 8679）');
check(inputFocusRules.some((r)=>r.style.getPropertyValue('border-color').includes('var(--background-modifier-border-focus)')),'输入框 focus 边框=focus 色');
const ignoreRow=rowByName(fileTab,/忽略文件|Excluded files/);
check(!!ignoreRow,'忽略文件行存在');
const manageBtn=[...ignoreRow.querySelectorAll('button')].find((b)=>/管理|Manage/.test(b.textContent||''));
check(!!manageBtn,'忽略文件行有管理按钮');
const manageStyle=getComputedStyle(manageBtn);
check(manageStyle.transitionDuration.split(',')[0].trim()==='0s','按钮无过渡（桌面 --button-transition:none）');
const buttonShadowProbe=document.body.createDiv();
buttonShadowProbe.style.cssText='position:absolute;visibility:hidden;box-shadow:var(--input-shadow)';
check(manageStyle.boxShadow===getComputedStyle(buttonShadowProbe).boxShadow&&manageStyle.padding==='4px 12px','按钮阴影=--input-shadow、padding 4/12 :: '+manageStyle.padding);
buttonShadowProbe.detach();
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
