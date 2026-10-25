/**
 * [INPUT]: 共用构建配置、兼容与严格 TypeScript 检查器、esbuild 与 Electron。
 * [OUTPUT]: 首次编译后启动应用，持续报告类型错误并增量编译。
 * [POS]: 开发入口；主进程变更后重启开发命令，退出时释放自身子进程。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import esbuild from 'esbuild';
import { createBuildOptions } from './build-config.mjs';
const electronPath = createRequire(import.meta.url)('electron');
const contexts = await Promise.all(createBuildOptions('development').map(option => esbuild.context(option)));
await Promise.all(contexts.map(context => context.rebuild()));
await Promise.all(contexts.map(context => context.watch()));
const checkers = ['tsconfig.json', 'tsconfig.strict.json'].map(project => spawn(process.execPath,
  ['node_modules/typescript/bin/tsc', '--project', project, '--watch', '--preserveWatchOutput'], { stdio: 'inherit' }));
const child = spawn(electronPath, [...process.argv.slice(2), '.'], { stdio: 'inherit' });
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (child.exitCode === null) child.kill('SIGTERM');
  for (const checker of checkers) checker.kill('SIGTERM');
  await Promise.all(contexts.map(context => context.dispose()));
}
child.once('exit', code => { if (!stopping) process.exitCode = code ?? 1; void stop(); });
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
