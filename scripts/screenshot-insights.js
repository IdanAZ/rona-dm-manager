const { createRequire } = require('module');
const req = createRequire('/tmp/puppeteer-tmp/package.json');
const puppeteer = req('puppeteer-core');
const path = require('path');
const fs = require('fs');

const OUT = process.env.SHOT_DIR || '/workspace/screens';
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.APP_URL || 'http://127.0.0.1:3055';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none'],
    defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  });
  const page = await browser.newPage();
  await page.emulateTimezone('Asia/Jerusalem');
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'he-IL,he,en' });

  async function shot(name) {
    await new Promise((r) => setTimeout(r, 500));
    const dest = path.join(OUT, name);
    await page.screenshot({ path: dest, fullPage: false });
    console.log('wrote', dest);
  }

  async function clickNav(label) {
    await page.waitForFunction((lab) => [...document.querySelectorAll('.nav-btn')].some((b) => b.textContent.includes(lab)), { timeout: 10000 }, label);
    await page.evaluate((lab) => {
      const btn = [...document.querySelectorAll('.nav-btn')].find((b) => b.textContent.includes(lab));
      if (btn) btn.click();
    }, label);
    await new Promise((r) => setTimeout(r, 700));
  }

  await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForFunction(() => {
    const btns = [...document.querySelectorAll('button')];
    return btns.some((b) => b.textContent.includes('הדגמה')) || document.querySelector('.shell');
  }, { timeout: 15000 });

  const mockBtn = await page.evaluateHandle(() =>
    [...document.querySelectorAll('button')].find((b) => b.textContent.includes('הדגמה'))
  );
  if (mockBtn && mockBtn.asElement()) {
    await mockBtn.asElement().click();
    await page.waitForSelector('.shell', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 600));
  }

  await clickNav('נתונים');
  await page.waitForFunction(() => document.querySelector('.ins-hero, .summary-card, .metric-tile'), { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 800));
  await shot('01-insights-trends.png');

  await page.evaluate(() => {
    const el = document.querySelector('.ins-section h3');
    const all = [...document.querySelectorAll('.ins-section')];
    const ww = all.find((s) => s.querySelector('h3') && s.querySelector('h3').textContent.includes('מה עובד'));
    if (ww) ww.scrollIntoView({ block: 'start' });
    else window.scrollTo(0, 520);
  });
  await shot('02-insights-what-works.png');

  await page.evaluate(() => {
    const all = [...document.querySelectorAll('.ins-section')];
    const part = all.find((s) => s.textContent.includes('שיתופי פעולה'));
    if (part) part.scrollIntoView({ block: 'start' });
  });
  await shot('03-insights-partners.png');

  await clickNav('העוזרת');
  await page.waitForSelector('.assistant-page', { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 400));

  await page.type('.chat-composer textarea', 'השהי את האוטומציה קורס הכנה ללידה');
  await page.evaluate(() => {
    const form = document.querySelector('.chat-composer');
    if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => document.querySelector('.proposal-card'), { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 400));
  await shot('04-assistant.png');

  await browser.close();
  console.log('done');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
