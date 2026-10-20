/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 侧栏折叠/展开的顶栏几何、FLIP 动画与顶栏配色断言（计算样式锁）；失败抛出异常。
 * [POS]: sidebar-chrome 场景。钉住三件事：折叠侧分隔条不占位不穿红绿灯、toggle 迁移与 140ms FLIP、
 * 功能区/标签栏/左上角 44x40 由 --titlebar-background 同一变量驱动（收起无色块接缝）；
 * 并锁住功能区/侧栏 16px 图标与图标 140ms 透明度过渡。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const checks=[];
const check=(ok,msg)=>{if(!ok)throw Error('✗ '+msg);checks.push(msg);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const ws=app.workspace;
// 红绿灯保留区（macOS hidden 标题栏 + trafficLightPosition 14,12）
const LIGHT={x0:0,y0:0,x1:80,y1:30};
const intersect=(r)=>!(r.right<=LIGHT.x0||r.left>=LIGHT.x1||r.bottom<=LIGHT.y0||r.top>=LIGHT.y1);
const handlesInLightBox=()=>[...document.querySelectorAll('.workspace-leaf-resize-handle')]
  .filter((el)=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&intersect(r)&&parseFloat(getComputedStyle(el).opacity)>0.01;}).length;
const handlesShown=(side)=>[...document.querySelectorAll(`.workspace-leaf-resize-handle[data-divider-side="${side}"]`)]
  .filter((el)=>el.getBoundingClientRect().width>0&&parseFloat(getComputedStyle(el).opacity)>0.01).length;
const toggleEl=()=>ws.leftSidebarToggleEl;
const toggleParentCls=()=>{const p=toggleEl()&&toggleEl().parentElement;return p?String(p.className):'';};

const body=document.body;
check(body.hasClass('mod-macos')&&body.hasClass('is-hidden-frameless'),'macOS hidden 标题栏环境（前置）');
check(body.hasClass('show-ribbon'),'功能区可见（前置，走 FLIP 迁移路径）');

// ------------------------------------------------ hover 基座：图标 16px、140ms 透明度
const ribbonAction=document.querySelector('.workspace-ribbon .side-dock-ribbon-action');
check(!!ribbonAction,'功能区动作按钮存在（前置）');
const ribbonActionStyle=getComputedStyle(ribbonAction);
check(ribbonActionStyle.padding==='4px 6px','功能区按钮 padding 4/6（原版 8341）');
check(Math.round(ribbonAction.querySelector('svg.svg-icon').getBoundingClientRect().width)===16,'功能区图标 16px（--icon-m）');
const ribbonSvgStyle=getComputedStyle(ribbonAction.querySelector('svg.svg-icon'));
check(ribbonSvgStyle.transitionProperty.includes('opacity')&&ribbonSvgStyle.transitionDuration.split(',')[0].trim()==='0.14s',
  '功能区图标透明度过渡 140ms（原版 8352）');
const sideTabIcon=document.querySelector('.mod-sidedock .workspace-tab-header-inner-icon svg.svg-icon');
check(!!sideTabIcon&&Math.round(sideTabIcon.getBoundingClientRect().width)===16,'侧栏标签图标 16px（--icon-m）');
const sideTabEl=sideTabIcon&&sideTabIcon.closest('.workspace-tab-header');
check(!!sideTabEl&&Math.round(sideTabEl.getBoundingClientRect().width)===28,'侧栏标签宽 28px（原版图标 16 + 左右 6）');
check(!!sideTabEl&&getComputedStyle(sideTabEl).borderRadius==='8px','侧栏标签圆角 = --tab-radius（macOS 8px）');
check(!!sideTabEl&&sideTabEl.classList.contains('tappable'),'侧栏标签带 tappable 类（原版）');
const toggleSvg=document.querySelector('.sidebar-toggle-button svg.svg-icon');
check(!!toggleSvg&&Math.round(toggleSvg.getBoundingClientRect().width)===16,'侧栏开关图标 16px（--icon-m）');

