// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { canPromptInstall, checkForUpdates, isIOS, isStandalone, promptInstall } from '../src/ui/pwa';

describe('pwa helpers without a service worker / install prompt', () => {
  it('degrade gracefully', async () => {
    expect(canPromptInstall()).toBe(false);
    expect(await promptInstall()).toBe(false);
    expect(await checkForUpdates()).toBe('unsupported');
    expect(isStandalone()).toBe(false);
    expect(isIOS()).toBe(false);
  });
  it('captures the browser install prompt and uses it once', async () => {
    let prompted = 0;
    const ev = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: async () => { prompted++; },
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true); // we keep the prompt for our own button
    expect(canPromptInstall()).toBe(true);
    expect(await promptInstall()).toBe(true);
    expect(prompted).toBe(1);
    expect(canPromptInstall()).toBe(false); // a prompt can only be used once
  });
});
