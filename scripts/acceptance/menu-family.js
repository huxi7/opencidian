/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回菜单家族断言（文件树文件/文件夹/根、标签页、侧栏标题、属性行、反链条目、链接菜单）；失败抛出异常。
 * [POS]: menu-family 场景。对照 1.14.4 bundle 的分节表与项序：file-explorer onFileContextMenu（title/open/action-primary/action/info/info.copy/view/system/danger）、
 *        app 级 file-menu（复制路径子菜单 + system + 移动到…）、WorkspaceLeaf.onOpenTabHeaderMenu（close/pane/action/find）、
 *        metadata-editor showPropertyMenu（danger 移除）、搜索结果条目 handleLinkContextMenu；
 *        并锁住菜单无开合动画、8px 项间距、label/disabled 不吃悬停底色。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const checks=[];
const check=(ok,msg)=>{if(!ok)throw Error('✗ '+msg);checks.push(msg);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const colorOf=(name)=>{const probe=document.createElement('div');probe.style.color='var('+name+')';document.body.appendChild(probe);const c=getComputedStyle(probe).color;probe.remove();return c;};
const until=async(fn,msg,timeout=4000)=>{const t0=Date.now();while(Date.now()-t0<timeout){if(fn())return;await wait(50);}throw Error('✗ timeout: '+msg);};
const menus=()=>[...document.querySelectorAll('body > .menu')];
const menuTitles=(menu)=>[...menu.querySelectorAll('.menu-item-title')].map((el)=>el.textContent);
const titles=()=>{const m=menus();return m.length?menuTitles(m[m.length-1]):[];};
const rightClick=(el,x=4,y=4)=>{const r=el.getBoundingClientRect();el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:r.left+x,clientY:r.top+y}));};
const closeMenu=async()=>{document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));await wait(80);};
const iconClass=(el)=>{const svg=el.querySelector('.menu-item-icon svg');return svg?svg.getAttribute('class')||'':'';};
const visibleSeps=(m)=>[...m.querySelectorAll(':scope > .menu-scroll > .menu-separator')].filter((el)=>getComputedStyle(el).display!=='none').length;
const itemByName=(menu,name)=>[...menu.querySelectorAll('.menu-item')].find((el)=>el.textContent.includes(name));

// ---------------------------------------------------------------- 夹具
const folder=await app.vault.createFolder('MenuFolder');
const file=await app.vault.create('MenuFile.md','# MenuFile\n');
await app.vault.create('MenuFolder/Inner.md','# Inner\n');
await wait(250);

