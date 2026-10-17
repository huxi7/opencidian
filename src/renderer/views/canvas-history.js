/**
 * [INPUT]: 无依赖。
 * [OUTPUT]: 导出 CanvasHistory：有界快照栈（canUndo/undo/canRedo/redo/push/replace/clear）。
 * [POS]: views/ 画布撤销历史的存储层（原版 a5 的移植）。条目为 getData() 的全量 JSON 对象；
 *        画布在 requestSave 时防抖推进历史，撤销/重做经 importData 重建节点且不产生新条目。
 *        上限 100，超限从最旧条目丢弃。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Bounded snapshot stack for canvas undo/redo. */

export class CanvasHistory {
  constructor(max) {
    this.data = [];
    this.current = 0;
    this.max = max;
  }

  canUndo() { return this.current > 0; }

  undo() {
    if (!this.canUndo()) return null;
    this.current -= 1;
    return this.data[this.current];
  }

  canRedo() { return this.current < this.data.length - 1; }

  redo() {
    if (!this.canRedo()) return null;
    this.current += 1;
    return this.data[this.current];
  }

  push(entry) {
    const data = this.data;
    // 从历史中间 push 会截断重做尾部
    if (data.length - 1 > this.current) data.length = this.current + 1;
    data.push(entry);
    if (data.length >= this.max) data.shift();
    this.current = data.length - 1;
  }

  /** 用当前数据替换当前条目（加载期修正后避免撤销回到修正前）。 */
  replace(entry) {
    const data = this.data;
    if (data.length === 0) {
      data.push(entry);
      this.current = 0;
    } else {
      data[this.current] = entry;
    }
  }

  clear() {
    this.data.length = 0;
    this.current = 0;
  }
}
