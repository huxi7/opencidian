/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 新建画布后的祖先链几何与计算样式（console.log PROBE-CANVAS-GEO + 截图）。
 * [POS]: 诊断探针（非断言锁）。用于定位"画布只占下半屏"：逐层打印 leaf / view-content / canvas-wrapper
 *        的 rect 与 position/height/display/contain/transform，确认 100% 高度的包含块是谁。
 */
(async()=>{
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const rect=el=>{const r=el.getBoundingClientRect();return [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)].join(',')};
const style=el=>{const s=getComputedStyle(el);return {position:s.position,height:s.height,width:s.width,display:s.display,contain:s.contain,transform:s.transform,flex:s.flex,inset:s.inset,overflow:s.overflow}};
await app.plugins.enableInternalPlugin('canvas');
await wait(150);
// 先造一个空标签页，再从它打开画布——复现"两个 view-content 各占一半"
await app.commands.executeCommandById('workspace:new-tab');
await wait(300);
const emptyLeaf=app.workspace.activeLeaf;
const emptyRoot=emptyLeaf&&emptyLeaf.view&&emptyLeaf.view._rootEl;
console.log('PROBE-CANVAS-EMPTY '+JSON.stringify({type:emptyLeaf&&emptyLeaf.view.getViewType(), hasRoot:!!emptyRoot, connected:!!(emptyRoot&&emptyRoot.isConnected), contentChildren:emptyLeaf&&emptyLeaf.contentEl?emptyLeaf.contentEl.children.length:null, leafSame:!!(emptyLeaf&&emptyLeaf._leafEl&&emptyLeaf._leafEl.isConnected)}));
await app.commands.executeCommandById('canvas:new-file');
await wait(600);
console.log('PROBE-CANVAS-DETACH '+JSON.stringify({emptyRootConnected:!!(emptyRoot&&emptyRoot.isConnected), sameLeaf:emptyLeaf===app.workspace.activeLeaf, childrenNow:emptyLeaf&&emptyLeaf.contentEl?emptyLeaf.contentEl.children.length:null, activeRootInContent:!!(app.workspace.activeLeaf&&app.workspace.activeLeaf.view&&app.workspace.activeLeaf.view._rootEl&&emptyLeaf.contentEl.contains(app.workspace.activeLeaf.view._rootEl))}));
const leaf=document.querySelector('.workspace-leaf.mod-active');
const kids=[...(leaf?leaf.querySelectorAll(':scope > .workspace-leaf-content > *'):[])].map(el=>({cls:String(el.className),rect:rect(el),first:String((el.firstElementChild&&el.firstElementChild.className)||'')}));
console.log('PROBE-CANVAS-KIDS '+JSON.stringify(kids));
console.log('PROBE-CANVAS-STATE '+JSON.stringify({leafCount:document.querySelectorAll('.workspace-leaf').length, activeType:app.workspace.activeLeaf&&app.workspace.activeLeaf.view&&app.workspace.activeLeaf.view.getViewType(), leafSame:!!(leaf&&app.workspace.activeLeaf&&app.workspace.activeLeaf.containerEl===leaf)}));
const wrapper=document.querySelector('.canvas-wrapper');
if(!wrapper){console.log('PROBE-CANVAS-GEO '+JSON.stringify({error:'no wrapper'}));return {pass:true,count:1,checks:['no wrapper']};}
const chain=[];
let node=wrapper;
for(let i=0;i<8&&node;i++){
  chain.push({cls:String(node.className||node.tagName),rect:rect(node),style:style(node)});
  node=node.parentElement;
}
const info={viewport:[innerWidth,innerHeight],chain};
console.log('PROBE-CANVAS-GEO '+JSON.stringify(info,null,1));
await app.saveLayout();
return {pass:true,count:1,checks:['probe'],info};
})()
