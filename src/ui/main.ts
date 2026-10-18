import './style.css';
import { analyze, breakEvenPairs, type Issue } from '../core/calc';
import { fmtAmount, fmtMoney, fmtPct, fmtSmall, per100Factor, unitLabel } from '../core/format';
import { translate, type Key } from '../core/i18n';
import { listFromCSV, listToCSV, listToJSON, listsFromJSON, newId, sanitizeUrl } from '../core/io';
import { parseListings, type ParsedProduct, type ParseWarning } from '../core/parser';
import { SAMPLE_ROWS } from '../core/sample';
import { loadState, newList, saveState } from '../core/state';
import { PRODUCT_COLORS, type Lang, type Product, type RankBy, type Unit } from '../core/types';
import { UNIT_LIST } from '../core/units';
import { APP_VERSION, BUILD_ID, applyWaitingUpdate, canPromptInstall, checkForUpdates, isIOS, isStandalone, onInstallStateChange, promptInstall, registerSW } from './pwa';
import { buildBookmarklet, readBookmarkletHash, type BmItem } from '../bookmarklet/install';

/* ---------- state ---------- */

const storage = (() => { try { return window.localStorage; } catch { return null; } })();
const state = loadState(storage, navigator.language);
const t = (k: Key, p?: Record<string, string | number>) => translate(state.lang, k, p);
const active = () => state.lists.find((l) => l.id === state.activeId) ?? state.lists[0];
const save = () => saveState(storage, state);

interface Draft { product: Product; warnings: ParseWarning[] }
let drafts: Draft[] = [];
let pasteText = '';
let regularDose: number | null = null;
let openId: string | null = null; // the one expanded row

/* ---------- tiny DOM helper ---------- */

type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = String(v);
    else if (k === 'value') (el as unknown as HTMLInputElement).value = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids) if (kid !== null) el.append(kid);
  return el;
}

const toast = (msg: string, action?: { label: string; fn: () => void }, sticky = false) => {
  const el = h('div', { class: 'toast', role: 'status' }, msg,
    action ? h('button', { class: 'ghost', onClick: () => { action.fn(); el.remove(); } }, action.label) : null,
    sticky ? h('button', { class: 'ghost', 'aria-label': t('dismiss'), onClick: () => { el.remove(); updatePromptShown = false; } }, '✕') : null);
  document.body.append(el);
  if (!sticky) setTimeout(() => el.remove(), action ? 6000 : 2500);
};

let updatePromptShown = false;
function showUpdatePrompt(apply: () => void) {
  if (updatePromptShown) return;
  updatePromptShown = true;
  toast(t('updateAvailable'), { label: t('updateNow'), fn: apply }, true);
}

const DISMISS_KEY = 'leafwise:installDismissed';
const installDismissed = () => { try { return storage?.getItem(DISMISS_KEY) === '1'; } catch { return false; } };

function download(filename: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const blankProduct = (): Product => ({
  id: newId(), name: '', price: null, packs: 1, size: null, unit: 'ml',
  points: null, coupon: null, shipping: null, uses: null, note: '', store: '', color: '', url: '',
});

const fromParsed = (p: ParsedProduct): Draft => ({
  warnings: p.warnings,
  product: {
    id: newId(), name: p.name, price: p.price, packs: p.packs, size: p.size, unit: p.unit,
    points: p.points || null, coupon: p.coupon || null, shipping: p.shipping || null, uses: p.uses, note: '', store: '', color: '', url: '',
  },
});

/* ---------- bottom sheet ---------- */

let closeSheet: (() => void) | null = null;
function openSheet(title: string, body: Node, onClose?: () => void) {
  closeSheet?.();
  const overlay = h('div', { class: 'overlay', onClick: (e: Event) => { if (e.target === overlay) close(); } });
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    closeSheet = null;
    onClose?.();
  };
  document.addEventListener('keydown', onKey);
  overlay.append(h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h2', {}, title), h('button', { class: 'ghost', 'aria-label': t('close'), onClick: close }, '✕')),
    body));
  document.body.append(overlay);
  closeSheet = close;
  return close;
}

