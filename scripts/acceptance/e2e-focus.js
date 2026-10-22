/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例（run.mjs 已设 E2E=1）。
 * [OUTPUT]: 返回"测试窗口不夺焦点且功能照常"断言；失败抛出异常，供运行器判定。
 * [POS]: e2e-focus 场景。钉住 E2E 呈现层：窗口从不激活应用（document.hasFocus=false），渲染/编辑/命令仍工作。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const checks=[];
const check=(ok,msg)=>{if(!ok)throw Error('✗ '+msg);checks.push(msg);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));

check(!!document.querySelector('.workspace'),'工作区已渲染（未聚焦状态下）');
check(document.hasFocus()===false,'测试窗口未夺取系统焦点');

const file=await app.vault.create('Focus-Probe-'+Date.now()+'.md','# F\n\nhello\n');
await app.workspace.openFile(file);
const view=app.workspace.activeLeaf.view;
await wait(200);
check(!!view.file&&view.file.path===file.path,'未聚焦状态下打开文件');
view.editor.setSelection({line:2,ch:0},{line:2,ch:5});
app.commands.executeCommandById('editor:toggle-bold');
await wait(100);
check(view.editor.getValue().includes('**hello**'),'未聚焦状态下编辑命令生效');

// 窗口状态类不应被误标为聚焦
check(!document.body.classList.contains('is-focused'),'未聚焦时 body 不带 is-focused');
check(document.hasFocus()===false,'全流程结束后仍未夺取焦点');
return {pass:true,count:checks.length,checks};
})()
