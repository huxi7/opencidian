# MathJax 离线运行时

版本：**3.2.2**。核对日期：2026-10-17。

公开包：`mathjax@3.2.2`。
来源：`https://registry.npmjs.org/mathjax/-/mathjax-3.2.2.tgz`。
元数据：`https://registry.npmjs.org/mathjax/3.2.2`。
上游仓库：`https://github.com/mathjax/MathJax/tree/3.2.2`。

包 SHA-256：
`1b9c0a1c44df864e915690558e72adb9cc5203360daefd385084ced3b6c64c09`

npm 完整性校验已通过：
`sha512-Bt+SSVU8eBG27zChVewOicYs7Xsdt40qm4+UpHyX7k0/O9NliPc+x77k1/FEsPsjKPZGJvtRZM1vO+geW0OhGw==`

## 文件来源

`tex-chtml-full.js` 来自包内 `es5/tex-chtml-full.js`。
`ui/safe.js` 来自包内 `es5/ui/safe.js`。
23 个 WOFF 来自包内 `es5/output/chtml/fonts/woff-v2/`。
`LICENSE` 来自包根目录，内容为 Apache-2.0。
字体内嵌声明使用 SIL Open Font License 1.1。
字体的版权声明和保留名称仍保存在原始 WOFF 中。
`FONT-NOTICES.txt` 逐字体摘录原始版权和许可声明。
`OFL.txt` 保留 SIL 官方许可正文。
正文来自 `https://openfontlicense.org/documents/OFL.txt`。
省略官网模板中的占位署名，实际署名见字体声明。
全部第三方运行时与字体保持原始字节；逐文件校验见 `SHA256SUMS`。
未运行 npm 安装，未修改依赖清单。

## 与原版的等同证据

只读对照：`_analysis/obsidian-asar/lib/mathjax/`。
原版 `tex-chtml-full.js` 长 1,338,727 字节。
原版 SHA-256：
`440dde1db4eb1fd2c0be99fb5f8bf946f339a9e5dade55bcb069a1937a7fb803`

原版完整文件等于以下公开字节拼接：

1. npm 主构建，1,327,522 字节，偏移 0。
2. 换行、`// ui/safe.js` 注释、换行，共 15 字节。
3. npm 安全扩展，11,189 字节，偏移 1,327,537。
4. 最后一个换行。

23 个 WOFF 与 npm 字体逐字节相同。
原版独立 `output/chtml/fonts/tex.js` 的标记为 3.2.1。
它与 3.2.2 对应文件仅版本字符串不同。
主构建已内嵌字体代码，故本目录不携带独立字体脚本。

REA 静态分析证据：
`ev_1a77c6fe182102050792567d2563a5a2007835bdc8695d050a063638ea4b11bc`。
REA 只解析两个公开库脚本，语义图有数量上限。
等同结论来自上述完整字节比较，不依赖截断语义图。

## 适配器约定

源码：`src/renderer/markdown/math.js`。
资源根路径：`/assets/mathjax/`，沿用既有 app 协议。
每个文档首次出现公式时加载一次。
官方 loader 从本目录加载 `ui/safe.js`。
等待 `startup.promise` 与安全扩展后才转换公式。
不启用全文自动扫描与 MathJax 菜单。
协议白名单与原版一致：允许 http、https、file；拒绝 javascript、data。
用 `tex2chtml` 转换，用 `chtmlStylesheet` 累计字形规则。
渲染错误只回退当前节点的 TeX 文本。
`require` 只允许全构建已内嵌的官方扩展。
原版禁止的 base、autoload、setoptions 等保持禁止。
未知扩展直接回退文本，避免缺失脚本的未捕获拒绝。

阅读器生成 `.math[data-math]` 占位节点。
把完整 TeX 放入已转义的 `data-math` 属性。
行内加 `math-inline`，块公式加 `math-block`。
写入 DOM 后调用 `await renderMathBlocks(root)`。
编辑器直接调用 `renderMath(element, tex, display)`。
编辑器在 Promise 完成后自行请求布局测量。
L2 文档、阅读器、编辑器、构建与截图由主代理接线验收。

## 官方接口资料

context7 库：`/mathjax/mathjax-docs`。
转换与样式：`https://docs.mathjax.org/en/v3.2/web/convert.html`。
安全扩展：`https://docs.mathjax.org/en/v3.2/options/safe.html`。
本地托管：`https://docs.mathjax.org/en/v3.2/web/hosting.html`。
