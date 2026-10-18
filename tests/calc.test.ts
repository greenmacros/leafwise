import { describe, expect, it } from 'vitest';
import { analyze, breakEven, breakEvenPairs, computeRow } from '../src/core/calc';
import { normalizeUnit, toBase } from '../src/core/units';
import type { Product } from '../src/core/types';

const p = (o: Partial<Product> = {}): Product => ({
  id: 'a', name: '', price: 1000, packs: 1, size: 1000, unit: 'ml',
  points: null, coupon: null, shipping: null, uses: null, note: '', store: '', color: '', url: '', ...o,
});

describe('units', () => {
  it('converts to base', () => {
    expect(toBase(1.5, 'l')).toBe(1500);
    expect(toBase(2, 'kg')).toBe(2000);
    expect(toBase(3, 'sheets')).toBe(3);
  });
  it('normalizes aliases', () => {
    expect(normalizeUnit('mL')).toBe('ml');
    expect(normalizeUnit('リットル')).toBe('l');
    expect(normalizeUnit('枚')).toBe('sheets');
    expect(normalizeUnit('xyz')).toBeNull();
  });
});

describe('computeRow', () => {
  it('multipack unit price', () => {
    const r = computeRow(p({ price: 652, packs: 2, size: 540 }));
    expect(r.totalAmount).toBe(1080);
    expect(r.unitPrice).toBeCloseTo(652 / 1080);
  });
  it('L equals ml', () => {
    expect(computeRow(p({ size: 1, unit: 'l' })).unitPrice).toBeCloseTo(computeRow(p()).unitPrice);
  });
  it('applies points, coupon, shipping', () => {
    const r = computeRow(p({ price: 1000, points: 100, coupon: 50, shipping: 200, size: 1 , unit: 'ml'}));
    expect(r.netPrice).toBe(1050);
  });
  it('discount larger than price clamps to 0 and flags, shipping still added', () => {
    const r = computeRow(p({ price: 100, points: 80, coupon: 80, shipping: 30 }));
    expect(r.netPrice).toBe(30);
    expect(r.issues).toContain('discountExceedsPrice');
    expect(r.valid).toBe(true);
  });
  it('empty packs = 1; zero packs invalid', () => {
    expect(computeRow(p({ packs: null })).valid).toBe(true);
    expect(computeRow(p({ packs: 0 })).issues).toContain('invalidPacks');
  });
  it('empty / zero price and size are invalid, never Infinity', () => {
    expect(computeRow(p({ price: null })).valid).toBe(false);
    expect(computeRow(p({ price: 0 })).valid).toBe(false);
    const r = computeRow(p({ size: 0 }));
    expect(r.valid).toBe(false);
    expect(Number.isFinite(r.unitPrice)).toBe(false);
  });
  it('ignores negative / NaN optional fields', () => {
    expect(computeRow(p({ points: -5, coupon: NaN, shipping: -1 })).netPrice).toBe(1000);
  });
  it('cost per use', () => {
    expect(computeRow(p({ price: 700, uses: 5 })).perUse).toBe(140);
    expect(computeRow(p({ price: 700, uses: 5, packs: 2 })).perUse).toBe(70);
    expect(computeRow(p({ uses: 0 })).perUse).toBeNull();
  });
});

describe('analyze', () => {
  const rows = [
    p({ id: 'a', price: 652, packs: 2, size: 540 }),
    p({ id: 'b', price: 2862, packs: 3, size: 1400 }),
    p({ id: 'c', price: 498, size: 1000 }),
  ];
  it('ranks and computes % vs best', () => {
    const a = analyze(rows, 'unit');
    expect(a.bestId).toBe('c');
    expect(a.rankedIds).toEqual(['c', 'a', 'b']);
    const byId = Object.fromEntries(a.rows.map((r) => [r.id, r]));
    expect(byId.c.isBest).toBe(true);
    expect(byId.c.pctMoreThanBest).toBe(0);
    expect(byId.a.pctMoreThanBest).toBeCloseTo(((652 / 1080) / 0.498 - 1) * 100);
  });
  it('refuses to compare ml with g', () => {
    const a = analyze([p({ id: 'x' }), p({ id: 'y', unit: 'g' })], 'unit');
    expect(a.comparable).toBe(false);
    expect(a.bestId).toBeNull();
    expect(a.rows.every((r) => r.rank === null)).toBe(true);
  });
  it('kg and g are comparable; count and sheets are not', () => {
    expect(analyze([p({ id: 'x', unit: 'g' }), p({ id: 'y', unit: 'kg', size: 1 })], 'unit').comparable).toBe(true);
    expect(analyze([p({ id: 'x', unit: 'count' }), p({ id: 'y', unit: 'sheets' })], 'unit').comparable).toBe(false);
  });
  it('invalid rows are skipped', () => {
    const a = analyze([p({ id: 'x', price: null }), p({ id: 'y' })], 'unit');
    expect(a.bestId).toBe('y');
    expect(a.rows[0].rank).toBeNull();
  });
  it('per-use ranking; rows without uses unranked; mixed units allowed', () => {
    const a = analyze([p({ id: 'c', price: 700, size: 900, uses: 5 }), p({ id: 'r' }), p({ id: 'g', unit: 'g', uses: 20 })], 'use');
    expect(a.comparable).toBe(true);
    expect(a.bestId).toBe('g'); // 50/use vs 140/use
    expect(a.rows.find((r) => r.id === 'r')!.rank).toBeNull();
  });
  it('empty list', () => {
    const a = analyze([], 'unit');
    expect(a.bestId).toBeNull();
    expect(a.comparable).toBe(true);
  });
  it('zero-cost best does not divide by zero', () => {
    const a = analyze([p({ id: 'z', price: 100, points: 100 }), p({ id: 'y' })], 'unit');
    expect(a.bestId).toBe('z');
    expect(a.rows.find((r) => r.id === 'y')!.pctMoreThanBest).toBeNull();
  });
});

describe('breakEven', () => {
  it('computes dose where both cost the same', () => {
    const conc = computeRow(p({ id: 'c', price: 700, size: 900, uses: 5 })); // 140/use
    const reg = computeRow(p({ id: 'r', price: 500, size: 1000 })); // 0.5/ml
    expect(breakEven(conc, reg)!.dose).toBeCloseTo(280);
  });
  it('null across dimensions or when uses unknown', () => {
    const conc = computeRow(p({ uses: 5 }));
    expect(breakEven(conc, computeRow(p({ unit: 'g' })))).toBeNull();
    expect(breakEven(computeRow(p()), computeRow(p()))).toBeNull();
  });
  it('pairs concentrates with regulars', () => {
    expect(breakEvenPairs([p({ id: 'c', uses: 5 }), p({ id: 'r' })])).toHaveLength(1);
  });
});
