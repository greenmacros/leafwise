import { PRODUCT_COLORS, type Product, type ProductList, type RankBy, type Unit } from './types';
import { UNIT_LIST, normalizeUnit } from './units';

/** Only plain web links are kept; anything else (javascript:, data:…) becomes ''. */
export const sanitizeUrl = (u: unknown): string =>
  typeof u === 'string' && /^https?:\/\/[^\s]+$/i.test(u.trim()) ? u.trim().slice(0, 500) : '';

export const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
};

export function sanitizeProduct(raw: unknown): Product {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const u = typeof o.unit === 'string' ? normalizeUnit(o.unit) : null;
  const unit: Unit = u && UNIT_LIST.includes(u) ? u : 'ml';
  return {
    id: newId(),
    name: typeof o.name === 'string' ? o.name : '',
    price: numOrNull(o.price),
    packs: numOrNull(o.packs),
    size: numOrNull(o.size),
    unit,
    points: numOrNull(o.points),
    coupon: numOrNull(o.coupon),
    shipping: numOrNull(o.shipping),
    uses: numOrNull(o.uses),
    note: typeof o.note === 'string' ? o.note : '',
    color: typeof o.color === 'string' && (PRODUCT_COLORS as readonly string[]).includes(o.color) ? o.color : '',
    store: typeof o.store === 'string' ? o.store.slice(0, 60) : '',
    url: sanitizeUrl(o.url),
  };
}

export function sanitizeList(raw: unknown, fallbackName = 'List'): ProductList {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rows = Array.isArray(o.rows) ? o.rows.map(sanitizeProduct) : [];
  const rankBy: RankBy = o.rankBy === 'use' ? 'use' : 'unit';
  return { id: newId(), name: typeof o.name === 'string' && o.name ? o.name : fallbackName, rows, rankBy };
}

/* ---------- JSON ---------- */

export function listToJSON(list: ProductList): string {
  const { name, rankBy, rows } = list;
  return JSON.stringify({ app: 'leafwise', version: 1, name, rankBy, rows: rows.map(({ id: _id, ...r }) => r) }, null, 2);
}

/** Accepts one exported list, {lists:[…]}, or a bare array of rows. Throws on anything else. */
export function listsFromJSON(text: string, fallbackName = 'Imported'): ProductList[] {
  const data: unknown = JSON.parse(text);
  if (Array.isArray(data)) return [sanitizeList({ name: fallbackName, rows: data }, fallbackName)];
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.lists)) return o.lists.map((l, i) => sanitizeList(l, `${fallbackName} ${i + 1}`));
    if (Array.isArray(o.rows)) return [sanitizeList(o, fallbackName)];
  }
  throw new Error('Unrecognised JSON');
}

/* ---------- CSV ---------- */

export const CSV_COLUMNS = ['name', 'price', 'packs', 'size', 'unit', 'points', 'coupon', 'shipping', 'uses', 'note', 'store', 'color', 'url'] as const;

function csvCell(v: string | number | null): string {
  let s = v === null ? '' : String(v);
  // stop spreadsheets from treating text as a formula
  if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function listToCSV(list: ProductList): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of list.rows) lines.push(CSV_COLUMNS.map((c) => csvCell(r[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}

/** RFC 4180-ish parser: quoted fields, escaped quotes, newlines inside quotes, CRLF/LF, BOM. */
export function parseCSVRecords(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c !== '')) out.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== '')) out.push(row);
  return out;
}

export function listFromCSV(text: string, name = 'Imported'): ProductList {
  const recs = parseCSVRecords(text);
  if (!recs.length) throw new Error('Empty CSV');
  const header = recs[0].map((h) => h.trim().toLowerCase());
  if (!header.includes('price') && !header.includes('name')) throw new Error('CSV header not recognised');
  const rows = recs.slice(1).map((rec) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => { o[h] = (rec[i] ?? '').replace(/^'(?=[=+\-@])/, ''); });
    return o;
  });
  return sanitizeList({ name, rows }, name);
}
