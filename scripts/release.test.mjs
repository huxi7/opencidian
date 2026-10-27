/**
 * [INPUT]: 发布目标、标签、附件元数据与 Electron 版本接口替身。
 * [OUTPUT]: 标签注入、候选版本隔离、源码与工具分离、完整性闸门和运行时版本的回归回执。
 * [POS]: 发布纯逻辑测试；不请求 GitHub，不创建标签或安装包。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import yaml from 'js-yaml';
import { versionFromTag, packageVersion, packagedPaths, RELEASE_TARGETS, verifyAssets } from './release-config.mjs';
const checks = [];
const check = (name, run) => { run(); checks.push(name); };
check('原生图标编译使用 macOS 26 构建机', () => {
  assert.equal(RELEASE_TARGETS.find(item => item.target === 'macos-arm64').os, 'macos-26');
});
check('正式版本来自标签', () => assert.equal(versionFromTag('v1.0.0'), '1.0.0'));
check('后续版本不读取 package.json', () => assert.equal(packageVersion({ RELEASE_TAG: 'v12.3.4' }), '12.3.4'));
for (const tag of ['1.0.0', 'v01.0.0', 'v1.0', 'main', 'v1.0.0;exit', 'v1.0.0-beta']) {
  check('拒绝非正式版本标签 ' + tag, () => assert.throws(() => versionFromTag(tag)));
}
check('应用清单不维护发布版本', () => assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync('package.json')), 'version'), false));
check('锁文件不维护发布版本', () => {
  const lock = JSON.parse(fs.readFileSync('package-lock.json'));
  assert.equal(Object.hasOwn(lock, 'version'), false);
  assert.equal(Object.hasOwn(lock.packages[''], 'version'), false);
});
for (const [platform, arch, binary] of [['darwin', 'arm64', 'OpenSidian'], ['win32', 'x64', 'OpenSidian.exe'], ['linux', 'x64', 'opensidian']]) {
  check(platform + ' 目录包路径正确', () => {
    const files = packagedPaths(process.cwd(), platform, arch);
    assert.equal(path.basename(files.binary), binary);
    assert.equal(path.basename(files.archive), 'app.asar');
  });
}
const assets = RELEASE_TARGETS.map(item => ({ name: item.asset, state: 'uploaded', size: 12, digest: 'sha256:' + 'a'.repeat(64) }));
check('AppImage 上游架构名映射为稳定下载名', () => {
  const linux = RELEASE_TARGETS.find(item => item.target === 'linux-x64');
  assert.equal(linux.buildAsset, 'opensidian-linux-x86_64.AppImage');
  assert.equal(linux.asset, 'opensidian-linux-x64.AppImage');
});
check('三平台附件齐全才允许发布', () => verifyAssets(assets));
check('缺少一个平台拒绝发布', () => assert.throws(() => verifyAssets(assets.slice(1))));
check('重复附件拒绝发布', () => assert.throws(() => verifyAssets([assets[0], assets[0], assets[2]])));
check('未知附件拒绝发布', () => assert.throws(() => verifyAssets([...assets, { ...assets[0], name: 'other.zip' }])));
for (const patch of [{ state: 'new' }, { size: 0 }, { digest: null }, { digest: 'sha256:bad' }]) {
  check('损坏上传元数据拒绝发布 ' + JSON.stringify(patch), () => assert.throws(() => verifyAssets([{ ...assets[0], ...patch }, ...assets.slice(1)])));
}
check('最终公开包含 SHA256SUMS', () => verifyAssets([...assets, { ...assets[0], name: 'SHA256SUMS' }], true));
const workflow = yaml.load(fs.readFileSync('.github/workflows/release.yml', 'utf8'));
check('标签触发与手动验证均已配置', () => {
  assert.deepEqual(workflow.on.push.tags, ['v*']);
  assert.equal(workflow.on.workflow_dispatch.inputs.release_tag.default, '');
  assert.equal(workflow.on.workflow_dispatch.inputs.release_tag.type, 'string');
});
check('手动重试与标签触发共用版本锁', () => {
  assert.equal(workflow.concurrency.group, 'desktop-${{ inputs.release_tag || github.ref_name }}');
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
});
check('构建源码与发布工具分别锁定提交', () => {
  for (const name of ['build', 'publish']) {
    const steps = workflow.jobs[name].steps;
    assert.equal(steps[0].with.ref, '${{ needs.prepare.outputs.commit }}');
    assert.equal(steps[1].with.ref, '${{ github.sha }}');
    assert.equal(steps[1].with.path, '_analysis/release-tools');
    assert.equal(steps[0].with['persist-credentials'], false);
    assert.equal(steps[1].with['persist-credentials'], false);
    assert.ok(steps.some(step => step.run?.startsWith('node _analysis/release-tools/scripts/release.mjs ')));
  }
  assert.equal(workflow.jobs.build.env.RELEASE_TAG, '${{ needs.prepare.outputs.tag || inputs.validation_tag }}');
});
check('候选版本不进入发布事务', () => {
  assert.equal(workflow.on.workflow_dispatch.inputs.validation_tag.default, '');
  assert.equal(workflow.on.workflow_dispatch.inputs.validation_tag.type, 'string');
  assert(!JSON.stringify(workflow.jobs.prepare).includes('validation_tag'));
  assert(!JSON.stringify(workflow.jobs.publish).includes('validation_tag'));
  const upload = workflow.jobs.build.steps.find(step => step.name === 'Upload verified installer to draft');
  assert.equal(upload.if, "needs.prepare.outputs.release == 'true'");
  const candidate = workflow.jobs.build.steps.find(step => step.name === 'Save validated candidate installer');
  assert.equal(candidate.if, "needs.prepare.outputs.release != 'true' && inputs.validation_tag != ''");
  assert.equal(candidate.with['if-no-files-found'], 'error');
  assert.equal(candidate.with['retention-days'], 1);
});
check('旧标签重试也验证当前发布工具', () => {
  const step = workflow.jobs.build.steps.find(step => step.name === 'Verify release tools');
  assert.equal(step['working-directory'], '_analysis/release-tools');
  assert.equal(step.run, 'node scripts/release.test.mjs && node scripts/release-transaction.test.mjs');
});
check('发布必须等待全部平台', () => {
  assert.deepEqual(workflow.jobs.publish.needs, ['prepare', 'build']);
  assert.equal(workflow.jobs.build.strategy['fail-fast'], false);
});
check('固定第三方 Actions 的完整提交', () => {
  for (const job of Object.values(workflow.jobs)) for (const step of job.steps) if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
});
const result = await build({ entryPoints: ['src/main/app-version.ts'], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent', external: ['electron'] });
const module = { exports: {} }, electron = { app: { isPackaged: false, getVersion: () => '1.0.0' } };
new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, name => { assert.equal(name, 'electron'); return electron; });
check('开发模式不显示参考产品版本', () => assert.equal(module.exports.getAppVersion(), 'dev'));
electron.app.isPackaged = true;
check('安装包显示真实应用版本', () => assert.equal(module.exports.getAppVersion(), '1.0.0'));
console.log(JSON.stringify({ pass: true, count: checks.length, checks }));
