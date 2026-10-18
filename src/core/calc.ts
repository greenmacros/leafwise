import type { Dimension, Product, RankBy, Unit } from './types';
import { baseUnitOf, dimensionOf, toBase } from './units';

export type Issue = 'missingPrice' | 'missingSize' | 'invalidPacks' | 'discountExceedsPrice';

export interface RowResult {
  id: string;
  valid: boolean;
  issues: Issue[];
  dimension: Dimension;
  baseUnit: Unit;
  /** packs × size in base units (0 when invalid) */
  totalAmount: number;
  /** what you really pay: max(0, price − points − coupon) + shipping */
  netPrice: number;
  /** net price per base unit (ml, g, …); NaN when invalid */
  unitPrice: number;
  /** net price per use, null when uses is unknown */
  perUse: number | null;
}

export interface RowAnalysis extends RowResult {
  /** 1-based; null when the row is not part of the ranking */
  rank: number | null;
  /** how much more than the best, in percent (0 for the best); null if undefined */
  pctMoreThanBest: number | null;
  isBest: boolean;
}

export interface Analysis {
  rows: RowAnalysis[]; // same order as input
  rankedIds: string[]; // best first
  bestId: string | null;
  /** distinct dimensions among valid rows */
  dimensions: Dimension[];
  /** false when the chosen ranking would mix incomparable unit types */
  comparable: boolean;
}

/** Non-finite / negative / empty → 0. For optional money fields. */
const money = (v: number | null | undefined): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;

const positive = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;

export function computeRow(p: Product): RowResult {
  const issues: Issue[] = [];
  const dimension = dimensionOf(p.unit);
  const baseUnit = baseUnitOf(p.unit);

  if (!positive(p.price)) issues.push('missingPrice');
  if (!positive(p.size)) issues.push('missingSize');
  // empty packs means "1"; zero or negative is a mistake
  const packs = p.packs === null || p.packs === undefined ? 1 : p.packs;
  if (!positive(packs)) issues.push('invalidPacks');

  const discount = money(p.points) + money(p.coupon);
  const price = money(p.price);
  if (price > 0 && discount > price) issues.push('discountExceedsPrice');
  const netPrice = Math.max(0, price - discount) + money(p.shipping);

  const blocking = issues.some((i) => i !== 'discountExceedsPrice');
  if (blocking) {
    return { id: p.id, valid: false, issues, dimension, baseUnit, totalAmount: 0, netPrice, unitPrice: NaN, perUse: null };
  }

  const totalAmount = packs * toBase(p.size as number, p.unit);
  const unitPrice = netPrice / totalAmount;
  const totalUses = positive(p.uses) ? p.uses * packs : null;
  const perUse = totalUses ? netPrice / totalUses : null;
  return { id: p.id, valid: true, issues, dimension, baseUnit, totalAmount, netPrice, unitPrice, perUse };
}

const EPS = 1e-9;

export function analyze(products: Product[], rankBy: RankBy): Analysis {
  const results = products.map(computeRow);
  const valid = results.filter((r) => r.valid);
  const dimensions = [...new Set(valid.map((r) => r.dimension))];

  // Cost per use does not depend on the unit type, so it can be compared across types.
  // Unit price cannot: ml vs g is meaningless.
  const comparable = rankBy === 'use' || dimensions.length <= 1;

  const metric = (r: RowResult): number | null => {
    if (!r.valid) return null;
    return rankBy === 'use' ? r.perUse : r.unitPrice;
  };

  const ranked = comparable
    ? results
        .filter((r) => metric(r) !== null)
        .sort((a, b) => (metric(a) as number) - (metric(b) as number))
    : [];
  const bestVal = ranked.length ? (metric(ranked[0]) as number) : null;

  const rows: RowAnalysis[] = results.map((r) => {
    const idx = ranked.findIndex((x) => x.id === r.id);
    const m = metric(r);
    let pct: number | null = null;
    if (idx >= 0 && bestVal !== null && bestVal > 0 && m !== null) pct = (m / bestVal - 1) * 100;
    if (idx >= 0 && bestVal === 0) pct = m === 0 ? 0 : null;
    return {
      ...r,
      rank: idx >= 0 ? idx + 1 : null,
      pctMoreThanBest: pct !== null && Math.abs(pct) < EPS ? 0 : pct,
      isBest: idx >= 0 && bestVal !== null && m !== null && Math.abs(m - bestVal) <= EPS * Math.max(1, bestVal),
    };
  });

  return {
    rows,
    rankedIds: ranked.map((r) => r.id),
    bestId: ranked.length ? ranked[0].id : null,
    dimensions,
    comparable,
  };
}

export interface BreakEven {
  concentrateId: string;
  regularId: string;
  /** amount of regular product per use (base unit) at which both cost the same */
  dose: number;
  baseUnit: Unit;
}

/**
 * Break-even: concentrate costs C per use, regular costs u per base unit.
 * Using `dose` of the regular product per use costs u·dose, so the regular one is
 * cheaper only while dose < C / u. Returns null if the pair can't be compared.
 */
export function breakEven(concentrate: RowResult, regular: RowResult): BreakEven | null {
  if (!concentrate.valid || !regular.valid) return null;
  if (concentrate.dimension !== regular.dimension) return null;
  if (concentrate.perUse === null || concentrate.perUse <= 0) return null;
  if (!(regular.unitPrice > 0)) return null;
  return {
    concentrateId: concentrate.id,
    regularId: regular.id,
    dose: concentrate.perUse / regular.unitPrice,
    baseUnit: regular.baseUnit,
  };
}

/** Pairs every concentrate (uses known) with every regular row (uses unknown) of the same dimension. */
export function breakEvenPairs(products: Product[]): BreakEven[] {
  const results = products.map(computeRow);
  const conc = results.filter((r) => r.valid && r.perUse !== null);
  const reg = results.filter((r) => r.valid && r.perUse === null);
  const out: BreakEven[] = [];
  for (const c of conc) for (const r of reg) {
    const b = breakEven(c, r);
    if (b) out.push(b);
  }
  return out;
}
