import 'dotenv/config';
import { chromium } from 'playwright';

const OUTBOUND = '2026-10-24';
const RETURN   = '2026-11-15';

async function clickDay(page, dateStr) {
  for (let i = 0; i < 8; i++) {
    const cell = page.locator(`[data-iso="${dateStr}"]`).first();
    if (await cell.isVisible({ timeout: 1000 }).catch(() => false)) { await cell.click(); return; }
    await page.locator('button[aria-label="Next month"]').first().click();
    await page.waitForTimeout(400);
  }
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

// Open Airlines dropdown
await page.locator('button').filter({ hasText: /^Airlines/ }).first().click();
await page.waitForTimeout(1500);
await page.screenshot({ path: 'data/filter-open.png' });

// Get the bounding box of the dropdown panel to scroll inside it
const panel = page.locator('div').filter({ hasText: /Select all airlines/ }).last();
const box   = await panel.boundingBox();

if (box) {
  // Move mouse to centre of dropdown, then scroll inside it
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  console.log(`Dropdown box: ${JSON.stringify(box)}`);

  // Scroll inside dropdown until Cathay Pacific is visible
  for (let i = 0; i < 10; i++) {
    const cathay = page.getByText('Cathay Pacific').first();
    if (await cathay.isVisible({ timeout: 500 }).catch(() => false)) {
      console.log('Cathay Pacific visible after scroll', i);
      break;
    }
    await page.mouse.wheel(0, 150);
    await page.waitForTimeout(300);
  }

  await page.screenshot({ path: 'data/filter-cathay-visible.png' });
  console.log('Screenshot saved → data/filter-cathay-visible.png');

  // Click "Only" next to Cathay Pacific
  const cathayRow = page.locator('li, div').filter({ hasText: /Cathay Pacific/ }).first();
  const onlyBtn   = cathayRow.getByText('Only').first();

  if (await onlyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await onlyBtn.click();
    console.log('Clicked Only for Cathay Pacific');
  } else {
    // Click the checkbox/label directly
    await cathayRow.click();
    console.log('Clicked Cathay Pacific row');
  }
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'data/filter-cathay-selected.png' });

  // Close dropdown
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'data/filter-results.png' });
  console.log('Screenshot saved → data/filter-results.png');
} else {
  console.log('Could not find dropdown panel');
}

await page.waitForTimeout(2000);
await browser.close();
