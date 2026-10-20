/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 阅读视图正文排版的计算样式断言；失败抛出异常，供运行器判定。
 * [POS]: reading-ui 场景。期望值取自 _analysis/obsidian-asar/app.css 阅读视图段（注释标注行号）；
 *        颜色与尺寸类期望与页面上的 CSS 变量/实测 ch 比对，浅色与深色主题共用同一套断言。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
try {
const checks=[];
const check=(ok,msg)=>{if(!ok)throw Error('✗ '+msg);checks.push(msg);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,msg,timeout=6000)=>{const t0=Date.now();while(Date.now()-t0<timeout){if(fn())return;await wait(50);}throw Error('✗ timeout: '+msg);};
const px=(v)=>Math.round(parseFloat(v||'0')*100)/100;
const near=(a,b,msg,tol=0.6)=>{check(Math.abs(px(a)-px(b))<=tol,msg+'（期望 '+px(b)+'，实得 '+px(a)+'）');};

/* ---------------------------------------------------------------- 造库 */
const theme=app.settings.appSettings.theme==='obsidian'?'dark':'light';
await app.vault.createBinary('pic.png',new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,2,0,0,2,8,6,0,0,0,114,182,13,36,0,0,0,20,73,68,65,84,8,215,99,248,207,192,240,31,0,0,3,1,1,0,24,221,141,215,0,0,0,0,73,69,78,68,174,66,96,130]));
await app.vault.createBinary('clip.mp3',new Uint8Array([73,68,51,4,0,0,0,0,0,0]));
await app.vault.createBinary('doc.pdf',new Uint8Array([37,80,68,70,45,49,46,52,10,10]));
await app.vault.createBinary('附件.zip',new Uint8Array([80,75,3,4,1,2,3]));
await app.vault.create('嵌入目标.md','# 嵌入目标\n\n嵌入正文。\n');
const NOTE=[
'---','title: 属性标题','tags: [alpha]','count: 3','---','',
'# 一级标题','','## 二级标题','','### 三级标题','','#### 四级标题','','##### 五级标题','','###### 六级标题','',
'正文段落，含 **粗体**、*斜体*、==高亮==、`行内代码`，标签 #标签/中文。','',
'内部链接 [[嵌入目标]]，未解析链接 [[不存在]]，外部链接 [示例](https://example.com)，行内公式 $E = mc^2$。','',
'段落二（用于测量标题前间距）。','','## 段落后的二级标题','',
'> 引用行一','> 引用行二','',
'- 无序项一','- 无序项二','\t- 嵌套项','','1. 有序项一','2. 有序项二','',
'- [ ] 未完成任务','- [x] 已完成任务','',
'> [!note] Note','> note 内容','',
'> [!info] Info','> info 内容','','> [!warning] Warning','> warning 内容','',
'> [!success] Success','> success 内容','','> [!error] Error','> error 内容','',
'```js','const x = 1;','```','',
'$$','\\int_0^1 x \\, dx','$$','',
'| 左 | 中 | 右 |','| :-- | :-: | --: |','| a | b | c |','','---','',
'脚注[^1]。','','[^1]: 脚注内容','',
'![[pic.png|300]]','','![[clip.mp3]]','','![[doc.pdf]]','','![[嵌入目标]]','','![[附件.zip]]','',
'进度：<progress value="60" max="100"></progress>','',
].join('\n');
const file=await app.vault.create('排版断言.md',NOTE);
await app.workspace.openFile(file);
await wait(300);
const view=app.workspace.activeLeaf.view;
await view.setState({file:file.path,mode:'preview'});
await until(()=>!!view.readingEl.querySelector('h1'),'阅读视图渲染');
await until(()=>!!view.readingEl.querySelector('mjx-container'),'数学渲染');
await wait(400);

/* ---------------------------------------------------------------- 取值工具 */
const root=view.readingEl;
const q=(s)=>root.querySelector(s)||document.querySelector(s);
const all=(s)=>[...root.querySelectorAll(s)];
const elOf=(s)=>{const el=typeof s==='string'?q(s):s;if(!el)throw Error('✗ 缺少元素 '+s);return el;};
const cs=(s,prop)=>getComputedStyle(elOf(s))[prop];
const cssVar=(name,s)=>getComputedStyle(elOf(s||root)).getPropertyValue(name).trim();
/** 变量换算成 px：把 var() 写到临时元素宽度上，由浏览器解析 rem/em/calc；
    宿主不可容纳子节点（如 input）时回落到阅读视图根节点 */
