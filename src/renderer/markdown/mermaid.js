/**
 * [INPUT]: Mermaid 惰性模块与阅读容器。
 * [OUTPUT]: 导出 renderMermaidBlocks，渲染图表并隔离单块错误。
 * [POS]: 阅读视图与实时预览共用的图表适配器。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
let mermaidInstance = null;

/**
 * 渲染容器内所有 .mermaid-source 节点为图表（阅读视图与实时预览共用）。
 * 惰性加载 mermaid（首次调用时 initialize，主题跟随 body.theme-dark）。
 */
export async function renderMermaidBlocks(el) {
  const mermaidEls = el.findAll ? el.findAll('.mermaid-source') : el.querySelectorAll('.mermaid-source');
  if (!mermaidEls.length) return;
  try {
    if (!mermaidInstance) {
      const mermaid = (await import('mermaid')).default;
      mermaid.initialize({ startOnLoad: false, theme: document.body.hasClass('theme-dark') ? 'dark' : 'default', securityLevel: 'loose' });
      mermaidInstance = mermaid;
    }
    let i = 0;
    for (const src of mermaidEls) {
      const code = src.getAttr('data-source') || '';
      try {
        const { svg } = await mermaidInstance.render('mermaid-' + Date.now() + '-' + (i++), code);
        src.innerHTML = svg;
        src.addClass('mermaid');
        src.removeClass('mermaid-source');
      } catch (e) {
        src.addClass('mermaid-error');
      }
    }
  } catch (e) { console.error('mermaid load failed', e); }
}
