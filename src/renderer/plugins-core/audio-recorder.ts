/**
 * [INPUT]: 依赖 ../core/i18n.js 的 tt；依赖 ../core/notices.js 的 Notice；依赖 ../core/icons.js 的 setIcon；依赖 ../editor/attachments.js 的 saveAttachment；依赖 moment。
 * [OUTPUT]: 导出 nameKey、create(app)（命令 audio-recorder:start/stop、功能区切换按钮、录音落盘）。
 * [POS]: plugins-core/ 的录音机插件（原版 id audio-recorder，默认关闭）。功能区按钮先查权限再开/停；两个命令直接开/停并各自带 checkCallback 门。扩展名 m4a 优先、否则 webm（落盘前用 fix-webm-duration 补时长，失败回退原始数据），命名 "Recording <YYYYMMDDHHmmss>"，落盘走 saveAttachment；有活动 Markdown 视图时插入嵌入链接，否则在新标签打开。权限查询用 Permissions API 与设备错误映射替代原版 macOS 的 electron systemPreferences（渲染层没有 remote）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Core plugin: audio-recorder — record audio notes and save them as attachments. */
import { tt } from '../core/i18n.js';
import { Notice } from '../core/notices.js';
import { setIcon } from '../core/icons.js';
import { saveAttachment } from '../editor/attachments.js';

const moment = require('moment');

export const nameKey = 'plugins.audio-recorder';

const MP4_MIME = 'audio/mp4';
import fixWebmDuration from 'fix-webm-duration';

const WEBM_MIME = 'audio/webm;codecs="opus"';
const MIC_ICON = 'lucide-mic';

const MSG_ACCESS_DENIED = ['plugins.audio-recorder.msg-access-denied',
  'Microphone access was denied, please enable it from the preference pane.'];
const MSG_PENDING_GRANT = ['plugins.audio-recorder.msg-pending-grant',
  'Please grant microphone permission to start recording.'];
const MSG_NO_MICROPHONE = ['plugins.audio-recorder.msg-no-microphone', 'No microphone is connected.'];

const msg = (entry) => tt(entry[0], entry[1]);

function errorName(error) { return (error && error.name) || ''; }
function errorText(error) { return error ? String(error.message || error.name || error) : ''; }

/** 设备/权限错误 → 不连接麦克风；其余返回 false。原版匹配的是英文 message，这里同时认名字与文案。 */
function isMissingMicrophone(error) {
  const name = errorName(error);
  return name === 'NotFoundError' || name === 'DevicesNotFoundError'
    || errorText(error).includes('Requested device not found');
}

/** 用户拒绝授权。原版把原始 message 直接塞进 Notice；渲染层改用 locale 文案。 */
function isAccessDenied(error) {
  const name = errorName(error);
  return name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError'
    || /denied/i.test(errorText(error));
}

/* --------------------------------------------------------------------------
 * AudioRecorder — 一次录音会话
 * ------------------------------------------------------------------------ */
class AudioRecorder {
  declare app: App;
  declare recording: boolean;
  declare recorder: any;
  declare extension: string;
  declare buttonEls: any[];
  declare _commandIds: any[];
  declare _session: any;

  constructor(app: App) {
    this.app = app;
    this.recording = false;
    this.recorder = null;
    this.extension = '';
    this.buttonEls = [];
    this._commandIds = [];
    this._session = null;
  }

  /* ------------------------------------------------------------- 生命周期 */
  onload() {
    this.buttonEls.push(this.app.workspace.addRibbonItem(
      MIC_ICON,
      tt('plugins.audio-recorder.action-toggle', 'Start/stop recording'),
      () => { this.onRecordAudio(); },
    ));
    this.addCommand({
      id: 'audio-recorder:start',
      name: tt('plugins.audio-recorder.action-start', 'Start recording audio'),
      icon: 'lucide-play-circle',
      checkCallback: (checking) => {
        if (this.recording) return false;
        if (!checking) this.onStartRecording();
        return true;
      },
    });
    this.addCommand({
      id: 'audio-recorder:stop',
      name: tt('plugins.audio-recorder.action-stop', 'Stop recording audio'),
      icon: 'lucide-stop-circle',
      checkCallback: (checking) => {
        if (!this.recording) return false;
        if (!checking) this.onStopRecording();
        return true;
      },
    });
  }

  onunload() {
    // 卸载即停止录音：未完成的录音作废，麦克风必须释放。
    this.abortRecording();
    for (const el of this.buttonEls) el.detach();
    this.buttonEls = [];
    this.deregisterCommands();
  }

  addCommand(command) {
    this.app.commands.addCommand(command);
    this._commandIds.push(command.id);
  }

  deregisterCommands() {
    for (const id of this._commandIds) this.app.commands.removeCommand(id);
    this._commandIds = [];
  }

  /* ----------------------------------------------------------- 权限与开关 */
  /** 原版 onRecordAudio：功能区按钮开/停切换，先查权限。 */
  async onRecordAudio() {
    const allowed = await this.checkPermission();
    if (!allowed) return;
    if (this.recording) this.onStopRecording();
    else await this.onStartRecording();
  }

