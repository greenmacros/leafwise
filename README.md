# LeafWise

A free, static, single-page tool that compares the **real** price per ml / g / sheet / item across
Amazon-style listings ("1000mL", "540mL x 2", "pack of 8"…). No backend, no accounts, no API keys.
Data lives in your browser's `localStorage`.

Why: Amazon's own per-unit figure is often rounded to ¥0/ml, uses the wrong unit, or counts a multipack as one item.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (price math, unit conversion, paste parser, import/export) + a UI smoke test
npm run build      # static site in dist/ — host anywhere (GitHub Pages, Netlify, an S3 bucket…)
```

## Using it

1. Tap **+ Add product** (bottom of the screen). Paste listing text and it is parsed live into editable fields,
   or tap *Enter manually*. Fix anything wrong, then *Add* (or *Add all*). Tap a row to edit it; ⚙ holds lists, language, currency, import/export.
2. Rows are **ranked automatically**. The cheapest gets a green border and ★; the others show
   "+x% vs best". The sticky banner at the top always shows the current best deal.
3. **Net price** = `max(0, price − points − coupon) + shipping`.
   **Unit price** = net price ÷ (packs × size), with L→ml and kg→g converted first.
   If points + coupon exceed the price the row is flagged and counted as free (shipping is still added).
4. **Concentrates:** fill in *Uses per pack*. Each row then shows a cost per use, and *Rank by → Cost per use*
   ranks by that instead. Rows without uses are left unranked in that mode.
   Cost per use is independent of the unit type, so it may compare ml and g rows; unit price may not.
5. **Mixed unit types** (ml vs g, count vs sheets…) in unit-price mode: a warning banner replaces the best deal
   and nothing is ranked.
6. **Break-even** (collapsible panel): for each concentrate × regular product of the same unit type, the amount of
   regular product per use at which both cost the same. Use less than that and the regular product is cheaper;
   enter your own typical dose to get a verdict.
7. **Lists:** create, rename and delete multiple named lists. **Export** JSON/CSV; **import** JSON or CSV
   (each import becomes a new list). CSV columns: `name,price,packs,size,unit,points,coupon,shipping,uses,note`.
8. EN/日本語 and ¥/$ toggles. The currency toggle only changes the symbol; nothing is converted.

## Paste parser

Handles, among others: `サラヤ ヤシノミ洗剤 詰替 540ml (x 2) ¥652`, `1400mL x 3 ¥2,862`, `2 x 540ml`, `pack of 8`,
`2個セット`, `(×3)`, `1.5L`, full-width digits/yen (`￥１，２３４`), `1,234円`, `$12.99`, `約5回分` / `40 loads` (uses),
`N ポイント`, `¥50 OFF クーポン` / `10%OFFクーポン`, `送料 ¥300`.

- Products are split at price lines (a product ends at its price) and at blank lines.
- Ignored: スポンサー/Sponsored, star ratings and review counts, delivery dates, `残り4点`, "Only 3 left", `参考価格`/List Price
  (the current price is used), and per-unit prices such as `(¥0.60/ml)`.
- It guesses; the editable preview exists because guesses can be wrong. Warnings (no price, no size, several sizes…) are shown per product.
- Known limits: a title that contains two different sizes ("本体 400ml 詰替 540ml") uses the first;
  two plain, un-labelled prices on one line use the first; units such as oz/lb are not supported.

## Sample data

"Load sample data" (shown on an empty list) loads these **illustrative** Yashinomi listings
(prices are examples, not live Amazon data):

| Listing | Price | Packs × size | Unit price |
|---|---|---|---|
| ヤシノミ洗剤 詰替 540ml (x 2), 7pt | ¥652 | 2 × 540 ml | ¥0.60/ml |
| ヤシノミ洗剤 詰替 1400mL x 3 | ¥2,862 | 3 × 1400 ml | ¥0.68/ml |
| ヤシノミ洗剤 濃縮 900mL, 約5回分 | ¥698 | 1 × 900 ml, 5 uses | ¥0.78/ml, ¥140/use |
| ヤシノミ洗剤 詰替 1000mL | ¥498 | 1 × 1000 ml | ¥0.50/ml |

Break-even for the concentrate vs the 1000 mL regular: 139.6 ÷ 0.498 ≈ **280 ml** of regular per use.

## Bookmarklet (optional, experimental)

`src/bookmarklet/amazon-search.js` reads titles and prices from an Amazon *search results* page and opens this tool with
them in the URL hash (`#bm=…`); they go through the normal parser into the editable preview. The link is in the
"Amazon search bookmarklet" panel — drag it to your bookmarks bar.

- It depends on Amazon's markup (`[data-component-type="s-search-result"]`, `.a-price .a-offscreen`) and **will break when Amazon changes it**.
  All of that is isolated in the one `.js` file; delete the `src/bookmarklet/` folder and its two calls in `main.ts` to remove the feature.
- **Bookmarklets are awkward on mobile browsers** (no bookmarks bar; many block `javascript:` URLs). On a phone, use copy & paste.
- Amazon's Terms of Use restrict automated scraping; this only reads the page you are already viewing, on demand, but check it is OK for your use.

## Layout

```
src/core/      pure logic, no DOM: units, calc (price/rank/break-even), parser, io (JSON/CSV), format, i18n, state, sample
src/ui/        DOM + CSS (the only code touching the document)
src/bookmarklet/  isolated Amazon-search bookmarklet
tests/         vitest
```
