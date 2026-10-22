/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例；状态由 OBS_SIDEBAR_VIEW 令牌给出。
 * [OUTPUT]: 顶栏/功能区在给定状态下的计算样式、几何与命中链（console.log PROBE-TOPBAR + 截图）。
 * [POS]: scripts/acceptance 的截图诊断场景（非断言锁；UI 巡检与前后对比取证，可复用）。
 * 状态令牌：collapsed / focused / dark / noribbon 任意组合，例：collapsed+focused+dark。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const checks=[];
const check=(ok,m)=>{if(!ok)throw Error('✗ '+m);checks.push(m);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const env=(typeof process!=='undefined'&&process.env)||{};
const tokens=String(env.OBS_SIDEBAR_VIEW||'collapsed').split(/[+,\s]+/).filter(Boolean);
const want=(t)=>tokens.includes(t);
const state=tokens.join('+');
const sel=(el)=>{if(!el)return 'null';const c=el.className&&el.className.toString?el.className.toString().trim():'';return el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+(c?'.'+c.split(/\s+/).join('.'):'');};
const color=(el,pseudo)=>{try{const cs=getComputedStyle(el,pseudo);return cs.backgroundColor+'|'+cs.borderRightWidth+'/'+cs.borderRightColor+'|'+cs.borderBottomWidth+'/'+cs.borderBottomColor;}catch(e){return 'ERR '+e.message;}};
const vars=(el,names)=>{const cs=getComputedStyle(el);const o={};for(const n of names)o[n]=cs.getPropertyValue(n).trim();return o;};

/* ---------------------------------------------------------------- 状态装载 */
app.settings.updateAppearance({theme:want('dark')?'obsidian':'moonstone',showRibbon:!want('noribbon')});
await wait(220);
const file=await app.vault.create('UI-Probe-'+Date.now()+'.md','# Probe\n\nhello\n');
await app.workspace.openFile(file);
await wait(420);

const body=document.body;
const collapsed=want('collapsed');
if(app.workspace.leftSplit.collapsed!==collapsed){app.workspace.toggleSidebar('left');await wait(520);}
check(app.workspace.leftSplit.collapsed===collapsed,'左栏状态与令牌一致（collapsed='+collapsed+'）');
// E2E 窗口不抢焦点：按真实窗口的焦点联动补类（workspace-renderer 在 window focus/blur 时做同样的事）
body.toggleClass('is-focused',want('focused'));

const ribbon=document.querySelector('.workspace-ribbon.mod-left');
check(!!ribbon,'功能区存在');

/* ---------------------------------------------------------------- 取色与几何 */
const nodes={};
const pick=(key,s)=>{const el=document.querySelector(s);if(!el)return;const r=el.getBoundingClientRect();nodes[key]={cls:String(el.className),color:color(el),rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)],padding:getComputedStyle(el).paddingLeft+' '+getComputedStyle(el).paddingRight,display:getComputedStyle(el).display};};
pick('ribbon','.workspace-ribbon.mod-left');
pick('ribbonBefore_owner','.workspace-ribbon.mod-left');
pick('leftSplit','.mod-left-split');
pick('leftToggle','.sidebar-toggle-button.mod-left');
pick('leftTabs','.workspace-split.mod-left-split .workspace-tabs');
pick('leftHeader','.workspace-split.mod-left-split .workspace-tab-header-container');
pick('centerTabs','.workspace-split.mod-root .workspace-tabs');
pick('centerHeader','.workspace-split.mod-root .workspace-tab-header-container');
pick('centerHeaderInner','.workspace-split.mod-root .workspace-tab-header-container-inner');
pick('centerSpacer','.workspace-split.mod-root .workspace-tab-header-spacer');
pick('activeTab','.workspace-split.mod-root .workspace-tab-header.is-active');
pick('rootSplit','.workspace-split.mod-root');
pick('rootSplitOuter','.workspace-split.workspace-root');
pick('activeLeaf','.workspace-split.mod-root .workspace-leaf.mod-active');
pick('leftDivider','.workspace-leaf-resize-handle[data-divider-side="left"]');
pick('rightDivider','.workspace-leaf-resize-handle[data-divider-side="right"]');
pick('leftDividerHost','.workspace-split.workspace-root');
pick('rightSplit','.mod-right-split');
pick('rightTabs','.workspace-split.mod-right-split .workspace-tabs');
pick('rightToggle','.sidebar-toggle-button.mod-right');
/* 1.14 对齐取证：标签栏 + / ⌄ 与文件列表头 */
pick('newTabOuter','.mod-root .workspace-tab-header-new-tab');
pick('newTabInner','.mod-root .workspace-tab-header-new-tab .clickable-icon');
pick('tabListOuter','.mod-root .workspace-tab-header-tab-list');
pick('tabListInner','.mod-root .workspace-tab-header-tab-list .clickable-icon');
pick('navHeader','.workspace-leaf-content[data-type="file-explorer"] .nav-header');
pick('navButtons','.workspace-leaf-content[data-type="file-explorer"] .nav-buttons-container');
pick('explorerTree','.workspace-leaf-content[data-type="file-explorer"] .nav-files-container');
pick('emptyPill','.empty-state-action-list .empty-state-action');

