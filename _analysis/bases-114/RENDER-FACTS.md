# Bases 富值渲染 1.14.4 静态对照

事实源：`_analysis/obsidian-114/renderer/app.js`。没有启动原版。

- 字符偏移 2212106 附近：ImageValue 解析库内图片或外部 URL，创建 img。
- 字符偏移 2212591：MarkdownValue 的 renderTo 增加 markdown-rendered，调用 `fm(cm(data))` 生成块级 HTML，再调用 `cC` 净化。
- 字符偏移 2212869：HTMLValue 的 renderTo 对原字符串调用 `cC`；两类值均调用 `app.fixFileLinks` 修正文件资源地址。
- 字符偏移 849165：`cC` 使用 DOMPurify，返回净化后的 DocumentFragment。
- `lC` 禁止 style 标签，允许 iframe，保留安全属性；DOMPurify 去掉脚本及事件属性。

实现：

- HTML 先用仓库已安装的 DOMPurify 3.4.17 净化，再插入 DOM。禁止脚本、对象、表单、srcdoc 和全局样式。
- iframe 强制空 sandbox，禁止脚本、表单和弹窗。链接走已有工作区或桌面 IPC，值的布局与绘制被 contain 限定。
- Markdown 复用 reading.js 的块解析、callout、表格、代码高亮、笔记/附件/画布/数据库嵌入与 MathJax。
- 受控 DOM 容器拦截阅读器的 HTML 提交；笔记嵌入挂载点继承同一净化边界。不修改共用 Markdown 解析器。
- Mermaid 的 SVG 同样净化。只保留以该 SVG id 开头的样式规则，阻止图表样式影响应用界面。
- 生成内容的任务复选框只读，避免将公式中的 offset 当成笔记正文 offset 写回。
- 数据库嵌入深度超过五层后降级为文件附件，阻止公式递归嵌入自身。
- HTML 与 Markdown 图片均修正为受控库内资源地址；附件采用同目录和库内文件名解析。

安全选择：本实现限制 iframe 脚本权限，并在原版块级格式基础上调用现有嵌入、数学和高亮管线。原版静态代码不能证明所有后处理和动态交互与本实现相同。

DOMPurify 3.4.17 由主线登记为直接依赖，构建时内联进 renderer。

富值资源由 bases-rich-lifecycle.js 持有。每文档一个弱引用观察器。布局重绘调用 disposeBaseRichValues(root)，控制器关闭调用 disposeBaseRichController(controller)。移出 DOM 同样自动释放。阅读器渲染与交互接收可选 AbortSignal，数学与图表提供取消入口；取消后清空宿主引用，保留其他宿主共用的引擎初始化。

生命周期验收使用挂起读盘与数学初始化、原生 MutationObserver 计数、五轮重绘及 220 行真实笔记的虚拟换窗。卡片网格范围与列数不变时保留 DOM，不因异步内容测高而重建宿主。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
