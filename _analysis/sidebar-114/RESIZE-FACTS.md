# 侧栏尺寸拖动事实与修复

事实源：`_analysis/obsidian-114/renderer/app.js`。
下列偏移为 UTF-8 解码后的字符偏移。未启动原版。

## 原版契约

| 位置 | 行为 |
| --- | --- |
| 1539444 `qO=200` | 尺寸下限为 200 像素。 |
| 1540965 `setDimension` | 节点比例进入 flexGrow。 |
| 1543887 `onChildResizeStart` | 内部分隔条按方向读取 X 或 Y。 |
| 1545007 `resizeItemsByDiff` | 从最近节点向外分配收缩量。 |
| 1545262 `finishResize` | 清掉临时像素，写入各节点百分比。 |
| 1548622 `onSidedockResizeStart` | 只接受主键；指针终止时清理监听。 |

外侧栏拖动只改变该侧栏宽度。请求宽度小于 50 像素时收起。
同次拖动达到 200 像素后展开。展开宽度限制在 200 像素与工作区宽度的 80% 之间。
内部拆分保存节点 dimension。布局保存和恢复必须保留比例。

## 已证实的本地缺陷

根边界传入 rootSplit，旧实现却只把 leftSplit/rightSplit 判为侧栏。
因此根边界误走内部双栏算法，并固定中心区域的像素宽度。
侧栏内部的水平分隔条又被误认成外栏宽度拖动。
其起点读取 clientY，移动阶段却读取 clientX。

旧序列化不保存 dimension。重绘和布局恢复因此丢失拖动比例。
零位移 move 仍写临时像素，结束时因 changed=false 留下固定尺寸。

## 实现边界

`workspace-resize.js` 从根边界相邻节点的 side 识别侧栏。
根拖动只写侧栏宽度，中心保持弹性。
内部拖动使用正确坐标轴，结束时写百分比 flex 与 dimension。
未发生尺寸变化时恢复原样式，不重写 dimension。

鼠标释放、指针取消、失焦和 DOM 重建都结束当前拖动。
侧栏模型已替换时，旧手势不得改变新模型。
渲染层在重建前调用 cancelWorkspaceResize。
序列化只保存有限正数 dimension。

## 验证

- `node scripts/workspace-resize.test.mjs`：24/24。
  证据：`/tmp/opensidian-workspace-resize-unit.json`。
- `sh scripts/with-lock.sh 'npm run build && node scripts/acceptance/run.mjs sidebar-resize --no-screenshot'`：构建成功，27/27。
  证据：`/tmp/opensidian-sidebar-resize-final.log`。
  原始回执：`/tmp/obs-copy-acceptance/sidebar-resize-run-result-aoD7i1/run.log`。

首轮真实验收暴露 flex-basis:auto 重置比例。
结束态已改为百分比 flex，最新验收验证重绘与保存恢复后的实际高度。
上述证明覆盖数据、事件和 DOM 几何；不宣称已完成截图视觉验收。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