/* 几何增量：+ 距末标签右缘、+ 内层盒、⌄ 盒、文件列表头内边距与 gap */
const rect=(el)=>{if(!el)return null;const r=el.getBoundingClientRect();return {x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1),right:+r.right.toFixed(1),bottom:+r.bottom.toFixed(1)};};
const innerEl=document.querySelector('.workspace-split.mod-root .workspace-tab-header-container-inner');
const tabEls=innerEl?[...innerEl.querySelectorAll(':scope > .workspace-tab-header')]:[];
const lastTabEl=tabEls.length?tabEls[tabEls.length-1]:null;
const newTabInnerEl=document.querySelector('.mod-root .workspace-tab-header-new-tab .clickable-icon');
const explorerButtons=[...document.querySelectorAll('.workspace-leaf-content[data-type="file-explorer"] .nav-action-button')]
  .map((b)=>({cls:String(b.className),label:b.getAttr?b.getAttr('aria-label'):b.getAttribute('aria-label'),icon:(b.querySelector('svg')&&String(b.querySelector('svg').className.baseVal||'').trim())||''}));
const aligned={
  containerHeight:(()=>{const el=document.querySelector('.workspace-split.mod-root .workspace-tab-header-container');return el?+el.getBoundingClientRect().height.toFixed(1):null;})(),
  innerPadding:innerEl?getComputedStyle(innerEl).paddingLeft+' '+getComputedStyle(innerEl).paddingRight+' '+getComputedStyle(innerEl).paddingBottom:'',
  lastTab:rect(lastTabEl),
  newTabOuter:rect(document.querySelector('.mod-root .workspace-tab-header-new-tab')),
  newTabInner:rect(newTabInnerEl),
  newTabInnerPadding:newTabInnerEl?getComputedStyle(newTabInnerEl).padding:'',
  newTabMargin:document.querySelector('.mod-root .workspace-tab-header-new-tab')?getComputedStyle(document.querySelector('.mod-root .workspace-tab-header-new-tab')).marginLeft+' '+getComputedStyle(document.querySelector('.mod-root .workspace-tab-header-new-tab')).marginRight:'',
  tabListOuter:rect(document.querySelector('.mod-root .workspace-tab-header-tab-list')),
  tabListInner:rect(document.querySelector('.mod-root .workspace-tab-header-tab-list .clickable-icon')),
  tabListMargin:(()=>{const el=document.querySelector('.mod-root .workspace-tab-header-tab-list');return el?getComputedStyle(el).marginRight:'';})(),
  gapLastTabToNewTabIcon:(lastTabEl&&newTabInnerEl)?+(newTabInnerEl.getBoundingClientRect().left-lastTabEl.getBoundingClientRect().right).toFixed(1):null,
  navHeaderPadding:(()=>{const el=document.querySelector('.workspace-leaf-content[data-type="file-explorer"] .nav-header');return el?getComputedStyle(el).padding:'';})(),
  navButtonsGap:(()=>{const el=document.querySelector('.workspace-leaf-content[data-type="file-explorer"] .nav-buttons-container');return el?getComputedStyle(el).gap+' / pad '+getComputedStyle(el).padding:'';})(),
  explorerButtons,
  iconSizes:(()=>{const cs=getComputedStyle(document.body);return {'--icon-m':cs.getPropertyValue('--icon-m').trim(),'--icon-m-stroke-width':cs.getPropertyValue('--icon-m-stroke-width').trim(),'--icon-size':cs.getPropertyValue('--icon-size').trim()};})(),
  newTabIconBox:(()=>{const svg=newTabInnerEl&&newTabInnerEl.querySelector('svg');if(!svg)return null;const r=svg.getBoundingClientRect();return +r.width.toFixed(1)+'x'+ +r.height.toFixed(1);})(),
};

