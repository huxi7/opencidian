# Bases P3 静态事实与实现边界

事实源只读：`_analysis/obsidian-114/renderer/app.js`、`i18n.js`。
未启动原版。下述位置为 UTF-8 文本的字符 offset。

| 原版位置 | 可观察契约 | P3 对齐 |
| --- | --- | --- |
| i18n.js 119429 `formulas`、120115 `funcs` | 78 个函数说明键；含 17 个 Global、3 个 Value、1 个 Null、13 个 String、6 个 Number、19 个 List、5 个 Object、1 个 RegExp、5 个 Date、5 个 File、2 个 Link、1 个 Tag | 清单见 P3-FUNCTIONS.md；单测逐键验证无缺项 |
| app.js 2191863 `aK`、2195065 `fK` | 原版区分值类型；列表真值取决于长度；列表聚合筛选数字，mean 分母为列表长度；reverse 复制列表 | 富值与列表算术、统计和真值共用 bases-values.js |
| app.js 2199403 `gK`、2200040 附近 `yK` | 标签保留 #，层级匹配不区分大小写；笔记属性按名字不区分大小写；日期和 Wiki 链接转换为富值 | BaseTag、属性转换、ownKey |
| app.js 2201940 `wK` | 日期保留是否含时间；支持日期字段、timestamp、format/date/time/relative | BaseDate；Moment 格式化；日期毫秒排序 |
| app.js 2204154 `CK` | 年、月、日按日历运算；小时等按本地时间字段运算；支持时长字符串和 ISO 时长 | BaseDuration；原生日期字段顺序更新，闰日 +1y 为次年 3 月 1 日 |
| app.js 2207554 `MK` | file.file 返回 File；ctime/mtime 为 Date；links 含正文、嵌入和属性引用；backlinks/embeds 为 Link 列表，tags 为标签列表 | BaseFile 的只读字段与引用列表；本仓库解析路径 string 转回 TFile |
| app.js 2215895 附近 `VK` | 全局与实例函数按名字不区分大小写；函数有参数类型和数目契约 | 白名单 dispatch；未知函数与错误类型抛错 |
| app.js 2234000 附近 | map/filter/reduce 参数为表达式；列表提供 value/index，reduce 提供 acc；对象提供 key/value | 延迟参数闭包与局部 vars；嵌套回调隔离作用域 |
| app.js 2236000 附近 | Date、File、Link 和 Tag 的实例函数 | 同一函数白名单，文件解析不访问外部程序 |
| app.js 2336500 附近 | 负数列表索引从尾部读取；对象属性访问与数字索引分离 | baseAccess 验证整数与类型，阻断原型键 |
| app.js 2340442 `YQ`、2344350 附近 `QQ` | file 为当前行，this 为查询的 local 条目；this.note/this.file/this.formula 走宿主条目命名空间 | createContext 第四参数指定宿主；独立数据库传 base 文件；嵌入传 Markdown 宿主 |

## 公共接口

`bases-context.js` 导出 `createContext(app,file,formulas={},sourceFile=null)` 与 `propertyValue(context,property)`。
`bases-values.js` 导出 `formatBaseValue(value)`、`sortCompare(a,b)`、`compareBaseValues(a,b)`、`baseTruthy`、`baseEquals` 及富值类型。
`bases-expression.js` 保持 `compileExpression(source) -> fn(context)`。
`bases-values-render.js` 导出 `renderBaseRichValue(controller,parent,value,sourcePath?)`。
视图把查询得到的富值交给该函数；CSV 使用 formatBaseValue。
公式引擎不调用 eval/Function，不暴露宿主对象的任意方法。
表达式长度、嵌套深度、文本重复与回调运算均有上限。

## 明确降级

HTML 返回 Html 展示值。DOM 渲染明确标注“HTML 以源码显示”，不执行原始 HTML。
Markdown 返回 Markdown 展示值。DOM 渲染支持标准行内语法，标明原始 HTML 与嵌入未启用。
图标使用现有图标表。未知图标显示明确提示。
图片支持已存在的库内图片及 HTTP(S)/data:image。错误类型和载入失败显示明确提示。
外链只经现有 Desktop.openExternal；E2E 沿既有主进程拦截路径。
日期解析沿用原版 JavaScript Date 溢出行为。非闰年 2 月 29 日归一化为 3 月 1 日。
格式满足日期语法但构造结果无效时，仍保留 Date 富值与 NaN 字段。
ISO 时长沿用原版子串匹配和字段 parseInt 截断。ISO 分支必须含 T。
例如 P1.9DT 按 1 天计算；不含 T 的 P1.9D 不匹配。
安全正则拒绝嵌套重复量词；超限表达式抛错，不返回占位值。

