/**
 * [INPUT]: esbuild、Node断言与markdown/reading-subpath的子路径解析器。
 * [OUTPUT]: 输出{pass,count,checks}，验证段落块引用标记、前导锚点剥离与阅读/编辑子路径导航。
 * [POS]: 子路径导航与块引用单测。不启动Electron，模拟轻量DOM与元数据缓存。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'opensidian-subpath-'));
const outfile = path.join(directory, 'subpath.cjs');
const checks = [];

class FakeNode {
  constructor(type, text = '') {
    this.nodeType = type;
    this.nodeValue = text;
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.nodeType = 1;
    this.attributes = new Map();
    this.classList = new Set();
    this.id = '';
    this.childNodes = [];
    this.scrolled = null;
  }
  get textContent() {
    return this.childNodes.map((c) => (c.nodeType === 3 ? c.nodeValue : c.textContent)).join('');
  }
  set textContent(text) {
    this.childNodes = [new FakeNode(3, text)];
  }
  setAttr(name, val) { this.attributes.set(name, String(val)); }
  getAttr(name) { return this.attributes.get(name) || null; }
  addClass(cls) { this.classList.add(cls); }
  removeClass(cls) { this.classList.delete(cls); }
  scrollIntoView(opts) { this.scrolled = opts; }
  querySelectorAll(sel) {
    const list = [];
    const walk = (el) => {
      for (const c of el.childNodes) {
        if (c.nodeType === 1) {
          if (sel.includes(c.tagName.toLowerCase())) list.push(c);
          else if (sel.includes('[data-heading]') && c.attributes.has('data-heading')) list.push(c);
          else if (sel.includes('[data-block-id') && c.attributes.has('data-block-id')) list.push(c);
          walk(c);
        }
      }
    };
    walk(this);
    return list;
  }
  querySelector(sel) {
    const walk = (el) => {
      for (const c of el.childNodes) {
        if (c.nodeType === 1) {
          if (sel.startsWith('[data-block-id="')) {
            const id = sel.slice(16, -2);
            if (c.attributes.get('data-block-id') === id) return c;
          }
          if (sel.startsWith('[id="')) {
            const id = sel.slice(5, -2);
            if (c.id === id) return c;
          }
          const sub = walk(c);
          if (sub) return sub;
        }
      }
      return null;
    };
    return walk(this);
  }
}

try {
  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  await build({
    entryPoints: [path.resolve(import.meta.dirname, '../src/renderer/markdown/reading-subpath.js')],
    bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent',
  });
  const { annotateBlocks, scrollToSubpath } = createRequire(import.meta.url)(outfile);
  const check = (message, condition) => {
    assert.ok(condition, message);
    checks.push(message);
  };

  // 1. 测试 annotateBlocks
  const container = new FakeElement('div');
  const p1 = new FakeElement('p');
  p1.textContent = '这是正文段落 ^block-1';
  const p2 = new FakeElement('p');
  p2.textContent = '普通段落无锚点';
  const li = new FakeElement('li');
  li.textContent = '列表项内容 ^li-block-42';
  container.childNodes.push(p1, p2, li);

  annotateBlocks(container);
  check('正确提取 p 元素的 data-block-id', p1.getAttr('data-block-id') === 'block-1');
  check('正确设置 p 元素的 id', p1.id === 'block-1');
  check('移除文本中的 ^block-id 锚点字符', p1.textContent === '这是正文段落');
  check('无锚点段落不设置 data-block-id', p2.getAttr('data-block-id') === null);
  check('无锚点段落保留原正文', p2.textContent === '普通段落无锚点');
  check('正确提取 li 元素的 data-block-id', li.getAttr('data-block-id') === 'li-block-42');
  check('正确移除 li 中的锚点字符', li.textContent === '列表项内容');

  // 2. 测试 scrollToSubpath（块引用）
  const ok1 = scrollToSubpath(container, '^block-1');
  check('成功按 ^block-1 滚动到目标段落', ok1 === true && p1.scrolled?.block === 'center');
  check('滚动后为元素添加 is-flashing 类', p1.classList.has('is-flashing'));

  const ok2 = scrollToSubpath(container, '#^li-block-42');
  check('支持带 # 前缀的 #^li-block-42', ok2 === true && li.scrolled?.block === 'center');

  const okNotFound = scrollToSubpath(container, '^non-existent');
  check('不存在的块返回 false', okNotFound === false);

  // 3. 测试 scrollToSubpath（标题引用）
  const h1 = new FakeElement('h1');
  h1.setAttr('data-heading', '核心概念介绍');
  const h2 = new FakeElement('h2');
  h2.setAttr('data-heading', '快速上手指南');
  container.childNodes.push(h1, h2);

  const okH1 = scrollToSubpath(container, '#核心概念介绍');
  check('支持带 # 前缀的标题定位', okH1 === true && h1.scrolled?.block === 'start');
  check('标题滚动后添加 is-flashing 类', h1.classList.has('is-flashing'));

  const okH2Plain = scrollToSubpath(container, '快速上手指南');
  check('支持无 # 纯标题定位', okH2Plain === true && h2.scrolled?.block === 'start');

  const okH2Multi = scrollToSubpath(container, '章节一#快速上手指南');
  check('支持多层级 Heading#Subheading 定位最末子级', okH2Multi === true && h2.scrolled?.block === 'start');

  const okHNone = scrollToSubpath(container, '#未知章节');
  check('未匹配到的标题返回 false', okHNone === false);

  const emptyScroll = scrollToSubpath(container, '');
  check('空 subpath 安全返回 false', emptyScroll === false);

  console.log(JSON.stringify({ pass: true, count: checks.length, checks }));
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