// ---------------------------------------------------------------- 收起左栏
ws.toggleSidebar('left');
check(ws.leftSplit.collapsed===true,'左栏已收起');
await wait(40);
check(toggleEl().getAnimations&&toggleEl().getAnimations().length>0,'收起时 toggle 有 FLIP 动画（newStyle=offset）');
const toggleAnim=toggleEl().getAnimations()[0];
check(!!toggleAnim&&toggleAnim.effect.getTiming().duration===140,'toggle FLIP 时长 140ms（--anim-motion-swing）');
await wait(520);
check(toggleParentCls().includes('workspace-tab-header-container'),'收起后 toggle 位于中心标题栏容器');
const tr=toggleEl().getBoundingClientRect();
check(tr.left>=79,'收起后 toggle 在红绿灯区右侧（left='+Math.round(tr.left)+'）');
const offending=()=>[...document.querySelectorAll('.workspace-leaf-resize-handle')]
  .filter((el)=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&intersect(r)&&parseFloat(getComputedStyle(el).opacity)>0.01;})
  .map((el)=>{const r=el.getBoundingClientRect();return {cls:String(el.className),op:getComputedStyle(el).opacity,side:el.getAttribute('data-divider-side'),rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)],parent:String(el.parentElement&&el.parentElement.className).slice(0,40)};});
check(handlesInLightBox()===0,'收起后无分隔条穿入红绿灯区（线不再穿模） :: '+JSON.stringify(offending()));
check(handlesShown('left')===0,'收起后左侧分隔条隐藏');

// ---------------------------------------------------------------- 展开左栏
ws.toggleSidebar('left');
check(ws.leftSplit.collapsed===false,'左栏已展开');
await wait(40);
check(document.querySelectorAll('.sidebar-toggle-button.mod-left').length>=2,'展开时存在动画幽灵（oldStyle=offset）');
const ghosts=[...document.querySelectorAll('.sidebar-toggle-button.mod-left')].filter((el)=>el.getAnimations&&el.getAnimations().length>0);
check(ghosts.length>=1,'幽灵/按钮上确有进行中的动画');
await wait(420);
const leftBtns=()=>[...document.querySelectorAll('.sidebar-toggle-button.mod-left')].map((el)=>({parent:String(el.parentElement&&el.parentElement.className).slice(0,40),anims:el.getAnimations?el.getAnimations().map((a)=>a.playState).join(','):'',rect:(r=>[Math.round(r.x),Math.round(r.y)])(el.getBoundingClientRect())}));
check(document.querySelectorAll('.sidebar-toggle-button.mod-left').length===1,'动画结束后幽灵已移除');
check(toggleParentCls().includes('workspace-tab-header-container'),'展开后 toggle 位于左栏标题栏容器');
check(handlesShown('left')===1,'展开后左侧分隔条恢复');
check(handlesInLightBox()===0,'展开态分隔条也在红绿灯区外');

// ---------------------------------------------------------------- 右侧
if (ws.rightSplit.collapsed) { ws.toggleSidebar('right'); await wait(300); }
ws.toggleSidebar('right');
await wait(300);
check(handlesShown('right')===0,'右栏收起后右侧分隔条隐藏');
const pe=()=>{const el=document.querySelector('.workspace-leaf-resize-handle[data-divider-side="right"]');return el?getComputedStyle(el).pointerEvents:'';};
check(pe()==='none','收起侧分隔条不再接受指针事件');
ws.toggleSidebar('right');
await wait(300);
check(handlesShown('right')===1,'右栏展开后右侧分隔条恢复');
check(handlesInLightBox()===0,'右栏操作后仍无分隔条穿入红绿灯区');

