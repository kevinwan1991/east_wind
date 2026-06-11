import 'dotenv/config';
import { chromium } from 'playwright';

const OUTBOUND = '2026-10-24';
const RETURN   = '2026-11-15';

async function clickDay(page, dateStr) {
  for (let i = 0; i < 8; i++) {
    const cell = page.locator(`[data-iso="${dateStr}"]`).first();
    if (await cell.isVisible({ timeout: 1000 }).catch(() => false)) {
      await cell.click();
      return;
    }
    await page.locator('button[aria-label="Next month"]').first().click();
    await page.waitForTimeout(400);
  }
  throw new Error(`Calendar cell not found for ${dateStr}`);
}

const browser = await chromium.launch({ headless: false, slowMo: 150 });
const page    = await browser.newPage();
await page.setViewportSize({ width: 1280, height: 900 });

await page.goto('https://www.google.com/travel/flights', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

await page.keyboard.type('PVG', { delay: 100 });
await page.waitForTimeout(1800);
await page.locator('[role="option"]').filter({ hasText: 'PVG' }).first().click();
await page.waitForTimeout(1200);

const origin = page.locator('[aria-label="Where from?"]').first();
await origin.click({ clickCount: 3 });
await page.keyboard.type('JFK', { delay: 100 });
await page.waitForTimeout(1800);
await page.locator('[role="option"]').filter({ hasText: 'JFK' }).first().click();
await page.waitForTimeout(1200);

for (const input of await page.locator('[aria-label="Departure"]').all()) {
  if (await input.isVisible()) { await input.click(); break; }
}
await page.waitForTimeout(1000);
await clickDay(page, OUTBOUND);
await page.waitForTimeout(500);
await clickDay(page, RETURN);
await page.waitForTimeout(500);
const done = page.getByRole('button', { name: 'Done' }).last();
if (await done.isVisible({ timeout: 2000 }).catch(() => false)) await done.click();
else await page.keyboard.press('Escape');
await page.waitForTimeout(800);

await page.locator('button[aria-label="Search"]').first().click();
await page.waitForTimeout(8000);
const reload = page.getByRole('button', { name: 'Reload' });
if (await reload.isVisible({ timeout: 2000 }).catch(() => false)) { await reload.click(); await page.waitForTimeout(8000); }

// Click "Other departing flights" section to expand it
const otherSection = page.locator('button, [role="button"]').filter({ hasText: 'Other departing flights' }).first();
if (await otherSection.isVisible({ timeout: 3000 }).catch(() => false)) {
  await otherSection.click();
  await page.waitForTimeout(2000);
  console.log('Expanded Other departing flights section\n');
}
await page.screenshot({ path: 'data/snap-oct24-other.png' });

// Check page for 1:55
const pageText = await page.evaluate(() => document.body.innerText);
const cx843lines = pageText.split('\n').filter(l => /1:55|CX.?843/.test(l));
console.log('CX843 / 1:55 lines:', cx843lines.slice(0, 10));

// Find ALL Cathay Pacific rows and expand each one
const cathayRows = page.locator('li.pIav2d').filter({ hasText: 'Cathay Pacific' });
const count = await cathayRows.count();
console.log(`Found ${count} Cathay Pacific row(s)\n`);

for (let i = 0; i < count; i++) {
  const row = cathayRows.nth(i);
  const rowText = (await row.innerText()).trim();
  if (rowText.length > 300) continue; // skip already-expanded duplicates

  const depTime = rowText.split('\n')[0].trim();
  const price   = rowText.match(/\$([0-9,]+)/)?.[0] ?? 'n/a';

  // Expand to get flight number
  await row.locator('button').last().click();
  await page.waitForTimeout(2000);
  const expandedText = await row.innerText().catch(() => '');
  const flightNums = [...new Set(expandedText.match(/CX\s*\d{3,4}/g) || [])];

  console.log(`Row ${i + 1}: dep ${depTime}  price ${price}  flights: ${flightNums.join(', ') || 'none found'}`);

  // Collapse
  await row.locator('button').last().click().catch(() => {});
  await page.waitForTimeout(500);
}

await page.screenshot({ path: 'data/snap-oct24.png' });
await browser.close();
