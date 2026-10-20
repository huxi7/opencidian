/**
 * [INPUT]: 依赖 ./canvas-node.js 的 CanvasContentNode（正文节点基类）与 parkEditorSelection（只读光标停放）；
 *          依赖 @codemirror/view 的 placeholder；依赖 ../editor/editor.js 的 Editor；
 *          依赖 ../core/modals.js 的 FileNameModal；依赖 ../core/notices.js 的 Notice；依赖 ../core/i18n.js 的 t；依赖 ../core/icons.js 的 setIcon。
 * [OUTPUT]: 导出 CanvasTextNode（文本卡片：内嵌 CM6 实时预览、编辑态、转换为文件）。
 * [POS]: views/ 画布节点层的文本卡片（从 canvas-node.js 拆出以守住 800 行上限）。原版 P5 + L5：正文是 markdown 视图。
 *        DOM 为 contentEl.markdown-embed > .markdown-embed-content > .markdown-source-view；editor 只活在内容挂载期间，卸载即 destroy。
 *        未编辑时 readOnly 且光标停在无 markdown 记号的行上，视觉等价阅读视图；双击或单击已聚焦卡片进入编辑。
 *        编辑器聚焦/进入编辑时登记为 workspace 活动编辑器，命令层 editor:* 由此作用在卡片正文；
 *        Escape / Mod+Enter / 失焦退出编辑；转换为文件时建 md、文件节点继承几何、关联边改指新节点。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Canvas text card — embedded CM6 live preview and edit lifecycle. */
import { placeholder as cmPlaceholder } from '@codemirror/view';
import { CanvasContentNode, parkEditorSelection } from './canvas-node.js';
import { Editor } from '../editor/editor.js';
import { FileNameModal } from '../core/modals.js';
import { Notice } from '../core/notices.js';
import { setIcon } from '../core/icons.js';
import { t } from '../core/i18n.js';

export class CanvasTextNode extends CanvasContentNode {
  constructor(canvas, id) {
    super(canvas, id);
    this.text = '';
    this.editor = null;      // Editor：只活在挂载期间，卸载/销毁即释放
    this.editorEl = null;    // 原版 wZ.editorEl：.markdown-embed-content，编辑器宿主
    this.sourceEl = null;    // .markdown-source-view.cm-s-obsidian.mod-cm6，实时预览装饰的锚点
  }

  initialize() {
    super.initialize();
    this.contentEl.addClass('markdown-embed');
    this.initializeEditing();
  }

  /**
   * 文本卡片的占位（原版 P5.initialize）：缩到断点以下、正文卸载时显示居中的 align-left 图标，
   * 不显示正文摘要——摘要属于编辑器内容，不该在占位态泄漏。
   */
  renderPlaceholder() {
    if (!this.placeholderEl) return;
    if (this.placeholderEl.childElementCount) return;
    const iconEl = this.placeholderEl.createDiv('canvas-icon-placeholder');
    setIcon(iconEl, 'lucide-align-left');
  }

  isEditable() { return true; }

  /* ---------------------------------------------------- 活动编辑器登记 */

  /**
   * 文本卡片是内嵌编辑器的宿主：卡片被聚焦/进入编辑时登记到工作区，
   * 命令（editor:*）作用在卡片正文而不是活动叶子；形状对齐原版 activeEditor 的 { editor, file, containerEl }。
   */
  getActiveEditorHost() { return this.editor ? this : null; }

  /** 卡片正文视图的读取模式（原版内嵌 markdown 视图的 getMode；卡片正文始终可写）。 */
  getMode() { return 'source'; }

  /** 卡片正文归属的画布文件（原版内嵌 markdown 视图的 file）。 */
  get file() { return this.canvas.file; }

  /* -------------------------------------------------------------- 正文数据 */

  setText(text) {
    text = typeof text === 'string' ? text : '';
    if (this.text === text) return;
    this.text = text;
    this.placeholderText = text;
    this.renderPlaceholder();
    this.setEditorValue(text);
    this.canvas.markDirty(this);
  }

  getData() { return { ...super.getData(), type: 'text', text: this.text }; }

