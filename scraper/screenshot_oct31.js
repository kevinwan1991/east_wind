import 'dotenv/config';
import { chromium } from 'playwright';

const wait = (ms) => new Promise(r => setTimeout(r, ms + Math.random() * ms * 0.3));

async function humanType(page, text) {
  for (const ch of text) {
    await page.keyboard.type(ch);
    await wait(60 + Math.random() * 80);
  }
}

async function humanClick(page, locator) {
  const box = await locator.boundingBox({ timeout: 5000 }).catch(() => null);
  if (box) {
    await page.mouse.move(
      box.x + box.width  * (0.25 + Math.random() * 0.5),
      box.y + box.height * (0.25 + Math.random() * 0.5),
      { steps: 6 }
    );
    await wait(100);
  }
  await locator.click();
}

async function clickDay(page, dateStr) {
  for (let i = 0; i < 8; i++) {
    const cell = page.locator(`[data-iso="${dateStr}"]`).first();
    if (await cell.isVisible({ timeout: 1000 }).catch(() => false)) {
      await humanClick(page, cell);
      return;
    }
    await humanClick(page, page.locator('button[aria-label="Next month"]').first());
    await wait(500);
  }
  throw new Error(`Calendar cell not found: ${dateStr}`);
}

const browser = await chromium.launch({
  headless: false,
  args: ['--lang=en-US'],
});
const context = await browser.newContext({
  locale: 'en-US',
  timezoneId: 'America/New_York',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 900 },
});
const page = await context.newPage();

const outbound   = '2026-10-31';
const returnDate = '2026-11-22';

await page.goto('https://www.google.com/travel/flights', { waitUntil: 'domcontentloaded' });
await wait(3000);

// Click the destination "Where to?" field first
const destInput = page.locator('[aria-label="Where to?"]').first();
if (await destInput.isVisible({ timeout: 3000 }).catch(() => false)) {
  await humanClick(page, destInput);
} else {
  await humanClick(page, page.locator('[placeholder="Where to?"]').first());
}
await wait(800);
await humanType(page, 'PVG');
await wait(2000);
await humanClick(page, page.locator('[role="option"]').filter({ hasText: 'PVG' }).first());
await wait(1300);

const originInput = page.locator('[aria-label="Where from?"]').first();
await originInput.click({ clickCount: 3 });
await humanType(page, 'JFK');
await wait(1800);
await humanClick(page, page.locator('[role="option"]').filter({ hasText: 'JFK' }).first());
await wait(1300);

for (const input of await page.locator('[aria-label="Departure"]').all()) {
  if (await input.isVisible()) { await humanClick(page, input); break; }
}
await wait(1100);
await clickDay(page, outbound);
await wait(600);
await clickDay(page, returnDate);
await wait(600);

const done = page.getByRole('button', { name: 'Done' }).last();
if (await done.isVisible({ timeout: 2000 }).catch(() => false)) await humanClick(page, done);
else await page.keyboard.press('Escape');
await wait(900);

await humanClick(page, page.locator('button[aria-label="Search"]').first());
await wait(9000);

// Screenshot 1: raw results before any filter
await page.screenshot({ path: 'data/oct31_step1_raw.png', fullPage: false });
console.log('Screenshot 1: raw results');

// Expand "Other departing flights"
const other = page.locator('button, [role="button"]').filter({ hasText: /Other departing flights/i }).first();
const otherVisible = await other.isVisible({ timeout: 3000 }).catch(() => false);
console.log(`"Other departing flights" button visible: ${otherVisible}`);
if (otherVisible) {
  await humanClick(page, other);
  await wait(3000);
}

// Screenshot 2: after expanding "Other departing flights"
await page.screenshot({ path: 'data/oct31_step2_expanded.png', fullPage: false });
console.log('Screenshot 2: after expanding Other departing flights');

// Log all li.pIav2d row text so we can see what's there
const rows = await page.evaluate(() =>
  [...document.querySelectorAll('li.pIav2d')]
    .map((r, i) => `[${i}] ${r.innerText.trim().replace(/\n+/g, ' | ').slice(0, 250)}`)
);
console.log('\n--- All flight rows ---');
rows.forEach(r => console.log(r));
console.log('---\n');

await wait(2000);
await browser.close();
