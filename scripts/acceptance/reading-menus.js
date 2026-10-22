/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回阅读视图右键菜单断言；失败抛出异常，供运行器判定。
 * [POS]: reading-menus 场景。覆盖阅读模式内部链接（新标签页/新标签组/重命名）、外链（复制链接/浏览器打开）、图片（复制图片）与未解析链接（创建此文件）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const checks=[];
const check=(ok,msg)=>{if(!ok)throw Error('✗ '+msg);checks.push(msg);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,msg,timeout=4000)=>{const t0=Date.now();while(Date.now()-t0<timeout){if(fn())return;await wait(50);}throw Error('✗ timeout: '+msg);};
const titles=()=>[...document.querySelectorAll('body .menu .menu-item-title')].map((e)=>e.textContent);
const has=(s)=>titles().some((x)=>x.includes(s));
const rightClick=(el)=>{const r=el.getBoundingClientRect();el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:r.left+4,clientY:r.top+4}));};
const clickItem=(s)=>{const el=[...document.querySelectorAll('body .menu .menu-item')].find((e)=>e.textContent.includes(s));if(!el)throw Error('✗ no menu item: '+s);el.click();};
const closeMenu=async()=>{document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));await wait(80);};

await app.vault.createBinary('pic.png',new Uint8Array([137,80,78,71,13,10,26,10,1,2,3,4]));
await app.vault.create('MenuTarget.md','# 目标\n');
const a=await app.vault.create('MenuSource.md','# 源\n\n[[MenuTarget]]\n\n![[MenuTarget]]\n\n[官网](https://example.com)\n\n![[pic.png]]\n\n[[不存在]]\n');
await app.workspace.openFile(a);
const view=app.workspace.activeLeaf.view;
await view.setState({file:a.path,mode:'preview'});
await until(()=>!!view.readingEl.querySelector('a.internal-link[data-href="MenuTarget.md"]'),'阅读视图渲染',4000);

// ---------------------------------------------------------- 内部链接
rightClick(view.readingEl.querySelector('a.internal-link[data-href="MenuTarget.md"]'));
await until(()=>!!document.querySelector('body > .menu'),'内部链接菜单',2500);
check(has('在新标签页中打开')||has('Open in new tab'),'内部链接含在新标签页中打开');
check(has('在新标签组中打开')||has('Open to the right'),'内部链接含在新标签组中打开');
check(has('重命名')||has('Rename'),'内部链接含重命名');
const beforeLeaves=app.workspace.getLeavesOfType('markdown').length;
clickItem('在新标签页中打开');
await until(()=>app.workspace.getLeavesOfType('markdown').some((l)=>l.view.file&&l.view.file.path==='MenuTarget.md'),'新标签页打开目标',4000);
check(app.workspace.getLeavesOfType('markdown').length>beforeLeaves,'新标签页数量增加');
await app.workspace.openFile(a);
await until(()=>!!view.readingEl.querySelector('a.internal-link[data-href="MenuTarget.md"]'),'返回源文件',4000);

// ---------------------------------------------------------- 外部链接
rightClick(view.readingEl.querySelector('a.external-link'));
await until(()=>!!document.querySelector('body > .menu'),'外链菜单',2500);
check(has('复制链接')||has('Copy link')||has('Copy URL'),'外链含复制链接');
check(has('在默认浏览器打开')||has('default browser'),'外链含在默认浏览器打开');
await closeMenu();

// ---------------------------------------------------------- 图片
const img=view.readingEl.querySelector('.internal-embed.image-embed img');
check(!!img,'图片嵌入已渲染');
rightClick(img);
await until(()=>!!document.querySelector('body > .menu'),'图片菜单',2500);
check(has('复制图片')||has('Copy image'),'图片含复制图片');
clickItem('复制图片');
await wait(200);
check(!document.querySelector('body > .menu'),'点击后菜单关闭且无异常');

// ---------------------------------------------------------- 笔记嵌块
const noteEmbed=view.readingEl.querySelector('.internal-embed.markdown-embed[data-href="MenuTarget.md"]');
check(!!noteEmbed,'笔记嵌块已渲染且带 data-href');
rightClick(noteEmbed);
await until(()=>!!document.querySelector('body > .menu'),'嵌块菜单',2500);
check(has('在新标签页中打开')||has('Open in new tab'),'嵌块含链接菜单项');
await closeMenu();

// ---------------------------------------------------------- 未解析链接
const missing=[...view.readingEl.querySelectorAll('a.internal-link')].find((el)=>el.getAttr('data-href')==='不存在');
check(!!missing,'未解析链接已渲染');
rightClick(missing);
await until(()=>!!document.querySelector('body > .menu'),'未解析链接菜单',2500);
check(has('创建此文件')||has('Create this file'),'未解析链接含创建此文件');
await closeMenu();
return {pass:true,count:checks.length,checks};
})()