  setData(data) {
    super.setData(data);
    if (typeof data.text === 'string') {
      this.setText(data.text);
      this.canvas.markDirty(this);
    }
  }

  /** 编辑器正文变化：写入 this.text，落盘与撤销条目沿用画布的防抖链路。 */
  onEditorChange() {
    if (!this.editor) return;
    const text = this.editor.getValue();
    if (this.text === text) return;
    this.text = text;
    this.placeholderText = text;
    this.renderPlaceholder();
    this.canvas.markDirty(this);
    this.canvas.requestSave();
  }

  /** 程序化写正文（导入/撤销重做/外部重载）：this.text 已先行更新，编辑器回写不会重复入栈。 */
  setEditorValue(text) {
    if (!this.editor || this.editor.getValue() === text) return;
    this.editor.setValue(text);
    if (!this.isEditing) parkEditorSelection(this.editor);
  }

  /* -------------------------------------------------------- 编辑器生命周期 */

  mountContent() {
    super.mountContent();
    if (this.isContentMounted) this.mountEditor();
  }

  unmountContent() {
    super.unmountContent();
    this.unmountEditor();
  }

  destroy() {
    this.unmountEditor();
    super.destroy();
  }

  mountEditor() {
    if (this.editor) return;
    const editorEl = this.editorEl = this.contentEl.createDiv('markdown-embed-content');
    const sourceEl = this.sourceEl = editorEl.createDiv('markdown-source-view cm-s-obsidian mod-cm6');
    const hostEl = sourceEl.createDiv('cm-editor-host');
    // 未进入编辑态前不可写：原版未编辑的卡片是阅读视图，不接受输入
    const editor = this.editor = new Editor(hostEl, this.app, { doc: this.text, readOnly: true });
    editor.sourcePath = this.canvas.file ? this.canvas.file.path : '';
    editor.cm.dom.setAttr('data-editor-mode', 'source');
    parkEditorSelection(editor);
    editor.onChange(() => this.onEditorChange());
    editor.addExtensions(cmPlaceholder(t('plugins.canvas.prompt-add-text')));
    editorEl.addEventListener('keydown', (e) => this.onEditorKeydown(e), true);
    const live = this.app.settings.appSettings.livePreview !== false;
    sourceEl.toggleClass('is-live-preview', live);
    sourceEl.toggleClass('is-source-mode', !live);
    editor.setLivePreview(live);
    this.installEditorHandle(editorEl);
  }

  unmountEditor() {
    const editor = this.editor;
    if (!editor) return;
    this.clearActiveEditor();   // 宿主要随编辑器一起消失：先摘登记再释放编辑器
    this.editor = null;
    const editorEl = this.editorEl;
    this.editorEl = null;
    this.sourceEl = null;
    editor.destroy();
    if (editorEl) editorEl.detach();
  }

  /** 兼容旧编辑面板句柄：历史上 editorEl 是 textarea（.value 即正文），现有画布自动化仍按该约定读写正文。 */
  installEditorHandle(editorEl) {
    Object.defineProperty(editorEl, 'value', {
      configurable: true,
      get: () => (this.editor ? this.editor.getValue() : this.text),
      set: (v) => {
        if (this.editor) this.editor.setValue(typeof v === 'string' ? v : String(v == null ? '' : v));
        else this.setText(v);
      },
    });
  }

  /* ---------------------------------------------------------------- 编辑态 */

  /** 原版 T5：双击进编辑，单击已聚焦的卡片同样进编辑（原版 hg）。 */
  initializeEditing() {
    super.initializeEditing();
    this.contentEl.addEventListener('click', (e) => this.onContentClick(e));
  }

