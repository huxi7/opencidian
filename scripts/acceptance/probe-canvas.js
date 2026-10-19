/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例；PROBE_SCENE 选择取证场景（board/dark/empty/states/menus）；截图由 dev-hooks 在 2500ms 捕获。
 * [OUTPUT]: 画布场景截图与节点几何/样式诊断（console.log PROBE-CANVAS）。
 * [POS]: scripts/acceptance 的截图诊断场景（非断言锁；UI 巡检与前后对比取证，可复用）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const checks=[];
const check=(ok,m)=>{if(!ok)throw Error('✗ '+m);checks.push(m);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const r2=(n)=>Math.round(n*100)/100;
const scene=(typeof process!=='undefined'&&process.env&&process.env.PROBE_SCENE)||'board';
const theme=scene==='dark'?'obsidian':'moonstone';
app.settings.updateAppearance({theme});
await wait(200);
const pick=(el,props)=>{if(!el)return null;const cs=getComputedStyle(el);const o={};for(const p of props)o[p]=cs.getPropertyValue(p);return o;};
const outline=(el,depth)=>{
  if(!el||depth<0)return null;
  const cls=(el.className&&typeof el.className==='string')?el.className:el.getAttribute('class')||'';
  const tag=el.tagName.toLowerCase();
  const kids=[...el.children].slice(0,12).map(c=>outline(c,depth-1)).filter(Boolean);
  return tag+(cls?'.'+cls.trim().split(/\s+/).join('.'):'')+(kids.length?' > ['+kids.join(', ')+']':'');
};
const rectOfEl=el=>{const r=el.getBoundingClientRect();return {x:r2(r.x),y:r2(r.y),w:r2(r.width),h:r2(r.height)};};

const BOX=['background-color','color','border-width','border-color','border-radius','box-shadow','font-size','font-family','line-height','padding','opacity','z-index','fill','stroke','stroke-width','display','transform','position','width','height','max-width','overflow','text-align','align-items','justify-content','flex-direction','gap'];
const report={scene,theme,checks};

if(scene==='empty'){
  await app.commands.findCommand('canvas:new-file').callback();await wait(400);
  const view=app.workspace.activeLeaf.view;
  report.viewType=view.getViewType();
  report.placeholder={text:document.querySelector('.canvas-placeholder-message')?.textContent,
    styles:pick(document.querySelector('.canvas-placeholder-message'),BOX)};
  report.wrapper=pick(document.querySelector('.canvas-wrapper'),BOX);
  report.controls={
    groups:[...document.querySelectorAll('.canvas-control-group')].map(g=>({cls:g.className,items:[...g.children].map(i=>({cls:i.className,icon:i.querySelector('svg')?.getAttribute('class'),label:i.getAttribute('aria-label')}))})),
    box:rectOfEl(document.querySelector('.canvas-controls')),
    styles:pick(document.querySelector('.canvas-controls'),BOX)};
  report.cardMenu={box:rectOfEl(document.querySelector('.canvas-card-menu')),styles:pick(document.querySelector('.canvas-card-menu'),BOX),
    buttons:[...document.querySelectorAll('.canvas-card-menu-button')].map(b=>({cls:b.className,icon:b.querySelector('svg')?.getAttribute('class'),svgFill:b.querySelector('svg')?getComputedStyle(b.querySelector('svg')).fill:null,styles:pick(b,['color','padding','height'])})),
    dividerCount:document.querySelectorAll('.canvas-card-menu-divider').length};
  console.log('PROBE-CANVAS '+JSON.stringify(report,null,1));
  return {pass:true,checks,scene};
}

await app.vault.create('Note.md','# Note\n\n内容 **bold** 与链接 [a](https://example.com)\n\n- 项一\n- 项二\n');
const PNG_BASE64='iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAIAAAAt/+nTAAAAc0lEQVR4nO3XQQnEQBAF0ZoSEiWRELlRshJWwUhYA8kph9mCvGPzDw0NDX/MObnyPY7L+Xaef5WXOImTOImTOImTuPHZ98S/327y+QtInMRJnMRJnMSNtw8sJnESJ3ESJ3ESN94+sJjESZzESZzEuXqBp37gpDJxZINNjwAAAABJRU5ErkJggg==';
await app.vault.createBinary('资产.png',Uint8Array.from(atob(PNG_BASE64),(c)=>c.charCodeAt(0)));
await app.vault.createBinary('损坏.png',Uint8Array.from(atob(PNG_BASE64),(c)=>c.charCodeAt(0))).then(f=>app.vault.modifyBinary(f,Uint8Array.from([1,2,3,4,5,6,7,8])));
const canvas={nodes:[
  {id:'g1',type:'group',label:'分组一',x:-560,y:-360,width:960,height:700},
  {id:'g2',type:'group',label:'内组',x:-520,y:200,width:420,height:260},
  {id:'t1',type:'text',text:'# 卡片\n\n正文 **粗体** 与 $x^2$ 数学\n\n- 列表项\n- 第二项',x:-500,y:-280,width:360,height:230},
  {id:'t2',type:'text',text:'色卡',color:'4',x:-100,y:-280,width:220,height:160},
  {id:'i1',type:'file',file:'资产.png',x:160,y:-280,width:220,height:200},
  {id:'f1',type:'file',file:'Note.md',x:-500,y:-20,width:360,height:180},
  {id:'l1',type:'link',url:'https://obsidian.md',x:-100,y:-60,width:300,height:120},
  {id:'b1',type:'file',file:'损坏.png',x:160,y:40,width:200,height:160},
  {id:'m1',type:'file',file:'不存在.md',x:160,y:-120,width:200,height:120}
],edges:[
  {id:'e1',fromNode:'t1',fromSide:'right',toNode:'f1',toSide:'top'},
  {id:'e2',fromNode:'t2',fromSide:'bottom',toNode:'i1',toSide:'top',label:'连线标签',color:'5'}
]};
const f=await app.vault.create('Probe.canvas',JSON.stringify(canvas));
await app.workspace.openFile(f);
await wait(900);

const view=app.workspace.activeLeaf.view;
const vt=view.getViewType?view.getViewType():'?';
check(vt==='canvas','已打开画布视图 :: '+vt);
const nodes=[...view.nodes.values()];
check(nodes.length===9,'九个节点已装载 :: '+nodes.length);
report.viewType=vt;

/** 布局稳定后再量一次视口与卡片（eval 早期时刻的尺寸未必是最终布局，截图在 2500ms）。 */
const wrapperEl=document.querySelector('.canvas-wrapper');
if(scene==='board'||scene==='dark'){
  await wait(1300);
  report.late={rect:view.canvasRect,box:rectOfEl(wrapperEl),
    transform:getComputedStyle(document.querySelector('.canvas')).transform,
    x:r2(view.x),y:r2(view.y),zoom:r2(view.zoom),scale:r2(view.scale),viewportChanged:view.viewportChanged,
    nodes:[...view.nodes.values()].map(n=>({id:n.id,type:n.getData().type,z:getComputedStyle(n.nodeEl).zIndex,box:rectOfEl(n.nodeEl),cls:n.nodeEl.className})),
    medias:[...document.querySelectorAll('.canvas-node-content img, .canvas-node-content audio, .canvas-node-content video')]
      .map(el=>({tag:el.tagName,src:(el.getAttribute('src')||'').slice(0,70),complete:el.complete,natural:el.naturalWidth+'x'+el.naturalHeight,box:rectOfEl(el),parent:el.parentElement.className}))};
}
report.viewport={rect:view.canvasRect,box:rectOfEl(view.wrapperEl),x:r2(view.x),y:r2(view.y),zoom:r2(view.zoom),scale:r2(view.scale),tZoom:r2(view.tZoom),tx:r2(view.tx),ty:r2(view.ty),frame:view.frame,viewportChanged:view.viewportChanged,cls:view.wrapperEl.className};

if(scene==='states'){
  const q=(s)=>document.querySelector(s);
  const text=nodes.find(n=>n.id==='t1');
  const file=nodes.find(n=>n.id==='f1');
  const pt=(el,type,x,y,extra={})=>el.dispatchEvent(new PointerEvent(type,{bubbles:true,isPrimary:true,pointerType:'mouse',pointerId:5,button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:y,...extra}));
  // 1) 悬停命中：mod-handles + 手柄可命中 + 圆点按边显形
  const wRect=wrapperEl.getBoundingClientRect();
  const tBox=text.nodeEl.getBoundingClientRect();
  pt(wrapperEl,'pointermove',tBox.x+tBox.width/2,tBox.y+tBox.height/2);
  await wait(50);
  report.hover={targetCls:text.nodeEl.className,
    otherCls:file.nodeEl.className,
    resizerPointer:pick(text.nodeEl.querySelector('[data-resize="right"]'),['pointer-events']),
    otherResizerPointer:pick(file.nodeEl.querySelector('[data-resize="right"]'),['pointer-events']),
    dotIdle:pick(text.nodeEl.querySelector('[data-side="right"]'),['pointer-events']),
    dotAfterIdle:getComputedStyle(text.nodeEl.querySelector('[data-side="right"]'),'::after').opacity};
  // 悬停到右侧 resizer 上：该侧圆点显形
  const rEl=text.nodeEl.querySelector('[data-resize="right"]');
  const rBox=rEl.getBoundingClientRect();
  pt(wrapperEl,'pointermove',rBox.x+rBox.width/2,rBox.y+rBox.height/2);
  rEl.dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'mouse'}));
  await wait(50);
  report.hoverDot={after:getComputedStyle(text.nodeEl.querySelector('[data-side="right"]'),'::after').opacity,
    leftAfter:getComputedStyle(text.nodeEl.querySelector('[data-side="left"]'),'::after').opacity,
    rightBox:rectOfEl(rEl),nodeRight:rectOfEl(text.nodeEl)};
  // 2) 单选：is-focused + 描边
  view.selectOnly(text);await wait(100);
  report.single={cls:text.nodeEl.className,containerBorder:pick(text.containerEl,['border-color','box-shadow']),
    z:getComputedStyle(text.nodeEl).zIndex,otherZ:getComputedStyle(file.nodeEl).zIndex,
    menuButtons:[...document.querySelectorAll('.canvas-menu .clickable-icon')].map(b=>({icon:b.querySelector('svg')?.getAttribute('class'),label:b.getAttribute('aria-label'),cls:b.className})),
    menuBox:rectOfEl(q('.canvas-menu')),menuContainerCls:q('.canvas-menu-container')?.className};
  // 3) 多选：包围盒 + 工具条
  view.updateSelection((set)=>{set.add(file);set.add(nodes.find(n=>n.id==='l1'));set.add(nodes.find(n=>n.id==='t2'));});await wait(200);
  report.multi={cls:nodes.map(n=>({id:n.id,cls:n.nodeEl.className,z:getComputedStyle(n.nodeEl).zIndex})),
    box:q('.canvas-selection.mod-group-selection')?{cls:q('.canvas-selection.mod-group-selection').className,box:rectOfEl(q('.canvas-selection.mod-group-selection')),styles:pick(q('.canvas-selection.mod-group-selection'),BOX),handles:q('.canvas-selection.mod-group-selection').querySelectorAll('.canvas-node-resizer[data-resize]').length}:null,
    menuButtons:[...document.querySelectorAll('.canvas-menu .clickable-icon')].map(b=>({icon:b.querySelector('svg')?.getAttribute('class'),label:b.getAttribute('aria-label')}))};
  // 4) 缩到断点以下：占位（文本卡图标 / 文件卡文案）
  view.zoomBy(-6);view.finishViewportAnimation=true;await wait(700);
  report.zoomedOut={zoom:r2(view.zoom),cls:wrapperEl.className,
    placeholders:nodes.filter(n=>n.placeholderEl).map(n=>({id:n.id,attached:n.placeholderEl.isConnected,text:n.placeholderEl.textContent,icon:n.placeholderEl.querySelector('svg')?.getAttribute('class')})),
    labelsAttached:nodes.filter(n=>n.labelEl).map(n=>({id:n.id,display:getComputedStyle(n.labelEl).display}))};
  view.zoomBy(6);view.finishViewportAnimation=true;await wait(700);
  // 5) 只读：手柄隐藏、工具条瘦身
  view.setReadonly(true);view.selectOnly(text);await wait(150);
  report.readonly={cls:wrapperEl.className,resizerDisplay:getComputedStyle(text.nodeEl.querySelector('[data-resize="right"]')).display,
    menuButtons:[...document.querySelectorAll('.canvas-menu .clickable-icon')].map(b=>b.getAttribute('aria-label'))};
  view.setReadonly(false);
  report.single=report.single||null;
  console.log('PROBE-CANVAS '+JSON.stringify(report,null,1));
  return {pass:true,checks,scene};
}

