/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: settings-plugins 场景：快捷键页筛选菜单/芯片、按快捷键捕获筛选与 Esc 退出、冲突芯片跳筛选；核心插件页齿轮/快捷键入口显隐与跳转；社区插件卸载确认与目录删除。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const ok=(b,m)=>{if(!b)throw Error(m)};
let count=0;const check=(b,m)=>{count++;ok(b,m)};
const text=el=>String((el&&el.textContent)||'').trim();
const until=async(fn,label)=>{for(let n=0;n<120;n++){if(fn())return;await wait(25)}throw Error(label)};

/* ================= A. 快捷键页 ================= */
app.setting.open();
const hotkeysTab=app.setting.openTabById('hotkeys');
await wait(150);
check(!!hotkeysTab&&app.setting.activeTab===hotkeysTab,'快捷键页打开');
const root=hotkeysTab.containerEl;
const filterContainer=root.querySelector('.setting-filter-container');
check(!!filterContainer,'筛选容器存在');
check(!filterContainer.querySelector('.hotkey-filter'),'默认无筛选 chip');
const searchInput=root.querySelector('.search-input-container input[type=search]');
check(!!searchInput,'搜索行有搜索框');
const fullRows=root.querySelectorAll('.hotkey-list-container .setting-item').length;
check(fullRows>0,'快捷键列表非空');

const filterBtn=[...root.querySelectorAll('.setting-item-control button.clickable-icon')].find(b=>b.querySelector('svg.lucide-filter'));
check(!!filterBtn,'筛选菜单按钮存在');
filterBtn.click();await wait(60);
const menu=document.querySelector('.menu');
check(!!menu,'筛选菜单弹出');
const assignedItem=[...menu.querySelectorAll('.menu-item')].find(el=>{const t=text(el.querySelector('.menu-item-title'));return t==='已分配'||t==='Assigned'});
check(!!assignedItem,'菜单含"已分配"项');
assignedItem.click();await wait(60);
const statusChip=filterContainer.querySelector('.hotkey-filter');
check(!!statusChip,'选择"已分配"后出现 chip');
check(['已分配','Assigned'].includes(text(statusChip.querySelector('.hotkey-filter-inner'))),'chip 显示当前筛选');
check(!!statusChip.querySelector('.hotkey-filter-remove-button'),'chip 带移除按钮');
const assignedRows=[...root.querySelectorAll('.hotkey-list-container .setting-item')];
check(assignedRows.length>0&&assignedRows.length<=fullRows,'已分配列表非空且不超过全部');
check(assignedRows.every(row=>row.querySelector('.setting-command-hotkeys .setting-hotkey')),'已分配行都绑定快捷键');
statusChip.querySelector('.hotkey-filter-remove-button').click();await wait(60);
check(!filterContainer.querySelector('.hotkey-filter'),'移除 chip 后筛选清空');
check(root.querySelectorAll('.hotkey-list-container .setting-item').length===fullRows,'移除 chip 恢复全部列表');

/* 按快捷键筛选 */
await app.plugins.enableInternalPlugin('templates');
app.settings.setHotkey('insert-template',[{modifiers:['Ctrl','Shift'],key:'k'}]);
app.hotkeyManager.buildCustomKeys();
hotkeysTab.updateHotkeyVisibility();await wait(40);
const keyboardIcon=root.querySelector('.search-input-container .input-right-decorator.clickable-icon');
check(!!keyboardIcon&&!!keyboardIcon.querySelector('svg.lucide-keyboard'),'搜索框右缘键盘图标存在');
const dispatchKey=opts=>document.body.dispatchEvent(new KeyboardEvent('keydown',Object.assign({bubbles:true,cancelable:true},opts)));
keyboardIcon.click();await wait(40);
check(!!root.querySelector('.search-input-container .setting-hotkey.mod-active'),'点击键盘图标进入捕获态');
dispatchKey({key:'k',ctrlKey:true,shiftKey:true});await wait(60);
check(!root.querySelector('.search-input-container .setting-hotkey.mod-active'),'按下组合键后退出捕获态');
check(!!filterContainer.querySelector('.hotkey-filter'),'按快捷键筛选后出现 chip');
const boundRows=[...root.querySelectorAll('.hotkey-list-container .setting-item')];
check(boundRows.length===1,'列表只剩绑定该组合的命令');
check(text(boundRows[0].querySelector('.setting-item-name'))===app.commands.findCommand('insert-template').name,'筛选命中 insert-template');
keyboardIcon.click();await wait(40);
check(!!root.querySelector('.search-input-container .setting-hotkey.mod-active'),'再次点击进入捕获态');
dispatchKey({key:'Escape'});await wait(60);
check(!root.querySelector('.search-input-container .setting-hotkey.mod-active'),'Esc 退出捕获态');
check(!filterContainer.querySelector('.hotkey-filter'),'Esc 清掉快捷键筛选 chip');
check(root.querySelectorAll('.hotkey-list-container .setting-item').length===fullRows,'Esc 后恢复全部列表');
check(app.setting.activeTab===hotkeysTab,'Esc 未关闭设置弹窗');

