import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

const pngSize = (file: string) => {
  const b = readFileSync(file);
  expect(b.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); // PNG signature
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

describe('manifest', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
  it('is installable: name, standalone, start_url, icons', () => {
    expect(manifest.name).toBe('LeafWise');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('./');
    expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '192x192')).toBe(true);
    expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
  });
  it('every icon exists and has its declared size', () => {
    for (const icon of manifest.icons as { src: string; sizes: string }[]) {
      const [w, h] = icon.sizes.split('x').map(Number);
      expect(pngSize(join('public', icon.src))).toEqual([w, h]);
    }
    expect(pngSize('public/icons/apple-touch-icon.png')).toEqual([180, 180]);
  });
});

describe('production build', () => {
  it('emits sw.js listing the hashed assets and links the manifest relatively', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'leafwise-build-'));
    await build({ logLevel: 'silent', build: { outDir, emptyOutDir: true } });
    const sw = readFileSync(join(outDir, 'sw.js'), 'utf8');
    expect(sw).not.toContain('__BUILD__');
    expect(sw).not.toContain('__PRECACHE__');
    expect(sw).toMatch(/\.\/assets\/index-[\w-]+\.js/);
    expect(sw).toMatch(/\.\/assets\/index-[\w-]+\.css/);
    const html = readFileSync(join(outDir, 'index.html'), 'utf8');
    expect(html).toContain('href="./manifest.webmanifest"');
    expect(html).toContain('apple-touch-icon');
    for (const f of ['manifest.webmanifest', 'icons/icon-512.png', 'icons/maskable-512.png', 'favicon.svg']) expect(existsSync(join(outDir, f))).toBe(true);
    // every precached file really exists in the build, otherwise install would fail offline
    const list = JSON.parse(/const PRECACHE = (\[.*?\]);/s.exec(sw)![1]) as string[];
    for (const u of list) if (u !== './') expect(existsSync(join(outDir, u))).toBe(true);
  }, 30000);
});

/** Runs the real service worker source against a tiny fake Cache API. */
function loadSW() {
  const src = readFileSync('scripts/sw-template.js', 'utf8').replaceAll('__BUILD__', 'test1').replaceAll('__PRECACHE__', '["./", "./index.html"]');
  const handlers: Record<string, (e: unknown) => void> = {};
  const stores = new Map<string, Map<string, string>>([['leafwise-old', new Map()], ['other-app', new Map()]]);
  const calls = { skipWaiting: 0, claim: 0 };
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const s = stores.get(name)!;
      return { add: async (r: { url: string }) => { s.set(r.url, 'body'); }, put: async (r: { url: string }, v: string) => { s.set(r.url, v); } };
    },
    keys: async () => [...stores.keys()],
    delete: async (k: string) => stores.delete(k),
    match: async (r: string | { url: string }) => {
      const key = typeof r === 'string' ? r : r.url;
      for (const s of stores.values()) if (s.has(key)) return s.get(key);
      return undefined;
    },
  };
  const self = {
    addEventListener: (n: string, f: (e: unknown) => void) => { handlers[n] = f; },
    skipWaiting: () => { calls.skipWaiting++; },
    clients: { claim: async () => { calls.claim++; } },
    location: { origin: 'https://x.test' },
  };
  vm.runInNewContext(src, { self, caches, Request: class { constructor(public url: string) {} }, URL, Promise, fetch: async () => { throw new Error('offline'); } });
  return { handlers, stores, calls };
}

describe('service worker', () => {
  it('precaches on install and cleans only its own old caches on activate', async () => {
    const { handlers, stores, calls } = loadSW();
    let p!: Promise<unknown>;
    handlers.install({ waitUntil: (x: Promise<unknown>) => { p = x; } });
    await p;
    expect([...stores.get('leafwise-test1')!.keys()]).toEqual(['./', './index.html']);
    handlers.activate({ waitUntil: (x: Promise<unknown>) => { p = x; } });
    await p;
    expect(stores.has('leafwise-old')).toBe(false);
    expect(stores.has('other-app')).toBe(true);
    expect(calls.claim).toBe(1);
  });
  it('waits for the page before taking over (no surprise reloads)', () => {
    const { handlers, calls } = loadSW();
    expect(calls.skipWaiting).toBe(0);
    handlers.message({ data: 'something else' });
    expect(calls.skipWaiting).toBe(0);
    handlers.message({ data: 'SKIP_WAITING' });
    expect(calls.skipWaiting).toBe(1);
  });
  it('serves the cached app shell when a navigation fails offline', async () => {
    const { handlers, stores } = loadSW();
    stores.set('leafwise-test1', new Map([['./index.html', 'SHELL']]));
    let res: Promise<unknown> | undefined;
    handlers.fetch({ request: { method: 'GET', mode: 'navigate', url: 'https://x.test/' }, respondWith: (p: Promise<unknown>) => { res = p; } });
    expect(await res).toBe('SHELL');
  });
  it('ignores cross-origin and non-GET requests', () => {
    const { handlers } = loadSW();
    let used = false;
    const respondWith = () => { used = true; };
    handlers.fetch({ request: { method: 'POST', mode: 'cors', url: 'https://x.test/a' }, respondWith });
    handlers.fetch({ request: { method: 'GET', mode: 'cors', url: 'https://other.test/a' }, respondWith });
    expect(used).toBe(false);
  });
});