// ---------------------------------------------------------------- 文件树：文件
const treeTitle=(path)=>document.querySelector(`.nav-file-title[data-path="${path}"]`);
await until(()=>!!treeTitle(file.path),'文件树渲染文件行',4000);
rightClick(treeTitle(file.path));
await until(()=>!!document.querySelector('body > .menu'),'文件右键菜单',3000);
let fileMenu=menus()[menus().length-1];
let fileTitles=menuTitles(fileMenu);
check(JSON.stringify(fileTitles)===JSON.stringify(['在新标签页中打开','在新标签组中打开','创建副本','将文件移动到…','复制路径','使用默认应用打开','在访达中显示','重命名','删除']),'文件树文件菜单项序与原版一致：'+fileTitles.join('/'));
check(visibleSeps(fileMenu)===4,'文件菜单四处分隔线（open/action/info.copy/system/danger），实际 '+visibleSeps(fileMenu));
// 动效/悬停：菜单无开合动画；项间距 8px；悬停底色只给可选项
const fileMenuStyle=getComputedStyle(fileMenu);
check(fileMenuStyle.display==='flex','菜单 display:flex（原版 9141）');
check(fileMenuStyle.transitionDuration.split(',')[0].trim()==='0s'&&fileMenuStyle.animationName==='none','菜单无开合动画（原版瞬时）');
const renameStyle=getComputedStyle(itemByName(fileMenu,'重命名'));
check(renameStyle.gap==='8px'&&renameStyle.whiteSpace==='nowrap','菜单项 gap 8px、单行（原版 9161）');
const probeItem=itemByName(fileMenu,'重命名');
probeItem.addClass('is-selected');
check(getComputedStyle(probeItem).backgroundColor===colorOf('--background-modifier-hover'),'可选菜单项选中底色=hover');
probeItem.addClass('is-label');
check(getComputedStyle(probeItem).backgroundColor==='rgba(0, 0, 0, 0)','label 不吃选中/悬停底色（规则排除 label）');
probeItem.removeClass('is-label');
probeItem.removeClass('is-selected');
check(iconClass(itemByName(fileMenu,'在新标签页中打开')).includes('lucide-file-plus'),'在新标签页图标 lucide-file-plus');
check(iconClass(itemByName(fileMenu,'在新标签组中打开')).includes('lucide-separator-vertical'),'在新标签组图标 lucide-separator-vertical');
check(iconClass(itemByName(fileMenu,'创建副本')).includes('lucide-files'),'创建副本图标 lucide-files');
check(iconClass(itemByName(fileMenu,'将文件移动到…')).includes('lucide-folder-tree'),'移动到图标 lucide-folder-tree');
check(iconClass(itemByName(fileMenu,'复制路径')).includes('lucide-clipboard'),'复制路径图标 lucide-clipboard');
check(iconClass(itemByName(fileMenu,'使用默认应用打开')).includes('lucide-arrow-up-right'),'默认应用打开图标 lucide-arrow-up-right');
check(iconClass(itemByName(fileMenu,'重命名')).includes('lucide-edit-3'),'重命名图标 lucide-edit-3');
const deleteItem=itemByName(fileMenu,'删除');
check(iconClass(deleteItem).includes('lucide-trash-2')&&deleteItem.classList.contains('is-warning'),'删除项为 lucide-trash-2 + is-warning');
// 复制路径子菜单（file-menu 事件填充）
const copyItem=itemByName(fileMenu,'复制路径');
check(!!copyItem.querySelector('.menu-item-chevron'),'复制路径带子菜单箭头');
copyItem.dispatchEvent(new MouseEvent('mouseenter',{bubbles:false}));
await wait(420);
const allMenus=menus();
const copies=allMenus.map(menuTitles).filter((list)=>list.includes('基于库的相对路径'));
check(copies.length===1,'复制路径子菜单已展开');
const copyTitles=copies[0];
check(JSON.stringify(copyTitles)===JSON.stringify(['Obsidian URL','基于库的相对路径','绝对路径']),'复制路径子菜单项序与原版一致：'+copyTitles.join('/'));
const copyMenu=allMenus.find((m)=>menuTitles(m).includes('基于库的相对路径'));
check(iconClass(itemByName(copyMenu,'Obsidian URL')).includes('lucide-link'),'Obsidian URL 图标 lucide-link');
check(iconClass(itemByName(copyMenu,'基于库的相对路径')).includes('vault'),'库相对路径图标 vault');
check(iconClass(itemByName(copyMenu,'绝对路径')).includes('lucide-hard-drive'),'绝对路径图标 lucide-hard-drive');
await closeMenu();

// ---------------------------------------------------------------- 文件树：文件夹
const folderTitle=()=>document.querySelector(`.nav-folder-title[data-path="${folder.path}"]`);
await until(()=>!!folderTitle(),'文件树渲染文件夹行',4000);
rightClick(folderTitle());
await until(()=>!!document.querySelector('body > .menu'),'文件夹右键菜单',3000);
let folderMenu=menus()[menus().length-1];
let folderTitles=menuTitles(folderMenu);
check(JSON.stringify(folderTitles)===JSON.stringify(['新建笔记','新建文件夹','创建副本','将文件夹移动到…','复制路径','在访达中显示','重命名','删除']),'文件树文件夹菜单项序与原版一致：'+folderTitles.join('/'));
check(iconClass(itemByName(folderMenu,'新建笔记')).includes('lucide-edit'),'新建笔记图标 lucide-edit');
check(iconClass(itemByName(folderMenu,'新建文件夹')).includes('lucide-folder-open'),'新建文件夹图标 lucide-folder-open');
check(!folderTitles.includes('在新标签页中打开'),'文件夹菜单不含在新标签页中打开（原版 TFile 专属）');
check(!folderTitles.includes('使用默认应用打开'),'文件夹菜单不含使用默认应用打开（原版 TFile 专属）');
await closeMenu();

