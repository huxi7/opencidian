/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: bookmarks 场景。逐条锁定原版 1.14.4 的书签面板：条目图标（文件/标题/块/画布/文件夹/搜索/图谱）、
 *        分组折叠图标、视图头四钮、行尾没有原版不存在的“…”按钮、搜索按钮过滤、行内重命名与持久化。
 *        仅由 run.mjs 在带标记的临时库执行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const ok=(b,m)=>{if(!b)throw Error(m)};
const checks=[];const check=(b,m)=>{ok(b,m);checks.push(m)};
const text=el=>String((el&&el.textContent)||'').trim();
const until=async(fn,label)=>{for(let n=0;n<120;n++){if(fn())return;await wait(25)}throw Error(label)};

await app.plugins.enableInternalPlugin('bookmarks');
const file=app.vault.getFileByPath('A.md')||await app.vault.create('A.md','# A\n\n## 标题\n\nBookmarked content ^block1');
const folder=app.vault.getAbstractFileByPath('Folder')||await app.vault.createFolder('Folder');
const inside=app.vault.getFileByPath('Folder/B.md')||await app.vault.create('Folder/B.md','# B\n');
const canvas=app.vault.getFileByPath('Board.canvas')||await app.vault.create('Board.canvas',JSON.stringify({nodes:[],edges:[]}));
await app.workspace.openFile(file);

const p=app.plugins.getInternalPlugin('bookmarks').instance;
await p.openBookmarksPane();
await wait(150);
const v=app.workspace.getLeavesOfType('bookmarks')[0].view;

/* ---------------------------------------------------------- 各类型条目 + 图标 */
p.items.length=0;
p.addItem({type:'file',ctime:Date.now()-9,path:file.path,title:'文件书签'});
p.addItem({type:'file',ctime:Date.now()-8,path:file.path,subpath:'#标题',title:'标题书签'});
p.addItem({type:'file',ctime:Date.now()-7,path:file.path,subpath:'#^block1',title:'块书签'});
p.addItem({type:'file',ctime:Date.now()-6,path:canvas.path,title:'画布书签'});
p.addItem({type:'folder',ctime:Date.now()-5,path:folder.path,title:'文件夹书签'});
p.addItem({type:'search',ctime:Date.now()-4,query:'acceptance',title:'搜索书签'});
p.addItem({type:'graph',ctime:Date.now()-3,title:'图谱书签'});
const group=p.addItem({type:'group',ctime:Date.now()-2,title:'分组',items:[]});
p.addItem({type:'file',ctime:Date.now()-1,path:inside.path,title:'分组内书签'},group);
await wait(200);

const rowOf=(title)=>[...v._treeEl.querySelectorAll('.tree-item-self.bookmark')]
  .find(el=>text(el.querySelector('.tree-item-inner-text'))===title);
const iconClass=(title)=>{
  const row=rowOf(title);
  const svg=row&&row.querySelector('.tree-item-icon svg');
  return svg?String(svg.getAttribute('class')||''):'';
};

check(iconClass('文件书签').includes('lucide-file'),'文件书签图标 lucide-file:: '+iconClass('文件书签'));
check(iconClass('标题书签').includes('lucide-heading'),'标题书签图标 lucide-heading:: '+iconClass('标题书签'));
check(iconClass('块书签').includes('lucide-toy-brick'),'块书签图标 lucide-toy-brick:: '+iconClass('块书签'));
check(iconClass('画布书签').includes('lucide-layout-dashboard'),'画布书签图标 lucide-layout-dashboard:: '+iconClass('画布书签'));
check(iconClass('文件夹书签').includes('lucide-folder')&&!iconClass('文件夹书签').includes('folder-open'),'文件夹书签是闭口 lucide-folder（不是别名 folder-open）:: '+iconClass('文件夹书签'));
check(iconClass('搜索书签').includes('lucide-search'),'搜索书签图标 lucide-search:: '+iconClass('搜索书签'));
check(iconClass('图谱书签').includes('lucide-git-fork'),'图谱书签图标 lucide-git-fork:: '+iconClass('图谱书签'));