const varPx=(name,s)=>{const raw=cssVar(name,s);if(!raw)throw Error('✗ 变量缺失 '+name);if(raw==='0'||raw==='0px')return 0;const host=elOf(s||root);const probe=document.createElement('div');probe.style.cssText='position:absolute;visibility:hidden;width:var('+name+')';host.appendChild(probe);let w=probe.getBoundingClientRect().width;if(!w&&host!==root){root.appendChild(probe);w=probe.getBoundingClientRect().width;}probe.remove();if(!w)throw Error('✗ 无法测量变量 '+name);return px(w);};
const rgb=(color)=>{const box=document.createElement('div');box.style.color=color;root.appendChild(box);const out=getComputedStyle(box).color;box.remove();return out;};
/** 与元素同字体的 ch 宽度（margin-inline-start: 3ch 这类期望靠它换算） */
const chPx=(s,n)=>{const host=elOf(s);const probe=document.createElement('span');probe.style.cssText='position:absolute;visibility:hidden;width:'+n+'ch';host.appendChild(probe);const w=probe.getBoundingClientRect().width;probe.remove();return px(w);};
const emPx=(s,factor)=>px(cs(s,'fontSize'))*factor;
const width=(s)=>elOf(s).getBoundingClientRect().width;

/* -------------------------------------------------- 1. 容器与行宽（app.css 4343-4389） */
near(cs('.markdown-preview-view','paddingTop'),varPx('--file-margins-y'),'阅读视图垂直内边距 = --file-margins-y（size-4-8）');
near(cs('.markdown-preview-view','paddingInlineStart'),varPx('--file-margins-x'),'阅读视图水平内边距 = --file-margins-x');
check(cs('.markdown-preview-view','fontSize')===cssVar('--font-text-size'),'正文基准字号 = --font-text-size');
near(cs('.markdown-preview-view','lineHeight'),px(cs('.markdown-preview-view','fontSize'))*1.5,'正文行高 = --line-height-normal（1.5）');
near(cs('.markdown-preview-sizer','maxWidth'),varPx('--file-line-width'),'行宽上限 = --file-line-width（700px）');
const sizer=elOf('.markdown-preview-sizer').getBoundingClientRect();
const preview=elOf('.markdown-preview-view').getBoundingClientRect();
check(Math.abs(sizer.left+sizer.width/2-(preview.left+preview.width/2))<=1,'行宽收窄后 sizer 居中（app.css 4367）');
near(cs('.markdown-preview-section','paddingBottom'),0,'正文尾部无额外内边距（原版无此规则）');
near(cs('.markdown-content > :last-child','marginBottom'),0,'最后一块下边距归零（app.css 4388）');

/* -------------------------------------------------- 2. 标题（app.css 11661-11910） */
const base=px(cs('.markdown-preview-view','fontSize'));
near(cs('.markdown-content h1','fontSize'),base*1.618,'h1 字号 = 1.618em（app.css 2312）');
near(cs('.markdown-content h2','fontSize'),base*1.462,'h2 字号 = 1.462em');
near(cs('.markdown-content h3','fontSize'),base*1.318,'h3 字号 = 1.318em');
near(cs('.markdown-content h6','fontSize'),base,'h6 字号 = 1em');
near(cs('.markdown-content h1','fontWeight'),700,'h1 字重 = --h1-weight（700）');
near(cs('.markdown-content h2','fontWeight'),680,'h2 字重 = --h2-weight（680）');
near(cs('.markdown-content h1','lineHeight'),base*1.618*1.2,'h1 行高 = --h1-line-height（1.2）');
near(cs('.markdown-content h2','marginTop'),varPx('--p-spacing'),'连续标题之间上边距 = --p-spacing（app.css 11671）');
near(cs('.markdown-content h2','marginBottom'),varPx('--p-spacing'),'标题下边距 = --p-spacing（app.css 11672）');
near(cs('.markdown-content > h1','marginTop'),0,'首个标题无上边距（app.css 4384）');
const hAfterP=all('.markdown-content h2').find((h)=>h.previousElementSibling&&h.previousElementSibling.tagName==='P');
check(!!hAfterP,'存在「段落后标题」用于断言');
near(getComputedStyle(hAfterP).marginTop,varPx('--heading-spacing'),'段落后标题上边距 = --heading-spacing（app.css 11661-11663）');
near(getComputedStyle(all('.markdown-content h3')[0]).marginTop,varPx('--p-spacing'),'标题后标题上边距回落 --p-spacing');