// ---------------------------------------------------------------- 文件树：根（空白区）
const navContainer=document.querySelector('.nav-files-container')||document.querySelector('.nav-buttons-container').parentElement;
rightClick(navContainer,20,400);
await until(()=>!!document.querySelector('body > .menu'),'根区域右键菜单',3000);
const rootMenu=menus()[menus().length-1];
const rootTitles=menuTitles(rootMenu);
check(JSON.stringify(rootTitles)===JSON.stringify(['新建笔记','新建文件夹']),'空白区菜单仅新建项（原版根节点无重命名/删除）：'+rootTitles.join('/'));
await closeMenu();

// ---------------------------------------------------------------- 标签页
const second=await app.vault.create('Second.md','# Second\n');
await app.workspace.openFile(file,{newLeaf:'tab'});
await app.workspace.openFile(second,{newLeaf:'tab'});
await wait(300);
const headers=[...document.querySelectorAll('.mod-root .workspace-tab-header[data-type="markdown"]')];
check(headers.length>=2,'中心标签页 ≥2 个 Markdown 标签');
rightClick(headers[0]);
await until(()=>!!document.querySelector('body > .menu'),'标签页右键菜单',3000);
const tabMenu=menus()[menus().length-1];
const tabTitles=menuTitles(tabMenu);
check(tabTitles[0]==='关闭','标签菜单首项为关闭');
check(tabTitles.includes('关闭其他标签页')&&tabTitles.includes('关闭右侧所有标签页')&&tabTitles.includes('全部关闭'),'标签菜单含原版关闭组');
check(tabTitles.includes('锁定'),'标签菜单含锁定');
check(tabTitles.includes('阅读视图'),'标签菜单含阅读视图（MarkdownView.onPaneMenu）：'+tabTitles.join('/'));
check(tabTitles.includes('增加笔记属性'),'标签菜单含增加笔记属性（原版 interface.menu.addProperty）：'+tabTitles.join('/'));
check(tabTitles.includes('查找…')&&tabTitles.includes('替换…'),'标签菜单含查找/替换');
check(tabTitles.includes('左右分屏')&&tabTitles.includes('上下分屏'),'标签菜单含原版拆分项（ItemView.onPaneMenu 的 open 节）：'+tabTitles.join('/'));
check(tabTitles.indexOf('左右分屏')>tabTitles.indexOf('锁定')&&tabTitles.indexOf('左右分屏')<tabTitles.indexOf('增加笔记属性'),'节序 pane < open < action');
check(iconClass(itemByName(tabMenu,'左右分屏')).includes('lucide-separator-vertical'),'左右分屏图标 lucide-separator-vertical');
check(iconClass(itemByName(tabMenu,'上下分屏')).includes('lucide-separator-horizontal'),'上下分屏图标 lucide-separator-horizontal');
check(iconClass(itemByName(tabMenu,'关闭')).includes('lucide-x'),'关闭图标 lucide-x');
check(iconClass(itemByName(tabMenu,'锁定')).includes('lucide-pin'),'锁定图标 lucide-pin');
check(iconClass(itemByName(tabMenu,'阅读视图')).includes('lucide-book-open'),'阅读视图图标 lucide-book-open');
check(iconClass(itemByName(tabMenu,'增加笔记属性')).includes('lucide-plus-circle'),'增加笔记属性图标 lucide-plus-circle');
check(iconClass(itemByName(tabMenu,'查找…')).includes('lucide-file-search'),'查找图标 lucide-file-search');
await closeMenu();

