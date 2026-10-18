/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回切文件竞态断言；失败抛出异常，供运行器判定。
 * [POS]: editor-race 场景。用挂起的 cachedRead 确定性复现"迟到回声打进另一个文件"的跨文件内容损坏，并钉住防线。
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
return {pass:true,checks};
})()
