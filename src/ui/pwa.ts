// Install + update plumbing. Everything here is optional: if service workers or the install
// prompt are unavailable (old browser, private mode, dev server) the app still works normally.

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
export const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

/* ---------- install ---------- */

let deferredPrompt: InstallPromptEvent | null = null;
const installListeners = new Set<() => void>();
export const onInstallStateChange = (fn: () => void) => { installListeners.add(fn); };
const notifyInstall = () => installListeners.forEach((fn) => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // keep it for our own button
    deferredPrompt = e as InstallPromptEvent;
    notifyInstall();
  });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; notifyInstall(); });
}

export const canPromptInstall = () => deferredPrompt !== null;

export function isStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  } catch { return false; }
}

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  const ev = deferredPrompt;
  deferredPrompt = null;
  await ev.prompt();
  const { outcome } = await ev.userChoice;
  notifyInstall();
  return outcome === 'accepted';
}

/* ---------- updates ---------- */

let reg: ServiceWorkerRegistration | undefined;

const swSupported = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator;

/**
 * Registers the service worker (production only). `onUpdateReady` receives an `apply` function
 * whenever a newer version has been downloaded and is waiting; calling it reloads into the new version.
 */
export async function registerSW(onUpdateReady: (apply: () => void) => void): Promise<void> {
  if (!swSupported() || !import.meta.env.PROD) return;
  try {
    reg = await navigator.serviceWorker.register('./sw.js');
  } catch { return; }
  const r = reg;
  const applyWaiting = () => r.waiting?.postMessage('SKIP_WAITING');
  const hadController = !!navigator.serviceWorker.controller;

  if (r.waiting && hadController) onUpdateReady(applyWaiting);
  r.addEventListener('updatefound', () => {
    const w = r.installing;
    w?.addEventListener('statechange', () => {
      // "installed" with an existing controller means this is an update, not the first install
      if (w.state === 'installed' && navigator.serviceWorker.controller) onUpdateReady(applyWaiting);
    });
  });

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return; // the very first install also fires this; don't reload then
    reloading = true;
    location.reload();
  });

  // look for a new deploy whenever the app comes back to the foreground, and hourly while open
  const check = () => { r.update().catch(() => {}); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  setInterval(check, 60 * 60 * 1000);
}

export type UpdateResult = 'ready' | 'latest' | 'unsupported' | 'offline';

/** Manual "check for updates". 'ready' means a new version is downloaded and waiting. */
export async function checkForUpdates(): Promise<UpdateResult> {
  if (!swSupported() || !reg) return 'unsupported';
  try { await reg.update(); } catch { return 'offline'; }
  const installing = reg.installing;
  if (installing) {
    await new Promise<void>((resolve) => {
      const done = () => { if (installing.state === 'installed' || installing.state === 'redundant') resolve(); };
      installing.addEventListener('statechange', done);
      setTimeout(resolve, 15000);
      done();
    });
  }
  return reg.waiting ? 'ready' : 'latest';
}

export function applyWaitingUpdate(): void {
  reg?.waiting?.postMessage('SKIP_WAITING');
}
