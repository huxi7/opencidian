/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例；OBS_RECOVERY_PHASE 区分 run/restart。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: community 场景。run 阶段植入 test-plugin 夹具，验证信任模态、受限布局、安全模式守卫与 setEnable 装卸语义；restart 阶段验证已启用状态下的自动加载。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const wait=ms=>new Promise(r=>setTimeout(r,ms));const ok=(b,m)=>{if(!b)throw Error(m)};
const fsc=require('fs');const pth=require('path');
const phase=process.env.OBS_RECOVERY_PHASE||'run';
const plugins=app.plugins;
const trustModal=()=>{const el=document.querySelector('.modal.mod-trust-folder');return el&&!el.classList.contains('is-hidden')?el:null};
const key=plugins.enabledKey();
let count=0;const check=(b,m)=>{count++;ok(b,m)};

if(phase==='restart'){
  check(!trustModal(),'restart: 已表态的库不再弹信任模态');
  check(localStorage.getItem(key)==='true','restart: 安全模式键保持 true');
  check(!!app.commands.commands['test-plugin:hello'],'restart: 插件命令自动加载');
  return {pass:true,count};
}

/* run 阶段：植入最小社区插件夹具（启动时库内无插件，这里模拟"库自带插件"） */
const dir=pth.join(app.settings.dir,'plugins','test-plugin');
fsc.mkdirSync(dir,{recursive:true});
fsc.writeFileSync(pth.join(dir,'manifest.json'),JSON.stringify({id:'test-plugin',name:'Acceptance Plugin',version:'1.0.0',author:'OpenSidian QA',description:'acceptance fixture'}));
fsc.writeFileSync(pth.join(dir,'main.js'),"const { Plugin } = require('obsidian');\nmodule.exports = class extends Plugin {\n  async onload() { this.addCommand({ id: 'hello', name: 'Hello from acceptance plugin', callback() {} }); }\n};\n");
app.settings.setCommunityPlugins(['test-plugin']);
localStorage.removeItem(key);
for(const id of Object.keys(plugins.plugins)) await plugins.unloadCommunityPlugin(id);
await plugins.loadCommunityPlugins();
await wait(80);
check(!!trustModal(),'库内已有插件且从未表态：弹出信任模态');
check(document.querySelectorAll('.modal.mod-trust-folder .modal-button-container button').length===2,'信任模态两个按钮');

const restrictedBtn=[...document.querySelectorAll('.modal.mod-trust-folder button')].find(b=>/Restricted Mode|安全模式|受限/.test(b.textContent||''));
check(!!restrictedBtn,'存在"Browse vault in Restricted Mode"按钮');
restrictedBtn.click();await wait(120);
check(!trustModal(),'信任模态已关闭');
check(localStorage.getItem(key)==='false','选择受限模式写入 localStorage=false');

const restrictedContent=[...document.querySelectorAll('.vertical-tab-content')].find(el=>el.querySelector('.community-plugins-disclaimer'));
check(!!restrictedContent,'受限布局含 community-plugins-disclaimer');
check(restrictedContent.querySelectorAll('.setting-item').length>=4,'免责说明四行');
check(!!restrictedContent.querySelector('.community-modal-button-container button.mod-cta'),'受限布局含启用社区插件 CTA');
check(!restrictedContent.querySelector('.checkbox-container'),'受限布局不显示已装插件开关');

const denied=await plugins.enableCommunityPlugin('test-plugin');
check(denied===false,'安全模式守卫：enableCommunityPlugin 返回 false');

restrictedContent.querySelector('.community-modal-button-container button.mod-cta').click();await wait(180);
check(localStorage.getItem(key)==='true','CTA 启用写入 localStorage=true');
check(!!plugins.plugins['test-plugin'],'插件实例已加载');
check(!!app.commands.commands['test-plugin:hello'],'插件命令已注册');
const enabledContent=[...document.querySelectorAll('.vertical-tab-content')].find(el=>el.querySelector('.installed-plugins-container'));
check(!!enabledContent,'启用布局出现已装插件容器');
const toggleEl=enabledContent.querySelector('.installed-plugins-container .setting-item .checkbox-container');
check(!!toggleEl&&toggleEl.classList.contains('is-enabled'),'插件开关处于开启态');

await plugins.setEnable(false);
check(!plugins.plugins['test-plugin'],'setEnable(false) 卸载插件');
check(!app.commands.commands['test-plugin:hello'],'卸载后命令被撤销');
const config=app.settings.readJson('community-plugins.json');
check(Array.isArray(config)&&config.includes('test-plugin'),'关闭安全模式不丢 community-plugins.json');

await plugins.setEnable(true);
check(!!plugins.plugins['test-plugin'],'再次启用恢复加载');
if(app.setting&&app.setting.close)app.setting.close();
await app.saveLayout();
return {pass:true,count};
})()