// ------------------------------------------------- 顶栏配色与几何（对照原版 3996-4442、6094-6199）
// 解析后的颜色：把 var() 写进临时元素的 color 再读计算值，避免与 token 写死的 rgb 比较
const colorOf=(name,scope)=>{const probe=document.createElement('div');probe.style.color='var('+name+')';(scope||document.body).appendChild(probe);const c=getComputedStyle(probe).color;probe.remove();return c;};
// 非颜色 token（长度等）直接读自定义属性的计算值
const tokenOf=(name,scope)=>getComputedStyle(scope||document.body).getPropertyValue(name).trim();
const ribbonEl=()=>document.querySelector('.workspace-ribbon.mod-left');
const centerTabsEl=()=>document.querySelector('.workspace-split.mod-root .workspace-tabs');
const centerHeaderEl=()=>document.querySelector('.workspace-split.mod-root .workspace-tab-header-container');
const activeTabEl=()=>document.querySelector('.workspace-split.mod-root .workspace-tab-header.is-active');
const bgOf=(el,pseudo)=>getComputedStyle(el,pseudo).backgroundColor;
const ribbonBefore=()=>bgOf(ribbonEl(),'::before');
const centerHeaderBg=()=>bgOf(centerHeaderEl());
const leftHandle=()=>document.querySelector('.workspace-leaf-resize-handle[data-divider-side="left"]');
const focusedBefore=body.hasClass('is-focused');
body.removeClass('is-focused');
await wait(60);
const tabContainerBg=colorOf('--titlebar-background', centerTabsEl());
const tabContainerBgFocused=colorOf('--titlebar-background-focused', centerTabsEl());
check(tabContainerBg===tabContainerBgFocused&&tabContainerBg===colorOf('--background-secondary', centerTabsEl()),
  '1.14.4 顶栏底色：焦点/失焦同取 background-secondary（app.css:2894）');

ws.toggleSidebar('left');
await wait(520);
check(ribbonEl().hasClass('is-collapsed'),'收起后功能区带 is-collapsed（原版 Ribbon.setCollapsedState 语义）');
check(bgOf(ribbonEl())===colorOf('--ribbon-background-collapsed')&&bgOf(ribbonEl())===colorOf('--background-primary'),
  '收起后功能区底色=background-primary（与编辑区同色，无竖直断层）:: '+bgOf(ribbonEl()));
check(ribbonBefore()===colorOf('--titlebar-background', ribbonEl()),
  '功能区左上角 44x40 填顶栏底色（原版 4402）:: '+ribbonBefore());
check(centerTabsEl().hasClass('mod-top'),'中心标签组带 mod-top（顶栏变量宿主，原版 updateFrameless）');
check(centerHeaderBg()===colorOf('--tab-container-background', centerTabsEl())&&centerHeaderBg()===tabContainerBg,
  '中心标签栏底色=顶栏底色（同一变量）:: '+centerHeaderBg());
check(ribbonBefore()===centerHeaderBg(),'失焦态：功能区左上角与中心标签栏同色（顶栏无接缝）');
check(leftHandle().getBoundingClientRect().width===0,'收起后左侧分隔条宽度 0（原版随 split 隐藏，不留 1px 竖缝）');
const cs=()=>getComputedStyle(centerHeaderEl());
const expectPad=8+(80-parseFloat(tokenOf('--ribbon-width')));   // size-4-2 + (80px 红绿灯净空 - ribbon 宽度)
check(parseFloat(cs().paddingLeft)===expectPad,'收起后中心标签栏左留白=size-4-2+frame-left-space（红绿灯净空 '+expectPad+'px）:: '+cs().paddingLeft);
check(cs().borderBottomWidth==='1px'&&cs().borderBottomColor===colorOf('--divider-color'),'标签栏底边线 1px 取 divider-color');
body.addClass('is-focused');
await wait(60);
check(centerHeaderBg()===tabContainerBgFocused&&centerHeaderBg()===colorOf('--tab-container-background', centerTabsEl()),
  '焦点态中心标签栏= titlebar-background-focused（1.14.4 与失焦同色） :: '+centerHeaderBg());
