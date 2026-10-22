#!/usr/bin/env node
/**
 * [INPUT]: 后台运行的原版 Obsidian（--remote-debugging-port=9351）；命令行传入的 JS 表达式或 --file 指定的表达式文件
 * [OUTPUT]: 打印 Runtime.evaluate 的结果（JSON.stringify 后的字符串或原始值）
 * [POS]: scripts/ 的原版取证只读探针。只连 CDP、只求值、不点击不激活窗口；证据落到 _analysis/obsidian-114/ 供人工比对。
 *       用法：node scripts/cdp-probe.mjs "document.title" | node scripts/cdp-probe.mjs --file /tmp/q.js
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { readFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT || '9351';
const args = process.argv.slice(2);
let expr;
if (args[0] === '--file') expr = readFileSync(args[1], 'utf8');
else expr = args.join(' ');

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(new Error('ws error: ' + (e.message || 'unknown')));
  });
}

const targets = await listTargets();
const filter = process.env.CDP_TARGET || 'index.html';
const page =
  targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && t.url.includes(filter)) ||
  targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
if (!page) {
  console.error('no page target on port ' + PORT);
  process.exit(2);
}

const ws = await connect(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};

function send(method, params) {
  const msgId = ++id;
  return new Promise((resolve) => {
    pending.set(msgId, resolve);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}

const res = await send('Runtime.evaluate', {
  expression: expr,
  awaitPromise: true,
  returnByValue: true,
  userGesture: false,
});

if (res.result?.exceptionDetails) {
  console.error('EXCEPTION:', JSON.stringify(res.result.exceptionDetails, null, 2));
  ws.close();
  process.exit(3);
}
const value = res.result?.result?.value;
if (typeof value === 'string') {
  process.stdout.write(value.endsWith('\n') ? value : value + '\n');
} else {
  console.log(JSON.stringify(value, null, 2));
}
ws.close();
process.exit(0);