/* -------------------------------------------------- 3. 段落与内联（app.css 13049-13090 / 4303） */
near(cs('.markdown-content p','marginBlockStart'),varPx('--p-spacing'),'段落上边距 = --p-spacing（app.css 13066）');
near(cs('.markdown-content p','marginBlockEnd'),varPx('--p-spacing'),'段落下边距 = --p-spacing（app.css 13067）');
check(cs('.markdown-content p','unicodeBidi')==='plaintext','段落 unicode-bidi: plaintext（app.css 13068）');
near(cs('.markdown-content strong','fontWeight'),Number(cssVar('--font-weight'))+Number(cssVar('--bold-modifier')),'粗体字重 = font-weight + bold-modifier（app.css 13049）');
check(cs('.markdown-content em','fontStyle')==='italic','斜体 font-style: italic（app.css 13055）');
near(cs('.markdown-content mark','paddingInlineStart'),0,'高亮 mark 无内边距（app.css 13071）');
check(cs('.markdown-content mark','backgroundColor')===rgb(cssVar('--text-highlight-bg')),'高亮底色 = --text-highlight-bg');
near(cs('.inline-title','fontSize'),base*1.618,'行内标题字号 = --h1-size（app.css 4308）');
near(cs('.inline-title','fontWeight'),700,'行内标题字重 = --inline-title-weight');
near(cs('.inline-title','letterSpacing'),-0.015*emPx('.inline-title',1),'行内标题字距 -0.015em（app.css 4315）');
near(cs('.inline-title','marginBlockEnd'),emPx('.inline-title',0.5),'行内标题下边距 = --inline-title-margin-bottom（0.5em）');

/* -------------------------------------------------- 4. 链接与标签（app.css 12241-12315 / 12838-12856） */
check(cs('.markdown-content a.internal-link','color')===rgb(cssVar('--link-color')),'内部链接色 = --link-color');
check(cs('.markdown-content a.internal-link','textDecorationLine')==='underline','内部链接下划线 = --link-decoration');
near(cs('.markdown-content a.internal-link','fontWeight'),Number(cssVar('--font-weight')),'链接字重 = --link-weight（跟随所在块）');
const unresolved=q('.markdown-content a.internal-link.is-unresolved');
check(!!unresolved,'未解析链接已渲染 is-unresolved');
near(getComputedStyle(unresolved).opacity,Number(cssVar('--link-unresolved-opacity')),'未解析链接透明度 = --link-unresolved-opacity（0.7，app.css 12312）');
check(getComputedStyle(unresolved).textDecorationColor===rgb(cssVar('--link-unresolved-decoration-color')),'未解析链接下划线色 = --link-unresolved-decoration-color');
check(cs('.markdown-content a.external-link','color')===rgb(cssVar('--link-external-color')),'外链色 = --link-external-color');
check(cs('.markdown-content a.external-link','backgroundImage').includes('data:image/svg'),'外链带角标图标（app.css 12267）');
near(cs('.markdown-content a.external-link','paddingInlineEnd'),emPx('.markdown-content a.external-link',0.9),'外链右侧让位 0.9em（app.css 12270）');
check(cs('.markdown-content a.tag','color')===rgb(cssVar('--tag-color')),'标签色 = --tag-color');
check(cs('.markdown-content a.tag','backgroundColor')===rgb(cssVar('--tag-background')),'标签底色 = --tag-background');
near(cs('.markdown-content a.tag','borderTopLeftRadius'),emPx('.markdown-content a.tag',2),'标签圆角 = --tag-radius（2em）');
near(cs('.markdown-content a.tag','fontSize'),base*0.875,'标签字号 = --tag-size（0.875em）');
near(cs('.markdown-content a.tag','lineHeight'),emPx('.markdown-content a.tag',1),'标签 line-height: 1（app.css 12848）');
near(cs('.markdown-content a.tag','paddingInlineStart'),emPx('.markdown-content a.tag',0.65),'标签横向内边距 = --tag-padding-x（0.65em）');
check(cs('.markdown-content a.tag','textDecorationLine')==='none','标签无下划线 = --tag-decoration');

