/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 侧栏折叠/展开的顶栏几何、FLIP 动画与顶栏配色断言（计算样式锁）；失败抛出异常。
 * [POS]: sidebar-chrome 场景。钉住三件事：折叠侧分隔条不占位不穿红绿灯、toggle 迁移与 140ms FLIP、
 * 功能区/标签栏/左上角 44x40 由 --titlebar-background 同一变量驱动（收起无色块接缝）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const checks=[];
const check=(ok,msg)=>{if(!ok)throw Error('✗ '+msg);checks.push(msg);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const ws=app.workspace;
// 红绿灯保留区（macOS hidden 标题栏 + trafficLightPosition 19,12）
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

// ---------------------------------------------------------------- 收起左栏
ws.toggleSidebar('left');
check(ws.leftSplit.collapsed===true,'左栏已收起');
await wait(40);
check(toggleEl().getAnimations&&toggleEl().getAnimations().length>0,'收起时 toggle 有 FLIP 动画（newStyle=offset）');
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
check(tabContainerBg!==tabContainerBgFocused,'顶栏底色在焦点态确实换值（前置：token 有区分）');

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
  '焦点态中心标签栏切到 titlebar-background-focused :: '+centerHeaderBg());
check(ribbonBefore()===centerHeaderBg(),'焦点态：功能区左上角与中心标签栏仍同色（红绿灯区无接缝）');
body.toggleClass('is-focused', focusedBefore);
await wait(60);
const fillet=()=>getComputedStyle(activeTabEl(),'::before');
check(fillet().width===tokenOf('--tab-curve')&&fillet().backgroundColor===colorOf('--tab-background-active', activeTabEl()),
  '活动标签底角凹弧存在且填标签底色（原版 6171-6196）');
check(getComputedStyle(document.querySelector('.workspace-split.mod-root .workspace-tab-header-container-inner')).paddingLeft===tokenOf('--tab-curve'),
  '标签栏内层左右留凹弧空间（否则 overflow 裁掉弧线）');
ws.toggleSidebar('left');
await wait(520);
check(!ribbonEl().hasClass('is-collapsed')&&bgOf(ribbonEl())===colorOf('--ribbon-background'),
  '展开后功能区回到 --ribbon-background 且去掉 is-collapsed :: '+bgOf(ribbonEl()));
check(leftHandle().getBoundingClientRect().width>0&&getComputedStyle(leftHandle()).opacity==='1','展开后左侧分隔条恢复占位与不透明');

return {pass:true,checks};
})()
