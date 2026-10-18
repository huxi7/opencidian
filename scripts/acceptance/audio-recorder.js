/**
 * [INPUT]: 独立临时 vault、OBS_ACT eval 注入的应用实例、被替换的 navigator.mediaDevices / window.MediaRecorder / navigator.permissions。
 * [OUTPUT]: 返回验收断言结果；失败抛出异常，供运行器判定。
 * [POS]: audio-recorder 场景。用假录音设备驱动录音机插件：命令门、功能区切换、权限与设备错误映射、落盘命名与扩展名、卸载释放、停启恢复、设置页开关与重启持久化。不接触真实麦克风。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const checks = [];
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const check = (condition, name) => { if (!condition) throw new Error(name); checks.push(name); };
  const until = async (predicate, name) => {
    for (let i = 0; i < 120; i++) { if (predicate()) { checks.push(name); return; } await wait(50); }
    throw new Error(name);
  };
  const output = '/tmp/obs-copy-acceptance';
  const vaultPath = fs.realpathSync(app.vault.getBasePath());
  const temporaryRoots = ['/tmp', os.tmpdir()].map((root) => fs.realpathSync(root));
  check(temporaryRoots.some((root) => vaultPath.startsWith(root + path.sep)), '只在临时 vault 验收');
  fs.mkdirSync(output, { recursive: true });
  const reportPath = path.join(output, 'audio-recorder-report.json');
  const result = { ok: false, checks, vault: vaultPath };
  const phase = process.env.OBS_NOTES_STAGE || 'run';
  const corePluginsFile = path.join(vaultPath, '.obsidian', 'core-plugins.json');
  const corePluginFlag = () => {
    try { return JSON.parse(fs.readFileSync(corePluginsFile, 'utf8'))['audio-recorder'] === true; }
    catch (error) { return false; }
  };
  const entryOf = () => app.plugins.getInternalPlugin('audio-recorder');
  const instanceOf = () => entryOf().instance;
  const ribbonButtons = () => [...app.workspace.ribbonActionsEl.querySelectorAll('.side-dock-ribbon-action')]
    .filter((el) => el.querySelector('svg.lucide-mic'));
  const noticeTexts = () => [...document.querySelectorAll('.notice-message')].map((el) => el.textContent);
  const clearNotices = () => { const container = document.querySelector('.notice-container'); if (container) container.detach(); };
  const recordings = () => app.vault.getFiles().filter((file) => file.basename.startsWith('Recording ')).map((file) => file.path);
  const finish = () => {
    result.ok = true;
    result.count = checks.length;
    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
    return { pass: true, checks, count: checks.length };
  };

  /* --------------------------------------------------------- 假录音设备 */
  // 只替换 navigator.mediaDevices.getUserMedia 与 window.MediaRecorder：插件不主动取设备，
  // 但验收必须先装上假实现，保证任何分支都不会真正打开麦克风。
  const pending = [];
  const streams = [];
  const recorders = [];
  let getUserMediaCalls = 0;
  const fakeGetUserMedia = async (constraints) => {
    getUserMediaCalls += 1;
    const next = pending.shift();
    if (!next) throw new Error('验收未预留 getUserMedia 结果');
    if (next.error) throw next.error;
    const track = { stopped: false, stop() { this.stopped = true; } };
    streams.push({ track, constraints });
    return { getTracks: () => [track] };
  };
  class FakeMediaRecorder {
    static isTypeSupported() { return false; }
    constructor(stream, options) {
      this.stream = stream;
      this.mimeType = options && options.mimeType;
      this.state = 'inactive';
      this._listeners = { dataavailable: [], stop: [] };
      recorders.push(this);
    }
    addEventListener(type, callback) { (this._listeners[type] = this._listeners[type] || []).push(callback); }
    start() {
      this.state = 'recording';
      const emit = (data) => { for (const callback of this._listeners.dataavailable) callback({ data }); };
      emit(new Blob([new Uint8Array([1, 2, 3, 4])], { type: this.mimeType }));
      emit(new Blob([], { type: this.mimeType }));   // size 0 必须被丢弃
    }
    stop() {
      this.state = 'inactive';
      for (const callback of this._listeners.stop) callback();
    }
  }
  const installFakes = () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: fakeGetUserMedia },
    });
    window.MediaRecorder = FakeMediaRecorder;
    check(navigator.mediaDevices.getUserMedia === fakeGetUserMedia && window.MediaRecorder === FakeMediaRecorder,
      '假录音设备已接管');
  };
  const setPermissionState = (state) => {
    Object.defineProperty(navigator.permissions, 'query', {
      configurable: true,
      value: async () => ({ state, onchange: null }),
    });
  };
  // 删掉自有属性后，NavigatorPermissions 原型上的真实实现重新可见。
  const restorePermissionQuery = () => { delete navigator.permissions.query; };

  try {
    /* ------------------------------------------------------ 重启阶段 */
    if (phase === 'restart') {
      check(!!entryOf() && entryOf().enabled === true, '重启后录音机仍启用');
      check(!!app.commands.findCommand('audio-recorder:start') && !!app.commands.findCommand('audio-recorder:stop'), '重启后恢复两个命令');
      check(ribbonButtons().length === 1, '重启后功能区恢复唯一麦克风按钮');
      check(corePluginFlag() === true, 'core-plugins.json 中开关为 true');
      const startCommand = app.commands.findCommand('audio-recorder:start');
      const stopCommand = app.commands.findCommand('audio-recorder:stop');
      check(startCommand.checkCallback(true) === true && stopCommand.checkCallback(true) === false, '重启后收音状态干净：start 可用、stop 不可用');
      check(instanceOf().recording === false && instanceOf().recorder === null, '重启后没有残留录音会话');
      return finish();
    }

    /* ------------------------------------------------------ 默认与启用 */
    check(!!entryOf(), '注册表登记 audio-recorder 条目');
    check(entryOf().enabled === false && !app.commands.findCommand('audio-recorder:start'), '默认关闭：无实例无命令');
    installFakes();
    await app.plugins.enableInternalPlugin('audio-recorder');
    const recorder = instanceOf();
    check(!!recorder && typeof recorder.onStartRecording === 'function', '启用后拿到插件实例');
    const startCommand = app.commands.findCommand('audio-recorder:start');
    const stopCommand = app.commands.findCommand('audio-recorder:stop');
    check(!!startCommand && !!stopCommand, '启用后注册 start/stop 命令');
    check(startCommand.name !== 'plugins.audio-recorder.action-start'
      && /开始录音|Start recording audio/.test(startCommand.name), 'start 命令名取 locale 文案');
    check(/结束录音|Stop recording audio/.test(stopCommand.name), 'stop 命令名取 locale 文案');
    check(ribbonButtons().length === 1, '功能区注册唯一麦克风按钮');
    check(ribbonButtons()[0].getAttribute('role') === 'button', '功能区按钮提供按钮语义');
    check(/开始\/结束录音|Start\/stop recording/.test(ribbonButtons()[0].getAttribute('aria-label')), '功能区按钮文案取 locale');
    await app.plugins.enableInternalPlugin('audio-recorder');
    check(ribbonButtons().length === 1, '重复启用不增加功能区按钮');

    /* ---------------------------------------------------------- 命令门 */
    check(startCommand.checkCallback(true) === true, '初始状态 start 命令可用');
    check(stopCommand.checkCallback(true) === false, '初始状态 stop 命令不可用');
    check(recorder.recording === false && getUserMediaCalls === 0, 'checking=true 不启动录音');

    /* ------------------------------------------------ 命令路径：录制 webm */
    const note = await app.vault.create('Audio recorder.md', '# 录音\n');
    await app.workspace.openFile(note);
    await until(() => {
      const view = app.workspace.getActiveViewOfType('markdown');
      return !!(view && view.editor && typeof view.editor.replaceSelection === 'function');
    }, '活动 Markdown 编辑器就绪');
    pending.push({});
    app.commands.executeCommandById('audio-recorder:start');
    await until(() => recorder.recording === true, 'start 命令开始录音');
    check(recorder.extension === 'webm' && recorders[0].mimeType === 'audio/webm;codecs="opus"', 'isTypeSupported=false 时用 webm/opus');
    check(ribbonButtons()[0].classList.contains('is-active'), '录音中按钮加 is-active');
    check(!!ribbonButtons()[0].querySelector('svg.lucide-mic'), '录音中按钮保持麦克风图标');
    check(stopCommand.checkCallback(true) === true && startCommand.checkCallback(true) === false, '录音中命令门反转');

    app.commands.executeCommandById('audio-recorder:stop');
    await until(() => recordings().length === 1, 'stop 命令落盘一份录音');
    const first = app.vault.getFileByPath(recordings()[0]);
    check(/^Recording \d{14}\.webm$/.test(first.name), '命名 Recording <YYYYMMDDHHmmss> 且扩展名为 webm');
    check(first.path === first.name, '附件落在库根目录（attachmentFolderPath 默认 /）');
    const bytes = new Uint8Array(await app.vault.readBinary(first));
    check(bytes.length === 4 && bytes[0] === 1, '落盘字节来自 dataavailable 且丢弃空 chunk');
    check(ribbonButtons()[0].classList.contains('is-active') === false, 'stop 后移除 is-active');
    check(recorder.recording === false && recorder.recorder === null && recorder._session === null, 'stop 后清空录音状态');
    check(streams.every((item) => item.track.stopped), 'stop 后释放麦克风轨道');
    await wait(200);
    check(/!\[\[Recording \d{14}\.webm\]\]/.test(await app.vault.read(note)), '录音结束向笔记插入嵌入链接');

    /* -------------------------------------------- 功能区路径：切换与 m4a */
    FakeMediaRecorder.isTypeSupported = (type) => type === 'audio/mp4';
    clearNotices();
    pending.push({});
    ribbonButtons()[0].click();
    await until(() => recorder.recording === true, '功能区按钮开始录音（走 checkPermission）');
    check(recorder.extension === 'm4a' && recorders[recorders.length - 1].mimeType === 'audio/mp4', 'audio/mp4 可用时落 m4a');
    check(ribbonButtons()[0].classList.contains('is-active'), '按钮路径同样加 is-active');
    ribbonButtons()[0].click();
    await until(() => recordings().some((file) => /\.m4a$/.test(file)), '功能区按钮再次点击结束并落盘 m4a');
    FakeMediaRecorder.isTypeSupported = () => false;

    /* -------------------------------------------------- 同名冲突追加序号 */
    const stamp = (offsetMs) => {
      const d = new Date(Date.now() + offsetMs);
      const pad = (n) => String(n).padStart(2, '0');
      return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    };
    const probes = ['Recording ' + stamp(0) + '.webm', 'Recording ' + stamp(1000) + '.webm'];
    // 探针可能已被前面的录音占用：存在即可，冲突语义相同。
    for (const probe of probes) if (!app.vault.getAbstractFileByPath(probe)) await app.vault.create(probe, 'probe');
    const beforeProbe = recordings();
    pending.push({});
    ribbonButtons()[0].click();
    await until(() => recorder.recording === true, '冲突录制开始');
    ribbonButtons()[0].click();
    await until(() => recordings().length > beforeProbe.length, '冲突录制落盘');
    await wait(200);
    const created = recordings().filter((file) => !beforeProbe.includes(file));
    check(created.length === 1 && /^Recording \d{14} 1\.webm$/.test(created[0]), '同秒重名追加序号 " 1"');
    check(probes.every((probe) => app.vault.getAbstractFileByPath(probe) !== null), '冲突探针文件未被覆盖');

    /* -------------------------------------------------- 设备与权限错误映射 */
    clearNotices();
    const beforeError = recordings().length;
    pending.push({ error: new DOMException('Requested device not found', 'NotFoundError') });
    app.commands.executeCommandById('audio-recorder:start');
    await until(() => noticeTexts().some((text) => /未连接麦克风|No microphone is connected/.test(text)), '无麦克风：提示未连接麦克风');
    check(recorder.recording === false && !ribbonButtons()[0].classList.contains('is-active'), '无麦克风：不进入录音状态');
    check(recordings().length === beforeError, '无麦克风：不产生文件');

    clearNotices();
    pending.push({ error: new DOMException('Permission denied', 'NotAllowedError') });
    app.commands.executeCommandById('audio-recorder:start');
    await until(() => noticeTexts().some((text) => /访问被拒绝|Microphone access was denied/.test(text)), '拒绝授权：提示访问被拒绝');
    check(recorder.recording === false, '拒绝授权：不进入录音状态');

    clearNotices();
    setPermissionState('denied');
    const callsBefore = getUserMediaCalls;
    ribbonButtons()[0].click();
    await until(() => noticeTexts().some((text) => /访问被拒绝|Microphone access was denied/.test(text)), '权限状态 denied：按钮提示访问被拒绝');
    check(getUserMediaCalls === callsBefore && recorder.recording === false, '权限状态 denied：不调用 getUserMedia');
    setPermissionState('prompt');
    clearNotices();
    pending.push({});
    ribbonButtons()[0].click();
    await until(() => recorder.recording === true, '权限状态 prompt：继续录音（由 getUserMedia 触发授权）');
    check(noticeTexts().some((text) => /请授权麦克风|grant microphone permission/.test(text)), '权限状态 prompt：先提示授权');
    ribbonButtons()[0].click();
    await until(() => recorder.recording === false, '按钮再次点击停止录音');
    await wait(200);
    restorePermissionQuery();

    /* -------------------------------------------------------- 卸载释放 */
    const beforeUnload = recordings().length;
    pending.push({});
    app.commands.executeCommandById('audio-recorder:start');
    await until(() => recorder.recording === true, '卸载前处于录音中');
    const liveTrack = streams[streams.length - 1].track;
    await app.plugins.disableInternalPlugin('audio-recorder');
    check(recorder.recording === false, '卸载时停止录音');
    check(liveTrack.stopped === true, '卸载时释放麦克风轨道');
    check(!app.commands.findCommand('audio-recorder:start') && !app.commands.findCommand('audio-recorder:stop'), '卸载撤销两个命令');
    check(ribbonButtons().length === 0, '卸载移除功能区按钮');
    await wait(300);
    check(recordings().length === beforeUnload, '卸载丢弃未完成录音（不落盘）');

    await app.plugins.enableInternalPlugin('audio-recorder');
    check(!!app.commands.findCommand('audio-recorder:start') && !!app.commands.findCommand('audio-recorder:stop'), '重新启用恢复命令');
    check(ribbonButtons().length === 1, '重新启用恢复唯一功能区按钮');
    check(instanceOf().recording === false && instanceOf().recorder === null, '重新启用后状态干净');

    /* -------------------------------------------------- 设置页开关与落盘 */
    app.setting.open();
    app.setting.openTabById('plugins');
    await wait(300);
    const rowFor = (name) => [...app.setting.activeTab.containerEl.querySelectorAll('.setting-item')]
      .find((el) => el.querySelector('.setting-item-name') && el.querySelector('.setting-item-name').textContent === name);
    const entry = entryOf();
    check(entry.manifest.name !== 'audio-recorder' && !!entry.manifest.description, '设置行使用 locale 名称与描述');
    const row = rowFor(entry.manifest.name);
    check(!!row && !!row.querySelector('.checkbox-container'), '设置页有录音机开关行');
    check(row.querySelector('.checkbox-container').classList.contains('is-enabled'), '开关反映已启用状态');
    row.querySelector('.checkbox-container').click();
    await until(() => !entryOf().enabled && !app.commands.findCommand('audio-recorder:start'), '设置页开关可禁用录音机');
    check(ribbonButtons().length === 0, '设置页禁用移除功能区按钮');
    await until(() => corePluginFlag() === false, '禁用写入 core-plugins.json');
    const rowAgain = rowFor(entry.manifest.name);
    rowAgain.querySelector('.checkbox-container').click();
    await until(() => entryOf().enabled && ribbonButtons().length === 1 && !!app.commands.findCommand('audio-recorder:stop'),
      '设置页开关可重新启用录音机');
    await until(() => corePluginFlag() === true, '启用写入 core-plugins.json（供重启阶段）');
    app.setting.close();
    await wait(200);
    check(getUserMediaCalls > 0 && pending.length === 0, '假设备全部消费，无遗留请求');
    return finish();
  } catch (error) {
    result.error = error.stack || String(error);
    result.count = checks.length;
    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
    throw error;
  }
})()