/* -------------------------------------------------- 5. 引用（app.css 10283-10299） */
near(cs('blockquote','borderInlineStartWidth'),varPx('--blockquote-border-thickness'),'引用左描边 = --blockquote-border-thickness（2px）');
check(cs('blockquote','borderInlineStartColor')===rgb(cssVar('--blockquote-border-color')),'引用左描边色 = --blockquote-border-color');
near(cs('blockquote','paddingInlineStart'),varPx('--size-4-6'),'引用左内边距 = --size-4-6（24px，app.css 10290）');
near(cs('blockquote','marginBlockStart'),emPx('blockquote',1),'引用上下外边距 1em（app.css 未覆盖 UA 值）');
near(cs('blockquote','marginInlineStart'),0,'引用无额外左外边距');
check(cs('blockquote','backgroundColor')===rgb(cssVar('--blockquote-background-color')),'引用底色 = --blockquote-background-color');
near(cs('blockquote > :first-child','marginTop'),0,'引用首块上边距归零（app.css 10294）');
near(cs('blockquote > :last-child','marginBottom'),0,'引用末块下边距归零（app.css 10297）');

/* -------------------------------------------------- 6. callout 四类（app.css 10331-10475） */
for(const [type,varName] of [['info','--callout-info'],['warning','--callout-warning'],['success','--callout-success'],['error','--callout-error']]){
  const sel='.callout[data-callout="'+type+'"]';
  const el=elOf(sel);
  const color='rgb('+cssVar(varName,el)+')';
  check(getComputedStyle(el).getPropertyValue('--callout-color').trim()===cssVar(varName,el),type+' callout 主色 = '+varName+'（app.css 10331-10394）');
  check(getComputedStyle(el).backgroundColor===rgb('rgba('+cssVar(varName,el)+', 0.1)'),type+' callout 底色 = rgba(主色, 0.1)（app.css 10417）');
  near(getComputedStyle(el).borderTopWidth,varPx('--callout-border-width',el),type+' callout 描边 = --callout-border-width（0）');
  near(getComputedStyle(el).borderTopLeftRadius,varPx('--callout-radius',el),type+' callout 圆角 = --callout-radius');
  near(getComputedStyle(el).paddingTop,varPx('--size-4-3',el),type+' callout 上内边距 = --size-4-3（12px）');
  near(getComputedStyle(el).paddingInlineStart,varPx('--size-4-6',el),type+' callout 左内边距 = --size-4-6（24px，app.css 2116）');
  near(getComputedStyle(el).marginBlockStart,emPx(sel,1),type+' callout 上下外边距 1em（app.css 10415）');
  check(getComputedStyle(el).overflow==='hidden',type+' callout 溢出裁剪（app.css 10410）');
  check(getComputedStyle(elOf(sel+' > .callout-title')).color===rgb(color),type+' 标题色 = callout 主色（app.css 10428）');
  near(getComputedStyle(elOf(sel+' .callout-title-inner')).fontWeight,Number(cssVar('--font-weight'))+Number(cssVar('--bold-modifier')),type+' 标题字重 = --callout-title-weight');
  near(getComputedStyle(elOf(sel+' > .callout-title')).lineHeight,px(cs(sel,'fontSize'))*1.3,type+' 标题行高 = --line-height-tight');
  if(type==='info'){
    near(cs('.callout > .callout-content','paddingTop'),varPx('--callout-content-padding',el),'callout 内容区无内边距 = --callout-content-padding（0）');
    const content=elOf(sel+' > .callout-content');
    const body=content.querySelector('p');
    check(!body.querySelector('br'),'callout 正文开头无 <br>（标题行换行已剥离）');
    near(content.getBoundingClientRect().height,body.getBoundingClientRect().height+32,'callout 内容区高度 = 段落 + 上下 16px，无额外空行');
  }
check(elOf('.callout[data-callout="note"] .callout-icon .svg-icon').classList.contains('lucide-pencil'),'note callout 图标 = lucide-pencil（非 edit-3 别名）');
}

