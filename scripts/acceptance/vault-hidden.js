/**
 * [INPUT]: 独立临时 vault 与 OBS_ACT eval 注入的应用实例。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: vault-hidden 场景。仅由 run.mjs 在带标记的临时库执行。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms));await wait(400);await app.vault.adapter.write('.obsidian/hidden-probe.json','{}');await app.vault.adapter.write('.acceptance-hidden/note.md','# hidden');await app.vault.adapter.write('Visible-probe.md','# visible');await wait(1400);const hidden=app.vault.getFiles().filter(f=>f.path.split('/').some(p=>p.startsWith('.')));if(hidden.length)throw Error('hidden indexed '+hidden.map(f=>f.path));if(!app.vault.getFileByPath('Visible-probe.md'))throw Error('visible watcher failed');return {pass:true,count:2,checks:['hidden paths excluded','visible watcher indexes note'],hidden:0,visible:true};})()
