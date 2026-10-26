/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回 {pass,count,checks} 断言回执；失败抛出异常。
 * [POS]: settings-ui 场景：侧栏页签顺序（含原版独立的“界面”页签）、侧栏全局搜索（位置/结构/跨页签过滤/命中高亮/还有 N 个/跳转闪烁/清空 + 原版 aliases 别名三路匹配：别名挂载、别名命中、别名命中不高亮、名称命中仍高亮、描述命中不高亮、别名命中跳转闪烁）、界面页（标题栏/功能区/缩放/原生菜单/窗口边框/新窗口设置）、功能区子页面、编辑器（拼写词典/语言胶囊/Not available/Vim 验证/默认模式同步）、文件页（路径建议、忽略文件子页面与新增表单、附件位置、重建缓存）、关于页（版本行、检查更新、可以更新行、语言重启状态、硬件加速、启动时间弹窗）；
 *        并锁住导航无 hover、开关无 hover 阴影、按钮/输入无过渡与输入 focus 焦点环。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const wait=ms=>new Promise(r=>setTimeout(r,ms));const ok=(b,m)=>{if(!b)throw Error(m)};
const checks=[];let count=0;const check=(b,m)=>{count++;ok(b,m);checks.push(m)};
const cssRules=()=>{const out=[];const walk=(list)=>{for(const r of list){if(r.cssRules&&r.cssRules.length)walk(r.cssRules);else if(r.selectorText)out.push(r);}};for(const ss of document.styleSheets){try{walk(ss.cssRules);}catch(e){}}return out;};
const colorOf=(name)=>{const probe=document.createElement('div');probe.style.color='var('+name+')';document.body.appendChild(probe);const c=getComputedStyle(probe).color;probe.remove();return c;};
const rowByName=(root,re)=>[...root.querySelectorAll('.setting-item')].find((el)=>{
  const n=el.querySelector('.setting-item-name');return n&&re.test(n.textContent||'');});
const text=el=>String((el&&el.textContent)||'').trim();
const modalByTitle=(re)=>[...document.querySelectorAll('.modal:not(.is-hidden)')].find((m)=>{
  const t=m.querySelector('.modal-title');return t&&re.test(t.textContent||'');});
const pageEl=()=>document.querySelector('.vertical-tab-content-container > .setting-page');

/* ---------------- 侧栏页签顺序（原版 1.14.4：关于/外观/界面/编辑器/文件与链接/快捷键/核心插件） ---------------- */
app.setting.open();app.setting.openTabById('editor');await wait(150);
let editorTab=app.setting.activeTab.containerEl;
check(!!editorTab&&editorTab.isConnected,'编辑器页打开');
const navOrder=[...document.querySelectorAll('.vertical-tab-header-group-items[data-section="options"] .vertical-tab-nav-item')].map(n=>n.getAttribute('data-setting-id'));
check(navOrder.join(',')==='about,appearance,interface,editor,file,hotkeys,plugins','侧栏顺序对齐原版（关于/外观/界面/编辑器/文件/快捷键/核心插件）:: '+navOrder.join(','));
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

