/**
 * [INPUT]: release.mjs 发布事务与隔离的 Git、GitHub、文件替身。
 * [OUTPUT]: 草稿读取、固定源码重试、安装包文件名、摘要和公开保护回归。
 * [POS]: 执行真实发布分支，不联网、不创建标签、不写入真实 Release。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { RELEASE_TARGETS } from './release-config.mjs';

const require = createRequire(import.meta.url);
const result = await build({ entryPoints: ['scripts/release.mjs'], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const execute = new Function('require', 'process', 'console', result.outputFiles[0].text);
const checks = [];
const check = (name, run) => { run(); checks.push(name); };
const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const source = 'a'.repeat(40), tools = 'b'.repeat(40);
const installers = RELEASE_TARGETS.map(item => ({ name: item.asset, state: 'uploaded', size: 12, digest: sha(item.asset) }));

function simulate(command, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'opensidian-release-test-'));
  const outputFile = path.join(directory, 'output');
  const calls = [], writes = [], copies = [];
  let draft = options.missing ? undefined : {
    id: 42, tag_name: 'v1.0.0', draft: !options.published,
    assets: structuredClone(options.assets ?? []), html_url: 'https://example.test/release/v1.0.0',
  };
  const bytes = Buffer.from('isolated installer');
  const localFs = {
    ...fs,
    mkdtempSync: () => fs.mkdtempSync(path.join(directory, 'notes-')),
    copyFileSync: (from, to) => copies.push([from, to]),
    readFileSync: (file, ...args) => String(file).startsWith('release' + path.sep) ? bytes : fs.readFileSync(file, ...args),
  };
  function execFileSync(binary, args) {
    calls.push([binary, ...args]);
    if (binary === 'git') {
      assert.deepEqual(args.slice(0, 2), ['rev-parse', '--verify']);
      if (args[2] === 'HEAD') return options.head ?? source;
      assert.equal(args[2], 'refs/tags/v1.0.0^{commit}');
      if (options.missingTag) throw Error('tag does not exist');
      return source;
    }
    assert.equal(binary, 'gh');
    if (args[0] === 'api') {
      const endpoint = args[1];
      if (endpoint === 'repos/test/repo/releases') {
        assert.deepEqual(args.slice(2), ['--paginate', '--slurp']);
        return JSON.stringify([[{ id: 9, tag_name: 'v0.9.0' }], draft ? [draft] : []]);
      }
      if (endpoint === 'repos/test/repo/releases/42') return JSON.stringify(draft);
      if (endpoint === 'repos/test/repo/git/ref/tags/v1.0.0') return JSON.stringify({ object: { type: 'tag', sha: 'annotation' } });
      if (endpoint === 'repos/test/repo/git/tags/annotation') return JSON.stringify({ message: 'Release notes from annotation' });
      throw Error('Unexpected API endpoint: ' + endpoint);
    }
    assert.equal(args[0], 'release');
    assert.equal(args[2], 'v1.0.0');
    writes.push(args);
    if (args[1] === 'create') {
      assert.ok(args.includes('--draft'));
      draft = { id: 42, tag_name: 'v1.0.0', draft: true, assets: [] };
    } else if (args[1] === 'upload') {
      const name = path.basename(args[3]);
      const contents = name === 'SHA256SUMS' ? fs.readFileSync(args[3]) : bytes;
      draft.assets = draft.assets.filter(item => item.name !== name).concat({
        name, size: contents.length, state: 'uploaded', digest: options.badDigest ? sha('wrong') : sha(contents),
      });
    } else if (args[1] === 'edit' && args.includes('--draft=false')) draft.draft = false;
    else assert.ok(args.includes('--notes-file'));
    return '';
  }
  let error;
  try {
    execute(name => {
      if (name === 'node:child_process') return { execFileSync };
      if (name === 'node:fs') return localFs;
      return require(name);
    }, {
      argv: ['node', 'release.mjs', command, options.target ?? 'linux-x64'],
      env: { GITHUB_OUTPUT: outputFile, GH_REPO: 'test/repo', RELEASE_TAG: 'v1.0.0', GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'tag', ...options.env },
    }, { log() {} });
  } catch (caught) { error = caught; }
  const outputs = fs.existsSync(outputFile) ? Object.fromEntries(fs.readFileSync(outputFile, 'utf8').trim().split('\n').map(line => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)];
  })) : {};
  fs.rmSync(directory, { recursive: true, force: true });
  return { error, calls, writes, copies, draft, outputs };
}

check('标签事件创建草稿并输出固定源码', () => {
  const run = simulate('prepare', { missing: true });
  assert.ifError(run.error);
  assert.equal(run.outputs.commit, source);
  assert.equal(run.outputs.tag, 'v1.0.0');
  assert.equal(run.outputs.release, 'true');
  assert.equal(run.writes[0][1], 'create');
});
check('从分页列表找到已有草稿，不重复创建', () => {
  const run = simulate('prepare');
  assert.ifError(run.error);
  assert.deepEqual(run.writes.map(args => args[1]), ['edit']);
});
check('手动重试用新工具解析旧标签源码', () => {
  const run = simulate('prepare', { head: tools, env: { GITHUB_EVENT_NAME: 'workflow_dispatch' } });
  assert.ifError(run.error);
  assert.equal(run.outputs.commit, source);
  assert.equal(run.outputs.release, 'true');
});
check('手动留空只验证且不访问 GitHub', () => {
  const run = simulate('prepare', { head: tools, env: { GITHUB_EVENT_NAME: 'workflow_dispatch', RELEASE_TAG: '' } });
  assert.ifError(run.error);
  assert.equal(run.outputs.commit, tools);
  assert.equal(run.outputs.release, 'false');
  assert.equal(run.outputs.tag, '');
  assert.ok(run.calls.every(args => args[0] === 'git'));
});
check('标签触发的源码不匹配则拒绝准备', () => {
  const run = simulate('prepare', { head: tools });
  assert.match(run.error?.message ?? '', /构建提交与标签不一致/);
  assert.equal(run.writes.length, 0);
});
check('拒绝不存在的重试标签', () => {
  const run = simulate('prepare', { missingTag: true, env: { GITHUB_EVENT_NAME: 'workflow_dispatch' } });
  assert.match(run.error?.message ?? '', /tag does not exist/);
  assert.equal(run.writes.length, 0);
});
check('无效标签不能注入工作流输出', () => {
  const run = simulate('prepare', { env: { RELEASE_TAG: 'v1.0.0\ncommit=wrong' } });
  assert.match(run.error?.message ?? '', /版本标签/);
  assert.equal(run.outputs.commit, undefined);
  assert.equal(run.writes.length, 0);
});
check('上传通过列表与 ID 读取草稿并校验摘要', () => {
  const run = simulate('upload');
  assert.ifError(run.error);
  assert.equal(run.draft.assets[0].name, 'opensidian-linux-x64.AppImage');
  assert.deepEqual(run.copies, [[path.join('release', 'opensidian-linux-x86_64.AppImage'), path.join('release', 'opensidian-linux-x64.AppImage')]]);
  assert.ok(run.calls.some(args => args[2] === 'repos/test/repo/releases/42'));
});
check('macOS 安装包保持原始文件名', () => {
  const run = simulate('upload', { target: 'macos-arm64' });
  assert.ifError(run.error);
  assert.equal(run.copies.length, 0);
  assert.equal(run.draft.assets[0].name, 'opensidian-macos-arm64.dmg');
});
check('上传摘要不一致立即失败', () => assert.match(simulate('upload', { badDigest: true }).error?.message ?? '', /远端安装包校验失败/));
for (const command of ['prepare', 'upload', 'publish']) {
  check('公开版本拒绝执行 ' + command, () => {
    const run = simulate(command, { published: true, assets: installers });
    assert.match(run.error?.message ?? '', /公开/);
    assert.equal(run.writes.length, 0);
  });
}
for (const command of ['upload', 'publish']) {
  check('源码不匹配拒绝执行 ' + command, () => {
    const run = simulate(command, { head: tools, assets: installers });
    assert.match(run.error?.message ?? '', /构建提交与标签不一致/);
    assert.equal(run.writes.length, 0);
  });
}
check('缺少平台不能写入校验和或公开', () => {
  const run = simulate('publish', { assets: installers.slice(1) });
  assert.match(run.error?.message ?? '', /附件不完整/);
  assert.equal(run.writes.length, 0);
});
check('校验和上传损坏保留草稿', () => {
  const run = simulate('publish', { assets: installers, badDigest: true });
  assert.match(run.error?.message ?? '', /远端校验和文件不一致/);
  assert.equal(run.draft.draft, true);
});
check('附件齐备且校验和一致才公开', () => {
  const run = simulate('publish', { assets: installers });
  assert.ifError(run.error);
  assert.equal(run.draft.draft, false);
  assert.equal(run.draft.assets.length, 4);
  assert.deepEqual(run.writes.map(args => args[1]), ['upload', 'edit']);
});
console.log(JSON.stringify({ pass: true, count: checks.length, checks }));