## 兼容性回环

78 个说明键有测试，不代表全部边界已逐项 1:1。
本轮对照函数表达式 IQ 和运算表达式 DQ，修正以下语义。

| 静态位置 | 原版可观察契约 | 实现与回归 |
| --- | --- | --- |
| app.js 2333256、2336072，函数参数转换 | 必填具体类型或 cK 参数遇 Null 时返回 Null；Any 参数接收 Null；可选参数的 Null 按缺省参数传入；Null 上未知方法返回 Null | 参数签名逐项登记，不对 if、isEmpty、List.contains、reduce 初值盲目传播；参数按顺序求值，Null 后不再计算余参 |
| app.js 2336072，变长参数 D | min/max 的任一 Number 变长参数为 Null，整次调用返回 Null | min(3,null,1) 与 max(3,null,1) 均返回 Null；空参数仍返回 Null |
| app.js 2333256，if 特判 | if(condition,a,b) 与 condition.if(a,b) 均惰性求值 | 全局与实例形式共用分支选择；未选分支不求值 |
| app.js 2199403、2207xxx、2212626，显式 type 与继承 | Tag、Icon 没有独立 type，继承 String；Image、HTML、Link、URL 则声明独立 type，同时继承 String | isType 与渲染 kind 分离；tag/icon 名不被额外接受；image/html/link/url 及 string 继承保留 |
| app.js 2236xxx、2337xxx，RegExp.matches 与正则 AST | 同一个 AST 正则实例直接 test；全局或 sticky 标记的 lastIndex 跨循环项保留 | 闭包返回同一实例；同一数据库公式共用 AST，行结果独立缓存；重复求值与跨行断言均覆盖 |
| app.js 2206273，短时长匹配式 | 短语法只匹配 d/h/m/s/w/M/y 与完整单位名；ms 分支在正则中不可达 | 1ms、1millisecond 与 1 milliseconds 返回 Null；秒单位仍正常 |
| app.js 2329xxx，DQ/AQ/PQ | 算术任一侧为 Null 时返回 Null；字符串拼接把 Null 当空串；比较、取负和逻辑非保留 Null | missing * 2、missing + 1 与 1 / missing 返回 Null；字符串例外单独测试 |

上述兼容性不改变安全预算、HTML 源码降级与 Markdown 行内渲染边界。

## 验收

`node scripts/bases-formulas.test.mjs`：273 条断言，覆盖 78 个原版说明键。
固定 UTC、2024-03-02 12:34:56 的时钟与 0.25 随机源，不依赖当下日期。
日期断言覆盖闰日、时区偏移、日历相加、日期差、非法日期溢出与 ISO 小数截断。
`sh scripts/with-lock.sh "npm run build && node scripts/acceptance/run.mjs bases-formulas --no-screenshot"`：34 条断言。
覆盖真实 MetadataCache、文件 string 解析 API、阅读/实时预览宿主 this 与宿主修改重查。
`sh scripts/with-lock.sh "node scripts/acceptance/run.mjs bases --no-screenshot"`：55 条断言。
CSV 交付和验收由主代理合入同一 T6 提交。

REA 静态证据：`ev_7bf0d34c210ab60e6d49769deb73b5c88f3a542c510804beec525888b01a7031`。
该次 REA 只分析 i18n.js；语义图不证明运行时行为。app.js 契约以定点静态读取核对。

## CSV 与富值集成

原版 app.js 1620621 的 FF.toCSV 使用逗号、LF 和双引号转义，不加 BOM 或尾换行。
2497522 的 exportTable 使用当前列及数据，错误单元格输出空文本。
2518446 的菜单使用 lucide-file-down，默认文件名是当前视图名.csv。
本实现沿用既有 Desktop 保存通道，取消不写盘；确认后重读 .base，重算筛选、排序和 limit。
Node CSV 单测 11 项通过，覆盖转义、富值、取消、错误与最新配置。
真实 Electron 富值/CSV 场景 30 项通过，含 Link/File/Tag 导航、图标、PNG/SVG、HTML/Markdown 明确降级和命令生命周期。
HTTP(S) 使用 Desktop.openExternal；mailto/tel 使用同样受 E2E 保护的 Desktop.openUrl。
搜索插件停用时标签明确降级；复用已有搜索窗格时调用 setQuery。
SVG 资源协议补 image/svg+xml，避免合法 SVG 被浏览器拒绝解码。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
