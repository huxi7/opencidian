/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回检查更新断言；失败抛出异常，供运行器判定。
 * [POS]: 更新检查真实界面。网络替身验证默认源、GitHub 下载页、单次通知、开关与失败提示。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const checks=[];
const check=(ok,msg)=>{if(!ok)throw Error('✗ '+msg);checks.push(msg);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,msg,timeout=4000)=>{const t0=Date.now();while(Date.now()-t0<timeout){if(fn())return;await wait(50);}throw Error('✗ timeout: '+msg);};
const notices=()=>[...document.querySelectorAll('.notice-message')].map((e)=>e.textContent).join(' | ');
const clearNotices=()=>{document.querySelectorAll('.notice').forEach((e)=>e.remove());};

check(!!app.commands.commands['app:check-updates'],'命令 app:check-updates 已注册');

// stub：记录调用并返回可编程响应
let calls=0;
let nextResponse=null;
const origRequestUrl=app.requestUrl;
const origVersion=app.getVersion;
const origSettings={ updateFeed: app.settings.appSettings.updateFeed, checkUpdates: app.settings.appSettings.checkUpdates };
const origDisabled=localStorage.getItem('disable-update');
app.getVersion=()=> '1.0.0';
app.requestUrl=async (opts)=>{ calls+=1; if(typeof nextResponse==='function') return nextResponse(opts); return nextResponse; };

try {
  // 1) 空配置回退本仓库，无需向库配置写入地址。
  app.settings.updateAppSettings({ updateFeed: '', checkUpdates: true });
  nextResponse=async(opts)=>{
    check(opts.url==='https://api.github.com/repos/huxi7/opencidian/releases/latest','默认请求本仓库更新源');
    return {status:200,body:JSON.stringify({tag_name:'v1.0.0',url:'https://api.github.com/repos/huxi7/opencidian/releases/1',html_url:'https://github.com/huxi7/opencidian/releases/tag/v1.0.0'})};
  };
  calls=0; clearNotices();
  app.commands.executeCommandById('app:check-updates');
  await until(()=>notices().includes('最新'),'默认更新源完成检查',2500);
  check(calls===1,'空配置仍可手动检查');
  check(app.settings.appSettings.updateFeed==='','默认源不写入用户库');

  // 2) 新版本：提示 + 下载按钮
  app.settings.updateAppSettings({ updateFeed: 'https://example.com/feed.json' });
  nextResponse={ status:200, headers:{'content-type':'application/json'},
    body: new TextEncoder().encode(JSON.stringify({ tag_name:'v99.9.9', html_url:'https://example.com/release' })).buffer };
  calls=0; clearNotices();
  app.commands.executeCommandById('app:check-updates');
  await until(()=>notices().includes('99.9.9'),'新版本提示',2500);
  check(calls===1,'新版本检查发起一次请求');
  check(!!document.querySelector('.notice-button-container'),'新版本提示带下载按钮');

  // 3) 已是最新
  nextResponse={ status:200, headers:{'content-type':'application/json'},
    body: new TextEncoder().encode(JSON.stringify({ version:'0.0.1', url:'https://example.com' })).buffer };
  clearNotices();
  app.commands.executeCommandById('app:check-updates');
  await until(()=>notices().includes('最新')||notices().includes('latest'),'已最新提示',2500);
  check(!document.querySelector('.notice-button-container'),'已最新时无下载按钮');

  // 4) 失败（error 响应）
  nextResponse={ error:'network down' };
  clearNotices();
  app.commands.executeCommandById('app:check-updates');
  await until(()=>notices().includes('无法检查更新')||notices().includes('check'),'失败提示',2500);
  check(true,'失败时给出提示');

  // 5) 静态 JSON {version,url} 也支持
  nextResponse={ status:200, headers:{}, body: new TextEncoder().encode(JSON.stringify({ version:'99.9.9', url:'https://example.com/dl' })).buffer };
  clearNotices();
  app.commands.executeCommandById('app:check-updates');
  await until(()=>notices().includes('99.9.9'),'静态 JSON 解析',2500);
  check(true,'静态 JSON 更新源可解析');

  // 6) 关于页开关、下载目标和单次通知。
  localStorage.removeItem('disable-update');
  app.setting.open(); app.setting.openTabById('about');
  const tab=app.setting.activeTab;
  const row=[...tab.containerEl.querySelectorAll('.setting-item')].find(el=>/自动检查更新/.test(el.querySelector('.setting-item-name')?.textContent||''));
  check(!!row,'关于页明确显示自动检查更新');
  check(row.textContent.includes('不会自动安装'),'关于页不承诺自动安装');
  const toggle=row.querySelector('.checkbox-container');
  toggle.click();
  check(app.settings.appSettings.checkUpdates===false&&localStorage.getItem('disable-update')==='1','关闭开关同步配置与旧本机偏好');
  toggle.click();
  check(app.settings.appSettings.checkUpdates===true&&localStorage.getItem('disable-update')===null,'开启开关同步恢复检查');
  nextResponse={status:200,body:JSON.stringify({tag_name:'v99.9.9',url:'https://api.github.com/repos/huxi7/opencidian/releases/2',html_url:'https://github.com/huxi7/opencidian/releases/tag/v99.9.9'})};
  clearNotices();
  const result=await tab.runUpdateCheck();
  check(result.hasUpdate&&result.url==='https://github.com/huxi7/opencidian/releases/tag/v99.9.9','关于页解析真实 GitHub 响应字段');
  check(document.querySelectorAll('.notice').length===1,'关于页发现新版只显示一条通知');
  check([...tab.containerEl.querySelectorAll('a')].filter(a=>a.href==='https://github.com/huxi7/opencidian/releases').length===2,'更新日志与更新说明均指向本仓库');
  app.setting.close();
} finally {
  app.requestUrl=origRequestUrl;
  app.getVersion=origVersion;
  app.settings.updateAppSettings(origSettings);
  if(origDisabled===null)localStorage.removeItem('disable-update');else localStorage.setItem('disable-update',origDisabled);
  clearNotices();
}
return {pass:true,count:checks.length,checks};
})()