check(ribbonBefore()===centerHeaderBg(),'焦点态：功能区左上角与中心标签栏仍同色（红绿灯区无接缝）');
body.toggleClass('is-focused', focusedBefore);
await wait(60);
const fillet=()=>getComputedStyle(activeTabEl(),'::before');
const curveOf=()=>parseFloat(tokenOf('--tab-curve', activeTabEl()));
check(fillet().width===(curveOf()*2)+'px'&&fillet().clipPath.startsWith('inset(50%')&&fillet().boxShadow.includes(colorOf('--tab-background-active', activeTabEl())),
  '活动标签底角凹弧：2*--tab-curve 的圆 + clip-path 取四分之一，弧外填标签底色（原版 1.14 7026-7052）');
const headerRect=centerHeaderEl().getBoundingClientRect();
const activeRect=activeTabEl().getBoundingClientRect();
check(Math.abs(activeRect.bottom-headerRect.bottom)<0.75,
  '活动标签脚印压住标签栏底边线（活动标签底部与内容区无缝）');
ws.toggleSidebar('left');
await wait(520);
check(!ribbonEl().hasClass('is-collapsed')&&bgOf(ribbonEl())===colorOf('--ribbon-background'),
  '展开后功能区回到 --ribbon-background 且去掉 is-collapsed :: '+bgOf(ribbonEl()));
check(leftHandle().getBoundingClientRect().width>0&&getComputedStyle(leftHandle()).opacity==='1','展开后左侧分隔条恢复占位与不透明');

// ------------------------------------------------- 文件列表头（原版 1.14 QL、app.css:9574-9593）
const feLeaf=ws.getLeavesOfType('file-explorer')[0];
check(!!feLeaf&&!!feLeaf.view,'文件浏览器存在（前置）');
const feView=feLeaf.view;
const navHeader=()=>feView.contentEl.querySelector(':scope > .nav-header');
const navButtons=()=>navHeader()&&navHeader().querySelector(':scope > .nav-buttons-container');
check(!!navHeader(),'文件列表头是 .nav-header（原版 QL 结构）');
check(!!navButtons(),'.nav-header 内含 .nav-buttons-container');
check(navHeader().nextElementSibling===feView.container&&feView.container.hasClass('nav-files-container'),
  '.nav-header 与 .nav-files-container 平级且在前（按钮行固定，不随树滚动）');
check(getComputedStyle(navHeader()).padding==='8px','.nav-header padding=8px（原版 9574-9576）:: '+getComputedStyle(navHeader()).padding);
check(getComputedStyle(navButtons()).gap==='2px'&&getComputedStyle(navButtons()).padding==='0px',
  '按钮行 gap=2px、padding=0（原版 9581-9583）:: '+getComputedStyle(navButtons()).gap+' / '+getComputedStyle(navButtons()).padding);
check(navHeader().getBoundingClientRect().bottom<=feView.container.getBoundingClientRect().top+1,'树从列表头下方开始（无重叠）');
const btnIcons=[...navButtons().querySelectorAll('.nav-action-button')].map((b)=>{
  const svg=b.querySelector('svg');
  return svg?String(svg.getAttribute('class')||''):'';
});
check(btnIcons.length===5,'文件列表头五个动作按钮 :: '+btnIcons.length);
check(btnIcons[0].includes('lucide-edit')&&btnIcons[1].includes('lucide-folder-plus')&&btnIcons[2].includes('lucide-sort-asc')
  &&btnIcons[3].includes('lucide-gallery-vertical')&&btnIcons[4].includes('lucide-chevrons-down-up'),
  '按钮图标顺序 edit/folder-plus/sort-asc/gallery-vertical/chevrons-down-up :: '+btnIcons.join('|'));
check(feView._autoRevealBtn&&feView._autoRevealBtn.hasClass('is-active')===!!feView._autoReveal,
  '自动显示按钮 is-active 跟随 _autoReveal 状态');
check(feView._collapseAllBtn&&String(feView._collapseAllBtn.getAttribute('aria-label')).length>0,
  '全部折叠按钮带 aria-label（工具提示）');
