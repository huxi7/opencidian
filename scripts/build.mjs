/**
 * [INPUT]: esbuild、Node fs 与 renderer 入口（main.js/starter.js/图谱 worker）。
 * [OUTPUT]: dist/renderer.js、dist/starter.js、dist/graph-sim-worker.js；支持 watch 增量构建。
 * [POS]: 打包入口。MathJax 静态资源由 app 协议直接读取 assets/mathjax。
 *        graph-sim-worker.js 是独立 Worker 脚本（iife），由 app:// 协议直载或 fetch + Blob 回退加载。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import esbuild from 'esbuild';
import fs from 'fs';

const watch = process.argv.includes('--watch');

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
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
  sourcemap: false,
  minify: false,
};

const targets = [
  { in: 'src/renderer/main.js', out: 'dist/renderer.js' },
  { in: 'src/renderer/starter.js', out: 'dist/starter.js' },
  { in: 'src/renderer/plugins-core/graph-sim-worker.js', out: 'dist/graph-sim-worker.js' },
];

fs.mkdirSync('dist', { recursive: true });


if (watch) {
  for (const t of targets) {
    const ctx = await esbuild.context({ ...common, entryPoints: [t.in], outfile: t.out });
    await ctx.watch();
  }
  console.log('watching...');
} else {
  await Promise.all(targets.map((t) => esbuild.build({ ...common, entryPoints: [t.in], outfile: t.out })));
  console.log('build complete');
}
