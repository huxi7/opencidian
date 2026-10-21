/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例；--screen light|dark 切换主题（OBS_SIDEBAR_VIEW）；OBS_SCREENSHOT 目录用于设置窗口截图。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: settings-window 场景。锁 1.14.4 设置独立窗口：默认配置、窗口/标题/尺寸/最小尺寸、单实例复用、内容铺满、关闭再开、页签接力（外观页 + 独立“界面”页签的「在新窗口中打开设置」开关）、开关切换回退模态（含窗口内点击开关的真实发送方路径）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const ok=(b,m)=>{if(!b)throw Error(m)};
const checks=[];
const fs=require('fs');const path=require('path');
const {ipcRenderer}=require('electron');
const info=()=>ipcRenderer.sendSync('settings-window-info');
const probe=()=>ipcRenderer.invoke('settings-window-probe');
const waitFor=async(fn,ms=15000,step=250)=>{const t0=Date.now();for(;;){let v=null;try{v=await Promise.race([fn(),wait(step*2).then(()=>null)])}catch(e){v=null}if(v)return v;if(Date.now()-t0>ms)return null;await wait(step)}};
const escapeRe=(s)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

// 主题：--screen light|dark（与 probe-ui 共用 OBS_SIDEBAR_VIEW）
const theme=(process.env.OBS_SIDEBAR_VIEW==='dark')?'obsidian':'moonstone';
app.settings.updateAppearance({theme});
await wait(250);

// 1) 默认配置：settingsPopoutWindow 默认 true
ok(app.settings.appSettings.settingsPopoutWindow!==false,'settingsPopoutWindow 默认 true');
checks.push('default settingsPopoutWindow=true');

// 2) 开窗（E2E 单窗口断言下需显式打开 popout 路径）
window.__SETTINGS_POPOUT_FORCE__=true;
app.setting.open();
const ready=await waitFor(async()=>{const p=await probe();return p&&p.open&&p.navItems>=5?p:null});
ok(ready,'设置独立窗口渲染导航项（probe='+JSON.stringify(ready)+'）');
checks.push('window opens with content');

// 3) 标题格式：设置 - {库名} - {应用名 版本}
const opened=info();
ok(opened.open===true,'settingsWindowInfo.open');
const vaultName=app.vault.getName();
const version=ipcRenderer.sendSync('version');
const titleRe=new RegExp('^(设置|Settings) - '+escapeRe(vaultName)+' - OpenSidian '+escapeRe(version)+'$');
ok(titleRe.test(ready.title),'标题格式期望 "'+titleRe+'" 实际 "'+ready.title+'"');
ok(ready.title!==document.title,'设置窗口是独立文档');
checks.push('title format: '+ready.title);

// 4) 尺寸 900x700 / min 600x400
ok(Math.abs(opened.bounds.width-900)<=2&&Math.abs(opened.bounds.height-700)<=2,'窗口 900x700 实际 '+opened.bounds.width+'x'+opened.bounds.height);
ok(opened.minSize&&opened.minSize[0]===600&&opened.minSize[1]===400,'min 600x400 实际 '+JSON.stringify(opened.minSize));
checks.push('size 900x700 min 600x400');

// 4.1) macOS 红绿灯：popout offset 32px + zoom 1 → (10,8)，不能沿用主窗 (14,12)
if (process.platform==='darwin' && opened.buttonPosition) {
  ok(Math.abs(opened.buttonPosition.x-10)<=1&&Math.abs(opened.buttonPosition.y-8)<=1,
    '设置窗口红绿灯位置 (10,8) 实际 '+JSON.stringify(opened.buttonPosition));
  checks.push('traffic lights popout (10,8)');
}

// 5) 窗口内容铺满：body.is-popout-modal + modal 直挂 body + 关闭按钮隐藏
ok(ready.isPopoutBody===true,'body.is-popout-modal');
ok(ready.isSettingsWindow===true,'body.is-settings-window');
ok(ready.hasSettingsModal===true,'modal.mod-settings 已挂载');
ok(ready.closeButtonDisplay==='none','popout 隐藏 modal-close-button');
ok(ready.titlebarDisplay==='flex','无边框模式：应用自绘标题条可见');
ok(!ready.titlebarAppRegion||/drag/.test(ready.titlebarAppRegion),'标题条是拖拽区（app-region）');
ok(ready.titlebarRect&&ready.titlebarRect.height>0,'标题条有高度 '+JSON.stringify(ready.titlebarRect));
ok((ready.modalContainerTop===null?ready.modalRect.top:ready.modalContainerTop)>=ready.titlebarRect.height-1,'设置模态让出标题条高度 '+JSON.stringify({container:ready.modalContainerTop,modal:ready.modalRect,pad:ready.bodyPaddingTop,bar:ready.titlebarRect}));
ok(ready.titlebarText===ready.title,'标题条文本镜像窗口标题：'+ready.titlebarText);
checks.push('window content fills viewport');