/* ---------- product editor (rows and drafts share it) ---------- */

type NumField = 'price' | 'packs' | 'size' | 'points' | 'coupon' | 'shipping' | 'uses';

function numField(p: Product, field: NumField, label: Key, onChange: () => void) {
  const input = h('input', {
    type: 'number', inputmode: 'decimal', min: 0, step: 'any', value: p[field] === null ? '' : p[field]!,
    onInput: () => {
      const v = input.value.trim();
      p[field] = v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
      onChange();
    },
  });
  return { input, label: h('label', {}, t(label), input) };
}

function editor(p: Product, onChange: () => void, autofocusName = false): HTMLElement {
  const name = h('input', { type: 'text', value: p.name, placeholder: t('name'), onInput: () => { p.name = name.value; onChange(); } });
  const unit = h('select', { 'aria-label': t('unit'), onChange: () => { p.unit = unit.value as Unit; onChange(); } },
    ...UNIT_LIST.map((u) => h('option', { value: u, selected: u === p.unit }, t(`unit_${u}` as Key))));
  const note = h('input', { type: 'text', value: p.note, onInput: () => { p.note = note.value; onChange(); } });
  const price = numField(p, 'price', 'price', onChange);
  const packs = numField(p, 'packs', 'packs', onChange);
  const size = numField(p, 'size', 'size', onChange);
  const storeId = 'stores-' + p.id;
  const known = [...new Set(state.lists.flatMap((l) => l.rows.map((r) => r.store)).filter(Boolean))];
  const store = h('input', { type: 'text', value: p.store, list: storeId, onInput: () => { p.store = store.value.slice(0, 60); onChange(); } });
  const storeList = h('datalist', { id: storeId }, ...known.map((s) => h('option', { value: s })));
  const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': t('color') });
  const drawSwatches = () => swatches.replaceChildren(...['', ...PRODUCT_COLORS].map((c) =>
    h('button', { class: `swatch c-${c || 'none'}`, role: 'radio', 'aria-checked': String(p.color === c), 'aria-label': c || t('colorNone'), title: c || t('colorNone'),
      onClick: () => { p.color = c; drawSwatches(); onChange(); } }, c === '' ? '∅' : '')));
  drawSwatches();
  const link = h('input', { type: 'url', inputmode: 'url', placeholder: 'https://…', value: p.url, onInput: () => { p.url = sanitizeUrl(link.value); onChange(); } });
  const more = h('details', { open: [p.points, p.coupon, p.shipping, p.uses].some(Boolean) || !!p.note || !!p.store || !!p.color },
    h('summary', {}, t('more')),
    h('div', { class: 'grid' },
      numField(p, 'points', 'points', onChange).label, numField(p, 'coupon', 'coupon', onChange).label,
      numField(p, 'shipping', 'shipping', onChange).label, numField(p, 'uses', 'uses', onChange).label,
      h('label', { class: 'full' }, t('store'), store, storeList),
      h('div', { class: 'full' }, h('label', {}, t('color')), swatches),
      h('label', { class: 'full' }, t('note'), note),
      h('label', { class: 'full' }, t('link'), link)));
  if (autofocusName) queueMicrotask(() => name.focus());
  return h('div', {},
    h('div', { class: 'grid' },
      h('label', { class: 'full' }, t('name'), name),
      price.label, packs.label,
      h('div', { class: 'full pair' }, size.label, h('label', {}, t('unit'), unit))),
    more);
}

/* ---------- main screen ---------- */

const app = document.getElementById('app')!;

let installChip: HTMLElement | null = null;

