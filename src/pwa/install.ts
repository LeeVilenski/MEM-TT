/** "Install app" support: Android/desktop Chrome prompt, plus iOS Add to Home Screen steps. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as BeforeInstallPromptEvent;
  notify();
});
addEventListener('appinstalled', () => {
  deferred = null;
  notify();
});

export const isStandalone = () =>
  matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** True when there's something useful to show: a native prompt, or iOS instructions. */
export const canInstall = () => !isStandalone() && (deferred !== null || isIos());

export const onInstallChange = (f: () => void) => listeners.add(f);

/** Returns 'ios' when the caller should show manual steps instead. */
export async function install(): Promise<'done' | 'dismissed' | 'ios'> {
  if (!deferred) return 'ios';
  const ev = deferred;
  deferred = null;
  await ev.prompt();
  const { outcome } = await ev.userChoice;
  notify();
  return outcome === 'accepted' ? 'done' : 'dismissed';
}