if(scene==='menus'){
  const text=nodes.find(n=>n.id==='t1');
  const edge=[...view.edges.values()][0];
  // 单选一条边：聚焦描边 + 标签显形
  if(edge){view.selectOnly(edge);await wait(150);}
  report.edgeStyles=edge?{
    cls:edge.lineGroupEl.getAttribute('class'),
    display:pick(edge.lineGroupEl.querySelector('.canvas-display-path'),BOX),
    interaction:pick(edge.lineGroupEl.querySelector('.canvas-interaction-path'),BOX),
    d:edge.lineGroupEl.querySelector('.canvas-display-path').getAttribute('d'),
    endOuter:edge.lineEndGroupEl?edge.lineEndGroupEl.outerHTML.slice(0,260):null,
    labelWrapperPick:pick(document.querySelector('.canvas-path-label-wrapper'),BOX),
    labelText:document.querySelector('.canvas-path-label')?.textContent,
    labelIsEditing:document.querySelector('.canvas-path-label')?.classList.contains('is-editing'),
    snaps:!!document.querySelector('svg.canvas-snaps')
  }:null;
  // 工具条（单选边）：方向 / 移除标签 / 编辑标签
  report.edgeMenu=[...document.querySelectorAll('.canvas-menu .clickable-icon')].map(b=>({icon:b.querySelector('svg')?.getAttribute('class'),label:b.getAttribute('aria-label')}));
  // 画布帮助弹窗（新增控件的可视检查）
  view.canvasControlsEl.querySelector('.canvas-control-group:last-child .canvas-control-item').dispatchEvent(new MouseEvent('click',{bubbles:true}));
  await wait(200);
  const modal=document.querySelector('.modal.mod-canvas-help');
  report.help={open:!!modal,cls:modal?modal.className:null,title:modal?modal.querySelector('.modal-title').textContent:null,
    rows:modal?[...modal.querySelectorAll('.canvas-instruction')].map(r=>({label:r.querySelector('.canvas-instruction-label').textContent,keys:[...r.querySelectorAll('.setting-hotkey')].map(k=>k.textContent)})):null,
    box:modal?rectOfEl(modal):null};
  console.log('PROBE-CANVAS '+JSON.stringify(report,null,1));
  return {pass:true,checks,scene};
}

