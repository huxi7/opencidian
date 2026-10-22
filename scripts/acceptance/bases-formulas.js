/**
 * [INPUT]: 隔离 Electron、真实 MetadataCache、数据库公式和 Markdown 嵌入宿主。
 * [OUTPUT]: 返回 {pass,count,checks}；验证富值属性、文件解析、公式、日期与 this 宿主语义。
 * [POS]: Bases P3 集成验收。运行器必须传 --no-screenshot；不唤起外部应用或系统窗口。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
(async () => {
  const checks = [], check = (value, message) => { if (!value) throw Error(message); checks.push(message); };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (predicate, message) => { for (let i = 0; i < 200; i++) { if (predicate()) return; await sleep(25); } throw Error(message); };
  const yaml = require('js-yaml');
  await app.plugins.enableInternalPlugin('bases');
  await app.vault.createFolder('Formula');
  const alpha = await app.vault.create('Formula/Alpha.md', '---\nScore: 7\nstatus: open\ndue: "2024-02-29"\nlinked: "[[Formula/Beta]]"\ntags: [work/team]\nnested: {a: 1, b: 2}\n---\n# Alpha\n\n[[Beta]] ![[Beta]] #work/team\n');
  const beta = await app.vault.create('Formula/Beta.md', '---\nScore: 9\ndue: "2023-12-31"\n---\n# Beta\n');
  const host = await app.vault.create('Formula Host.md', '---\nscope: active\nScore: 99\n---\n# Host\n\n![[Formula.base#Embedded]]\n\n[[Formula/Alpha]]\n');
  await until(() => app.metadataCache.getFileCache(alpha)?.frontmatter?.Score === 7 && app.metadataCache.getFileCache(beta)?.frontmatter?.Score === 9 && app.metadataCache.resolvedLinks?.[host.path]?.[alpha.path], '等待属性与解析链接索引');
  check(typeof app.metadataCache.getFirstLinkpathDest('Formula/Beta', '') === 'string', '验收使用仓库真实路径字符串解析 API');
  const formulas = {
    doubled: 'score * 2', lazy: 'if(true, formula.doubled, number("bad"))',
    resolved: 'file("Formula/Beta").name', fileLink: 'file.asLink("Label")',
    connected: 'file.hasLink(file("Formula/Beta"))', linkMatch: 'link("Formula/Beta").linksTo(file("Formula/Beta"))',
    linkFile: 'linked.asFile().name', incoming: 'file.backlinks.map(value.asFile().name)',
    tagged: 'file.tags.filter(value.matches("WORK")).length',
    combined: '[1,2,3].map(value + index).filter(value > 2).reduce(acc + value, 10)',
    objectMap: 'nested.map(key + value).join(",")',
    leap: '(date("2024-02-28") + "1d").format("YYYY-MM-DD")',
    delta: '(date("2024-03-01") - date("2024-02-28")).days',
    zone: 'date("2024-02-29T08:30:00+08:00").timestamp',
    typed: 'due.isType("date") && file.ctime.isType("date") && linked.isType("link")',
    host: 'this.file.name', hostScope: 'this.scope', hostScore: 'this.note.Score', hostFormula: 'this.formula.doubled',
    escaped: 'escapeHTML("<b>&</b>")', nullCheck: 'missing.isEmpty()',
    cycleA: 'formula.cycleB', cycleB: 'formula.cycleA', typeError: '"text".startsWith(42)',
    prototype: 'note["__proto__"]',
  };
  const source = yaml.dump({ formulas, filters: 'file.inFolder("Formula")', views: [
    { type: 'table', name: 'All', order: ['file.name', 'due', 'formula.doubled'], sort: [{ property: 'due', direction: 'ASC' }] },
    { type: 'table', name: 'Embedded', filters: 'this.scope == "active" && Score < this.note.Score', order: ['file.name', 'formula.hostScope', 'formula.hostScore'] },
  ] });
  const file = await app.vault.create('Formula.base', source);
  const leaf = await app.workspace.openFile(file), controller = leaf.view.controller;
  const row = controller.result.rows.find(item => item.file.path === alpha.path), context = row.context;
  const value = name => context.formula[name];
  check(controller.result.rows.length === 2, '富值公式不破坏基础文件筛选');
  check(controller.result.rows[0].file.path === beta.path, '日期排序使用富值时间顺序');
  check(context.file.access('ctime').kind === 'date' && context.file.access('mtime').kind === 'date', '创建与修改时间提供 Date 值');
  check(context.file.access('name') === 'Alpha' && context.file.access('fullname') === 'Alpha.md', '文件短名与全名保持独立');
  check(context.file.access('file') === context.file, 'file.file 返回 File 富值');
  check(context.note.due.kind === 'date' && context.note.linked.kind === 'link', '真实 frontmatter 转为日期与 Link 富值');
  check(value('doubled') === 14 && value('lazy') === 14, '大小写不敏感属性与惰性 if 共同计算公式');
  check(value('resolved') === 'Beta', 'file 函数从真实字符串路径解析 TFile');
  check(value('fileLink').toString() === '[[Formula/Alpha.md|Label]]', 'asLink 保留路径与显示名称');
  check(value('connected') === true && value('linkMatch') === true, 'hasLink 和 linksTo 使用真实解析目标');
  check(value('linkFile') === 'Beta', '属性 Link.asFile 使用真实文件');
  check(value('incoming').includes('Formula Host'), 'backlinks 为可解析 Link 列表');
  check(context.file.access('links').some(link => link.resolve()?.path === beta.path), 'file.links 包含可解析正文链接');
  check(context.file.access('embeds').some(link => link.resolve()?.path === beta.path), 'file.embeds 为可解析 Link 列表');
  check(value('tagged') === 1, 'file.tags 去重并支持不区分大小写的层级标签匹配');
  check(value('combined') === 18, 'map/filter/reduce 的 value index acc 作用域正确');
  check(value('objectMap') === 'a1,b2', '对象 map 提供 key 和 value');
  check(value('leap') === '2024-02-29' && value('delta') === 2, '固定日期覆盖闰日与日期差时长');
  check(value('zone') === Date.UTC(2024, 1, 29, 0, 30), '带时区日期转换为确定毫秒值');
  check(value('typed') === true, '真实属性与文件日期参与 isType');
  check(value('host') === 'Formula.base' && value('hostScope') === null, '独立数据库 this 指向当前 base 文件');
  check(value('escaped') === '&lt;b&gt;&amp;&lt;/b&gt;' && value('nullCheck') === true, 'HTML 转义与空值判断真实返回值');
  let cycle = false, badType = false, prototype = false;
  try { value('cycleA'); } catch (error) { cycle = /循环/.test(error.message); }
  try { value('typeError'); } catch (error) { badType = /类型错误/.test(error.message); }
  try { value('prototype'); } catch (error) { prototype = /禁止访问/.test(error.message); }
  check(cycle, '循环公式抛出明确错误'); check(badType, '错误参数类型不静默转换'); check(prototype, '表达式阻断原型访问');
  const hostLeaf = await app.workspace.openFile(host);
  await hostLeaf.view.setState({ file: host.path, mode: 'preview' });
  await until(() => hostLeaf.view.readingEl.querySelector('.bases-embed')?.basesController?.result?.rows?.length === 2, '等待阅读嵌入与宿主筛选');
  const reading = hostLeaf.view.readingEl.querySelector('.bases-embed').basesController;
  const embedded = reading.result.rows.find(item => item.file.path === alpha.path).context;
  check(embedded.formula.host === 'Formula Host', '阅读嵌入 this.file 指向宿主 Markdown');
  check(embedded.formula.hostScope === 'active' && embedded.formula.hostScore === 99, '阅读嵌入 this 属性读取真实宿主 frontmatter');
  check(embedded.formula.hostFormula === 198, 'this.formula 在宿主文件上下文求值');
  check(reading.container.textContent.includes('active') && reading.container.textContent.includes('99'), '宿主公式实际渲染到嵌入表格');
  await hostLeaf.view.setState({ file: host.path, mode: 'live' });
  await until(() => hostLeaf.view.contentEl.querySelector('.cm-content .bases-embed')?.basesController?.result?.rows?.length === 2, '等待实时预览嵌入宿主筛选');
  const live = hostLeaf.view.contentEl.querySelector('.cm-content .bases-embed').basesController;
  check(live.result.rows[0].context.formula.hostScope === 'active', '实时预览 this 同样指向宿主属性');
  check(live.result.rows[0].context.formula.hostScore === 99, '实时预览复用真实宿主属性上下文');
  await app.vault.modify(host, (await app.vault.read(host)).replace('scope: active', 'scope: inactive'));
  await until(() => app.metadataCache.getFileCache(host)?.frontmatter?.scope === 'inactive', '等待宿主属性索引更改');
  const currentLive = () => hostLeaf.view.contentEl.querySelector('.cm-content .bases-embed')?.basesController;
  await until(() => currentLive()?.result?.rows.length === 0, '等待宿主属性更改重查');
  check(currentLive().result.rows.length === 0, '修改宿主属性立即改变嵌入筛选结果');
  check((await app.vault.read(file)) === source, '公式求值与嵌入不修改原始 YAML');
  return { pass: true, count: checks.length, checks };
})()
