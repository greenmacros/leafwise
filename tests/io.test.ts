import { describe, expect, it } from 'vitest';
import { listFromCSV, listToCSV, listToJSON, listsFromJSON, parseCSVRecords, sanitizeProduct } from '../src/core/io';
import { STORAGE_KEY, defaultState, loadState, saveState } from '../src/core/state';
import { DICT } from '../src/core/i18n';
import { buildBookmarklet, itemsToPasteText, readBookmarkletHash } from '../src/bookmarklet/install';
import { fmtMoney, fmtSmall } from '../src/core/format';
import { SAMPLE_ROWS } from '../src/core/sample';
import type { ProductList } from '../src/core/types';

const list = (): ProductList => ({
  id: 'l', name: 'Test', rankBy: 'use',
  rows: SAMPLE_ROWS.map((r, i) => ({ id: 'r' + i, ...r })),
});

describe('json', () => {
  it('round-trips', () => {
    const [back] = listsFromJSON(listToJSON(list()));
    expect(back.name).toBe('Test');
    expect(back.rankBy).toBe('use');
    expect(back.rows.map(({ id: _i, ...r }) => r)).toEqual(SAMPLE_ROWS);
  });
  it('accepts bare arrays and multi-list files', () => {
    expect(listsFromJSON('[{"name":"a","price":"1,000","size":"5","unit":"L"}]')[0].rows[0]).toMatchObject({ price: 1000, size: 5, unit: 'l' });
    expect(listsFromJSON('{"lists":[{"name":"x","rows":[]},{"name":"y","rows":[]}]}')).toHaveLength(2);
  });
  it('rejects junk', () => {
    expect(() => listsFromJSON('not json')).toThrow();
    expect(() => listsFromJSON('42')).toThrow();
  });
  it('sanitizes bad values', () => {
    expect(sanitizeProduct({ price: 'abc', unit: 'furlong', packs: '', name: 5 })).toMatchObject({ price: null, unit: 'ml', packs: null, name: '' });
  });
});

describe('csv', () => {
  it('round-trips including commas, quotes, newlines and Japanese', () => {
    const l = list();
    l.rows[0].name = 'He said "hi", ok\nline2 洗剤';
    l.rows[1].note = '=SUM(A1)';
    const back = listFromCSV(listToCSV(l));
    expect(back.rows[0].name).toBe(l.rows[0].name);
    expect(back.rows[1].note).toBe('=SUM(A1)');
    expect(back.rows).toHaveLength(4);
    expect(back.rows[2]).toMatchObject({ price: 698, uses: 5, size: 900, points: null });
  });
  it('guards against formula injection on export', () => {
    expect(listToCSV(list()).includes("'=SUM")).toBe(false);
    const l = list(); l.rows[0].name = '=1+1';
    expect(listToCSV(l)).toContain("'=1+1");
  });
  it('handles BOM, CRLF, blank lines, ragged rows', () => {
    expect(parseCSVRecords('﻿a,b\r\n1,2\r\n\r\n3')).toEqual([['a', 'b'], ['1', '2'], ['3']]);
  });
  it('rejects non-price CSV', () => {
    expect(() => listFromCSV('foo,bar\n1,2')).toThrow();
    expect(() => listFromCSV('')).toThrow();
  });
});

describe('state', () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
  it('saves and loads, keeping ids', () => {
    const s = mem(); const st = defaultState('ja');
    st.lists[0].rows.push({ id: 'keep', ...SAMPLE_ROWS[0] });
    saveState(s, st);
    const back = loadState(s);
    expect(back.lang).toBe('ja');
    expect(back.lists[0].rows[0].id).toBe('keep');
    expect(back.activeId).toBe(st.activeId);
  });
  it('survives corrupt or missing storage', () => {
    const s = mem(); s.setItem(STORAGE_KEY, '{oops');
    expect(loadState(s).lists).toHaveLength(1);
    expect(loadState(null, 'ja-JP').lang).toBe('ja');
    expect(() => saveState({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, defaultState())).not.toThrow();
  });
});

describe('i18n', () => {
  it('has identical keys and no empty strings', () => {
    expect(Object.keys(DICT.ja).sort()).toEqual(Object.keys(DICT.en).sort());
    for (const l of ['en', 'ja'] as const) for (const v of Object.values(DICT[l])) expect(v).not.toBe('');
  });
  it('keeps placeholders consistent', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of Object.keys(DICT.en) as (keyof typeof DICT.en)[]) expect(ph(DICT.ja[k])).toBe(ph(DICT.en[k]));
  });
});

describe('format', () => {
  it('never rounds small unit prices to zero', () => {
    expect(fmtSmall(0.0412, 'JPY')).toBe('¥0.0412');
    expect(fmtSmall(0.6037, 'JPY')).toBe('¥0.604');
    expect(fmtSmall(60.37, 'USD')).toBe('$60.4');
  });
  it('money', () => {
    expect(fmtMoney(2862, 'JPY')).toBe('¥2,862');
    expect(fmtMoney(12.9, 'USD')).toBe('$12.90');
    expect(fmtMoney(NaN, 'USD')).toBe('—');
  });
});

describe('bookmarklet', () => {
  it('builds a javascript: url containing the tool address', () => {
    const u = buildBookmarklet('https://example.com/app/');
    expect(u.startsWith('javascript:')).toBe(true);
    expect(decodeURIComponent(u)).toContain('https://example.com/app/#bm=');
  });
  it('reads and validates the hash', () => {
    const h = '#bm=' + encodeURIComponent(JSON.stringify([{ t: '洗剤 500ml', p: '￥650' }, { bad: 1 }]));
    expect(readBookmarkletHash(h)).toEqual([{ t: '洗剤 500ml', p: '￥650', u: '' }]);
    expect(readBookmarkletHash('#bm=%E0%A4%A')).toBeNull();
    expect(readBookmarkletHash('')).toBeNull();
    expect(itemsToPasteText([{ t: 'a', p: 'b' }, { t: 'c', p: 'd' }])).toBe('a\nb\n\nc\nd');
  });
});

describe('links', () => {
  it('only keeps http(s) urls', async () => {
    const { sanitizeUrl } = await import('../src/core/io');
    expect(sanitizeUrl('https://www.amazon.co.jp/dp/B0ABCDEFGH')).toBe('https://www.amazon.co.jp/dp/B0ABCDEFGH');
    expect(sanitizeUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeUrl('data:text/html,x')).toBe('');
    expect(sanitizeUrl(42)).toBe('');
    expect(sanitizeProduct({ url: 'ftp://x' }).url).toBe('');
  });
  it('bookmarklet items keep a valid link and drop a bad one', () => {
    const h = '#bm=' + encodeURIComponent(JSON.stringify([{ t: 'a', p: '¥1', u: 'https://www.amazon.co.jp/dp/B0ABCDEFGH' }, { t: 'b', p: '¥2', u: 'javascript:x' }]));
    expect(readBookmarkletHash(h)!.map((i) => i.u)).toEqual(['https://www.amazon.co.jp/dp/B0ABCDEFGH', '']);
  });
});

describe('color tag', () => {
  it('keeps known colors, drops anything else', () => {
    expect(sanitizeProduct({ color: 'blue' }).color).toBe('blue');
    expect(sanitizeProduct({ color: 'red; background:url(x)' }).color).toBe('');
    expect(sanitizeProduct({}).color).toBe('');
  });
});
