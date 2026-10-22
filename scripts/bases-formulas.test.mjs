/**
 * [INPUT]: 原始 i18n.js 函数说明、esbuild 与 Bases 纯数据模块。
 * [OUTPUT]: 返回可复跑的 JSON {pass,count,checks}；逐键验证函数、空值、类型错误与日期。
 * [POS]: Bases P3 Node 单测。固定 UTC、时钟和随机源；不启动 Electron，不执行原版脚本。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
process.env.TZ = 'UTC';
const root = path.resolve(import.meta.dirname, '..'), temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'opensidian-formula-unit-'));
try {
  const outfile = path.join(temporary, 'bases.cjs');
  await build({ stdin: { contents: `export * from './src/renderer/plugins-core/bases-expression.js'; export * from './src/renderer/plugins-core/bases-values.js'; export * from './src/renderer/plugins-core/bases-context.js';`, resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent' });
  const require = createRequire(import.meta.url), engine = require(outfile), { compileExpression, createContext, propertyValue, formatBaseValue, BaseDate, BaseLink, sortCompare } = engine;
  const files = Object.fromEntries(['Projects/Alpha.md', 'Projects/Beta.md', 'Host.md', 'Root.md'].map((name, index) => {
    const filename = name.split('/').pop(), dot = filename.lastIndexOf('.');
    return [name, { path: name, name: filename, basename: filename.slice(0, dot), extension: filename.slice(dot + 1), parent: { path: name.split('/').slice(0, -1).join('/') }, stat: { ctime: Date.UTC(2024, 1, 28, 10), mtime: Date.UTC(2024, 2, 1, 11), size: 40 + index } }];
  }));
  const caches = {
    'Projects/Alpha.md': { frontmatter: { Score: 7, status: 'open', tags: ['Work/team'], due: '2024-02-29', linked: '[[Projects/Beta]]', url: 'https://example.com', nested: { One: 1, Two: 2 }, empty: null }, tags: [{ tag: '#Work/team' }], links: [{ link: 'Beta', displayText: 'B' }], embeds: [{ link: 'Beta' }], frontmatterLinks: [{ link: 'Projects/Beta' }] },
    'Projects/Beta.md': { frontmatter: { Score: 9 }, tags: [], links: [], embeds: [] },
    'Host.md': { frontmatter: { project: 'open', Score: 99 }, links: [] },
  };
  const app = { vault: { getFileByPath: name => files[name] || null }, metadataCache: {
    getFileCache: file => caches[file.path] || {}, resolvedLinks: { 'Host.md': { 'Projects/Alpha.md': 1 } },
    getFirstLinkpathDest: (name, source = '') => {
      const clean = name.split('#')[0].replace(/^\[\[|\]\]$/g, '');
      return Object.keys(files).find(key => key === clean || key === clean + '.md') || Object.keys(files).find(key => key.split('/').pop() === clean + '.md') || (!clean ? source : null);
    },
  } };
  const context = createContext(app, files['Projects/Alpha.md'], { doubled: 'score * 2', chained: 'formula.doubled + 1' }, files['Host.md']);
  context.now = () => Date.UTC(2024, 2, 2, 12, 34, 56); context.random = () => 0.25;
  const checks = [], check = (message, test) => { test(); checks.push(message); };
  const evaluate = source => compileExpression(source)(context);
  const cases = {
    labelGlobalNow: ['now().timestamp', Date.UTC(2024, 2, 2, 12, 34, 56)],
    labelGlobalToday: ['today().hour', 0],
    labelGlobalDate: ['date("202402291430").format("YYYY-MM-DD HH:mm")', '2024-02-29 14:30'],
    labelGlobalIf: ['if(true, 7, number("invalid"))', 7],
    labelGlobalMin: ['min(3, null, 1, 2)', null], labelGlobalMax: ['max(3, null, 1, 2)', null],
    labelGlobalRandom: ['random()', 0.25], labelGlobalList: ['list([1, 2]).length', 2],
    labelGlobalLink: ['link("Projects/Beta", "B").asFile().name', 'Beta'],
    labelGlobalNumber: ['number("12.5 cats")', 12.5], labelGlobalDuration: ['duration("2w").days', 14],
    labelGlobalImage: ['image("Projects/Beta.md")', { kind: 'image', value: 'Projects/Beta.md' }],
    labelGlobalIcon: ['icon("lucide-check")', { kind: 'icon', value: 'lucide-check' }],
    labelGlobalFile: ['file("Projects/Beta").name', 'Beta'],
    labelGlobalHtml: ['html("<b>Hello</b>")', { kind: 'html', value: '<b>Hello</b>' }],
    labelGlobalEscapeHtml: ['escapeHTML("<b> & \\\"hi\\\"")', '&lt;b&gt; &amp; &quot;hi&quot;'],
    labelGlobalMarkdown: ['markdown("**Hi**")', { kind: 'markdown', value: '**Hi**' }],
    labelValueToString: ['null.toString()', 'null'], labelValueIsTruthy: ['[].isTruthy()', false],
    labelValueIsType: ['file.ctime.isType("date")', true], labelNullIsEmpty: ['missing.isEmpty()', true],
    labelStringStartsWith: ['"Alpha".startsWith("Al")', true], labelStringEndsWith: ['"Alpha".endsWith("ha")', true],
    labelStringTrim: ['"  Alpha  ".trim()', 'Alpha'], labelStringTitle: ['"heLLo wORLD".title()', 'Hello World'],
    labelStringIsEmpty: ['"".isEmpty()', true], labelStringReplace: ['"ababa".replace("a", "A")', 'AbAbA'],
    labelStringLower: ['"HELLO".lower()', 'hello'], labelStringSplit: ['"a,b,c".split(",",2)', ['a', 'b']],
    labelStringContains: ['"Alpha".contains("PH")', true], labelStringContainsAny: ['"Alpha".containsAny("x", "PH")', true],
    labelStringContainsAll: ['"Alpha".containsAll("AL", "HA")', true], labelStringSlice: ['"Alpha".slice(1,-1)', 'lph'],
    labelStringRepeat: ['"ab".repeat(2)', 'abab'], labelNumberAbs: ['(-2).abs()', 2],
    labelNumberFloor: ['2.9.floor()', 2], labelNumberCeil: ['2.1.ceil()', 3], labelNumberRound: ['2.345.round(2)', 2.35],
    labelNumberToFixed: ['2.5.toFixed(2)', '2.50'], labelNumberIsEmpty: ['0.isEmpty()', false],
    labelListIsEmpty: ['[].isEmpty()', true], labelListEarliestLatest: ['[date("2024-02-29"), date("2023-01-01")].earliest().year', 2023],
    labelListMedian: ['[1,4,2,3].median()', 2.5], labelListMean: ['[2,4].mean()', 3],
    labelListMinMax: ['[2,7,4].max()', 7], labelListSum: ['[1,null,3].sum()', 4],
    labelListStdDev: ['[2,4].stddev()', 1], labelListJoin: ['[1,null,true].join(";")', '1;null;true'],
    labelListReverse: ['[1,2].reverse()', [2, 1]], labelListFlat: ['[1,[2,[3]]].flat()', [1, 2, 3]],
    labelListUnique: ['[1,1,2].unique()', [1, 2]], labelListContains: ['[1,2].contains(2)', true],
    labelListContainsAny: ['[1,2].containsAny([4,2])', true], labelListContainsAll: ['[1,2].containsAll(1,2)', true],
    labelListSlice: ['[1,2,3].slice(1)', [2, 3]], labelListSort: ['[10,2,1].sort()', [1, 2, 10]],
    labelListMap: ['[2,3].map(value * 2 + index)', [4, 7]], labelListFilter: ['[1,2,3].filter(value > 1)', [2, 3]],
    labelListReduce: ['[1,2,3].reduce(acc + value, 10)', 16],
    labelObjectIsEmpty: ['{}.isEmpty()', true], labelObjectKeys: ['nested.keys()', ['One', 'Two']],
    labelObjectValues: ['nested.values()', [1, 2]], labelObjectMap: ['nested.map(key + value)', ['One1', 'Two2']],
    labelObjectFilter: ['nested.filter(value > 1).keys()', ['Two']], labelRegExpMatches: ['/a+/i.matches("AA")', true],
    labelDateFormat: ['date("2024-02-29T23:45:12Z").format("YYYY/MM/DD HH:mm")', '2024/02/29 23:45'],
    labelDateDate: ['date("2024-02-29T23:45:12Z").date().hour', 0], labelDateTime: ['date("2024-02-29T23:45:12Z").time()', '23:45:12'],
    labelDateRelative: ['date("2024-03-01T12:34:56Z").relative().toString()', 'a day ago'], labelDateIsEmpty: ['date("2024-02-29").isEmpty()', false],
    labelFileAsLink: ['file.asLink("Alpha label").toString()', '[[Projects/Alpha.md|Alpha label]]'],
    labelFileHasLink: ['file.hasLink(file("Projects/Beta"))', true], labelFileInFolder: ['file.inFolder("Projects")', true],
    labelFileHasTag: ['file.hasTag("missing", "work")', true], labelFileHasProperty: ['file.hasProperty("SCORE")', true],
    labelLinkLinksTo: ['link("Projects/Beta").linksTo(file("Projects/Beta"))', true], labelLinkAsFile: ['linked.asFile().name', 'Beta'],
    labelTagMatches: ['file.tags[0].matches("WORK")', true],
  };
  const original = fs.readFileSync(path.join(root, '_analysis/obsidian-114/renderer/i18n.js'), 'utf8');
  const factStart = original.indexOf('funcs:{', original.indexOf('formulas:{'));
  const factText = original.slice(factStart, original.indexOf('}},', factStart) + 1);
  const factKeys = [...factText.matchAll(/(label\w+):"/g)].map(match => match[1]);
  check('函数表逐键覆盖原始 i18n.js', () => assert.deepEqual(Object.keys(cases).sort(), factKeys.sort()));
  for (const [label, [expression, expected]] of Object.entries(cases)) check(label, () => {
    const value = evaluate(expression);
    if (expected?.kind) assert.deepEqual({ kind: value.kind, value: value.value }, expected);
    else assert.deepEqual(value, expected, expression);
  });
  const equals = (source, expected) => check(source, () => assert.deepEqual(evaluate(source), expected));
  const fails = (source, pattern) => check('拒绝 ' + source, () => assert.throws(() => evaluate(source), pattern));
  equals('date(null)', null); equals('number(null)', null); equals('list(null)', null);
  equals('min(3,null,1)', null); equals('max(3,null,1)', null); equals('min(3,1)', 1); equals('max(3,1)', 3);
  equals('min(null, number("bad"))', null); equals('number(null, number("bad"))', null); equals('missing.lower()', null); equals('missing.nonexistent(number("bad"))', null);
  equals('link(null)', null); equals('html(null)', null); equals('link("Beta",null).toString()', '[[Beta]]'); equals('file(null)', null); equals('image(null)', null); equals('duration(null)', null);
  equals('"a".startsWith(null)', null); equals('"a".replace(null, number("bad"))', null);
  equals('[1].join(null)', null); equals('[1].contains(null)', false); equals('[null].contains(null)', true);
  equals('[1,2].reduce(if(acc.isType("null"),value,acc + value),null)', 3);
  equals('[null].containsAny(null)', true); equals('[null].containsAll(null)', true); equals('file.hasTag(null)', null);
  equals('file.hasProperty(null)', null); equals('file.hasLink(null)', null); equals('/a/.matches(null)', null);
  equals('file.ctime.format(null)', null); equals('1.isType(null)', null);
  equals('null.isEmpty()', true); equals('null.isTruthy()', false); equals('null.toString()', 'null');
  equals('"abc".slice(1,null)', 'bc'); equals('[1,2,3].slice(1,null)', [2,3]); equals('2.5.round(null)', 3);
  equals('"a,b".split(",",null)', ['a','b']); equals('file.asLink(null).toString()', '[[Projects/Alpha.md]]');
  equals('true.if(7, number("bad"))', 7); equals('false.if(number("bad"), 8)', 8);
  equals('null.if(number("bad"), 9)', 9); equals('[].if(number("bad"), 10)', 10); equals('false.if(1)', null);
  equals('file.tags[0].isType("string")', true); equals('file.tags[0].isType("tag")', false);
  equals('icon("lucide-check").isType("string")', true); equals('icon("lucide-check").isType("icon")', false);
  equals('image("x.png").isType("image")', true); equals('image("x.png").isType("string")', true);
  equals('html("a").isType("html")', true); equals('link("Beta").isType("link")', true);
  equals('link("Beta").isType("string")', true); equals('this.isType("thisfile")', true);
  equals('[1,2,3].map(/a/g.matches("a"))', [true,false,true]);
  equals('[1,2,3].map(/a/y.matches("a"))', [true,false,true]);
  equals('[1,2,3].map(/a/.matches("a"))', [true,true,true]);
  equals('duration("1ms")', null); equals('duration("1millisecond")', null); equals('duration("1 milliseconds")', null);
  equals('duration("1s").milliseconds', 1000);
  equals('missing * 2', null); equals('missing + 1', null); equals('1 / missing', null);
  equals('"x" + missing', 'x'); equals('missing + "x"', 'x'); equals('missing > 1', null);
  equals('!missing', null); equals('-missing', null);
  check('同一 AST 正则实例在重复求值时保留 lastIndex', () => { const pattern = compileExpression('/a/g.matches("a")'); assert.equal(pattern(context), true); assert.equal(pattern(context), false); assert.equal(pattern(context), true); });
  fails('true.if()', /参数/); fails('false.if(1,2,3)', /参数/);
  equals('list(7)', [7]); equals('min()', null); equals('max(null)', null); equals('if(false, 1)', null);
  equals('if([], number("bad"), 8)', 8); equals('"".contains("")', false); equals('"abc".replace("", "x")', 'abc');
  equals('"abcabc".replace(/a/g, "A")', 'AbcAbc'); equals('"A-B C".split(/[- ]/)', ['A', 'B', 'C']);
  equals('[].sum()', null); equals('[null,"1"].min()', null); equals('[2,null,4].mean()', 2);
  equals('[date("2024-01-01"),date("2024-02-01")].latest().month', 2);
  equals('[7,2,4].min()', 2); equals('[1,2,9].median()', 2); equals('[].earliest()', null);
  equals('[[1],[2,1]].flat().unique()', [1, 2]); equals('[3,4][-1]', 4);
  equals('[1,2].map([10,20].map(value + index))', [[10, 21], [10, 21]]);
  equals('nested.filter(value == 1).map(key)', ['One']); equals('{}.map(value)', []);
  equals('{}.filter(true).isEmpty()', true); equals('[].reduce(acc + value, 9)', 9);
  equals('[link("Projects/Beta")].contains("[[Beta]]")', true);
  equals('file.links[0].linksTo(file("Projects/Beta"))', true); equals('file.links.length', 3);
  equals('file.embeds[0].asFile().name', 'Beta'); equals('file.backlinks[0].asFile().name', 'Host');
  equals('file.tags.contains("WORK")', true); equals('file.inFolder("/")', true); equals('file.inFolder("Other")', false);
  equals('file.hasLink("Unknown")', false); equals('file("missing")', null); equals('link("missing").asFile()', null);
  equals('image(link("missing"))', null); equals('link("https://example.com").isType("string")', true);
  equals('file.file == file', true); equals('file.properties.Score', 7); equals('SCORE', 7); equals('nested.one', 1);
  equals('formula.CHAINED', 15); equals('this.project', 'open'); equals('this.note.Score', 99); equals('this.file.name', 'Host');
  equals('this.formula.doubled', 198); equals('file(this).file.name', 'Host');
  equals('due.isType("date")', true); equals('linked.isType("link")', true); equals('url.isType("url")', true);
  equals('date("bad")', null); equals('date("2023-02-29").format("YYYY-MM-DD")', '2023-03-01'); equals('date("20240229").day', 29);
  equals('date("20230229").format("YYYY-MM-DD")', '2023-03-01');
  equals('date("20231301").format("YYYY-MM-DD")', '2024-01-01');
  equals('date("2024-02-30T03:04:05Z").format("YYYY-MM-DD HH:mm:ss")', '2024-03-01 03:04:05');
  equals('date("2023-13-01").isType("date")', true);
  equals('date("2023-13-01").toString()', '0NaN-NaN-NaN');
  equals('date("2023-13-01").time()', 'NaN:NaN:NaN');
  equals('(date("2024-01-01") + duration("P1.9Y2.8M3.7W4.6DT5.9H6.8M7.7S")).format("YYYY-MM-DD HH:mm:ss")', '2025-03-26 05:06:07');
  equals('duration("P3.7W4.6DT").days', 25);
  equals('duration("PT5.9H6.8M7.7S").seconds', 5 * 3600 + 6 * 60 + 7);
  equals('duration("PT1,9H").hours', 1);
  equals('duration("prefix P2.9DT suffix").days', 2);
  equals('duration("P1.5D")', null);
  equals('duration("PT").isTruthy()', false);
  equals('date("2024-02-29T08:30:00+08:00").timestamp', Date.UTC(2024, 1, 29, 0, 30));
  equals('date("2024-02-29") + "1y" == date("2025-03-01")', true);
  equals('(date("2024-02-28") + duration("1d")).day', 29); equals('(date("2024-03-01") - duration("1d")).day', 29);
  equals('(date("2024-03-01") - date("2024-02-28")).days', 2); equals('date("2024-02-29") == "2024-02-29"', true);
  equals('duration("P1Y2M3DT4H").isTruthy()', true); equals('duration("bad")', null); equals('duration("0d").isTruthy()', false);
  equals('number(date("2024-02-29"))', Date.UTC(2024, 1, 29)); equals('number(true)', 1);
  equals('null.isType("null")', true); equals('null == missing', true); equals('0.isTruthy()', false); equals('[].isType("list")', true);
  equals('"a".reverse()', 'a'); equals('"a".upper()', 'A'); equals('2 ** 3 ** 2', 512); equals('1e2 + .5', 100.5);
  equals('false && number("bad")', false); equals('true || number("bad")', true);
  for (const source of ['now(1)', 'if(true)', 'list(1,2)', 'file.hasLink()', 'file.hasProperty(4)', '"a".startsWith(1)', '[1].slice("1")', '"a".repeat(-1)', '1.toFixed(101)', 'number("bad")', 'date(1)', '1 + true', 'true - 1', '[1][0.5]', 'file.foo', 'unknownFn()']) fails(source, /参数|类型|函数|需要|无法|索引|属性|上限|digits/);
  for (const source of ['file.constructor', 'note["__proto__"]', 'this.prototype', 'file.owner()', 'file.access("path")', 'file.app', 'file["owner"]', 'process.exit()', 'require("fs")', 'globalThis', 'new Date()', 'x => x', '/(a+)+/.matches("aaa")']) {
    if (source === 'globalThis' || source === 'process.exit()') equals(source, null); else fails(source, /禁止|函数|属性|表达式|重复/);
  }
  fails('[1,2,3,4,5,6,7,8,9,10].map([1,2,3,4,5,6,7,8,9,10].map([1,2,3,4,5,6,7,8,9,10].map([1,2,3,4,5,6,7,8,9,10].map([1,2,3,4,5,6,7,8,9,10].map(value)))))', /运算上限/);
  check('同一数据库公式 AST 跨行保留正则状态且结果仍按行缓存', () => {
    const shared = { pattern: '/a/g.matches("a")' };
    const first = createContext(app, files['Projects/Alpha.md'], shared), second = createContext(app, files['Projects/Beta.md'], shared);
    assert.equal(propertyValue(first, 'formula.pattern'), true); assert.equal(propertyValue(second, 'formula.pattern'), false);
    assert.equal(propertyValue(first, 'formula.pattern'), true);
  });
  check('公式循环检测', () => { const cyclic = createContext(app, files['Root.md'], { a: 'formula.b', b: 'formula.a' }); assert.throws(() => propertyValue(cyclic, 'formula.a'), /循环/); });
  check('缺少宿主的 this 返回 null', () => assert.equal(compileExpression('this')(createContext(app, files['Root.md'])), null));
  check('格式化日期和链接不会泄漏对象字段', () => { assert.equal(formatBaseValue(propertyValue(context, 'file.ctime')), '2024-02-28T10:00:00'); assert.equal(formatBaseValue(propertyValue(context, 'file.file')), 'Projects/Alpha.md'); });
  check('日期比较按毫秒而非本地化字符串', () => assert.ok(sortCompare(new BaseDate('2024-01-01'), new BaseDate('2023-12-31')) > 0));
  check('链接解析接受仓库真实 string API', () => assert.equal(new BaseLink('Beta', null, app).resolve(), files['Projects/Beta.md']));
  console.log(JSON.stringify({ pass: true, count: checks.length, functionLabels: factKeys.length, checks }, null, 2));
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