/* ---------------- 侧栏全局搜索（原版 1.14.4：跨页签搜索设置项） ---------------- */
const searchContainer=document.querySelector('.setting-search-container');
check(!!searchContainer,'设置侧栏有搜索容器');
const searchInput=searchContainer.querySelector('input[type=search]');
check(!!searchInput,'搜索框是 type=search');
check(searchInput.getAttribute('enterkeyhint')==='search','搜索框 enterkeyhint=search');
check(searchInput.getAttribute('placeholder')==='搜索设置...','搜索框占位为搜索设置... :: '+(searchInput.getAttribute('placeholder')||''));
check(!!searchContainer.querySelector('.search-input-clear-button'),'搜索框有清除钮');
const sideHeader=document.querySelector('.vertical-tab-header');
check(sideHeader.children[0]===searchContainer,'搜索容器在侧栏顶部');
check(!!sideHeader.querySelector('.setting-search-results'),'侧栏有搜索结果容器');
check(!!sideHeader.querySelector('.vertical-tab-header-group-container'),'页签分组在 group-container 里');
check(getComputedStyle(searchContainer).paddingTop!=='0px','搜索容器有上内边距');
const groupContainer=sideHeader.querySelector('.vertical-tab-header-group-container');
const resultsEl=sideHeader.querySelector('.setting-search-results');
check(getComputedStyle(resultsEl).display==='none','无查询时结果区隐藏');
// 跨页签过滤
searchInput.value='主题';
searchInput.dispatchEvent(new Event('input',{bubbles:true}));await wait(260);
check(getComputedStyle(resultsEl).display!=='none','有查询时结果区可见');
check(getComputedStyle(groupContainer).display==='none','有查询时页签分组隐藏');
const resultGroups=resultsEl.querySelectorAll('.setting-search-result-group');
check(resultGroups.length>=2,'结果跨页签分组:: '+resultGroups.length);
const resultTabLabels=[...resultsEl.querySelectorAll('.setting-search-result-tab-label')].map((el)=>text(el));
check(resultTabLabels.includes('外观'),'结果含外观页签');
check(resultTabLabels.includes('界面'),'结果含界面页签（跨页签匹配描述）');
const resultItems=[...resultsEl.querySelectorAll('.setting-search-result-item .vertical-tab-nav-item-title')].map((el)=>text(el));
check(resultItems.some((t)=>/主题/.test(t)),'结果含主题相关设置项');
check(!!resultsEl.querySelector('.suggestion-highlight'),'命中文字用 suggestion-highlight 高亮');
check(!!resultsEl.querySelector('.setting-search-result-tab .vertical-tab-nav-item-icon svg'),'结果组带页签图标');
check(!!resultsEl.querySelector('.setting-search-result-item .vertical-tab-nav-item-chevron svg.lucide-chevron-right'),'结果项带 chevron-right');
// 超过 3 条折叠为“还有 N 个”
searchInput.value='字体';
searchInput.dispatchEvent(new Event('input',{bubbles:true}));await wait(260);
const moreRow=resultsEl.querySelector('.setting-search-result-show-more');
check(!!moreRow,'同组超过 3 条时出现“还有 N 个”行');
check(/还有 \d+ 个|\d+ more/.test(text(moreRow)),'“还有 N 个”文案正确 :: '+text(moreRow));
const hiddenResultItems=[...resultsEl.querySelectorAll('.setting-search-result-item')].filter((el)=>el.style.display==='none');
check(hiddenResultItems.length>0,'多余结果默认隐藏');
moreRow.click();await wait(200);
check(![...resultsEl.querySelectorAll('.setting-search-result-item')].some((el)=>el.style.display==='none'),'点击后展开全部结果');
check(!resultsEl.querySelector('.setting-search-result-show-more'),'展开后“还有 N 个”行移除');
// 点击结果跳转并闪烁高亮
searchInput.value='主题';
searchInput.dispatchEvent(new Event('input',{bubbles:true}));await wait(260);
const themeResult=[...resultsEl.querySelectorAll('.setting-search-result-item')].find((el)=>text(el.querySelector('.vertical-tab-nav-item-title'))==='主题');
check(!!themeResult,'找到主题设置项结果');
themeResult.click();await wait(320);
check(app.setting.activeTab&&app.setting.activeTab.id==='appearance','点击搜索结果跳到外观页');
check(!!document.querySelector('.setting-item.is-flashing'),'跳转后目标设置行 is-flashing 高亮');
// 无结果空态
searchInput.value='zzzz-no-such-setting';
searchInput.dispatchEvent(new Event('input',{bubbles:true}));await wait(240);
check(!!resultsEl.querySelector('.setting-search-empty'),'无命中显示 setting-search-empty 空态');
check(/未找到设置/.test(text(resultsEl.querySelector('.setting-search-empty'))),'空态文案为未找到设置。');
// 清除钮
searchInput.value='主题';
searchInput.dispatchEvent(new Event('input',{bubbles:true}));await wait(220);
check(getComputedStyle(searchContainer.querySelector('.search-input-clear-button')).display!=='none','有输入时清除钮可见');
searchContainer.querySelector('.search-input-clear-button').click();await wait(220);
check(searchInput.value==='','清除钮清空输入');
check(getComputedStyle(resultsEl).display==='none','清除钮隐藏结果区');
check(getComputedStyle(groupContainer).display!=='none','清除钮恢复页签分组');
searchInput.value='';
searchInput.dispatchEvent(new Event('input',{bubbles:true}));await wait(150);

