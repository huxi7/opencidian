# 文件视图动作静态对照

事实源为 `_analysis/obsidian-114/renderer/app.js`。
下列偏移按 UTF-8 解码后的 Python 字符索引计算。
本轮未运行原版，也未做截图或像素对照。

## 默认应用入口

- `2889152`：workspace 的 `file-menu` 监听添加默认应用项。
  该项位于 `system` 段，图标为 `lucide-arrow-up-right`。
- `3919812`：命令登记 `open-with-default-app:open`。
- `1237696`：View 构造器添加竖三点更多按钮。
- `3086125`：MarkdownView 另添加模式按钮。
- `actionOpenFile()` 在整份脚本只出现于文件菜单和命令登记。
  原版没有把此动作加入文件视图头。

本轮删除默认应用头按钮。文件菜单保留该项。
本轮未新增默认应用命令。

## 通用动作与菜单

- `1239001`：`View.addAction` 创建 `button`。
  `mousedown` 阻止默认聚焦，点击支持左键和中键。
- `1237696`：更多图标为 `lucide-more-vertical`。
- `1239291`：`onMoreOptions` 先建立固定分节与两个子菜单。
  随后调用 `onPaneMenu(menu, 'more-options')`、
  `onMoreOptionsMenu(menu)`、workspace 的 `leaf-menu`。
  菜单锚定按钮，重复点击活动按钮不会再次打开。
- `2630364`：FileView 的面板菜单先追加重命名和删除。
  随后触发 `file-menu`，携带文件、来源和所属叶子。
- `3427091`：CanvasView 调用父类面板菜单后追加导出图片。

本轮让文件视图共用此链。Markdown 追加模式、属性、查找项。
画布追加导出项。Bases 与媒体继承文件面板项。
标签菜单继续独立提供关闭与锁定，不把它们误搬到头菜单。
重命名弹层复用 FileNameModal，文件写盘复用 FileManager。

## 模式动作

- `3093073`：`onSwitchView` 复制当前状态并反转模式。
  Mod 动作调用 `createLeafBySplit`，保留来源叶子。
- `2925252`：`splitLeaf` 缺省方向为 `vertical`。
  桌面动作因此创建右侧叶子，尽管提示文字写新标签页。
- 源码与实时预览属于编辑态。阅读副本保留源码偏好，
  再切回编辑时恢复原编辑模式。
- `1782482`：重命名弹层以 `file.basename` 初始化。
- `1412835`：文件新路径使用 `Ol(name, extension)`。
- `543815`：`Ol` 在用户输入后附加原扩展名。

## 验证边界

`view-actions` 验证七类文件头、事件顺序、受保护 IPC、
按钮聚焦、焦点保护、中键、Mod 目标模式与源码偏好。
`view-header` 验证模式钮、结构、颜色、面包屑与导航。
`small-gaps` 保留文件菜单默认应用通道断言。
测试使用临时库，均带 `--no-screenshot`。

原生 button 的 Enter/Space 默认动作交给 Chromium。
本轮仅验证 DOM 语义与聚焦，未注入真实系统键盘事件。
叶子间联动分组没有完整 API，本轮未声称复刻该能力。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