/* -------------------------------------------------- 7. 代码（app.css 10476-10580 / 10649-10666） */
check(cs('.markdown-content p code','backgroundColor')===rgb(cssVar('--code-background')),'行内代码底色 = --code-background');
near(cs('.markdown-content p code','borderTopLeftRadius'),varPx('--code-radius'),'行内代码圆角 = --code-radius（4px）');
near(cs('.markdown-content p code','fontSize'),base*0.875,'行内代码字号 = --code-size（0.875em）');
near(cs('.markdown-content p code','paddingTop'),emPx('.markdown-content p code',0.15),'行内代码纵向内边距 0.15em（app.css 10482）');
near(cs('.markdown-content p code','paddingInlineStart'),emPx('.markdown-content p code',0.3),'行内代码横向内边距 0.3em');
check(cs('.markdown-content p code','borderTopWidth')==='0px','行内代码描边 = --code-border-width（0）');
near(cs('pre','paddingTop'),varPx('--size-4-3'),'代码块上内边距 = --size-4-3（12px）');
near(cs('pre','paddingInlineStart'),varPx('--size-4-4'),'代码块左内边距 = --size-4-4（16px，app.css 10536）');
near(cs('pre','minHeight'),38,'代码块最小高度 38px（app.css 10537）');
check(cs('pre','whiteSpace')==='pre-wrap','代码块 white-space = --code-white-space（pre-wrap）');
check(cs('pre','backgroundColor')===rgb(cssVar('--code-background')),'代码块底色 = --code-background');
check(cs('pre > code','backgroundColor')==='rgba(0, 0, 0, 0)','代码块内 code 背景透明（app.css 10545）');
check(px(cs('pre > code','paddingInlineStart'))===0&&cs('pre > code','borderTopWidth')==='0px','代码块内 code 无内边距与描边');
check(cs('pre','fontFamily').includes('monospace'),'代码块字体 = --font-monospace');
near(cs('pre','lineHeight'),px(cs('pre','fontSize'))*1.5,'代码块行框 = 正文 16/24（pre 不缩字号）');
near(elOf('pre code[class*="language-"]').getBoundingClientRect().width>0?cs('pre code[class*="language-"]','lineHeight'):0,px(cs('pre code[class*="language-"]','fontSize'))*1.5,'代码正文行高 = --line-height-normal（14×1.5，app.css 10659）');
check(all('pre code span.token').length>0,'代码已按 token 类高亮（app.css 10660 起）');

/* -------------------------------------------------- 8. 表格（app.css 12629-12760） */
near(cs('table','marginBlockStart'),varPx('--p-spacing'),'表格上外边距 = --p-spacing（app.css 12630）');
check(cs('table','borderCollapse')==='collapse','表格合并边框（app.css 12634）');
near(cs('table','lineHeight'),px(cs('table','fontSize'))*1.3,'表格行高 = --table-line-height（1.3）');
near(cs('td','paddingTop'),varPx('--size-2-2'),'单元格纵向内边距 = --size-2-2（4px）');
near(cs('td','paddingInlineStart'),varPx('--size-4-2'),'单元格横向内边距 = --size-4-2（8px）');
check(px(cs('td','borderTopWidth'))===varPx('--table-border-width')&&cs('td','borderTopColor')===rgb(cssVar('--table-border-color')),'单元格边框 = --table-border-width/-color（1px）');
check(cs('th','verticalAlign')==='top','单元格垂直对齐 = --table-cell-vertical-alignment（top）');
check(Math.abs(px(cs('td','minWidth'))-chPx('td',6))<=chPx('td',0.6),'单元格最小宽度 = 6ch（--table-column-min-width）');
check(cs('td:nth-child(2)','textAlign')==='center','居中列 text-align: center（app.css 12677）');
check(cs('td:nth-child(3)','textAlign')==='right','右对齐列 text-align: end（app.css 12683）');
near(cs('th','fontWeight'),Number(cssVar('--font-weight'))+Number(cssVar('--bold-modifier')),'表头字重 = --table-header-weight（app.css 2729）');
check(cs('tbody tr','backgroundColor')===rgb(cssVar('--table-row-alt-background')),'表体行底色 = --table-row-alt-background（app.css 12711）');
check(cs('th','color')===rgb(cssVar('--table-header-color')),'表头文字色 = --table-header-color');

