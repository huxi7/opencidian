/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例；OBS_SIDEBAR_VIEW = "<theme>[:<scrollTop>]"。
 * [OUTPUT]: 全要素笔记在阅读视图下的计算样式与几何（console.log PROBE-READING + 返回 JSON + 截图）。
 * [POS]: scripts/acceptance 的截图诊断场景（非断言锁；UI 巡检与前后对比取证，可复用）。断言基线来自 _analysis/obsidian-114/renderer/app.css。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const checks=[];
const check=(ok,m)=>{if(!ok)throw Error('✗ '+m);checks.push(m);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,msg,timeout=6000)=>{const t0=Date.now();while(Date.now()-t0<timeout){if(fn())return;await wait(50);}throw Error('✗ timeout: '+msg);};
const env=(typeof process!=='undefined'&&process.env)||{};
const tokens=String(env.OBS_SIDEBAR_VIEW||'light').split(/[+,\s]+/).filter(Boolean);
const token=tokens[0]||'light';
const [themeName,scrollText]=token.split(':');
const scrollTop=Number(scrollText||0);
const wantDark=themeName==='dark';

/* ---------------------------------------------------------------- 造库 */
app.settings.updateAppearance({theme:wantDark?'obsidian':'moonstone'});
await wait(200);
await app.vault.createBinary('pic.png',new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,2,0,0,0,2,8,6,0,0,0,114,182,13,36,0,0,0,20,73,68,65,84,8,215,99,248,207,192,240,31,0,0,3,1,1,0,24,221,141,215,0,0,0,0,73,69,78,68,174,66,96,130]));
await app.vault.createBinary('clip.mp3',new Uint8Array([73,68,51,4,0,0,0,0,0,0]));
await app.vault.createBinary('clip.mp4',new Uint8Array([0,0,0,24,102,116,121,112,105,115,111,109]));
await app.vault.createBinary('doc.pdf',new Uint8Array([37,80,68,70,45,49,46,52,10,10]));
await app.vault.createBinary('附件.zip',new Uint8Array([80,75,3,4,1,2,3]));
await app.vault.create('嵌入目标.md','# 嵌入目标\n\n嵌入正文一段。\n');
const NOTE=[
'---','title: 属性标题','tags: [alpha, beta]','count: 3','flag: true','date: 2026-01-02','---','',
'# 一级标题 H1','','## 二级标题 H2','','### 三级标题 H3','','#### 四级标题 H4','','##### 五级标题 H5','','###### 六级标题 H6','',
'正文段落一，含 **粗体**、*斜体*、~~删除线~~、==高亮==、`行内代码`，标签 #标签/中文 与 #tag2。','',
'内部链接 [[嵌入目标]]，未解析链接 [[不存在]]，外部链接 [示例站点](https://example.com)，行内公式 $E = mc^2$。','',
'> 引用第一行','> 引用第二行','','- 无序项一','- 无序项二','\t- 嵌套项二一','\t\t- 嵌套项二二','',
'1. 有序项一','2. 有序项二','','- [ ] 未完成任务','- [x] 已完成任务','',
'> [!info] Info 标题','> info 内容','','> [!warning] Warning 标题','> warning 内容','',
'> [!success] Success 标题','> success 内容','','> [!error] Error 标题','> error 内容','',
'```js','const x = 1;','console.log(x);','```','','```python','def f():','    return 1','```','',
'$$','\\int_0^1 x^2 \\, dx = \\frac{1}{3}','$$','',
'| 左对齐 | 居中 | 右对齐 |','| :-- | :-: | --: |','| a | b | c |','| d | e | f |','','---','',
'脚注引用[^1]，另一处[^2]。','','[^1]: 第一条脚注','[^2]: 第二条脚注','',
'![[pic.png|300]]','','![[clip.mp3]]','','![[clip.mp4]]','','![[doc.pdf]]','','![[嵌入目标]]','','![[附件.zip]]','',
'进度：<progress value="60" max="100"></progress> 行内 <kbd>Cmd</kbd>。','',
].join('\n');
const file=await app.vault.create('排版全要素.md',NOTE);
await app.workspace.openFile(file);
await wait(400);
const view=app.workspace.activeLeaf.view;
await view.setState({file:file.path,mode:'preview'});
await until(()=>!!view.readingEl.querySelector('h1'),'阅读视图渲染');
await until(()=>!!view.readingEl.querySelector('mjx-container'),'数学渲染');
await until(()=>!!view.readingEl.querySelector('pre code span'),'代码高亮');
await wait(500);
if(scrollTop)view.readingEl.scrollTop=scrollTop;
await wait(200);

