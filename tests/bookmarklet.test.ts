// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { buildBookmarklet, readBookmarkletHash } from '../src/bookmarklet/install';

describe('bookmarklet code', () => {
  it('runs against an Amazon-like results page and sends title, price and canonical link', () => {
    document.body.innerHTML = `
      <div data-component-type="s-search-result">
        <h2><a href="/sspa/click?url=%2FProduct-Name%2Fdp%2FB0ABCDEFGH%2Fref%3Dsr_1"><span>ヤシノミ 洗剤 詰替 540ml (x 2)</span></a></h2>
        <span class="a-price"><span class="a-offscreen">￥652</span></span>
      </div>
      <div data-component-type="s-search-result"><h2><span>no price</span></h2></div>`;
    const open = vi.fn();
    window.open = open as unknown as typeof window.open;
    const code = decodeURIComponent(buildBookmarklet('https://tool.example/app/').slice('javascript:'.length));
    new Function(code)();
    const url = open.mock.calls[0][0] as string;
    expect(url.startsWith('https://tool.example/app/#bm=')).toBe(true);
    const items = readBookmarkletHash(url.slice(url.indexOf('#')))!;
    expect(items).toHaveLength(1);
    expect(items[0].p).toBe('￥652');
    expect(items[0].u).toBe(`${location.origin}/dp/B0ABCDEFGH`);
  });
});
