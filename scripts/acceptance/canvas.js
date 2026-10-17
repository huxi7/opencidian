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
await app.saveLayout();
return {pass:true,file:f.path,nodes:restored.nodes.size,edges:restored.edges.size,rect:restored.canvasRect};
})()
