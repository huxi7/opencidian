/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: folding-disabled 场景。仅由 run.mjs 在带标记的临时库执行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const wait=ms=>new Promise(r=>setTimeout(r,ms));const f=await app.vault.create('Fold-disabled-'+Date.now()+'.md','```javascript\nfunction test() {\n  return 1;\n}\n```\n');await app.workspace.openFile(f);const v=app.workspace.activeLeaf.view;await v.setState({file:f.path,mode:'source'});app.settings.updateAppSettings({foldHeading:false,foldIndent:false});await wait(500);v.editor.setSelection({line:1,ch:0});app.commands.executeCommandById('editor:fold-more');app.commands.executeCommandById('editor:fold-all');await wait(100);if(v.editor.cm.dom.querySelector('.cm-foldPlaceholder'))throw Error('disabled fold syntax fallback');app.settings.updateAppSettings({foldHeading:true,foldIndent:true});return {pass:true,count:1,checks:['disabled fold syntax fallback']};})()
