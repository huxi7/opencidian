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
  external: NODE_BUILTINS,
  loader: { '.json': 'json' },
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'info',
  sourcemap: false,
  minify: false,
};

const targets = [
  { in: 'src/renderer/main.js', out: 'dist/renderer.js' },
  { in: 'src/renderer/starter.js', out: 'dist/starter.js' },
];

for (const t of targets) {
  const ctx = await esbuild.context({ ...common, entryPoints: [path.join(root, t.in)], outfile: path.join(root, t.out) });
  await ctx.watch();
}

const electron = spawn('npx', ['electron', '.'], { cwd: root, stdio: 'inherit' });
electron.on('close', (code) => process.exit(code ?? 0));