/* ---------------------------------------------------------------- 测量 */
const root=view.readingEl;
const q=(s)=>root.querySelector(s);
const all=(s)=>[...root.querySelectorAll(s)];
const boxes={};
const st={};
const pickStr=['display','position','fontSize','fontWeight','fontFamily','lineHeight','letterSpacing','color','backgroundColor','borderRadius','borderTopWidth','borderTopStyle','borderTopColor','borderRightWidth','borderRightColor','borderBottomWidth','borderBottomColor','borderLeftWidth','borderLeftStyle','borderLeftColor','marginTop','marginBottom','marginLeft','marginRight','paddingTop','paddingBottom','paddingLeft','paddingRight','textDecorationLine','textDecorationColor','textAlign','verticalAlign','whiteSpace','overflowX','maxWidth','minHeight','gap','justifyContent','alignItems','opacity','backgroundImage','backgroundSize','listStyleType','textOverflow','filter','mixBlendMode','outline','cornerShape','boxShadow','transform','unicodeBidi','float','width','height'];
const num=(v)=>Math.round(parseFloat(v||'0')*100)/100;
const snapshot=(key,el,props)=>{
  if(!el){st[key]='MISSING';return;}
  const cs=getComputedStyle(el);
  const o={};
  for(const p of (props||pickStr))o[p]=cs[p];
  const r=el.getBoundingClientRect();
  o._rect=[Math.round(r.x),Math.round(r.y+root.scrollTop),Math.round(r.width),Math.round(r.height)];
  st[key]=o;
};
const varsOf=(el,names)=>{if(!el)return{};const cs=getComputedStyle(el);const o={};for(const n of names)o[n]=cs.getPropertyValue(n).trim();return o;};
const gaps=(key,a,b)=>{const ea=q(a),eb=q(b);if(!ea||!eb){st[key]='MISSING';return;}const ra=ea.getBoundingClientRect(),rb=eb.getBoundingClientRect();st[key]={gapTop:num(rb.top-ra.bottom),gapBottom:num(rb.bottom-ra.top),aBottom:num(ra.bottom+root.scrollTop),bTop:num(rb.top+root.scrollTop)};};

const VARNAMES=['--p-spacing','--heading-spacing','--file-margins-x','--file-margins-y','--file-line-width','--font-text-size','--font-smaller','--font-text','--line-height-normal','--line-height-tight','--h1-size','--h2-size','--h3-size','--h4-size','--h5-size','--h6-size','--h1-weight','--h2-weight','--h1-line-height','--h2-line-height','--h3-line-height','--inline-title-size','--inline-title-weight','--inline-title-margin-bottom','--list-indent','--list-spacing','--list-marker-color','--list-bullet-size','--list-bullet-radius','--checkbox-size','--checkbox-color','--checkbox-border-color','--blockquote-border-thickness','--blockquote-border-color','--blockquote-color','--code-size','--code-radius','--code-background','--code-border-width','--code-border-color','--code-white-space','--table-border-width','--table-border-color','--table-line-height','--table-text-size','--table-header-weight','--table-header-color','--tag-size','--tag-color','--tag-background','--tag-radius','--tag-padding-x','--tag-padding-y','--tag-decoration','--tag-border-width','--tag-weight','--link-color','--link-color-hover','--link-decoration','--link-external-color','--link-external-decoration','--link-external-color-hover','--link-unresolved-color','--link-unresolved-opacity','--link-unresolved-decoration-color','--link-decoration-thickness','--hr-color','--hr-thickness','--footnote-size','--embed-padding','--embed-border-start','--embed-background','--embed-max-height','--image-radius','--callout-border-width','--callout-border-opacity','--callout-padding','--callout-radius','--callout-title-weight','--callout-default','--callout-info','--callout-warning','--callout-success','--callout-error','--bold-weight','--bold-color','--text-highlight-bg','--interactive-accent','--background-primary-alt','--text-accent','--text-muted','--text-faint','--metadata-padding','--metadata-label-width','--metadata-input-height','--size-4-2','--size-4-3','--size-4-4','--size-4-6','--size-4-8','--size-2-2'];
st._vars=varsOf(root,VARNAMES);
st._varsRoot=varsOf(document.body,VARNAMES.slice(0,20));

