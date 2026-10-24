/**
 * [INPUT]: esbuild、child_process、Electron 与 renderer 入口。
 * [OUTPUT]: 启动开发环境，增量 watch 编译 renderer/starter/graph-worker 并拉起 Electron。
 * [POS]: 开发模式启动器。排除 Node 原生模块与 fsevents（.node 二进制）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import process from 'process';
import esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const NODE_BUILTINS = [
  'electron', 'fs', 'path', 'os', 'crypto', 'child_process', 'util', 'events',
  'stream', 'url', 'zlib', 'http', 'https', 'net', 'tty', 'readline',
  'worker_threads', 'assert', 'buffer', 'querystring', 'string_decoder',
  'perf_hooks', 'timers', 'process', 'vm', 'v8', 'module', 'constants',
  'original-fs', 'inspector', 'async_hooks', 'dns', 'tls', 'http2', 'cluster',
];

const common = {
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome120',
  // fsevents is a native module (chokidar optional dep) — never bundle .node files
  external: [...NODE_BUILTINS, 'fsevents'],
  loader: { '.json': 'json' },
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'info',
  sourcemap: false,
  minify: false,
};

const targets = [
  { in: 'src/renderer/main.js', out: 'dist/renderer.js' },
  { in: 'src/renderer/starter.js', out: 'dist/starter.js' },
  { in: 'src/renderer/plugins-core/graph-sim-worker.js', out: 'dist/graph-sim-worker.js' },
];

for (const t of targets) {
  const ctx = await esbuild.context({ ...common, entryPoints: [path.join(root, t.in)], outfile: path.join(root, t.out) });
  await ctx.watch();
}

const electron = spawn('npx', ['electron', '.'], { cwd: root, stdio: 'inherit' });
electron.on('close', (code) => process.exit(code ?? 0));
