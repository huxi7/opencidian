/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: appearance 场景：主题列表（现代主题/旧版主题）、旧版主题实际生效（themes/<name>.css）、主题管理弹窗（社区主题骨架/搜索/计数/徽标/使用）、字体子页面（说明段/当前字体列表/建议组/缺失提示/增删/数量回显）、主题色恢复默认、半透明效果、CSS 样式代码片段子页面（列表/启用/空态）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const wait=ms=>new Promise(r=>setTimeout(r,ms));const ok=(b,m)=>{if(!b)throw Error(m)};
let count=0;const check=(b,m)=>{count++;ok(b,m)};
const cssRules=()=>{const out=[];const walk=(list)=>{for(const r of list){if(r.cssRules&&r.cssRules.length)walk(r.cssRules);else if(r.selectorText)out.push(r);}};for(const ss of document.styleSheets){try{walk(ss.cssRules);}catch(e){}}return out;};
const fsc=require('fs');const pth=require('path');
const rowByName=(root,re)=>[...root.querySelectorAll('.setting-item')].find((el)=>{
  const n=el.querySelector('.setting-item-name');return n&&re.test(n.textContent||'');});
const text=el=>String((el&&el.textContent)||'').trim();
const pageEl=()=>document.querySelector('.vertical-tab-content-container > .setting-page');
const modalByTitle=(re)=>[...document.querySelectorAll('.modal:not(.is-hidden)')].find((m)=>{
  const t=m.querySelector('.modal-title');return t&&re.test(t.textContent||'');});

// 预置主题目录：现代主题（manifest.json + theme.css）与旧版主题（themes/ 下的裸 .css）
const themesDir=pth.join(app.settings.dir,'themes');
const modernDir=pth.join(themesDir,'ModernAcceptanceTheme');
fsc.mkdirSync(modernDir,{recursive:true});
fsc.writeFileSync(pth.join(modernDir,'manifest.json'),JSON.stringify({name:'ModernAcceptanceTheme'}));
fsc.writeFileSync(pth.join(modernDir,'theme.css'),'/* modern theme */');
fsc.writeFileSync(pth.join(themesDir,'LegacyAcceptanceTheme.css'),'/* legacy-theme-marker */');
// 预置 CSS 片段
const snippetsDir=pth.join(app.settings.dir,'snippets');
fsc.mkdirSync(snippetsDir,{recursive:true});
fsc.writeFileSync(pth.join(snippetsDir,'accept.css'),'/* snippet */');
fsc.writeFileSync(pth.join(snippetsDir,'other.css'),'/* snippet */');

app.settings.updateAppearance({ accentColor: '#ff0000' });
app.setting.open();app.setting.openTabById('appearance');await wait(250);
const tab=app.setting.activeTab.containerEl;
check(!!tab&&tab.isConnected,'外观页打开');
const groupEl=tab.querySelector('.setting-group');
check(!!groupEl,'设置组存在');
const groupStyle=getComputedStyle(groupEl);
check(parseFloat(groupStyle.maxWidth)<=700.5,'设置组最大宽度 700px（原版 --setting-group-max-width）:: '+groupStyle.maxWidth);
check(parseFloat(groupStyle.width)<=700.5,'设置组实际宽度不超过 700px :: '+groupStyle.width);
const firstItem=groupEl.querySelector('.setting-items > .setting-item');
check(getComputedStyle(firstItem).alignItems==='flex-start','设置行顶部对齐（描述换行时不挤压控件）');
const padProbe=document.body.createDiv();
padProbe.style.paddingLeft='var(--setting-items-padding-x)';
const padX=getComputedStyle(padProbe).paddingLeft;padProbe.detach();
check(getComputedStyle(firstItem).paddingLeft===padX,'设置行左内边距=--setting-items-padding-x :: '+getComputedStyle(firstItem).paddingLeft+' / '+padX);

