/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回切文件竞态与撤销栈边界断言；失败抛出异常，供运行器判定。
 * [POS]: editor-race 场景。用挂起的 cachedRead 复现"迟到回声打进另一个文件"的跨文件内容损坏；并钉住撤销栈不跨文档边界（装载的 setValue 不得入历史，否则打开即撤消会清空文档并落盘）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const checks=[];
const check=(ok,msg)=>{if(!ok)throw Error('✗ '+msg);checks.push(msg);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));

const A=await app.vault.create('Race-A-'+Date.now()+'.md','# A\n\nAAA\n');
const B=await app.vault.create('Race-B-'+Date.now()+'.md','# B\n\nBBB\n');
await app.workspace.openFile(A);
const view=app.workspace.activeLeaf.view;
await wait(200);

// 弄脏 A（未保存）
view.editor.setValue('# A\n\nAAA dirty\n');
check(view.editor.getValue().includes('dirty'),'A 脏文档已就绪');

// 拦截 cachedRead：A 的所有读取先挂起（视图回声 + 元数据解析），统一定时放行
const origRead=app.vault.cachedRead.bind(app.vault);
let released=false;
let held=0;
const pending=[];
app.vault.cachedRead=(f)=>{
  const p=f&&f.path;
  if(p===A.path&&!released){
    held+=1;
    return new Promise((resolve)=>{
      pending.push(async()=>resolve(await origRead(f)));
    });
  }
  return origRead(f);
};
const releaseAll=async()=>{
  released=true;
  for(const fn of pending.splice(0)) await fn();
};

try {
  // 切到 B：内部 save(A) → modify(A) → _onExternalModify → cachedRead(A) 被挂起
  await view.setState({file:B.path});
  check(view.file&&view.file.path===B.path,'已切到 B');
  check(view.editor.getValue().includes('BBB'),'B 内容正确加载');
  check(held>=1,'A 的迟到读取被挂起（held='+held+'）');

  // 放行迟到读取：没有路径守卫时会把 A 的文本打进 B
  await releaseAll();
  await wait(300);

  check(view.file.path===B.path,'仍是 B 文件');
  check(!view.editor.getValue().includes('AAA'),'迟到内容未打进 B :: '+JSON.stringify(view.editor.getValue().slice(0,40)));
  check(view.editor.getValue().includes('BBB'),'B 编辑内容未被覆盖');

  const aText=await app.vault.read(A);
  check(aText.includes('dirty'),'A 的改动已保存回 A');
  const bText=await app.vault.read(B);
  check(bText.includes('BBB')&&!bText.includes('AAA'),'B 磁盘内容未被污染');
} finally {
  app.vault.cachedRead=origRead;
}
// ---------------------------------------------------------------------------
// 撤销栈不跨文档边界：setValue 装载不得把整文档替换压进历史。
// 缺陷现场：打开文档后一次撤消 = 撤消"装入"本身 → 空文档被自动保存写盘（数据丢失）。
// ---------------------------------------------------------------------------
const C=await app.vault.create('Race-C-'+Date.now()+'.md','# C\n\nCCC\n');
await app.workspace.openFile(C);
await wait(250);
const viewC=app.workspace.activeLeaf.view;
check(viewC.file&&viewC.file.path===C.path,'C 已打开');
check(viewC.editor.getValue().includes('CCC'),'C 内容已就绪');

viewC.editor.undo();
await wait(200);
check(viewC.editor.getValue().includes('CCC'),'打开后一次撤消不清空文档 :: '+JSON.stringify(viewC.editor.getValue().slice(0,40)));
await wait(250);
const cText=await app.vault.read(C);
check(cText.includes('CCC'),'C 未被自动保存写空 :: '+JSON.stringify(cText.slice(0,40)));

// 正常用户编辑历史仍可用（不得伤及撤销）
viewC.editor.replaceRange(' C-EDIT',{line:0,ch:0});
await wait(60);
check(viewC.editor.getValue().includes('C-EDIT'),'C 已产生用户编辑');
viewC.editor.undo();
await wait(120);
check(!viewC.editor.getValue().includes('C-EDIT'),'用户编辑可被正常撤消');

// 切文件后撤消不得把旧文件文本带进新文件
const D=await app.vault.create('Race-D-'+Date.now()+'.md','# D\n\nDDD\n');
viewC.editor.replaceRange(' C-DIRTY',{line:0,ch:0});
await wait(60);
await viewC.setState({file:D.path});
await wait(300);
check(viewC.file&&viewC.file.path===D.path,'已切到 D');
check(viewC.editor.getValue().includes('DDD'),'D 内容已就绪');
viewC.editor.undo();
await wait(250);
check(!viewC.editor.getValue().includes('C-DIRTY'),'撤消未把 C 的编辑带进 D :: '+JSON.stringify(viewC.editor.getValue().slice(0,40)));
check(viewC.editor.getValue().includes('DDD'),'D 内容保持完整');
const dText=await app.vault.read(D);
check(dText.includes('DDD')&&!dText.includes('C-DIRTY'),'D 磁盘内容未被污染');

return {pass:true,count:checks.length,checks};
})()