/* 容器与标题 */
snapshot('readingView',root,['display','flexDirection','overflowY','overflowX','backgroundColor','paddingTop','paddingLeft']);
snapshot('previewView',q('.markdown-preview-view'),['paddingTop','paddingLeft','paddingRight','fontSize','fontFamily','lineHeight','color','backgroundColor','overflowY','overflowWrap','scrollbarGutter','position','width','height']);
snapshot('sizer',q('.markdown-preview-sizer'),['maxWidth','marginLeft','marginRight','minHeight','display']);
snapshot('section',q('.markdown-preview-section'),['paddingBottom','marginBottom']);
snapshot('content',q('.markdown-content'),['marginTop','marginBottom','display']);
snapshot('inlineTitle',q('.inline-title'),['fontSize','fontWeight','lineHeight','letterSpacing','marginBottom','color','fontFamily','fontStyle']);
snapshot('firstChild',root.querySelector('.markdown-content > *'),null);

/* 标题 */
for(const n of [1,2,3,4,5,6]){
  snapshot('h'+n,q('.markdown-content h'+n),['fontSize','fontWeight','lineHeight','letterSpacing','color','marginTop','marginBottom','fontFamily','fontStyle']);
}
gaps('gap_h1_p','.markdown-content h1','.markdown-content h1 + p');
gaps('gap_h2_h3','.markdown-content h2','.markdown-content h3');
const p1=all('.markdown-content > p')[0];
snapshot('p',p1,['marginTop','marginBottom','lineHeight','fontSize','unicodeBidi','color']);
snapshot('strong',q('.markdown-content strong'),['fontWeight','color']);
snapshot('em',q('.markdown-content em'),['fontStyle','color']);
snapshot('del',q('.markdown-content s, .markdown-content del'),['textDecorationLine']);
snapshot('mark',q('.markdown-content mark'),['backgroundColor','color','padding']);

/* 链接与标签 */
snapshot('internalLink',q('.markdown-content a.internal-link'),['color','textDecorationLine','textDecorationColor','cursor','fontWeight','textDecorationThickness']);
snapshot('unresolvedLink',q('.markdown-content a.internal-link.is-unresolved'),['color','opacity','textDecorationStyle','textDecorationColor','filter']);
snapshot('externalLink',q('.markdown-content a.external-link'),['color','textDecorationLine','paddingRight','backgroundImage','backgroundSize','backgroundPosition','filter','backgroundRepeat']);
snapshot('tag',q('.markdown-content a.tag'),['color','backgroundColor','borderRadius','borderTopWidth','paddingTop','paddingBottom','paddingLeft','paddingRight','fontSize','lineHeight','textDecorationLine','fontWeight','display']);

