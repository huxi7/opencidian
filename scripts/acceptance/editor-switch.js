/**
 * [INPUT]: 独立临时 vault、编辑器和文件视图。
 * [OUTPUT]: 返回切换保存与删除后复用视图的断言。
 * [POS]: 编辑器文件生命周期回归；通过运行器隔离执行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
  const a=await app.vault.create('Switch-A.md','# A');
  const b=await app.vault.create('Switch-B.md','# B');
  await app.workspace.openFile(a);
  const view=app.workspace.activeLeaf.view;
  view.editor.setValue('# Unsaved before switching');
  await app.workspace.openFile(b);
  if(await app.vault.read(a)!=='# Unsaved before switching')throw Error('switch lost pending edit');
  await app.vault.delete(b,true);
  await app.workspace.openFile(a);
  if(!view.editor.cm.dom.isConnected||view.file.path!==a.path)throw Error('deleted view failed to recover');
  return {pass:true,count:2,checks:['switch flushes pending edit','deleted view reused']};
})()