  onContentClick(e) {
    if (e.defaultPrevented || e.detail > 1 || e.shiftKey) return;
    if (this.isEditing || this.canvas.readonly || this.isInteractiveTarget(e)) return;
    const active = document.activeElement;
    if (active instanceof Element && active.closest('button, input')) return;
    // 原版 hg：正文里已有文字选区时不进编辑（用户在选择文本）
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.anchorNode && this.contentEl.contains(selection.anchorNode)) return;
    const pos = { x: e.clientX, y: e.clientY };
    window.setTimeout(() => {
      if (this.destroyed || this.isEditing) return;
      this.startEditing(pos);
    }, 10);
  }

  startEditing(pos) {
    const canvas = this.canvas;
    if (canvas.readonly || this.isEditing) return;
    canvas.selectOnly(this);
    if (canvas.zoom < canvas.zoomBreakpoint + 0.1) canvas.zoomToBbox(this.getBBox());
    this.setIsEditing(true);
    this.updateBreakpoint(true);
    // 已聚焦的卡片再次进入编辑时 selectOnly 会提前返回，故在此显式登记活动编辑器
    this.registerActiveEditor();
    const editor = this.editor;
    if (!editor) return;      // 画布尚未测量尺寸时正文挂不上，编辑态照常保留
    editor.setReadOnly(false);
    editor.focus();
    if (pos) this.placeCursor(editor, pos);
  }

  /** 原版 showEditor(pos)：把光标落到点击位置。 */
  placeCursor(editor, pos) {
    window.setTimeout(() => {
      if (this.editor !== editor || !this.isEditing || this.destroyed) return;
      let offset = null;
      try { offset = editor.cm.posAtCoords({ x: pos.x, y: pos.y }); } catch (e) { offset = null; }
      if (offset == null) return;
      editor.setSelection(editor.offsetToPos(offset));
    }, 0);
  }

  /** 原版 T5.blur：回到未编辑态（阅读态）。事件本身由画布的指针/键盘逻辑触发。 */
  stopEditing() {
    if (!this.isEditing) return;
    this.setIsEditing(false);
    this.canvas.markMoved(this);
    if (this.editor) {
      this.editor.setReadOnly(true);
      this.editor.blur();
      parkEditorSelection(this.editor);
    }
    this.placeholderText = this.text;
    this.renderPlaceholder();
    this.clearActiveEditor();
    this.canvas.requestSave();
  }

  /** 画布切到只读：正在编辑的卡片立即退回阅读态（无编辑器挂载时无需处理）。 */
  onReadonlyChange(readonly) {
    if (readonly && this.isEditing) this.stopEditing();
  }

  /** 编辑器内的退出键。Escape 不阻止冒泡也不阻止默认：画布收到后取消选中，blocker 随之恢复显示。 */
  onEditorKeydown(e) {
    if (e.isComposing) return;
    if (e.key === 'Escape') { this.stopEditing(); return; }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.stopEditing(); }
  }

  blur() {
    this.stopEditing();
    super.blur();
  }

  /** 文本卡片菜单追加编辑与转换为文件（原版 P5.showMenu）。 */
  showMenu(menu) {
    super.showMenu(menu);
    const canvas = this.canvas;
    if (canvas.readonly) return;
    menu.addItem((item) => item.setSection('canvas').setTitle(t('interface.menu.edit')).setIcon('lucide-edit')
      .onClick(() => this.startEditing()));
    menu.addItem((item) => item.setSection('canvas').setTitle(t('plugins.canvas.action-convert-to-file')).setIcon('lucide-file-input')
      .onClick(() => this.convertToFile()));
  }

  /** 转换为文件：命名弹窗 → 建 md（正文为卡片文本）→ 文件节点继承几何 → 关联边改指新节点 → 移除文本节点。 */
  convertToFile() {
    const canvas = this.canvas;
    const sourcePath = canvas.file ? canvas.file.path : '';
    const text = this.text;
    const modal = new FileNameModal(canvas.app, 'Untitled', async (name) => {
      const parent = canvas.app.fileManager.getNewFileParent(sourcePath, name);
      let file;
      try {
        file = await canvas.app.fileManager.createNewMarkdownFile(parent, name, text);
      } catch (e) {
        new Notice(String(e && e.message ? e.message : e));
        return;
      }
      const node = canvas.createFileNode({ pos: this, size: this, file, save: false, focus: false });
      for (const edge of canvas.getEdgesForNode(this)) {
        if (edge.from.node === this) edge.update({ ...edge.from, node }, edge.to);
        if (edge.to.node === this) edge.update(edge.from, { ...edge.to, node });
      }
      canvas.removeNode(this);
      canvas.selectOnly(node);
      canvas.requestSave();
    });
    modal.open();
  }
}