/** One-time "install" hint; shown only where installing is actually possible. */
function updateInstallChip() {
  if (!installChip) return;
  const show = !isStandalone() && !installDismissed() && (canPromptInstall() || isIOS());
  installChip.style.display = show ? '' : 'none';
  if (!show) return;
  installChip.replaceChildren(
    h('span', {}, t('installChip')),
    h('button', { class: 'primary', onClick: async () => { if (canPromptInstall()) await promptInstall(); else openSettings(); } }, t('installBtn')),
    h('button', { class: 'ghost', 'aria-label': t('dismiss'), onClick: () => {
      try { storage?.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
      updateInstallChip();
    } }, '✕'));
}

interface RowRefs { root: HTMLElement; rank: HTMLElement; name: HTMLElement; up: HTMLElement; facts: HTMLElement; body: HTMLElement; issues: HTMLElement }
const live: { banner?: HTMLElement; rows: Map<string, RowRefs>; empty?: HTMLElement; extras?: HTMLElement; list?: HTMLElement } = { rows: new Map() };

function seg(value: string, opts: [string, string][], onPick: (v: string) => void, label: string) {
  return h('div', { class: 'seg', role: 'group', 'aria-label': label },
    ...opts.map(([v, text]) => h('button', { 'aria-pressed': String(v === value), onClick: () => onPick(v) }, text)));
}

function render() {
  document.documentElement.lang = state.lang;
  document.title = t('appTitle');
  live.rows.clear();
  breakBody = null;
  const list = active();

  const listSel = h('select', { 'aria-label': t('list'), onChange: () => { state.activeId = listSel.value; openId = null; save(); render(); } },
    ...state.lists.map((l) => h('option', { value: l.id, selected: l.id === list.id }, l.name)));
  const header = h('header', {}, listSel, h('button', { class: 'ghost', 'aria-label': t('settings'), title: t('settings'), onClick: openSettings }, '⚙'));

  live.banner = h('div', { class: 'banner idle', role: 'status', 'aria-live': 'polite' });
  installChip = h('div', { class: 'chip' });
  live.extras = h('div');
  live.list = h('div', { class: 'rows' });
  live.empty = h('div', { class: 'empty-state' }, h('p', {}, t('emptyRows')),
    h('button', { onClick: () => { list.rows.push(...SAMPLE_ROWS.map((r) => ({ ...r, id: newId() }))); save(); render(); } }, t('loadSample')));
  for (const row of list.rows) live.list.append(buildRow(row));

  const fab = h('div', { class: 'fab' }, h('button', { class: 'primary', onClick: openAdd }, t('addRow')));
  app.replaceChildren(h('main', {}, header, live.banner, installChip, live.empty, live.list, live.extras), fab);
  updateInstallChip();
  updateResults();
}

function buildRow(p: Product): HTMLElement {
  const refs: RowRefs = {
    root: h('div', { class: 'row' }),
    rank: h('div', { class: 'rank' }),
    name: h('div', { class: 'nm' }),
    up: h('div', { class: 'up' }),
    facts: h('div', { class: 'facts' }),
    body: h('div'),
    issues: h('div'),
  };
  const toggle = () => {
    const prev = openId ? live.rows.get(openId) : null;
    if (prev) prev.body.replaceChildren();
    if (openId === p.id) { openId = null; return; }
    openId = p.id;
    refs.body.replaceChildren(h('div', { class: 'row-body' }, refs.issues,
      p.url ? h('p', {}, h('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer' }, t('open') + ' ↗')) : null,
      editor(p, () => { save(); updateResults(); }),
      h('div', { class: 'bar' },
        h('button', { onClick: () => {
          const l = active();
          const copy = { ...p, id: newId() };
          l.rows.splice(l.rows.findIndex((r) => r.id === p.id) + 1, 0, copy);
          openId = copy.id; save(); render();
        } }, t('duplicate')),
        h('button', { class: 'danger', onClick: () => {
          const l = active();
          const idx = l.rows.findIndex((r) => r.id === p.id);
          const [removed] = l.rows.splice(idx, 1);
          openId = null; save(); render();
          toast(t('deleted'), { label: t('undo'), fn: () => { l.rows.splice(Math.min(idx, l.rows.length), 0, removed); save(); render(); } });
        } }, t('delete')))));
  };
  const sum = h('div', { class: 'row-sum', role: 'button', tabindex: 0, onClick: toggle, onKeydown: (e: Event) => {
    const k = (e as KeyboardEvent).key;
    if (k === 'Enter' || k === ' ') { e.preventDefault(); toggle(); }
  } }, refs.rank, refs.name, refs.up, refs.facts);
  refs.root.append(sum, refs.body);
  live.rows.set(p.id, refs);
  if (openId === p.id) { openId = null; toggle(); }
  return refs.root;
}

