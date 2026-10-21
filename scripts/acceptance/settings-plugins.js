/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: settings-plugins 场景：侧栏分组结构（选项组含独立“界面”页签 / 核心插件组）、locale 键按原版 i18n 补齐（键存在且是原版译文）、快捷键页裸搜索框/状态筛选芯片/冲突徽标、按快捷键捕获与 Esc、冲突芯片跳筛选、空数组压制默认键、行内录制；核心插件页搜索聚焦/空态、齿轮/快捷键入口显隐与跳转、开关不重建行、插件设置页签归入核心插件分组。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const ok=(b,m)=>{if(!b)throw Error(m)};
let count=0;const check=(b,m)=>{count++;ok(b,m)};
const text=el=>String((el&&el.textContent)||'').trim();
const until=async(fn,label)=>{for(let n=0;n<120;n++){if(fn())return;await wait(25)}throw Error(label)};
const rowsOf=root=>[...root.querySelectorAll('.setting-items > .setting-item')];
const chipByText=(root,values)=>[...root.querySelectorAll('.setting-group-filter')].find(el=>values.includes(text(el)));

/* ================= A. 快捷键页 ================= */
app.setting.open();
const hotkeysTab=app.setting.openTabById('hotkeys');
await wait(150);
check(!!hotkeysTab&&app.setting.activeTab===hotkeysTab,'快捷键页打开');
/* 侧栏结构：内置页签在“选项”分组，核心插件页签在“核心插件”分组（原版 1.14.4） */
const optionSection=[...document.querySelectorAll('.vertical-tab-header-group-items[data-section="options"] .vertical-tab-nav-item')].map(n=>n.getAttribute('data-setting-id'));
check(optionSection.join(',')==='about,appearance,interface,editor,file,hotkeys,plugins','选项分组含界面页签且顺序对齐原版:: '+optionSection.join(','));
const coreSection=[...document.querySelectorAll('.vertical-tab-header-group-items[data-section="core-plugins"] .vertical-tab-nav-item')].map(n=>n.getAttribute('data-setting-id'));
check(!coreSection.includes('interface'),'界面页签不在核心插件分组');
const groupTitles=[...document.querySelectorAll('.vertical-tab-header-group-title')].map(el=>el.textContent.trim());
check(groupTitles[0]==='选项','侧栏第一分组标题为选项');
check(groupTitles[1]==='核心插件','侧栏第二分组标题为核心插件');
const interfaceNav=document.querySelector('.vertical-tab-nav-item[data-setting-id="interface"]');
check(!!interfaceNav,'侧栏存在界面页签');
check(!!interfaceNav.querySelector('svg.lucide-monitor'),'界面页签带 monitor 图标');
const root=hotkeysTab.containerEl;
const group=root.querySelector('.setting-group.mod-hotkeys');
check(!!group,'快捷键设置组存在');
const searchRow=group.querySelector('.setting-group-search');
check(!!searchRow,'搜索行存在');
check(searchRow.getAttribute('tabindex')==='-1','搜索行 tabIndex=-1');
const searchInput=searchRow.querySelector(':scope > .search-input-container.mod-hotkey input[type=search]');
check(!!searchInput,'搜索框是 setting-group-search 的直接子元素');
check(!searchRow.querySelector('.setting-item'),'搜索行没有 setting-item 包裹');
check(!!searchRow.querySelector('.input-right-decorator.clickable-icon svg.lucide-keyboard'),'搜索框右缘键盘图标存在');

const control=searchRow.querySelector(':scope > .setting-group-search-control');
check(!!control,'筛选芯片容器存在');
const filterContainer=control.querySelector('.setting-group-filters');
check(!!filterContainer,'筛选芯片行存在');
const fullRows=rowsOf(root).length;
check(fullRows>0,'快捷键列表非空');
check(!root.querySelector('.hotkey-list-container'),'快捷键行直接挂在 setting-items 下');

/* 状态芯片：默认 4 个可见，冲突芯片隐藏 */
const visibleChips=()=>[...filterContainer.querySelectorAll('.setting-group-filter')].filter(el=>el.style.display!=='none');
check(visibleChips().length===4,'默认显示 4 个状态芯片（全部/已分配/由我分配/未分配）');
const allChip=chipByText(filterContainer,['全部','All']);
const assignedChip=chipByText(filterContainer,['已分配','Assigned']);
const userChip=chipByText(filterContainer,['由我分配','Assigned to me']);
const unassignedChip=chipByText(filterContainer,['未分配','Unassigned']);
check(!!allChip&&!!assignedChip&&!!userChip&&!!unassignedChip,'四个状态芯片齐全');
check(allChip.classList.contains('is-active'),'默认激活“全部”');
check(filterContainer.querySelector('.setting-group-filter.mod-error').style.display==='none','无冲突时冲突芯片隐藏');