/* 主题下拉：现代主题与旧版主题（原版 themes/ 下的裸 .css 才是旧版主题） */
const themeRow=rowByName(tab,/^主题$|^Themes$/);
check(!!themeRow,'主题行存在');
const opts=[...themeRow.querySelectorAll('option')].map((o)=>o.textContent);
check(opts.some((t)=>/LegacyAcceptanceTheme \(Legacy\)/.test(t)),'旧主题显示 (Legacy) 后缀');
check(opts.includes('ModernAcceptanceTheme'),'新主题正常显示');
check(!opts.some((t)=>/ModernAcceptanceTheme \(Legacy\)/.test(t)),'新主题不带 Legacy 后缀');
check(opts.some((t)=>/^默认$|^Default$/.test(t)),'主题下拉含默认项');
const installedRow=rowByName(tab,/已安装主题|Installed themes/);
check(!!installedRow,'已安装主题行存在');
check(/2/.test(text(installedRow)),'已安装主题计数为 2 :: '+text(installedRow));

/* 主题管理弹窗（原版：社区主题弹窗骨架） */
const manageTheme=[...themeRow.querySelectorAll('button')].find((b)=>/管理|Manage/.test(b.textContent||''));
check(!!manageTheme,'主题行有管理按钮');
manageTheme.click();await wait(250);
const themeModal=modalByTitle(/已安装主题|Installed themes/);
check(!!themeModal,'主题管理弹窗打开');
check(themeModal.classList.contains('mod-community-modal'),'主题弹窗带 mod-community-modal');
check(themeModal.classList.contains('mod-sidebar-layout'),'主题弹窗带 mod-sidebar-layout');
check(themeModal.classList.contains('mod-community-theme'),'主题弹窗带 mod-community-theme');
check(!!themeModal.querySelector('.community-modal-search input[type=search]'),'主题弹窗有搜索框');
check(/搜索/.test(themeModal.querySelector('.community-modal-search input').getAttribute('placeholder')||''),'主题弹窗搜索框占位文案为搜索…');
check(!!themeModal.querySelector('.community-modal-search-summary'),'主题弹窗有结果计数');
check(/显示 3 个主题/.test(text(themeModal.querySelector('.community-modal-search-summary'))),'主题弹窗计数为显示 3 个主题 :: '+text(themeModal.querySelector('.community-modal-search-summary')));
const themeCards=[...themeModal.querySelectorAll('.community-item')];
check(themeCards.length===3,'主题弹窗列出默认 + 两个主题 :: '+themeCards.length);
check(!!themeCards[0].querySelector('.community-item-name'),'主题卡片有名称');
check(!!themeCards[0].querySelector('.community-item-screenshot'),'主题卡片有截图位');
check(!!themeCards[0].querySelector('.community-item-screenshot.mod-unavailable .placeholder-icon svg'),'无截图时显示占位图标');
check(/Legacy/.test(text(themeCards[2].querySelector('.community-item-name'))),'旧版主题卡片带 Legacy 徽标');
const useBtn=[...themeModal.querySelectorAll('.community-modal-button-container button')].find((b)=>/使用|Use/.test(text(b)));
check(!!useBtn,'主题弹窗有使用按钮');
check(useBtn.disabled===true,'未切换主题时使用按钮禁用');
themeCards[1].click();await wait(120);
const themeModal2=modalByTitle(/已安装主题|Installed themes/);
const useBtn2=[...themeModal2.querySelectorAll('.community-modal-button-container button')].find((b)=>/使用|Use/.test(text(b)));
check(useBtn2.disabled===false,'选中主题后使用按钮可用');
useBtn2.click();await wait(200);
check(app.settings.appearance.cssTheme==='ModernAcceptanceTheme','使用主题写入 appearance.cssTheme :: '+app.settings.appearance.cssTheme);
app.setting.openTabById('appearance');await wait(200);
const themeRow2=rowByName(app.setting.activeTab.containerEl,/^主题$|^Themes$/);
check(themeRow2.querySelector('select').value==='ModernAcceptanceTheme','主题下拉回显当前主题');
const activeThemeRow=rowByName(app.setting.activeTab.containerEl,/已安装主题|Installed themes/);
check(!!activeThemeRow,'已安装主题行仍在');
app.settings.updateAppearance({ cssTheme: '' });

