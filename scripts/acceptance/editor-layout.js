/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回行宽布局断言；失败抛出异常，供运行器判定。
 * [POS]: editor-layout 场景。校验原版 file layout（.cm-sizer/.cm-contentContainer）与居中、行位置、设置联动与 gutter 延迟挂载。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const checks=[];
const check=(ok,msg)=>{if(!ok)throw Error('✗ '+msg);checks.push(msg);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const near=(a,b,t=2)=>Math.abs(a-b)<=t;
const inner=el=>{const s=getComputedStyle(el);return el.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight);};
const has=(el,c)=>!!el&&el.classList.contains(c);

const body='# 中文标题\n\n中文段落用于校验文本位置。\n\n'+'长段落内容用于撑开行宽。'.repeat(40);
const file=await app.vault.create('Layout-'+Date.now()+'.md',body);
await app.workspace.openFile(file);
const view=app.workspace.activeLeaf.view;
await wait(200);
const scroller=view.editor.cm.scrollDOM;
const content=view.editor.cm.contentDOM;

// ---- 结构：原版 DOM
check(has(view.sourceEl,'is-readable-line-width'),'开启时源码视图带 is-readable-line-width');
const sizer=scroller.querySelector(':scope > .cm-sizer');
check(!!sizer,'.cm-sizer 是 .cm-scroller 直接子元素');
const cc=sizer&&sizer.querySelector(':scope > .cm-contentContainer');
check(!!cc&&cc.contains(content),'.cm-contentContainer 包住 .cm-content');
check(!!view.inlineTitleEdit.closest('.cm-sizer'),'行内标题位于 .cm-sizer 内（随内容滚动、同宽居中）');
check(view.inlineTitleEdit.closest('.cm-sizer')===sizer,'行内标题挂在同一个 .cm-sizer');
const titleStyle=getComputedStyle(view.inlineTitleEdit);
check(parseFloat(titleStyle.letterSpacing)<0,'行内标题应用原版字距 -0.015em');
check(titleStyle.whiteSpace==='pre-wrap','行内标题 white-space: pre-wrap');

// ---- 居中与行宽
const expected=Math.min(700,inner(scroller));
const sr=sizer.getBoundingClientRect();
const scr=scroller.getBoundingClientRect();
check(near(sr.width,expected,3),'sizer 宽度=min(700, 可用宽)（期望 '+expected.toFixed(0)+'，实测 '+sr.width.toFixed(1)+'）');
const left=sr.left-scr.left,right=scr.right-sr.right;
check(near(left,right,2),'sizer 居中（左 '+left.toFixed(1)+' / 右 '+right.toFixed(1)+'）');
check(getComputedStyle(sizer).maxWidth==='700px','sizer 应用 max-width: var(--file-line-width)');

// ---- 文本位置
const line=content.querySelector('.cm-line');
check(getComputedStyle(line).paddingLeft==='0px','行无额外水平内边距（中文位置不再右移）');
const lr=line.getBoundingClientRect();
check(lr.left>sr.left&&lr.right<=sr.right+1,'行文本位于行宽列内');
check(near(view.inlineTitleEdit.getBoundingClientRect().left,sr.left,2),'行内标题与行宽列左对齐');
check(view.editor.sizerEl===sizer&&view.editor.contentContainerEl===cc,'Editor 暴露 sizerEl/contentContainerEl');

// ---- 设置联动
app.settings.updateAppSettings({readableLineLength:false});
await wait(150);
check(!has(view.sourceEl,'is-readable-line-width'),'关闭后源码视图移除 class');
check(getComputedStyle(sizer).maxWidth==='none','关闭后 sizer 不再限制宽度');
app.settings.updateAppSettings({readableLineLength:true});
await wait(150);
check(has(view.sourceEl,'is-readable-line-width'),'重新开启恢复 class');

// ---- 阅读视图
await view.setState({file:file.path,mode:'preview'});
await wait(250);
const pv=view.readingSizer;
check(has(pv,'is-readable-line-width'),'阅读视图带 is-readable-line-width');
const ps=pv.querySelector('.markdown-preview-sizer');
const pr=pv.getBoundingClientRect(),psr=ps.getBoundingClientRect();
check(near(psr.width,Math.min(700,inner(pv)),3),'阅读 sizer 宽度=min(700, 可用宽)（实测 '+psr.width.toFixed(1)+'）');
check(near(psr.left-pr.left,pr.right-psr.right,2),'阅读 sizer 居中');
app.settings.updateAppSettings({readableLineLength:false});
await wait(150);
check(!has(pv,'is-readable-line-width'),'关闭后阅读视图移除 class');
app.settings.updateAppSettings({readableLineLength:true});
await wait(150);

// ---- 折叠全关后开启行号：gutter 延迟挂载不炸（insertBefore 重定向）
await view.setState({file:file.path,mode:'live'});
await wait(120);
app.settings.updateAppSettings({foldHeading:false,foldIndent:false});
await wait(120);
app.settings.updateAppSettings({showLineNumber:true});
await wait(200);
check(!!view.editor.cm.dom.querySelector('.cm-lineNumbers'),'折叠全关后开启行号：gutter 正常挂载');
check(!!scroller.querySelector(':scope > .cm-sizer > .cm-contentContainer > .cm-gutters'),'gutter 容器位于 .cm-contentContainer 内');
app.settings.updateAppSettings({showLineNumber:false,foldHeading:true,foldIndent:true});
return {pass:true,checks};
})()