const geom=nodes.map(n=>{
  const el=n.containerEl||n.nodeEl;
  const rect=el?el.getBoundingClientRect():null;
  const inner=n.contentEl?n.contentEl.getBoundingClientRect():null;
  return {id:n.id,type:n.getData().type,
    box:rect?{x:r2(rect.x),y:r2(rect.y),w:r2(rect.width),h:r2(rect.height)}:null,
    inner:inner?{x:r2(inner.x),y:r2(inner.y),w:r2(inner.width),h:r2(inner.height)}:null,
    cls:n.nodeEl.className,z:getComputedStyle(n.nodeEl).zIndex,
    node:pick(n.nodeEl,BOX),
    container:pick(n.containerEl,BOX),
    content:n.contentEl?pick(n.contentEl,BOX):null,
    label:n.labelEl?{text:n.labelEl.textContent,cls:n.labelEl.className,styles:pick(n.labelEl,BOX),box:rectOfEl(n.labelEl)}:null,
    placeholder:n.placeholderEl?{cls:n.placeholderEl.className,text:n.placeholderEl.textContent,outline:outline(n.placeholderEl,3),styles:pick(n.placeholderEl,BOX)}:null};
});

const edges=[...view.edges.values()].map(edge=>({
  id:edge.id,color:edge.color,label:edge.label,
  group:pick(edge.lineGroupEl,BOX),
  display:pick(edge.lineGroupEl.querySelector('.canvas-display-path'),BOX),
  interaction:pick(edge.lineGroupEl.querySelector('.canvas-interaction-path'),BOX),
  d:edge.lineGroupEl.querySelector('.canvas-display-path')?.getAttribute('d'),
  ends:edge.lineEndGroupEl?[...edge.lineEndGroupEl.children].map(c=>c.outerHTML.slice(0,200)):null,
  labelEls:[...document.querySelectorAll('.canvas-path-label')].map(l=>({text:l.textContent,styles:pick(l,BOX),box:rectOfEl(l),wrapper:pick(l.parentElement,BOX)}))
}));

