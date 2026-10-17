/* CodeMirror completion source for [[wikilinks]] (and embeds). */
export function wikilinkCompletionSource(app) {
  return (context) => {
    const line = context.state.doc.lineAt(context.pos);
    const textBefore = line.text.slice(0, context.pos - line.from);
    const m = textBefore.match(/(!?)\[\[([^\]\n|]*)$/);
    if (!m && !context.explicit) return null;
    const embed = m ? m[1] === '!' : false;
    const query = m ? m[2] : '';
    const hashIdx = query.indexOf('#');
    const pathQuery = hashIdx >= 0 ? query.slice(0, hashIdx) : query;
    const from = context.pos - (hashIdx >= 0 ? (query.length - hashIdx) : query.length);

    if (hashIdx >= 0 && pathQuery) {
      // heading completion inside an existing file
      const dest = app.metadataCache.getFirstLinkpathDest(pathQuery, null);
      const file = dest && app.vault.getFileByPath(dest);
      const cache = file && app.metadataCache.getFileCache(file);
      const options = (cache && cache.headings ? cache.headings : []).map((h) => ({
        label: h.heading,
        type: 'text',
        apply: h.heading,
      }));
      return { from: context.pos, options: options.slice(0, 100), validFor: /^[^\]\n]*$/ };
    }

    const files = app.vault.getMarkdownFiles();
    const q = pathQuery.toLowerCase();
    const scored = [];
    for (const file of files) {
      const base = file.basename.toLowerCase();
      let score = 0;
      const idx = base.indexOf(q);
      if (q === '') score = 1;
      else if (idx === 0) score = 100 - base.length;
      else if (idx > 0) score = 50 - idx;
      else if (file.path.toLowerCase().includes(q)) score = 10;
      if (score > 0) scored.push({ file, score });
      if (scored.length > 4000) break;
    }
    scored.sort((a, b) => b.score - a.score);
    const options = scored.slice(0, 50).map(({ file }) => ({
      label: file.basename,
      detail: file.path,
      type: 'file',
      apply: embed ? file.basename + ']]' : file.basename,
      info: file.path,
    }));
    return { from, options, validFor: /^[^\]\n|]*$/ };
  };
}
