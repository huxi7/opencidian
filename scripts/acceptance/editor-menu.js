/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回编辑器右键菜单与外部文件拖入断言；失败抛出异常，供运行器判定。
 * [POS]: editor-menu 场景。覆盖编辑器右键菜单的 1.14 分节项序（selection-link/format/paragraph/insert/clipboard）、
 *        文本格式子菜单三节、内部链接菜单（edit-link + file-menu 的复制路径）、editor-menu 事件、标题命令与外部文件拖入落盘。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const checks=[];
const check=(ok,msg)=>{if(!ok)throw Error('✗ '+msg);checks.push(msg);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,msg,timeout=4000)=>{const t0=Date.now();while(Date.now()-t0<timeout){if(fn())return;await wait(50);}throw Error('✗ timeout: '+msg);};
// 真实鼠标序列：mousedown 会先跑到 document 捕获监听（子菜单关闭回归就挂在这里），再 click 才触发动作
const realClick=(el)=>{for(const type of ['mousedown','mouseup','click'])el.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,button:0}));};

const file=await app.vault.create('Menu-'+Date.now()+'.md','# 标题\n\nhello world\n\n[[菜单目标]]\n\n正文段落。\n');
await app.vault.create('菜单目标.md','# 目标\n');
await app.workspace.openFile(file);
const view=app.workspace.activeLeaf.view;
await wait(250);
const cm=view.editor.cm;
const content=cm.contentDOM;

// ---------------------------------------------------------- 右键菜单结构与动作
view.editor.setSelection({line:2,ch:0},{line:2,ch:5});
let fired=null;
const ref=app.workspace.on('editor-menu',(menu,ed)=>{fired=menu;});
const lineEl=[...content.querySelectorAll('.cm-line')][2];
const r=lineEl.getBoundingClientRect();
// 真实右键序列：mousedown 先把选区折叠/移走，contextmenu 里必须恢复（原版行为）
content.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:2,clientX:r.left+8,clientY:r.top+6}));
content.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:r.left+8,clientY:r.top+6}));
await until(()=>!!document.querySelector('body > .menu'),'右键菜单弹出',3000);
const menu=document.querySelector('body > .menu');
const has=(s)=>[...document.querySelectorAll('body .menu .menu-item-title')].some(el=>el.textContent.includes(s));
const titles=()=>[...menu.querySelectorAll('.menu-item-title')].map((el)=>el.textContent);
const iconsOf=()=>[...menu.querySelectorAll('.menu-item')].map((el)=>el.querySelector('svg')?el.querySelector('svg').getAttribute('class'):'');
check(has('剪切')||has('Cut'),'含剪切');
check(has('粘贴')||has('Paste'),'含粘贴');
check(has('全选')||has('Select'),'含全选');
check(has('文本格式')||has('Formatting'),'含文本格式子菜单');
check(has('段落设置')||has('Paragraph'),'含段落设置子菜单');
check(has('插入')||has('Insert'),'含插入子菜单');
check(!!fired,'editor-menu 事件触发');
// 原版 1.14 项序：selection-link（新增链接）→ selection.format → selection.paragraph → selection.insert → clipboard
check(JSON.stringify(titles())===JSON.stringify(['新增链接','新增外部链接','文本格式','段落设置','插入','剪切','复制','粘贴','以纯文本形式粘贴','全选']),'编辑器菜单项序与原版分节一致：'+titles().join('/'));
check(!has('复制路径')&&!has('Copy path'),'普通正文右键不含复制路径（原版由 file-menu 提供，仅链接场景出现）');
const visibleSeps=(m)=>[...m.querySelectorAll(':scope > .menu-scroll > .menu-separator')].filter((el)=>getComputedStyle(el).display!=='none').length;
check(visibleSeps(menu)===2,'普通正文右键仅两处分隔线（文本格式前 / 剪切前），实际 '+visibleSeps(menu));
const iconList=iconsOf();
check(iconList[0]&&iconList[0].includes('lucide-link'),'新增链接图标 lucide-link');
check(iconList[1]&&iconList[1].includes('lucide-external-link'),'新增外部链接图标 lucide-external-link');
check(iconList[2]&&iconList[2].includes('lucide-paintbrush'),'文本格式图标 lucide-paintbrush');
check(iconList[3]&&iconList[3].includes('lucide-pilcrow'),'段落设置图标 lucide-pilcrow');
check(iconList[4]&&iconList[4].includes('lucide-list-plus'),'插入图标 lucide-list-plus');
check(iconList[5]&&iconList[5].includes('lucide-scissors'),'剪切图标 lucide-scissors');
check(iconList[9]&&iconList[9].includes('lucide-box-select'),'全选图标 lucide-box-select');

