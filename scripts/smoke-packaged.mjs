/**
 * [INPUT]: release/ 下已打包的 OpenSidian.app、临时库目录与 OBS_* 环境变量。
 * [OUTPUT]: 冒烟断言结果（进程退出码 0=通过）；stdout 打印 JSON。
 * [POS]: scripts/ 的打包产物冒烟器。用 devScreenshotHook 的 OBS_ACT 通道在打包版上执行一次真实启动断言，拿到结果即退出。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Packaged app smoke test — boots the .app against a temp vault and asserts via OBS_ACT. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const binary = process.argv[2] ||
  'release/mac-arm64/OpenSidian.app/Contents/MacOS/OpenSidian';
if (!fs.existsSync(binary)) {
  console.error('packaged binary not found:', binary);
  process.exit(2);
}

const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'opensidian-packaged-smoke-'));
fs.writeFileSync(path.join(vault, '.obs-copy-acceptance-fixture'), 'smoke\n');
fs.mkdirSync(path.join(vault, '.obsidian'), { recursive: true });

const js = `
(async () => {
  const file = await app.vault.create('Packaged-Boot.md', '# packaged\\n');
  await app.workspace.openFile(file);
  return {
    passed: true,
    checks: [
      'vault boot: ' + app.vault.getName(),
      'file created: ' + file.path,
      'protocol: ' + location.protocol,
      'open file: ' + (app.workspace.getActiveFile() ? app.workspace.getActiveFile().path : 'none'),
    ],
  };
})()
`;

const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('OBS_')) delete env[key];
Object.assign(env, {
  OBS_ALLOW_MULTI: '1',
  OBS_VAULT_PATH: vault,
  OBS_ACT: JSON.stringify({ action: 'eval', js }),
  OBS_SCREENSHOT_DELAY: '1200',
});

const started = Date.now();
const child = spawn(binary, ['--user-data-dir=' + path.join(vault, '.electron-user-data')], { env });

let output = '';
let settled = false;
const finish = (code, payload) => {
  if (settled) return;
  settled = true;
  try { child.kill('SIGTERM'); } catch (e) { /* ignore */ }
  setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) {} }, 1500);
  if (payload) console.log(JSON.stringify(payload, null, 2));
  process.exit(code);
};

const timeout = setTimeout(() => {
  console.error('timeout waiting for eval result. output tail:\n', output.slice(-1500));
  finish(1, null);
}, 30000);

const onData = (chunk) => {
  output += chunk.toString();
  const match = output.match(/\[dev\] eval: (\{[\s\S]*?\})\s*\n/);
  if (!match) return;
  clearTimeout(timeout);
  let result = null;
  try { result = JSON.parse(match[1]); } catch (e) {
    console.error('bad eval json:', match[1].slice(0, 400));
    return finish(1, null);
  }
  finish(result.passed ? 0 : 1, {
    passed: !!result.passed,
    checks: result.checks,
    bootMs: Date.now() - started,
    vault,
  });
};
child.stdout.on('data', onData);
child.stderr.on('data', onData);
child.on('error', (e) => { console.error('spawn failed:', e.message); finish(1, null); });
