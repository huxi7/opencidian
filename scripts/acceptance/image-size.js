/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回图片尺寸语法与右键"重置大小"的断言；失败抛出异常，供运行器判定。
 * [POS]: image-size 场景。覆盖 `|300` / `|300x200` 尺寸语法（阅读视图与实时预览）、无尺寸与解析失败时的原始宽度、阅读视图右键"重置大小"改写源文本与落盘、未解析与非图片嵌入不受影响。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const checks=[];
const check=(ok,msg)=>{if(!ok)throw Error('✗ '+msg);checks.push(msg);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,msg,timeout=5000)=>{const t0=Date.now();while(Date.now()-t0<timeout){if(fn())return;await wait(50);}throw Error('✗ timeout: '+msg);};
const titles=()=>[...document.querySelectorAll('body .menu .menu-item-title')].map((e)=>e.textContent);
const has=(s)=>titles().some((x)=>x.includes(s));
const rightClick=(el)=>{const r=el.getBoundingClientRect();el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:r.left+4,clientY:r.top+4}));};
const clickItem=(s)=>{const el=[...document.querySelectorAll('body .menu .menu-item')].find((e)=>e.textContent.includes(s));if(!el)throw Error('✗ no menu item: '+s);el.click();};
const closeMenu=async()=>{document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));await wait(80);};
const near=(a,b,tol)=>Math.abs(a-b)<=tol;
const box=(el)=>{const r=el.getBoundingClientRect();return {w:r.width,h:r.height};};
const RESET=['重置大小','Reset size'];

// 60x40 纯色 PNG：无尺寸语法时渲染宽度必须回到原始宽度 60，`|300` 时高度按 40/60 比例成为 200
const PNG_BASE64='iVBORw0KGgoAAAANSUhEUgAAADwAAAAoCAIAAAAt2Q6oAAAAO0lEQVR42u3OQQkAAAgEsItjHGMbyxQ+hMECLNP1TqSlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpS8tjtO4pnvbCW0AAAAASUVORK5CYII=';
await app.vault.createBinary('pic.png',Uint8Array.from(atob(PNG_BASE64),(c)=>c.charCodeAt(0)));
await app.vault.create('Other.md','# 目标\n\n别的笔记正文。\n');

const source=await app.vault.create('ImageSize.md',[
  '# 尺寸',
  '',
  '![[pic.png|300]]',
  '',
  '![[pic.png|300x200]]',
  '',
  '![[pic.png]]',
  '',
  '![alt|300](pic.png)',
  '',
  '![300](pic.png)',
  '',
  '![[没有这张图.png|300]]',
  '',
  '![[Other|300]]',
  '',
].join('\n'));
await app.workspace.openFile(source);
const view=app.workspace.getActiveViewOfType('markdown');
check(!!view,'markdown 视图已打开');
await view.setState({file:source.path,mode:'preview'});
await until(()=>view.readingEl.querySelectorAll('img').length>=5,'阅读视图渲染图片',5000);
await until(()=>[...view.readingEl.querySelectorAll('img')].every((i)=>i.complete&&i.naturalWidth>0),'图片加载完成',6000);
const q=(sel)=>view.readingEl.querySelector(sel);

// ---------------------------------------------------------- 尺寸语法解析
const wiki=q('[data-source-text="pic.png|300"] img');
check(!!wiki&&!!wiki.closest('.internal-embed.image-embed'),'![[pic.png|300]] 渲染为 .internal-embed.image-embed > img');
check(wiki.getAttribute('width')==='300','|300 写进 img 的 width 属性');
check(wiki.getAttribute('height')===null,'|300 不写 height（高度由浏览器按比例）');
check(wiki.naturalWidth===60&&wiki.naturalHeight===40,'测试图片原始尺寸 60x40');
check(near(box(wiki).w,300,1),'|300 渲染宽度 = 300，实际 '+box(wiki).w);
check(near(box(wiki).h,200,2),'|300 渲染高度按 40/60 比例 = 200，实际 '+box(wiki).h);

const both=q('[data-source-text="pic.png|300x200"] img');
check(!!both&&both.getAttribute('width')==='300'&&both.getAttribute('height')==='200','|300x200 同时写 width 与 height');
check(near(box(both).w,300,1)&&near(box(both).h,200,2),'|300x200 渲染尺寸 = 300x200，实际 '+box(both).w+'x'+box(both).h);

const plain=q('[data-source-text="pic.png"] img');
check(!!plain&&plain.getAttribute('width')===null&&plain.getAttribute('height')===null,'无尺寸语法不写 width/height');
check(near(box(plain).w,60,1),'无尺寸语法的渲染宽度保持原始宽度 60，实际 '+box(plain).w);

