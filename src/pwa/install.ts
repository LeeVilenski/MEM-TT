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

/** True when the browser offers a native install prompt (Android / desktop Chrome, Edge). */
export const canInstall = () => !isStandalone() && deferred !== null;

export const onInstallChange = (f: () => void) => listeners.add(f);

export async function install(): Promise<'done' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  const ev = deferred;
  deferred = null;
  await ev.prompt();
  const { outcome } = await ev.userChoice;
  notify();
  return outcome === 'accepted' ? 'done' : 'dismissed';
}