const fmtItem=[...menu.querySelectorAll('.menu-item')].find(el=>el.textContent.includes('文本格式')||el.textContent.includes('Formatting'));
fmtItem.dispatchEvent(new MouseEvent('mouseenter',{bubbles:false}));
await wait(380);
const boldItem=[...document.querySelectorAll('body .menu .menu-item')].find(el=>el.textContent.includes('加粗')||el.textContent.includes('Bold'));
check(!!boldItem,'格式化子菜单含加粗');
// 原版 NV()：basic（加粗/倾斜/删除线/高亮）— advanced（代码/数学/注释）— danger（清除格式）
const fmtMenus=[...document.querySelectorAll('body .menu')];
const fmtScroll=fmtMenus[fmtMenus.length-1].querySelector('.menu-scroll');
const fmtTitles=[...fmtScroll.querySelectorAll('.menu-item-title')].map((el)=>el.textContent);
check(JSON.stringify(fmtTitles)===JSON.stringify(['加粗','倾斜','删除线','高亮','代码','数学','注释','清除格式']),'文本格式子菜单项序与原版一致：'+fmtTitles.join('/'));
check(fmtScroll.querySelectorAll('.menu-separator').length===2,'文本格式子菜单两处分隔线（basic/advanced/danger）');
realClick(boldItem);
await wait(150);
check(view.editor.getValue().includes('**hello**'),'加粗动作包裹选区（子菜单真实 mousedown 不关闭父菜单）');
if (ref && ref.unregister) ref.unregister();
await wait(120);
check(!document.querySelector('body > .menu'),'点击后菜单关闭');

// ---------------------------------------------------------- 段落/插入子菜单与链接场景
await until(()=>!!document.querySelector('body > .menu')===false,'菜单已关',1500);
const rightClickEl=(el)=>{const rr=el.getBoundingClientRect();content.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:rr.left+4,clientY:rr.top+4}));};
const linkSpan=content.querySelector('.cm-wikilink');
check(!!linkSpan,'实时预览渲染 cm-wikilink');
if(linkSpan){
  view.editor.setCursor({line:0,ch:0});
  await wait(120);
  const span=content.querySelector('.cm-wikilink')||linkSpan;
  rightClickEl(span);
  await until(()=>!!document.querySelector('body > .menu'),'链接右键菜单',3000);
  const linkMenu=document.querySelector('body > .menu');
  const linkTitles=[...linkMenu.querySelectorAll('.menu-item-title')].map((el)=>el.textContent);
  check(linkTitles.includes('编辑链接'),'链接菜单含编辑链接');
  check(linkTitles.includes('在新标签页中打开'),'链接菜单含在新标签页中打开');
  check(linkTitles.includes('复制路径'),'内部链接菜单含复制路径（file-menu 填充）');
  check(linkTitles.indexOf('在新标签页中打开')<linkTitles.indexOf('新增链接'),'原版节序：open 节在 selection-link 之前');
  const copyItem=[...linkMenu.querySelectorAll('.menu-item')].find(el=>el.textContent.includes('复制路径'));
  check(!!copyItem.querySelector('.menu-item-chevron'),'复制路径带子菜单箭头');
  copyItem.dispatchEvent(new MouseEvent('mouseenter',{bubbles:false}));
  await wait(380);
  const subMenus=[...document.querySelectorAll('body .menu')];
  const copyMenu=subMenus.find((m)=>[...m.querySelectorAll('.menu-item-title')].some((el)=>el.textContent==='基于库的相对路径'));
  check(!!copyMenu,'复制路径子菜单已展开');
  const copyTitles=copyMenu?[...copyMenu.querySelectorAll('.menu-item-title')].map((el)=>el.textContent):[];
  check(JSON.stringify(copyTitles)===JSON.stringify(['Obsidian URL','基于库的相对路径','绝对路径']),'复制路径子菜单项序与原版一致：'+copyTitles.join('/'));
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  await wait(120);
}

// ---------------------------------------------------------- 外部文件拖入
const bytes=new Uint8Array([137,80,78,71,13,10,26,10,9,9,9]);
const dt=new DataTransfer();
dt.items.add(new File([bytes],'dropped-asset.png',{type:'image/png'}));
const dropLine=[...content.querySelectorAll('.cm-line')][1];
const dr=dropLine.getBoundingClientRect();
content.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,clientX:dr.left+8,clientY:dr.top+4,dataTransfer:dt}));
await until(()=>!!app.vault.getAbstractFileByPath('dropped-asset.png'),'拖入文件落盘为附件',4000);
const saved=app.vault.getAbstractFileByPath('dropped-asset.png');
const bin=await app.vault.readBinary(saved);
check(bin.byteLength===bytes.byteLength,'附件字节写入完整');
check(view.editor.getValue().includes('![[dropped-asset.png]]'),'插入带扩展名的嵌入链接');
check(app.metadataCache.getFirstLinkpathDest('dropped-asset.png','')===saved.path,'附件链接可解析到文件');