/* 冲突 chip */
app.settings.setHotkey('insert-template',[{modifiers:['Mod','Shift'],key:'j'}]);
app.settings.setHotkey('insert-current-date',[{modifiers:['Mod','Shift'],key:'j'}]);
app.hotkeyManager.buildCustomKeys();
hotkeysTab.updateHotkeyVisibility();await wait(40);
let conflictChips=[...root.querySelectorAll('.hotkey-list-container .setting-hotkey.has-conflict')];
check(conflictChips.length===2,'两条命令的快捷键 chip 带 has-conflict');
searchInput.value='insert';
searchInput.dispatchEvent(new Event('input',{bubbles:true}));await wait(40);
conflictChips=[...root.querySelectorAll('.hotkey-list-container .setting-hotkey.has-conflict')];
check(conflictChips.length===2,'搜索后冲突 chip 仍在');
conflictChips[0].click();await wait(60);
check(searchInput.value==='','点击冲突 chip 清空搜索');
check(!!filterContainer.querySelector('.hotkey-filter'),'点击冲突 chip 出现快捷键筛选 chip');
check(root.querySelectorAll('.hotkey-list-container .setting-item').length===2,'冲突快捷键筛选命中两条命令');
filterContainer.querySelector('.hotkey-filter .hotkey-filter-remove-button').click();await wait(40);
app.settings.setHotkey('insert-template',null);
app.settings.setHotkey('insert-current-date',null);
app.hotkeyManager.buildCustomKeys();
hotkeysTab.updateHotkeyVisibility();await wait(40);

/* ================= B. 核心插件页 ================= */
const pluginsTab=app.setting.openTabById('plugins');
await wait(150);
check(!!pluginsTab&&app.setting.activeTab===pluginsTab,'核心插件页打开');
const tabEl=pluginsTab.containerEl;
check(document.activeElement===tabEl.querySelector('input[type=search]'),'核心插件页搜索框自动聚焦');
await app.plugins.enableInternalPlugin('templates');
pluginsTab.render(true);await wait(120);
const manifest=app.plugins.getInternalPlugin('templates').manifest;
const rowByName=()=>[...tabEl.querySelectorAll('.setting-item')].find(el=>text(el.querySelector('.setting-item-name'))===manifest.name);
const extraOf=(row,icon)=>row&&[...row.querySelectorAll('.extra-setting-button')].find(b=>b.querySelector('svg.'+icon));
const gearVisible=()=>{const g=extraOf(rowByName(),'lucide-settings');return !!g&&g.style.display!=='none'};
const hotkeyVisible=()=>{const h=extraOf(rowByName(),'lucide-plus-circle');return !!h&&h.style.display!=='none'};
check(!!rowByName(),'templates 行存在');
check(gearVisible(),'启用后设置齿轮可见');
check(hotkeyVisible(),'启用后快捷键入口可见');
rowByName().querySelector('.checkbox-container').click();
await until(()=>!app.plugins.getInternalPlugin('templates').enabled,'开关关闭 templates');
await until(()=>!gearVisible(),'禁用后设置齿轮隐藏');
check(!!rowByName(),'禁用后行保留');
check(!hotkeyVisible(),'禁用后快捷键入口隐藏');
rowByName().querySelector('.checkbox-container').click();
await until(()=>app.plugins.getInternalPlugin('templates').enabled&&hotkeyVisible(),'重新开启后快捷键入口恢复');
check(gearVisible(),'重新开启后设置齿轮恢复');
extraOf(rowByName(),'lucide-plus-circle').click();await wait(120);
check(app.setting.activeTab&&app.setting.activeTab.id==='hotkeys','点击快捷键入口切到快捷键页');
const hkInput=app.setting.activeTab.containerEl.querySelector('input[type=search]');
check(!!hkInput&&hkInput.value.includes('templates'),'快捷键页搜索框填入插件 id');
check(document.activeElement===hkInput,'快捷键页搜索框聚焦');

