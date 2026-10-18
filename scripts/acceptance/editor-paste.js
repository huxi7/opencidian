/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回剪贴板图片粘贴与文件树外部拖入断言；失败抛出异常，供运行器判定。
 * [POS]: editor-paste 场景。覆盖截图形态（File）与 HTML data URL 两种图片粘贴、文本粘贴不误伤、文件树根目录外部文件拖入。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const checks=[];
const check=(ok,msg)=>{if(!ok)throw Error('✗ '+msg);checks.push(msg);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,msg,timeout=4000)=>{const t0=Date.now();while(Date.now()-t0<timeout){if(fn())return;await wait(50);}throw Error('✗ timeout: '+msg);};
const pastedRe=/^Pasted image \d{14}( \d+)?\.png$/;

const file=await app.vault.create('Paste-'+Date.now()+'.md','# P\n\n');
await app.workspace.openFile(file);
const view=app.workspace.activeLeaf.view;
await wait(250);
const content=view.editor.cm.contentDOM;

// ---------------------------------------------------------- 截图形态（File）
const bytes=new Uint8Array([137,80,78,71,13,10,26,10,1,2,3,4]);
const dt=new DataTransfer();
dt.items.add(new File([bytes],'image.png',{type:'image/png'}));
content.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt}));
await until(()=>app.vault.getFiles().some((f)=>pastedRe.test(f.path)),'截图粘贴落盘',4000);
const saved=app.vault.getFiles().find((f)=>pastedRe.test(f.path));
const bin=await app.vault.readBinary(saved);
check(bin.byteLength===bytes.byteLength,'截图附件字节完整');
await until(()=>/!\[\[Pasted image \d{14}[^\]]*\.png\]\]/.test(view.editor.getValue()),'插入截图嵌入链接',3000);
check(true,'截图插入嵌入链接');

// ---------------------------------------------------------- HTML data URL
const b64=btoa(String.fromCharCode(...new Uint8Array([137,80,78,71,9,8,7,6,5])));
const dt2=new DataTransfer();
dt2.setData('text/html','<img src="data:image/png;base64,'+b64+'">');
dt2.setData('text/plain','x');
content.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt2}));
await until(()=>app.vault.getFiles().filter((f)=>pastedRe.test(f.path)).length>=2,'HTML 图片粘贴落盘',4000);
check(true,'HTML data URL 粘贴落盘');
await until(()=>(view.editor.getValue().match(/!\[\[Pasted image/g)||[]).length>=2,'第二条嵌入链接',3000);
check(true,'两条嵌入链接');

// ---------------------------------------------------------- 文本粘贴不误伤
const before=app.vault.getFiles().filter((f)=>pastedRe.test(f.path)).length;
const dt3=new DataTransfer();
dt3.setData('text/plain','纯文本');
content.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt3}));
await wait(150);
check(app.vault.getFiles().filter((f)=>pastedRe.test(f.path)).length===before,'文本粘贴不产生附件');

// ---------------------------------------------------------- 文件树外部拖入（根）
const explorer=app.workspace.getLeavesOfType('file-explorer')[0];
check(!!explorer,'文件树视图存在');
const tree=explorer.view.treeEl;
const fbytes=new Uint8Array([1,2,3,4,5]);
const fdt=new DataTransfer();
fdt.items.add(new File([fbytes],'external-drop.bin',{type:'application/octet-stream'}));
tree.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:fdt}));
tree.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:fdt}));
await until(()=>!!app.vault.getAbstractFileByPath('external-drop.bin'),'外部文件拖入库根',4000);
const dropped=await app.vault.readBinary(app.vault.getAbstractFileByPath('external-drop.bin'));
check(dropped.byteLength===fbytes.byteLength,'拖入文件字节完整');
return {pass:true,checks};
})()