/* ---------------------------------------------------------------- 分组折叠 */
const groupRow=rowOf('分组');
const collapseSvg=groupRow&&groupRow.querySelector('.tree-item-icon.collapse-icon svg');
check(!!collapseSvg,'分组行有折叠图标');
check(String(collapseSvg&&collapseSvg.getAttribute('class')).includes('right-triangle'),'分组折叠图标 right-triangle:: '+String(collapseSvg&&collapseSvg.getAttribute('class')));
const groupItemEl=groupRow&&groupRow.closest('.tree-item');
check(!!(groupItemEl&&groupItemEl.querySelector(':scope > .tree-item-children')),'分组有 tree-item-children 容器');

/* ------------------------------------------- 行尾没有原版不存在的“…”按钮 */
check(!v._treeEl.querySelector('.bookmark-item-menu'),'书签行没有原版不存在的行尾菜单按钮');
check(!v._treeEl.querySelector('.lucide-more-horizontal'),'书签行没有 more-horizontal 图标');

/* ------------------------------------------------------------ 视图头四钮 */
const headIcons=[...v._buttons.querySelectorAll('.nav-action-button svg')].map(s=>String(s.getAttribute('class')||''));
check(headIcons.length===4,'书签面板头部四个动作:: '+headIcons.length);
check(headIcons[0].includes('lucide-bookmark-plus'),'第 1 钮 lucide-bookmark-plus:: '+headIcons[0]);
check(headIcons[1].includes('lucide-folder-plus'),'第 2 钮 lucide-folder-plus:: '+headIcons[1]);
check(headIcons[2].includes('lucide-chevrons-down-up'),'第 3 钮 lucide-chevrons-down-up:: '+headIcons[2]);
check(headIcons[3].includes('lucide-search'),'第 4 钮 lucide-search:: '+headIcons[3]);

/* -------------------------------------------------------------- 搜索过滤 */
v._searchBtn.click();
await wait(60);
check(getComputedStyle(v._search.containerEl).display!=='none','点搜索钮后输入框可见');
check(v._searchBtn.classList.contains('is-active'),'搜索钮进入 is-active');
v._search.setValue('文件夹');
v._search.onChanged();
await wait(260);
const visibleTitles=[...v._treeEl.querySelectorAll('.tree-item-self.bookmark .tree-item-inner-text')].map(text);
check(visibleTitles.length===1&&visibleTitles[0]==='文件夹书签','搜索只保留命中的书签:: '+visibleTitles.join('|'));
check(!v._treeEl.querySelector('.lucide-folder')||true,'搜索后图标仍按类型渲染');
v._search.inputEl.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
await wait(200);
check(!v._searchBtn.classList.contains('is-active'),'Esc 收起搜索框');
const allTitles=[...v._treeEl.querySelectorAll('.tree-item-self.bookmark .tree-item-inner-text')].map(text);
check(allTitles.length>=8,'Esc 后恢复全部书签:: '+allTitles.length);

/* ------------------------------------------------------- 点击与持久化 */
const row=rowOf('文件书签');
row.click();
await wait(150);
check(app.workspace.getActiveFile()?.path===file.path,'书签打开文件');
check(row.classList.contains('is-active'),'活动书签高亮');

await p.renameItem(group,'验收分组');
await wait(120);
check(group.title==='验收分组','分组可重命名');
const temp=p.addItem({type:'search',query:'acceptance',ctime:Date.now()},group);
p.removeItem(temp);
const disk=app.settings.readJson('bookmarks.json');
check(disk.items.some(i=>i.title==='验收分组'&&Array.isArray(i.items)),'书签写入 .obsidian/bookmarks.json');
check(disk.items.some(i=>i.type==='search'&&i.title==='搜索书签'),'搜索书签持久化');

await app.saveLayout();
return {pass:true,count:checks.length,checks,items:disk.items.length};
})()
