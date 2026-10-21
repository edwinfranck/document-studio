// Chromium sans tête : export PDF et captures. Utilise Chrome installé ou celui de Playwright,
// sans téléchargement ni service externe.
import { chromium, type Browser, type Page } from 'playwright-core';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function findChrome(): string | null {
  const env = process.env.STUDIO_CHROME;
  if (env && existsSync(env)) return env;
  const candidates = [
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  const cache = join(homedir(), '.cache', 'ms-playwright');
  if (existsSync(cache)) {
    const dirs = readdirSync(cache).filter(d => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const d of dirs) {
      const p = join(cache, d, 'chrome-linux64', 'chrome');
      if (existsSync(p)) return p;
    }
  }
  return null;
}

let browser: Promise<Browser> | null = null;
export function getBrowser(): Promise<Browser> {
  if (!browser) {
    const executablePath = findChrome();
    if (!executablePath) throw new Error('Aucun Chrome/Chromium trouvé. Installez Google Chrome ou indiquez son chemin dans STUDIO_CHROME.');
    browser = chromium.launch({ executablePath, args: ['--font-render-hinting=none', '--disable-gpu'] });
    browser.then(b => b.on('disconnected', () => { browser = null; }), () => { browser = null; });
  }
  return browser;
}
export async function closeBrowser() { if (browser) { const b = await browser; browser = null; await b.close(); } }

export type Kind = 'reading' | 'print' | 'slides';

/** Charge un HTML produit par le moteur et attend qu'il soit prêt (pagination, ajustement des slides). */
export async function loadDocument(html: string, kind: Kind, viewport = { width: 1280, height: 900 }, timeout = 60_000): Promise<{ page: Page; info: any }> {
  const b = await getBrowser();
  const page = await b.newPage({ viewport });
  // Aucune requête réseau pendant un export : les documents sont autonomes.
  await page.route(/^https?:/, route => route.abort());
  await page.setContent(html, { waitUntil: 'load', timeout });
  let info: any = {};
  if (kind === 'print') {
    await page.waitForFunction(() => (window as any).__SD_PAGED, null, { timeout });
    info = await page.evaluate(() => (window as any).__SD_PAGED);
    if (info.error) throw new Error('Pagination impossible : ' + info.error);
  } else if (kind === 'slides') {
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout });
    info = await page.evaluate(() => ({ count: (window as any).SD.count, overflows: (window as any).SD.overflows() }));
  } else {
    await page.evaluate(() => document.fonts.ready);
  }
  return { page, info };
}

export async function htmlToPdf(html: string, kind: Exclude<Kind, 'reading'> | 'reading'): Promise<{ pdf: Buffer; info: any }> {
  const { page, info } = await loadDocument(html, kind);
  try {
    if (kind === 'reading') await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, format: kind === 'reading' ? 'A4' : undefined, margin: kind === 'reading' ? { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' } : undefined, tagged: true, outline: true } as any);
    return { pdf, info };
  } finally {
    await page.close();
  }
}

export async function screenshot(html: string, kind: Kind, opts: { width?: number; height?: number; fullPage?: boolean; slide?: number } = {}): Promise<Buffer> {
  const { page } = await loadDocument(html, kind, { width: opts.width || 1280, height: opts.height || 900 });
  try {
    if (kind === 'slides' && opts.slide !== undefined) await page.evaluate(n => (window as any).SD.go(n), opts.slide), await page.waitForTimeout(600);
    return await page.screenshot({ fullPage: !!opts.fullPage });
  } finally {
    await page.close();
  }
}
