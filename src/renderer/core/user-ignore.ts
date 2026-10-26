/**
 * [INPUT]: 调用方提供最新 userIgnoreFilters 数组。
 * [OUTPUT]: 导出 createUserIgnoreMatcher，生成随配置更新的路径判定器。
 * [POS]: 忽略规则的共享叶子模块。元数据缓存向插件暴露统一入口。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export function createUserIgnoreMatcher(getFilters: () => unknown) {
  let serialized: string | null = null;
  let rules: RegExp[] = [];
  return (fileOrPath: string | { path: string } | null | undefined) => {
    const path = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath?.path;
    if (typeof path !== 'string') return false;
    const value = getFilters();
    const filters = Array.isArray(value) ? value : [];
    const next = JSON.stringify(filters);
    if (next !== serialized) {
      serialized = next;
      rules = filters.flatMap((value) => {
        if (typeof value !== 'string' || !value.trim()) return [];
        const rule = value.trim();
        try {
          const source = rule.length > 2 && rule.startsWith('/') && rule.endsWith('/')
            ? rule.slice(1, -1)
            : '^' + rule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return [new RegExp(source, 'i')];
        } catch { return []; }
      });
    }
    return rules.some((rule) => rule.test(path));
  };
}
