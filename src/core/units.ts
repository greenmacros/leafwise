import type { Dimension, Unit } from './types';

export const UNIT_LIST: Unit[] = ['ml', 'l', 'g', 'kg', 'count', 'sheets', 'm'];

interface UnitInfo {
  dimension: Dimension;
  /** multiply by this to reach the base unit of the dimension */
  factor: number;
  base: Unit;
}

export const UNITS: Record<Unit, UnitInfo> = {
  ml: { dimension: 'volume', factor: 1, base: 'ml' },
  l: { dimension: 'volume', factor: 1000, base: 'ml' },
  g: { dimension: 'mass', factor: 1, base: 'g' },
  kg: { dimension: 'mass', factor: 1000, base: 'g' },
  count: { dimension: 'count', factor: 1, base: 'count' },
  sheets: { dimension: 'sheets', factor: 1, base: 'sheets' },
  m: { dimension: 'length', factor: 1, base: 'm' },
};

export const dimensionOf = (u: Unit): Dimension => UNITS[u].dimension;
export const baseUnitOf = (u: Unit): Unit => UNITS[u].base;
export const toBase = (size: number, u: Unit): number => size * UNITS[u].factor;

const ALIASES: Record<string, Unit> = {
  ml: 'ml', cc: 'ml', ミリリットル: 'ml',
  l: 'l', ltr: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l', リットル: 'l',
  g: 'g', グラム: 'g',
  kg: 'kg', キロ: 'kg', キログラム: 'kg',
  m: 'm', メートル: 'm',
  sheet: 'sheets', sheets: 'sheets', 枚: 'sheets', シート: 'sheets',
  count: 'count', ct: 'count', pc: 'count', pcs: 'count', piece: 'count', pieces: 'count',
  個: 'count', 本: 'count', 袋: 'count', 巻: 'count', ロール: 'count', 錠: 'count', 粒: 'count', コ: 'count',
  item: 'count', items: 'count',
};

/** Map free text ("mL", "リットル", "pcs") to a Unit, or null if unknown. */
export function normalizeUnit(raw: string): Unit | null {
  const key = raw.normalize('NFKC').trim().toLowerCase();
  return ALIASES[key] ?? null;
}
