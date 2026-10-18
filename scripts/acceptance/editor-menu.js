/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回编辑器右键菜单与外部文件拖入断言；失败抛出异常，供运行器判定。
 * [POS]: editor-menu 场景。覆盖菜单结构（剪贴板/格式/段落/插入/复制路径）、editor-menu 事件、加粗动作、标题命令与外部文件拖入落盘。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const checks=[];
const check=(ok,msg)=>{if(!ok)throw Error('✗ '+msg);checks.push(msg);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,msg,timeout=4000)=>{const t0=Date.now();while(Date.now()-t0<timeout){if(fn())return;await wait(50);}throw Error('✗ timeout: '+msg);};

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
content.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:r.left+8,clientY:r.top+6}));
await until(()=>!!document.querySelector('body > .menu'),'右键菜单弹出',3000);
const menu=document.querySelector('body > .menu');
const has=(s)=>[...document.querySelectorAll('body .menu .menu-item-title')].some(el=>el.textContent.includes(s));
check(has('剪切')||has('Cut'),'含剪切');
check(has('粘贴')||has('Paste'),'含粘贴');
check(has('全选')||has('Select'),'含全选');
check(has('文本格式')||has('Formatting'),'含文本格式子菜单');
check(has('段落设置')||has('Paragraph'),'含段落设置子菜单');
check(has('插入')||has('Insert'),'含插入子菜单');
check(has('复制路径')||has('Copy path'),'含复制路径子菜单');
check(!!fired,'editor-menu 事件触发');

const fmtItem=[...menu.querySelectorAll('.menu-item')].find(el=>el.textContent.includes('文本格式')||el.textContent.includes('Formatting'));
fmtItem.dispatchEvent(new MouseEvent('mouseenter',{bubbles:false}));
await wait(380);
const boldItem=[...document.querySelectorAll('body .menu .menu-item')].find(el=>el.textContent.includes('加粗')||el.textContent.includes('Bold'));
check(!!boldItem,'格式化子菜单含加粗');
boldItem.click();
await wait(150);
check(view.editor.getValue().includes('**hello**'),'加粗动作包裹选区');
if (ref && ref.unregister) ref.unregister();
await wait(120);
check(!document.querySelector('body > .menu'),'点击后菜单关闭');

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
return {pass:true,checks};
})()