const issueText = (i: Issue) => t(`issue_${i}` as Key);

function updateResults() {
  const list = active();
  const a = analyze(list.rows, list.rankBy);
  const cur = state.currency;
  live.empty!.style.display = list.rows.length ? 'none' : '';

  for (const r of a.rows) {
    const refs = live.rows.get(r.id);
    const p = list.rows.find((x) => x.id === r.id);
    if (!refs || !p) continue;
    const u = unitLabel(r.baseUnit, state.lang);
    const f = per100Factor(r.dimension);
    refs.root.classList.toggle('best', r.isBest);
    refs.rank.textContent = r.rank !== null ? String(r.rank) : '–';
    refs.name.replaceChildren(...(p.color ? [h('span', { class: `dot c-${p.color}` })] : []), p.name || t('unnamed'));
    refs.name.classList.toggle('empty', !p.name);
    const mult = f && state.basis === 100 ? 100 : 1;
    const bu = mult === 100 ? `100${u}` : u;
    const head = list.rankBy === 'use' ? r.perUse : r.valid ? r.unitPrice * mult : null;
    refs.up.textContent = head === null ? '—' : `${fmtSmall(head, cur)}/${list.rankBy === 'use' ? t('perUse') : bu}`;

    const bits: (Node | string)[] = [];
    const qty = (p.packs ?? 1) !== 1 ? `${p.packs}×${p.size ?? '?'}` : `${p.size ?? '?'}`;
    bits.push(`${qty} ${t(`unit_${p.unit}` as Key)}`);
    if (p.store) bits.push(p.store);
    if (p.price) bits.push(fmtMoney(r.netPrice, cur));
    if (r.valid && list.rankBy === 'unit' && f) bits.push(mult === 100 ? `${fmtSmall(r.unitPrice, cur)}/${u}` : `${fmtSmall(r.unitPrice * f, cur)}/100${u}`);
    if (list.rankBy === 'unit' && r.perUse !== null) bits.push(h('span', { class: 'rk' }, `${fmtSmall(r.perUse, cur)}/${t('perUse')}`));
    if (list.rankBy === 'use' && r.valid) bits.push(`${fmtSmall(r.unitPrice * mult, cur)}/${bu}`);
    if (r.isBest) bits.push(h('span', { class: 'pct' }, '★ ' + t('best')));
    else if (r.pctMoreThanBest !== null) bits.push(h('span', { class: 'pct' }, fmtPct(r.pctMoreThanBest)));
    else if (list.rankBy === 'use' && r.valid && r.perUse === null) bits.push(t('noUses'));
    if (r.issues.length) bits.push(h('span', { class: 'bad' }, '⚠'));
    refs.facts.replaceChildren(...bits.flatMap((b, i) => (i ? [' · ', b] : [b])));
    refs.issues.replaceChildren(...r.issues.map((i) => h('div', { class: 'issue' }, issueText(i))));
    refs.root.style.order = String(r.rank ?? 1000 + list.rows.findIndex((x) => x.id === r.id));
  }

  const b = live.banner!;
  b.className = 'banner';
  if (!a.comparable) {
    b.classList.add('warn');
    b.replaceChildren(h('b', {}, '⚠ ' + t('cantCompare', { units: a.dimensions.map((d) => t(`dim_${d}` as Key)).join(' / ') })));
  } else if (a.bestId) {
    const best = a.rows.find((r) => r.id === a.bestId)!;
    const p = list.rows.find((x) => x.id === a.bestId)!;
    const u = unitLabel(best.baseUnit, state.lang);
    const bm = per100Factor(best.dimension) && state.basis === 100 ? 100 : 1;
    const val = list.rankBy === 'use' ? `${fmtSmall(best.perUse!, cur)}/${t('perUse')}` : `${fmtSmall(best.unitPrice * bm, cur)}/${bm === 100 ? '100' : ''}${u}`;
    b.replaceChildren(h('b', {}, `★ ${p.name || t('unnamed')}`), h('span', {}, val),
      ...(p.url ? [h('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': t('open') }, '↗')] : []));
  } else {
    b.classList.add('idle');
    b.replaceChildren(h('b', {}, list.rankBy === 'use' && list.rows.length ? t('noBestUse') : t('noBest')));
  }
  updateBreakEven();
}

