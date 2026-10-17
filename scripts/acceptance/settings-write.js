/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: settings-write 场景。仅由 run.mjs 在带标记的临时库执行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{
app.settings.updateAppSettings({tabSize:2,spellcheck:false,showLineNumber:true});
app.settings.updateAppearance({baseFontSize:17,accentColor:'#9672e4'});
app.settings.setHotkey('app:open-settings',[{modifiers:['Mod','Shift'],key:','}]);
await app.plugins.disableInternalPlugin('word-count');
app.setting.open();app.setting.openTabById('editor');
return {pass:app.settings.readJson('app.json').tabSize===2,files:['app.json','appearance.json','hotkeys.json','core-plugins.json']};
})()
