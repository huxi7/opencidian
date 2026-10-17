/* i18n — uses the locale files extracted 1:1 from the original app. */
import en from '../locales/locale-en.json';
import zh from '../locales/locale-zh.json';

const LOCALES = { en, zh, 'zh-CN': zh };
let current = 'en';

export function setLanguage(lang) {
  if (LOCALES[lang]) current = lang;
  else if (lang && lang.startsWith('zh')) current = 'zh';
  else current = 'en';
  try { localStorage.setItem('language', lang || current); } catch (e) {}
}

export function getLanguage() {
  return current;
}

export function detectLanguage(systemLocale) {
  let saved = null;
  try { saved = localStorage.getItem('language'); } catch (e) {}
  if (saved && (LOCALES[saved] || saved.startsWith('zh'))) return saved;
  const nav = systemLocale || navigator.language || 'en';
  return nav.startsWith('zh') ? 'zh' : 'en';
}

function lookup(key) {
  const dict = LOCALES[current] || en;
  if (dict[key] !== undefined) return dict[key];
  if (en[key] !== undefined) return en[key];
  return null;
}

export function t(key, vars) {
  let str = lookup(key);
  if (str === null) {
    // Missing translation shows the last segment like i18next would
    str = key.split('.').pop();
  }
  if (vars) {
    const count = vars.count;
    if (count !== undefined && count !== 1) {
      const plural = lookup(key + '_plural');
      if (plural) str = plural;
    }
    str = str.replace(/\{\{([^}]+)\}\}/g, (m, name) => {
      const name2 = name.trim();
      if (vars[name2] !== undefined) return String(vars[name2]);
      const camel = name2.replace(/-([a-z])/g, (mm, c) => c.toUpperCase());
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
export function tt(key, fallback, vars) {
  const value = t(key, vars);
  const last = key.split('.').pop();
  if (value === null || value === undefined || value === last) return fallback !== undefined ? fallback : last;
  return value;
}

// Convenience localizer factory like i18next's fixed-T
export function getT(prefix) {
  return (key, vars) => t(prefix ? prefix + '.' + key : key, vars);
}

export function getNouns() {
  return {
    count: (n) => t('nouns.count', { count: n }),
    word: (n) => t('nouns.word-with-count', { count: n }),
    result: (n) => t('nouns.result-with-count', { count: n }),
    character: (n) => t('nouns.character-with-count', { count: n }),
    link: (n) => t('nouns.link-with-count', { count: n }),
    file: (n) => t('nouns.file-with-count', { count: n }),
    folder: (n) => t('nouns.folder-with-count', { count: n }),
    backlink: (n) => t('nouns.backlink-with-count', { count: n }),
    tabs: (n) => t('nouns.tabs-with-count', { count: n }),
    properties: (n) => t('nouns.properties-with-count', { count: n }),
    plugin: (n) => t('nouns.plugin-with-count', { count: n }),
    theme: (n) => t('nouns.theme-with-count', { count: n }),
    snippet: (n) => t('nouns.snippet-active-with-count', { count: n }),
  };
}
