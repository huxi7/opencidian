# Bases P2 静态事实

事实源：`../obsidian-114/renderer/app.js`、`app.css`、`i18n.js`。
偏移按原始 JavaScript 字符计数。未启动原版。

| 位置 | 契约 |
| --- | --- |
| app.js 3234271 | 注册 `table`、`cards`、`list`、`kanban` 四种视图。看板属于原版能力。 |
| app.js 2348250，h$ | `groupBy` 保存 `{property,direction}`。`groupOrder` 保存手动组顺序。 |
| app.js 2358200，g$ | direction 为 ASC/DESC；`summaries` 以属性名映射汇总名称。 |
| app.js 2339476，HQ | 数值汇总：Average/Min/Max/Sum/Range/Median/Stddev。通用汇总：Empty/Filled/Unique。 |
| app.js 2489646，VJ/WJ/qJ | 分组用值相等语义聚合。`groupOrder` 保留空组并排除未列出的组。 |
| app.js 3184400，F7 | 视图汇总引用内置或顶层自定义汇总名称。自定义公式用 `values` 变量。 |
| app.js 3155235，canMoveCard/toFrontmatterForGroupKey | 笔记分组调用属性写回。公式与文件字段只读；原版另支持 file.folder 移动。 |
| app.js 3155586，moveCardToColumn | `processFrontMatter` 按原属性大小写写目标组键。空组删除属性键。 |
| app.js 3138776，$8 | 封面从列表首项、文件、链接或文本解析图片。`#rrggbb` 文本为颜色封面。 |
| app.js 3145023，a7 | 图片属性键是 `image`，不是 `imageProperty`。`imageFit=contain` 时适应，否则填充。 |
| app.js 3145082，a7 | 封面高度等于卡片宽度乘 `imageAspectRatio`。卡片默认 1，看板默认 0.5。 |
| app.js 2351000，p$ | 顶层 `summaries` 保存自定义汇总公式。视图 `summaries` 只引用名称。 |
| app.js 3142848 | 卡片容器 `.bases-cards-container`，项目 `.bases-cards-item`。 |
| app.js 3152400，m7 | 看板容器 `.bases-kanban-container`。无分组显示选择分组提示。 |
| app.js 3175736，D7 | 列表选项 `markers`、`separator`、`indentProperties`。 |
| app.js 3181516，P7 | 列表项目 `.bases-list-item`，属性与嵌套属性分区。 |
| i18n.js 112738 | 配置视图、布局、视图名称、属性、分组、排序和结果上限文案。 |

## 实现接口

`queryBase` 接受 table/list/cards/kanban 四种类型。
四种类型共用筛选、排序和 limit 管线。
未知类型保留警告，不显示配置控件。
P2 读取 `{rows:[{file,context}],columns,warnings,total}`。
控制器向 queryBase 第四参数传入宿主文件。
文件视图传数据库文件。嵌入传 Markdown 文件。
分组与排序复用富值模块的相等、比较语义。
汇总复用 P3 安全公式引擎，不另写统计求值器。
内置汇总公式逐字采用 HQ 的表达式。
Average 的分母含列表空值，与原版 mean 一致。
配置弹层按名称、类型、排序、分组、属性与汇总键写回。
切换视图保存工作区状态，不更改 YAML 默认顺序。
阅读宿主隐藏时挂起订阅，重现时重读磁盘。
移除嵌入时释放订阅与 MutationObserver。
CSV 菜单调用共用导出模块，失败显示 Notice。
看板拖动只接受本控制器发出的卡片拖动。
笔记标量属性经 processFrontMatter 落盘。
写回保留属性名大小写，空组删除该属性。
同一笔记的拖放写入串行执行。
读取到无效 YAML 或过时属性时，取消写入并显示原因。
封面复用 renderBaseRichValue 的资源与失败提示。
`imageProperty` 作为兼容别名读取，配置只写 `image`。

## P2 边界

看板仅写文本、数字、复选框和空值笔记分组。
文件、公式、日期、链接、列表及对象分组只读。
原版 file.folder 跨文件夹拖动本轮未实现。
封面支持库内图片、HTTP 图片、颜色与列表首项。
库外 file:// 图片未接入。加载失败显示原因。
共享 app:// 文件协议未提供 MIME；SVG 解码失败。
失败回执：`/tmp/obs-copy-acceptance/bases-views-run-result-8qClmo/run.log`。
主代理需在 app-protocol 的响应补 `image/svg+xml`。
P2 通用封面验收用实际生成的 PNG 文件验证资源解码。
布局未实现原版虚拟滚动、列宽拖动和单元格编辑。
配置弹层支持已有组的隐藏和重排，不创建新组值。

## 实测回执

```sh
sh scripts/with-lock.sh "npm run build && node scripts/acceptance/run.mjs bases-views --no-screenshot && node scripts/acceptance/run.mjs bases --no-screenshot && node scripts/acceptance/run.mjs bases-formulas --no-screenshot"
```

构建成功。bases-views：122/122；bases：55/55；bases-formulas：34/34。
P2 回执：`/tmp/obs-copy-acceptance/bases-views-run-result-7Tl4Dh/run.log`。
P1 回执：`/tmp/obs-copy-acceptance/bases-run-result-Tp5hyC/run.log`。
P3 回执：`/tmp/obs-copy-acceptance/bases-formulas-run-result-kkLqcR/run.log`。
首轮共享上下文迁移与嵌入生命周期失败保留于临时验收目录。
未启动原版，未截图，未弹原生保存窗口。

## 共享资源修复

封面验收发现 app:// 未声明 SVG 媒体类型。
失败日志 bases-views-run-result-8qClmo 保留原问题。
主代理已在 app-protocol.js 声明 image/svg+xml。
富值场景通过真实 SVG 解码，卡片封面复用同一资源通道。

## 最终返回入口回归

未知布局显示能力边界，不提供该布局的配置控件。
保留已有视图选择器，用户能返回已支持布局，切换不改 YAML。
主代理增加三条真实事件回归，P2 最终 125 项通过。
最新回执由 /tmp/opensidian-wave2-final-p2-1022/summary.json 索引。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