/* 字体子页面（原版 1.14.4：三行字体都是 type:"page" 可导航子页面） */
const fontRow=rowByName(app.setting.activeTab.containerEl,/界面字体|Interface font/);
check(!!fontRow,'界面字体行存在');
check(fontRow.classList.contains('mod-navigable')&&fontRow.classList.contains('tappable'),'字体行是可导航行（原版 mod-navigable tappable）');
check(!!fontRow.querySelector('.setting-item-chevron svg.lucide-chevron-right'),'字体行有 chevron-right 箭头');
check(!fontRow.querySelector('button'),'字体行没有管理按钮（原版是子页面）');
fontRow.click();await wait(250);
let fontPage=pageEl();
check(!!fontPage,'字体子页面打开');
check(text(fontPage.querySelector('.setting-page-title'))==='界面字体','字体页标题为界面字体');
const pageDesc=fontPage.querySelector('p.setting-page-desc');
check(!!pageDesc,'字体页有说明段 setting-page-desc');
check(/未指定自定义字体/.test(text(pageDesc)),'无字体时说明为未指定自定义字体');
const pageGroups=fontPage.querySelectorAll('.setting-group.mod-list');
check(pageGroups.length===2,'字体页有两个 mod-list 组 :: '+pageGroups.length);
const suggestGroup=pageGroups[1];
const suggestInput=suggestGroup.querySelector('.setting-group-search input[type=search]');
check(!!suggestInput,'建议组搜索框存在');
check(/请输入字体名称/.test(suggestInput.getAttribute('placeholder')||''),'建议组搜索框占位为请输入字体名称…');
suggestInput.value='AcceptanceFontXYZ';
suggestInput.dispatchEvent(new Event('input',{bubbles:true}));await wait(220);
const manualRow=[...suggestGroup.querySelectorAll('.setting-item')].find((el)=>/AcceptanceFontXYZ/.test(text(el.querySelector('.setting-item-name'))));
check(!!manualRow,'手输字体名出现在建议列表');
check(!!manualRow.querySelector('.setting-item-description.mod-warning'),'系统中不存在的字体给出 mod-warning 提示');
check(!!manualRow.querySelector('.setting-item-name'),'建议行有名称');
manualRow.click();await wait(250);
check(/AcceptanceFontXYZ/.test(String(app.settings.appearance.interfaceFontFamily||'')),'添加字体写入 appearance.interfaceFontFamily');
fontPage=pageEl();
const listGroup=fontPage.querySelectorAll('.setting-group.mod-list')[0];
const fontRow2=[...listGroup.querySelectorAll('.setting-item')].find((el)=>/AcceptanceFontXYZ/.test(text(el.querySelector('.setting-item-name'))));
check(!!fontRow2,'当前字体列表出现新字体');
check(/AcceptanceFontXYZ/.test(fontRow2.querySelector('.setting-item-name').style.fontFamily),'字体名按自身字体预览');
check(!!fontRow2.querySelector('.extra-setting-button.mod-drag-handle'),'字体行有拖拽手柄');
const fontDelete=fontRow2.querySelector('.extra-setting-button:not(.mod-drag-handle)');
check(!!fontDelete&&/删除|Delete/.test(fontDelete.getAttribute('aria-label')||''),'字体行有删除按钮');
fontDelete.click();await wait(250);
check(!/AcceptanceFontXYZ/.test(String(app.settings.appearance.interfaceFontFamily||'')),'删除字体生效');
fontPage.querySelector('.setting-page-back-button').click();await wait(180);
check(!pageEl(),'字体页返回后子页面关闭');
app.settings.updateAppearance({interfaceFontFamily:'Arial'});
app.setting.openTabById('appearance');await wait(220);
const fontRow3=rowByName(app.setting.activeTab.containerEl,/界面字体|Interface font/);
check(/1 种字体|1 font/.test(text(fontRow3.querySelector('.setting-item-value'))),'字体行显示字体数量 :: '+text(fontRow3.querySelector('.setting-item-value')));
app.settings.updateAppearance({interfaceFontFamily:''});

