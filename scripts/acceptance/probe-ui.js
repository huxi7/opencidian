/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例；状态用 --screen <state>（OBS_SIDEBAR_VIEW）切换；截图由 dev-hooks 在 2500ms 捕获。
 * [OUTPUT]: 多 UI 面（settings/palette/menu/filetree-menu/graph/search/notice）截图诊断与结构计数（console.log PROBE-UI）；--phase dark 出深色同款。
 * [POS]: scripts/acceptance 的 UI 巡检诊断场景（1:1 深挖配套；非断言锁，可复用）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const checks=[];
const check=(ok,m)=>{if(!ok)throw Error('✗ '+m);checks.push(m);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const state=process.env.OBS_SIDEBAR_VIEW||'settings';

// 浅色=moonstone（默认）；深色用 --phase dark 切换（同一场景两色截图复用）
const darkTheme=process.env.OBS_NOTES_STAGE==='dark';
app.settings.updateAppearance({theme:darkTheme?'obsidian':'moonstone'});
await wait(150);
const f=await app.vault.create('UI-'+Date.now()+'.md','# 标题\n\n正文 **粗体** 与 [[链接目标]] 与 #标签\n\n- 列表项一\n- 列表项二\n- [ ] 任务一\n- [x] 任务二已完成\n\n1. 有序一\n2. 有序二\n\n> 引用\n\n```js\nconst a = 1;\n```\n');
await app.workspace.openFile(f);
await wait(350);

const info={state};

if(state==='settings'){
  app.setting.open();
  app.setting.openTabById('appearance');
  await wait(300);
  const modal=document.querySelector('.modal-container .modal');
  const nav=document.querySelector('.vertical-tab-header');
  info.modal=modal?{w:Math.round(modal.getBoundingClientRect().width),h:Math.round(modal.getBoundingClientRect().height),bg:getComputedStyle(modal).backgroundColor,radius:getComputedStyle(modal).borderRadius}:null;
  info.nav=nav?{w:Math.round(nav.getBoundingClientRect().width),bg:getComputedStyle(nav).backgroundColor}:null;
  info.items=document.querySelectorAll('.vertical-tab-nav-item').length;
  check(!!modal,'设置弹窗已开');
}else if(state==='palette'){
  app.commands.executeCommandById('command-palette:open');
  await wait(150);
  const field=[...document.querySelectorAll('.prompt-input')].find(x=>x.getBoundingClientRect().height);
  check(!!field,'命令面板输入框存在');
  field.value='open';
  field.dispatchEvent(new Event('input',{bubbles:true}));
  await wait(250);
  const container=document.querySelector('.prompt');
  const sel=document.querySelector('.prompt-results .suggestion-item.is-selected')||document.querySelector('.prompt-results .suggestion-item');
  info.prompt=container?{w:Math.round(container.getBoundingClientRect().width),bg:getComputedStyle(container).backgroundColor,radius:getComputedStyle(container).borderRadius}:null;
  info.item=sel?{h:Math.round(sel.getBoundingClientRect().height),bg:getComputedStyle(sel).backgroundColor,color:getComputedStyle(sel).color}:null;
  info.itemCount=document.querySelectorAll('.prompt-results .suggestion-item').length;
}else if(state==='menu'){
  const content=document.querySelector('.cm-content');
  check(!!content,'编辑器内容区存在');
  const r=content.getBoundingClientRect();
  content.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:r.left+60,clientY:r.top+8}));
  await wait(250);
  const menu=document.querySelector('.menu');
  check(!!menu,'上下文菜单已开');
  const item=document.querySelector('.menu-item');
  info.menu=menu?{w:Math.round(menu.getBoundingClientRect().width),bg:getComputedStyle(menu).backgroundColor,radius:getComputedStyle(menu).borderRadius,shadow:getComputedStyle(menu).boxShadow.slice(0,60)}:null;
  info.menuItem=item?{h:Math.round(item.getBoundingClientRect().height),padding:getComputedStyle(item).padding,color:getComputedStyle(item).color}:null;
  info.menuItemCount=document.querySelectorAll('.menu-item').length;
}else if(state==='filetree-menu'){
  // 文件树文件右键菜单（1.14 分节：open/action/info.copy/system/danger）
  const titleEl=document.querySelector('.nav-file-title[data-path="'+f.path+'"]');
  check(!!titleEl,'文件树文件行存在');
  const r=titleEl.getBoundingClientRect();
  titleEl.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:r.left+8,clientY:r.top+8}));
  await wait(250);
  const menu=document.querySelector('.menu');
  check(!!menu,'文件树右键菜单已开');
  const items=[...document.querySelectorAll('.menu-item-title')].map(el=>el.textContent);
  info.menuTitles=items;
  info.menuSeparators=document.querySelectorAll('.menu-separator').length;
  info.menu=menu?{w:Math.round(menu.getBoundingClientRect().width),bg:getComputedStyle(menu).backgroundColor}:null;
}else if(state==='graph'){
  const leaf=app.workspace.getLeaf(true);
  await leaf.setViewState({type:'graph',state:{}});
  await wait(900);
  const canvas=document.querySelector('.graph-view-container .graph-canvas')||document.querySelector('canvas');
  info.graph={canvas:!!canvas,nodeCount:document.querySelectorAll('.graph-controls').length};
  check(!!canvas,'图谱画布存在');
}else if(state==='search'){
  app.commands.executeCommandById('global-search:open');
  await wait(200);
  const input=document.querySelector('.search-input');
  check(!!input,'搜索输入框存在');
  input.value='标题';
  input.dispatchEvent(new Event('input',{bubbles:true}));
  await wait(500);
  info.resultCount=document.querySelectorAll('.search-result-container .search-result').length;
  const first=document.querySelector('.search-result');
  info.first=first?{h:Math.round(first.getBoundingClientRect().height),bg:getComputedStyle(first).backgroundColor}:null;
}else if(state==='notice'){
  // 标签栏 + 文件树 + 通知同屏：检查 1.14.4 的右上角滑入与单层阴影
  const second=await app.vault.create('第二个标签.md','# 第二个标签\n');
  await app.workspace.openFile(second,{newLeaf:'tab'});
  await wait(260);
  new Notice('已创建 3 个文件',0);
  await wait(220);
  const noticeEl=document.querySelector('.notice');
  check(!!noticeEl,'通知已显示');
  const ns=getComputedStyle(noticeEl);
  info.notice={padding:ns.padding,radius:ns.borderRadius,shadow:ns.boxShadow.slice(0,80),transition:ns.transition};
  info.noticeTabs=document.querySelectorAll('.mod-root .workspace-tab-header').length;
}

console.log('PROBE-UI '+JSON.stringify(info));
return {pass:true,checks};
})()