  /**
   * 原版在 macOS 上查 electron remote.systemPreferences.getMediaAccessStatus("microphone")：
   * denied/restricted/unknown → 提示访问被拒绝并拒绝开始；not-determined → 提示授权后 askForMediaAccess。
   * 渲染层没有 remote，降级为 Permissions API 状态 + getUserMedia 的错误映射（见 showStartError）。
   */
  async checkPermission() {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      this.showRecordingMessage(msg(MSG_NO_MICROPHONE));
      return false;
    }
    if (navigator.permissions && typeof navigator.permissions.query === 'function') {
      let state = '';
      try { state = (await navigator.permissions.query({ name: 'microphone' })).state; } catch (error) { state = ''; }
      if (state === 'denied') {
        this.showRecordingMessage(msg(MSG_ACCESS_DENIED));
        return false;
      }
      // not-determined 等价物：先提示再继续，由 getUserMedia 触发系统授权弹窗。
      if (state === 'prompt') this.showRecordingMessage(msg(MSG_PENDING_GRANT));
    }
    return true;
  }

  /* --------------------------------------------------------------- 录音 */
  async onStartRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      await this.startRecording(stream);
    } catch (error) {
      this.showStartError(error);
      return;
    }
    this.recording = true;
    for (const el of this.buttonEls) {
      setIcon(el, MIC_ICON);
      el.addClass('is-active');
    }
  }

  /** getUserMedia 开始失败时的提示：无麦克风 / 访问被拒绝 / 其余只记日志。 */
  showStartError(error) {
    if (isMissingMicrophone(error)) {
      if (this.buttonEls.length > 0) this.showRecordingMessage(msg(MSG_NO_MICROPHONE));
      return;
    }
    if (isAccessDenied(error)) {
      new Notice(msg(MSG_ACCESS_DENIED));
      return;
    }
    console.error(error);
  }

  onStopRecording() {
    this.recording = false;
    if (this.recorder) this.recorder.stop();
    for (const el of this.buttonEls) el.removeClass('is-active');
  }

  async startRecording(stream) {
    const chunks = [];
    let mimeType = WEBM_MIME;
    this.extension = 'webm';
    // 原版：支持 audio/mp4 就录 mp4（落 .m4a），否则 webm/opus；webm 在落盘前用 fix-webm-duration 补时长元数据。
    if (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function'
      && MediaRecorder.isTypeSupported(MP4_MIME)) {
      mimeType = MP4_MIME;
      this.extension = 'm4a';
    }
    const session = { stream, chunks, mimeType, discard: false, recorder: null, startedAt: Date.now() };
    this._session = session;
    const recorder = new MediaRecorder(stream, { mimeType });
    session.recorder = recorder;
    this.recorder = recorder;
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    });
    recorder.addEventListener('stop', () => { this.onRecorderStopped(session); });
    recorder.start();
  }

  onRecorderStopped(session) {
    // stop 事件是异步的：只有当前会话的录音器才能清空 this.recorder，
    // 否则用户在事件到达前启动的下一段录音会被误清，导致无法停止。
    if (this.recorder === session.recorder) this.recorder = null;
    if (this._session === session) this._session = null;
    for (const track of session.stream.getTracks()) track.stop();
    if (session.discard) return;
    // 落盘在事件回调里进行：失败只记日志，不能让 Promise 逃逸成未处理拒绝。
    this.finishRecording(session).catch((error) => console.error(error));
  }

  async finishRecording(session) {
    let blob = new Blob(session.chunks, { type: session.mimeType });
    if (this.extension === 'webm') {
      // 原版：MediaRecorder 产出的 webm 缺 Duration（播放器进度条异常），落盘前用 fix-webm-duration 补；
      // 补失败必须回退原始 blob——录音绝不能丢。app.fixWebmDuration 为验收注入点。
      const durationMs = Math.max(0, Date.now() - (session.startedAt || Date.now()));
      const fix = (this.app && this.app.fixWebmDuration) || fixWebmDuration;
      try {
        const fixed = await fix(blob, durationMs);
        if (fixed && typeof fixed.arrayBuffer === 'function') blob = fixed;
      } catch (error) {
        console.warn('fix-webm-duration failed; saving raw recording', error);
      }
    }
    await this.saveRecording(await blob.arrayBuffer());
  }

  /** 卸载路径：丢弃当前录音、释放麦克风、清掉按钮的进行中状态。 */
  abortRecording() {
    const session = this._session;
    const recorder = this.recorder;
    this.recording = false;
    this._session = null;
    this.recorder = null;
    if (session) session.discard = true;
    if (recorder) { try { recorder.stop(); } catch (error) { console.error(error); } }
    if (session) for (const track of session.stream.getTracks()) track.stop();
    for (const el of this.buttonEls) el.removeClass('is-active');
  }

  /* --------------------------------------------------------------- 落盘 */
  /** 原版 saveRecording：命名 "Recording <YYYYMMDDHHmmss>"，文件名冲突由附件路径规则去重。 */
  async saveRecording(data) {
    const name = 'Recording ' + moment().format('YYYYMMDDHHmmss');
    const activeFile = this.app.workspace.getActiveFile();
    const file = await saveAttachment(this.app, name, this.extension, data, activeFile ? activeFile.path : '');
    const view = this.app.workspace.getActiveViewOfType('markdown');
    if (view && view.editor && typeof view.editor.replaceSelection === 'function') {
      view.editor.replaceSelection('\n!' + this.app.fileManager.generateMarkdownLink(file, view.file.path) + '\n');
    } else {
      await this.app.workspace.getLeaf('tab').openFile(file, { active: true });
    }
    return file;
  }

  /** 原版把文案挂在功能区按钮的 tooltip 上（mod-error）；本实现走项目统一通知通道。 */
  showRecordingMessage(message) {
    if (!this.buttonEls.length) return;
    new Notice(message);
  }
}

export function create(app: App) {
  return new AudioRecorder(app);
}
