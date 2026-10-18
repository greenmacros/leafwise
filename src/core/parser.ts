import type { Unit } from './types';
import { dimensionOf, normalizeUnit } from './units';

export type ParseWarning = 'noPrice' | 'noSize' | 'multiplePrices' | 'multipleSizes' | 'listPriceIgnored';

export interface ParsedProduct {
  name: string;
  price: number | null;
  packs: number;
  size: number | null;
  unit: Unit;
  points: number;
  coupon: number;
  shipping: number;
  uses: number | null;
  warnings: ParseWarning[];
}

/* ---------- text normalisation ---------- */

/** NFKC folds full-width digits/letters/punctuation (０１２, ｍＬ, （）, ￥, ×→×) to plain forms. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[​-\u200F\u202A-\u202E﻿]/g, '')
    .replace(/[ \t ]+/g, ' ');
}

export function parseNumber(s: string): number {
  // "1,000" and "1,000.5" are thousands separators; "1,5" is a decimal comma
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ''));
  return Number(s.replace(',', '.'));
}

/* ---------- prices ---------- */

type PriceKind = 'current' | 'list' | 'unit';
interface PriceTok { value: number; kind: PriceKind; start: number; end: number }

const PRICE_RE = /(?:¥|\$|JPY ?|USD ?)\s*(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*円/gi;
const LIST_MARKER_RE =
  /(?:メーカー希望小売価格|希望小売価格|参考価格|通常価格|定価|list price|typical price|regular price|original price|\bwas\b|\blist\b|\brrp\b|\bmsrp\b)(?:\s*\([^)]*\))?\s*:?\s*$/i;
const UNIT_SUFFIX_RE = /^\s*(?:\/|per\s|あたり)\s*[\d.,]*\s*[^\s(),]*/i;

function findPrices(line: string): PriceTok[] {
  const out: PriceTok[] = [];
  for (const m of line.matchAll(PRICE_RE)) {
    const raw = (m[1] ?? m[2]).replace(/,+$/, '');
    const value = parseNumber(raw);
    if (!Number.isFinite(value)) continue;
    let start = m.index as number;
    let end = start + m[0].length;
    const after = line.slice(end);
    const suffix = UNIT_SUFFIX_RE.exec(after);
    if (suffix) {
      out.push({ value, kind: 'unit', start, end: end + suffix[0].length });
      continue;
    }
    const marker = LIST_MARKER_RE.exec(line.slice(0, start));
    if (marker) {
      start = marker.index;
      out.push({ value, kind: 'list', start, end });
    } else {
      out.push({ value, kind: 'current', start, end });
    }
  }
  return out;
}

