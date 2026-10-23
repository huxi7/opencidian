# 侧栏对齐事实

证据来自 1.14.4 静态包。未启动原版应用。

## 原版默认行为

- `renderer/app.css:8300-8306`：共享 `.nav-buttons-container` 为 flex，主轴居中。
- `renderer/app.css:9574-9583`：`.nav-header` 内边距 8px。按钮行换行，间距 2px。
- `renderer/app.js` UTF-16 偏移 `1476750`：QL 建立 `.nav-header > .nav-buttons-container`，不写对齐内联样式。
- `renderer/app.css:6934-6942`：顶部标签组使用 `flex: 0 1 auto`。
- `renderer/app.css:7170-7173`：标签组后方的 spacer 伸展。
- `renderer/app.js` UTF-16 偏移 `1555248`、`1556136`：标签组在前，spacer 在后。
- `renderer/app.css:7256-7261`：侧栏标签组禁止拖窗；内边距为 `1px 0 7px`，间距 3px。

## 用户指定行为

所有侧栏导航工具栏固定靠左。此要求覆盖原版居中默认值。

统一规则为 `.mod-sidedock .nav-buttons-container`。
覆盖文件树、书签、标签、反链和全部属性。中心面板保留居中。
2026-10-23 补修：此前只覆盖文件树，遗漏同类侧栏面板。
新增 sidebar-toolbars 验证两侧、明暗、真实拖宽及逐项收展。

顶部侧栏标签组继续使用原版自然宽度和末尾 spacer。
补齐标签组的 `-webkit-app-region: no-drag`，避免间隙成为拖窗区。

## 验证边界

`sidebar-chrome` 通过根分隔条的真实鼠标事件改变侧栏宽度。
在 260、420、640px 下断言首工具按钮和首标签的相对左缘不变。
场景建立七十篇临时笔记，断言文件树实际滚动且两个工具区位置不变。
场景退出前删除临时夹具并恢复侧栏宽度。

2026-10-23 实测：`sidebar-chrome` 97 条，`sidebar-shell` 61 条，均通过。
两场景经 `scripts/with-lock.sh` 执行，并带 `--no-screenshot`。
拖宽验收使用主线根分隔条修复后的最新构建。

只验证应用内 DOM 几何和计算样式。未声明与原版运行态像素一致。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