const navButtonsRect=navButtons().getBoundingClientRect();
const navBtnEls=[...navButtons().querySelectorAll('.nav-action-button')];
const firstBtnRect=navBtnEls[0].getBoundingClientRect();
const lastBtnRect=navBtnEls[navBtnEls.length-1].getBoundingClientRect();
check(Math.abs((firstBtnRect.left+lastBtnRect.right)/2-(navButtonsRect.left+navButtonsRect.right)/2)<1,
  '文件列表头五按钮水平居中（原版 .nav-buttons-container justify-content:center）');
check(Math.round(navButtonsRect.width)===Math.round(navHeader().getBoundingClientRect().width-16),
  '按钮行占满 .nav-header 内容宽（原版 width:auto）');
check(!feView.treeEl.querySelector('.nav-folder.mod-root'),'文件树不渲染根节点标题（原版桌面）');
const firstRow=feView.treeEl.querySelector('.nav-file-title[data-path], .nav-folder-title[data-path]');
if(firstRow){
  const rowRect=firstRow.getBoundingClientRect();
  const treeRect=feView.container.getBoundingClientRect();
  check(Math.abs(rowRect.left-(treeRect.left+12))<1,'根级行左缘 = 容器 padding 12px');
  check(Math.abs(rowRect.top-(treeRect.top+4))<1,'根级行顶缘 = 容器 padding 4px（无根标题占位）');
}
const visibleRibbon=[...document.querySelectorAll('.side-dock-ribbon-action')].filter((el)=>el.getBoundingClientRect().width>0);
check(visibleRibbon.length>=6,'功能区至少六个可见动作（快速切换/图谱/白板/日记/模板/命令）');
const ribbonLabels=visibleRibbon.map((el)=>el.getAttribute('aria-label'));
check(ribbonLabels[0]==='打开快速切换'&&ribbonLabels[1]==='查看关系图谱'&&ribbonLabels[2]==='新建白板'
  &&ribbonLabels[3]==='打开/创建今天的日记'&&ribbonLabels[4]==='插入模板'&&ribbonLabels[5]==='打开命令面板',
  '功能区顺序 quick-switch/graph/canvas/daily/templates/command :: '+ribbonLabels.join('|'));
if(visibleRibbon.length>1){
  const y0=visibleRibbon[0].getBoundingClientRect().y;
  const y1=visibleRibbon[1].getBoundingClientRect().y;
  check(Math.round(y1-y0)===30,'功能区按钮纵向步长 30px（24 高 + 6 gap）');
}

// 排序菜单：三组 × 2 项 + 组后分隔线（原版 QL.addSortButton，app.js:1473296）
feView._sortBtn.click();
await wait(160);
const sortMenu=[...document.querySelectorAll('body > .menu')].pop();
check(!!sortMenu,'排序按钮弹出菜单');
const sortLabels=[...sortMenu.querySelectorAll('.menu-item')].map((el)=>el.textContent.trim());
check(sortLabels.length===6,'排序菜单 6 项（名称/修改时间/创建时间 各 2）:: '+sortLabels.join('|'));
const sortSeps=[...sortMenu.querySelectorAll('.menu-scroll > .menu-separator')]
  .filter((el)=>getComputedStyle(el).display!=='none').length;
const sortSepsInDom=(sortMenu.innerHTML.match(/menu-separator/g)||[]).length;
check(sortSeps===2&&sortSepsInDom>=3,'排序菜单三条分隔线、末尾一条被 :last-child 隐藏（原版 9175）:: 可见 '+sortSeps+' / DOM '+sortSepsInDom);
check(!!sortMenu.querySelector('.menu-item.mod-checked'),'当前排序项带选中标记（lucide-check）');
document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
await wait(140);

