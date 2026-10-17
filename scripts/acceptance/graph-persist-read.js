/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: graph-persist-read 场景。仅由 run.mjs 在带标记的临时库执行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{await app.commands.findCommand('graph:open').callback();await new Promise(r=>setTimeout(r,200));const l=app.workspace.activeLeaf;const o=l.view.dataEngine.getOptions();if(!o.showTags||o.showAttachments||o.search!=='file:A'||!o.close)throw Error('graph options lost');return {pass:true,options:o};})()