/* 列表 */
snapshot('ul',q('.markdown-content ul'),['paddingLeft','paddingRight','marginTop','marginBottom','listStyleType']);
snapshot('ol',q('.markdown-content ol'),['paddingLeft','marginTop','marginBottom','listStyleType']);
snapshot('li',q('.markdown-content ul > li'),['marginLeft','paddingTop','paddingBottom','position','display']);
snapshot('liNested',q('.markdown-content ul ul > li'),['marginLeft','paddingTop']);
snapshot('olMarker',q('.markdown-content ol > li'),['marginLeft']);
st.olMarkerColor=(()=>{const el=q('.markdown-content ol > li');if(!el)return 'MISSING';try{return getComputedStyle(el,'::marker').color;}catch(e){return 'ERR';}})();
st.ulMarkerColor=(()=>{const el=q('.markdown-content ul > li');if(!el)return 'MISSING';try{return getComputedStyle(el,'::marker').color;}catch(e){return 'ERR';}})();
st.listBulletCount=all('.list-bullet').length;
snapshot('listBullet',q('.list-bullet'),['float','marginLeft','width','height','display','color','backgroundColor','borderRadius']);
st.listBulletAfter=(()=>{const el=q('.list-bullet');if(!el)return 'MISSING';try{const cs=getComputedStyle(el,'::after');return {w:cs.width,h:cs.height,bg:cs.backgroundColor,br:cs.borderRadius,color:cs.color,content:cs.content};}catch(e){return 'ERR '+e.message;}})();
st.hasListBullet=all('ul.has-list-bullet').length;
st.taskItemAttrs=all('li.task-list-item').map((el)=>({cls:String(el.className),task:el.getAttribute('data-task'),checked:!!el.querySelector('input:checked')}));
snapshot('taskLi',q('li.task-list-item'),['display','alignItems','gap','listStyleType','marginLeft','paddingTop']);
snapshot('taskCheckedLi',q('li.task-list-item.is-checked')||q('li.task-list-item[data-task="x"]'),['display','color','textDecorationLine','textDecorationColor']);
snapshot('taskCheckbox',q('.task-list-item-checkbox'),['width','height','marginLeft','marginRight','marginTop','top','position','borderTopWidth','borderTopColor','borderRadius','backgroundColor','appearance','verticalAlign']);
snapshot('taskCheckboxChecked',q('.task-list-item-checkbox:checked'),['backgroundColor','borderTopColor','borderTopWidth','borderRadius','width','height']);
st.taskCheckboxAfter=(()=>{const el=q('.task-list-item-checkbox:checked');if(!el)return 'MISSING';try{const cs=getComputedStyle(el,'::after');return {w:cs.width,h:cs.height,bg:cs.backgroundColor,mask:cs.webkitMaskImage,left:cs.left,top:cs.top,position:cs.position};}catch(e){return 'ERR';}})();
snapshot('taskText',q('li.task-list-item.is-checked > p, li.task-list-item.is-checked'),['color','textDecorationLine']);

/* 引用 */
snapshot('blockquote',q('.markdown-content blockquote'),['borderLeftWidth','borderLeftStyle','borderLeftColor','borderInlineStartWidth','paddingLeft','paddingTop','paddingBottom','color','fontStyle','backgroundColor','marginTop','marginBottom','marginLeft','marginRight']);
st.blockquoteFirstChildMargin=(()=>{const el=q('.markdown-content blockquote > *');if(!el)return 'MISSING';const cs=getComputedStyle(el);return {mt:cs.marginTop,mb:cs.marginBottom};})();

/* callout */
for(const type of ['info','warning','success','error']){
  const el=q('.callout[data-callout="'+type+'"]');
  snapshot('callout_'+type,el,['borderTopWidth','borderTopColor','borderRadius','backgroundColor','paddingTop','paddingLeft','paddingBottom','paddingRight','marginTop','marginBottom','mixBlendMode','overflow']);
  const title=q('.callout[data-callout="'+type+'"] > .callout-title');
  snapshot('calloutTitle_'+type,title,['color','fontSize','gap','paddingTop','paddingLeft','lineHeight','alignItems','display']);
  const inner=q('.callout[data-callout="'+type+'"] .callout-title-inner');
  snapshot('calloutInner_'+type,inner,['fontWeight','color','fontSize']);
  const icon=q('.callout[data-callout="'+type+'"] .callout-icon svg');
  snapshot('calloutIcon_'+type,icon,['width','height','color','strokeWidth','stroke']);
  if(type==='info'){
    snapshot('calloutContent',q('.callout .callout-content'),['paddingTop','paddingLeft','backgroundColor','overflowX']);
    snapshot('calloutColorVar',el,['--callout-color']);
    st.calloutColorVar=el?getComputedStyle(el).getPropertyValue('--callout-color').trim():'MISSING';
    st.calloutIconName=el?getComputedStyle(el).getPropertyValue('--callout-icon').trim():'MISSING';
    st.calloutDom=el?String(el.className):'MISSING';
  }
}

