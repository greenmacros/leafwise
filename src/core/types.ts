export const PRODUCT_COLORS = ['red', 'orange', 'yellow', 'blue', 'purple', 'pink', 'gray'] as const;
export type Unit = 'ml' | 'l' | 'g' | 'kg' | 'count' | 'sheets' | 'm';
export type Dimension = 'volume' | 'mass' | 'count' | 'sheets' | 'length';
export type Lang = 'en' | 'ja';
export type Currency = 'JPY' | 'USD';
export type RankBy = 'unit' | 'use';

/** One listing. null = "left empty". */
export interface Product {
  id: string;
  name: string;
  price: number | null;
  packs: number | null; // null is treated as 1
  size: number | null; // size of ONE pack, in `unit`
  unit: Unit;
  points: number | null;
  coupon: number | null;
  shipping: number | null;
  uses: number | null; // uses per pack (concentrates)
  note: string;
  color: string; // '' or one of PRODUCT_COLORS
  store: string; // optional, e.g. "Amazon", "Seiyu"
  url: string; // optional link to the listing (http/https only)
}

export interface ProductList {
  id: string;
  name: string;
  rows: Product[];
  rankBy: RankBy;
}

export interface AppState {
  version: 1;
  lists: ProductList[];
  activeId: string;
  lang: Lang;
  currency: Currency;
  /** headline unit price basis for volume/mass: per 1 ml/g or per 100 */
  basis: 1 | 100;
}
