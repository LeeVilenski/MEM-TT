// Screenshots of every character from the avatar gallery (avatars.html), compared
// against a saved baseline so changes to the models can be checked picture by picture.
//
//   npm run avatar:shots -- --baseline   save the pictures as the baseline
//   npm run avatar:shots                 take new pictures and compare them with the baseline
//   npm run avatar:shots -- --check      the same, but fail if anything changed
//   npm run avatar:shots -- --only allround,looper
//
// Pictures go to avatar-shots/{baseline,current,diff}/ (not committed). The first time,
// install a browser for Playwright: npx playwright install chromium
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const STYLES = ['allround', 'looper', 'chopper', 'blocker', 'penhold', 'pusher', 'patient', 'wheelchair', 'attacker'];
const only = option('only')?.split(',');
const targets = ['lineup', ...STYLES].filter((s) => !only || only.includes(s));
const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, 'avatar-shots', flag('baseline') ? 'baseline' : 'current');
const baseDir = resolve(root, 'avatar-shots', 'baseline');
const diffDir = resolve(root, 'avatar-shots', 'diff');
/** A pixel counts as changed when any channel differs by more than this (0–255). */
const TOLERANCE = 6;
/** --check fails above this share of changed pixels. */
const CHECK_LIMIT = 0.0005;

const exists = (p) => access(p).then(() => true, () => false);

const server = await createServer({ root, logLevel: 'error', server: { port: 0, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];
// Software WebGL, so the pictures come out the same on any machine.
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1700 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
await mkdir(outDir, { recursive: true });

let failed = false;
const rows = [];
try {
  for (const name of targets) {
    await page.goto(`${url}avatars.html?style=${name}&shot=1`);
    await page.waitForFunction(() => window.__avatarGalleryReady === true, null, { timeout: 60_000 });
    const file = resolve(outDir, `${name}.png`);
    await page.locator('#sheet').screenshot({ path: file });
    if (flag('baseline')) {
      rows.push(`${name.padEnd(12)} saved`);
      continue;
    }
    const base = resolve(baseDir, `${name}.png`);
    if (!(await exists(base))) {
      rows.push(`${name.padEnd(12)} no baseline`);
      continue;
    }
    // Compare in the page: draw both into canvases and count the differing pixels.
    const [a, b] = await Promise.all([readFile(base), readFile(file)]);
    const result = await page.evaluate(
      async ({ a, b, tol }) => {
        const load = async (b64) => {
          const img = new Image();
          img.src = `data:image/png;base64,${b64}`;
          await img.decode();
          return img;
        };
        const [ia, ib] = await Promise.all([load(a), load(b)]);
        if (ia.width !== ib.width || ia.height !== ib.height) return { sizeMismatch: true };
        const w = ia.width;
        const h = ia.height;
        const get = (img) => {
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const x = c.getContext('2d');
          x.drawImage(img, 0, 0);
          return x.getImageData(0, 0, w, h);
        };
        const da = get(ia).data;
        const db = get(ib).data;
        const out = new ImageData(w, h);
        let changed = 0;
        for (let i = 0; i < da.length; i += 4) {
          const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
          const grey = (db[i] + db[i + 1] + db[i + 2]) / 9; // the new picture, dimmed
          if (d > tol) {
            changed++;
            out.data.set([255, 40, 90, 255], i);
          } else out.data.set([grey, grey, grey, 255], i);
        }
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d').putImageData(out, 0, 0);
        return { share: changed / (w * h), png: c.toDataURL('image/png').split(',')[1] };
      },
      { a: a.toString('base64'), b: b.toString('base64'), tol: TOLERANCE },
    );
    if (result.sizeMismatch) {
      rows.push(`${name.padEnd(12)} size changed`);
      failed = true;
      continue;
    }
    const pct = (result.share * 100).toFixed(3);
    if (result.share > 0) {
      await mkdir(diffDir, { recursive: true });
      await writeFile(resolve(diffDir, `${name}.png`), Buffer.from(result.png, 'base64'));
    }
    if (result.share > CHECK_LIMIT) failed = true;
    rows.push(`${name.padEnd(12)} ${result.share === 0 ? 'identical' : `${pct}% of pixels changed (diff/${name}.png)`}`);
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(rows.join('\n'));
console.log(`Pictures in ${outDir}`);
if (flag('check') && failed) {
  console.error('Avatar pictures changed.');
  process.exit(1);
}
