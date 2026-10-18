// Pure helpers for the bookmarklet feature. Kept apart from the core so it can be deleted wholesale.
import source from './amazon-search.js?raw';

export interface BmItem { t: string; p: string; u?: string }

/** Build the javascript: URL for the given tool address. */
export function buildBookmarklet(toolUrl: string): string {
  const code = source
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s*\n\s*/g, ' ')
    .replace('__TOOL_URL__', toolUrl.replace(/'/g, "\\'"));
  return 'javascript:' + encodeURIComponent(code);
}

/** Read "#bm=…" from a location hash. Returns null if absent or malformed. */
export function readBookmarkletHash(hash: string): BmItem[] | null {
  const m = /^#bm=(.+)$/.exec(hash);
  if (!m) return null;
  try {
    const data: unknown = JSON.parse(decodeURIComponent(m[1]));
    if (!Array.isArray(data)) return null;
    return data
      .filter((x): x is BmItem => !!x && typeof x.t === 'string' && typeof x.p === 'string')
      .map((x) => ({ t: x.t.slice(0, 300), p: x.p.slice(0, 30), u: typeof x.u === 'string' && /^https?:\/\//i.test(x.u) ? x.u.slice(0, 200) : '' }));
  } catch {
    return null;
  }
}

/** Turn bookmarklet items into paste text so the normal parser handles them. */
export function itemsToPasteText(items: BmItem[]): string {
  return items.map((i) => `${i.t}\n${i.p}`).join('\n\n');
}
