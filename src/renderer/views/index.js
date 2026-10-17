/* Built-in view registration. Plugin-provided views (graph, canvas, ...) are
 * registered by their own core plugins. */
import { EmptyView } from './empty-view.js';
import { MarkdownView } from './markdown-view.js';
import { ImageView, VideoView, AudioView, PdfView } from './media-view.js';
import { installSettingsHost } from './settings-view.js';

export { EmptyView, MarkdownView, ImageView, VideoView, AudioView, PdfView };

const MEDIA_EXTENSIONS = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'],
  video: ['mp4', 'webm', 'ogv', 'mov', 'mkv'],
  audio: ['mp3', 'wav', 'm4a', 'ogg', '3gp', 'flac', 'opus'],
  pdf: ['pdf'],
};

export function registerBuiltinViews(app) {
  const reg = app.viewRegistry;
  reg.registerView('empty', (leaf) => new EmptyView(leaf));
  reg.registerView('markdown', (leaf) => new MarkdownView(leaf));
  reg.registerView('image', (leaf) => new ImageView(leaf));
  reg.registerView('video', (leaf) => new VideoView(leaf));
  reg.registerView('audio', (leaf) => new AudioView(leaf));
  reg.registerView('pdf', (leaf) => new PdfView(leaf));

  // extension hints used by getTypeByExtension
  for (const [type, exts] of Object.entries(MEDIA_EXTENSIONS)) {
    const creator = reg.getViewCreator(type);
    if (creator) creator.extensions = exts;
  }
  const md = reg.getViewCreator('markdown');
  if (md) md.extensions = ['md'];

  installSettingsHost(app);
}