const mdImg=q('[data-source-text="alt|300"] img');
check(!!mdImg&&mdImg.getAttribute('width')==='300','![alt|300](url) 的竖线语法同样生效');
check(near(box(mdImg).w,300,1),'![alt|300](url) 渲染宽度 = 300，实际 '+box(mdImg).w);

const bare=q('[data-source-text="300"] img');
check(!!bare&&bare.getAttribute('width')===null,'![300](url) 没有竖线，不解析为尺寸（与原版一致）');

// ---------------------------------------------------------- 未解析 / 非图片嵌入
const missing=q('.internal-embed.is-unresolved');
check(!!missing&&missing.textContent.includes('没有这张图.png'),'未解析的图片嵌入降级为 .is-unresolved 文本');
check(!missing.querySelector('img'),'未解析嵌入不产生 img');
const noteEmbed=q('.internal-embed.markdown-embed[data-href="Other.md"]');
check(!!noteEmbed&&noteEmbed.textContent.includes('别的笔记正文'),'非图片嵌入 ![[Other|300]] 照常渲染笔记内容');
check(!noteEmbed.querySelector('[width]'),'非图片嵌入不带 width 元素');

// ---------------------------------------------------------- 右键"重置大小"
rightClick(wiki);
await until(()=>!!document.querySelector('body > .menu'),'图片菜单',2500);
check(has('复制图片')||has('Copy image'),'图片菜单保留原版复制图片项');
check(has('在新标签页中打开')||has('Open in new tab'),'库内图片菜单接上原版链接菜单项');
check(has('删除图片')||has('Delete image'),'库内图片菜单出现原版删除图片项（danger 段）');
check(RESET.some(has),'带 width 的图片菜单出现重置大小');
clickItem(RESET.find(has));
await wait(120);
check(!document.querySelector('body > .menu'),'点击重置大小后菜单关闭且无异常');
check(view.editor.getValue().includes('![[pic.png]]\n')&&!view.editor.getValue().includes('![[pic.png|300]]'),'源文本的 |300 已被移除');
check(wiki.getAttribute('width')===null,'重置后 img 的 width 属性被移除');
view.editor.undo();
await wait(80);
check(view.editor.getValue().includes('![[pic.png|300]]'),'重置大小进撤销栈，undo 可回退');
view.editor.redo();
await wait(80);
check(!view.editor.getValue().includes('![[pic.png|300]]'),'redo 重新应用移除');
await wait(450);
const saved=await app.vault.read(app.vault.getFileByPath('ImageSize.md'));
check(!saved.includes('![[pic.png|300]]'),'重置结果已落盘（保存链路保留）');
check(saved.includes('![[pic.png|300x200]]'),'其它行的尺寸语法未被误改');

rightClick(both);
await until(()=>!!document.querySelector('body > .menu'),'双值图片菜单',2500);
check(RESET.some(has),'双值图片重置项可用（偏移在上一处编辑后仍定位正确）');
clickItem(RESET.find(has));
await wait(120);
check(!view.editor.getValue().includes('300x200'),'|300x200 整段被移除');
check(both.getAttribute('width')===null&&both.getAttribute('height')===null,'双值重置后 width/height 双双移除');

rightClick(q('[data-source-text="pic.png"] img'));
await until(()=>!!document.querySelector('body > .menu'),'无尺寸图片菜单',2500);
check(!RESET.some(has),'无尺寸图片不出现重置大小');
await closeMenu();

// ---------------------------------------------------------- 实时预览
const lp=await app.vault.create('LPSize.md','# LP\n\n![[pic.png|120]]\n\n![[pic.png]]\n');
await view.setState({file:lp.path,mode:'live'});
await view.editor.setCursor({line:0,ch:0});
await until(()=>view.sourceEl.querySelectorAll('.cm-content .image-embed img').length>=2,'实时预览渲染内嵌图片',5000);
const lpImgs=[...view.sourceEl.querySelectorAll('.cm-content .image-embed img')];
check(lpImgs[0].getAttribute('width')==='120','实时预览 ![[pic.png|120]] 的 width 属性生效');
check(near(box(lpImgs[0]).w,120,1),'实时预览内嵌图片渲染宽度 = 120，实际 '+box(lpImgs[0]).w);
check(lpImgs[1].getAttribute('width')===null&&near(box(lpImgs[1]).w,60,1),'实时预览无尺寸图片保持原始宽度 60');

return {pass:true,checks,count:checks.length};
})()
