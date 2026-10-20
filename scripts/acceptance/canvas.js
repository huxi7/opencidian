/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: canvas 场景。仅由 run.mjs 在带标记的临时库执行。覆盖新建/编辑落盘/连线/缩放/重开/边跟随/撤销重做/微移/快速设置/转换/只读恢复，
 *        并覆盖图片导出（命令可用性、面板菜单文案、导出弹窗四项设置与取消不落盘、确认后按倍率落盘并遵守 4096 上限、
 *        renderCanvasImage 的 dataURL/maxSize 上限/倍率/视口范围/水印/隐私模式与文字墨迹消失）与拖动对齐参考线
 *        （吸附到对齐值、出现 svg.canvas-snaps 参考线、松手清除、snapToObjects 关闭时不吸附）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const wait=ms=>new Promise(r=>setTimeout(r,ms));const checks=[];const ok=(b,m)=>{if(!b)throw Error(m);checks.push(m)};
// 指针事件助手：p 为相对画布中心的 DOM 坐标
const evt=(target,type,p)=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,isPrimary:true,pointerType:'mouse',pointerId:9,button:0,buttons:type==='pointerup'?0:1,clientX:p.x+reopened.canvasRect.cx,clientY:p.y+reopened.canvasRect.cy}));
// 统计与左上角背景像素差异超过 threshold 的像素数（导出图必须画出内容）
const countPixels=async(image,threshold)=>{const pic=new Image();pic.src=image.dataURL;await new Promise((r,j)=>{pic.onload=r;pic.onerror=j});const c=document.createElement('canvas');c.width=pic.width;c.height=pic.height;const x=c.getContext('2d');x.drawImage(pic,0,0);const d=x.getImageData(0,0,c.width,c.height).data;const bg=[d[0],d[1],d[2]];let n=0;for(let i=0;i<d.length;i+=4){if(Math.abs(d[i]-bg[0])+Math.abs(d[i+1]-bg[1])+Math.abs(d[i+2]-bg[2])>threshold)n++}return n};
const countNonBackgroundPixels=image=>countPixels(image,12);
const countTextInkPixels=image=>countPixels(image,400);
await app.commands.findCommand('canvas:new-file').callback();await wait(250);
const v=app.workspace.activeLeaf.view;ok(v.canvasRect.width>0,'canvas measured');
// ---- 空画布不导出：命令入口在无节点时只提示，不弹保存对话框 ----
ok(v.renderCanvasImage()===null,'empty canvas renders no image');
ok(await v.generateHDImage()===null,'empty canvas export refused');
ok(/empty|空白/i.test(document.querySelector('.notice-message')?.textContent||''),'empty canvas export shows notice');
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
// ---- 清空画布：为导出与对齐参考线准备确定性内容 ----
reopened.selectAll();reopened.deleteSelection();await wait(60);
const gA=reopened.createTextNode({pos:{x:100,y:100},size:{width:100,height:100},text:'Guide A',focus:false,save:false});
const gB=reopened.createTextNode({pos:{x:400,y:300},size:{width:100,height:100},text:'Guide B',focus:false,save:false});
const guideGroup=reopened.createGroupNode({pos:{x:2000,y:1600},size:{width:400,height:300},label:'Guide Group',focus:false,save:false});
reopened.createLinkNode({pos:{x:2600,y:2000},size:{width:200,height:100},url:'https://example.com',focus:false,save:false});
reopened.createEdge({side:'right',node:gA,end:'none'},{side:'left',node:gB,end:'arrow'},false);
ok(reopened.nodes.size===4&&reopened.edges.size===1,'guide fixtures replace canvas content');
reopened.deselectAll();
// ---- 导出图片：命令、面板菜单与可测试渲染 ----
const exportCmd=app.commands.findCommand('canvas:export-as-image');
ok(!!exportCmd&&exportCmd.icon==='lucide-image','export-as-image command registered');
ok(exportCmd.checkCallback(true)===true,'export command available with canvas open');
const moreBtn=document.querySelector('.workspace-leaf-content[data-type="canvas"] .view-actions .mod-more-options');
ok(!!moreBtn,'canvas view actions expose more-options button');
moreBtn.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));await wait(80);
ok(findMenuItems().some(el=>/导出|Export/.test(el.textContent)),'pane menu offers export as image');
document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));await wait(60);
ok(findMenuItems().length===0,'pane menu closed after outside click');
const fullImage=reopened.renderCanvasImage();
ok(!!fullImage&&fullImage.dataURL.startsWith('data:image/png;base64,'),'render returns PNG data URL');
ok(fullImage.dataURL.length>1000,'export PNG carries payload');
ok(atob(fullImage.dataURL.split(',')[1].slice(0,16)).startsWith('\u0089PNG'),'export payload is a PNG file');
ok(fullImage.width>1024&&fullImage.height>1024,'full export larger than the cap used below');
const cappedImage=reopened.renderCanvasImage({maxSize:1024});
ok(cappedImage.width<=1024&&cappedImage.height<=1024&&cappedImage.width>0,'export size capped by maxSize');
const drawn=await countNonBackgroundPixels(cappedImage);
ok(drawn>0,'export image contains drawn pixels');
// 分组背景图：真实导出由 saveCanvasImage 预载；纯渲染用 opts.images 注入同一张图
guideGroup.bgPath='资产.png';guideGroup.bgStyle='cover';
const redCanvas=document.createElement('canvas');redCanvas.width=2;redCanvas.height=2;
const redCtx=redCanvas.getContext('2d');redCtx.fillStyle='#ff0000';redCtx.fillRect(0,0,2,2);
const redImage=new Image();redImage.src=redCanvas.toDataURL('image/png');await new Promise((res,rej)=>{redImage.onload=res;redImage.onerror=rej});
const withGroupBg=reopened.renderCanvasImage({images:new Map([[guideGroup,redImage]])});
ok(withGroupBg.dataURL!==fullImage.dataURL,'分组背景图进入导出渲染');
guideGroup.bgPath='';
// ---- 导出弹窗：范围/缩放/水印/隐私四项设置，取消不落盘 ----
let saveCalls=0;
const exportPath=app.vaultPath+'/Export Dialog.png';
reopened.promptImageSavePath=()=>{saveCalls+=1;return{canceled:false,filePath:exportPath}};
const openDialog=()=>document.querySelector('.modal.mod-narrow:not(.is-hidden)');
app.commands.executeCommandById('canvas:export-as-image');
await wait(180);
let dialog=openDialog();
ok(!!dialog,'export command opens the settings dialog');
ok(/Export|导出/.test(dialog.querySelector('.modal-title').textContent||''),'dialog title is the export action');
ok(dialog.querySelectorAll('.setting-item').length===4,'dialog has frame/zoom/logo/privacy settings');
ok((dialog.querySelector('.modal-content .u-muted').textContent||'').includes(reopened.file.basename),'dialog description names the canvas file');
const frameSelect=dialog.querySelector('.setting-item select.dropdown');
ok(!!frameSelect&&frameSelect.options.length===2,'frame dropdown offers two ranges');
ok(frameSelect.value==='full','frame defaults to the full canvas');
const zoomSlider=dialog.querySelector('.setting-item input.slider');
ok(!!zoomSlider&&Number(zoomSlider.max)>0&&Number(zoomSlider.min)<0,'zoom slider spans the capture range');
const toggles=dialog.querySelectorAll('.setting-item .checkbox-container');
ok(toggles.length===2,'logo and privacy toggles exist');
ok(toggles[0].classList.contains('is-enabled')&&!toggles[1].classList.contains('is-enabled'),'logo on and privacy off by default');
const settingDesc=i=>dialog.querySelectorAll('.setting-item')[i].querySelector('.setting-item-description').textContent||'';
ok(/px x/.test(settingDesc(1)),'zoom setting shows the estimated dimensions');
frameSelect.value='viewport';
frameSelect.dispatchEvent(new Event('change',{bubbles:true}));
await wait(60);
ok(dialog.querySelectorAll('.setting-item:not(.is-hidden)').length===2,'viewport range hides zoom and logo settings');
frameSelect.value='full';
frameSelect.dispatchEvent(new Event('change',{bubbles:true}));
await wait(60);
ok(dialog.querySelectorAll('.setting-item:not(.is-hidden)').length===4,'full range restores the hidden settings');
dialog.querySelector('.modal-close-button').click();
await wait(250);
ok(!openDialog(),'dialog closes on cancel');
ok(saveCalls===0,'cancel produces no output');
// ---- 面板菜单入口同样弹出设置弹窗 ----
moreBtn.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
await wait(80);
findMenuItems().find(el=>/导出|Export/.test(el.textContent)).dispatchEvent(new MouseEvent('click',{bubbles:true}));
await wait(180);
ok(!!openDialog(),'pane menu export opens the settings dialog');
openDialog().querySelector('.modal-close-button').click();
await wait(250);
ok(!openDialog()&&saveCalls===0,'menu-driven cancel produces no output');
// ---- 确认弹出：滑杆拉到上限，输出按倍率落盘并遵守 4096 上限 ----
const pending=reopened.generateHDImage();
await wait(180);
dialog=openDialog();
ok(!!dialog,'generateHDImage opens the dialog');
const confirmSlider=dialog.querySelector('.setting-item input.slider');
confirmSlider.value=confirmSlider.max;
confirmSlider.dispatchEvent(new Event('change',{bubbles:true}));
await wait(60);
ok(/4,?096px/.test(settingDesc(1)),'estimated dimensions follow the zoom multiplier');
dialog.querySelector('.modal-button-container .mod-cta').click();
const exported=await pending;
await wait(200);
ok(saveCalls===1,'confirm asks the view for a save path');
ok(!!exported&&exported.filePath===exportPath,'confirm writes to the chosen path');
const png=require('fs').readFileSync(exportPath);
ok(png.slice(1,4).toString()==='PNG','written file is a PNG');
ok(png.readUInt32BE(16)===4096&&png.readUInt32BE(20)>fullImage.height,'written image respects the 4096 cap and the zoom multiplier');
// ---- 渲染器选项：倍率、视口范围、水印、隐私模式 ----
const zoomedImage=reopened.renderCanvasImage({scale:2});
ok(zoomedImage.width>fullImage.width&&zoomedImage.width<=4096&&zoomedImage.height<=4096,'scale raises output size under the cap');
const halfImage=reopened.renderCanvasImage({scale:0.5});
ok(Math.abs(halfImage.width-Math.round(fullImage.width/2))<=1,'scale lowers output size by the multiplier');
const viewportImage=reopened.renderCanvasImage({frame:'viewport'});
ok(Math.abs(viewportImage.width-Math.round(reopened.canvasRect.width))<=2&&viewportImage.width<fullImage.width,'viewport frame crops to the visible area');
const logoImage=reopened.renderCanvasImage({showLogo:true});
ok(await countNonBackgroundPixels(logoImage)>await countNonBackgroundPixels(fullImage),'logo adds drawn pixels');
const privacyImage=reopened.renderCanvasImage({privacyMode:true});
ok(await countTextInkPixels(fullImage)>0&&await countTextInkPixels(privacyImage)===0,'privacy mode replaces text with bars');
// ---- 拖动对齐参考线 ----
reopened.options.snapToGrid=false;reopened.options.snapToObjects=true;
const dragB=(dx,dy)=>{const p={x:gB.x+gB.width/2,y:gB.y+gB.height/2};const a=reopened.domFromPos(p),b=reopened.domFromPos({x:p.x+dx,y:p.y+dy});evt(gB.containerEl,'pointerdown',a);evt(window,'pointermove',b);return b};
gB.moveTo({x:400,y:300});
let drop=dragB(-297,0);
ok(gB.x===100,'drag snaps left edge to other node');
ok(!!reopened.snapContainerEl&&reopened.snapContainerEl.querySelectorAll('line').length>0,'alignment guide drawn while dragging');
ok(reopened.snapContainerEl.querySelectorAll('circle').length>0,'alignment guide marks matched points');
evt(window,'pointerup',drop);await wait(80);
ok(reopened.snapContainerEl===null,'alignment guide cleared after drag');
ok(gB.x===100,'snap kept after drop');
gB.moveTo({x:400,y:300});
reopened.options.snapToObjects=false;
drop=dragB(-297,0);
ok(gB.x===103&&reopened.snapContainerEl===null,'snapToObjects off disables snapping and guides');
evt(window,'pointerup',drop);await wait(80);
reopened.options.snapToObjects=true;reopened.options.snapToGrid=true;
// ---- 无画布时导出命令不可用 ----
await app.workspace.activeLeaf.setViewState({type:'empty',state:{}});await wait(120);
ok(app.commands.findCommand('canvas:export-as-image').checkCallback(true)===false,'export command unavailable without canvas');
await app.saveLayout();
return {pass:true,checks,count:checks.length,file:f.path,nodes:4,edges:1,rect:restored.canvasRect,converted:created.path,export:{full:fullImage.width+'x'+fullImage.height,capped:cappedImage.width+'x'+cappedImage.height,pixels:drawn,dialog:exported.width+'x'+exported.height,viewport:viewportImage.width+'x'+viewportImage.height},snapping:{aligned:gA.x,guides:'cleared'}};
})()