/* 自定义应用图标行（桌面） */
app.setting.openTabById('appearance');await wait(150);
const iconRow=rowByName(app.setting.activeTab.containerEl,/自定义应用图标|Custom app icon/);
check(!!iconRow,'自定义图标行存在');
check([...iconRow.querySelectorAll('button')].some((b)=>/选择|Choose/.test(b.textContent||'')),'自定义图标有选择按钮');
const iconReset=iconRow.querySelector('.extra-setting-button');
check(!!iconReset,'自定义图标有恢复默认按钮');
check(iconReset.style.display==='none','无自定义图标时恢复默认按钮隐藏');
check(require('electron').ipcRenderer.sendSync('get-icon')===null,'初始状态无自定义图标');

/* 半透明效果（原版 1.14.4 外观页高级组） */
const translucentRow=rowByName(app.setting.activeTab.containerEl,/半透明效果|Translucent/);
check(!!translucentRow,'半透明效果行存在');
check(/高级|Advanced/.test(text(translucentRow.closest('.setting-group').querySelector('.setting-item-heading .setting-item-name'))),'半透明效果位于高级组');
const translucentToggle=translucentRow.querySelector('.checkbox-container');
check(!!translucentToggle&&!translucentToggle.classList.contains('is-enabled'),'半透明效果默认关闭');
translucentToggle.click();await wait(80);
check(app.settings.appearance.translucency===true,'半透明效果写入 appearance.translucency');
check(document.body.classList.contains('mod-translucent'),'半透明效果给 body 加 mod-translucent 类');
translucentToggle.click();await wait(80);
check(app.settings.appearance.translucency===false,'半透明效果可关闭');
check(!document.body.classList.contains('mod-translucent'),'关闭后移除 mod-translucent 类');

/* CSS 样式代码片段：原版是可导航子页面 */
const snippetRow=rowByName(app.setting.activeTab.containerEl,/CSS (样式)?代码片段|CSS snippets/);
check(!!snippetRow,'CSS 样式代码片段行存在');
check(snippetRow.classList.contains('mod-navigable')&&snippetRow.classList.contains('tappable'),'CSS 片段行是可导航行');
check(/已启用 0 个/.test(text(snippetRow.querySelector('.setting-item-value'))),'CSS 片段行显示已启用数量 :: '+text(snippetRow.querySelector('.setting-item-value')));
check(!!snippetRow.querySelector('.setting-item-chevron svg.lucide-chevron-right'),'CSS 片段行有箭头');
snippetRow.click();await wait(200);
let page=pageEl();
check(!!page,'CSS 片段子页面打开');
check(text(page.querySelector('.setting-page-title'))==='CSS 代码片段'||text(page.querySelector('.setting-page-title'))==='CSS 样式代码片段','CSS 片段页标题正确');
check(page.querySelector('.setting-group').classList.contains('mod-list'),'CSS 片段页列表组带 mod-list');
check(page.querySelector('.setting-group').classList.contains('mod-no-icon'),'CSS 片段页列表组带 mod-no-icon');
const snippetExtra=[...page.querySelectorAll('.extra-setting-button')];
check(snippetExtra.length===2,'CSS 片段页有两个行尾按钮');
check(/重新加载/.test(snippetExtra[0].getAttribute('aria-label')||''),'第一个按钮是重新加载代码片段');
check(/打开.*代码片段文件夹/.test(snippetExtra[1].getAttribute('aria-label')||''),'第二个按钮是打开代码片段文件夹 :: '+(snippetExtra[1].getAttribute('aria-label')||''));
const snippetRows=[...page.querySelectorAll('.setting-items > .setting-item')];
check(snippetRows.length===2,'CSS 片段页列出两个片段 :: '+snippetRows.length);
check(!!snippetRows[0].querySelector('.checkbox-container'),'片段行有开关');
check(!!snippetRows[0].querySelector('.setting-item-name'),'片段行有名称');
snippetRows[0].querySelector('.checkbox-container').click();await wait(120);
check((app.settings.appearance.enabledCssSnippets||[]).length===1,'启用片段写入 enabledCssSnippets');
check((app.settings.appearance.enabledCssSnippets||[])[0]===text(snippetRows[0].querySelector('.setting-item-name')),'启用的是第一个片段');
page=pageEl();
const snippetRows2=[...page.querySelectorAll('.setting-items > .setting-item')];
check(snippetRows2[0].querySelector('.checkbox-container').classList.contains('is-enabled'),'重新渲染后开关状态保持');
snippetRows2[0].querySelector('.checkbox-container').click();await wait(120);
check((app.settings.appearance.enabledCssSnippets||[]).length===0,'再次点击关闭片段');
page.querySelector('.setting-page-back-button').click();await wait(120);
check(!pageEl(),'CSS 片段页返回后子页面关闭');