/* -------------------------------------------------- 9. 分隔线（app.css 11916-11925） */
near(cs('.markdown-content hr','borderTopWidth'),varPx('--hr-thickness'),'分隔线粗细 = --hr-thickness（2px）');
check(cs('.markdown-content hr','borderTopColor')===rgb(cssVar('--hr-color')),'分隔线颜色 = --hr-color');
near(cs('.markdown-content hr','marginBlockStart'),32,'分隔线上下外边距 2rem（app.css hr 全局规则）');
check(cs('.markdown-content hr','borderTopStyle')==='solid','分隔线线型 solid');

/* -------------------------------------------------- 10. 列表与任务（app.css 12038-12191 / 12984-13003） */
near(cs('.markdown-content ul','paddingInlineStart'),0,'无序列表无左内边距（app.css 12070）');
near(cs('.markdown-content ul > li','marginInlineStart'),chPx('.markdown-content ul > li',3),'列表项缩进 3ch（app.css 12099）');
near(cs('.markdown-content ul > li','paddingTop'),emPx('.markdown-content ul > li',0.075),'列表项纵向内边距 = --list-spacing（0.075em）');
near(cs('.markdown-content ul ul > li','marginInlineStart'),varPx('--list-indent','.markdown-content ul ul > li'),'嵌套列表项缩进 = --list-indent（app.css 12103）');
check(q('ul.has-list-bullet')!==null,'无序列表带 has-list-bullet（app.css 12162）');
const bullet=elOf('.markdown-content ul > li > .list-bullet');
const bulletAfter=getComputedStyle(bullet,'::after');
near(bulletAfter.width,varPx('--list-bullet-size',bullet),'列表圆点直径 = --list-bullet-size（0.3em）');
check(bulletAfter.backgroundColor===rgb(cssVar('--list-marker-color',bullet)),'列表圆点色 = --list-marker-color');
check(bulletAfter.borderTopLeftRadius===cssVar('--list-bullet-radius',bullet),'列表圆点圆角 = --list-bullet-radius（50%）');
check(getComputedStyle(elOf('.markdown-content ol > li'),'::marker').color===rgb(cssVar('--list-marker-color')),'有序列表标记色 = --list-marker-color（app.css 12057）');
const doneTask=elOf('li.task-list-item[data-task="x"]');
check(doneTask.hasClass('is-checked'),'已完成任务项带 data-task="x" 与 is-checked（app.css 13000）');
check(getComputedStyle(doneTask).textDecorationLine.includes('line-through'),'已完成任务删除线 = --checklist-done-decoration');
check(getComputedStyle(doneTask).color===rgb(cssVar('--checklist-done-color',doneTask)),'已完成任务文字色 = --checklist-done-color');
const box=elOf('.task-list-item-checkbox');
near(cs(box,'width'),varPx('--checkbox-size',box),'任务复选框边长 = --checkbox-size（16px，app.css 12985）');
near(cs(box,'borderTopLeftRadius'),varPx('--checkbox-radius',box),'复选框圆角 = --checkbox-radius');
near(cs(box,'top'),emPx(box,0.2),'复选框下移 0.2em（app.css 12989）');
near(cs(box,'marginInlineEnd'),emPx(box,0.6),'复选框右侧留白 0.6em（app.css 12990）');
near(cs(box,'marginInlineStart'),-1.5*varPx('--checkbox-size',box),'复选框左移 1.5×尺寸（app.css 12998）');
const checkedBox=elOf('.task-list-item-checkbox:checked');
check(cs(checkedBox,'backgroundColor')===rgb(cssVar('--checkbox-color',checkedBox)),'勾选复选框底色 = --checkbox-color（app.css 12960）');
check(getComputedStyle(checkedBox,'::after').webkitMaskImage!=='none','勾选复选框带对勾遮罩（app.css 12956）');
check(!checkedBox.hasAttribute('disabled'),'阅读视图复选框可点击（原版无 disabled）');

