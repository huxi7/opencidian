/**
 * [INPUT]: 项目 tsconfig、TypeScript 编译器及公开 DOM/写入契约。
 * [OUTPUT]: 验证错误字段类型和非法成功结果会被编译器拒绝。
 * [POS]: 类型契约回归；虚拟源码只存在内存，不执行应用代码。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import ts from 'typescript';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = process.cwd();
const config = ts.parseJsonConfigFileContent(ts.readConfigFile('tsconfig.json', ts.sys.readFile).config, ts.sys, root);
const filename = path.join(root, 'src', '__type_contract_probe__.ts');
const source = [
  "import type { VaultWriteRequest, VaultWriteResult } from './contracts.js';",
  "import { createEl } from './renderer/core/dom.js';",
  "const invalidPath: VaultWriteRequest = { path: 42, expected: '', text: '' };",
  "createEl('input').value = 42;",
  "const invalidResult: VaultWriteResult = { ok: true, error: 'failed' };",
].join('\n');
const host = ts.createCompilerHost(config.options);
const readSource = host.getSourceFile.bind(host);
host.getSourceFile = (file, version, ...args) => file === filename
  ? ts.createSourceFile(file, source, version, true)
  : readSource(file, version, ...args);
const program = ts.createProgram([...config.fileNames, filename], config.options, host);
const errors = program.getSemanticDiagnostics(program.getSourceFile(filename));
const lines = new Set(errors.map(error => error.file.getLineAndCharacterOfPosition(error.start).line));
const checks = [];
for (const [line, label] of [[2, '库写入路径拒绝数字'], [3, 'DOM 工厂保留 input.value 的字符串类型'], [4, '成功写入结果禁止携带错误信息']]) {
  assert.ok(lines.has(line), label);
  checks.push(label);
}
assert.equal(errors.length, 3, ts.formatDiagnosticsWithColorAndContext(errors, { getCurrentDirectory: () => root, getCanonicalFileName: name => name, getNewLine: () => '\n' }));
process.stdout.write(JSON.stringify({ pass: true, count: checks.length, checks }));
