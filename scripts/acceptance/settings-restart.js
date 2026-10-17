/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: settings-restart 场景。仅由 run.mjs 在带标记的临时库执行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
const ok=(b,m)=>{if(!b)throw Error(m)};
ok(app.settings.config.tabSize===2&&!app.settings.config.spellcheck&&app.settings.config.showLineNumber,'app.json restart');
ok(app.settings.config.baseFontSize===17&&app.settings.config.accentColor==='#9672e4','appearance restart');
ok(app.settings.hotkeys['app:open-settings'][0].modifiers.includes('Shift'),'hotkeys restart');
ok(app.settings.corePlugins['word-count']===false&&!app.plugins.getInternalPlugin('word-count').enabled,'core disabled restart');
app.setting.open();app.setting.openTabById('appearance');
return {pass:true,tabSize:app.settings.config.tabSize,fontSize:app.settings.config.baseFontSize,disabled:'word-count',hotkey:app.settings.hotkeys['app:open-settings']};
})()
