/**
 * [INPUT]: 真实更新检查器、esbuild 与隔离的网络、通知和本机偏好替身。
 * [OUTPUT]: 默认源、自定义源、下载地址、开关和失败通知的回归回执。
 * [POS]: 更新协议单测。不联网，不读取或修改用户库。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const notices = [], opened = [], requests = [], checks = [];
const preferences = new Map();
let response;
class Notice {
  constructor(text) { this.text = text; this.buttons = []; notices.push(this); }
  addButton(text, callback) { this.buttons.push({ text, callback }); }
}
const desktop = { version: () => '1.0.0', openExternal: url => opened.push(url) };
const result = await build({ entryPoints: ['src/renderer/core/update-check.ts'], bundle: true,
  platform: 'node', format: 'cjs', write: false, logLevel: 'silent', external: ['./ipc.js', './notices.js', './i18n.js'] });
const module = { exports: {} };
new Function('require', 'module', 'exports', 'localStorage', result.outputFiles[0].text)(name => {
  if (name === './ipc.js') return { Desktop: desktop };
  if (name === './notices.js') return { Notice };
  if (name === './i18n.js') return { tt: (_key, text, vars = {}) => text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key]) };
  throw Error('Unexpected dependency: ' + name);
}, module, module.exports, { getItem: key => preferences.get(key) });
const { checkForUpdates, isAutomaticUpdateCheckEnabled, parseReleaseMeta, DEFAULT_UPDATE_FEED, RELEASES_URL } = module.exports;
const app = { settings: { appSettings: {} }, getVersion: () => '1.0.0', requestUrl: async opts => {
  requests.push(opts);
  if (response instanceof Error) throw response;
  return response;
} };
const release = { tag_name: 'v1.1.0', url: 'https://api.github.com/repos/huxi7/opencidian/releases/123', html_url: RELEASES_URL + '/tag/v1.1.0' };
const serve = data => { response = { status: 200, body: JSON.stringify(data) }; };
async function check(name, run) {
  notices.length = requests.length = opened.length = 0;
  app.settings.appSettings = {}; preferences.clear(); serve(release);
  await run(); checks.push(name);
}
for (const feed of [undefined, '', '   ']) await check('缺省或空地址使用默认 GitHub 源 ' + String(feed), async () => {
  app.settings.appSettings.updateFeed = feed;
  assert.equal((await checkForUpdates(app)).status, 'update');
  assert.equal(requests[0].url, DEFAULT_UPDATE_FEED);
  assert.equal(app.settings.appSettings.updateFeed, feed);
});
await check('自定义地址继续优先', async () => {
  app.settings.appSettings.updateFeed = ' https://example.test/feed.json ';
  await checkForUpdates(app);
  assert.equal(requests[0].url, 'https://example.test/feed.json');
});
await check('GitHub 下载按钮打开网页而不是 API', async () => {
  const result = await checkForUpdates(app);
  assert.equal(result.url, release.html_url);
  assert.equal(notices.length, 1);
  notices[0].buttons[0].callback();
  assert.deepEqual(opened, [release.html_url]);
});
await check('静态 JSON 保留 version 与 url 协议', () => {
  assert.deepEqual(parseReleaseMeta({ version: '1.1.0', url: 'https://example.test/download' }), { version: '1.1.0', url: 'https://example.test/download' });
});
await check('默认开启后台检查', () => assert.equal(isAutomaticUpdateCheckEnabled(app), true));
await check('配置开关关闭后台检查', () => {
  app.settings.appSettings.checkUpdates = false;
  assert.equal(isAutomaticUpdateCheckEnabled(app), false);
});
await check('旧本机关闭偏好仍生效', () => {
  preferences.set('disable-update', '1');
  assert.equal(isAutomaticUpdateCheckEnabled(app), false);
});
await check('关闭后台检查后仍能手动检查', async () => {
  app.settings.appSettings.checkUpdates = false; preferences.set('disable-update', '1');
  assert.equal((await checkForUpdates(app)).status, 'update');
  assert.equal(requests.length, 1);
});
await check('版本一致仅提示已最新', async () => {
  serve({ ...release, tag_name: 'v1.0.0' });
  assert.equal((await checkForUpdates(app)).status, 'latest');
  assert.equal(notices.length, 1);
  assert.equal(notices[0].buttons.length, 0);
});
await check('静默检查无更新时不弹通知', async () => {
  serve({ ...release, tag_name: 'v1.0.0' });
  await checkForUpdates(app, { silent: true });
  assert.equal(notices.length, 0);
});
await check('静默检查发现新版仍提示下载', async () => {
  await checkForUpdates(app, { silent: true });
  assert.equal(notices.length, 1);
  assert.equal(notices[0].buttons.length, 1);
});
for (const failure of [new Error('offline'), { status: 500 }, { status: 200, body: 'invalid json' }]) {
  await check('网络或响应失败不误报最新 ' + String(failure.status ?? failure.message), async () => {
    response = failure;
    assert.equal((await checkForUpdates(app, { silent: true })).status, 'error');
    assert.equal(notices.length, 0);
    assert.equal((await checkForUpdates(app)).status, 'error');
    assert.equal(notices.length, 1);
  });
}
await check('公共 API 限流提示与配置错误区分', async () => {
  response = { status: 403, headers: { 'x-ratelimit-remaining': '0' } };
  assert.equal((await checkForUpdates(app)).status, 'error');
  assert.match(notices[0].text, /访问限额/);
});
console.log(JSON.stringify({ pass: true, count: checks.length, checks }));
