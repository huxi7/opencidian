/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: settings-ui 场景：编辑器（拼写词典/语言胶囊/Not available/Vim 验证/默认模式同步）、文件页（路径建议、忽略文件、重点击聚焦、附件位置、重建缓存）、关于页（语言重启状态、硬件加速、版本行、启动时间弹窗）；
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
const text=el=>String((el&&el.textContent)||'').trim();
const modalByTitle=(re)=>[...document.querySelectorAll('.modal:not(.is-hidden)')].find((m)=>{
  const t=m.querySelector('.modal-title');return t&&re.test(t.textContent||'');});

/* ---------------- 编辑器页 ---------------- */
app.setting.open();app.setting.openTabById('editor');await wait(150);
let editorTab=app.setting.activeTab.containerEl;
check(!!editorTab&&editorTab.isConnected,'编辑器页打开');
const navOrder=[...document.querySelectorAll('.vertical-tab-header-group-items[data-section="options"] .vertical-tab-nav-item')].map(n=>n.getAttribute('data-setting-id'));
check(navOrder.join(',')==='about,appearance,editor,file,hotkeys,plugins','侧栏顺序对齐原版（关于/外观/编辑器/文件/快捷键/核心插件）:: '+navOrder.join(','));
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
const isMac=process.platform==='darwin';
if(isMac){
  check(/自动检测|automatically detect/i.test(langRow.textContent||''),'macOS 显示系统自动检测描述');
  check(!langRow.querySelector('select')&&!langRow.querySelector('.setting-command-hotkeys'),'macOS 不渲染语言下拉与胶囊');
}else{
  const langPills=langRow.querySelectorAll('.setting-command-hotkeys .setting-hotkey');
  check(langPills.length>=1,'语言行显示当前语言胶囊');
  const langSelect=langRow.querySelector('select.dropdown');
  check(!!langSelect,'语言行有下拉框');
  check(langSelect.style.width==='80px','语言下拉框宽度 80px');
  check(langSelect.options[0].value===''&&langSelect.options[0].textContent==='+','语言下拉框首项为 +');
  const langRestore=langRow.querySelector('.setting-restore-hotkey-button');
  check(!langRestore||langRestore.style.display==='none','默认语言无恢复按钮');
  try { require('electron').ipcRenderer.sendSync('spellcheck-languages-set',['zz']); } catch(e) {}
  app.setting.openTabById('editor');await wait(120);
  editorTab=app.setting.activeTab.containerEl;
  const parsedLangRow=rowByName(editorTab,/拼写检查语言|Spellcheck languages/);
  check(/Not available/.test(parsedLangRow.textContent||''),'不可用语言标注 Not available');
  check(!!parsedLangRow.querySelector('.setting-restore-hotkey-button'),'自定义语言后出现恢复按钮');
  try { require('electron').ipcRenderer.sendSync('spellcheck-languages-set',null); } catch(e) {}
  app.setting.openTabById('editor');await wait(120);
  editorTab=app.setting.activeTab.containerEl;
  check(!rowByName(editorTab,/拼写检查语言|Spellcheck languages/).querySelector('.setting-restore-hotkey-button'),'恢复默认后恢复按钮消失');
}

/* Vim 验证弹窗：错误命令不开启，正确命令开启 */
const vimRow=rowByName(editorTab,/Vim 模式|Vim mode/);
check(!!vimRow,'Vim 模式行存在');
vimRow.querySelector('.checkbox-container').click();await wait(100);
const vimModal=modalByTitle(/确认进入 Vim 模式|Enable Vim mode/);
check(!!vimModal,'Vim 验证弹窗打开');
check(!!vimModal.querySelector('.mod-warning'),'Vim 弹窗含警告');
const vimInput=vimModal.querySelector('input');
vimInput.value=':wq';
vimInput.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await wait(80);
check(!!modalByTitle(/确认进入 Vim 模式|Enable Vim mode/),'错误命令不关闭弹窗');
vimInput.value=':q';
vimInput.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await wait(300);
const vimModals=[...document.querySelectorAll('.modal')].filter(m=>/确认进入 Vim 模式|Enable Vim mode/.test((m.querySelector('.modal-title')||{}).textContent||''));
check(vimModals.length===0,'正确命令关闭弹窗 :: vim='+app.settings.appSettings.vimMode+' value='+vimInput.value+' modals='+JSON.stringify(vimModals.map(m=>({cls:m.className,connected:m.isConnected}))) + ' all=' + JSON.stringify([...document.querySelectorAll('.modal')].map(m=>({cls:m.className,title:(m.querySelector('.modal-title')||{}).textContent||''}))));
check(app.settings.appSettings.vimMode===true,'正确命令开启 Vim 模式');
rowByName(app.setting.activeTab.containerEl,/Vim 模式|Vim mode/).querySelector('.checkbox-container').click();await wait(80);
check(app.settings.appSettings.vimMode===false,'关闭 Vim 模式');

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
const openActionRow=rowByName(fileTab,/默认打开文件|Default open action/);
const focusRow=rowByName(fileTab,/始终聚焦新标签页|Always focus new tab/);
check(!!focusRow,'始终聚焦新标签页行存在');
check(!!openActionRow&&openActionRow.parentElement===focusRow.parentElement,'重点击聚焦行在打开行为组内');
const focusBefore=app.settings.appSettings.focusNewTab===true;
focusRow.querySelector('.checkbox-container').click();await wait(40);
check((app.settings.appSettings.focusNewTab===true)!==focusBefore,'重点击行写入 focusNewTab');
focusRow.querySelector('.checkbox-container').click();await wait(40);
check((app.settings.appSettings.focusNewTab===true)===focusBefore,'恢复 focusNewTab');
const attachRow=rowByName(fileTab,/附件默认存放路径|Default location for new attachments/);
check(!!attachRow&&attachRow.querySelectorAll('option').length===4,'附件位置下拉有四个选项');
check(attachRow.querySelector('select').value==='root','默认附件位置为仓库根目录');
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
check(!!rebuildRow&&!rebuildRow.querySelector('button.mod-destructive'),'重建缓存按钮不是危险按钮（原版默认样式）');
check(!!rebuildRow.querySelector('.mod-warning'),'重建缓存描述含警告');
check(!!rebuildRow.querySelector('a[href*="help.obsidian.md"]'),'重建缓存描述含了解更多链接');

