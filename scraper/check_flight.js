import 'dotenv/config';
import { chromium } from 'playwright';

const OUTBOUND = '2026-09-05';
const RETURN   = '2026-09-26';

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

// PVG destination
await page.keyboard.type('PVG', { delay: 100 });
await page.waitForTimeout(1800);
await page.locator('[role="option"]').filter({ hasText: 'PVG' }).first().click();
await page.waitForTimeout(1200);

// JFK origin
const origin = page.locator('[aria-label="Where from?"]').first();
await origin.click({ clickCount: 3 });
await page.keyboard.type('JFK', { delay: 100 });
await page.waitForTimeout(1800);
await page.locator('[role="option"]').filter({ hasText: 'JFK' }).first().click();
await page.waitForTimeout(1200);

// Dates
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
await page.waitForTimeout(800);

// Search
await page.locator('button[aria-label="Search"]').first().click();
await page.waitForTimeout(8000);
const reload = page.getByRole('button', { name: 'Reload' });
if (await reload.isVisible({ timeout: 2000 }).catch(() => false)) { await reload.click(); await page.waitForTimeout(8000); }

// Find Cathay Pacific row — click the details chevron, not the row itself
console.log('Looking for Cathay Pacific result…');
const cathayRow = page.locator('li.pIav2d').filter({ hasText: 'Cathay Pacific' }).first();
await cathayRow.waitFor({ state: 'visible', timeout: 10000 });

// The expand chevron is a button inside the row (aria-label contains "details" or similar)
const expandBtn = cathayRow.locator('button').last();
await expandBtn.click();
await page.waitForTimeout(3000);

await page.screenshot({ path: 'data/snap-cx-expanded.png' });

// Grab all text that looks like a flight number from the whole page
const allText = await page.evaluate(() => document.body.innerText);
const flightNums = [...new Set(allText.match(/CX\s*\d{3,4}/g) || [])];
console.log('Flight numbers found on page:', flightNums);

// Print anything that contains CX + numbers in context
const lines = allText.split('\n').filter(l => /CX\s*\d{3}/.test(l));
console.log('\nLines with flight numbers:');
lines.forEach(l => console.log(' ', l.trim()));

await browser.close();