// ---------------------------------------------------------------- 标签栏下拉（标签列表菜单）
const tabListBtn=document.querySelector('.mod-root .workspace-tab-header-tab-list');
check(!!tabListBtn,'标签栏存在标签列表按钮');
rightClick(tabListBtn);
await until(()=>!!document.querySelector('body > .menu'),'标签列表菜单',3000);
const listMenu=menus()[menus().length-1];
const listTitles=menuTitles(listMenu);
check(listTitles[0]==='堆叠标签页'||listTitles[0]==='取消堆叠标签页','标签列表首项为堆叠/取消堆叠：'+listTitles.join('/'));
check(listTitles.includes('全部关闭'),'标签列表含全部关闭');
check(listTitles.includes('MenuFile')||listTitles.some((x)=>x.indexOf('MenuFile')>=0),'标签列表逐项列出标签标题');
check(visibleSeps(listMenu)===2,'标签列表两处可见分隔线（action/close/tablist）');
await closeMenu();

// ---------------------------------------------------------------- 侧栏标题（本项目锁定：不提供菜单）
const sideHeader=document.querySelector('.mod-sidedock .workspace-tab-header');
if(sideHeader){
  rightClick(sideHeader);
  await wait(120);
  check(!document.querySelector('body > .menu'),'侧栏标题右键无菜单（回归测试锁定的项目决定）');
}

// ---------------------------------------------------------------- 属性面板条目
const propFile=await app.vault.create('PropsMenu.md','---\ntitle: Hello\ntags: [x]\n---\n\n# Props\n');
await app.workspace.openFile(propFile);
await wait(350);
const propRow=await (async()=>{const t0=Date.now();while(Date.now()-t0<4000){const el=document.querySelector('.metadata-container .metadata-property[data-property-key="title"]');if(el)return el;await wait(50);}return null;})();
check(!!propRow,'笔记属性行已渲染');
rightClick(propRow);
await until(()=>!!document.querySelector('body > .menu'),'属性行菜单',3000);
const propMenu=menus()[menus().length-1];
const propTitles=menuTitles(propMenu);
check(JSON.stringify(propTitles)===JSON.stringify(['移除']),'属性行菜单仅移除（原版 metadata-editor danger 段）：'+propTitles.join('/'));
const removeItem=itemByName(propMenu,'移除');
check(removeItem.classList.contains('is-warning')&&iconClass(removeItem).includes('lucide-trash-2'),'移除项为 is-warning + lucide-trash-2');
await closeMenu();

// ---------------------------------------------------------------- 反链条目
const target=await app.vault.create('LinkTarget.md','# Target\n');
await app.vault.create('LinkSource.md','# Source\n\n[[LinkTarget]]\n');
await wait(400);
await app.workspace.openFile(target);
const backLeaf=app.workspace.getLeavesOfType('backlink')[0]||await app.workspace.ensureSideLeaf('backlink','right',{reveal:true});
check(!!backLeaf,'反链视图已存在');
await wait(500);
const row=await (async()=>{const t0=Date.now();while(Date.now()-t0<5000){const el=backLeaf.view._pane&&backLeaf.view._pane.querySelector('.search-result-file-title');if(el)return el;await wait(60);}return null;})();
check(!!row,'反链来源条目已渲染');
rightClick(row);
await until(()=>!!document.querySelector('body > .menu'),'反链条目菜单',3000);
const linkRowMenu=menus()[menus().length-1];
const linkRowTitles=menuTitles(linkRowMenu);
check(linkRowTitles.includes('在新标签页中打开')&&linkRowTitles.includes('在新标签组中打开'),'反链条目含打开组');
check(linkRowTitles.includes('重命名'),'反链条目含重命名');
check(linkRowTitles.includes('复制路径'),'反链条目含复制路径（file-menu 填充）');
await closeMenu();

return {pass:true,checks};
})()
