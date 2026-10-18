/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回块 widget"编辑此区块"按钮断言；失败抛出异常，供运行器判定。
 * [POS]: editor-block-button 场景。覆盖代码块/数学块/ Mermaid 的 edit-block-button（默认隐藏、点击把光标放回源码）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const checks=[];
const check=(ok,msg)=>{if(!ok)throw Error('✗ '+msg);checks.push(msg);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));

const body='# T\n\n```js\nconst a = 1;\n```\n\n$$x = 1$$\n\n正文\n';
const file=await app.vault.create('BlockBtn-'+Date.now()+'.md',body);
await app.workspace.openFile(file);
const view=app.workspace.activeLeaf.view;
await wait(250);

// 光标放到文末，让块 widget 全部渲染
view.editor.setCursor({line:8,ch:0});
await wait(200);

const pre=view.editor.cm.contentDOM.querySelector('.lp-codeblock');
check(!!pre,'代码块 widget 渲染');
const btn=pre.querySelector('.edit-block-button');
check(!!btn,'代码块含 edit-block-button');
check(getComputedStyle(btn).opacity==='0','按钮默认隐藏（悬停显形）');
check(!!btn.getAttr('aria-label'),'按钮带 aria-label');
btn.click();
await wait(150);
const cursor=view.editor.getCursor();
check(cursor.line===2||cursor.line===3,'点击后光标落在代码块源码内（line='+cursor.line+'）');
check(!view.editor.cm.contentDOM.querySelector('.lp-codeblock'),'源码展开，widget 让位');

// 数学块
view.editor.setCursor({line:8,ch:0});
await wait(200);
const math=view.editor.cm.contentDOM.querySelector('.math-block');
check(!!math,'数学块 widget 渲染');
const mbtn=math&&math.querySelector('.edit-block-button');
check(!!mbtn,'数学块含 edit-block-button');
mbtn.click();
await wait(150);
check(view.editor.getCursor().line===6,'点击后光标落在数学块源码行');

// Mermaid
view.editor.setValue('# T\n\n```mermaid\ngraph TD; A-->B;\n```\n\n尾\n');
view.editor.setCursor({line:6,ch:0});
await wait(350);
const mer=view.editor.cm.contentDOM.querySelector('.cm-lp-mermaid');
check(!!mer,'Mermaid widget 渲染');
check(!!(mer&&mer.querySelector('.edit-block-button')),'Mermaid 含 edit-block-button');
return {pass:true,checks};
})()
