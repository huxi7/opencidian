/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: canvas 场景。仅由 run.mjs 在带标记的临时库执行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const wait=ms=>new Promise(r=>setTimeout(r,ms));const ok=(b,m)=>{if(!b)throw Error(m)};
await app.commands.findCommand('canvas:new-file').callback();await wait(250);
const v=app.workspace.activeLeaf.view;ok(v.canvasRect.width>0,'canvas measured');
v.cardMenuEl.children[0].click();await wait(100);
const a=[...v.nodes.values()][0];ok(a.editorEl?.isConnected,'editor mounted');
a.editorEl.value='# Canvas acceptance\nEdited and persisted';a.editorEl.dispatchEvent(new Event('input',{bubbles:true}));await wait(650);
ok(JSON.parse(await app.vault.read(v.file)).nodes[0].text.includes('persisted'),'typing saved before blur');
a.editorEl.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
const b=v.createTextNode({pos:{x:a.x+340,y:a.y+120},text:'Target node',focus:false});
const start=a.nodeEl.querySelector('[data-side="right"]');const from=v.domFromPos({x:a.x+a.width,y:a.y+a.height/2});const to=v.domFromPos({x:b.x,y:b.y+b.height/2});
const pointer=(target,type,p)=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,isPrimary:true,pointerType:'mouse',pointerId:7,button:0,buttons:type==='pointerup'?0:1,clientX:p.x+v.canvasRect.cx,clientY:p.y+v.canvasRect.cy}));
pointer(start,'pointerdown',from);pointer(window,'pointermove',to);pointer(window,'pointerup',to);await wait(700);
ok(v.edges.size===1,'pointer connection');
v.zoomBy(-100);await wait(800);ok(v.tZoom===-4,'zoom clamped');
v.zoomBy(100);await wait(800);ok(v.tZoom===1,'zoom clamped upper');ok(!v.frame,'zoom animation stops');
v.zoomToFit();v.finishViewportAnimation=true;await wait(100);
const f=v.file;await app.workspace.activeLeaf.setViewState({type:'empty',state:{}});await app.workspace.openFile(f);await wait(200);
const restored=app.workspace.activeLeaf.view;ok(restored.nodes.size===2&&restored.edges.size===1,'canvas reopen');
// ---- 边跟随节点移动（帧渲染把关联边加入重绘集合）----
const followEdge=[...restored.edges.values()][0];
const followPath=followEdge.lineGroupEl.querySelector('.canvas-display-path');
const followBefore=followPath.getAttribute('d');
const followNode=followEdge.from.node;
followNode.moveTo({x:followNode.x+60,y:followNode.y-30});await wait(120);
ok(followPath.getAttribute('d')!==followBefore,'edge follows node move');
followNode.moveTo({x:followNode.x-60,y:followNode.y+30});await wait(120);
ok(followPath.getAttribute('d')===followBefore,'edge follows node move back');
// ---- 撤销/重做 ----
ok(restored.undoBtnEl.classList.contains('is-disabled')&&restored.redoBtnEl.classList.contains('is-disabled'),'fresh history disables undo/redo');
restored.createTextNode({pos:{x:200,y:600},text:'undo target',focus:false});
await wait(450);
ok(restored.history.canUndo(),'action pushes history');
ok(!restored.undoBtnEl.classList.contains('is-disabled'),'undo button enabled after action');
const kd=(k,extra={})=>restored.wrapperEl.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true,...extra}));
kd('z',{metaKey:true});await wait(120);
ok(restored.nodes.size===2&&restored.history.canRedo(),'undo removes created node');
await wait(600);
ok(JSON.parse(await app.vault.read(restored.file)).nodes.length===2,'undo persists to disk');
kd('z',{metaKey:true,shiftKey:true});await wait(120);
ok(restored.nodes.size===3,'redo restores node');
restored.undoBtnEl.click();await wait(120);
ok(restored.nodes.size===2,'undo button works');
restored.redoBtnEl.click();await wait(120);
ok(restored.nodes.size===3&&restored.redoBtnEl.classList.contains('is-disabled'),'redo button works');
// ---- 方向键微移与网格吸附 ----
const moveNode=[...restored.nodes.values()].find(n=>n.getData().type==='text'&&n.text.includes('persisted'));
ok(!!moveNode,'node found for nudge');
restored.options.snapToGrid=false;
restored.selectOnly(moveNode);
const grid=restored.gridSpacing;
const nudgeX=moveNode.x;
kd('ArrowRight');await wait(80);
ok(moveNode.x===nudgeX+grid,'arrow nudges by grid spacing');
kd('ArrowLeft',{shiftKey:true});await wait(80);
ok(moveNode.x===nudgeX-4*grid,'shift nudges five steps');
restored.options.snapToGrid=true;
moveNode.moveTo({x:grid*10+3,y:grid*2});await wait(80);
kd('ArrowRight');await wait(80);
ok(moveNode.x===grid*11,'nudge snaps to grid line');
restored.options.snapToGrid=false;
// ---- 快速设置菜单（对齐网格 / 对齐物体 / 只读）----
const findMenuItems=()=>[...document.querySelectorAll('.menu .menu-item')];
const beforeSnap=restored.options.snapToGrid;
restored.quickSettingsButton.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));await wait(60);
let menuItems=findMenuItems();
ok(menuItems.length===3,'quick settings menu has three items');
ok(restored.quickSettingsButton.classList.contains('has-active-menu'),'parent element marked while menu open');
menuItems[0].dispatchEvent(new MouseEvent('click',{bubbles:true}));await wait(60);
ok(restored.options.snapToGrid===!beforeSnap,'snap-to-grid toggles');
ok(app.settings.loadPluginData('canvas.json',{}).snapToGrid===!beforeSnap,'snap-to-grid persists to canvas.json');
ok(!restored.quickSettingsButton.classList.contains('has-active-menu'),'parent mark cleared after close');
restored.quickSettingsButton.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));await wait(60);
menuItems=findMenuItems();
menuItems[2].dispatchEvent(new MouseEvent('click',{bubbles:true}));await wait(60);
ok(restored.readonly===true&&restored.wrapperEl.classList.contains('mod-readonly'),'readonly toggles on');
ok(JSON.parse(localStorage.getItem('canvas-'+restored.file.path)||'null')?.readonly===true,'readonly persists to local data');
ok(!!restored.quickSettingsButton.querySelector('svg.lucide-lock'),'readonly icon swaps to lock');
restored.setReadonly(false);
// ---- 转换为文件 ----
const textNode=[...restored.nodes.values()].find(n=>n.getData().type==='text'&&n.text.includes('persisted'));
ok(!!textNode,'text node found for conversion');
restored.selectOnly(textNode);
const geom={x:textNode.x,y:textNode.y,width:textNode.width,height:textNode.height};
const cmd=app.commands.findCommand('canvas:convert-to-file');
ok(cmd.checkCallback(true)===true,'convert command available for single text card');
app.commands.executeCommandById('canvas:convert-to-file');await wait(120);
const renameModal=document.querySelector('.modal.mod-file-rename');
ok(renameModal&&renameModal.querySelector('.rename-textarea').value==='Untitled','rename modal defaults to Untitled');
const area=renameModal.querySelector('.rename-textarea');
area.value='bad/name';
renameModal.querySelector('.modal-button-container .mod-cta').click();await wait(60);
ok(renameModal.querySelector('.rename-error').style.display!=='none','invalid name blocks conversion');
area.value='Converted Note';
renameModal.querySelector('.modal-button-container .mod-cta').click();await wait(400);
ok(!document.querySelector('.modal.mod-file-rename:not(.is-hidden)'),'rename modal closed on submit');
const created=app.vault.getFileByPath('Converted Note.md')||app.vault.getAbstractFileByPath('Converted Note.md');
ok(!!created,'converted note created');
ok((await app.vault.read(created)).includes('persisted'),'converted note keeps card text');
const fileNode=[...restored.nodes.values()].find(n=>n.getData().type==='file');
ok(!!fileNode,'file node created');
ok(fileNode.x===geom.x&&fileNode.y===geom.y&&fileNode.width===geom.width&&fileNode.height===geom.height,'file node keeps geometry');
ok(![...restored.nodes.values()].some(n=>n.getData().type==='text'&&n.text.includes('persisted')),'text node removed');
const convEdge=[...restored.edges.values()][0];
ok(!!convEdge&&(convEdge.from.node===fileNode||convEdge.to.node===fileNode),'edge rewired to file node');
kd('z',{metaKey:true});await wait(150);
ok([...restored.nodes.values()].some(n=>n.getData().type==='text'&&n.text.includes('persisted')),'undo restores text card after conversion');
kd('z',{metaKey:true,shiftKey:true});await wait(150);
ok([...restored.nodes.values()].some(n=>n.getData().type==='file'&&n.file&&n.file.path==='Converted Note.md'),'redo re-applies conversion');
// ---- 只读标记跨重开恢复 ----
restored.setReadonly(true);restored.saveLocalData();
await app.workspace.activeLeaf.setViewState({type:'empty',state:{}});
await app.workspace.openFile(f);await wait(250);
const reopened=app.workspace.activeLeaf.view;
ok(reopened.readonly===true,'readonly restored on reopen');
reopened.quickSettingsButton.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));await wait(80);
ok(reopened.readonly===false&&!reopened.wrapperEl.classList.contains('mod-readonly'),'readonly button click exits readonly');
ok(localStorage.getItem('canvas-'+f.path)===null,'readonly cleared from local data');
await app.saveLayout();
return {pass:true,file:f.path,nodes:restored.nodes.size,edges:restored.edges.size,rect:restored.canvasRect,converted:created.path};
})()
