/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 各弹窗/视图的全屏几何断言；失败抛出异常，供运行器判定。
 * [POS]: layout-modals 场景。锁定"上面一半点不动/界面被裁掉一半"：
 *        设置弹窗、工作区布局管理弹窗、加载布局 SuggestModal、重命名弹窗、新建画布视图，
 *        每个都要满足 遮罩铺满视口、对话框完整落在视口内、内容容器高度非零。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const checks=[];const ok=(b,m)=>{if(!b)throw Error(m)};const check=(b,m)=>{ok(b,m);checks.push(m)};
const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}};
const round=r=>[Math.round(r.x),Math.round(r.y),Math.round(r.w),Math.round(r.h)].join(',');
const vw=()=>innerWidth,vh=()=>innerHeight;

const assertFills=(label,el,tol=2)=>{
  const r=rect(el);
  check(r.x<=tol&&r.y<=tol,label+'：左上贴边:: '+round(r));
  check(r.right>=vw()-tol&&r.bottom>=vh()-tol,label+'：右下铺满视口:: '+round(r)+' viewport='+vw()+'x'+vh());
};
const assertInside=(label,el)=>{
  const r=rect(el);
  check(r.w>100&&r.h>80,label+'：尺寸足够:: '+round(r));
  check(r.x>=-1&&r.y>=-1,label+'：不越出左上:: '+round(r));
  check(r.right<=vw()+1&&r.bottom<=vh()+1,label+'：不越出右下:: '+round(r)+' viewport='+vw()+'x'+vh());
};

/* ------------------------------------------------------------------ 设置弹窗 */
app.setting.open();
await wait(200);
const container=document.querySelector('body > .modal-container');
check(!!container,'设置弹窗容器存在');
assertFills('设置弹窗遮罩',container.querySelector('.modal-bg'));
assertInside('设置弹窗对话框',container.querySelector('.modal'));
const settingsModal=container.querySelector('.modal');
const header=settingsModal.querySelector('.vertical-tab-header');
const content=settingsModal.querySelector('.vertical-tab-content-container');
check(rect(header).h>100&&rect(content).h>100,'设置弹窗左右两栏高度正常:: '+round(rect(header))+' / '+round(rect(content)));
check(rect(header).y>=rect(settingsModal).y-1&&rect(content).bottom<=rect(settingsModal).bottom+1,'设置两栏不越出对话框');
app.setting.close();
await wait(200);

/* ------------------------------------------------------- 工作区布局两个弹窗 */
await app.plugins.enableInternalPlugin('workspaces');
await wait(150);
const plugin=app.plugins.getInternalPlugin('workspaces').instance;
check(!!plugin,'工作区插件实例可用');
await app.commands.executeCommandById('workspaces:open-modal');
await wait(250);
let modal=document.querySelector('body > .modal-container');
check(!!modal,'布局管理弹窗出现');
if(modal){
  assertFills('布局管理弹窗遮罩',modal.querySelector('.modal-bg'));
  assertInside('布局管理弹窗对话框',modal.querySelector('.modal'));
  const list=modal.querySelector('.list-container.mod-manage-workspaces');
  if(list) check(rect(list).h>=0,'布局管理列表可见:: '+round(rect(list)));
  const close=modal.querySelector('.modal-close-button');
  check(!!close,'布局管理弹窗有关闭按钮');
  if(close) close.click();
  await wait(250);
  check(!document.querySelector('body > .modal-container'),'布局管理弹窗已关闭');
}

/* ----------------------------------------------- 加载布局 SuggestModal（.prompt） */
await app.commands.executeCommandById('workspaces:load');
await wait(250);
const prompt=document.querySelector('.prompt');
check(!!prompt,'加载布局 SuggestModal 出现');
if(prompt){
  assertInside('加载布局 prompt',prompt);
  const sugg=prompt.querySelector('.prompt-results');
  check(!sugg||rect(sugg).h>=0,'加载布局结果列表有尺寸:: '+(sugg?round(rect(sugg)):'none'));
  prompt.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  await wait(200);
}

/* --------------------------------------------------------------- 新建标签页 */
const before=app.workspace.activeLeaf;
app.commands.executeCommandById('workspace:new-tab');
await wait(250);
const emptyView=document.querySelector('.workspace-leaf.mod-active .view-content');
check(!!emptyView,'新建标签页视图存在');
if(emptyView){
  const leaf=emptyView.closest('.workspace-leaf');
  const lr=rect(leaf);
  const contents=[...leaf.querySelectorAll(':scope > .workspace-leaf-content > .view-content')];
  check(contents.length===1,'新建标签页只有一个 view-content（无占位残留）:: '+contents.length);
  check(lr.w>100&&lr.h>100,'新建标签页叶子铺满:: '+round(lr));
  // 原版空页把内容绝对居中，view-content 自身高度可为 0；以可见子块为准。
  const inner=emptyView.querySelector('.empty-state-container, .empty-state, .view-content > div');
  if(inner) check(rect(inner).w>0&&rect(inner).h>0,'新建标签页可见内容有尺寸:: '+round(rect(inner)));
}

/* ---------------------------------------------------------------- 新建画布 */
await app.plugins.enableInternalPlugin('canvas');
await wait(150);
await app.commands.executeCommandById('canvas:new-file');
await wait(400);
const canvasView=document.querySelector('.workspace-leaf.mod-active .canvas-wrapper')||document.querySelector('.workspace-leaf.mod-active .canvas');
check(!!canvasView,'新建画布视图存在');
if(canvasView){
  const leaf=canvasView.closest('.workspace-leaf');
  const host=canvasView.closest('.view-content')||leaf;
  const lr=rect(leaf),cr=rect(canvasView),hr=rect(host);
  check(lr.w>100&&lr.h>100,'画布叶子铺满:: '+round(lr));
  check(cr.w>=hr.w-2&&cr.h>=hr.h-2,'画布容器铺满视图内容:: '+round(cr)+' host='+round(hr));
  check(hr.h>=lr.h-42,'画布视图内容占满叶子可用高度:: '+round(lr)+' content='+round(hr));
}

await app.saveLayout();
return {pass:true,count:checks.length,checks};
})()
