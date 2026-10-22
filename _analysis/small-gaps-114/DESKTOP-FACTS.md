# 桌面窗口与数据写回事实

原版仅静态读取 renderer/app.js。字符偏移以 UTF-8 文本解码后计。

| 位置 | 契约 | 本轮实现 |
| --- | --- | --- |
| 1241671 | ItemView 的 open 段注册移至新窗口，图标 lucide-picture-in-picture | 标签菜单和命令共用转移协调器 |
| 2890446 | 文件菜单在新窗口打开，图标 lucide-picture-in-picture-2 | 同库文档副本窗口 |
| 2927828 | moveLeafToPopout 保存来源尺寸、缩放并移动叶子 | 加载成功才移除来源，继承叶子尺寸与缩放，独立布局恢复 |
| 3925663 | nativeMenus=null 在 macOS 使用系统菜单 | 平台默认和开关回显一致 |
| 3855256 | 原生菜单开关使用 ES.useNativeMenu 回显 | DOM/系统菜单共用动作树 |
| 1226590 附近 | 系统菜单树保留分节、可用状态和布尔勾选；坐标乘缩放系数，不传图标 | 共用动作树和物理坐标 |
| 544807 | Ul 使用取整 birthtimeMs/mtimeMs | 修复 ctimeMs 被误当创建时间 |
| 1802594 | FileManager 提供 processFrontMatter 回调接口 | 保留接口，跨窗口通过主进程 CAS 写入 |

写入实现使用按文件串行、比较原文及同目录原子替换。
冲突后属性回调重算。macOS 的 Electron 33 copyFile 不保留创建时间，使用系统 cp -p 复制元数据后原子替换；不调用 shell。坏 YAML、缺分隔线、数组与标量均拒写。
该队列约束应用内协作窗口，不能锁住任意外部编辑器。
库路径在主进程校验，库外文件拒写。

独立窗口运行自己的 App 和文件监听，跳过主布局读写。
Markdown、Bases 与 Canvas 均实际启动测试。
正常关闭先保存，转移前保存失败则保留原标签。
E2E 窗口透明且不可聚焦；系统菜单只构建，不弹出。

独立窗口采用各自 App 的同库监听，未搬运同一 DOM/Workspace 对象。
尺寸、位置、缩放与状态写入 workspace-popouts.json，关闭主库后可恢复。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