function stripRanges(line: string, toks: PriceTok[]): string {
  let out = '';
  let pos = 0;
  for (const t of [...toks].sort((a, b) => a.start - b.start)) {
    out += line.slice(pos, t.start);
    pos = Math.max(pos, t.end);
  }
  out += line.slice(pos);
  return out.replace(/\(\s*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

/* ---------- quantity (size / packs / uses) ---------- */

const U =
  'ミリリットル|ml|cc|リットル|litres?|liters?|ltr|l|kg|キログラム|キロ|グラム|g|メートル|m|シート|sheets?|枚|ロール|個|本|袋|巻|錠|粒|pcs?|pieces?|count|ct|コ';
// "x" is allowed to follow a unit directly: "540mlx2"
const UNIT_END = '(?![a-wy-zA-WY-Z])';
const NUM = '(\\d+(?:[.,]\\d+)?)';
const MULT = '[x×*✕]';

interface SizeTok { value: number; unit: Unit; start: number; end: number; countish: boolean }

function findSizeTokens(text: string): SizeTok[] {
  const re = new RegExp(`(?<![\\d.,])${NUM}\\s*(${U})${UNIT_END}`, 'gi');
  const out: SizeTok[] = [];
  for (const m of text.matchAll(re)) {
    const unit = normalizeUnit(m[2]);
    if (!unit) continue;
    out.push({
      value: parseNumber(m[1]),
      unit,
      start: m.index as number,
      end: (m.index as number) + m[0].length,
      countish: dimensionOf(unit) === 'count',
    });
  }
  return out;
}

const SMALL_INT = '(\\d{1,3})';

function findPacks(text: string, afterIdx: number | null, usedCountTok: SizeTok[]): number | null {
  const tryRe = (re: RegExp, src: string): number | null => {
    const m = re.exec(src);
    const n = m ? Number(m.slice(1).find((g) => g !== undefined)) : NaN;
    return Number.isInteger(n) && n >= 1 && n <= 999 ? n : null;
  };
  // directly after the size: "540ml (x 2)", "540ml x2", "540ml (2個)", "540 ml (Pack of 2)"
  if (afterIdx !== null) {
    const after = text.slice(afterIdx);
    const hit = tryRe(
      new RegExp(
        `^\\s*(?:\\(\\s*)?(?:${MULT}\\s*${SMALL_INT}(?![\\d.]*\\s*(?:${U}))|${SMALL_INT}\\s*(?:個|本|袋|パック|セット|コ|packs?|pcs?|count|ct)(?![a-z])|pack\\s*of\\s*${SMALL_INT})`,
        'i',
      ),
      after,
    );
    if (hit) return hit;
  }
  const patterns = [
    new RegExp(`pack\\s*of\\s*${SMALL_INT}`, 'i'),
    new RegExp(`set\\s*of\\s*${SMALL_INT}`, 'i'),
    new RegExp(`${SMALL_INT}\\s*-?\\s*packs?(?![a-z])`, 'i'),
    new RegExp(`${SMALL_INT}\\s*(?:個|本|袋|箱|パック|コ)\\s*(?:セット|パック|組)`),
    new RegExp(`${SMALL_INT}\\s*(?:セット|組|パック)`),
    new RegExp(`(?:^|[^\\d.,])${MULT}\\s*${SMALL_INT}(?![\\d.]*\\s*(?:${U}))`, 'i'),
  ];
  for (const re of patterns) {
    const hit = tryRe(re, text);
    if (hit) return hit;
  }
  // a leftover "2個" next to a real size means two packs
  for (const t of usedCountTok) {
    if (Number.isInteger(t.value) && t.value >= 1 && t.value <= 999) return t.value;
  }
  return null;
}

const USES_RE = /(\d+)\s*(?:回分|回使用|回洗濯|uses?(?![a-z])|loads?(?![a-z])|washes(?![a-z])|servings?(?![a-z])|applications?(?![a-z]))/i;

interface Quantity { size: number | null; unit: Unit; packs: number; uses: number | null; multipleSizes: boolean }

export function extractQuantity(text: string): Quantity {
  let packs: number | null = null;
  let size: number | null = null;
  let unit: Unit = 'ml';
  let multipleSizes = false;

  const usesM = USES_RE.exec(text);
  const uses = usesM ? Number(usesM[1]) : null;

  // "2 x 540ml"
  const combined = new RegExp(`(?<![\\d.,])${SMALL_INT}\\s*${MULT}\\s*${NUM}\\s*(${U})${UNIT_END}`, 'i').exec(text);
  const cu = combined ? normalizeUnit(combined[3]) : null;
  if (combined && cu && Number(combined[1]) >= 1) {
    return { size: parseNumber(combined[2]), unit: cu, packs: Number(combined[1]), uses, multipleSizes: false };
  }

  const tokens = findSizeTokens(text);
  // "2個セット" / "6パック": a count followed by set/pack words is a multiplier, not a size
  const isSetLike = (t: SizeTok) => /^\s*(?:セット|パック|組|-?packs?\b)/i.test(text.slice(t.end));
  const measured = tokens.filter((t) => !t.countish);
  const counts = tokens.filter((t) => t.countish && !isSetLike(t));

  if (measured.length) {
    const primary = measured[0];
    size = primary.value;
    unit = primary.unit;
    multipleSizes = measured.some((t) => t.unit !== primary.unit || t.value !== primary.value);
    packs = findPacks(text, primary.end, counts);
  } else if (counts.length) {
    const primary = counts[0];
    size = primary.value;
    unit = primary.unit;
    packs = findPacks(text, primary.end, []);
  } else {
    packs = findPacks(text, null, []);
    if (packs !== null) {
      size = 1; // "pack of 8" with no size: compare per item
      unit = 'count';
    }
  }
  return { size, unit, packs: packs ?? 1, uses, multipleSizes };
}

/* ---------- line classification ---------- */

const SPONSOR_RE = /スポンサー(?:\s*広告)?|sponsored(?: ad)?|^広告$/gi;
const SHIPPING_RE = /送料|配送料|shipping(?: fee| cost)?|delivery fee/i;
const COUPON_RE = /クーポン|coupon/i;
const POINTS_RE = /(\d[\d,]*)\s*(?:ポイント|pts?(?![a-z])|points?(?![a-z]))/i;
const NUMERIC_ONLY_RE = /^[\d.,\s()kK万+%-]+$/;
const NOISE_RES: RegExp[] = [
  /5つ星|out of 5 stars|つ星|★|☆|ratings?(?![a-z])|reviews?(?![a-z])|件の評価|レビュー|評価/i,
  /残り\s*\d+\s*点|only \d+ left|left in stock|在庫|in stock|out of stock|残りわずか|入荷/i,
  /購入されました|bought in past|過去\d+|past month/i,
  /^-?\d+%\s*(?:off|オフ)?$|税込|%\s*(?:off|オフ)|割引/i,
  /カートに入れる|add to cart|オプション|\boptions?\b|ベストセラー|best seller|amazon'?s choice|amazonのおすすめ|おすすめ|タイムセール|limited time|\bdeals?\b|セール|定期おトク便|subscribe/i,
];
// delivery chatter: only short lines, so real titles that mention "送料無料" survive
const DELIVERY_RE =
  /お届け|配送|発送|arrives?(?![a-z])|delivery|get it|ships? (?:from|by)|prime|プライム|最短|明日|本日|today|tomorrow|無料|free(?![a-z])|\d+月\d+日|(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,? [a-z]+ \d+/i;

type Line =
  | { kind: 'blank' }
  | { kind: 'noise' }
  | { kind: 'points'; value: number }
  | { kind: 'coupon'; value: number; pct: number }
  | { kind: 'shipping'; value: number }
  | { kind: 'content'; text: string; current: PriceTok[]; hasList: boolean };

function classify(raw: string): Line {
  const line = raw.replace(SPONSOR_RE, ' ').replace(/\s+/g, ' ').trim();
  if (!line) return { kind: 'blank' };
  const prices = findPrices(line);
  const hasSize = findSizeTokens(line).some((t) => !t.countish);
  const current = prices.filter((p) => p.kind === 'current');

  if (SHIPPING_RE.test(line) && current.length && !hasSize) return { kind: 'shipping', value: current[0].value };
  if (COUPON_RE.test(line) && !hasSize) {
    const pct = /(\d+(?:\.\d+)?)\s*%/.exec(line);
    if (pct && !current.length) return { kind: 'coupon', value: 0, pct: Number(pct[1]) };
    if (current.length) return { kind: 'coupon', value: current[0].value, pct: 0 };
    return { kind: 'noise' };
  }
  if (!hasSize && !current.length) {
    const pt = POINTS_RE.exec(line);
    if (pt && line.length <= 40) return { kind: 'points', value: parseNumber(pt[1]) };
  }
  if (!hasSize && NUMERIC_ONLY_RE.test(line)) return { kind: 'noise' };
  if (!hasSize && !current.length) {
    if (NOISE_RES.some((re) => re.test(line))) return { kind: 'noise' };
    if (line.length <= 60 && DELIVERY_RE.test(line)) return { kind: 'noise' };
  }
  const text = stripRanges(line, prices);
  return { kind: 'content', text, current, hasList: prices.some((p) => p.kind === 'list') };
}

/* ---------- segmentation ---------- */

interface Block {
  text: string[];
  prices: number[];
  listIgnored: boolean;
  points: number;
  coupon: number;
  couponPct: number;
  shipping: number;
}
const newBlock = (inheritText: string[] = []): Block => ({
  text: [...inheritText], prices: [], listIgnored: false, points: 0, coupon: 0, couponPct: 0, shipping: 0,
});

// leftover text that is only punctuation / tax words is not a title or variant line
const meaningful = (s: string) => s.replace(/[\s()[\]\-–:：・,.+|/]/g, '').length >= 2;

function cleanName(lines: string[]): string {
  const candidates = lines.filter(meaningful);
  const pick = candidates.reduce((best, l) => (l.length > best.length ? l : best), '');
  return pick.replace(/^[\s\-–:：・|]+|[\s\-–:：・|]+$/g, '').slice(0, 160);
}

function toProduct(b: Block): ParsedProduct {
  const q = extractQuantity(b.text.join('\n'));
  const price = b.prices.length ? b.prices[0] : null;
  const warnings: ParseWarning[] = [];
  if (price === null) warnings.push('noPrice');
  if (q.size === null) warnings.push('noSize');
  if (b.prices.length > 1) warnings.push('multiplePrices');
  if (q.multipleSizes) warnings.push('multipleSizes');
  if (b.listIgnored) warnings.push('listPriceIgnored');
  const pctCoupon = price !== null && b.couponPct > 0 ? Math.round((price * b.couponPct) / 100) : 0;
  return {
    name: cleanName(b.text),
    price,
    packs: q.packs,
    size: q.size,
    unit: q.unit,
    points: b.points,
    coupon: b.coupon + pctCoupon,
    shipping: b.shipping,
    uses: q.uses,
    warnings,
  };
}

/**
 * Split pasted listing text into products.
 * A product ends at its (current) price line; the next title-like line starts a new one.
 * Blank lines after a price also end a product. Noise lines are dropped.
 */
export function parseListings(input: string): ParsedProduct[] {
  const lines = normalizeText(input).split('\n').map(classify);
  const done: Block[] = [];
  let cur = newBlock();
  const hasPrice = (b: Block) => b.prices.length > 0;
  const flush = (inherit = false) => {
    if (hasPrice(cur)) done.push(cur);
    cur = newBlock(inherit ? cur.text : []);
  };

  for (const l of lines) {
    switch (l.kind) {
      case 'blank':
        if (hasPrice(cur)) flush();
        break;
      case 'noise':
        break;
      case 'points':
      case 'coupon':
      case 'shipping': {
        // these trail their product's price; if the block was already closed they belong to the last one
        const target = hasPrice(cur) || cur.text.length || !done.length ? cur : done[done.length - 1];
        if (l.kind === 'points') target.points += l.value;
        else if (l.kind === 'coupon') {
          target.coupon += l.value;
          target.couponPct += l.pct;
        } else target.shipping += l.value;
        break;
      }
      case 'content': {
        const hasText = meaningful(l.text);
        if (l.hasList && !l.current.length) cur.listIgnored = true;
        if (!l.current.length) {
          if (!hasText) break;
          if (hasPrice(cur)) flush();
          cur.text.push(l.text);
        } else if (hasText) {
          if (hasPrice(cur)) flush();
          cur.text.push(l.text);
          cur.prices.push(...l.current.map((p) => p.value));
          if (l.hasList) cur.listIgnored = true;
        } else {
          // a bare price line
          if (hasPrice(cur)) flush(true);
          cur.prices.push(...l.current.map((p) => p.value));
          if (l.hasList) cur.listIgnored = true;
        }
      }
    }
  }
  if (hasPrice(cur)) done.push(cur);
  else if (!done.length && cur.text.length) done.push(cur); // title only: still show something to edit

  return done.map(toProduct);
}