// 6) 主窗口不渲染模态（设置已迁到独立窗口）
ok(!document.querySelector('.modal-container .modal.mod-settings'),'主窗口无设置模态');
checks.push('no settings modal in main window');

// 7) 单实例：再次 open 复用同一窗口（几何不变）
const before=info();
app.setting.open();await wait(200);
const after=info();
ok(after.open===true,'重复 open 后窗口仍开');
ok(after.bounds.x===before.bounds.x&&after.bounds.y===before.bounds.y&&after.bounds.width===before.bounds.width,'重复 open 复用窗口（几何不变）');
const fresh=await probe();
ok(fresh.navItems>=5,'复用窗口内容仍在');
checks.push('single instance reuse');

// 7.5) 页签接力：主窗口 openTabById → 设置窗口切到外观页（截图前切页）
app.setting.openTabById('appearance');
const onAppearance=await waitFor(async()=>{const p=await probe();return p&&p.activeTab&&/外观|Appearance/.test(p.activeTab)?p:null},6000,200);
ok(onAppearance,'主窗口 openTabById 接力到设置窗口外观页（activeTab='+((onAppearance&&onAppearance.activeTab)||'null')+'）');
checks.push('tab relay');
// 原版 1.14.4：「在新窗口中打开设置」在独立的“界面”页签，不在外观页
app.setting.openTabById('interface');
const onInterface=await waitFor(async()=>{const p=await probe();return p&&p.activeTab&&/界面|Interface/.test(p.activeTab)?p:null},6000,200);
ok(onInterface,'主窗口 openTabById 接力到设置窗口界面页（activeTab='+((onInterface&&onInterface.activeTab)||'null')+'）');
ok(!!onInterface&&onInterface.popoutToggle===true,'界面页存在「在新窗口中打开设置」开关');
checks.push('interface tab + popout toggle row');
app.setting.openTabById('appearance');
await waitFor(async()=>{const p=await probe();return p&&p.activeTab&&/外观|Appearance/.test(p.activeTab)?p:null},6000,200);

// 8) 截图（浅/深各一张）
const shot=process.env.OBS_SCREENSHOT;
if(shot){
  const file=path.join(path.dirname(shot),'settings-window-'+(theme==='moonstone'?'light':'dark')+'.png');
  const cap=await ipcRenderer.invoke('settings-window-capture',file);
  ok(cap.ok===true,'设置窗口截图写入 '+JSON.stringify(cap));
  await wait(150);
  checks.push('screenshot '+cap.path);
}

// 9) 关闭再开：新窗口
ipcRenderer.sendSync('settings-window-close');
const gone=await waitFor(async()=>{const p=await probe();return p&&p.open?null:'gone'},3000,200);
ok(gone==='gone','关闭后探针不可用');
ok(info().open===false,'关闭后 info.open=false');
app.setting.open();
const again=await waitFor(async()=>{const p=await probe();return p&&p.open&&p.navItems>=5?p:null});
ok(again,'关闭后可重开');
checks.push('close + reopen');

// 10) 开关关闭 → 回退应用内模态
window.__SETTINGS_POPOUT_FORCE__=false;
app.settings.updateAppSettings({settingsPopoutWindow:false});
ipcRenderer.sendSync('settings-window-close');await wait(400);
ok(info().open===false,'切回模态后窗口关闭');
app.setting.open();await wait(400);
const modal=document.querySelector('.modal-container .modal.mod-settings');
ok(modal,'回退：主窗口渲染设置模态');
checks.push('toggle off → in-app modal fallback');