/* 代码 */
snapshot('inlineCode',q('.markdown-content p code'),['backgroundColor','borderRadius','paddingTop','paddingLeft','fontSize','fontFamily','color','borderTopWidth','borderTopColor','boxDecorationBreak']);
snapshot('pre',q('.markdown-content pre'),['paddingTop','paddingLeft','paddingRight','paddingBottom','backgroundColor','borderRadius','minHeight','borderTopWidth','borderTopColor','whiteSpace','overflowX','marginTop','marginBottom','fontSize','lineHeight','position']);
snapshot('preCode',q('.markdown-content pre code'),['backgroundColor','paddingTop','paddingLeft','borderTopWidth','fontSize','color','borderRadius']);
snapshot('copyButton',q('.markdown-content button.copy-code-button'),['display','position','top','right','margin','padding','fontSize','backgroundColor','color','borderRadius','fontFamily']);
snapshot('codeToken',q('.markdown-content pre code span[class*="tok-"], .markdown-content pre code span'),['color','fontStyle','fontWeight']);

/* 表格 */
snapshot('table',q('.markdown-content table'),['marginTop','marginBottom','borderCollapse','fontSize','lineHeight','color','wordBreak']);
snapshot('th',q('.markdown-content th'),['paddingTop','paddingLeft','paddingBottom','paddingRight','borderTopWidth','borderTopColor','borderLeftWidth','borderRightWidth','borderBottomWidth','fontSize','fontWeight','lineHeight','color','textAlign','verticalAlign','whiteSpace','minWidth','maxWidth','backgroundColor']);
snapshot('td',q('.markdown-content td'),['paddingTop','paddingLeft','paddingBottom','paddingRight','borderTopWidth','borderTopColor','borderLeftWidth','fontSize','color','textAlign','verticalAlign','whiteSpace','minWidth','overflow']);
snapshot('tdCenter',q('.markdown-content td:nth-child(2)'),['textAlign']);
snapshot('tdRight',q('.markdown-content td:nth-child(3)'),['textAlign']);
snapshot('tbodyRow',q('.markdown-content tbody tr'),['backgroundColor']);
st.tbodyRowsBg=all('.markdown-content tbody tr').map((el)=>getComputedStyle(el).backgroundColor);
st.theadBg=q('.markdown-content thead tr')?getComputedStyle(q('.markdown-content thead tr')).backgroundColor:'MISSING';

/* 分隔线 */
snapshot('hr',q('.markdown-content hr'),['borderTopWidth','borderTopStyle','borderTopColor','borderBottomWidth','marginTop','marginBottom','height','backgroundColor']);
st.hrCount=all('.markdown-content hr').length;

/* 脚注 */
snapshot('footnoteRef',q('.footnote-ref'),['fontSize','verticalAlign','color']);
snapshot('footnoteLink',q('.footnotes a, .footnote-item a'),['color','textDecorationLine','fontSize']);
snapshot('footnotes',q('.footnotes'),['fontSize','color','borderTopWidth','borderTopColor','marginTop','paddingTop']);
snapshot('footnotesSep',q('hr.footnotes-sep'),['borderTopWidth','borderTopColor','marginTop','marginBottom']);
snapshot('footnoteItem',q('.footnote-item'),['fontSize','marginTop','color']);
snapshot('footnoteBackref',q('.footnote-backref'),['display','marginLeft','color','textDecorationLine','fontSize']);

/* 数学 */
snapshot('mathInline',q('.markdown-content .math-inline, .markdown-content .math'),['display','paddingLeft','paddingRight','fontSize','marginTop','marginBottom','verticalAlign']);
snapshot('mathBlockWrap',q('.markdown-content .math-block'),['display','marginTop','marginBottom','overflowX','textAlign','paddingTop','paddingBottom']);
snapshot('mathBlockContainer',q('.markdown-content .math-block mjx-container'),['display','marginTop','marginBottom','paddingTop','paddingBottom','textAlign','fontSize','overflowX','minWidth']);
snapshot('mathInlineContainer',q('.markdown-content .math-inline mjx-container'),['display','marginTop','marginBottom','textAlign','fontSize']);

