/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回检查更新断言；失败抛出异常，供运行器判定。
 * [POS]: update-check 场景。stub requestUrl 零真实网络：新版本提示 + 下载按钮、已最新、失败、未配置更新源（不联网）。
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
app.requestUrl=async (opts)=>{ calls+=1; if(typeof nextResponse==='function') return nextResponse(opts); return nextResponse; };

try {
  // 1) 未配置更新源：不联网 + 提示
  app.settings.updateAppSettings({ updateFeed: '', checkUpdates: true });
  calls=0; clearNotices();
  app.commands.executeCommandById('app:check-updates');
  await until(()=>notices().includes('更新源')||notices().includes('updateFeed'),'未配置提示',2500);
  check(calls===0,'未配置更新源时不发起请求');

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
} finally {
  app.requestUrl=origRequestUrl;
  app.settings.updateAppSettings({ updateFeed: '' });
  clearNotices();
}
return {pass:true,checks};
})()