/* ---------------- 全局搜索：别名匹配（原版 1.14.4 loe.search 的 aliases 第三路） ---------------- */
const aliasOf=(row)=>{try{return JSON.parse((row&&row.getAttribute('data-aliases'))||'[]');}catch(e){return [];}};
app.setting.openTabById('appearance');await wait(180);
const appearanceTab=app.setting.activeTab.containerEl;
const baseThemeRow=rowByName(appearanceTab,/^基础颜色$|^Base color scheme$/);
check(!!baseThemeRow,'外观页有基础颜色行');
check(aliasOf(baseThemeRow).some((a)=>/夜间模式/.test(a)&&/配色方案/.test(a)),'基础颜色行带原版别名（深色 浅色 系统 夜间模式 配色方案）:: '+JSON.stringify(aliasOf(baseThemeRow)));
check(!/夜间模式/.test(text(baseThemeRow)),'别名不进设置行文案（原版只显示名称与描述）');
const accentRow=rowByName(appearanceTab,/^主题色$|^Accent color$/);
check(!!accentRow&&aliasOf(accentRow).some((a)=>/高亮/.test(a)&&/主色/.test(a)),'主题色行带原版别名（高亮 品牌 主色）:: '+JSON.stringify(aliasOf(accentRow)));
const themesRow=rowByName(appearanceTab,/^主题$|^Themes$/);
check(!!themesRow&&aliasOf(themesRow).some((a)=>/社区/.test(a)&&/下载/.test(a)),'主题行带原版别名（社区 浏览 安装 下载）:: '+JSON.stringify(aliasOf(themesRow)));
const fontSizeRow=rowByName(appearanceTab,/^字体大小$|^Font size$/);
check(!!fontSizeRow&&aliasOf(fontSizeRow).some((a)=>/文本大小/.test(a)&&/缩放/.test(a)),'字体大小行带原版别名（文本大小 缩放）:: '+JSON.stringify(aliasOf(fontSizeRow)));
app.setting.openTabById('editor');await wait(180);
const editorAliasTab=app.setting.activeTab.containerEl;
const modeAliasRow=rowByName(editorAliasTab,/默认编辑模式|Default editing mode/);
check(!!modeAliasRow&&aliasOf(modeAliasRow).includes('live-preview')&&aliasOf(modeAliasRow).includes('source'),'默认编辑模式行带原版别名（live-preview source）:: '+JSON.stringify(aliasOf(modeAliasRow)));
const searchAlias=async(q)=>{searchInput.value=q;searchInput.dispatchEvent(new Event('input',{bubbles:true}));await wait(280);
  return [...resultsEl.querySelectorAll('.setting-search-result-item')].map((el)=>({
    title:text(el.querySelector('.vertical-tab-nav-item-title')),
    html:(el.querySelector('.vertical-tab-nav-item-title')||{}).innerHTML||'',
    tab:text(el.closest('.setting-search-result-group').querySelector('.setting-search-result-tab-label')),
  }));};
