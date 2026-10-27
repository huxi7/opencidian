# 桌面发布

## 版本来源

源码的 package.json 不维护版本号。
发布版本只取自 vX.Y.Z 标签，由 electron-builder 写入安装包元数据。
本地开发显示 dev；无版本标签的本地安装包使用 0.0.0-dev。
参考产品的版本不参与本应用版本计算。

## 发布新版本

确认 main 已包含要发布的代码，再创建并推送标签：

```sh
git tag -a v1.0.1 -m "本次更新说明"
git push origin v1.0.1
```

附注标签的说明直接成为 Release 正文。
轻量标签自动生成更新说明。
版本标签必须符合 vX.Y.Z；普通分支 push 不发布。

## 流水线

1. 校验标签与构建提交，创建草稿 Release。
2. macOS ARM64、Windows x64 和 Linux x64 分别运行测试与打包。
3. macOS 26 构建机用 Xcode 26+ 编译原生图标并完成 ad-hoc 签名。
4. 校验透明晶体像素；解包安装包核验原生图标、签名与资源封装。
5. 启动各平台目录包，校验版本、文件哈希与实际笔记操作。
6. 上传安装包到草稿，并比对 GitHub SHA-256 与本地文件。
7. 三平台全过后生成 SHA256SUMS，附件齐备才公开。

安装包分别为 DMG、NSIS EXE 和 AppImage。
AppImage 打包名使用 x86_64；上传时统一为下载名 x64。
macOS Intel、Windows ARM64 与 Linux ARM64 尚未配置。
macOS 使用无需证书的 ad-hoc 签名，未做 Apple 公证。
它保证包的完整性，不提供受信任的发布者身份。
Windows 安装包未签名。
ad-hoc 不满足 Gatekeeper 的可信分发要求。
可信下载的单应用解除隔离步骤见根 README。
正式受信任分发需要 Developer ID 证书与 Apple 公证。
Linux CI 使用虚拟显示；仅测试进程关闭 Chromium sandbox。
CI 启动验证不替代真实用户桌面的完整交互验收。

使用内置 GITHUB_TOKEN，无需个人令牌。
产物直接传入草稿，不占 Actions 产物存储配额。
构建失败保留草稿；应用源码修复后用新标签发布。
网络失败可重跑失败任务，覆盖同名草稿附件。
已经公开的 Release 不被自动重写。

## 重试未公开版本

发布脚本修复不移动旧标签。
先将修复推送 main，再重试已有标签：

```sh
gh workflow run release.yml --ref main -f release_tag=v1.0.0
```

源码检出目标标签的固定提交。
发布工具检出本次工作流的固定提交。
两份代码分别验证，工具不进入安装包。
三平台重新构建并覆盖该草稿的同名附件。
公开版本拒绝重试；安装包上传仍须匹配标签源码。

## 发布前验证

GitHub Actions 中手动运行 Desktop release。
release_tag 留空只测试与打包，不创建 Release 或上传附件。
已公开版本的源码更新，可只验证相同版本的候选包：

```sh
gh workflow run release.yml --ref main -f validation_tag=v1.0.0
```

validation_tag 只向候选包注入版本。
它不移动标签、不上传附件，也不改变公开 Release。
公开版本保护仍生效；需要重发时先明确解决保护策略。

唯一晶体源为 assets/app-symbol.svg。
Windows/Linux 使用透明 PNG、ICO。
macOS 使用 build/OpenSidian.icon，底板和晶体分层。
macOS 26+ 配合 Xcode 26+ 的 actool 生成原生图标资源。
macOS 15 上仅选择 Xcode 26 仍会缺少运行时框架。
仓库不维护预制 macOS 圆角图或 ICNS。
本地仅有 Command Line Tools 时，macOS 打包会明确失败。
CI 选择 Xcode 26+；不回退为通用 PNG 图标。
用以下命令导出或校验：

```sh
python3 -m pip install -r scripts/icon-requirements.txt
python3 scripts/make-app-icon.py
python3 scripts/make-app-icon.py --check
```

各系统还可本地运行：

```sh
npm ci
npm test
npm run dist
node scripts/smoke-packaged.mjs --no-screenshot
python3 scripts/verify-packaged-icons.py
```

Linux 无桌面会话时，通过 xvfb-run 执行冒烟脚本。
完整 Electron 场景仍由 npm run test:acceptance 单独执行。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
