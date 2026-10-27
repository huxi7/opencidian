/**
 * [INPUT]: 应用资源协议提供 assets/app-symbol.svg。
 * [OUTPUT]: 晶体标志地址、已加载图像与异步加载入口。
 * [POS]: 渲染器品牌素材的唯一入口；仓库选择页与画布水印共用同一源文件。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export const APP_SYMBOL_URL = 'app://opensidian.app/assets/app-symbol.svg';

let symbol: HTMLImageElement | null = null;

function appSymbol() {
  if (!symbol) {
    symbol = new Image();
    symbol.src = APP_SYMBOL_URL;
  }
  return symbol;
}

export function loadedAppSymbol() {
  const image = appSymbol();
  return image.complete && image.naturalWidth > 0 ? image : null;
}

export async function loadAppSymbol() {
  const image = appSymbol();
  await image.decode();
  if (!image.naturalWidth) throw new Error('应用标志加载失败');
  return image;
}
