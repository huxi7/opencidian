/**
 * [INPUT]: esbuild、Node断言与core/user-ignore的真实规则判定器。
 * [OUTPUT]: 输出{pass,count,checks}，验证前缀、正则及配置热更新。
 * [POS]: 忽略规则边界单测。不启动Electron，不访问用户库。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'opensidian-ignore-'));
const outfile = path.join(directory, 'matcher.cjs');
const checks = [];
try {
  await build({ entryPoints: [path.resolve(import.meta.dirname, '../src/renderer/core/user-ignore.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent' });
  const { createUserIgnoreMatcher } = createRequire(import.meta.url)(outfile);
  let filters = null;
  const ignored = createUserIgnoreMatcher(() => filters);
  const check = (message, value, expected) => { assert.equal(value, expected, message); checks.push(message); };
  check('空配置不忽略笔记', ignored('Note.md'), false);
  filters = [];
  check('空数组不忽略笔记', ignored('Note.md'), false);
  filters = [' Folder/ ', '', '   '];
  check('去除规则两侧空白', ignored('Folder/A.md'), true);
  check('路径前缀不区分大小写', ignored('folder/a.md'), true);
  check('路径前缀不匹配中段目录', ignored('Other/Folder/A.md'), false);
  check('文件对象使用path字段', ignored({ path: 'Folder/A.md' }), true);
  check('无路径对象不忽略', ignored({}), false);
  check('空文件不忽略', ignored(null), false);
  filters = ['a.b/'];
  check('普通路径中的点按字面匹配', ignored('a.b/a.md'), true);
  check('普通路径中的点不是正则通配符', ignored('axb/a.md'), false);
  filters = ['/\\.tmp$/', '/^private\\//'];
  check('正则匹配文件后缀', ignored('Archive/A.TMP'), true);
  check('正则起点限制有效', ignored('Private/a.md'), true);
  check('非匹配后缀不排除', ignored('Archive/A.md'), false);
  check('重复查询不改变正则状态', ignored('Archive/A.TMP'), true);
  filters = ['/[/'];
  check('损坏正则不误排除文件', ignored('Anything.md'), false);
  filters = [null, 7, {}, 'Keep/'];
  check('损坏配置成员不影响有效规则', ignored('Keep/A.md'), true);
  check('损坏配置成员不产生字面null规则', ignored('null.md'), false);
  filters = ['Folder/'];
  check('替换规则数组立即生效', ignored('Folder/A.md'), true);
  filters[0] = 'Other/';
  check('原地修改数组后旧规则失效', ignored('Folder/A.md'), false);
  check('原地修改数组后新规则生效', ignored('Other/A.md'), true);
  filters = null;
  check('清除配置后已有结果立即失效', ignored('Other/A.md'), false);
  filters = 'invalid';
  check('错误配置类型不排除文件', ignored('invalid.md'), false);
  console.log(JSON.stringify({ pass: true, count: checks.length, checks }));
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