/* ---------------- 关于页 ---------------- */
app.setting.openTabById('about');await wait(150);
const aboutTab=app.setting.activeTab.containerEl;
check(!!aboutTab&&aboutTab.isConnected,'关于页打开');
const versionRow=rowByName(aboutTab,/版本 1\.|Version 1\./);
check(!!versionRow,'版本行存在');
check(/安装程序版本|Installer version/.test(versionRow.textContent||''),'版本行显示安装程序版本');
check([...versionRow.querySelectorAll('a')].some(a=>/changelog/i.test(a.href||'')),'版本行有更新日志链接');
const aboutLangRow=rowByName(aboutTab,/^语言$|^Language$/);
check(!!aboutLangRow,'关于页语言行存在');
const aboutLangSelect=aboutLangRow.querySelector('select');
const aboutRelaunch=[...aboutLangRow.querySelectorAll('button')].find(b=>/重新启动|Relaunch/.test(text(b)));
check(!!aboutLangSelect&&!!aboutRelaunch,'语言行有下拉框与重启按钮');
check(aboutRelaunch.style.display==='none','未改语言时重启按钮隐藏');
const originalLanguage=aboutLangSelect.value;
const otherLanguage=originalLanguage==='en'?'zh':'en';
aboutLangSelect.value=otherLanguage;
aboutLangSelect.dispatchEvent(new Event('change',{bubbles:true}));await wait(40);
check(aboutRelaunch.style.display!=='none','切换语言后重启按钮显示');
aboutLangSelect.value=originalLanguage;
aboutLangSelect.dispatchEvent(new Event('change',{bubbles:true}));await wait(40);
check(aboutRelaunch.style.display==='none','切回当前语言后重启按钮隐藏');
const hwRow=rowByName(aboutTab,/硬件加速|Hardware acceleration/);
check(!!hwRow,'硬件加速行在关于页');
check(/高级|Advanced/.test(text(hwRow.closest('.setting-group').querySelector('.setting-item-heading .setting-item-name'))),'硬件加速位于高级组');
check(!!hwRow.querySelector('.mod-warning'),'硬件加速描述含性能警告');
const hwRelaunch=[...hwRow.querySelectorAll('button')].find(b=>/重新启动|Relaunch/.test(text(b)));
check(!!hwRelaunch&&hwRelaunch.style.display==='none','硬件加速未改动时重启按钮隐藏');
const timerBtn=[...aboutTab.querySelectorAll('.extra-setting-button')].find((b)=>/立即检查|Check/.test(b.getAttribute('aria-label')||''))
  || aboutTab.querySelector('.extra-setting-button');
check(!!timerBtn,'启动检查按钮存在');
timerBtn.click();await wait(200);
const stModal=modalByTitle(/Startup time/i);
check(!!stModal,'启动时间弹窗打开');
check(!!stModal&&/ms/.test(stModal.textContent||''),'启动时间弹窗显示耗时');
const statLabels=[...stModal.querySelectorAll('.startup-label')].map(text);
check(statLabels.includes('Operating system')&&statLabels.includes('Installer'),'启动统计含系统与安装程序行');
const deviceRow=[...stModal.querySelectorAll('.startup-stat')].find(el=>text(el.querySelector('.startup-label'))==='Device');
check(!!deviceRow&&deviceRow.style.display==='none','桌面端隐藏 Device 行');
const stButtons=[...stModal.querySelectorAll('.modal-button-container button')].map(text);
check(stButtons.some(t=>/复制到剪贴板|Copy to clipboard/.test(t)),'启动时间弹窗有复制按钮');
check(stButtons.some(t=>/完成|Done/.test(t)),'启动时间弹窗有完成按钮');
stModal.querySelector('.modal-close-button').click();await wait(60);
app.setting.openTabById('appearance');await wait(120);
check(!rowByName(app.setting.activeTab.containerEl,/硬件加速|Hardware acceleration/),'外观页不再重复硬件加速行');
app.setting.openTabById('about');await wait(120);
app.setting.close();
return {pass:true,count};
})()
