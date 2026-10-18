import type { AppState, Currency, Lang, ProductList } from './types';
import { newId, sanitizeList } from './io';
import { translate } from './i18n';

export const STORAGE_KEY = 'leafwise:v1';

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }

export function newList(name: string): ProductList {
  return { id: newId(), name, rows: [], rankBy: 'unit' };
}

export function defaultState(lang: Lang = 'en'): AppState {
  const list = newList(translate(lang, 'defaultListName'));
  return { version: 1, lists: [list], activeId: list.id, lang, currency: lang === 'ja' ? 'JPY' : 'USD', basis: 100 };
}

/** Never throws: corrupt or unavailable storage falls back to a fresh state. */
export function loadState(storage: KV | null, browserLang = 'en'): AppState {
  const lang: Lang = browserLang.toLowerCase().startsWith('ja') ? 'ja' : 'en';
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return defaultState(lang);
    const o = JSON.parse(raw) as Record<string, unknown>;
    const rawLists = Array.isArray(o.lists) ? (o.lists as Record<string, unknown>[]) : [];
    const lists = rawLists.map((l) => ({ ...sanitizeList(l, 'List'), id: typeof l.id === 'string' ? l.id : newId() }));
    // sanitizeList regenerates row ids; keep stored ones so UI state stays stable
    lists.forEach((l, i) => {
      const rows = (rawLists[i].rows as Record<string, unknown>[]) ?? [];
      l.rows.forEach((r, j) => { if (typeof rows[j]?.id === 'string') r.id = rows[j].id as string; });
    });
    if (!lists.length) return defaultState(lang);
    const activeId = lists.some((l) => l.id === o.activeId) ? (o.activeId as string) : lists[0].id;
    return {
      version: 1,
      basis: o.basis === 1 ? 1 : 100,
      lists,
      activeId,
      lang: o.lang === 'ja' || o.lang === 'en' ? (o.lang as Lang) : lang,
      currency: (o.currency === 'JPY' || o.currency === 'USD' ? o.currency : lang === 'ja' ? 'JPY' : 'USD') as Currency,
    };
  } catch {
    return defaultState(lang);
  }
}

export function saveState(storage: KV | null, state: AppState): void {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* quota / private mode: keep working in memory */ }
}