const activeTabEl=document.querySelector('.workspace-split.mod-root .workspace-tab-header.is-active');
const pseudoOf=(el,p)=>{const cs=getComputedStyle(el,p);return {content:cs.content,w:cs.width,h:cs.height,left:cs.left,right:cs.right,bottom:cs.bottom,pos:cs.position,bw:cs.borderWidth,bc:cs.borderColor,br:cs.borderRadius,shadow:cs.boxShadow,clip:cs.clipPath,bg:cs.backgroundColor,display:cs.display};};
const pseudo={ribbonBefore:color(ribbon,'::before'),activeTabBefore:color(activeTabEl,'::before'),activeTabBeforeFull:pseudoOf(activeTabEl,'::before'),activeTabAfterFull:pseudoOf(activeTabEl,'::after'),tabBox:activeTabEl?getComputedStyle(activeTabEl).borderRadius:''};
const VARNAMES=['--ribbon-width','--header-height','--divider-width','--divider-color','--titlebar-background','--titlebar-background-focused','--ribbon-background','--ribbon-background-collapsed','--tab-container-background','--tab-outline-color','--background-primary','--background-secondary','--background-secondary-alt','--frame-left-space'];
const variables={body:vars(body,VARNAMES),ribbon:vars(ribbon,VARNAMES),centerTabs:vars(document.querySelector('.workspace-split.mod-root .workspace-tabs'),VARNAMES)};

// 命中链：顶栏行（y=22）与 body 行（y=60）
const firstPainted=(x,y)=>{let node=document.elementFromPoint(x,y);while(node){const bg=getComputedStyle(node).backgroundColor;if(bg&&bg!=='rgba(0, 0, 0, 0)'&&bg!=='transparent')return {hit:sel(document.elementFromPoint(x,y)),paintedBy:sel(node),bg};node=node.parentElement;}return {hit:sel(document.elementFromPoint(x,y)),paintedBy:null,bg:'none'};};
const rows={};
for(const [key,y] of [['titlebar',22],['bodyRow',60]]){
  rows[key]={y,samples:[]};
  for(const x of [4,20,40,46,50,60,70,76,84,92,110,140,200,300,420,520,700,900]){
    if(x>window.innerWidth-2)continue;
    const el=document.elementFromPoint(x,y);
    rows[key].samples.push({x,paint:firstPainted(x,y),hit:sel(el)&&String(sel(el)).slice(0,60)});
  }
}
// 打开/收起切换后重测一遍，确认类切换是幂等的（同一状态连续两次 toggle）
// 渲染实验（令牌 'test'）：把活动标签的角弧伪元素染成红色，用截图定位它的真实盒子
if (want('test')) {
  const style=document.createElement('style');
  style.textContent='.workspace-tab-header.is-active::before,.workspace-tab-header.is-active::after{background-color:#ff0000 !important;border-color:#ff0000 !important}';
  document.head.appendChild(style);
  await wait(150);
}/* 令牌 'empty'：最后打开一个空标签页，让截图覆盖空态 pill（1.14 aI 取证） */
if (want('empty')) {
  app.commands.executeCommandById('workspace:new-tab');
  await wait(500);
  // pill 几何：原版三条 pill 等宽（width:100% 于 shrink-to-fit 的列容器）
  aligned.emptyPills=[...document.querySelectorAll('.workspace-split.mod-root .workspace-leaf.mod-active .empty-state-action')]
    .map((el)=>({text:el.textContent.trim(),w:+el.getBoundingClientRect().width.toFixed(1),h:+el.getBoundingClientRect().height.toFixed(1)}));
}
console.log('PROBE-TOPBAR '+JSON.stringify({state,bodyClass:String(body.className),nodes,aligned,pseudo,variables,rows},null,1));
return {pass:true,count:checks.length,checks,state,ribbonClass:String(ribbon.className),ribbonBg:nodes.ribbon&&nodes.ribbon.color,ribbonBefore:pseudo.ribbonBefore,centerHeader: nodes.centerHeader};
})()
