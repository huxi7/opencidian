/**
 * [INPUT]: GitHub 事件、远端标签、打包文件与内置 GITHUB_TOKEN。
 * [OUTPUT]: 三平台安装包和 SHA256SUMS；完整草稿才转为公开版本。
 * [POS]: 发布事务。只写当前版本草稿，不覆盖已公开的 Release。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { RELEASE_TARGETS, versionFromTag, verifyAssets } from './release-config.mjs';
const [command, target] = process.argv.slice(2);
const tag = process.env.RELEASE_TAG;
const repo = process.env.GH_REPO;
const gh = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const api = (endpoint, ...args) => JSON.parse(gh(['api', `repos/${repo}/${endpoint}`, ...args]));
const release = () => api(`releases/tags/${tag}`);
const output = (name, value) => fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
function requireDraft(value) { if (!value.draft) throw Error('不修改已经公开的 Release'); }
function verifyCommit() {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const tagged = execFileSync('git', ['rev-parse', `${tag}^{commit}`], { encoding: 'utf8' }).trim();
  if (commit !== tagged) throw Error('构建提交与标签不一致');
}

if (command === 'prepare') {
  output('matrix', JSON.stringify({ include: RELEASE_TARGETS }));
  const publishing = process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_REF_TYPE === 'tag';
  output('release', String(publishing));
  if (publishing) {
    versionFromTag(tag);
    verifyCommit();
    const refs = api(`git/ref/tags/${tag}`);
    const existing = JSON.parse(gh(['api', `repos/${repo}/releases`, '--paginate', '--slurp'])).flat().find(item => item.tag_name === tag);
    if (existing && !existing.draft) throw Error('该版本已公开，请使用新标签');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'opensidian-notes-'));
    try {
      const note = refs.object.type === 'tag' ? api(`git/tags/${refs.object.sha}`).message?.trim() : '';
      const notes = note || api('releases/generate-notes', '-f', `tag_name=${tag}`).body;
      const file = path.join(directory, 'notes.md');
      fs.writeFileSync(file, notes + '\n');
      if (existing) gh(['release', 'edit', tag, '--notes-file', file]);
      else gh(['release', 'create', tag, '--verify-tag', '--draft', '--title', `OpenSidian ${tag}`, '--notes-file', file]);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
} else if (command === 'upload') {
  versionFromTag(tag);
  verifyCommit();
  const spec = RELEASE_TARGETS.find(item => item.target === target);
  if (!spec) throw Error('未知发布目标');
  requireDraft(release());
  const file = path.join('release', spec.asset);
  const bytes = fs.readFileSync(file);
  if (!bytes.length) throw Error('安装包为空');
  const digest = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
  gh(['release', 'upload', tag, file, '--clobber']);
  const uploaded = release().assets.find(item => item.name === spec.asset);
  if (uploaded?.digest !== digest || uploaded.size !== bytes.length || uploaded.state !== 'uploaded') throw Error('远端安装包校验失败');
  console.log(`${spec.asset}: ${digest}`);
} else if (command === 'publish') {
  versionFromTag(tag);
  verifyCommit();
  const draft = release();
  requireDraft(draft);
  const installers = draft.assets.filter(item => item.name !== 'SHA256SUMS');
  verifyAssets(installers);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'opensidian-checksums-'));
  try {
    const file = path.join(directory, 'SHA256SUMS');
    const text = installers.sort((a, b) => a.name.localeCompare(b.name)).map(item => `${item.digest.slice(7)}  ${item.name}`).join('\n') + '\n';
    fs.writeFileSync(file, text);
    gh(['release', 'upload', tag, file, '--clobber']);
    const checked = release();
    requireDraft(checked);
    verifyAssets(checked.assets, true);
    gh(['release', 'edit', tag, '--draft=false', '--latest']);
    const published = release();
    if (published.draft) throw Error('Release 尚未公开');
    verifyAssets(published.assets, true);
    console.log(published.html_url);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
} else throw Error('需要 prepare、upload 或 publish');
