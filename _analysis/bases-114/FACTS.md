# Bases 1.14.4 静态事实

只读事实源：`_analysis/obsidian-114/renderer/app.js`、`app.css`、`i18n.js`。
以下 offset 是原始 UTF-8 文本的字符偏移。没有启动原版应用。

| 原版位置 | 可观察契约 | P1 对齐 |
| --- | --- | --- |
| app.js 3229455，`e9` | id=bases，defaultOn=true；新建命令 bases:new-file；图标 lucide-layout-list | 核心插件、base 扩展、新建 YAML 表格 |
| app.js 3231700 附近，`onEnable` | base 扩展登记视图与 embedRegistry；嵌入的 # 后部分指定 viewName | 文件视图与 mountBaseEmbed 共用控制器 |
| app.js 2356869，`d$` | filters 为表达式字符串或仅含 and/or/not 之一的对象；每组必须为数组；递归解析 | 递归验证；and=全部，or=任一，not=全部不匹配 |
| app.js 2357862，`g$` | 每个 view 必须有字符串 name/type；order 属性数组；sort 接受 property 或旧 column；direction 为 ASC/DESC；limit>0 | table 属性列、稳定多键排序、结果上限 |
| app.js 2357598，`f$`/`v$` | note.x 是笔记属性；file.x/formula.x 独立命名空间；普通 x 等价 note.x | 读取 note/file/formula 属性 |
| app.js 2346088，`r$` | not 数组逐项检测，任一匹配即 false | not=全部不匹配 |
| app.js 2348000 附近，`s$`/`l$` | 默认排序 file.name ASC；默认列仅 file.name | 新建表格不自动暴露所有属性 |
| app.js 2342415，`FILE_PROPERTIES` | file/file.name/basename/fullname/path/folder/ext/ctime/mtime/size/links/backlinks/embeds/tags | P1 提供基础值；完整类型语义留 P3 |
| app.js 3235000 附近，`base:query` | 枚举 getMarkdownFiles，结合全局与视图筛选，排序后返回数据 | 每行对应笔记；全局和视图筛选取交集 |
| app.js 3192164，`q7` | bases-thead、bases-table-container、bases-td、bases-rendered-value | 表格类名与主题变量一致 |
| i18n.js 112738，`plugins.bases` | 未知视图类型、无法计算筛选、公式循环等错误有明确文案 | 未知视图显示降级；未知表达式不产生假筛选结果 |
| i18n.js，`formulas.funcs` | 提供完整函数语言；P3 才对齐完整函数表 | P1 仅安全表达式子集，其余函数明确报错 |

## 保留契约

BaseDocument 保留完整 YAML 数据树。没有操作时不写文件。
块式 YAML 修改具体键时，只替换该键区段。
流式或短横线内首键修改时，只重写最近顶层区段。
后者保留未知数据，不能保证该区段的注释及排版。
顶层流式 YAML 或修改锚点定义时，重写文档以保持别名值完整。
别名先展开为独立值，修改目标键不会误改未知别名键。
未知顶层键、未知视图及其字段，不因筛选/排序修改而删除。

## P1 边界

表格显示笔记属性，不提供单元格编辑。
列表、卡片、看板、分组、汇总及配置弹层留 Wave 2。
分组/汇总配置保留，当前显示明确平铺降级提示。
完整公式函数、日期类型及 CSV 留 P3。
P1 的公式与筛选只执行白名单，禁止 eval/Function。