const hit=(rows,title,tab)=>rows.find((r)=>r.title===title&&(!tab||r.tab===tab));
let aliasRows=await searchAlias('夜间模式');
const baseHit=hit(aliasRows,'基础颜色','外观');
check(!!baseHit,'别名「夜间模式」命中基础颜色 :: '+JSON.stringify(aliasRows.map((r)=>r.title+'@'+r.tab)));
check(!!baseHit&&!/suggestion-highlight/.test(baseHit.html),'别名命中的结果行不高亮（原版只高亮名称命中）:: '+(baseHit?baseHit.html:'no row'));
check(!/夜间模式/.test(baseHit?baseHit.html:''),'别名命中的结果行只显示名称（原版不拼别名文案）');
check(!hit(aliasRows,'字体大小'),'别名「夜间模式」不命中字体大小');
check(!hit(aliasRows,'主题色'),'别名「夜间模式」不命中主题色');
aliasRows=await searchAlias('主色');
const accentHit=hit(aliasRows,'主题色','外观');
check(!!accentHit,'别名「主色」命中主题色 :: '+JSON.stringify(aliasRows.map((r)=>r.title+'@'+r.tab)));
check(!!accentHit&&!/suggestion-highlight/.test(accentHit.html),'别名「主色」命中主题色不高亮（原版名称里没有连续的“主色”）:: '+(accentHit?accentHit.html:'no row'));
check(!hit(aliasRows,'基础颜色'),'别名「主色」不命中基础颜色');
check(!hit(aliasRows,'主题'),'别名「主色」不命中主题');
aliasRows=await searchAlias('缩放');
const fontHit=hit(aliasRows,'字体大小','外观');
check(!!fontHit,'别名「缩放」命中字体大小 :: '+JSON.stringify(aliasRows.map((r)=>r.title+'@'+r.tab)));
check(!!fontHit&&!/suggestion-highlight/.test(fontHit.html),'别名「缩放」命中的结果行不高亮');
aliasRows=await searchAlias('文本大小');
check(!!hit(aliasRows,'字体大小'),'别名「文本大小」命中字体大小');
aliasRows=await searchAlias('live-preview');
const modeHit=hit(aliasRows,'默认编辑模式','编辑器');
check(!!modeHit,'别名「live-preview」命中默认编辑模式 :: '+JSON.stringify(aliasRows.map((r)=>r.title+'@'+r.tab)));
check(!!modeHit&&!/suggestion-highlight/.test(modeHit.html),'别名「live-preview」命中的结果行不高亮');
aliasRows=await searchAlias('source');
check(!!hit(aliasRows,'默认编辑模式'),'别名「source」命中默认编辑模式');
aliasRows=await searchAlias('配色方案');
check(!!hit(aliasRows,'基础颜色'),'别名「配色方案」命中基础颜色');
aliasRows=await searchAlias('高亮');
check(!!hit(aliasRows,'主题色'),'别名「高亮」命中主题色');
check(!hit(aliasRows,'基础颜色'),'别名「高亮」不命中基础颜色');
aliasRows=await searchAlias('品牌');
check(!!hit(aliasRows,'主题色'),'别名「品牌」命中主题色');
aliasRows=await searchAlias('下载');
check(!!hit(aliasRows,'主题'),'别名「下载」命中主题');
aliasRows=await searchAlias('安装');
check(!!hit(aliasRows,'主题'),'别名「安装」命中主题');
/* 名称命中仍高亮；描述命中不高亮（原版：只有名称命中才包 suggestion-highlight） */
aliasRows=await searchAlias('主题');
const nameHit=hit(aliasRows,'主题','外观');
check(!!nameHit&&/suggestion-highlight/.test(nameHit.html),'名称命中的结果行高亮 :: '+(nameHit?nameHit.html:'no row'));
const descHit=hit(aliasRows,'原生菜单','界面');
check(!!descHit,'描述命中的结果行仍在列表里 :: '+JSON.stringify(aliasRows.map((r)=>r.title+'@'+r.tab)));
check(!!descHit&&!/suggestion-highlight/.test(descHit.html),'描述命中的结果行不高亮 :: '+(descHit?descHit.html:'no row'));
/* 别名并入后仍守原版上限：每组只显前 3 条 */
const groupCounts=[...resultsEl.querySelectorAll('.setting-search-result-group')].map((g)=>[...g.querySelectorAll('.setting-search-result-item')].filter((el)=>el.style.display!=='none').length);
check(groupCounts.every((n)=>n<=3),'每组最多显示 3 条（原版上限）:: '+JSON.stringify(groupCounts));
/* 别名命中同样可跳转并闪烁 */
aliasRows=await searchAlias('夜间模式');
const aliasRowEl=[...resultsEl.querySelectorAll('.setting-search-result-item')].find((el)=>text(el.querySelector('.vertical-tab-nav-item-title'))==='基础颜色');
check(!!aliasRowEl,'别名命中结果行存在');
aliasRowEl.click();await wait(340);
check(app.setting.activeTab&&app.setting.activeTab.id==='appearance','点击别名命中结果跳到外观页');
check(!!document.querySelector('.setting-item.is-flashing'),'别名命中跳转后目标行 is-flashing');
searchInput.value='';
searchInput.dispatchEvent(new Event('input',{bubbles:true}));await wait(150);