/* -------------------------------------------------- 11. 脚注（app.css 11091-11110） */
near(cs('.footnotes','fontSize'),base*0.875,'脚注区字号 = --footnote-size（0.875em）');
check(cs('.footnotes','borderTopWidth')==='0px','脚注区无额外界线（分隔线由 hr.footnotes-sep 提供）');
check(px(cs('hr.footnotes-sep','borderTopWidth'))===varPx('--hr-thickness'),'脚注分隔线沿用 .markdown-rendered hr');
check(cs('a.footnote-backref','color')===rgb(cssVar('--text-faint')),'回跳箭头色 = --text-faint（app.css 11104）');
check(cs('a.footnote-backref','display')==='inline-block','回跳箭头 inline-block（app.css 11101）');
near(cs('a.footnote-backref','marginInlineStart'),varPx('--size-4-1'),'回跳箭头左边距 = --size-4-1');
check(cs('.footnote-ref','verticalAlign')==='super','脚注引用上标（app.css 11097）');
check(cs('.footnote-ref > a','textDecorationLine')==='none','脚注引用链接无下划线 = --footnote-* （app.css 11091）');

/* -------------------------------------------------- 12. 图片、媒体与嵌块（app.css 10799-10998 / 11982） */
near(cs('.internal-embed.image-embed','paddingBottom'),3,'图片嵌入右下留 3px（app.css 10981）');
check(px(cs('.internal-embed.image-embed img','width'))===300,'![[pic.png|300]] 图片宽度落成 300px');
check(cs('.internal-embed.image-embed img','imageRendering')==='-webkit-optimize-contrast','图片渲染 = -webkit-optimize-contrast（app.css 11984）');
check(cs('.internal-embed.audio-embed','display')==='block','音频嵌块为块级（app.css 10944）');
near(cs('.internal-embed.audio-embed audio','width'),width('.internal-embed.audio-embed'),'音频播放器铺满嵌块宽度（app.css 9610）');
near(cs('.internal-embed.audio-embed audio','height'),42,'音频播放器高 42px（app.css 9611）');
near(cs('.pdf-embed','height'),800,'PDF 嵌块高 800px（app.css 10812）');
check(px(cs('.pdf-embed','borderTopWidth'))===1&&cs('.pdf-embed','borderTopColor')===rgb(cssVar('--background-modifier-border')),'PDF 嵌块 1px 边框（app.css 10813）');
near(cs('.pdf-embed','borderTopLeftRadius'),varPx('--radius-s'),'PDF 嵌块圆角 = --radius-s');
check(cs('.pdf-embed','overflow')==='hidden','PDF 嵌块裁剪溢出');
const mdEmbed=elOf('.internal-embed.markdown-embed');
near(cs(mdEmbed,'borderInlineStartWidth'),2,'笔记嵌块左侧强调描边 2px（--embed-border-start）');
check(cs(mdEmbed,'borderInlineStartColor')===rgb(cssVar('--interactive-accent')),'嵌块描边色 = --interactive-accent');
near(cs(mdEmbed,'marginBlockStart'),0,'嵌块无外边距（app.css 10939）');
check(cs(mdEmbed,'position')==='relative','嵌块相对定位（app.css 10855）');
near(cs('.inline-embed > .markdown-embed-content','paddingInlineStart'),varPx('--size-4-6'),'嵌块内容左缩进 24px（--embed-padding，app.css 10964）');
near(cs('.embed-title','fontSize'),base,'嵌块标题字号 = --font-text-size（app.css 10925）');
near(cs('.embed-title','fontWeight'),Number(cssVar('--font-weight'))+Number(cssVar('--bold-modifier')),'嵌块标题加粗（app.css 10926）');
const linkBtn=elOf('.markdown-embed-link');
check(cs(linkBtn,'position')==='absolute'&&px(cs(linkBtn,'top'))===4,'嵌块链接按钮绝对定位 top 4px（app.css 10859）');
near(cs(linkBtn,'opacity'),Number(cssVar('--icon-opacity')),'嵌块链接按钮透明度 = --icon-opacity');
check(!!q('.markdown-embed-link svg'),'嵌块链接按钮带图标（原版 lucide-maximize-2，app.css 10858）');
near(cs('.markdown-embed-link svg','width'),varPx('--icon-s'),'嵌块图标尺寸 = --icon-s（app.css 10867）');
/* app.css 10891-10915：非可渲染附件的通用嵌块 */
const fileEmbed=elOf('.file-embed.mod-generic');
check(cs(fileEmbed,'display')==='block','通用附件嵌块为块级（.internal-embed:not(.image-embed) 胜出，app.css 10944）');
check(cs('.file-embed-title','display')==='flex'&&cs('.file-embed-title','justifyContent')==='center','通用附件标题居中（app.css 10881）');
check(cs(fileEmbed,'backgroundColor')===rgb(cssVar('--background-primary-alt')),'通用附件嵌块底色 = --background-primary-alt');
near(cs(fileEmbed,'borderTopLeftRadius'),varPx('--radius-m'),'通用附件嵌块圆角 = --radius-m');
near(cs(fileEmbed,'paddingTop'),varPx('--size-4-2'),'通用附件嵌块内边距 = --size-4-2');
check(cs(fileEmbed,'color')===rgb(cssVar('--text-muted')),'通用附件嵌块文字色 = --text-muted（app.css 10897）');
near(cs(fileEmbed,'fontSize'),base*0.875,'通用附件嵌块字号 = --font-smaller');
check(!!q('.file-embed-icon svg'),'通用附件嵌块带文件图标（app.css 10887）');
check(q('.file-embed-title')!==null,'通用附件嵌块标题为 flex 行（app.css 10881）');
/* app.css 8597-8630：正文中的 <progress> */
const progress=elOf('.markdown-content progress');
near(cs(progress,'height'),6,'progress 高度 6px（app.css 8605）');
check(cs(progress,'display')==='inline-block','progress 行内块（app.css 8604）');
check(cs(progress,'borderTopWidth')==='0px'&&px(cs(progress,'borderTopLeftRadius'))===0,'progress 无描边无圆角（app.css 8609-8610）');