// ------------------------------------------------- 空标签页 pill（原版 1.14 aI、app.css:4083-4204）
app.commands.executeCommandById('workspace:new-tab');
await wait(220);
let emptyLeaf=ws.activeLeaf;
check(!!emptyLeaf&&emptyLeaf.view.getViewType()==='empty','新标签页为空视图（前置）');
const pillList=()=>[...emptyLeaf.view.contentEl.querySelectorAll('.empty-state-action-list > .empty-state-action')];
let pills=pillList();
check(pills.length>=2,'空态动作行是 pill 列表 :: '+pills.length);
check(pills.every((p)=>p.hasClass('text-icon-button')&&p.hasClass('mod-pill')),'pill 使用 text-icon-button.mod-pill（原版 aI）');
const pillIcons=pills.map((p)=>{const svg=p.querySelector('.text-button-icon svg');return svg?String(svg.getAttribute('class')||''):'';});
check(pillIcons[0].includes('lucide-square-pen'),'首个 pill 图标 lucide-square-pen（原版）:: '+pillIcons[0]);
check(pillIcons.some((c)=>c.includes('lucide-layout-dashboard')),'canvas 启用时有"新建白板" pill（lucide-layout-dashboard）');
check(!pills.some((p)=>/(前往文件|打开文件|Go to file)/.test(p.textContent)),'空库不显示"前往文件" pill（原版 vault.isEmpty() 门）');
check(pills.every((p)=>!!p.querySelector('.text-button-icon')&&!!p.querySelector('.text-button-label')),'每个 pill 都有图标 + 文案两层');
check(pills.some((p)=>!!p.querySelector('.empty-state-hotkey')),'pill 带热键后缀（printHotkeyForCommand）');
check(!pills.some((p)=>/^(关闭|Close)$/.test(p.textContent.trim())),'空态不再有 Close 动作（1.14 无此 pill）');
await app.vault.create('Pill-Probe.md','# p\n');
// 空视图在 onOpen 时按库状态生成动作；先移除旧空标签再开新标签，得到一次全新渲染
emptyLeaf.detach();
await wait(160);
app.commands.executeCommandById('workspace:new-tab');
await wait(240);
emptyLeaf=ws.activeLeaf;
pills=pillList();
check(pills.some((p)=>/(前往文件|打开文件|Go to file)/.test(p.textContent)),'库非空时出现"前往文件" pill :: '+pills.map((p)=>p.textContent).join('|'));

// ------------------------------------------------- 全部折叠 ↔ 展开全部（原版 setIsAllCollapsed，app.js:1505176）
const collapseFolder=await app.vault.createFolder('Collapse-Probe');
await app.vault.create('Collapse-Probe/inner.md','# i\n');
await wait(220);
feView._collapseAllBtn.click();
await wait(180);
check(feView._allCollapsed===true&&feView._collapsed.has(collapseFolder.path),'全部折叠：文件夹进入折叠集');
check(!!feView._collapseAllBtn.querySelector('.lucide-chevrons-up-down'),'全部折叠后图标=chevrons-up-down');
check(/(全部展开|展开全部|Expand all)/.test(String(feView._collapseAllBtn.getAttribute('aria-label'))),'全部折叠后文案=Expand all :: '+feView._collapseAllBtn.getAttribute('aria-label'));
feView._collapseAllBtn.click();
await wait(180);
check(feView._allCollapsed===false&&!feView._collapsed.has(collapseFolder.path),'展开全部：折叠集移除该文件夹');
check(!!feView._collapseAllBtn.querySelector('.lucide-chevrons-down-up'),'展开全部后图标=chevrons-down-up');
// 手动展开任一文件夹后按钮回到 Collapse all（原版 setCollapsed(false) → setIsAllCollapsed(false)）
feView._collapseAllBtn.click();
await wait(160);
feView._toggleFolder(collapseFolder.path);
await wait(160);
check(feView._allCollapsed===false&&!!feView._collapseAllBtn.querySelector('.lucide-chevrons-down-up'),
  '手动展开文件夹后按钮回到 Collapse all 态');

return {pass:true,checks};
})()
