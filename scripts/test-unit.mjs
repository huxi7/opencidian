/**
 * [INPUT]: scripts 中的独立 Node 测试入口。
 * [OUTPUT]: 串行执行结果与失败退出码。
 * [POS]: 单元测试统一入口，不读取本地分析资料，不启动 Electron。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = fs.readdirSync('scripts').filter(name => name.endsWith('.test.mjs')).sort();
let failures = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, [`scripts/${file}`], { encoding: 'utf8', timeout: 120000 });
  if (result.status !== 0 || result.error) {
    failures++;
    process.stderr.write(`${file}: FAILED\n${result.stderr || result.stdout}\n${result.error?.message || ''}\n`);
    continue;
  }
  try {
    const receipt = JSON.parse(result.stdout);
    if (receipt.pass !== true || receipt.count !== receipt.checks?.length || receipt.count < 1) throw Error('无效测试回执');
    process.stdout.write(`${file}: ${receipt.count} passed\n`);
  } catch (error) { failures++; process.stderr.write(`${file}: ${error.message}\n${result.stdout}\n`); }
}
process.stdout.write(`${files.length - failures}/${files.length} suites passed\n`);
if (failures) process.exitCode = 1;