/* 旧版主题（themes/ 下的裸 .css）也能生效：原版 customCss.getThemePath 读 themes/<name>.css */
app.setting.openTabById('appearance');await wait(220);
const legacyThemeRow=rowByName(app.setting.activeTab.containerEl,/^主题$|^Themes$/);
const legacyOption=[...legacyThemeRow.querySelectorAll('option')].find((o)=>/LegacyAcceptanceTheme/.test(o.textContent||''));
check(!!legacyOption,'主题下拉含旧版主题项');
legacyThemeRow.querySelector('select').value='LegacyAcceptanceTheme';
legacyThemeRow.querySelector('select').dispatchEvent(new Event('change',{bubbles:true}));await wait(350);
check(app.settings.appearance.cssTheme==='LegacyAcceptanceTheme','选择旧版主题写入 cssTheme');
const themeStyleEl=document.getElementById('obsidian-theme-css');
check(!!themeStyleEl,'旧版主题注入 style 元素');
check(/legacy-theme-marker/.test(themeStyleEl.textContent||''),'旧版主题 CSS 实际生效');
check(themeStyleEl.getAttribute('data-css-theme')==='LegacyAcceptanceTheme','style 元素记录主题名');
app.settings.updateAppearance({cssTheme:''});await wait(250);
check(!document.getElementById('obsidian-theme-css'),'取消主题后 style 元素被移除');

/* 主题色恢复默认 */
app.setting.openTabById('appearance');await wait(150);
const accentRow=rowByName(app.setting.activeTab.containerEl,/主题色|Accent color/);
check(!!accentRow,'主题色行存在');
const resetBtn=accentRow.querySelector('.extra-setting-button');
check(!!resetBtn,'主题色有恢复默认按钮');
check(resetBtn.getAttribute('aria-disabled')==='false','已有主题色时恢复按钮可用');
resetBtn.click();await wait(250);
check(!app.settings.appearance.accentColor,'重设后清空 accentColor 配置');
check(!document.body.style.getPropertyValue('--accent-h'),'重设后移除内联 --accent-h，恢复主题默认');
check(resetBtn.getAttribute('aria-disabled')==='true','重设后恢复按钮 aria-disabled');
const colorInput=accentRow.querySelector('input[type=color]');
check(/^#[0-9a-f]{6}$/i.test(colorInput.value)&&colorInput.value!=='#ff0000','重设后色块回到主题默认色');
app.setting.close();
return {pass:true,count};
})()