/* ================= C. 社区插件卸载 ================= */
const fsc=require('fs');const pth=require('path');
const plugins=app.plugins;
const dir=pth.join(app.settings.dir,'plugins','test-plugin');
fsc.mkdirSync(dir,{recursive:true});
fsc.writeFileSync(pth.join(dir,'manifest.json'),JSON.stringify({id:'test-plugin',name:'Acceptance Plugin',version:'1.0.0',author:'OpenSidian QA',description:'acceptance fixture'}));
fsc.writeFileSync(pth.join(dir,'main.js'),"const { Plugin } = require('obsidian');\nmodule.exports = class extends Plugin {\n  async onload() { this.addCommand({ id: 'test-plugin:hello', name: 'Hello from acceptance plugin', callback() {} }); }\n};\n");
const list=new Set(app.settings.communityPlugins||[]);list.add('test-plugin');app.settings.setCommunityPlugins([...list]);
await plugins.setEnable(true);
await until(()=>!!plugins.plugins['test-plugin'],'社区插件已加载');
const communityTab=app.setting.openTabById('community-plugins');
await wait(150);
check(!!communityTab&&app.setting.activeTab===communityTab,'社区插件页打开');
const communityEl=communityTab.containerEl;
const pluginRow=()=>[...communityEl.querySelectorAll('.installed-plugins-container .setting-item')].find(el=>text(el.querySelector('.setting-item-name'))==='Acceptance Plugin');
check(!!pluginRow(),'已装插件行存在');
const trash=extraOf(pluginRow(),'lucide-trash-2');
check(!!trash&&trash.style.display!=='none','卸载按钮存在');
trash.click();await wait(100);
const confirmEl=[...document.querySelectorAll('.modal:not(.is-hidden)')].find(m=>/卸载插件|Uninstall plugin/.test(text(m.querySelector('.modal-title'))));
check(!!confirmEl,'弹出卸载确认弹窗');
check(/Are you sure|确定要卸载/.test(text(confirmEl)),'确认弹窗含警告文案');
const confirmCta=[...confirmEl.querySelectorAll('button')].find(b=>b.classList.contains('mod-warning'));
check(!!confirmCta,'确认按钮为 mod-warning');
confirmCta.click();
await until(()=>!fsc.existsSync(dir),'确认后插件目录被删除');
await until(()=>!pluginRow(),'卸载后行消失');
check(!(app.settings.communityPlugins||[]).includes('test-plugin'),'community-plugins.json 已移除该插件');
/* 未加载（禁用）插件的卸载路径：无实例也要删目录并清配置 */
fsc.mkdirSync(dir,{recursive:true});
fsc.writeFileSync(pth.join(dir,'manifest.json'),JSON.stringify({id:'test-plugin',name:'Acceptance Plugin',version:'1.0.0'}));
fsc.writeFileSync(pth.join(dir,'main.js'),'module.exports = {};\n');
app.settings.setCommunityPlugins([...new Set([...(app.settings.communityPlugins||[]),'test-plugin'])]);
communityTab.render();await wait(150);
check(!!pluginRow(),'禁用状态插件行存在');
extraOf(pluginRow(),'lucide-trash-2').click();await wait(100);
const confirmEl2=[...document.querySelectorAll('.modal:not(.is-hidden)')].find(m=>/卸载插件|Uninstall plugin/.test(text(m.querySelector('.modal-title'))));
check(!!confirmEl2,'禁用插件弹出确认');
[...confirmEl2.querySelectorAll('button')].find(b=>b.classList.contains('mod-warning')).click();
await until(()=>!fsc.existsSync(dir),'禁用插件确认后目录删除');
await until(()=>!pluginRow(),'禁用插件行消失');
check(!(app.settings.communityPlugins||[]).includes('test-plugin'),'禁用插件配置已清理');
if(app.setting&&app.setting.close)app.setting.close();
await app.saveLayout();
return {pass:true,count};
})()
