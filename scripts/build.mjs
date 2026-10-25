/**
 * [INPUT]: build-config 的共用配置与 esbuild。
 * [OUTPUT]: dist/main/*.js、renderer.js、starter.js 和图谱 Worker。
 * [POS]: TypeScript 转译入口；npm run build 先执行独立类型检查。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import esbuild from 'esbuild';
import fs from 'node:fs';
import { createBuildOptions } from './build-config.mjs';
const options = createBuildOptions();
if (process.argv.includes('--watch')) {
  for (const config of options) {
    const context = await esbuild.context(config);
    await context.watch();
  }
} else {
  fs.rmSync('dist/main', { recursive: true, force: true });
  await Promise.all(options.map(config => esbuild.build(config)));
}