/* ---------------- 界面页（原版 1.14.4 独立页签，图标 lucide-monitor） ---------------- */
app.setting.openTabById('interface');await wait(150);
const ifaceTab=app.setting.activeTab.containerEl;
check(!!ifaceTab&&ifaceTab.isConnected,'界面页打开');
const ifaceNav=document.querySelector('.vertical-tab-nav-item[data-setting-id="interface"]');
check(!!ifaceNav,'侧栏有界面页签');
check(!!ifaceNav.querySelector('.vertical-tab-nav-item-icon svg.lucide-monitor'),'界面页签图标是 lucide-monitor');
check(text(ifaceNav.querySelector('.vertical-tab-nav-item-title'))==='界面','界面页签标题为界面');
const ifaceGroups=[...ifaceTab.querySelectorAll('.setting-group')];
check(ifaceGroups.length===2,'界面页两组（主组 + 高级组）:: '+ifaceGroups.length);
check(!ifaceGroups[0].querySelector('.setting-item-heading'),'界面页主组无标题行');
check(text(ifaceGroups[1].querySelector('.setting-item-heading .setting-item-name'))==='高级','界面页第二组标题为高级');
const viewHeaderRow=rowByName(ifaceTab,/显示标签页标题栏|Show view header/);
check(!!viewHeaderRow&&viewHeaderRow.classList.contains('mod-toggle'),'显示标签页标题栏是开关行');
const showRibbonRow=rowByName(ifaceTab,/显示功能区|Show ribbon/);
check(!!showRibbonRow&&showRibbonRow.classList.contains('mod-toggle'),'显示功能区是开关行');
const ribbonNavRow=rowByName(ifaceTab,/^功能区$|^Ribbon$/);
check(!!ribbonNavRow&&ribbonNavRow.classList.contains('mod-navigable')&&ribbonNavRow.classList.contains('tappable'),'功能区行是可导航行（原版 mod-navigable tappable）');
check(!!ribbonNavRow.querySelector('.setting-item-chevron svg.lucide-chevron-right'),'功能区行有 chevron-right 箭头');
const zoomRow=rowByName(ifaceTab,/缩放比例|Zoom level/);
const zoomSlider=zoomRow.querySelector('input.slider');
check(!!zoomSlider,'缩放比例有滑块');
check(zoomSlider.min==='-2.5'&&zoomSlider.max==='3'&&zoomSlider.step==='0.5','缩放滑块范围 -2.5..3 步长 0.5 :: '+zoomSlider.min+'/'+zoomSlider.max+'/'+zoomSlider.step);
check(!!zoomRow.querySelector('.slider-value'),'缩放比例显示百分比数值');
const zoomReset=zoomRow.querySelector('.extra-setting-button');
check(!!zoomReset&&/恢复默认|Restore/.test(zoomReset.getAttribute('aria-label')||''),'缩放比例有恢复默认按钮');
const nativeMenusRow=rowByName(ifaceTab,/原生菜单|Native menus/);
check(!!nativeMenusRow&&nativeMenusRow.classList.contains('mod-toggle'),'原生菜单是开关行');
const frameRow=rowByName(ifaceTab,/窗口边框样式|Frame style/);
check(!!frameRow,'窗口边框样式行存在');
check(frameRow.querySelectorAll('option').length===3,'窗口边框样式有三个选项');
const frameCta=[...frameRow.querySelectorAll('button')].find((b)=>/重新启动|Relaunch/.test(text(b)));
check(!!frameCta&&frameCta.style.display==='none','窗口边框样式重启按钮默认隐藏');
const popoutRow=rowByName(ifaceTab,/在新窗口中打开设置|Open settings in new window/);
check(!!popoutRow&&popoutRow.classList.contains('mod-toggle'),'在新窗口中打开设置是开关行');
// 落盘键：showViewHeader/showRibbon → appearance.json；settingsPopoutWindow → app.json
const beforeHeader=app.settings.appearance.showViewHeader;
viewHeaderRow.querySelector('.checkbox-container').click();await wait(60);
check(app.settings.appearance.showViewHeader!==beforeHeader,'显示标签页标题栏写入 appearance.showViewHeader');
viewHeaderRow.querySelector('.checkbox-container').click();await wait(60);
check(app.settings.appearance.showViewHeader===beforeHeader,'恢复显示标签页标题栏');
const beforeRibbon=app.settings.appearance.showRibbon;
showRibbonRow.querySelector('.checkbox-container').click();await wait(60);
check(app.settings.appearance.showRibbon!==beforeRibbon,'显示功能区写入 appearance.showRibbon');
showRibbonRow.querySelector('.checkbox-container').click();await wait(60);
check(app.settings.appearance.showRibbon===beforeRibbon,'恢复显示功能区');
const beforePopout=app.settings.appSettings.settingsPopoutWindow;
popoutRow.querySelector('.checkbox-container').click();await wait(320);
check(app.settings.appSettings.settingsPopoutWindow!==beforePopout,'在新窗口中打开设置写入 app.json 的 settingsPopoutWindow');
app.setting.openTabById('interface');await wait(150);
const popoutRow2=rowByName(app.setting.activeTab.containerEl,/在新窗口中打开设置|Open settings in new window/);
popoutRow2.querySelector('.checkbox-container').click();await wait(320);
check(app.settings.appSettings.settingsPopoutWindow===beforePopout,'恢复在新窗口中打开设置');
app.setting.openTabById('interface');await wait(120);

