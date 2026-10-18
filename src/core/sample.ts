import type { Product } from './types';

/** Illustrative Amazon-style paste (prices are examples, not live data). */
export const SAMPLE_PASTE = `スポンサー
サラヤ ヤシノミ洗剤 詰替 540ml (x 2)
5つ星のうち4.3
(1,234)
¥652
(¥0.60/ml)
参考価格: ¥880
明日中にお届け
残り4点
7ポイント

サラヤ ヤシノミ洗剤 詰替用 1400mL x 3 ¥2,862
無料配送 10月21日

ヤシノミ洗剤 濃縮タイプ 詰替 900mL 約5回分
¥698
1000mL ヤシノミ洗剤 詰替 大容量 ¥498`;

export const SAMPLE_ROWS: Omit<Product, 'id'>[] = [
  { name: 'ヤシノミ洗剤 詰替 540mL ×2', price: 652, packs: 2, size: 540, unit: 'ml', points: 7, coupon: null, shipping: null, uses: null, note: '', store: '', color: '', url: '' },
  { name: 'ヤシノミ洗剤 詰替 1400mL ×3', price: 2862, packs: 3, size: 1400, unit: 'ml', points: null, coupon: null, shipping: null, uses: null, note: '', store: '', color: '', url: '' },
  { name: 'ヤシノミ洗剤 濃縮 900mL', price: 698, packs: 1, size: 900, unit: 'ml', points: null, coupon: null, shipping: null, uses: 5, note: '5 uses per pack (per label)', store: '', color: '', url: '' },
  { name: 'ヤシノミ洗剤 詰替 1000mL', price: 498, packs: 1, size: 1000, unit: 'ml', points: null, coupon: null, shipping: null, uses: null, note: '', store: '', color: '', url: '' },
];