assignedChip.click();await wait(60);
check(assignedChip.classList.contains('is-active')&&!allChip.classList.contains('is-active'),'点击“已分配”切换激活态');
const assignedRows=rowsOf(root);
check(assignedRows.length>0&&assignedRows.length<=fullRows,'已分配列表非空且不超过全部');
check(assignedRows.every(row=>row.querySelector('.setting-command-hotkeys .setting-hotkey')),'已分配行都有快捷键胶囊');
allChip.click();await wait(60);
check(rowsOf(root).length===fullRows,'切回“全部”恢复完整列表');

/* 搜索过滤 */
searchInput.value='insert';
searchInput.dispatchEvent(new Event('input',{bubbles:true}));await wait(60);
check(rowsOf(root).length>0&&rowsOf(root).length<fullRows,'搜索词过滤列表');
searchInput.value='';
searchInput.dispatchEvent(new Event('input',{bubbles:true}));await wait(60);
check(rowsOf(root).length===fullRows,'清空搜索恢复完整列表');

/* 按快捷键筛选 */
await app.plugins.enableInternalPlugin('templates');
app.settings.setHotkey('insert-template',[{modifiers:['Ctrl','Shift'],key:'k'}]);
app.hotkeyManager.buildCustomKeys();
hotkeysTab.updateHotkeyVisibility();await wait(40);
const keyboardIcon=searchRow.querySelector('.input-right-decorator.clickable-icon');
check(!!keyboardIcon&&!!keyboardIcon.querySelector('svg.lucide-keyboard'),'键盘装饰器可点击');
const dispatchKey=opts=>document.body.dispatchEvent(new KeyboardEvent('keydown',Object.assign({bubbles:true,cancelable:true},opts)));
keyboardIcon.click();await wait(40);
check(!!searchRow.querySelector('.search-input-container .setting-hotkey.mod-active'),'点击键盘图标进入捕获态');
dispatchKey({key:'k',ctrlKey:true,shiftKey:true});await wait(60);
check(!searchRow.querySelector('.search-input-container .setting-hotkey.mod-active'),'按下组合键后退出捕获态');
const decorator=searchRow.querySelector('.input-right-decorator.mod-active-hotkey-filter');
check(!!decorator,'按快捷键筛选后装饰器变为组合键芯片');
check(text(decorator).includes('K'),'组合键芯片显示按键');
const boundRows=rowsOf(root);
check(boundRows.length===1,'列表只剩绑定该组合的命令');
check(text(boundRows[0].querySelector('.setting-item-name'))===app.commands.findCommand('insert-template').name,'筛选命中 insert-template');
decorator.querySelector('.hotkey-filter-clear').click();await wait(60);
check(!searchRow.querySelector('.input-right-decorator.mod-active-hotkey-filter'),'清除组合键筛选');
check(rowsOf(root).length===fullRows,'清除后恢复全部列表');

keyboardIcon.click();await wait(40);
check(!!searchRow.querySelector('.search-input-container .setting-hotkey.mod-active'),'再次点击进入捕获态');
dispatchKey({key:'Escape'});await wait(60);
check(!searchRow.querySelector('.search-input-container .setting-hotkey.mod-active'),'Esc 退出捕获态');
check(!searchRow.querySelector('.input-right-decorator.mod-active-hotkey-filter'),'Esc 不残留组合键筛选');
check(rowsOf(root).length===fullRows,'Esc 后恢复全部列表');
check(app.setting.activeTab===hotkeysTab,'Esc 未关闭设置弹窗');

