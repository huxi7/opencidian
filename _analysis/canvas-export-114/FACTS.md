# 画布导出 1.14.4 静态对照

事实源：`_analysis/obsidian-114/renderer/app.js`、`app.css`。没有启动原版。

- app.js 字符偏移 3352197：`generateHDImage` 的最长边常数为 16284。最大缩放为 `min(2,16284/s/width,16284/s/height)`；s 为屏幕像素密度与页面缩放的比值。
- app.js 3350561 附近：截图前加 `is-screenshotting`；隐私选项加 `is-text-garbled`；finally 删除导出状态。
- app.css 字符偏移 111881 附近：`.is-text-garbled *` 改字体为 `Flow Circular`，行高改为 1.45em。此规则没有隐藏 img、video、iframe 或 webview。
- app.css 字符偏移 105312 附近：Flow Circular 的源文件为 `public/fonts/4bb6ac751d1c5478ff3a.woff2`。
- 未找到该提取目录中的字体许可证。没有复制该字体；本实现使用自主绘制的圆角字形，不声称字形 1:1。

实现边界：

- 长边常数恢复为 16284。像素密度按原版 `round(devicePixelRatio / getZoomFactor() * 1e5) / 1e5` 取整，预计尺寸与 PNG 共用同一计算。
- 分配大位图前检查 512 MiB 的保守预算。估计值覆盖输出表面、编码副本、Base64 和截图分块。超过预算明确要求减小缩放或范围，不静默降到 4096。
- 视口范围直接使用 canvas.scale。弹层不提交已隐藏的全图 scale；程序入口也忽略视口参数里的 scale。
- 真实导出按 DOM Range 读取文字位置，生成原卡片或标签内部的临时 SVG。浏览器执行卡片裁切与 z 叠层，内部 overflow 另按其矩形裁切。取消整窗截图之后的全局字形叠绘。
- 只遮蔽文本填充，保留图片、网页与视频，符合原版静态规则。此选项不能删除媒体中的敏感内容。
- 隐私字符上限为 200000。超过上限在截图前报错。
- 成功或异常后移除临时 SVG，释放输出位图并恢复 DOM、视口与正文挂载状态。

验收边界：fidelity 场景读取实际 PNG 的尺寸、媒体色块、内部裁切、卡片外溢及遮挡像素；不等于与原版逐像素比较。自绘字形只覆盖 DOM 文本，不声称复制原字体、复杂 SVG/媒体内部文字或全部排版轮廓。512 MiB 是分配前估算阈值，不是进程内存硬限制。

REA 对 app.js 的 AST 分析触发 30000ms 超时。超时证据 `ev_e59b83eece63e223d931f699c73ca592ff98812e5e27449b26ec931702d1403a` 不用于功能结论。以上结论来自对指定静态文件的直接读取。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
