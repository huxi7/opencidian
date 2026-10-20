/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回视图头结构/行为断言；失败抛出异常，供运行器判定。
 * [POS]: view-header 场景。按原版 1.14.4 钉住：left 导航钮（空视图也有）、面包屑分段与 :empty 隐藏、
 *        mod-fade 渐隐条件、聚焦底色与 mod-active、标题居中与省略；末尾验证 ← → 的可用性与回退行为，
 *        并锁住标签无过渡、关闭钮几何与 clickable-icon 图标 140ms。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const checks=[];
const check=(ok,msg)=>{if(!ok)throw Error('✗ '+msg);checks.push(msg);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const ws=app.workspace;
const headerOf=(leaf)=>leaf._leafEl.querySelector('.view-header');
const navOf=(leaf)=>[...headerOf(leaf).querySelectorAll('.view-header-nav-buttons button')];
const fileOf=(leaf)=>leaf.view&&leaf.view.file?leaf.view.file.path:null;
const colorOf=(name,scope)=>{const probe=document.createElement('div');probe.style.color='var('+name+')';(scope||document.body).appendChild(probe);const c=getComputedStyle(probe).color;probe.remove();return c;};
const pseudoContent=(el,p)=>{try{return getComputedStyle(el,p).content;}catch(e){return 'ERR';}};

/* --screen light 令牌：浅色配色下同样跑一遍（浅/深两色截图自检用） */
const themeToken=String((typeof process!=='undefined'&&process.env&&process.env.OBS_SIDEBAR_VIEW)||'');
if(themeToken.includes('light')){app.settings.updateAppearance({theme:'moonstone'});await wait(220);}

/* ------------------------------------------------- 空视图（初始标签页）也有 ← → */
const initialLeaf=ws.activeLeaf;
check(!!initialLeaf&&initialLeaf.view.getViewType()==='empty','初始标签页是空视图（前置）');
const initialNav=navOf(initialLeaf);
check(initialNav.length===2,'空视图有 ← → 两个导航钮');
check(!!initialNav[0].querySelector('svg.lucide-arrow-left')&&!!initialNav[1].querySelector('svg.lucide-arrow-right'),
  '按钮图标依次是 lucide-arrow-left / lucide-arrow-right');
check(initialNav.every((b)=>b.getAttr('aria-disabled')==='true'),'无历史时两个导航钮都 aria-disabled=true');
check(initialNav[0].getAttr('aria-label')&&initialNav[1].getAttr('aria-label'),'导航钮带 aria-label（工具提示来源）');
const navWrap=headerOf(initialLeaf).querySelector('.view-header-nav-buttons');
check(getComputedStyle(navWrap).getPropertyValue('--icon-size').trim()===getComputedStyle(document.body).getPropertyValue('--icon-s').trim(),
  '导航区图标尺寸 --icon-size=--icon-s（原版 6798）');

/* ------------------------------------------------ 标签栏 + / ⌄（原版 1.14.4 app.css:7181-7211、app.js:1555654） */
const plusOuter=document.querySelector('.mod-root .workspace-tab-header-new-tab');
const plusInner=document.querySelector('.mod-root .workspace-tab-header-new-tab .clickable-icon');
const listOuter=document.querySelector('.mod-root .workspace-tab-header-tab-list');
const listInner=document.querySelector('.mod-root .workspace-tab-header-tab-list .clickable-icon');
check(!!plusOuter&&!!plusInner,'+ 按钮=外层 div + 内层 span.clickable-icon（原版 DOM）');
check(!!listOuter&&!!listInner,'⌄ 按钮=外层 div + 内层 span.clickable-icon（原版 DOM）');
check(!plusOuter.hasClass('clickable-icon')&&!listOuter.hasClass('clickable-icon'),'clickable-icon 不再挂在外层容器');
const po=getComputedStyle(plusOuter);
check(po.paddingTop==='8px'&&po.paddingBottom==='6px'&&po.marginLeft==='8px'&&po.marginRight==='4px',
  '+ 外层 padding 8/0/6、margin-inline 8/4 :: '+po.padding+' | '+po.marginLeft+'/'+po.marginRight);
check(getComputedStyle(listOuter).marginRight==='2px','⌄ 外层 margin-inline-end=2px（原版 7209-7211）');
const pi=getComputedStyle(plusInner);
check(pi.padding==='4px'&&pi.getPropertyValue('--icon-size').trim()===getComputedStyle(document.body).getPropertyValue('--icon-m').trim(),
  '内层按钮 padding 4px、--icon-size=--icon-m :: '+pi.padding+' / '+pi.getPropertyValue('--icon-size').trim());
const lastTabEl=[...document.querySelectorAll('.workspace-split.mod-root .workspace-tab-header-container-inner > .workspace-tab-header')].pop();
check(!!lastTabEl,'标签栏存在标签（前置）');
const boxGap=+(plusOuter.getBoundingClientRect().left-lastTabEl.getBoundingClientRect().right).toFixed(1);
check(boxGap===8,'+ 盒与末标签右缘间距=8px（原版实测）:: '+boxGap);
const glyphGap=+((plusInner.getBoundingClientRect().left+parseFloat(pi.paddingLeft))-lastTabEl.getBoundingClientRect().right).toFixed(1);
check(glyphGap===12,'+ 字形与末标签右缘间距=12px（原版实测）:: '+glyphGap);
const stripRect=document.querySelector('.workspace-split.mod-root .workspace-tab-header-container').getBoundingClientRect();
const plusInnerRect=plusInner.getBoundingClientRect();
check(Math.abs((plusInnerRect.top+plusInnerRect.height/2)-(stripRect.top+stripRect.height/2))<1.5,
  '+ 图标在标签栏内垂直居中（偏差 '+Math.abs((plusInnerRect.top+plusInnerRect.height/2)-(stripRect.top+stripRect.height/2)).toFixed(1)+'px）');
const rootTabsEl=document.querySelector('.workspace-split.mod-root .workspace-tabs');
rootTabsEl.addClass('mod-stacked');
const stackedMargin=getComputedStyle(plusOuter).marginLeft;
rootTabsEl.removeClass('mod-stacked');
check(stackedMargin==='0px','堆叠态 + 按钮 margin-inline-start=0（原版 7206-7208）:: '+stackedMargin);

/* ---------------------------------------------------------- 结构：left/标题/动作 */
await app.vault.createFolder('VH-Probe');
await app.vault.createFolder('VH-Probe/A');
await app.vault.createFolder('VH-Probe/A/B');
const deep=await app.vault.create('VH-Probe/A/B/Deep Note.md','# 深\n');
const deepLeaf=await ws.openFile(deep);
await wait(240);
const header=headerOf(deepLeaf);
check(!!header,'活动叶有 view-header');
const kids=[...header.children].map((el)=>String(el.className).split(' ')[0]);
check(kids.join('|')==='view-header-left|view-header-title-container|view-actions',
  'view-header 子块顺序=left/title-container/actions :: '+kids.join('|'));
check(!!header.querySelector(':scope > .view-header-left > .view-header-nav-buttons'),'left 内含 view-header-nav-buttons');
const container=header.querySelector(':scope > .view-header-title-container');
const parentEl=container.querySelector(':scope > .view-header-title-parent');
const titleEl=container.querySelector(':scope > .view-header-title');
check(!!container&&!!parentEl&&!!titleEl,'title-container / title-parent / title 三层齐全');
check(parentEl.nextElementSibling===titleEl,'面包屑在标题之前（DOM 相邻）');
check(titleEl.textContent==='Deep Note','标题取 getDisplayText=文件名 basename');

/* ------------------------------------------------------- 模式切换（1.14.4 头部书/笔按钮） */
const modeBtn=[...header.querySelectorAll('.view-actions .view-action')]
  .find((el)=>/切换至阅读|切换至编辑|switch to (read|edit)/i.test(el.getAttr('aria-label')||''));
check(!!modeBtn&&getComputedStyle(modeBtn).display!=='none','view-actions 含可见的模式切换钮');
const mbRect=modeBtn.getBoundingClientRect();
const mbHit=document.elementFromPoint(mbRect.left+mbRect.width/2,mbRect.top+mbRect.height/2);
check(!!mbHit&&!!mbHit.closest('.view-actions'),'模式切换钮可被真实指针命中');
modeBtn.click();
await wait(320);
check(deepLeaf.view.mode==='preview','头部模式钮切到阅读视图');
check(getComputedStyle(deepLeaf.view.readingEl).display!=='none'&&getComputedStyle(deepLeaf.view.sourceEl).display==='none','阅读视图显示、编辑视图隐藏');
[...header.querySelectorAll('.view-actions .view-action')]
  .find((el)=>/切换至阅读|切换至编辑|switch to (read|edit)/i.test(el.getAttr('aria-label')||''))
  .click();
await wait(320);
check(deepLeaf.view.mode==='live','头部模式钮切回编辑视图');

/* ---------------------------------------------------------------- 面包屑 */
const crumbs=[...parentEl.querySelectorAll('.view-header-breadcrumb')].map((el)=>el.textContent);
const seps=[...parentEl.querySelectorAll('.view-header-breadcrumb-separator')].map((el)=>el.textContent);
check(crumbs.join('|')==='VH-Probe|A|B','父路径逐段成面包屑 :: '+crumbs.join('|'));
check(seps.length===3&&seps.every((s)=>s==='/'),'每段后跟一个 "/" 分隔符 :: '+seps.length+' 个');
check(parentEl.firstElementChild.classList.contains('view-header-breadcrumb')&&parentEl.lastElementChild.classList.contains('view-header-breadcrumb-separator'),
  '首元素是段、末元素是分隔符（原版"段后补 /"排布）');
check(parentEl.children[0].getAttr('aria-label')==='VH-Probe','面包屑带 aria-label=段名');
const cr=parentEl.children[0].getBoundingClientRect(), tr=titleEl.getBoundingClientRect();
check(cr.right<=tr.left+1,'面包屑在标题左侧（几何）');

/* ------------------------------------------------ 聚焦底色 / mod-active / 标题色 */
check(deepLeaf._leafEl.hasClass('mod-active'),'活动叶子的 .workspace-leaf 带 mod-active');
document.body.style.setProperty('--file-header-background-focused','rgb(1, 2, 3)');
document.body.addClass('is-focused');
await wait(60);
check(getComputedStyle(header).backgroundColor==='rgb(1, 2, 3)',
  '聚焦 + 活动叶：view-header 底色=--file-header-background-focused :: '+getComputedStyle(header).backgroundColor);
check(getComputedStyle(titleEl).color===colorOf('--text-normal'),'聚焦活动叶标题色=--text-normal（原版 4656）');
document.body.removeClass('is-focused');
await wait(60);
check(getComputedStyle(header).backgroundColor!=='rgb(1, 2, 3)','失焦后不再用 focused 底色');
document.body.addClass('is-focused');

/* -------------------------------------------------------- 非活动叶不吃聚焦底色 */
const second=await app.vault.create('VH-Probe/Second.md','# 二\n');
const secondLeaf=await ws.openFile(second,{newLeaf:'tab'});
await wait(240);
check(ws.activeLeaf===secondLeaf&&!deepLeaf._leafEl.hasClass('mod-active'),'切标签后 mod-active 只留在活动叶');
check(getComputedStyle(headerOf(deepLeaf)).backgroundColor!=='rgb(1, 2, 3)','非活动叶不吃 focused 底色');
document.body.removeClass('is-focused');
document.body.style.removeProperty('--file-header-background-focused');
await wait(40);

/* ---------------------------------------------------- 无父路径：:empty 与居中 */
const rootNote=await app.vault.create('VH Root Note.md','# 根\n');
const rootLeaf=await ws.openFile(rootNote,{newLeaf:'tab'});
await wait(240);
const rootHeaderEl=headerOf(rootLeaf);
const rootParent=rootHeaderEl.querySelector(':scope > .view-header-title-container > .view-header-title-parent');
const rootTitle=rootHeaderEl.querySelector('.view-header-title');
const rootContainer=rootHeaderEl.querySelector('.view-header-title-container');
check(rootParent.children.length===0,'根目录文件的面包屑容器为空');
check(getComputedStyle(rootParent).display==='none',':empty 时面包屑容器 display:none（原版 4614）');
check(getComputedStyle(rootContainer).justifyContent==='start','标题容器 justify-content=start（--file-header-justify，桌面 1.14.4）');
const rc=rootContainer.getBoundingClientRect(), rt=rootTitle.getBoundingClientRect();
check(Math.abs(rt.left-rc.left)<=2,
  '无面包屑时标题贴容器左缘（偏差 '+Math.abs(rt.left-rc.left).toFixed(1)+'px）');
check(getComputedStyle(rootTitle).textOverflow==='ellipsis'&&getComputedStyle(rootTitle).whiteSpace==='pre',
  '标题单行省略（text-overflow: ellipsis / white-space: pre）');

/* ---------------------------------------------------------------- mod-fade */
const longFile=await app.vault.create('VH-Probe/'+'很长的标题'.repeat(20)+'.md','# 长\n');
const longLeaf=await ws.openFile(longFile,{newLeaf:'tab'});
await wait(300);
const longHeader=headerOf(longLeaf);
const longContainer=longHeader.querySelector('.view-header-title-container');
const longTitle=longHeader.querySelector('.view-header-title');
check(longContainer.hasClass('mod-fade'),'标题容器带 mod-fade');
check(longTitle.scrollWidth>longTitle.offsetWidth,'超长标题可横向滚动（scrollWidth>offsetWidth）');
check(longContainer.hasClass('mod-at-start')&&!longContainer.hasClass('mod-at-end'),'初始：mod-at-start（无左蒙版）');
check(pseudoContent(longContainer,'::after')!=='none'&&pseudoContent(longContainer,'::before')==='none',
  '未到末端时右蒙版 ::after 存在、左蒙版 ::before 不存在');
longTitle.scrollLeft=longTitle.scrollWidth;
await wait(120);
check(!longContainer.hasClass('mod-at-start')&&longContainer.hasClass('mod-at-end'),'滚到末端：mod-at-end 且撤掉 mod-at-start');
check(pseudoContent(longContainer,'::before')!=='none','滚到末端出现左蒙版 ::before');
longTitle.scrollLeft=0;
await wait(120);
check(longContainer.hasClass('mod-at-start'),'滚回起点恢复 mod-at-start');

/* -------------------------------------------------- 面包屑菜单底色样式绑定 */
const firstCrumb=parentEl.children[0];
firstCrumb.addClass('has-active-menu');
check(getComputedStyle(firstCrumb).backgroundColor===colorOf('--background-modifier-hover'),
  '面包屑 has-active-menu 上悬停底色（原版 4623；:hover 与它同一声明块）');
firstCrumb.removeClass('has-active-menu');

/* ---------------------------------------------------- 面包屑点击=揭示文件夹 */
const explorerLeaf=ws.getLeavesOfType('file-explorer')[0];
check(!!explorerLeaf,'文件浏览器叶子存在（前置）');
firstCrumb.click();
await wait(200);
check(explorerLeaf.view._activePath==='VH-Probe','点面包屑在文件浏览器里定位该文件夹 :: '+explorerLeaf.view._activePath);
check(!!document.querySelector('.nav-folder-title[data-path="VH-Probe"].is-active'),'文件树里该文件夹带上 is-active（revealFile 生效）');

/* -------------------------------------------------------- 空视图也有 ← → */
app.commands.executeCommandById('workspace:new-tab');
await wait(220);
const newEmptyLeaf=ws.activeLeaf;
check(newEmptyLeaf.view.getViewType()==='empty','workspace:new-tab 打开新空标签（前置）');
check(navOf(newEmptyLeaf).length===2,'新空标签同样有 ← → 两个导航钮');

/* ------------------------------------------------------ 导航钮可用性与回退 */
// 历史是全局栈（app-commands）：把活动叶重新落回栈顶那篇，再验证按钮行为
await ws.openFile(longFile);
await wait(300);
const navLeaf=ws.activeLeaf;
const beforePath=fileOf(navLeaf);
const [backBtn,forwardBtn]=navOf(navLeaf);
check(beforePath===longFile.path,'前置：活动叶停在历史最后一篇');
check(backBtn.getAttr('aria-disabled')==='false','已开多篇后 back 可用（aria-disabled=false）');
check(forwardBtn.getAttr('aria-disabled')==='true','停在历史末尾时 forward 不可用');
backBtn.click();
await wait(340);
const backPath=fileOf(ws.activeLeaf);
check(!!backPath&&backPath!==beforePath,'点 ← 回退到历史上一篇 :: '+backPath);
const fwdAfterBack=navOf(ws.activeLeaf)[1];
check(fwdAfterBack.getAttr('aria-disabled')==='false','回退后 forward 变为可用');
fwdAfterBack.click();
await wait(340);
check(fileOf(ws.activeLeaf)===beforePath,'点 → 前进回到先前那篇 :: '+fileOf(ws.activeLeaf));

/* ------------------------------------------------- 收尾：回嵌套文件，留面包屑画面 */
const finalLeaf=await ws.openFile(deep);
await wait(320);
const finalHeader=headerOf(finalLeaf);
const finalCrumbs=[...finalHeader.querySelectorAll('.view-header-breadcrumb')].map((el)=>el.textContent).join('/');
check(finalCrumbs==='VH-Probe/A/B','收尾：回到嵌套文件后面包屑恢复 :: '+finalCrumbs);
check(!!finalHeader.querySelector('.view-header-nav-buttons svg.lucide-arrow-left'),'收尾：导航钮仍在');
check(finalHeader.querySelector('.view-header-title').textContent==='Deep Note','收尾：标题=Deep Note（短标题，面包屑可见）');

/* ------------------------------------------- 悬停/动效：图标 140ms、标签瞬时 */
const activeTabHeader=document.querySelector('.mod-root .workspace-tab-header.is-active');
check(!!activeTabHeader,'活动中心标签存在（前置）');
check(getComputedStyle(activeTabHeader).transitionDuration.split(',')[0].trim()==='0s','标签头无过渡（原版瞬时切换）');
const closeBtn=activeTabHeader.querySelector('.workspace-tab-header-inner-close-button');
check(!!closeBtn,'活动标签有关闭钮');
check(getComputedStyle(closeBtn).padding==='2px','关闭钮 padding 2px（原版 7115）');
const closeSvg=closeBtn.querySelector('svg.svg-icon');
check(!!closeSvg&&Math.round(closeSvg.getBoundingClientRect().width)===16,'root 关闭钮图标 16px（--icon-s，原版 7239）');
const navSvg=document.querySelector('.view-header-nav-buttons .clickable-icon svg');
check(!!navSvg,'导航钮图标存在（前置）');
const navSvgStyle=getComputedStyle(navSvg);
check(navSvgStyle.transitionProperty.includes('opacity')&&navSvgStyle.transitionDuration.split(',')[0].trim()==='0.14s',
  'clickable-icon 图标透明度过渡 140ms（原版 8352）');

return {pass:true,checks,count:checks.length};
})()
