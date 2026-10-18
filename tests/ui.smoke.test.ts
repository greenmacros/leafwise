// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

describe('ui smoke', () => {
  it('renders, ranks, adds by paste, warns on mixed units, switches language', async () => {
    window.scrollTo = () => {};
    document.body.innerHTML = '<div id="app"></div>';
    await import('../src/ui/main');
    const q = (s: string) => document.querySelector(s) as HTMLElement;
    const btn = (txt: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(txt)) as HTMLElement;

    expect(q('.banner').textContent).toContain('Add products');
    btn('Load sample data').click();
    expect(document.querySelectorAll('.row')).toHaveLength(4);
    expect(q('.row.best .nm').textContent).toContain('1000mL');

    // the banner must be replaced, not appended to, on every update (regression)
    btn('Load sample data'); // hidden but present
    const bannerLen = q('.banner').childNodes.length;
    (q('.row-sum') as HTMLElement).click();
    const price = q('.row-body input[type=number]') as HTMLInputElement;
    for (let i = 0; i < 5; i++) { price.value = String(500 + i); price.dispatchEvent(new Event('input')); }
    expect(q('.banner').childNodes.length).toBe(bannerLen);

    // add by paste
    btn('Add product').click();
    // manual form is on top
    expect(q('.sheet input[type=text]')).toBeTruthy();
    const nums = document.querySelectorAll<HTMLInputElement>('.sheet input[type=number]'); // price, packs, size
    nums[0].value = '300'; nums[0].dispatchEvent(new Event('input'));
    nums[2].value = '500'; nums[2].dispatchEvent(new Event('input'));
    (q('.sheet .bar .primary') as HTMLElement).click();
    expect(document.querySelectorAll('.row')).toHaveLength(5);
    btn('Add product').click();
    const ta = q('textarea') as HTMLTextAreaElement;
    ta.value = 'サラヤ ヤシノミ洗剤 詰替 540ml (x 2) ¥652';
    ta.dispatchEvent(new Event('input'));
    expect(document.querySelectorAll('.draft')).toHaveLength(1);
    (document.querySelector('.draft .primary') as HTMLElement).click();
    expect(document.querySelectorAll('.row')).toHaveLength(6);
    expect(document.querySelector('.overlay')).toBeNull();

    // concentrate row (uses set) exposes rank toggle + break-even
    expect(q('.seg')).toBeTruthy();

    // mixed units → warning banner
    (document.querySelectorAll('.row-sum')[1] as HTMLElement).click();
    const unit = q('.row-body select') as HTMLSelectElement;
    unit.value = 'g'; unit.dispatchEvent(new Event('change'));
    expect(q('.banner.warn')).toBeTruthy();

    // settings → language
    btn('⚙').click();
    btn('日本語').click();
    expect(document.title).toBe('LeafWise');
    expect(localStorage.getItem('leafwise:v1')).toContain('"lang":"ja"');
  });

  it('duplicate, delete + undo, store label, per-100 basis', () => {
    const q = (sel: string) => document.querySelector(sel) as HTMLElement;
    const btn = (txt: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(txt)) as HTMLElement;
    // language is ja from the previous test; switch back to English via settings
    document.querySelector('.overlay')?.remove();
    btn('⚙').click();
    btn('EN').click();
    document.querySelector('.overlay')?.remove();

    const before = document.querySelectorAll('.row').length;
    (q('.row-sum') as HTMLElement).click();
    btn('Duplicate').click();
    expect(document.querySelectorAll('.row')).toHaveLength(before + 1);

    // store label shows in the row summary
    const store = q('.row-body details input[list]') as HTMLInputElement;
    store.value = 'Seiyu'; store.dispatchEvent(new Event('input'));
    expect(document.body.textContent).toContain('Seiyu');

    // color tag shows as a dot
    (q('.row-body .swatch.c-blue') as HTMLElement).click();
    expect(document.querySelector('.row-sum .dot.c-blue')).toBeTruthy();

    btn('Delete').click();
    expect(document.querySelectorAll('.row')).toHaveLength(before);
    btn('Undo').click();
    expect(document.querySelectorAll('.row')).toHaveLength(before + 1);

    // default basis is per 100; switching to per 1 changes the headline
    expect(q('.up').textContent).toContain('/100');
    btn('⚙').click();
    btn('1 ml/g').click();
    document.querySelector('.overlay')?.remove();
    expect(q('.up').textContent).not.toContain('/100');
  });
});
