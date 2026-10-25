/**
 * [INPUT]: 文件扩展名、编辑偏好与视图注册表。
 * [OUTPUT]: 导出 viewStateForFile，生成文件视图状态。
 * [POS]: 工作区文件分派边界。插件扩展名由注册表决定。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export function viewStateForFile(app: App, file) {
    const ext = (file.extension || '').toLowerCase();
    if (ext === 'md') {
      const settings = app.settings.appSettings;
      // 原版语义：defaultViewMode 'source'（编辑视图）| 'preview'（阅读视图）；livePreview 决定编辑视图用实时预览还是源码
      const editingMode = settings.livePreview === false ? 'source' : 'live';
      const mode = settings.defaultViewMode === 'preview' ? 'preview' : editingMode;
      return { type: 'markdown', state: { file: file.path, mode } };
    }
    const type = app.viewRegistry.getTypeByExtension(ext);
    if (type) return { type, state: { file: file.path } };
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext)) return { type: 'image', state: { file: file.path } };
    if (['mp4', 'webm', 'ogv', 'mov', 'mkv'].includes(ext)) return { type: 'video', state: { file: file.path } };
    if (['mp3', 'wav', 'm4a', 'ogg', 'flac', '3gp', 'opus'].includes(ext)) return { type: 'audio', state: { file: file.path } };
    if (ext === 'pdf') return { type: 'pdf', state: { file: file.path } };
    return { type: 'empty', state: {} };
}