/* rank toggle + break-even: only shown once a concentrate (uses set) exists */
let breakBody: HTMLElement | null = null;

function renderExtras() {
  const list = active();
  const kids: Node[] = [];
  breakBody = null;
  if (list.rows.some((r) => (r.uses ?? 0) > 0) || list.rankBy === 'use') {
    kids.push(h('div', { class: 'bar section' }, h('span', { class: 'muted' }, t('rankBy')),
      seg(list.rankBy, [['unit', t('rankUnit')], ['use', t('rankUse')]], (v) => { list.rankBy = v as RankBy; save(); render(); }, t('rankBy'))));
  }
  if (breakEvenPairs(list.rows).length) {
    const dose = h('input', { type: 'number', inputmode: 'decimal', min: 0, step: 'any', value: regularDose ?? '',
      onInput: () => { regularDose = dose.value === '' ? null : Number(dose.value); updateBreakEven(); } });
    breakBody = h('div');
    kids.push(h('div', { class: 'section' }, h('h2', {}, t('breakTitle')), h('p', { class: 'muted' }, t('breakExplain')),
      h('label', {}, t('breakDose', { unit: 'ml/g' }), dose), breakBody));
  }
  live.extras!.replaceChildren(...kids);
}

function updateBreakEven() {
  const list = active();
  const had = !!breakBody;
  const hasPairs = breakEvenPairs(list.rows).length > 0;
  const hasRank = list.rows.some((r) => (r.uses ?? 0) > 0) || list.rankBy === 'use';
  // rebuild the section skeleton only when its shape changes, so typing in the dose field keeps focus
  if (had !== hasPairs || !!live.extras!.querySelector('.seg') !== hasRank) renderExtras();
  if (!breakBody) return;
  const name = (id: string) => list.rows.find((r) => r.id === id)?.name || t('unnamed');
  breakBody.replaceChildren(...breakEvenPairs(list.rows).map((pr) => {
    const u = unitLabel(pr.baseUnit, state.lang);
    const verdict = regularDose !== null && regularDose > 0
      ? h('span', { class: 'pill ' + (regularDose < pr.dose ? 'good' : '') }, regularDose < pr.dose ? t('breakRegularWins') : t('breakConcWins')) : null;
    return h('p', {}, t('breakRow', { reg: name(pr.regularId), conc: name(pr.concentrateId), dose: fmtAmount(Math.round(pr.dose * 100) / 100), unit: u }), ' ', verdict);
  }));
}

/* ---------- add sheet: paste or type, review, add ---------- */

let manual: Product = blankProduct();

/** Opens an Amazon search in a new tab; the bookmarklet there sends the results back. */
function searchSection(): HTMLElement {
  const q = h('input', { type: 'search', placeholder: t('searchPlaceholder'), 'aria-label': t('searchOr'), onKeydown: (e: Event) => { if ((e as KeyboardEvent).key === 'Enter') go(); } });
  const go = () => {
    const term = q.value.trim();
    if (!term) return;
    const host = state.currency === 'JPY' ? 'www.amazon.co.jp' : 'www.amazon.com';
    window.open(`https://${host}/s?k=${encodeURIComponent(term)}`, '_blank', 'noopener');
  };
  return h('div', { class: 'section' }, h('h2', {}, t('searchOr')),
    h('div', { class: 'pair', style: 'grid-template-columns:1fr auto' }, q, h('button', { onClick: go }, t('searchGo'))),
    h('p', { class: 'muted' }, t('searchHint')));
}

