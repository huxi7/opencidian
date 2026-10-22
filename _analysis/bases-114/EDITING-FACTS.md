# Bases 编辑与写回事实

只读事实源：`../obsidian-114/renderer/app.js`。
偏移为原始 JavaScript 字符位置。未启动原版。

| 偏移／符号 | 原版契约 |
| --- | --- |
| 3192359，表格注册事件 | `.bases-table-header-resizer` 接收单击、双击和拖动。表头 `.bases-td` 接收列重排拖动。 |
| 3207694，onTableHeaderDragstart | 按可见列顺序计算投放位置，调用 `config.setOrder`。 |
| 3210899，onTableHeaderResizerDblclick | 双击列分隔符重置当前列宽。 |
| 3211054，onTableHeaderResizerDragstart | 拖动时更新 customWidth；投放后 saveColumnSizes；取消恢复原宽。 |
| 3213839，display | 视图 `columnSize` 对象按属性名保存自定义列宽。 |
| 3227355，单元格 | `.bases-td[data-property] > .bases-table-cell` 渲染属性。点击空白把焦点交给属性编辑器，复选框自行编辑。 |
| 1766690，getFrontmatterPropertyValuesForKey | 同名属性值从真实文件属性读取，字符串与字符串列表去重排序。 |
| 1878000，SN 属性值建议 | 候选容器 `mod-property-value`。[[ 前缀切换文件链接建议。Tab 选择候选，Shift+Enter 接受原始输入。 |
| 1881000，SN.getSuggestions | 普通文本检索同名属性值；内部链接检索文件、标题和块；结果按匹配得分排序。 |
| 2509859，getAddGroupError | 组编辑器通过属性类型管理器选择笔记属性输入类型。 |
| 2510122，startAddGroup | `.bases-group-add-line` 显示新组输入。新值加入组列表，不创建假笔记。 |
| 3155235，isReadOnly/canMoveCard | 公式与文件字段只读，`file.folder` 例外。文件夹组调用真实文件移动。 |
| 3155374，toFrontmatterForGroupKey | 富值转换为 frontmatter。multitext 目标标量转换为单项列表。 |
| 3155596，moveCardToColumn | 保留原属性名大小写。空值删除键。文件夹目标必须存在。 |

## 本次实现边界

`bases-edit-store.js` 按应用与文件路径串行配置写入。
真实文件通过主进程 vault-write-cas 比较并原子替换。
跨窗口冲突重读并重算，最多重试 8 次。
持续冲突拒写并显示原因，后续队列继续可用。
每次写入重读文件，再按唯一视图名称定位。
视图外部重排不改变写入目标。
外部重命名、删除和重复名称拒绝猜测目标。
自身重命名成功后，队列继续跟随新名称。
后台写入完成不抢回用户已切换的视图。
`patchViewKey` 合并最新配置对象的一个属性键。
列宽和列重排分别写 `columnSize` 与 `order`。
未知顶层键、视图键和值继续保留。

`bases-edit-values.js` 共用表格与看板写入语义。
笔记属性写入走 FileManager.processFrontMatter。
无效 YAML、缺少结束分隔符和数组属性头拒绝写入。
写入前比较最新属性与用户开始操作时的值。
过时操作拒绝覆盖新值，并显示错误原因。
日期转换为 ISO 文本，链接转换为 wikilink 文本。
列表递归转换元素；对象值保持只读。
属性名大小写保持原样，空输入删除属性。
多值属性标量目标转换为单项列表。
文件夹移动复用 FileManager.renameFile。
目标存在且路径合法后才移动；失败显示原因。
公式与其它文件属性继续只读。

表格笔记属性支持双击、Enter、F2 编辑。
Escape 取消，Enter 或失焦保存。
复选框单击直接写布尔值。
YAML Date 按原始 ISO 日或秒初始化原生输入。
未改动输入不写盘，保留原始日期类型与 CSV 语义。
列表输入支持逗号列表与 JSON 数组。
编辑器服从库级 PropertyTypes 的显式类型。
库级类型变化后自动重绘；关闭时释放类型事件订阅。
同名属性值、标签、文件和文件夹提供候选建议。
候选支持方向键、Enter、Tab 和指针选择。
Escape 先关闭候选，再取消单元格编辑。
候选使用 mod-property-value 与 listbox/combobox 语义。
编辑器销毁时释放 body 浮层与全部全局监听。
列宽支持指针拖动、键盘左右与双击重置。
列重排使用真实 DataTransfer 与 DOM 拖放。
用户编辑期间，元数据刷新延后到保存或取消。
表格与列表超过 200 条时窗口化显示。
每次重绘和关闭释放滚动、ResizeObserver 与指针监听。
查询缓存按笔记路径失效，未变化行复用上下文。
跨文件与时钟表达式在文件变化时保守全量失效。

新组按当前属性类型校验输入。
新组只写 groupOrder，不创建文件或占位卡片。
看板日期、链接、列表、空值和文件夹可拖放。
拖放只接受当前控制器产生的卡片载荷。

## 验证

Node 单测：`node scripts/bases-editing.test.mjs`。
真实场景：`node scripts/acceptance/run.mjs bases-editing --no-screenshot`。
Node 最终 52 条通过，编辑场景最终 86 条通过。
真实 Electron 生命周期回归 10 条通过。
最终命令和回执由主代理写入 RESULTS.md。

## 限制

文件没有稳定视图 ID。外部重命名必须重新选取视图。
同名视图仍可读取，修改时必须先消除名称歧义。
主进程 CAS 协调本应用多个窗口。
任意外部编辑器不遵循应用队列。
链接候选支持文件、别名、真实标题与已有块 ID。
候选不为没有 ID 的段落创建新块 ID。
本轮以静态结构和交互断言验证，未做截图像素比较。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
