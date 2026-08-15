// Translation shim.
//
// The app is English-only today and may stay that way. This exists anyway,
// because extracting strings from a finished component tree is miserable and
// extracting them while writing the component is free.
//
// It is deliberately about 60 lines. It is not a framework, it takes no
// dependency, and if a second language is ever actually needed, swapping in
// react-i18next means replacing this file — every `t('key')` call site keeps
// working.
//
// CONVENTION — follow this in every new component:
//
//   import { t } from '../../i18n';
//   <button>{t('community.post.submit')}</button>
//   <p>{t('community.feed.empty', { space: space.name })}</p>
//
// Key naming: `area.component.thing`. Lowercase, dot-separated, describing
// where the string lives rather than what it says — `community.post.submit`,
// not `community.postButtonSaysSubmit`.
//
// What NOT to extract: admin-only strings that only staff read, log messages,
// and error text that is already server-generated. Extraction is for what a
// user sees.

import en from './en';

const CATALOGS = { en };

const FALLBACK_LOCALE = 'en';
let locale = FALLBACK_LOCALE;

// Reported once per key, so a missing string is visible in development without
// flooding the console on every render.
const warned = new Set();

const lookup = (catalog, key) =>
  key.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), catalog);

/**
 * Substitute {placeholders}.
 *
 * Values are inserted as plain strings and never as HTML — a translated string
 * is not a template, and treating it as one is how an XSS gets into a locale
 * file.
 */
const interpolate = (template, vars) => {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  );
};

/**
 * Translate a key.
 *
 * Missing keys return the key itself rather than empty text. A visible
 * `community.post.submit` in the UI is an obvious bug; a blank button is not.
 *
 * @param {string} key
 * @param {object} [vars]
 * @returns {string}
 */
export const t = (key, vars) => {
  if (typeof key !== 'string' || !key) return '';

  const value = lookup(CATALOGS[locale], key) ?? lookup(CATALOGS[FALLBACK_LOCALE], key);

  if (typeof value !== 'string') {
    if (import.meta.env?.DEV && !warned.has(key)) {
      warned.add(key);
      console.warn(`[i18n] missing translation: ${key}`);
    }
    return key;
  }

  return interpolate(value, vars);
};

/**
 * Pluralize.
 *
 *   community.post.commentCount: { one: '{n} comment', other: '{n} comments' }
 *   plural('community.post.commentCount', 3)  ->  '3 comments'
 *
 * English rules only. A real plural system needs Intl.PluralRules and per-locale
 * categories — that arrives with the framework, if it ever does.
 */
export const plural = (key, count, vars) => {
  const forms = lookup(CATALOGS[locale], key) ?? lookup(CATALOGS[FALLBACK_LOCALE], key);
  if (!forms || typeof forms !== 'object') return t(key, { ...vars, n: count });
  const form = count === 1 ? forms.one : forms.other;
  return interpolate(form || forms.other || key, { ...vars, n: count });
};

export const setLocale = (next) => {
  if (CATALOGS[next]) locale = next;
  return locale;
};

export const getLocale = () => locale;

export const availableLocales = () => Object.keys(CATALOGS);

/** Register a catalog. This is the seam a real i18n library would replace. */
export const registerCatalog = (code, catalog) => {
  CATALOGS[code] = catalog;
};

export default t;