function openAdd() {
  const ta = h('textarea', { placeholder: t('pastePlaceholder'), 'aria-label': t('pasteTitle'), value: pasteText });
  const out = h('div');
  const show = () => {
    const kids: Node[] = [];
    if (drafts.length > 1) kids.push(h('div', { class: 'bar' }, h('button', { class: 'primary', onClick: () => commit(drafts.slice()) }, `${t('addAll')} (${drafts.length})`)));
    for (const d of drafts) {
      kids.push(h('div', { class: 'draft' },
        d.warnings.length ? h('div', { class: 'warns' }, d.warnings.map((w) => '⚠ ' + t(`warn_${w}` as Key)).join(' · ')) : null,
        editor(d.product, () => {}),
        h('div', { class: 'bar' },
          h('button', { class: 'primary', onClick: () => commit([d]) }, t('addThis')),
          h('button', { onClick: () => { drafts = drafts.filter((x) => x !== d); show(); } }, t('discard')))));
    }
    if (pasteText.trim() && !drafts.length) kids.push(h('p', { class: 'muted' }, t('nothingParsed')));
    out.replaceChildren(...kids);
  };
  const finish = () => { save(); render(); toast(t('added')); };
  const commit = (ds: Draft[]) => {
    active().rows.push(...ds.map((d) => d.product));
    drafts = drafts.filter((d) => !ds.includes(d));
    finish();
    if (drafts.length) show();
    else { pasteText = ''; close(); }
  };
  const addManual = () => {
    active().rows.push(manual);
    manual = blankProduct();
    finish();
    close();
  };
  // parsing is instant, so re-parse on every edit of the paste box
  ta.addEventListener('input', () => { pasteText = ta.value; drafts = parseListings(pasteText).map(fromParsed); show(); });
  const close = openSheet(t('addRow').replace(/^[+＋]\s*/, ''), h('div', {},
    editor(manual, () => {}, true),
    h('div', { class: 'bar' }, h('button', { class: 'primary', onClick: addManual }, t('addThis'))),
    h('div', { class: 'section' }, h('h2', {}, t('pasteOr')), h('p', { class: 'muted' }, t('pasteHint')), ta, out),
    searchSection()));
  show();
}

/* ---------- settings sheet ---------- */

