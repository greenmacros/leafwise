import type { Currency, Dimension, Lang, Unit } from './types';

const symbol = (c: Currency) => (c === 'JPY' ? '¥' : '$');

/** Whole-price formatting: ¥1,234 / $12.99 */
export function fmtMoney(v: number, c: Currency): string {
  if (!Number.isFinite(v)) return '—';
  const digits = c === 'JPY' ? (Number.isInteger(v) ? 0 : 1) : 2;
  return symbol(c) + v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Per-unit prices are small, so show enough decimals that ¥0.04/ml never rounds to ¥0. */
export function fmtSmall(v: number, c: Currency): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : abs >= 0.1 ? 3 : 4;
  return symbol(c) + v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtPct(v: number): string {
  return (v >= 0 ? '+' : '') + v.toFixed(v >= 100 ? 0 : 1) + '%';
}

export function fmtAmount(v: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

const BASE_LABEL: Record<Lang, Record<Unit, string>> = {
  en: { ml: 'ml', l: 'L', g: 'g', kg: 'kg', count: 'item', sheets: 'sheet', m: 'm' },
  ja: { ml: 'ml', l: 'L', g: 'g', kg: 'kg', count: '個', sheets: '枚', m: 'm' },
};
export const unitLabel = (u: Unit, lang: Lang) => BASE_LABEL[lang][u];

/** Volume and mass also get a "per 100" figure because per-ml numbers are hard to eyeball. */
export function per100Factor(d: Dimension): number | null {
  return d === 'volume' || d === 'mass' ? 100 : null;
}
