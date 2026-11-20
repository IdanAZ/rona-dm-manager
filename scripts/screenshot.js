const { createRequire } = require('module');
const req = createRequire('/tmp/puppeteer-tmp/package.json');
const puppeteer = req('puppeteer-core');
const path = require('path');
const fs = require('fs');

const OUT = path.resolve(__dirname, '../screenshots');
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.APP_URL || 'http://127.0.0.1:3000';

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
    await new Promise((r) => setTimeout(r, 400));
    const dest = path.join(OUT, name);
    await page.screenshot({ path: dest, fullPage: false });
    console.log('wrote', dest);
  }

  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.login, .shell, .btn');
  // wait for fonts + mock button to appear
  await page.waitForFunction(() => {
    const btns = [...document.querySelectorAll('button')];
    return btns.some((b) => b.textContent.includes('הדגמה')) || document.querySelector('.shell');
  }, { timeout: 10000 });
  await shot('01-login.png');

  const mockBtn = await page.evaluateHandle(() =>
    [...document.querySelectorAll('button')].find((b) => b.textContent.includes('הדגמה'))
  );
  if (mockBtn && mockBtn.asElement()) {
    await mockBtn.asElement().click();
    await page.waitForSelector('.auto-card, .empty, .shell', { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 500));
  }
  await shot('02-automations.png');

  // Open editor via edit button or FAB
  const editBtn = await page.evaluateHandle(() =>
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'עריכה')
  );
  if (editBtn && editBtn.asElement()) {
    await editBtn.asElement().click();
    await page.waitForSelector('.panel-body', { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 400));
    await shot('03-editor.png');
    // scroll down in the editor to show DM section
    await page.evaluate(() => {
      const body = document.querySelector('.panel-body');
      if (body) body.scrollTop = 700;
    });
    await shot('04-editor-dm.png');
    // close
    const back = await page.$('.panel-bar .icon-btn');
    if (back) await back.click();
    await page.waitForSelector('.shell', { timeout: 8000 });
  }

  // Simulation tab
  const sim = await page.evaluateHandle(() =>
    [...document.querySelectorAll('.nav-btn')].find((b) => b.textContent.includes('סימולציה'))
  );
  if (sim && sim.asElement()) {
    await sim.asElement().click();
    await new Promise((r) => setTimeout(r, 400));
    await shot('05-simulation.png');
    const send = await page.evaluateHandle(() =>
      [...document.querySelectorAll('button')].find((b) => b.textContent.includes('שלחי תגובה מדומה'))
    );
    if (send && send.asElement()) {
      await send.asElement().click();
      await new Promise((r) => setTimeout(r, 800));
      await shot('06-simulation-result.png');
    }
  }

  // Recipients from automations tab
  const autosTab = await page.evaluateHandle(() =>
    [...document.querySelectorAll('.nav-btn')].find((b) => b.textContent.includes('אוטומציות'))
  );
  if (autosTab && autosTab.asElement()) {
    await autosTab.asElement().click();
    await new Promise((r) => setTimeout(r, 400));
    await shot('07-automations-after-sim.png');
    const recs = await page.evaluateHandle(() =>
      [...document.querySelectorAll('button')].find((b) => b.textContent.includes('נמענות'))
    );
    if (recs && recs.asElement()) {
      await recs.asElement().click();
      await page.waitForSelector('.panel', { timeout: 8000 });
      await new Promise((r) => setTimeout(r, 400));
      await shot('08-recipients.png');
    }
  }

  await browser.close();
  console.log('done');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