function openSettings() {
  const list = active();
  const safe = list.name.replace(/[^\w぀-ヿ一-鿿-]+/g, '_') || 'list';
  const again = () => { render(); openSettings(); };
  const file = h('input', { type: 'file', accept: '.json,.csv,application/json,text/csv', style: 'display:none', onChange: async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    try {
      const text = await f.text();
      const base = f.name.replace(/\.[^.]+$/, '');
      const imported = /\.csv$/i.test(f.name) ? [listFromCSV(text, base)] : listsFromJSON(text, base);
      state.lists.push(...imported);
      state.activeId = imported[imported.length - 1].id;
      openId = null; save(); render(); closeSheet?.();
      toast(t('importDone', { n: imported.length }));
    } catch { toast(t('importFail')); }
  } });
  const bmUrl = buildBookmarklet(location.origin + location.pathname);
  openSheet(t('settings'), h('div', {},
    h('div', { class: 'bar' }, seg(state.lang, [['en', 'EN'], ['ja', '日本語']], (v) => { state.lang = v as Lang; save(); again(); }, t('lang')),
      seg(state.currency, [['JPY', '¥'], ['USD', '$']], (v) => { state.currency = v as 'JPY' | 'USD'; save(); again(); }, t('currency'))),
    h('div', { class: 'bar' }, h('span', { class: 'muted' }, t('basis')),
      seg(String(state.basis), [['1', t('basisOne')], ['100', t('basisHundred')]], (v) => { state.basis = v === '1' ? 1 : 100; save(); again(); }, t('basis'))),
    h('p', { class: 'muted' }, t('currencyNote')),
    h('div', { class: 'section' }, h('h2', {}, t('list')), h('div', { class: 'bar' },
      h('button', { onClick: () => {
        const name = prompt(t('listNamePrompt'), t('defaultListName'));
        if (!name?.trim()) return;
        const l = newList(name.trim());
        state.lists.push(l); state.activeId = l.id; openId = null; save(); again();
      } }, t('newList')),
      h('button', { onClick: () => {
        const name = prompt(t('listNamePrompt'), list.name);
        if (!name?.trim()) return;
        list.name = name.trim(); save(); again();
      } }, t('renameList')),
      h('button', { class: 'danger', onClick: () => {
        if (!confirm(t('confirmDelete'))) return;
        const idx = state.lists.indexOf(list);
        state.lists = state.lists.filter((l) => l.id !== list.id);
        const filler = state.lists.length ? null : newList(t('defaultListName'));
        if (filler) state.lists.push(filler);
        state.activeId = state.lists[0].id; openId = null; save(); again();
        toast(t('deleted'), { label: t('undo'), fn: () => {
          if (filler) state.lists = state.lists.filter((l) => l.id !== filler.id);
          state.lists.splice(Math.min(idx, state.lists.length), 0, list);
          state.activeId = list.id; openId = null; save(); render();
        } });
      } }, t('deleteList')))),
    h('div', { class: 'bar' },
      h('button', { onClick: () => download(`${safe}.json`, listToJSON(list), 'application/json') }, t('exportJson')),
      h('button', { onClick: () => download(`${safe}.csv`, '﻿' + listToCSV(list), 'text/csv;charset=utf-8') }, t('exportCsv')),
      h('button', { onClick: () => file.click() }, t('importFile')), file),
    h('div', { class: 'section' }, h('h2', {}, t('installTitle')),
      isStandalone() ? h('p', { class: 'muted' }, t('installed'))
        : canPromptInstall() ? h('button', { class: 'primary', onClick: () => { void promptInstall(); } }, t('installBtn'))
        : h('p', { class: 'muted' }, isIOS() ? t('installIOS') : t('installOther'))),
    h('div', { class: 'section' }, h('h2', {}, t('updateTitle')),
      h('p', { class: 'muted' }, `${t('version')}: v${APP_VERSION} (${BUILD_ID})`),
      h('button', { onClick: async () => {
        toast(t('checking'));
        const r = await checkForUpdates();
        if (r === 'ready') { updatePromptShown = false; showUpdatePrompt(applyWaitingUpdate); }
        else toast(t(r === 'latest' ? 'upToDate' : r === 'offline' ? 'updateOffline' : 'updateUnsupported'));
      } }, t('checkUpdates'))),
    h('details', { class: 'section' }, h('summary', {}, t('bmTitle')),
      h('p', { class: 'muted' }, t('bmStep1')), h('p', { class: 'muted' }, t('bmStep2')), h('p', { class: 'muted' }, t('bmStep3')), h('p', { class: 'muted' }, t('bmDesc') + ' ' + t('bmMobile')),
      h('div', { class: 'bar' },
        h('a', { href: bmUrl, class: 'pill', onClick: (e: Event) => e.preventDefault() }, '🔖 ' + t('bmLink')),
        h('button', { onClick: async () => {
          try { await navigator.clipboard.writeText(decodeURIComponent(bmUrl)); toast(t('bmCopied')); } catch { /* clipboard blocked */ }
        } }, t('bmCopy')))),
    h('p', { class: 'muted section' }, t('footer'))));
}

/* ---------- boot ---------- */

const bm = readBookmarkletHash(location.hash);
if (bm?.length) {
  drafts = bm.flatMap((item: BmItem) => {
    const first = parseListings(`${item.t}\n${item.p}`)[0];
    if (!first) return [];
    const d = fromParsed(first);
    d.product.url = sanitizeUrl(item.u);
    d.product.store = 'Amazon';
    return [d];
  });
  history.replaceState(null, '', location.pathname + location.search);
}
onInstallStateChange(updateInstallChip);
void registerSW(showUpdatePrompt);
render();
if (bm?.length) { openAdd(); toast(t('bmImported', { n: drafts.length })); }