/* 冲突芯片 */
app.commands.addCommand({id:'acceptance-conflict-a',name:'Acceptance Conflict A',callback(){}});
app.commands.addCommand({id:'acceptance-conflict-b',name:'Acceptance Conflict B',callback(){}});
app.settings.setHotkey('acceptance-conflict-a',[{modifiers:['Mod','Shift'],key:'j'}]);
app.settings.setHotkey('acceptance-conflict-b',[{modifiers:['Mod','Shift'],key:'j'}]);
app.hotkeyManager.buildCustomKeys();
hotkeysTab.updateHotkeyVisibility();await wait(60);
const conflictChip=filterContainer.querySelector('.setting-group-filter.mod-error');
check(!!conflictChip&&conflictChip.style.display!=='none','有冲突时冲突芯片显示');
check(!!conflictChip.querySelector('.setting-group-filter-badge'),'冲突芯片带计数徽标');
check(text(conflictChip.querySelector('.setting-group-filter-badge'))==='2','冲突计数为 2');
let conflictChips=[...root.querySelectorAll('.setting-items .setting-hotkey.has-conflict')];
check(conflictChips.length===2,'两条命令的快捷键胶囊带 has-conflict');
searchInput.value='acceptance';
searchInput.dispatchEvent(new Event('input',{bubbles:true}));await wait(40);
check(rowsOf(root).length===2,'搜索 acceptance 命中两条冲突命令');
conflictChips=[...root.querySelectorAll('.setting-items .setting-hotkey.has-conflict')];
conflictChips[0].click();await wait(60);
check(searchInput.value==='','点击冲突胶囊清空搜索');
check(!!searchRow.querySelector('.input-right-decorator.mod-active-hotkey-filter'),'点击冲突胶囊出现组合键筛选');
check(rowsOf(root).length===2,'冲突快捷键筛选命中两条命令');
conflictChip.click();await wait(60);
check(conflictChip.classList.contains('is-active'),'点击冲突芯片激活“显示冲突”');
check(rowsOf(root).length===2,'冲突芯片筛选两条命令');
allChip.click();await wait(40);
searchRow.querySelector('.hotkey-filter-clear').click();await wait(40);
app.settings.setHotkey('insert-template',null);
app.settings.setHotkey('acceptance-conflict-a',null);
app.settings.setHotkey('acceptance-conflict-b',null);
app.commands.removeCommand('acceptance-conflict-a');
app.commands.removeCommand('acceptance-conflict-b');
app.hotkeyManager.buildCustomKeys();
hotkeysTab.updateHotkeyVisibility();await wait(60);
check(filterContainer.querySelector('.setting-group-filter.mod-error').style.display==='none','清除冲突后冲突芯片隐藏');

/* 删除默认快捷键：写入空数组压制默认；恢复按钮删除覆盖 */
const templateCmd=Object.values(app.commands.commands).find((cmd)=>
  app.hotkeyManager.getHotkeys(cmd.id).length>0&&!(cmd.id in app.settings.hotkeys));
check(!!templateCmd,'存在带默认快捷键的命令');
const templateDefaults=app.hotkeyManager.getHotkeys(templateCmd.id).length;
check(templateDefaults>0,'默认快捷键数量大于 0');
const hotkeyRow=()=>rowsOf(root).find((row)=>text(row.querySelector('.setting-item-name'))===templateCmd.name);
for(let i=0;i<templateDefaults;i++){
  const row=hotkeyRow();
  check(!!row,'默认快捷键行存在');
  row.querySelector('.setting-delete-hotkey').click();await wait(40);
}
check(Array.isArray(app.settings.hotkeys[templateCmd.id])&&app.settings.hotkeys[templateCmd.id].length===0,'删除全部默认键后写入空数组');
check(app.hotkeyManager.getHotkeys(templateCmd.id).length===0,'空数组压制默认快捷键');
check(!!hotkeyRow().querySelector('.setting-hotkey.mod-empty'),'无快捷键时显示“未设置”');
hotkeyRow().querySelector('.setting-restore-hotkey-button').click();await wait(40);
check(!(templateCmd.id in app.settings.hotkeys),'恢复默认删除自定义覆盖');
check(app.hotkeyManager.getHotkeys(templateCmd.id).length===templateDefaults,'恢复默认快捷键');

/* 行内录制：点击加号后行内出现 mod-active，按键写入并退出 */
hotkeyRow().querySelector('.setting-add-hotkey-button').click();await wait(40);
check(!!hotkeyRow().querySelector('.setting-hotkey.mod-active'),'点击加号进入行内录制态');
dispatchKey({key:'u',ctrlKey:true,altKey:true,shiftKey:true});await wait(60);
check(!hotkeyRow().querySelector('.setting-hotkey.mod-active'),'按键后退出录制态');
check((app.settings.hotkeys[templateCmd.id]||[]).some(hk=>hk.key==='u'&&hk.modifiers.includes('Ctrl')&&hk.modifiers.includes('Alt')&&hk.modifiers.includes('Shift')),'录制组合键写入配置');
app.settings.setHotkey(templateCmd.id,null);
app.hotkeyManager.buildCustomKeys();
hotkeysTab.updateHotkeyVisibility();await wait(40);

