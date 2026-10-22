# Bases P3 函数覆盖清单

事实源：`i18n.js` 的 `formulas.funcs`。原始说明键共 78 个。
单测：`node scripts/bases-formulas.test.mjs`。每个说明键均有对应断言。
说明键可覆盖两个实例函数，如 earliest/latest 与 min/max；额外别名单独测试。
下表 min/max 的含 Null 示例，预期结果均为 Null；不能按忽略空项的列表汇总解释。

| 原版说明键 | 单测表达式 |
| --- | --- |
| `labelGlobalNow` | `now().timestamp` |
| `labelGlobalToday` | `today().hour` |
| `labelGlobalDate` | `date("202402291430").format("YYYY-MM-DD HH:mm")` |
| `labelGlobalIf` | `if(true, 7, number("invalid"))` |
| `labelGlobalMin` | `min(3, null, 1, 2)` |
| `labelGlobalMax` | `max(3, null, 1, 2)` |
| `labelGlobalRandom` | `random()` |
| `labelGlobalList` | `list([1, 2]).length` |
| `labelGlobalLink` | `link("Projects/Beta", "B").asFile().name` |
| `labelGlobalNumber` | `number("12.5 cats")` |
| `labelGlobalDuration` | `duration("2w").days` |
| `labelGlobalImage` | `image("Projects/Beta.md")` |
| `labelGlobalIcon` | `icon("lucide-check")` |
| `labelGlobalFile` | `file("Projects/Beta").name` |
| `labelGlobalHtml` | `html("<b>Hello</b>")` |
| `labelGlobalEscapeHtml` | `escapeHTML("<b> & \"hi\"")` |
| `labelGlobalMarkdown` | `markdown("**Hi**")` |
| `labelValueToString` | `null.toString()` |
| `labelValueIsTruthy` | `[].isTruthy()` |
| `labelValueIsType` | `file.ctime.isType("date")` |
| `labelNullIsEmpty` | `missing.isEmpty()` |
| `labelStringStartsWith` | `"Alpha".startsWith("Al")` |
| `labelStringEndsWith` | `"Alpha".endsWith("ha")` |
| `labelStringTrim` | `"  Alpha  ".trim()` |
| `labelStringTitle` | `"heLLo wORLD".title()` |
| `labelStringIsEmpty` | `"".isEmpty()` |
| `labelStringReplace` | `"ababa".replace("a", "A")` |
| `labelStringLower` | `"HELLO".lower()` |
| `labelStringSplit` | `"a,b,c".split(",",2)` |
| `labelStringContains` | `"Alpha".contains("PH")` |
| `labelStringContainsAny` | `"Alpha".containsAny("x", "PH")` |
| `labelStringContainsAll` | `"Alpha".containsAll("AL", "HA")` |
| `labelStringSlice` | `"Alpha".slice(1,-1)` |
| `labelStringRepeat` | `"ab".repeat(2)` |
| `labelNumberAbs` | `(-2).abs()` |
| `labelNumberFloor` | `2.9.floor()` |
| `labelNumberCeil` | `2.1.ceil()` |
| `labelNumberRound` | `2.345.round(2)` |
| `labelNumberToFixed` | `2.5.toFixed(2)` |
| `labelNumberIsEmpty` | `0.isEmpty()` |
| `labelListIsEmpty` | `[].isEmpty()` |
| `labelListEarliestLatest` | `[date("2024-02-29"), date("2023-01-01")].earliest().year` |
| `labelListMedian` | `[1,4,2,3].median()` |
| `labelListMean` | `[2,4].mean()` |
| `labelListMinMax` | `[2,7,4].max()` |
| `labelListSum` | `[1,null,3].sum()` |
| `labelListStdDev` | `[2,4].stddev()` |
| `labelListJoin` | `[1,null,true].join(";")` |
| `labelListReverse` | `[1,2].reverse()` |
| `labelListFlat` | `[1,[2,[3]]].flat()` |
| `labelListUnique` | `[1,1,2].unique()` |
| `labelListContains` | `[1,2].contains(2)` |
| `labelListContainsAny` | `[1,2].containsAny([4,2])` |
| `labelListContainsAll` | `[1,2].containsAll(1,2)` |
| `labelListSlice` | `[1,2,3].slice(1)` |
| `labelListSort` | `[10,2,1].sort()` |
| `labelListMap` | `[2,3].map(value * 2 + index)` |
| `labelListFilter` | `[1,2,3].filter(value > 1)` |
| `labelListReduce` | `[1,2,3].reduce(acc + value, 10)` |
| `labelObjectIsEmpty` | `{}.isEmpty()` |
| `labelObjectKeys` | `nested.keys()` |
| `labelObjectValues` | `nested.values()` |
| `labelObjectMap` | `nested.map(key + value)` |
| `labelObjectFilter` | `nested.filter(value > 1).keys()` |
| `labelRegExpMatches` | `/a+/i.matches("AA")` |
| `labelDateFormat` | `date("2024-02-29T23:45:12Z").format("YYYY/MM/DD HH:mm")` |
| `labelDateDate` | `date("2024-02-29T23:45:12Z").date().hour` |
| `labelDateTime` | `date("2024-02-29T23:45:12Z").time()` |
| `labelDateRelative` | `date("2024-03-01T12:34:56Z").relative().toString()` |
| `labelDateIsEmpty` | `date("2024-02-29").isEmpty()` |
| `labelFileAsLink` | `file.asLink("Alpha label").toString()` |
| `labelFileHasLink` | `file.hasLink(file("Projects/Beta"))` |
| `labelFileInFolder` | `file.inFolder("Projects")` |
| `labelFileHasTag` | `file.hasTag("missing", "work")` |
| `labelFileHasProperty` | `file.hasProperty("SCORE")` |
| `labelLinkLinksTo` | `link("Projects/Beta").linksTo(file("Projects/Beta"))` |
| `labelLinkAsFile` | `linked.asFile().name` |
| `labelTagMatches` | `file.tags[0].matches("WORK")` |

额外断言覆盖 latest、min、String.reverse/upper、惰性 if、作用域嵌套、原型阻断与运算预算。
HTML/Markdown/image 返回显式展示值；渲染降级边界见 P3-FACTS.md。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
