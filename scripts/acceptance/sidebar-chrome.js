/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回侧栏折叠/展开的顶栏几何与 FLIP 动画断言；失败抛出异常，供运行器判定。
 * [POS]: sidebar-chrome 场景。钉住"折叠侧分隔条隐藏（不穿红绿灯）、toggle 迁移与 140ms FLIP 动画"。
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
return {pass:true,checks};
})()
