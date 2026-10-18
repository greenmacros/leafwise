import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };
// every deploy gets a new id, which makes the service worker file differ and triggers the update flow
const BUILD_ID = (process.env.GITHUB_SHA ?? '').slice(0, 7) || Date.now().toString(36);

// files in /public that must work offline
const STATIC_PRECACHE = ['./', './index.html', './manifest.webmanifest', './favicon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

/** Emits sw.js from scripts/sw-template.js with the list of built files to precache. */
function serviceWorker(): Plugin {
  return {
    name: 'leafwise-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const built = Object.keys(bundle).filter((f) => /\.(js|css)$/.test(f)).map((f) => './' + f);
      const source = readFileSync('./scripts/sw-template.js', 'utf8')
        .replaceAll('__BUILD__', BUILD_ID)
        .replaceAll('__PRECACHE__', JSON.stringify([...STATIC_PRECACHE, ...built]));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// base './' lets the built site run from any sub-path or straight from static hosting.
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [serviceWorker()],
  test: { include: ['tests/**/*.test.ts'] },
});