/* ================= B. 核心插件页 ================= */
const pluginsTab=app.setting.openTabById('plugins');
await wait(150);
check(!!pluginsTab&&app.setting.activeTab===pluginsTab,'核心插件页打开');
const tabEl=pluginsTab.containerEl;
/* 核心插件页签归入“核心插件”分组，且不污染“选项”分组 */
const optionsNavs2=[...document.querySelectorAll('.vertical-tab-header-group-items[data-section="options"] .vertical-tab-nav-item')].map(n=>n.getAttribute('data-setting-id'));
check(optionsNavs2.join(',')==='about,appearance,interface,editor,file,hotkeys,plugins','切换页签后选项分组结构不变');
const pluginGroup=tabEl.querySelector('.setting-group.mod-list');
check(!!pluginGroup,'核心插件设置组带 mod-list');
const pluginSearchRow=pluginGroup.querySelector('.setting-group-search');
check(!!pluginSearchRow.querySelector(':scope > .search-input-container input[type=search]'),'核心插件搜索框直接挂在搜索行');
check(document.activeElement===tabEl.querySelector('input[type=search]'),'核心插件页搜索框自动聚焦');
await app.plugins.enableInternalPlugin('templates');
pluginsTab.render(true);await wait(120);
const manifest=app.plugins.getInternalPlugin('templates').manifest;
const rowByName=()=>rowsOf(tabEl).find(el=>text(el.querySelector('.setting-item-name'))===manifest.name);
const extraOf=(row,icon)=>row&&[...row.querySelectorAll('.extra-setting-button')].find(b=>b.querySelector('svg.'+icon));
const gearVisible=()=>{const g=extraOf(rowByName(),'lucide-settings');return !!g&&g.style.display!=='none'};
const hotkeyVisible=()=>{const h=extraOf(rowByName(),'lucide-plus-circle');return !!h&&h.style.display!=='none'};
check(!!rowByName(),'templates 行存在');
check(gearVisible(),'启用后设置齿轮可见');
check(hotkeyVisible(),'启用后快捷键入口可见');
const stableRow=rowByName();
stableRow.querySelector('.checkbox-container').click();
await until(()=>!app.plugins.getInternalPlugin('templates').enabled,'开关关闭 templates');
await until(()=>!gearVisible(),'禁用后设置齿轮隐藏');
check(rowByName()===stableRow,'禁用后行元素未被重建');
check(!!rowByName(),'禁用后行保留');
check(!hotkeyVisible(),'禁用后快捷键入口隐藏');
stableRow.querySelector('.checkbox-container').click();
await until(()=>app.plugins.getInternalPlugin('templates').enabled&&hotkeyVisible(),'重新开启后快捷键入口恢复');
check(gearVisible(),'重新开启后设置齿轮恢复');
const pluginSearch=tabEl.querySelector('input[type=search]');
const pluginFullRows=rowsOf(tabEl).length;
pluginSearch.value=String(manifest.name).toLowerCase();
pluginSearch.dispatchEvent(new Event('input',{bubbles:true}));await wait(60);
check(rowsOf(tabEl).length>=1&&rowsOf(tabEl).length<pluginFullRows&&!!rowByName(),'插件搜索过滤列表并保留 templates');
pluginSearch.value='';
pluginSearch.dispatchEvent(new Event('input',{bubbles:true}));await wait(60);
check(rowsOf(tabEl).length===pluginFullRows,'清空插件搜索恢复列表');
pluginSearch.value='zzzz-no-plugin';
pluginSearch.dispatchEvent(new Event('input',{bubbles:true}));await wait(60);
check(rowsOf(tabEl).length===1&&!!rowsOf(tabEl)[0].classList.contains('mod-empty-state'),'插件搜索无结果显示空态');
pluginSearch.value='';
pluginSearch.dispatchEvent(new Event('input',{bubbles:true}));await wait(60);
extraOf(rowByName(),'lucide-plus-circle').click();await wait(120);
check(app.setting.activeTab&&app.setting.activeTab.id==='hotkeys','点击快捷键入口切到快捷键页');
const hkInput=app.setting.activeTab.containerEl.querySelector('.setting-group-search > .search-input-container input[type=search]');
check(!!hkInput&&hkInput.value.includes('templates'),'快捷键页搜索框填入插件 id');
check(document.activeElement===hkInput,'快捷键页搜索框聚焦');

