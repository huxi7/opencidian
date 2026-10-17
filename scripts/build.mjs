import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

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
];

fs.mkdirSync('dist', { recursive: true });

// copy katex css + fonts into dist
const katexCss = 'node_modules/katex/dist/katex.min.css';
if (fs.existsSync(katexCss)) {
  fs.copyFileSync(katexCss, 'dist/katex.css');
  const srcFonts = 'node_modules/katex/dist/fonts';
  if (fs.existsSync(srcFonts)) {
    fs.mkdirSync('dist/fonts', { recursive: true });
    for (const f of fs.readdirSync(srcFonts)) {
      fs.copyFileSync(path.join(srcFonts, f), path.join('dist/fonts', f));
    }
  }
}

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