// 11) mod-dim 大阴影 + 遮罩 cover 色（回退路径受益）
const container=modal.closest('.modal-container');
ok(container.classList.contains('mod-dim'),'modal-container.mod-dim');
const shadow=getComputedStyle(modal).boxShadow;
ok(shadow&&shadow!=='none','模态 box-shadow 非 none');
const bgEl=container.querySelector('.modal-bg');
const bg=getComputedStyle(bgEl);
ok(/rgba?\((220, 220, 220|10, 10, 10), 0\.4\)/.test(bg.backgroundColor),'modal-bg cover 色 实际 '+bg.backgroundColor);
ok(Math.abs(parseFloat(bg.opacity)-0.85)<0.02,'遮罩 opacity 0.85 实际 '+bg.opacity);
checks.push('mod-dim shadow + cover backdrop');

// 12) ESC 关闭应用内模态
document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
await wait(300);
ok(!document.querySelector('.modal-container .modal.mod-settings'),'ESC 关闭模态');
checks.push('ESC closes in-app modal');

// 13) 开关打开 → 回独立窗口
window.__SETTINGS_POPOUT_FORCE__=true;
app.settings.updateAppSettings({settingsPopoutWindow:true});
app.setting.open();
const back=await waitFor(async()=>{const p=await probe();return p&&p.open&&p.navItems>=5?p:null});
ok(back,'开关打开后回到独立窗口');
ok(!document.querySelector('.modal-container .modal.mod-settings'),'窗口模式下主窗口无模态');
checks.push('toggle on → window mode restored');

// 14) 开关切换（真实 IPC 路径）：先写配置 false（与视图 toggle handler 一致）→ 关闭设置窗口，并在主窗口以模态重开到同一页签
app.settings.updateAppSettings({settingsPopoutWindow:false});
ipcRenderer.sendSync('settings-window-toggle',{tabId:'appearance'});
await wait(700);
ok(info().open===false,'切换开关后设置窗口关闭');
const modal2=await waitFor(()=>document.querySelector('.modal-container .modal.mod-settings')?true:null,6000);
ok(modal2,'切换开关后主窗口以模态重开');
ok(app.setting.activeTab&&app.setting.activeTab.id==='appearance','模态重开到外观页');
app.setting.close();await wait(250);
checks.push('toggle IPC → in-app modal with tab relay');

// 15) 窗口边框跟随配置：native → 原生标题栏（OS 绘制，标题即窗口标题）
ipcRenderer.sendSync('frame','native');
app.settings.updateAppSettings({settingsPopoutWindow:true});
window.__SETTINGS_POPOUT_FORCE__=true;
app.setting.open();
const nativeReady=await waitFor(async()=>{const p=await probe();return p&&p.open&&p.navItems>=5?p:null});
ok(nativeReady,'native 边框：窗口打开');
const nativeInfo=info();
ok(nativeInfo.isNativeFrame===true,'native 边框：isNativeFrame');
ok(nativeInfo.frame==='native','native 边框：info.frame');
ok(nativeReady.titlebarDisplay==='none','native 边框：应用标题条隐藏');
ok(titleRe.test(nativeReady.title),'native 边框：标题格式不变 '+nativeReady.title);
ipcRenderer.sendSync('frame','hidden');
ipcRenderer.sendSync('settings-window-close');await wait(300);
checks.push('window frame follows config (native)');

// 16) 设置窗口内点击开关（真实发送方路径）：窗口在自身 sendSync 期间关闭不死锁，主窗口模态接力页签
window.__SETTINGS_POPOUT_FORCE__=true;
app.settings.updateAppSettings({settingsPopoutWindow:true});
app.setting.openTabById('interface');
const toggleReady=await waitFor(async()=>{const p=await probe();return p&&p.open&&p.popoutToggle?p:null});
ok(toggleReady,'开关场景：窗口打开并定位开关行');
const clickResult=await ipcRenderer.invoke('settings-window-probe',{action:'toggle-off'});
ok(clickResult==='clicked','设置窗口内点击开关: '+JSON.stringify(clickResult));
ok(await waitFor(()=>{return info().open?null:true},6000),'点击后设置窗口关闭（sendSync 不死锁）');
ok(await waitFor(()=>document.querySelector('.modal-container .modal.mod-settings')?true:null,6000),'主窗口以模态重开');
ok(app.setting.activeTab&&app.setting.activeTab.id==='interface','模态接力到界面页');
ok(app.settings.appSettings.settingsPopoutWindow===false,'主窗口缓存同步为 false');
app.setting.close();await wait(250);
checks.push('in-window toggle click → modal');

return {pass:true,checks};
})()
