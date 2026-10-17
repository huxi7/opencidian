/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: graph-persist-write 场景。仅由 run.mjs 在带标记的临时库执行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{await app.plugins.enableInternalPlugin('graph');const l=app.workspace.getLeaf(true);await l.setViewState({type:'graph',state:{}});app.workspace.revealLeaf(l);l.view.dataEngine.setOptions({showTags:true,showAttachments:false,search:'file:A',close:true});l.view.onOptionsChange();await app.saveLayout();return {pass:true,options:app.settings.readJson('graph.json')};})()
