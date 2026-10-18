import { describe, expect, it } from 'vitest';
import { extractQuantity, parseListings } from '../src/core/parser';
import { SAMPLE_PASTE } from '../src/core/sample';

describe('extractQuantity', () => {
  it.each([
    ['540ml (x 2)', 540, 'ml', 2],
    ['540ml (×2)', 540, 'ml', 2],
    ['１４００ｍＬ ｘ ３', 1400, 'ml', 3],
    ['1400mL x 3', 1400, 'ml', 3],
    ['1400mLx3', 1400, 'ml', 3],
    ['2 x 540ml', 540, 'ml', 2],
    ['1.5L', 1.5, 'l', 1],
    ['1,000ml', 1000, 'ml', 1],
    ['洗剤 540ml 2個セット', 540, 'ml', 2],
    ['洗剤 540ml 3本セット', 540, 'ml', 3],
    ['540 ml (Pack of 2)', 540, 'ml', 2],
    ['500g, pack of 4', 500, 'g', 4],
    ['500g 6-pack', 500, 'g', 6],
    ['1kg', 1, 'kg', 1],
    ['ティッシュ 200枚 x 5', 200, 'sheets', 5],
    ['トイレットペーパー 12ロール 4パック', 12, 'count', 4],
    ['8個入り', 8, 'count', 1],
    ['pack of 8', 1, 'count', 8],
    ['2個セット', 1, 'count', 2],
  ])('%s', (text, size, unit, packs) => {
    const q = extractQuantity(text.normalize('NFKC'));
    expect([q.size, q.unit, q.packs]).toEqual([size, unit, packs]);
  });
  it('extracts uses', () => {
    expect(extractQuantity('900mL 約5回分').uses).toBe(5);
    expect(extractQuantity('900mL 40 loads').uses).toBe(40);
  });
  it('no quantity info', () => {
    expect(extractQuantity('洗剤').size).toBeNull();
  });
  it('does not mistake mm/cm for m', () => {
    expect(extractQuantity('30mm 5cm').size).toBeNull();
  });
  it('flags multiple different sizes', () => {
    const q = extractQuantity('本体 400ml 詰替 540ml');
    expect(q.size).toBe(400);
    expect(q.multipleSizes).toBe(true);
  });
});

describe('parseListings', () => {
  it('single JP line', () => {
    const [a] = parseListings('サラヤ ヤシノミ洗剤 詰替 540ml (x 2) ¥652');
    expect(a).toMatchObject({ price: 652, size: 540, unit: 'ml', packs: 2 });
    expect(a.name).toContain('ヤシノミ');
  });
  it('bare size line + price', () => {
    const [a] = parseListings('1400mL x 3 ¥2,862');
    expect(a).toMatchObject({ price: 2862, size: 1400, packs: 3 });
  });
  it('full-width yen, commas, 円', () => {
    expect(parseListings('洗剤 500ml ￥1,234')[0].price).toBe(1234);
    expect(parseListings('洗剤 500ml 1,234円')[0].price).toBe(1234);
  });
  it('English / dollars', () => {
    const [a] = parseListings('Dish soap refill 540 ml (Pack of 2)\n$12.99 ($0.01/ml)');
    expect(a).toMatchObject({ price: 12.99, size: 540, packs: 2 });
  });
  it('uses the current price, not the list price', () => {
    const [a] = parseListings('洗剤 500ml\n¥652 参考価格: ¥880');
    expect(a.price).toBe(652);
    expect(a.warnings).toContain('listPriceIgnored');
    expect(parseListings('洗剤 500ml\n参考価格: ¥880 ¥652')[0].price).toBe(652);
    expect(parseListings('Soap 500ml\nList Price: $20.00\n$15.00')[0].price).toBe(15);
  });
  it('ignores per-unit prices', () => {
    const [a] = parseListings('洗剤 500ml ¥650 (¥1.3/ml) (¥130/100mlあたり)');
    expect(a.price).toBe(650);
    expect(a.size).toBe(500);
  });
  it('drops noise lines', () => {
    const [a] = parseListings('スポンサー\n洗剤 500ml\n5つ星のうち4.3\n(1,234)\n¥650\n明日中にお届け\n残り4点\nOnly 3 left in stock\nFREE delivery Tue, Oct 21');
    expect(a).toMatchObject({ price: 650, size: 500 });
    expect(a.name).toBe('洗剤 500ml');
  });
  it('splits multiple products without blank lines', () => {
    const r = parseListings('洗剤A 500ml\n¥500\n洗剤B 1L\n¥800\n洗剤C 2L ¥1,500');
    expect(r.map((x) => x.price)).toEqual([500, 800, 1500]);
    expect(r.map((x) => x.unit)).toEqual(['ml', 'l', 'l']);
  });
  it('splits on blank lines', () => {
    expect(parseListings('洗剤A 500ml ¥500\n\n洗剤B 1L ¥800')).toHaveLength(2);
  });
  it('attaches points, coupon and shipping to the right product', () => {
    const r = parseListings('洗剤A 500ml\n¥500\n10ポイント\n¥50 OFF クーポン\n送料 ¥300\n洗剤B 1L\n¥800');
    expect(r[0]).toMatchObject({ points: 10, coupon: 50, shipping: 300 });
    expect(r[1]).toMatchObject({ points: 0, coupon: 0 });
  });
  it('percent coupon converts to yen', () => {
    expect(parseListings('洗剤 500ml\n¥1,000\n10%OFFクーポン')[0].coupon).toBe(100);
  });
  it('keeps titles that mention 送料無料', () => {
    const [a] = parseListings('洗剤 500ml 送料無料 ¥650');
    expect(a.size).toBe(500);
  });
  it('title only → one product with noPrice warning', () => {
    const r = parseListings('洗剤 500ml');
    expect(r).toHaveLength(1);
    expect(r[0].price).toBeNull();
    expect(r[0].warnings).toContain('noPrice');
  });
  it('empty / garbage input', () => {
    expect(parseListings('')).toEqual([]);
    expect(parseListings('   \n\n  ')).toEqual([]);
    expect(parseListings('スポンサー\n5つ星のうち4.3\n(1,234)')).toEqual([]);
  });
  it('parses the sample dataset', () => {
    const r = parseListings(SAMPLE_PASTE);
    expect(r.map((x) => x.price)).toEqual([652, 2862, 698, 498]);
    expect(r[0]).toMatchObject({ size: 540, packs: 2, points: 7 });
    expect(r[1]).toMatchObject({ size: 1400, packs: 3 });
    expect(r[2]).toMatchObject({ size: 900, uses: 5 });
    expect(r[3]).toMatchObject({ size: 1000, packs: 1 });
  });
});
