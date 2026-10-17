/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: math 场景。仅由 run.mjs 在带标记的临时库执行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const delay=ms=>new Promise(r=>setTimeout(r,ms));const ok=(b,m)=>{if(!b)throw Error(m)};
const text="# 数学验收\n\n行内 $e^{i\\pi}+1=0$。\n\n$$\n\\begin{aligned}\na &= \\frac{1}{2} \\\\\nb &= \\sqrt{x}\n\\end{aligned}\n$$\n\n$$\n\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}\n$$\n\n错误 $\\frac{$。\n\n安全 $\\href{javascript:alert(1)}{链接}$。\n\n$$\n\\require{definitelymissing}x\n$$\n\n正常 $x^2+y^2=z^2$。\n\n# 结束\n";
const f=await app.vault.create('Math-complete-'+Date.now()+'.md',text);await app.workspace.openFile(f);const v=app.workspace.activeLeaf.view;await v.setState({file:f.path,mode:'preview'});
for(let i=0;i<150&&(!v.readingEl.querySelector('mjx-container')||v.readingEl.querySelectorAll('.math-error').length<2);i++)await delay(100);
ok(window.MathJax.version==='3.2.2','runtime version');ok(v.readingEl.querySelectorAll('.math-block mjx-container').length===2,'aligned and matrix');ok(v.readingEl.querySelectorAll('.math-error').length===2,'malformed and unknown extension isolated');ok(!v.readingEl.querySelector('a[href^="javascript:"]'),'unsafe link removed');ok(v.readingEl.querySelectorAll('mjx-container').length>=5,'valid formulas survive errors');
await document.fonts.ready;ok([...document.fonts].some(f=>f.family.includes('MJX')&&f.status==='loaded'),'local math fonts loaded');
const scripts=[...document.scripts].filter(s=>s.src.includes('mathjax/'));ok(scripts.every(s=>s.src.startsWith('app://obsidian.md/assets/mathjax/')),'offline assets only');
await v.setState({file:f.path,mode:'live'});v.editor.setSelection(text.length);await delay(400);ok(v.editor.cm.dom.querySelector('.math-block mjx-container'),'live CHTML');
await v.setState({file:f.path,mode:'preview'});await delay(200);return {pass:true,version:window.MathJax.version,formulas:v.readingEl.querySelectorAll('mjx-container').length,errors:2,fonts:true,offline:true,file:f.path};
})()
