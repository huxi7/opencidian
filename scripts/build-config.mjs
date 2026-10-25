/**
 * [INPUT]: TypeScript 主进程、渲染器入口与 Node 内置模块清单。
 * [OUTPUT]: createBuildOptions 返回开发与生产共用的 esbuild 配置。
 * [POS]: 唯一构建配置源；源码保留 TS，Electron 只执行 dist 中的 JS。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'node:fs';
const externals = ['electron', 'fs', 'path', 'os', 'crypto', 'child_process', 'util', 'events',
  'stream', 'url', 'zlib', 'http', 'https', 'net', 'tty', 'readline', 'worker_threads', 'assert',
  'buffer', 'querystring', 'string_decoder', 'perf_hooks', 'timers', 'process', 'vm', 'v8',
  'module', 'constants', 'original-fs', 'inspector', 'async_hooks', 'dns', 'tls', 'http2', 'cluster', 'fsevents'];
export function createBuildOptions(mode = 'production') {
  const common = { tsconfig: 'tsconfig.json', logLevel: 'info', sourcemap: false, minify: false };
  const renderer = { ...common, bundle: true, platform: 'browser', format: 'iife', target: 'chrome120',
    external: externals, loader: { '.json': 'json' }, define: { 'process.env.NODE_ENV': JSON.stringify(mode) } };
  return [
    ...['main', 'starter', 'plugins-core/graph-sim-worker'].map(entry => ({ ...renderer,
      entryPoints: [`src/renderer/${entry}.ts`], outfile: `dist/${entry.split('/').pop() === 'main' ? 'renderer' : entry.split('/').pop()}.js` })),
    { ...common, entryPoints: fs.readdirSync('src/main').filter(file => file.endsWith('.ts') && !file.endsWith('.d.ts')).map(file => `src/main/${file}`),
      outdir: 'dist/main', platform: 'node', format: 'cjs', target: 'node20' },
  ];
}