/* ---------------- 功能区子页面（原版 openPage） ---------------- */
const ribbonNavRow2=rowByName(app.setting.activeTab.containerEl,/^功能区$|^Ribbon$/);
ribbonNavRow2.click();await wait(180);
let page=pageEl();
check(!!page,'功能区子页面打开');
check(!!page.querySelector('.setting-page-titlebar'),'子页面有标题栏');
check(!!page.querySelector('.setting-page-back-button svg.lucide-chevron-left'),'子页面返回按钮是 chevron-left');
check(text(page.querySelector('.setting-page-title'))==='功能区','子页面标题为功能区');
check(!!page.querySelector('.setting-group.mod-list'),'子页面列表组带 mod-list');
const ribbonRows=[...page.querySelectorAll('.setting-items > .setting-item')];
check(ribbonRows.length>0,'子页面列出功能区按钮');
check(!!ribbonRows[0].querySelector('.setting-item-icon svg'),'功能区行有图标');
check(!!ribbonRows[0].querySelector('.extra-setting-button.mod-drag-handle'),'功能区行有拖拽手柄');
check(/拖动可调整布局/.test(ribbonRows[0].querySelector('.mod-drag-handle').getAttribute('aria-label')||''),'拖拽手柄 aria-label 为拖动可调整布局');
check(/删除/.test(ribbonRows[0].querySelector('.extra-setting-button:not(.mod-drag-handle)').getAttribute('aria-label')||''),'功能区行有删除按钮');
page.querySelector('.setting-page-back-button').click();await wait(120);
check(!pageEl(),'返回后子页面关闭');
check(!!document.querySelector('.vertical-tab-content-container > .vertical-tab-content'),'返回后页签内容恢复');

/* ---------------- 编辑器页 ---------------- */
app.setting.openTabById('editor');await wait(150);
editorTab=app.setting.activeTab.containerEl;
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

/* 忽略文件：原版 1.14.4 是可导航子页面 + 新增表单弹窗 */
const ignoreRow=rowByName(fileTab,/忽略文件|Excluded files/);
check(!!ignoreRow,'忽略文件行存在');
check(ignoreRow.classList.contains('mod-navigable')&&ignoreRow.classList.contains('tappable'),'忽略文件行是可导航行（原版 mod-navigable tappable）');
check(!!ignoreRow.querySelector('.setting-item-value'),'忽略文件行显示规则条数');
check(/条规则|rules?/.test(text(ignoreRow.querySelector('.setting-item-value'))),'规则条数文案为 N 条规则');
check(!!ignoreRow.querySelector('.setting-item-chevron svg.lucide-chevron-right'),'忽略文件行有 chevron-right 箭头');
ignoreRow.click();await wait(180);
page=pageEl();
check(!!page,'忽略文件子页面打开');
check(!!page.querySelector('.setting-page-titlebar'),'忽略文件页有标题栏');
check(text(page.querySelector('.setting-page-title'))==='忽略文件','忽略文件页标题为忽略文件');
check(page.querySelector('.setting-group').classList.contains('mod-list'),'忽略文件页列表组带 mod-list');
check(page.querySelector('.setting-group').classList.contains('mod-no-icon'),'忽略文件页列表组带 mod-no-icon');
const addFilterBtn=[...page.querySelectorAll('.extra-setting-button')].find((b)=>/添加排除项/.test(b.getAttribute('aria-label')||''));
check(!!addFilterBtn,'忽略文件页有添加按钮');
check(!!page.querySelector('.setting-item.mod-empty-state'),'无规则时显示空态');
check(/未添加排除项/.test(text(page.querySelector('.setting-item.mod-empty-state .setting-item-name'))),'空态文案为未添加排除项。');
addFilterBtn.click();await wait(180);
const addModal=modalByTitle(/添加排除项|Add excluded/);
check(!!addModal,'添加排除项弹窗打开');
check(addModal.classList.contains('mod-lg')&&addModal.classList.contains('mod-form-sheet'),'添加弹窗是 mod-lg mod-form-sheet');
check(!!addModal.querySelector('input[type=text]'),'添加弹窗有输入框');
check(/正则表达式/.test(text(addModal.querySelector('.form-field-help'))),'添加弹窗有正则表达式说明');
const addModalButtons=[...addModal.querySelectorAll('.modal-button-container button')].map(text);
check(addModalButtons.some((t)=>/完成|Done/.test(t)),'添加弹窗有完成按钮');
check(addModalButtons.some((t)=>/取消|Cancel/.test(t)),'添加弹窗有取消按钮');
[...addModal.querySelectorAll('.modal-button-container button')].find((b)=>/完成|Done/.test(text(b))).click();await wait(100);
check(!!modalByTitle(/添加排除项|Add excluded/),'空条件时不关闭弹窗');
check(!!document.querySelector('.notice-message'),'空条件时给出提示');
const addInput=addModal.querySelector('input[type=text]');
addInput.value='/^draft-/';
[...addModal.querySelectorAll('.modal-button-container button')].find((b)=>/完成|Done/.test(text(b))).click();await wait(200);
check((app.settings.appSettings.userIgnoreFilters||[]).includes('/^draft-/'),'新增规则写入 userIgnoreFilters');
page=pageEl();
check(!!page,'新增后回到忽略文件子页面');
const ruleRow=rowByName(page,/draft-/);
check(!!ruleRow,'规则行显示条件');
check(!!ruleRow.querySelector('.flair.mod-flat'),'正则条件显示 flair mod-flat 徽标 :: '+(ruleRow?ruleRow.outerHTML.slice(0,600):'no row'));
check(/Regex/.test(text(ruleRow.querySelector('.flair.mod-flat'))),'徽标文案为 Regex（原版硬编码）');
const delBtn=ruleRow.querySelector('.extra-setting-button');
check(!!delBtn&&/删除|Delete/.test(delBtn.getAttribute('aria-label')||''),'规则行有删除按钮');
delBtn.click();await wait(200);
check(!(app.settings.appSettings.userIgnoreFilters||[]).includes('/^draft-/'),'删除规则生效');
check(!!document.querySelector('.setting-item.mod-empty-state'),'删除后回到空态');
page.querySelector('.setting-page-back-button').click();await wait(120);
check(!pageEl(),'忽略文件页返回后子页面关闭');