/* 插件自己的设置页签归入“核心插件”分组（原版 1.14.4） */
app.setting.open();await wait(150);
app.setting.openTabById('plugins');await wait(200);
const templatesRow=rowsOf(app.setting.activeTab.containerEl).find(el=>text(el.querySelector('.setting-item-name'))===app.plugins.getInternalPlugin('templates').manifest.name);
check(!!templatesRow,'核心插件页仍有 templates 行');
const templatesGear=[...templatesRow.querySelectorAll('.extra-setting-button')].find(b=>b.querySelector('svg.lucide-settings'));
check(!!templatesGear,'templates 行有设置齿轮');
templatesGear.click();await wait(250);
const corePluginNavs=[...document.querySelectorAll('.vertical-tab-header-group-items[data-section="core-plugins"] .vertical-tab-nav-item')].map(n=>n.getAttribute('data-setting-id'));
check(corePluginNavs.length>0,'核心插件分组有插件页签');
check(!corePluginNavs.includes('plugins'),'核心插件分组不含内置的 plugins 页签');
check(!corePluginNavs.includes('interface'),'核心插件分组不含界面页签');
const optionsNavs3=[...document.querySelectorAll('.vertical-tab-header-group-items[data-section="options"] .vertical-tab-nav-item')].map(n=>n.getAttribute('data-setting-id'));
check(optionsNavs3.join(',')==='about,appearance,interface,editor,file,hotkeys,plugins','插件页签注册后选项分组结构不变');
check(!!app.setting.activeTab&&app.setting.activeTab.group==='core','插件设置页签归入 core 分组');

/* locale 键：按原版 i18n 补齐的键必须存在且是原版译文（不是 tt() 兜底） */
const localePath=require('path').resolve(process.cwd(),'src/renderer/locales');
let zhLocale={};let enLocale={};
try { zhLocale=JSON.parse(require('fs').readFileSync(require('path').join(localePath,'locale-zh.json'),'utf8')); } catch(e) {}
try { enLocale=JSON.parse(require('fs').readFileSync(require('path').join(localePath,'locale-en.json'),'utf8')); } catch(e) {}
check(Object.keys(zhLocale).length>2000&&Object.keys(enLocale).length>2000,'locale JSON 可读且键数正常');
const expectLocale=[
  ['setting.interface.name','界面','Interface'],
  ['setting.interface.option-mobile','移动端','Mobile'],
  ['setting.interface.option-advanced','高级','Advanced'],
  ['setting.appearance.option-css-snippets-description','管理用于调整应用外观的 CSS 文件集合。',"Manage your collection of CSS files for tweaking the app's appearance."],
  ['setting.appearance.label-enabled-snippets-count','已启用 {{count}} 个','{{count}} enabled'],
  ['setting.appearance.label-font-count','{{count}} 种字体','{{count}} font'],
  ['setting.appearance.label-font-count_plural','{{count}} 种字体','{{count}} fonts'],
  ['setting.file.label-add-excluded-filter','添加排除项...','Add exclusion...'],
  ['setting.file.label-no-excluded-filters','未添加排除项。','No exclusions added.'],
  ['setting.file.label-excluded-files-count','{{count}} 条规则','{{count}} rule'],
  ['setting.file.label-excluded-files-count_plural','{{count}} 条规则','{{count}} rules'],
  ['setting.file.title-add-excluded-filter','添加排除项','Add exclusion'],
  ['setting.file.help-excluded-filter','输入路径或正则表达式，例如 /daily-.*/','Enter a path or a regular expression, e.g. /daily-.*/'],
  ['setting.search-settings','搜索设置...','Search settings...'],
  ['setting.no-search-results','未找到设置。','No settings found.'],
  ['setting.search-show-more','还有 {{count}} 个','{{count}} more'],
];
for (const [key,zh,en] of expectLocale) {
  check(zhLocale[key]===zh&&enLocale[key]===en,'locale 键 '+key+' 为原版译文 :: zh='+JSON.stringify(zhLocale[key])+' en='+JSON.stringify(enLocale[key]));
}

if(app.setting&&app.setting.close)app.setting.close();
await app.saveLayout();
return {pass:true,count};
})()
