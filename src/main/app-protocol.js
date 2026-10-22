/**
 * [INPUT]: Electron protocol；主入口提供应用与文件资源路径。
 * [OUTPUT]: 导出 registerAppProtocol，安装 app:// 流式协议。
 * [POS]: 主进程资源边界。Range 请求与取消释放共用流适配器。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const path = require('path');
const fs = require('fs');
const { protocol } = require('electron');
const IS_MAC = process.platform === 'darwin';

function registerAppProtocol({ SCHEME, APP_ORIGIN, FILE_ORIGIN, RENDERER_DIR, APP_ROOT, ASSETS_DIR }) {
  protocol.handle(SCHEME, async (request) => {
    let url = request.url;
    // strip query/hash
    try {
      const u = new URL(url);
      url = `${u.protocol}//${u.host}${u.pathname}`;
    } catch (e) { /* ignore */ }

    let filePath = null;
    let noframe = false;
    if (url.startsWith(APP_ORIGIN)) {
      let sub = decodeURIComponent(url.slice(APP_ORIGIN.length));
      // serve from renderer dir; dist/ for built files, assets/ for assets
      let resolved = path.resolve(RENDERER_DIR, sub);
      if (sub.startsWith('dist/') || sub.startsWith('assets/')) {
        resolved = path.resolve(APP_ROOT, sub);
      }
      if (!resolved.startsWith(RENDERER_DIR) && !resolved.startsWith(path.join(APP_ROOT, 'dist')) && !resolved.startsWith(ASSETS_DIR)) {
        return new Response('Not Found', { status: 400 });
      }
      filePath = resolved;
      noframe = true;
    } else if (url.startsWith(FILE_ORIGIN)) {
      let sub = url.slice(FILE_ORIGIN.length);
      if (IS_MAC || process.platform === 'linux') sub = '/' + sub;
      filePath = path.resolve(decodeURIComponent(sub));
    } else {
      return new Response('Not Found', { status: 400 });
    }

    try {
      const stat = await fs.promises.stat(filePath);
      const headers = new Headers();
      let status = 200;
      let stream;
      const range = request.headers.get('Range');
      if (range) {
        const m = range.match(/^bytes=(\d*)-(\d*)/);
        if (!m) return new Response('Range Not Satisfiable', { status: 416 });
        const start = Number(m[1] || 0);
        const end = Number(m[2] || stat.size - 1);
        if (isNaN(start) || isNaN(end) || start < 0 || end > stat.size - 1 || start > end) {
          return new Response('Range Not Satisfiable', { status: 416 });
        }
        headers.set('Accept-Ranges', 'bytes');
        headers.set('Content-Length', String(end - start + 1));
        headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
        status = 206;
        stream = fs.createReadStream(filePath, { start, end });
      } else {
        headers.set('Content-Length', String(stat.size));
        stream = fs.createReadStream(filePath);
      }
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Last-Modified', stat.mtime.toUTCString());
      if (noframe) headers.set('X-Frame-Options', 'DENY');
      return new Response(streamToWeb(stream), { status, headers });
    } catch (e) {
      return new Response('Not Found', { status: 404 });
    }
  });
}

function streamToWeb(nodeStream) {
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk)));
      nodeStream.on('end', () => controller.close());
      nodeStream.on('error', (err) => controller.error(err));
    },
    cancel() { nodeStream.destroy(); },
  });
}

module.exports = { registerAppProtocol };
