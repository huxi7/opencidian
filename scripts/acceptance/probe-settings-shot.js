/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 打开设置→关于页并保持，供截图对照（console.log PROBE-SETTINGS-SHOT）。
 * [POS]: 诊断探针（非断言锁）。用于和原版 1.14.4 设置窗口做视觉对照。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.setting.open();
await wait(400);
const tabId=(typeof process!=='undefined'&&process.env&&process.env.OBS_SIDEBAR_VIEW)||'about';
app.setting.openTabById(tabId);
await wait(400);
const aboutLines=[...document.querySelectorAll('.vertical-tab-content-container .setting-item-name, .vertical-tab-content-container .setting-item-description')].slice(0,4).map(e=>e.textContent.trim());
console.log('PROBE-SETTINGS-SHOT '+JSON.stringify({aboutLines,tabs:[...document.querySelectorAll('.vertical-tab-header-group-title')].map(e=>e.textContent.trim()),navs:[...document.querySelectorAll('.vertical-tab-nav-item')].map(e=>e.textContent.trim())}));
await app.saveLayout();
return {pass:true,count:0,checks:[]};
})()
