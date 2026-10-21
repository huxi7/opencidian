/*
 * [INPUT]: OBS_ACT eval 注入；由 run.mjs 新建的 obs-copy-graph-worker-* 临时库（5 篇互链笔记）。
 * [OUTPUT]: 返回 {role, passed, checks, backend, workerShared, fallbackReason}；断言失败抛错。
 * [POS]: 图谱力学 worker 化验收。覆盖后端选择（app:// 直载 → Blob 回退 → 本地）、位置由 worker 发布且主线程零物理、
 *        真实 worker 的 SAB/transfer 缓冲区形态与 crossOriginIsolated 平台限制、钉住/解钉、力参数唤醒与再沉降、
 *        关闭视图终止 worker、消息载荷与原版 sim.js 逐字段对齐、本地回退后端回归。
 *        力参数另按原版 j2 段与 W2/F2/R2 逐项对照：滑块区间、默认值、换算链路、graph.json 落盘与重开复原。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 * 说明：本场景不做视觉断言；用 --no-screenshot 运行。
 */
(async () => {
  const fs = require('fs');
  const realVault = fs.realpathSync(app.vaultPath);
  if (!/^\/(?:private\/)?tmp\/obs-copy-acceptance\/obs-copy-graph-worker-[^/]+$/.test(realVault)) {
    throw new Error('只允许新建 /tmp/obs-copy-acceptance/obs-copy-graph-worker-* 独立 vault');
  }
  if (app.vault.getFiles().length) throw new Error('fixture 必须使用空 vault，请每次新建目录');
  const checks = [];
  const assert = (condition, label) => { if (!condition) throw new Error('graph-worker: ' + label); checks.push(label); };
  const note = (label) => { checks.push(label); };
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const wait = async (predicate, label, timeout = 15000) => {
    const end = Date.now() + timeout;
    while (!predicate()) {
      if (Date.now() > end) throw new Error('graph-worker timeout: ' + label);
      await delay(25);
    }
  };

  // A. fixture：链状 + 互链 + 孤立，保证有初始运动与稳定拓扑
  const fixture = {
    'Alpha.md': '# Alpha\n[[Beta]] [[Gamma]]\n',
    'Beta.md': '# Beta\n[[Gamma]]\n',
    'Gamma.md': '# Gamma\n',
    'Delta.md': '# Delta\n[[Alpha]]\n',
    'Orphan.md': '# Orphan\n',
  };
  for (const [name, content] of Object.entries(fixture)) await app.vault.create(name, content);
  await wait(() => app.metadataCache.getCache('Alpha.md') && app.metadataCache.resolvedLinks['Alpha.md']?.['Beta.md'], 'fixture 元数据');

  // B. 打开图谱（与用户入口一致）
  const leaf = app.workspace.getLeaf(true);
  await leaf.setViewState({ type: 'graph', state: {} });
  app.workspace.revealLeaf(leaf);
  const view = leaf.view;
  const renderer = view.renderer;
  const engine = view.dataEngine || view.engine;
  assert(!!renderer && !!engine, '图谱视图与引擎加载');
  const sim = renderer.sim;
  // 截获真实 worker → 主线程的位置消息，记录缓冲区类型（SAB 或 transfer ArrayBuffer）
  let lastPositionBuffer = null;
  const originalOnWorkerMessage = sim.onWorkerMessage.bind(sim);
  sim.onWorkerMessage = (data) => {
    if (data && data.buffer) lastPositionBuffer = data.buffer;
    originalOnWorkerMessage(data);
  };
  engine.setOptions({ showTags: false, showAttachments: false, hideUnresolved: true, showOrphans: true, close: false });
  await wait(() => Object.keys(renderer.nodeLookup).length === 5 && renderer.canvasEl.width > 0, '五个节点与画布就绪');
  assert(Object.keys(renderer.nodeLookup).length === 5, '五个节点入图');

  // C. 后端选择：等 worker 创建（Blob 回退是异步的）或回退结束
  const settled = async (target) => {
    const end = Date.now() + 8000;
    while (target.backend === 'worker' && !target.workerActive && Date.now() < end) await delay(50);
  };
  await settled(sim);
  const usesWorker = sim.backend === 'worker' && sim.workerActive && !!sim.worker;
  note('后端探测：backend=' + sim.backend + ' worker=' + (sim.worker ? 'present' : 'null') +
    ' shared=' + sim.workerShared + ' attempts=' + sim.attempts + ' fallback=' + (sim.fallbackReason || 'none'));
  if (usesWorker) {
    assert(sim.backend === 'worker', '原版协议跑在 Worker 后端（app:// 直载或 fetch+Blob 回退）');
  } else {
    // 两条创建路径都不可用：如实报告，并断言本地回退可用（图谱不因 worker 失败中断）
    note('worker 两条创建路径均不可用，回退本地线程（原因：' + (sim.fallbackReason || 'pending') + '）');
    assert(sim.backend === 'local' && sim.worker === null, '本地回退：backend=local 且无 worker 实例');
  }
  assert(typeof sim.workerShared === 'boolean', 'SAB 探测消息被识别（ignore/shared，shared=' + sim.workerShared + '）');

  // D. 镜像状态与 worker 发布的位置
  assert(sim.nodeById.size === renderer.nodes.length, '镜像节点表与渲染器节点数一致（' + sim.nodeById.size + '）');
  await wait(() => renderer.nodes.every((node) => {
    const simNode = sim.nodeById.get(node.id);
    return simNode && (node.fx !== null ? node.x === node.fx : node.x === simNode.x);
  }), '渲染节点与镜像坐标同步');
  assert(true, '渲染节点坐标与镜像同步（位置进入绘制路径）');
  const sample = (id) => {
    const node = sim.nodeById.get(id);
    return node ? node.x + '|' + node.y : 'missing';
  };
  const before = sample('Alpha.md');
  await delay(400);
  const after = sample('Alpha.md');
  assert(before !== after && after !== 'missing', '位置随时间变化（worker 发布 → 门面应用）');
  const isolated = window.crossOriginIsolated === true;
  let mainSharedCapable = false;
  try { new SharedArrayBuffer(4); mainSharedCapable = true; } catch (error) { mainSharedCapable = false; }
  note('SAB 环境：crossOriginIsolated=' + isolated + ' mainSAB=' + mainSharedCapable +
    ' workerShared=' + sim.workerShared + ' buffer=' + (lastPositionBuffer ? lastPositionBuffer.constructor.name : 'none'));
  if (usesWorker) {
    assert(sim.localTicks === 0, '主线程零物理：沉降期 localTicks=0');
    assert(!!lastPositionBuffer, '真实 worker 位置消息携带缓冲区');
    if (sim.workerShared) {
      assert(lastPositionBuffer instanceof SharedArrayBuffer, 'SAB 路径：真实 worker 发布 SharedArrayBuffer');
    } else {
      assert(lastPositionBuffer instanceof ArrayBuffer, '未跨源隔离：真实 worker 走 transfer ArrayBuffer');
      if (!isolated) note('平台限制：页面未跨源隔离（crossOriginIsolated=false），SAB 构造不可用；SAB 分支由下方注入结果消息覆盖');
    }
  } else {
    assert(sim.localTicks > 0, '本地回退由主线程 tick 推进（localTicks>0）');
  }
  let frames = 0;
  await new Promise((resolve) => {
    const end = performance.now() + 400;
    const step = () => { frames += 1; if (performance.now() < end) requestAnimationFrame(step); else resolve(); };
    requestAnimationFrame(step);
  });
  assert(frames >= 5, '沉降期主线程帧循环活跃（' + frames + ' 帧/400ms）');

  // E. 拖拽钉住 / 解钉
  const pinned = sim.nodeById.get('Alpha.md');
  assert(pinned.fx === null && pinned.fy === null, '初始节点未钉住（fx/fy 为 null）');
  renderer.sim.setForceNode('Alpha.md', 300, 200, 0.3, 0.3);
  await wait(() => Math.abs(pinned.x - 300) < 1 && Math.abs(pinned.y - 200) < 1, '钉住收敛到 (300,200)');
  assert(pinned.fx === 300 && pinned.fy === 200, '拖拽钉住：节点收敛到钉点 (300,200)');
  assert(sim.alpha >= 0.3 && sim.alphaTarget === 0.3, '拖拽消息抬高 alpha（只抬高不重置）并设 alphaTarget=.3');
  renderer.sim.setForceNode('Alpha.md', null, null, undefined, 0);
  assert(pinned.fx === null && pinned.fy === null, '释放解钉：fx/fy 归 null');
  assert(sim.alphaTarget === 0, '解钉消息把 alphaTarget 归 0');
  const pinnedX = pinned.x;
  const pinnedY = pinned.y;
  await wait(() => Math.abs(pinned.x - pinnedX) > 1 || Math.abs(pinned.y - pinnedY) > 1, '解钉后重新移动');
  assert(true, '解钉后节点重新移动（模拟继续）');

  // F. 力参数：立即作用于模拟、唤醒 worker、随后再次沉降
  const previousDistance = sim.linkDistance;
  renderer.setForces({ linkDistance: 420 });
  assert(sim.linkDistance === 420, '力参数：linkDistance 立即作用于模拟（420）');
  assert(sim.finished === false, '力参数变更后 finished 立刻为 false');
  const forceBefore = sample('Gamma.md');
  await wait(() => sample('Gamma.md') !== forceBefore, '力参数唤醒后重新发布位置');
  assert(true, '力参数变更后重新发布位置(worker 唤醒)');
  await wait(() => sim.finished === true, '沉降到 finished', 25000);
  assert(true, 'worker 沉降后 finished 回到 true（静默且 alphaTarget=0）');
  renderer.setForces({ linkDistance: previousDistance });
  assert(sim.linkDistance === previousDistance, '恢复 linkDistance（' + previousDistance + '）');

  // F1. 力参数：滑块区间/换算/默认值逐项对齐原版 j2 段与 W2/F2/R2
  const forceSliders = engine.forceOptions.childrenEl.querySelectorAll('input[type="range"]');
  assert(forceSliders.length === 4, '力设置四个滑块（向心力/排斥力/连线力/连线距离）');
  const sliderAttr = (el) => ({ min: Number(el.min), max: Number(el.max), step: Number(el.step) });
  const centerAttr = sliderAttr(forceSliders[0]);
  const repelAttr = sliderAttr(forceSliders[1]);
  const linkAttr = sliderAttr(forceSliders[2]);
  const distanceAttr = sliderAttr(forceSliders[3]);
  assert(centerAttr.min === 0 && centerAttr.max === 1, '向心力滑块区间 0..1（原版 setLimits(0,1,"any")）');
  assert(repelAttr.min === 0 && repelAttr.max === 20, '排斥力滑块区间 0..20（原版 setLimits(0,20,"any")）');
  assert(linkAttr.min === 0 && linkAttr.max === 1, '连线力滑块区间 0..1（原版 setLimits(0,1,"any")）');
  assert(distanceAttr.min === 30 && distanceAttr.max === 500 && distanceAttr.step === 1, '连线距离滑块区间 30..500 步长 1（原版 setLimits(30,500,1)）');
  /* 原版 F2：滑块值 → 力学强度；R2：强度 → 滑块值（默认值以滑块单位存储） */
  const f2 = (slider, min) => (Math.pow(min, 1 - slider) - min) / (1 - min);
  const r2 = (strength, min) => 1 - Math.log(strength * (1 - min) + min) / Math.log(min);
  assert(Math.abs(Number(forceSliders[0].value) - r2(0.1, 0.01)) < 1e-6, '向心力默认值 0.1 强度换算回滑块值（原版 W2.centerStrength）');
  assert(Math.abs(Number(forceSliders[1].value) - 10) < 1e-6, '排斥力默认值滑块值 10（原版 W2.repelStrength）');
  assert(Math.abs(Number(forceSliders[2].value) - r2(1, 0.01)) < 1e-6, '连线力默认值 1 强度换算回滑块值（原版 W2.linkStrength）');
  assert(Math.abs(Number(forceSliders[3].value) - 250) < 1e-6, '连线距离默认值 250（原版 W2.linkDistance）');
  assert(Math.abs(sim.centerStrength - 0.1) < 1e-9, '内核向心力默认 0.1');
  assert(Math.abs(sim.linkStrength - 1) < 1e-9, '内核连线力默认 1');
  assert(sim.linkDistance === 250, '内核连线距离默认 250');
  assert(sim.repelStrength === -1000, '内核排斥力默认 -1000（原版 worker x=-1e3，斥力取负）');
  // 滑块 → 强度的换算链路：斥力三次方、其余 F2
  const repelSlider = forceSliders[1];
  const repelBefore = Number(repelSlider.value);
  repelSlider.value = '5';
  repelSlider.dispatchEvent(new Event('input', { bubbles: true }));
  await delay(220);
  assert(sim.repelStrength === -125, '排斥力滑块 5 → 强度 125（原版 e*e*e），内核取负');
  assert(Math.abs(engine.options.repelStrength - 5) < 1e-9, '排斥力滑块值写入引擎选项');
  const centerSlider = forceSliders[0];
  const centerBefore = Number(centerSlider.value);
  centerSlider.value = '0.5';
  centerSlider.dispatchEvent(new Event('input', { bubbles: true }));
  await delay(220);
  assert(Math.abs(sim.centerStrength - f2(0.5, 0.01)) < 1e-9, '向心力滑块 0.5 → 强度 F2(0.5,0.01)');
  const linkSlider = forceSliders[2];
  const linkBefore = Number(linkSlider.value);
  linkSlider.value = '0.25';
  linkSlider.dispatchEvent(new Event('input', { bubbles: true }));
  await delay(220);
  assert(Math.abs(sim.linkStrength - f2(0.25, 0.01)) < 1e-9, '连线力滑块 0.25 → 强度 F2(0.25,0.01)');
  // 恢复默认
  repelSlider.value = String(repelBefore);
  repelSlider.dispatchEvent(new Event('input', { bubbles: true }));
  centerSlider.value = String(centerBefore);
  centerSlider.dispatchEvent(new Event('input', { bubbles: true }));
  linkSlider.value = String(linkBefore);
  linkSlider.dispatchEvent(new Event('input', { bubbles: true }));
  await delay(260);
  assert(Math.abs(sim.repelStrength + 1000) < 1e-6 && Math.abs(sim.centerStrength - 0.1) < 1e-6 && Math.abs(sim.linkStrength - 1) < 1e-6,
    '滑块复位后内核力参数回到默认值');
  // 持久化：graph.json 落盘四个力参数 + 缩放 + 面板开合
  const distanceSlider = forceSliders[3];
  const distanceDefault = Number(distanceSlider.value);
  distanceSlider.value = '271';
  distanceSlider.dispatchEvent(new Event('input', { bubbles: true }));
  await delay(320);
  assert(sim.linkDistance === 271, '连线距离滑块 271 立即作用于模拟');
  const forceJson = app.settings.readJson('graph.json') || {};
  assert(Number.isFinite(forceJson.centerStrength) && Number.isFinite(forceJson.repelStrength) &&
    Number.isFinite(forceJson.linkStrength) && Number.isFinite(forceJson.linkDistance), 'graph.json 落盘四个力参数');
  assert(Math.abs(forceJson.centerStrength - centerBefore) < 1e-6, 'graph.json 记录向心力滑块值');
  assert(Math.abs(forceJson.repelStrength - repelBefore) < 1e-6, 'graph.json 记录排斥力滑块值');
  assert(Math.abs(forceJson.linkStrength - linkBefore) < 1e-6, 'graph.json 记录连线力滑块值');
  assert(forceJson.linkDistance === 271, 'graph.json 记录连线距离');
  assert(Number.isFinite(forceJson.scale) && forceJson.scale > 0, 'graph.json 记录缩放');
  assert(typeof forceJson.close === 'boolean', 'graph.json 记录面板开合状态');
  assert(typeof forceJson['collapse-forces'] === 'boolean', 'graph.json 记录分节折叠状态');
  /* 原版 1.14.4 实测：全局图谱落盘的 graph.json 恰为这 20 个键（无 local* 键，局部图选项随布局保存） */
  const expectedKeys = 'centerStrength,close,collapse-color-groups,collapse-display,collapse-filter,collapse-forces,colorGroups,hideUnresolved,lineSizeMultiplier,linkDistance,linkStrength,nodeSizeMultiplier,repelStrength,scale,search,showArrow,showAttachments,showOrphans,showTags,textFadeMultiplier';
  assert(Object.keys(forceJson).sort().join(',') === expectedKeys, 'graph.json 键集与原版 1.14.4 一致（20 项）：' + Object.keys(forceJson).sort().join(','));
  // 重开视图：四个力参数复原（连线距离是非默认值，证明确实来自 graph.json）
  const reopenLeaf = app.workspace.getLeaf(true);
  await reopenLeaf.setViewState({ type: 'graph', state: {} });
  await wait(() => reopenLeaf.view.dataEngine?.renderer.sim.linkDistance === 271, '重开视图恢复力参数');
  const reopened = reopenLeaf.view.dataEngine;
  assert(reopened.renderer.sim.linkDistance === 271, '重开视图恢复连线距离（来自 graph.json）');
  assert(Math.abs(reopened.renderer.sim.centerStrength - 0.1) < 1e-6, '重开视图恢复向心力');
  assert(Math.abs(reopened.renderer.sim.repelStrength + 1000) < 1e-6, '重开视图恢复排斥力');
  assert(Math.abs(reopened.renderer.sim.linkStrength - 1) < 1e-6, '重开视图恢复连线力');
  await reopenLeaf.setViewState({ type: 'empty' });
  reopenLeaf.detach();
  distanceSlider.value = String(distanceDefault);
  distanceSlider.dispatchEvent(new Event('input', { bubbles: true }));
  await delay(300);
  assert(sim.linkDistance === distanceDefault, '连线距离复位到默认值');
  // 局部图谱的选项随布局保存，不写 graph.json（原版 LocalGraphView.onOptionsChange → requestSaveLayout）
  const beforeLocal = (app.settings.readJson('graph.json') || {}).linkDistance;
  const localLeaf = app.workspace.getLeaf(true);
  await localLeaf.setViewState({ type: 'localgraph', state: { file: 'Alpha.md' } });
  const localEngine = localLeaf.view.engine;
  const localDistance = localEngine.forceOptions.childrenEl.querySelectorAll('input[type="range"]')[3];
  localDistance.value = '333';
  localDistance.dispatchEvent(new Event('input', { bubbles: true }));
  await delay(320);
  assert(localEngine.renderer.sim.linkDistance === 333, '局部图谱的连线距离滑块同样作用于模拟');
  assert((app.settings.readJson('graph.json') || {}).linkDistance === beforeLocal, '局部图谱的力参数不写 graph.json（随布局保存）');
  await localLeaf.setViewState({ type: 'empty' });
  localLeaf.detach();
  // 两条后端语义一致：同一组力参数在 worker 门面与本地门面落到同样的内核字段
  const paritySim = new (sim.constructor)({ forceLocal: true });
  const parityForces = { centerStrength: 0.2, repelStrength: 8, linkStrength: 0.4, linkDistance: 300 };
  renderer.setForces(parityForces);
  paritySim.setForces(parityForces);
  assert(Math.abs(sim.centerStrength - paritySim.centerStrength) < 1e-9, '两条后端的向心力一致');
  assert(Math.abs(sim.repelStrength - paritySim.repelStrength) < 1e-9, '两条后端的排斥力一致（取负规则相同）');
  assert(Math.abs(sim.linkStrength - paritySim.linkStrength) < 1e-9, '两条后端的连线力一致');
  assert(sim.linkDistance === paritySim.linkDistance, '两条后端的连线距离一致');
  assert(paritySim.repelStrength === -8, '斥力按原版取负（x=-B）');
  paritySim.destroy();
  renderer.setForces({ centerStrength: 0.1, repelStrength: 1000, linkStrength: 1, linkDistance: distanceDefault });
  await delay(200);
  assert(Math.abs(sim.centerStrength - 0.1) < 1e-6 && Math.abs(sim.repelStrength + 1000) < 1e-6 &&
    Math.abs(sim.linkStrength - 1) < 1e-6 && sim.linkDistance === distanceDefault, '力参数回到原版默认值');

  // F2. 空图：worker 清空节点表并停摆（不空转），nodes+run 再次唤醒
  renderer.setData({ nodes: {} });
  await wait(() => sim.nodeById.size === 0, '空图');
  await delay(250);
  assert(sim.nodeById.size === 0 && sim.localTicks === 0, '空图：节点表清空且无主线程物理');
  engine.render();
  await wait(() => sim.nodeById.size === 5, '空图后恢复节点');
  const resumed = sample('Beta.md');
  await wait(() => sample('Beta.md') !== resumed, '空图恢复后重新发布位置');
  assert(true, '空图后 nodes+run 唤醒 worker 并重新发布位置');

  // G. 关闭视图：终止 worker、之后无位置更新
  const firstWorker = sim.worker;
  const closedAt = sample('Alpha.md');
  await leaf.setViewState({ type: 'empty' });
  await wait(() => renderer.destroyed === true && sim.destroyed === true, '视图销毁');
  assert(renderer.destroyed === true && sim.destroyed === true, '关闭视图：渲染器与模拟器置 destroyed');
  assert(sim.worker === null && sim.workerActive === false, '关闭视图：worker 已终止（worker=null）');
  assert(!renderer.canvasEl.isConnected && renderer.renderTimer === null, '关闭视图：画布移除且帧回调停止');
  await delay(400);
  assert(sample('Alpha.md') === closedAt, '关闭后无位置更新');
  let idempotent = true;
  try { sim.destroy(); sim.destroy(); } catch (error) { idempotent = false; }
  assert(idempotent, 'destroy 幂等：重复调用安全');

  // H. 消息载荷逐字段对齐原版 sim.js（用 stub Worker 截获）
  const RealWorker = window.Worker;
  const RealFetch = window.fetch;
  const posted = [];
  class StubWorker {
    constructor(url, options) { this.url = url; this.name = options && options.name; posted.push({ url, name: this.name }); }
    postMessage(message) { posted.push(message); }
    terminate() { posted.push({ terminated: true }); }
  }
  window.Worker = StubWorker;
  let probe = null;
  try {
    const ProbeClass = sim.constructor;
    probe = new ProbeClass();
    probe.setData([{ id: 'n1', x: 0, y: 0 }, { id: 'n2', x: 10, y: 0 }], [['n1', 'n2']]);
    probe.setForceNode('n1', 5, 6, 0.3, 0.3);
    probe.setForceNode('n1', null, null, undefined, 0);
    probe.setForces({ linkDistance: 300 });
    probe.setForces({ centerStrength: 0.2, repelStrength: 8, linkStrength: 0.4, linkDistance: 320 });
    probe.setData([{ id: 'n1', x: 999, y: 999 }, { id: 'n2', x: 10, y: 0 }], [['n1', 'n2']]);
    probe.destroy();
    assert(posted.some((m) => m.name === 'Graph Worker'), 'worker 以 name:"Graph Worker" 创建（原版同名）');
    const dataMessage = posted.find((m) => m.nodes);
    assert(!!dataMessage && dataMessage.alpha === 0.3 && dataMessage.run === true &&
      dataMessage.nodes.n1[0] === 0 && dataMessage.nodes.n2[0] === 10 &&
      dataMessage.links.length === 1 && dataMessage.links[0].join('|') === 'n1|n2',
      '协议：setData = {nodes:{id:[x,y]},links,alpha:.3,run:true}');
    const secondData = posted.filter((m) => m.nodes).pop();
    assert(secondData !== dataMessage && secondData.nodes.n1 === false && secondData.nodes.n2 === false && secondData.run === true,
      '协议：已有节点的 setData 载荷为 false（worker 保留自身坐标，原版语义）');
    const dragMessage = posted.find((m) => m.forceNode && m.forceNode.x === 5);
    assert(!!dragMessage && dragMessage.alpha === 0.3 && dragMessage.alphaTarget === 0.3 && dragMessage.run === true &&
      dragMessage.forceNode.id === 'n1' && dragMessage.forceNode.y === 6,
      '协议：拖拽 = {alpha:.3,alphaTarget:.3,run:true,forceNode:{id,x,y}}');
    const unpinMessage = posted.find((m) => m.forceNode && m.forceNode.x === null);
    assert(!!unpinMessage && unpinMessage.alphaTarget === 0 && unpinMessage.alpha === undefined && unpinMessage.run === undefined &&
      unpinMessage.forceNode.y === null,
      '协议：解钉 = {alphaTarget:0,forceNode:{id,x:null,y:null}}（无 alpha/run）');
    const forcesMessage = posted.find((m) => m.forces);
    assert(!!forcesMessage && forcesMessage.alpha === 0.3 && forcesMessage.run === true && forcesMessage.forces.linkDistance === 300,
      '协议：setForces = {forces,alpha:.3,run:true}');
    const allForces = posted.filter((m) => m.forces).pop();
    assert(!!allForces && allForces.forces.centerStrength === 0.2 && allForces.forces.repelStrength === 8 &&
      allForces.forces.linkStrength === 0.4 && allForces.forces.linkDistance === 320 && allForces.alpha === 0.3 && allForces.run === true,
      '协议：四个力参数原样转发给 worker（键名与原版 setForces 一致）');
    assert(posted.some((m) => m.terminated === true) && probe.worker === null, '协议：destroy 终止 worker（terminate 调用）');

    // H2. SAB 版本守卫（环境能构造 SharedArrayBuffer 时直接注入结果消息验证）
    const guard = new ProbeClass();
    guard.setData([{ id: 'g1', x: 0, y: 0 }], []);
    let sabAvailable = true;
    try { new SharedArrayBuffer(4); } catch (error) { sabAvailable = false; }
    if (sabAvailable) {
      const shared = new SharedArrayBuffer(4 * 2 + 4);
      const positions = new Float32Array(shared);
      positions[0] = 11; positions[1] = 22;
      const versionView = new Uint32Array(shared, shared.byteLength - 4, 1);
      versionView[0] = 7;
      const result = { id: ['g1'], buffer: shared, v: 6 };
      guard.onWorkerMessage(result);
      assert(guard.nodeById.get('g1').x === 11 && result.v === 7, 'SAB：新版本应用位置并回写版本号');
      positions[0] = 33;
      guard.onWorkerMessage(result);
      assert(guard.nodeById.get('g1').x === 11, 'SAB：版本未推进的重复消息跳过（不应用）');
      guard.onWorkerMessage({ ignore: true, shared: new SharedArrayBuffer(1) });
      assert(guard.workerShared === true, 'SAB：ignore 探测消息标记 shared=true');
    } else {
      note('环境不提供 SharedArrayBuffer（页面未跨源隔离）→ SAB 分支留待支持环境复跑，本机走 transfer');
    }
    guard.destroy();

    // I2. 回退链：直载抛错 → fetch+Blob 起真实 worker；两条都失败 → 本地后端接管
    const ThrowingWorker = class { constructor() { throw new Error('blocked'); } };
    window.Worker = ThrowingWorker;
    const blobSim = new ProbeClass();
    window.Worker = RealWorker;
    await wait(() => blobSim.workerActive || blobSim.backend === 'local', 'Blob 回退判定', 8000);
    if (blobSim.backend === 'worker' && blobSim.workerActive) {
      assert(blobSim.attempts === 2, 'failover：直载抛错 → fetch+Blob 回退起真实 worker（attempts=2）');
      blobSim.destroy();
      assert(blobSim.worker === null, 'failover：Blob worker 关闭即终止');
    } else {
      assert(!!blobSim.fallbackReason, 'failover：Blob 也不可用 → 本地回退（' + blobSim.fallbackReason + '）');
      blobSim.destroy();
    }

    // I3. worker 崩溃 → Blob 替补，替补拿到重发的镜像状态（否则换 worker 后图谱静止）
    let crashed = null;
    class CrashWorker { constructor() { crashed = this; } postMessage() {} terminate() {} }
    const replacement = [];
    class RecordingWorker {
      constructor(url, options) { this.url = url; this.name = options && options.name; replacement.push({ url, name: this.name }); }
      postMessage(message) { replacement.push(message); }
      terminate() {}
    }
    window.Worker = CrashWorker;
    const crashSim = new ProbeClass();
    crashSim.setData([{ id: 'r1', x: 0, y: 0 }, { id: 'r2', x: 90, y: 0 }], [['r1', 'r2']]);
    crashSim.setForceNode('r1', 7, 8, 0.3, 0.3);
    window.Worker = RecordingWorker;
    crashed.onerror();
    await wait(() => replacement.some((m) => m.nodes), '替补 worker 收到镜像状态', 8000);
    window.Worker = RealWorker;
    const resync = replacement.find((m) => m.nodes);
    assert(resync.alpha === 0.3 && resync.run === true && resync.nodes.r1[0] === 0 && resync.nodes.r2[0] === 90 &&
      resync.links.length === 1 && resync.links[0].join('|') === 'r1|r2',
      'failover：worker 崩溃 → 替补收到重发状态（nodes/links/alpha:.3/run）');
    const resyncPin = replacement.find((m) => m.forceNode);
    const resyncForces = replacement.find((m) => m.forces);
    assert(!!resyncPin && resyncPin.forceNode.id === 'r1' && resyncPin.forceNode.x === 7 &&
      !!resyncForces && resyncForces.forces.linkDistance === 250,
      'failover：重发包含钉住节点与力参数（linkDistance=250）');
    crashSim.destroy();

    window.Worker = ThrowingWorker;
    window.fetch = () => Promise.reject(new Error('offline'));
    const deadSim = new ProbeClass();
    await wait(() => deadSim.backend === 'local', '本地回退判定', 8000);
    window.Worker = RealWorker;
    window.fetch = RealFetch;
    assert(deadSim.backend === 'local' && deadSim.worker === null && !!deadSim.fallbackReason,
      'failover：两条 worker 路径都失败 → 本地后端接管（' + deadSim.fallbackReason + '）');
    deadSim.setData([{ id: 'x', x: 0, y: 0 }, { id: 'y', x: 80, y: 0 }], [['x', 'y']]);
    const deadBefore = deadSim.nodeById.get('y').x;
    deadSim.tick();
    assert(deadSim.nodeById.get('y').x !== deadBefore && deadSim.localTicks === 1, 'failover：本地接管后 tick() 推进节点');
    deadSim.destroy();
  } finally {
    window.Worker = RealWorker;
    window.fetch = RealFetch;
  }

  // I. 本地回退后端：同一门面类在 forceLocal 下跑主线程物理，行为与 worker 一致
  const ForceSimClass = sim.constructor;
  const local = new ForceSimClass({ forceLocal: true });
  assert(local.backend === 'local' && local.worker === null && local.workerActive === false, '本地后端：forceLocal 直接落主线程，无 worker');
  assert(local.linkDistance === 250 && Math.abs(local.repelStrength + 1000) < 1e-9 && local.centerStrength === 0.1 && local.linkStrength === 1,
    '本地后端默认力参数（距离 250、斥力 -1000、中心 .1、连线力 1）');
  local.setData([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 120, y: 0 }, { id: 'c', x: 0, y: 120 }], [['a', 'b'], ['a', 'c']]);
  assert(local.finished === false && local.alpha === 1, '本地后端：alpha 初值 1（原版 worker 初值），setData 只抬高不重置');
  const localBefore = local.nodeById.get('b').x + '|' + local.nodeById.get('b').y;
  for (let i = 0; i < 8; i += 1) local.tick();
  assert(local.localTicks === 8, '本地后端：tick() 计 8 帧本地物理');
  const localAfter = local.nodeById.get('b').x + '|' + local.nodeById.get('b').y;
  assert(localBefore !== localAfter, '本地后端：tick() 推动节点');
  local.setForces({ repelStrength: 0.5, linkDistance: 320 });
  assert(local.repelStrength === -1 && local.linkDistance === 320, '协议语义：|repelStrength|<1 钳到 -1，linkDistance 更新');
  local.alpha = 0.5;
  local.setForceNode('a', 10, 10, 0.3, 0.3);
  assert(local.alpha === 0.5, '协议语义：alpha 仅抬高（0.3 不覆盖 0.5）');
  local.setForceNode('a', null, null);
  assert(local.nodeById.get('a').fx === null, '协议语义：解钉写 fx=null');
  local.alpha = 0;
  local.alphaTarget = 0;
  assert(local.finished === true, '本地后端：alpha 归零后 finished=true（渲染回调停 tick）');
  local.destroy();
  assert(local.destroyed === true && local.worker === null, '本地后端：destroy 置位且无 worker 也不抛错');

  // J. 每个图谱视图独立 worker；关闭即终止
  const secondLeaf = app.workspace.getLeaf(true);
  await secondLeaf.setViewState({ type: 'graph', state: {} });
  const secondSim = secondLeaf.view.renderer.sim;
  await settled(secondSim);
  if (usesWorker) {
    assert(!!secondSim.worker && secondSim.worker !== firstWorker, '第二个图谱视图持有独立 worker');
  } else {
    assert(secondSim.worker === null, '本地回退：第二个视图同样无 worker');
  }
  await secondLeaf.setViewState({ type: 'empty' });
  await wait(() => secondSim.destroyed === true && secondSim.worker === null, '第二个视图销毁');
  assert(secondSim.destroyed === true && secondSim.worker === null, '第二个视图关闭后其 worker 终止');
  secondLeaf.detach();

  return {
    role: 'graph-worker',
    pass: true,
    passed: checks.length,
    count: checks.length,
    checks,
    backend: sim.backend,
    workerShared: sim.workerShared,
    workerAttempts: sim.attempts,
    fallbackReason: sim.fallbackReason || '',
    vault: realVault,
  };
})()