const canvasEl=document.querySelector('.canvas-wrapper');
const menu=document.querySelector('.canvas-menu-container');
report.info={
  wrapper:{cls:canvasEl.className,bg:getComputedStyle(canvasEl).backgroundColor,zoomMul:getComputedStyle(canvasEl).getPropertyValue('--zoom-multiplier')},
  canvasTransform:pick(document.querySelector('.canvas'),['transform']),
  background:{patternId:document.querySelector('.canvas-background pattern')?.getAttribute('id'),
    patternAttrs:[...document.querySelector('.canvas-background pattern').attributes].map(a=>a.name+'='+a.value),
    circle:pick(document.querySelector('.canvas-background circle'),['fill','cx','cy','r']),
    dotPatternVar:getComputedStyle(document.body).getPropertyValue('--canvas-dot-pattern')},
  controls:{box:rectOfEl(document.querySelector('.canvas-controls')),styles:pick(document.querySelector('.canvas-controls'),BOX),
    groups:[...document.querySelectorAll('.canvas-control-group')].map(g=>({cls:g.className,styles:pick(g,['background-color','border','border-radius','box-shadow','overflow']),items:[...g.children].map(i=>({cls:i.className,icon:i.querySelector('svg')?.getAttribute('class'),label:i.getAttribute('aria-label'),styles:pick(i,['background-color','border-bottom','color','padding','height'])}))}))},
  cardMenu:{box:rectOfEl(document.querySelector('.canvas-card-menu')),styles:pick(document.querySelector('.canvas-card-menu'),BOX),
    buttons:[...document.querySelectorAll('.canvas-card-menu-button')].map(b=>({cls:b.className,icon:b.querySelector('svg')?.getAttribute('class'),svgFill:getComputedStyle(b.querySelector('svg')).fill,styles:pick(b,['color','padding','height','--icon-size'])}))},
  menu:menu?{cls:menu.className,display:getComputedStyle(menu).display,styles:pick(menu,BOX),outline:outline(menu,3)}:null,
  textNodeEditor:(()=>{const t=nodes.find(n=>n.id==='t1');const cm=t&&t.editor&&t.editor.cm?t.editor.cm.dom:null;
    const scroller=document.querySelector('.canvas-node-content .cm-scroller');
    return {cmOutline:cm?outline(cm.parentElement,3):null,
      source:pick(document.querySelector('.canvas-node-content .markdown-source-view'),['font-size','line-height','font-family','padding','color','background-color']),
      cmEditor:pick(document.querySelector('.canvas-node-content .cm-editor'),['font-size','line-height','font-family','background-color']),
      scroller:pick(scroller,['padding','font-size','line-height']),
      content:pick(document.querySelector('.canvas-node-content.markdown-embed'),['padding','border','background-color','font-size']),
      embedContent:pick(document.querySelector('.canvas-node-content .markdown-embed-content'),['height','padding']),
      h1:pick(document.querySelector('.canvas-node-content h1, .canvas-node-content .cm-header-1, .canvas-node-content .HyperMD-header-1'),['font-size','line-height','color','font-weight'])};})()
};
report.geom=geom;report.edges=edges;
report.snapshotHooks=[
  String(!!document.querySelector('.canvas-node-content .cm-content')),
  String(document.querySelectorAll('.canvas-node-label').length),
];
console.log('PROBE-CANVAS '+JSON.stringify(report,null,1));
return {pass:true,checks,scene};
})()
