/**
 * [INPUT]: 依赖 core/ipc.js 的 Desktop（requestUrl/openExternal）与 core/notices.js 的 Notice；配置读 app 设置（updateFeed/checkUpdates）。
 * [OUTPUT]: 检查入口、版本解析、默认更新源与后台检查开关判定。
 * [POS]: 默认检查本仓库 GitHub Releases；updateFeed 非空时覆盖默认源。
 * 只提示并打开下载页，不自动安装。空配置无需迁移，不向用户库写入默认地址。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* Update check — static-feed based, prompt-only (no silent install). */
import { Desktop } from './ipc.js';
import { Notice } from './notices.js';
import { tt } from './i18n.js';

export const RELEASES_URL = 'https://github.com/huxi7/opencidian/releases';
export const DEFAULT_UPDATE_FEED = 'https://api.github.com/repos/huxi7/opencidian/releases/latest';

export function isAutomaticUpdateCheckEnabled(app: App): boolean {
  if (app.settings.appSettings.checkUpdates === false) return false;
  try { return localStorage.getItem('disable-update') !== '1'; }
  catch { return true; }
}

/** 语义化版本比较（数字段逐个比，容忍 v 前缀与后缀段）。 */
export function compareVersions(a: string | number | null | undefined, b: string | number | null | undefined) {
  const pa = String(a || '').replace(/^v/i, '').split(/[.+-]/).map((s) => parseInt(s, 10));
  const pb = String(b || '').replace(/^v/i, '').split(/[.+-]/).map((s) => parseInt(s, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = Number.isFinite(pa[i]) ? pa[i] : 0;
    const y = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** 解析更新源响应：GitHub Release（tag_name/html_url）或自建静态 JSON（version/url）。 */
export function parseReleaseMeta(json: unknown) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const data = json as Record<string, unknown>;
  const rawVersion = data.version || data.tag_name || data.name || '';
  const version = String(rawVersion).replace(/^v/i, '').trim();
  if (!version) return null;
  const url = data.html_url || data.download_url || data.page || data.url || '';
  return { version, url: String(url || '') };
}

function decodeBody(body: unknown) {
  try {
    if (typeof body === 'string') return body;
    if (body instanceof ArrayBuffer) return new TextDecoder('utf-8').decode(new Uint8Array(body));
    if (ArrayBuffer.isView(body)) return new TextDecoder('utf-8').decode(body);
  } catch (e) { /* ignore */ }
  return '';
}

/**
 * 检查更新。
 * @param {{silent?: boolean}} options silent=true 时失败/无更新不弹提示（启动后台检查用）
 */
export async function checkForUpdates(app: App, options: { silent?: boolean } = {}) {
  const silent = !!options.silent;
  const settings = (app.settings && app.settings.appSettings) || {};
  const feed = String(settings.updateFeed || '').trim() || DEFAULT_UPDATE_FEED;
  const current = (() => {
    try { return app.getVersion ? String(app.getVersion()) : String(Desktop.version() || '0.0.0'); }
    catch (e) { return '0.0.0'; }
  })();
  const fetchUrl = (app && app.requestUrl) || Desktop.requestUrl;
  let res = null;
  try { res = await fetchUrl({ url: feed }); } catch (e) { res = null; }
  let meta = null;
  if (res && !res.error && (!res.status || res.status === 200)) {
    const text = decodeBody(res.body);
    try { meta = parseReleaseMeta(JSON.parse(text)); } catch (e) { meta = null; }
  }
  if (!meta) {
    if (!silent) new Notice(res?.status === 403 && String(res.headers?.['x-ratelimit-remaining']) === '0'
      ? tt('interface.update.rate-limited', 'GitHub 更新检查已达到访问限额，请稍后重试。')
      : tt('interface.update.check-failed', '无法检查更新，请检查网络或更新源地址。'), 6000);
    return { status: 'error', current };
  }
  if (compareVersions(meta.version, current) > 0) {
    const notice = new Notice(tt('interface.update.available', '发现新版本 {{version}}（当前 {{current}}）', {
      version: meta.version, current,
    }), 12000);
    if (meta.url && notice.addButton) {
      notice.addButton(tt('setting.appearance.button-update', '更新'), () => {
        try { Desktop.openExternal(meta.url); } catch (e) { console.error('open update url failed', e); }
      });
    }
    return { status: 'update', version: meta.version, url: meta.url, current };
  }
  if (!silent) new Notice(tt('interface.update.latest', '已是最新版本（{{current}}）。', { current }), 4000);
  return { status: 'latest', version: current, current };
}