// ---------------------------------------------------------- 命令注册
check(!!app.commands.commands['editor:attach-file'],'editor:attach-file 已注册');
check(!!app.commands.commands['editor:clear-formatting'],'editor:clear-formatting 已注册');
check(!!app.commands.commands['editor:set-heading-3'],'editor:set-heading-3 已注册');
check(!!app.commands.commands['editor:toggle-blockquote'],'editor:toggle-blockquote 已注册');

// ---------------------------------------------------------- 标题/清除格式效果
view.editor.setValue('# A\n**bold** text\n');
await wait(60);
check(view.editor.getValue().startsWith('# A'),'setValue 立即生效');
view.editor.setSelection({line:0,ch:0},{line:0,ch:1});
app.commands.executeCommandById('editor:set-heading-3');
await wait(80);
check(view.editor.getValue().startsWith('### A'),'set-heading-3 写回三级标题');
app.commands.executeCommandById('editor:set-heading-0');
await wait(80);
check(view.editor.getValue().startsWith('A\n'),'set-heading-0 取消标题');
await wait(350);
check(view.editor.getValue().startsWith('A\n'),'保存周期后文档未被回滚');
view.editor.setSelection({line:1,ch:0},{line:1,ch:10});
app.commands.executeCommandById('editor:clear-formatting');
await wait(80);
check(view.editor.getValue().includes('bold text'),'clear-formatting 去掉标记');

// ---------------------------------------------------------- 剪贴板：真实鼠标 + CM6 选区
const clip=require('electron').clipboard;
const openMenu=(lineIndex=0)=>{
  const el=[...content.querySelectorAll('.cm-line')][lineIndex];
  const rr=el.getBoundingClientRect();
  const x=rr.left+2, y=rr.top+rr.height/2;
  content.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:2,clientX:x,clientY:y}));
  content.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:x,clientY:y}));
};
const menuItem=(re)=>[...document.querySelectorAll('body .menu .menu-item')].find((el)=>re.test(el.textContent));
view.editor.setValue('alpha beta');
view.editor.setSelection({line:0,ch:0},{line:0,ch:5});
clip.writeText('SENTINEL');
openMenu(0);
await until(()=>!!document.querySelector('body > .menu'),'复制菜单弹出',2000);
const copyItem=menuItem(/复制|Copy/);
check(!!copyItem&&!copyItem.classList.contains('is-disabled'),'有选区时“复制”可用（editFlags 不覆盖 CM 选区）');
realClick(copyItem);
await wait(120);
check(clip.readText()==='alpha','“复制”写入系统剪贴板：'+clip.readText());
view.editor.setSelection({line:0,ch:0},{line:0,ch:5});
clip.writeText('SENTINEL2');
openMenu(0);
await until(()=>!!document.querySelector('body > .menu'),'剪切菜单弹出',2000);
realClick(menuItem(/剪切|Cut/));
await wait(120);
check(view.editor.getValue()===' beta','“剪切”移除选中文本：'+JSON.stringify(view.editor.getValue()));
check(clip.readText()==='alpha','“剪切”写入系统剪贴板：'+clip.readText());
openMenu(0);
await until(()=>!!document.querySelector('body > .menu'),'粘贴菜单弹出',2000);
realClick(menuItem(/粘贴|Paste/));
await wait(120);
check(view.editor.getValue().includes('alpha'),'“粘贴”写回文本：'+JSON.stringify(view.editor.getValue()));

// ---------------------------------------------------------- 段落/插入子菜单真实鼠标动作
const openSub=(re)=>{const item=menuItem(re);if(!item)throw Error('✗ 找不到子菜单：'+re);item.dispatchEvent(new MouseEvent('mouseenter',{bubbles:false}));return wait(380);};
view.editor.setValue('段落测试');
view.editor.setCursor({line:0,ch:0});
openMenu(0);
await until(()=>!!document.querySelector('body > .menu'),'段落菜单弹出',2000);
await openSub(/段落设置|Paragraph/);
realClick(menuItem(/1级标题|标题 1|Heading 1/));
await wait(150);
check(view.editor.getValue().startsWith('# 段落测试'),'段落设置→标题 1 生效：'+JSON.stringify(view.editor.getValue()));
view.editor.setValue('插入测试');
view.editor.setCursor({line:0,ch:0});
openMenu(0);
await until(()=>!!document.querySelector('body > .menu'),'插入菜单弹出',2000);
await openSub(/插入|Insert/);
realClick(menuItem(/表格|Table/));
await wait(150);
check(view.editor.getValue().includes('| Column 1 |'),'插入→表格生效：'+JSON.stringify(view.editor.getValue()));
return {pass:true,checks};
})()