/* -------------------------------------------------- 13. 数学（app.css 12598 / MathJax CHTML） */
const blockMath=elOf('.markdown-content .math-block mjx-container');
check(getComputedStyle(blockMath).display==='block','块公式 mjx-container 为块级');
check(getComputedStyle(blockMath).textAlign==='center','块公式居中（MathJax 样式表）');
near(getComputedStyle(blockMath).marginTop,px(cs('mjx-container','fontSize')),'块公式上下外边距 1em（MathJax 样式表）');
check(getComputedStyle(elOf('.math-inline mjx-container')).display==='inline','行内公式 mjx-container 为行内');
check(cs('mjx-container','outlineWidth')==='0px'||cs('mjx-container','outlineStyle')==='none','公式无描边（app.css 12599）');
near(cs('.math-inline','paddingInlineStart'),0,'行内公式无左右内边距（原版无此规则）');
check(px(cs('.math-block','marginBlockStart'))===0&&px(cs('.math-block','marginBlockEnd'))===0,'块公式外层不额外撑高（app.css 无 .math-block 规则）');

/* -------------------------------------------------- 14. 属性块（app.css 11162-11181 / 2480-2522） */
check(!!q('.metadata-container'),'属性块已渲染');
near(cs('.metadata-container','marginBlockEnd'),32,'属性块下外边距 2rem（app.css 11181）');
near(cs('.metadata-container','paddingTop'),varPx('--size-4-2'),'属性块 = --metadata-padding（8px 0）');
check(cs('.metadata-container','color')===rgb(cssVar('--text-muted')),'属性块文字色 = --text-muted');
near(cs('.metadata-property-key','width'),emPx('.metadata-property-key',9),'属性名宽度 = --metadata-label-width（9em）');
near(cs('.metadata-property-value','minHeight'),base*1.75,'属性值最小高度 = --metadata-input-height（1.75em）');
near(cs('.metadata-container + .markdown-content > :first-child, .metadata-container-host + .markdown-content > :first-child','marginTop'),0,'属性块后首块上边距归零（原版 .mod-ui 段）');

/* -------------------------------------------------- 15. 主题色链（浅/深同源） */
check(cs('.markdown-reading-view','backgroundColor')===rgb(cssVar('--background-primary')),'阅读视图底色 = --background-primary');
check(cs('.callout','mixBlendMode')===cssVar('--highlight-mix-blend-mode'),'callout 混合模式 = --highlight-mix-blend-mode');
check(cs('.markdown-content p','fontSize')===cssVar('--font-text-size'),'正文字号 = --font-text-size');
return {pass:true,checks,theme,count:checks.length};
} catch (e) { return {pass:false,debug:String((e&&e.stack)||e)}; }
})()
