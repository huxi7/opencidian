/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: appearance 场景：主题 (Legacy) 项、字体管理弹窗（指示/图标/拖拽手柄/持久化）、主题色恢复默认。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const wait=ms=>new Promise(r=>setTimeout(r,ms));const ok=(b,m)=>{if(!b)throw Error(m)};
let count=0;const check=(b,m)=>{count++;ok(b,m)};
const fsc=require('fs');const pth=require('path');
const rowByName=(root,re)=>[...root.querySelectorAll('.setting-item')].find((el)=>{
  const n=el.querySelector('.setting-item-name');return n&&re.test(n.textContent||'');});

// 预置主题目录：旧格式（obsidian.css）与新格式（theme.css）
const legacyDir=pth.join(app.settings.dir,'themes','LegacyAcceptanceTheme');
fsc.mkdirSync(legacyDir,{recursive:true});
fsc.writeFileSync(pth.join(legacyDir,'obsidian.css'),'/* legacy theme */');
const modernDir=pth.join(app.settings.dir,'themes','ModernAcceptanceTheme');
fsc.mkdirSync(modernDir,{recursive:true});
fsc.writeFileSync(pth.join(modernDir,'theme.css'),'/* modern theme */');

app.settings.updateAppearance({ accentColor: '#ff0000' });
app.setting.open();app.setting.openTabById('appearance');await wait(250);
const tab=app.setting.activeTab.containerEl;
check(!!tab&&tab.isConnected,'外观页打开');

const themeRow=rowByName(tab,/^主题$|^Themes$/);
check(!!themeRow,'主题行存在');
const opts=[...themeRow.querySelectorAll('option')].map((o)=>o.textContent);
check(opts.some((t)=>/LegacyAcceptanceTheme \(Legacy\)/.test(t)),'旧主题显示 (Legacy) 后缀');
check(opts.includes('ModernAcceptanceTheme'),'新主题正常显示');
check(!opts.some((t)=>/ModernAcceptanceTheme \(Legacy\)/.test(t)),'新主题不带 Legacy 后缀');

/* 字体管理弹窗 */
const fontRow=rowByName(tab,/界面字体|Interface font/);
check(!!fontRow,'界面字体行存在');
const manage=[...fontRow.querySelectorAll('button')].find((b)=>/管理|Manage/.test(b.textContent||''));
check(!!manage,'字体行有管理按钮');
manage.click();await wait(200);
const modal=[...document.querySelectorAll('.modal:not(.is-hidden)')].find((m)=>/字体名称|Font name/.test((m.querySelector('.modal-title')||{}).textContent||''));
check(!!modal,'字体管理弹窗打开');
const input=modal.querySelector('input');
input.value='AcceptanceFontXYZ';
input.dispatchEvent(new Event('input',{bubbles:true}));
[...modal.querySelectorAll('button')].find((b)=>/添加|Add/.test(b.textContent||'')).click();
await wait(150);
const item=[...modal.querySelectorAll('.font-manager-item')].find((el)=>/AcceptanceFontXYZ/.test(el.textContent||''));
check(!!item,'新字体进入列表');
check(!!item.querySelector('.font-manager-item-indicator.mod-warning'),'不存在的字体显示警示指示');
check(!!item.querySelector('.font-manager-drag-handle svg'),'行有拖拽手柄图标');
const delBtn=[...item.querySelectorAll('.clickable-icon')].pop();
check(!!delBtn.querySelector('svg'),'移除按钮带图标');
delBtn.click();await wait(100);
check(![...modal.querySelectorAll('.font-manager-item')].some((el)=>/AcceptanceFontXYZ/.test(el.textContent||'')),'移除后列表不含该字体');

/* 添加并保存 → 持久化 */
const input2=modal.querySelector('input');
input2.value='AcceptanceFontXYZ';
input2.dispatchEvent(new Event('input',{bubbles:true}));
[...modal.querySelectorAll('button')].find((b)=>/添加|Add/.test(b.textContent||'')).click();
await wait(100);
[...modal.querySelectorAll('button')].find((b)=>/保存|Save/.test(b.textContent||'')).click();
await wait(150);
check(/AcceptanceFontXYZ/.test(String(app.settings.appearance.interfaceFontFamily||'')),'字体写入 appearance.json');
app.settings.updateAppearance({ interfaceFontFamily: '' });

/* 主题色恢复默认 */
const accentRow=rowByName(tab,/主题色|Accent color/);
check(!!accentRow,'主题色行存在');
const resetBtn=accentRow.querySelector('.extra-setting-button');
check(!!resetBtn,'主题色有恢复默认按钮');
resetBtn.click();await wait(250);
check(!app.settings.appearance.accentColor,'重设后清空 accentColor 配置');
check(!document.body.style.getPropertyValue('--accent-h'),'重设后移除内联 --accent-h，恢复主题默认');
app.setting.close();
return {pass:true,count};
})()
