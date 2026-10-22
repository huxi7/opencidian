# 属性 1.14.4 静态对照

事实源：`_analysis/obsidian-114/renderer/app.js`。偏移为 UTF-8 解码后的字符索引。只读原始包，没有启动原版。

| 锚点 | 字符偏移 | 契约 | 实现 |
| --- | ---: | --- | --- |
| `UR=Object.freeze` | 1767804 | aliases、cssclasses、tags 为保留类型；其他键忽略大小写 | properties-types.js 的 reserved 与 getAssignedWidget |
| `QR` | 1768373 附近 | 类型配置读取 `.obsidian/types.json` 的 `{types:{name:widget}}`；保留显示键名 | properties-types.js 的 loadData/_save |
| `getTypeInfo` | 1771800 附近 | 不兼容时 expected 保留赋值类型，inferred 使用实际值类型；空值使用库级类型 | properties-types.js 的 getTypeInfo |
| `showPropertyMenu=function` | 1859054 | 分节 title/action/action.changeType/selection/clipboard/空/danger；类型子菜单、桌面剪切复制粘贴、移除 | properties-menu.js |
| `handleUpdateKey` | 1862100 附近 | 属性键不可空，不可与现有键忽略大小写重复 | properties.js 的 bindKeyInput |
| `renderProperty` | 1862600 附近 | 图标使用 expected；不兼容显示警告；编辑器使用 inferred | properties.js 的 renderPropertyRow |
| `IN=function` | 1885097 | 类型赋值后，值不兼容时弹 Display as type；取消不改值，确认转成目标编辑格式 | properties-menu.js 的 promptAdaptation |

类型列表按原版可选顺序保留 aliases、checkbox、date、datetime、multitext、number、tags、text。file、folder、property 的 reservedKeys 为空；原版属性菜单不展示这三个内部控件。

原版图标：text=lucide-text、number=lucide-binary、multitext=lucide-list、checkbox=lucide-check-square、date=lucide-calendar、datetime=lucide-clock、aliases=lucide-forward、tags=lucide-tags。

文本控件对齐 `iN`：`.metadata-input-longtext[contenteditable=true]` 支持多行。日期使用原版 `input[type=date]`；日期时间使用 `input[type=datetime-local]`；复选框使用 `.metadata-input-checkbox`，不再复用设置开关。

剪贴板语义：作用于输入框或文档的当前选区。无可编辑目标时禁用剪切、粘贴。菜单不伪造整行复制。Electron 剪贴板绕过窗口未聚焦时 Chromium Clipboard API 的权限限制。

当前边界：未知类型配置原样保留。对象型 frontmatter 显示 JSON；不提供会损坏对象结构的标量编辑器。保留类型不允许改成其他类型。类型切换不会批量转换同名属性的所有笔记。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