const rebuildRow=rowByName(fileTab,/重建仓库缓存|Rebuild vault cache/i);
check(!!rebuildRow&&!rebuildRow.querySelector('button.mod-destructive'),'重建缓存按钮不是危险按钮（原版默认样式）');
check(!!rebuildRow.querySelector('.mod-warning'),'重建缓存描述含警告');
check(!!rebuildRow.querySelector('a[href*="help.obsidian.md"]'),'重建缓存描述含了解更多链接');

/* ---------------- 关于页 ---------------- */
app.setting.openTabById('about');await wait(150);
const aboutTab=app.setting.activeTab.containerEl;
check(!!aboutTab&&aboutTab.isConnected,'关于页打开');
const versionRow=rowByName(aboutTab,/^(版本|Version) /);
const currentVersion=require('electron').ipcRenderer.sendSync('version');
check(!!versionRow,'版本行存在');
check(versionRow.textContent.includes(currentVersion),'版本行使用当前应用版本');
check(/安装程序版本|Installer version/.test(versionRow.textContent||''),'版本行显示安装程序版本');
check([...versionRow.querySelectorAll('a')].some(a=>a.href==='https://github.com/huxi7/opencidian/releases'),'版本行有本仓库更新日志链接');
const checkBtn=[...versionRow.querySelectorAll('button')].find((b)=>/检查更新|Check for updates/.test(text(b)));
check(!!checkBtn,'版本行有检查更新按钮');
check(!checkBtn.classList.contains('mod-cta'),'检查更新按钮不是 CTA（原版普通按钮）');
const updateRow=rowByName(aboutTab,/^可以更新$|^Update Available$/);
check(!!updateRow,'关于页有可以更新行');
check(updateRow.style.display==='none'||!updateRow.isConnected,'可以更新行默认隐藏');
// 检查更新：主进程无更新器时走渲染层版本比较
const {ipcRenderer}=require('electron');
const sentChannels=[];
const origSend=ipcRenderer.send;
ipcRenderer.send=function(channel,...args){sentChannels.push([channel,...args]);return origSend.apply(this,arguments);};
const origFetch=app.requestUrl;
app.requestUrl=async()=>({status:200,body:JSON.stringify({version:'99.0.0',url:'https://example.invalid/download'})});
app.settings.updateAppSettings({updateFeed:'https://example.invalid/feed.json'});
checkBtn.click();
check(checkBtn.classList.contains('mod-loading'),'检查期间按钮显示加载态');
await wait(600);
check(!checkBtn.classList.contains('mod-loading'),'检查结束移除加载态');
const notices=[...document.querySelectorAll('.notice-message')].map(text);
check(notices.some((t)=>/发现新版本 99\.0\.0/.test(t)),'发现新版本时提示版本号 :: '+JSON.stringify(notices));
const noticeCta=[...document.querySelectorAll('.notice-cta')].find((b)=>/更新|Update/.test(text(b)));
check(!!noticeCta,'新版本提示带更新按钮');
noticeCta.click();await wait(120);
check(sentChannels.some((c)=>c[0]==='open-external'&&c[1]==='https://example.invalid/download'),'更新按钮打开下载页');
const updateRowShown=rowByName(app.setting.activeTab.containerEl,/^可以更新$|^Update Available$/);
check(!!updateRowShown&&updateRowShown.style.display!=='none','可以更新行在发现新版本后显示');
check(!!updateRowShown.querySelector('button'),'可以更新行有下载按钮');
// 已是最新
app.requestUrl=async()=>({status:200,body:JSON.stringify({version:currentVersion,url:'https://example.invalid/download'})});
checkBtn.click();await wait(700);
const latestNotices=[...document.querySelectorAll('.notice-message')].map(text);
check(latestNotices.some((t)=>/已是最新版本/.test(t)),'版本一致时提示已是最新版本 :: '+JSON.stringify(latestNotices));
const updateRowHidden=rowByName(app.setting.activeTab.containerEl,/^可以更新$|^Update Available$/);
check(!!updateRowHidden&&(updateRowHidden.style.display==='none'||!updateRowHidden.isConnected),'已是最新时可以更新行隐藏');
app.requestUrl=origFetch;
ipcRenderer.send=origSend;
app.settings.updateAppSettings({updateFeed:null});
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
check(!!hwRow.querySelector('.setting-item-description > div'),'硬件加速描述包一层 div（原版结构）');
check(!!hwRow.querySelector('.mod-warning'),'硬件加速描述含性能警告');
const hwRelaunch=[...hwRow.querySelectorAll('button')].find(b=>/重新启动|Relaunch/.test(text(b)));
check(!!hwRelaunch&&hwRelaunch.style.display==='none','硬件加速未改动时重启按钮隐藏');
/* 落盘位置：硬件加速不写 app.json/appearance.json（原版由主进程 disable-gpu 通道持有） */
const fs2=require('fs');const path2=require('path');
const readJson=(name)=>{try{return JSON.parse(fs2.readFileSync(path2.join(app.settings.dir,name),'utf8')||'{}');}catch(e){return {};}};
const appJsonBefore=JSON.stringify(readJson('app.json'));
const appearanceJsonBefore=JSON.stringify(readJson('appearance.json'));
const gpuDisabledBefore=require('electron').ipcRenderer.sendSync('disable-gpu');
hwRow.querySelector('.checkbox-container').click();await wait(120);
check(require('electron').ipcRenderer.sendSync('disable-gpu')!==gpuDisabledBefore,'硬件加速写主进程 disable-gpu 通道');
check(hwRelaunch.style.display!=='none','硬件加速改动后显示重启按钮');
check(JSON.stringify(readJson('app.json'))===appJsonBefore,'硬件加速不写 app.json');
check(JSON.stringify(readJson('appearance.json'))===appearanceJsonBefore,'硬件加速不写 appearance.json');
require('electron').ipcRenderer.sendSync('disable-gpu',gpuDisabledBefore);
hwRow.querySelector('.checkbox-container').click();await wait(120);
check(require('electron').ipcRenderer.sendSync('disable-gpu')===gpuDisabledBefore,'硬件加速恢复原状态');
/* 落盘位置：在新窗口中打开设置写 app.json 的 settingsPopoutWindow */
const appJson=readJson('app.json');
check('settingsPopoutWindow' in appJson,'在新窗口中打开设置落在 app.json :: '+Object.keys(appJson).join(','));
check(!('settingsPopoutWindow' in readJson('appearance.json')),'在新窗口中打开设置不落 appearance.json');
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
check(!rowByName(app.setting.activeTab.containerEl,/显示标签页标题栏|Show view header/),'外观页不再重复显示标签页标题栏行');
check(!rowByName(app.setting.activeTab.containerEl,/窗口边框样式|Frame style/),'外观页不再重复窗口边框样式行');
app.setting.openTabById('about');await wait(120);
app.setting.close();
return {pass:true,count,checks};
})()