/* 图片与各类嵌入 */
const imgEmbed=q('.internal-embed.image-embed');
snapshot('imageEmbed',imgEmbed,['display','width','paddingBottom','paddingRight','position']);
snapshot('imageWrapper',q('.internal-embed.image-embed .image-wrapper'),['display','position','width','height']);
snapshot('img',q('.internal-embed.image-embed img'),['width','height','maxWidth','borderRadius','display','imageRendering']);
snapshot('audioEmbed',q('.internal-embed.audio-embed'),['display','justifyContent','width']);
snapshot('audio',q('.internal-embed.audio-embed audio'),['width','height','maxWidth']);
snapshot('videoEmbed',q('.internal-embed.video-embed'),['display','justifyContent','width']);
snapshot('video',q('.internal-embed.video-embed video'),['width','height','maxWidth']);
snapshot('pdfEmbed',q('.pdf-embed'),['display','flexDirection','width','height','borderTopWidth','borderTopColor','borderRadius','overflow','position']);
snapshot('pdfInner',q('.pdf-embed iframe, .pdf-embed .pdf-container, .pdf-embed canvas'),['width','height','borderTopWidth']);
const mdEmbed=q('.internal-embed.markdown-embed');
snapshot('mdEmbed',mdEmbed,['display','borderLeftWidth','borderLeftColor','borderTopWidth','borderRightWidth','paddingTop','paddingLeft','paddingRight','paddingBottom','marginTop','marginBottom','backgroundColor','borderRadius','fontStyle','position']);
snapshot('mdEmbedTitle',q('.markdown-embed-title'),['display','fontSize','fontWeight','color','paddingBottom','alignItems','gap','whiteSpace']);
snapshot('mdEmbedContent',q('.markdown-embed-content'),['height','maxHeight','overflowY','paddingTop','paddingLeft']);
snapshot('mdEmbedInnerPreview',q('.markdown-embed-content .markdown-preview-view'),['paddingTop','paddingLeft','fontSize']);
snapshot('mdEmbedLink',q('.markdown-embed-link'),['position','top','right','opacity','color','padding','display']);
st.mdEmbedHref=mdEmbed?mdEmbed.getAttribute('data-href'):'MISSING';
st.mediaEmbedMedia=all('.internal-embed').map((el)=>String(el.className).slice(0,60));

/* 属性块 */
snapshot('metadataHost',q('.metadata-container-host'),['display','marginTop','marginBottom']);
snapshot('metadataContainer',q('.metadata-container'),['display','paddingTop','paddingBottom','paddingLeft','marginBottom','borderRadius','backgroundColor','color','maxWidth','transform','borderTopWidth','borderTopColor']);
snapshot('metadataProperties',q('.metadata-properties'),['display','flexDirection','gap']);
snapshot('metadataProperty',q('.metadata-property'),['display','alignItems','padding','backgroundColor','boxShadow','borderRadius','overflow','position']);
snapshot('metadataPropertyKey',q('.metadata-property-key'),['width','minWidth','fontFamily','borderBottomWidth','borderBottomColor','backgroundColor','alignSelf']);
snapshot('metadataPropertyKeyInput',q('input.metadata-property-key-input'),['fontSize','fontWeight','color','padding','height','borderTopWidth','backgroundColor']);
snapshot('metadataPropertyValue',q('.metadata-property-value'),['display','fontSize','minHeight','gap','alignItems','backgroundColor','borderBottomWidth','overflow','flex']);
snapshot('metadataPropertyValueInput',q('.metadata-property-value .metadata-input-text'),['fontSize','color','minHeight','paddingTop','paddingLeft','backgroundColor','borderTopWidth']);
st.propertyCount=q('.metadata-container')?q('.metadata-container').getAttribute('data-property-count'):'MISSING';

console.log('PROBE-READING '+JSON.stringify({theme:wantDark?'dark':'light',scrollTop,st:Object.keys(st).length},null,1));
return {pass:true,checks,theme:wantDark?'dark':'light',scrollTop,st};
})()
