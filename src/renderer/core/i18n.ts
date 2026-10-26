/**
 * [INPUT]: 原版提取的中英文语言表与系统语言。
 * [OUTPUT]: 导出语言选择、本地化查询与复数插值函数。
 * [POS]: 界面文案唯一查询层。缺键退回英文，再退回末段键名。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
/* i18n — uses the locale files extracted 1:1 from the original app. */
import en from '../locales/locale-en.json';
import zh from '../locales/locale-zh.json';

type Variables = Record<string, unknown>;
const ENGLISH: Record<string, string> = en;
const LOCALES: Record<string, Record<string, string>> = { en, zh, 'zh-CN': zh };
let current = 'en';

export function setLanguage(lang: string) {
  if (LOCALES[lang]) current = lang;
  else if (lang && lang.startsWith('zh')) current = 'zh';
  else current = 'en';
  try { localStorage.setItem('language', lang || current); } catch (e) {}
}

export function getLanguage() {
  return current;
}

export function detectLanguage(systemLocale?: string) {
  let saved = null;
  try { saved = localStorage.getItem('language'); } catch (e) {}
  if (saved && (LOCALES[saved] || saved.startsWith('zh'))) return saved;
  const nav = systemLocale || navigator.language || 'en';
  return nav.startsWith('zh') ? 'zh' : 'en';
}

function lookup(key: string) {
  const dict = LOCALES[current] || en;
  if (dict[key] !== undefined) return dict[key];
  if (ENGLISH[key] !== undefined) return ENGLISH[key];
  return null;
}

export function t(key: string, vars?: Variables): string {
  let str = lookup(key);
  if (str === null) {
    // Missing translation shows the last segment like i18next would
    str = key.split('.').pop() || key;
  }
  if (vars) {
    const count = vars.count;
    if (count !== undefined && count !== 1) {
      const plural = lookup(key + '_plural');
      if (plural) str = plural;
    }
    str = str.replace(/\{\{([^}]+)\}\}/g, (m: string, name: string) => {
      const name2 = name.trim();
      if (vars[name2] !== undefined) return String(vars[name2]);
      const camel = name2.replace(/-([a-z])/g, (mm: string, c: string) => c.toUpperCase());
      if (vars[camel] !== undefined) return String(vars[camel]);
      return m;
    });
  }
  return str;
}

/**
 * 取词条并带兜底：t() 缺失时返回键名末段，tt() 检测到该情形改用 fallback。
 * 设置界面全部走 tt()，保证缺键时仍显示可读文案。
 */
export function tt(key: string, fallback?: string, vars?: Variables): string {
  const value = t(key, vars);
  const last = key.split('.').pop() || key;
  let str = (value === null || value === undefined || value === last) ? (fallback !== undefined ? fallback : last) : value;
  // 兜底文案同样支持 {{name}} 插值（缺键时 t() 返回键名，vars 不会应用到 fallback）
  if (vars && typeof str === 'string') {
    str = str.replace(/\{\{([^}]+)\}\}/g, (m: string, name: string) => (vars[name] !== undefined ? String(vars[name]) : m));
  }
  return str;
}

// Convenience localizer factory like i18next's fixed-T
export function getT(prefix: string) {
  return (key: string, vars?: Variables) => t(prefix ? prefix + '.' + key : key, vars);
}

export function getNouns() {
  return {
    count: (n: number) => t('nouns.count', { count: n }),
    word: (n: number) => t('nouns.word-with-count', { count: n }),
    result: (n: number) => t('nouns.result-with-count', { count: n }),
    character: (n: number) => t('nouns.character-with-count', { count: n }),
    link: (n: number) => t('nouns.link-with-count', { count: n }),
    file: (n: number) => t('nouns.file-with-count', { count: n }),
    folder: (n: number) => t('nouns.folder-with-count', { count: n }),
    backlink: (n: number) => t('nouns.backlink-with-count', { count: n }),
    tabs: (n: number) => t('nouns.tabs-with-count', { count: n }),
    properties: (n: number) => t('nouns.properties-with-count', { count: n }),
    plugin: (n: number) => t('nouns.plugin-with-count', { count: n }),
    theme: (n: number) => t('nouns.theme-with-count', { count: n }),
    snippet: (n: number) => t('nouns.snippet-active-with-count', { count: n }),
  };
}
