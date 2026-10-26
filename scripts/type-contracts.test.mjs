/**
 * [INPUT]: 全量严格配置、TypeScript 编译器及 IPC、工作区、编辑器和数据契约。
 * [OUTPUT]: 验证合法调用被接受，非法通道、文件和事件参数被拒绝。
 * [POS]: 类型契约回归；虚拟源码只存在内存，不执行应用代码。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import ts from 'typescript';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const root = process.cwd();
const config = ts.parseJsonConfigFileContent(ts.readConfigFile('tsconfig.json', ts.sys.readFile).config, ts.sys, root);
const filename = path.join(root, 'src', '__type_contract_probe__.ts');
const imports = [
  "import type { VaultWriteRequest, VaultWriteResult } from './contracts.js';",
  "import { createEl } from './renderer/core/dom.js';",
  "import { Desktop, ipcInvoke, ipcSync, ipcSend } from './renderer/core/ipc.js';",
  "import { Vault, TFolder } from './renderer/core/vault.js';",
  "import { debounce } from './renderer/core/events.js';",
  "import type { WorkspaceLayoutNode } from './renderer/core/workspace-layout.js';",
  "import type { Workspace } from './renderer/core/workspace.js';",
  "import type { Editor } from './renderer/editor/editor.js';",
  "import type { ActiveEditorHost } from './renderer/core/commands.js';",
  "import type { PropertiesOptions } from './renderer/markdown/properties.js';",
  "import type { CanvasData } from './renderer/views/canvas-types.js';",
  "declare const workspace: Workspace;",
  "declare const editor: Editor;",
  "declare const vault: Vault;",
];
const cases = [
  [true, "const invalidPath: VaultWriteRequest = { path: 42, expected: '', text: '' };", '库写入路径拒绝数字'],
  [true, "createEl('input').value = 42;", 'DOM 工厂保留字符串类型'],
  [true, "const invalidResult: VaultWriteResult = { ok: true, error: 'failed' };", '成功写入禁止错误字段'],
  [true, "Desktop.vaultOpen(42);", '库路径拒绝数字'],
  [true, "ipcSync('version', 'unexpected');", '同步通道拒绝多余参数'],
  [true, "ipcInvoke('vault-write-csa', { path: '', expected: '', text: '' });", 'IPC 拒绝拼错通道'],
  [true, "ipcSend('window-translucency', 'true');", 'IPC 拒绝错误参数类型'],
  [true, "Desktop.version().then(() => {});", '同步回执不能当 Promise'],
  [true, "Desktop.openDocumentWindow({ type: 'markdown', state: { file: 'a.md' }, size: { width: '900' } });", '文档窗口拒绝无效尺寸'],
  [true, "ipcInvoke('native-menu-popup', { token: '1', items: [] });", '菜单令牌保持真实数字协议'],
  [true, "vault.on('modfy', () => {});", '库事件拒绝拼错名称'],
  [true, "vault.trigger('rename', vault.getFiles()[0], 42);", '重命名事件要求旧路径字符串'],
  [true, "const folder: TFolder = vault.getFiles()[0];", '文件列表不能冒充文件夹'],
  [true, "debounce((value: string) => value) (42);", '防抖函数保留参数类型'],
  [true, "const invalidNode: WorkspaceLayoutNode = { type: 'tabs', children: [{ type: 'split', children: [] }] };", '标签组只包含文档叶子'],
  [true, "workspace.trigger('file-opne', null);", '工作区拒绝拼错事件名称'],
  [true, "workspace.trigger('file-open', new TFolder(vault, 'folder'));", '活动文件事件拒绝文件夹'],
  [true, "workspace.trigger('file-rename', vault.getFiles()[0], 42);", '工作区重命名事件保留路径类型'],
  [true, "workspace.addRibbonItem('x', 'x', event => event.notAKey);", '功能区回调不泄漏动态事件类型'],
  [true, "const invalidHost: ActiveEditorHost = { editor: null };", '活动编辑器宿主拒绝空编辑器'],
  [true, "editor.setValue(42);", '编辑器写入拒绝非文本'],
  [true, "const invalidProperties: PropertiesOptions = { editable: 'false' };", '属性面板开关保留布尔类型'],
  [true, "const invalidCanvas: CanvasData = { nodes: [{ id: 'x', type: 'text', x: '0', y: 0, width: 100, height: 100 }], edges: [] };", '白板几何拒绝字符串'],
  [false, "ipcSync('version').toUpperCase();", '同步回执保留字符串能力'],
  [false, "const vibrancy: 'sidebar' | null = Desktop.windowState().vibrancy;", '窗口材质保持真实枚举'],
  [false, "ipcInvoke('vault-write-cas', { path: 'a.md', expected: '', text: 'ok' }).then(result => result.ok);", '异步写入保留结果协议'],
  [false, "vault.on('rename', (file, oldPath) => { file.path.toUpperCase(); oldPath.toUpperCase(); });", '合法库事件推断参数'],
  [false, "debounce((value: string) => value)('ok');", '防抖接受合法参数'],
  [false, "const validNode: WorkspaceLayoutNode = { type: 'tabs', children: [{ type: 'leaf', state: { type: 'markdown' } }] };", '布局接受合法文档叶子'],
  [false, "workspace.on('file-open', file => { if (file) file.extension.toUpperCase(); });", '工作区订阅推断可空文件'],
  [false, "workspace.addRibbonItem('x', 'x', event => event.metaKey || event.ctrlKey);", '鼠标和键盘功能区共用修饰键'],
  [false, "const validHost: ActiveEditorHost = { editor };", '活动编辑器接受真实编辑器'],
];
const source = [...imports, ...cases.map(([, code]) => code)].join('\n');
const host = ts.createCompilerHost(config.options);
const readSource = host.getSourceFile.bind(host);
host.getSourceFile = (file, version, ...args) => file === filename
  ? ts.createSourceFile(file, source, version, true)
  : readSource(file, version, ...args);
const program = ts.createProgram([...config.fileNames, filename], config.options, host);
const errors = program.getSemanticDiagnostics(program.getSourceFile(filename));
const lines = new Set(errors.map(error => error.file.getLineAndCharacterOfPosition(error.start).line));
const checks = [];
assert.equal(config.options.strict, true, '全应用必须启用严格检查');
assert.notEqual(config.options.noCheck, true, '禁止关闭类型检查');
checks.push('全应用严格检查配置不可降级');
const explicitAny = [];
const skipped = [];
for (const file of config.fileNames) {
  const text = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const visit = node => { if (node.kind === ts.SyntaxKind.AnyKeyword) explicitAny.push(file); ts.forEachChild(node, visit); };
  visit(ast);
  if (/@ts-(?:nocheck|ignore)\b/.test(text)) skipped.push(file);
}
assert.deepEqual(explicitAny, [], '应用源码禁止显式 any');
checks.push('应用源码没有显式 any 类型');
assert.deepEqual(skipped, [], '应用源码不得跳过检查');
checks.push('应用源码没有整文件或逐行跳过检查');
for (const [index, [reject, , label]] of cases.entries()) {
  assert.equal(lines.has(imports.length + index), reject, label);
  checks.push(label);
}
assert.equal(errors.length, cases.filter(([reject]) => reject).length, ts.formatDiagnosticsWithColorAndContext(errors, { getCurrentDirectory: () => root, getCanonicalFileName: name => name, getNewLine: () => '\n' }));
process.stdout.write(JSON.stringify({ pass: true, count: checks.length, checks }));
