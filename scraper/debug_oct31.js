import 'dotenv/config';
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const OUTBOUND = '2026-10-31';
const RETURN   = '2026-11-22';

async function clickDay(page, dateStr) {
  for (let i = 0; i < 8; i++) {
    const cell = page.locator(`[data-iso="${dateStr}"]`).first();
    if (await cell.isVisible({ timeout: 1000 }).catch(() => false)) { await cell.click(); return; }
    await page.locator('button[aria-label="Next month"]').first().click();
    await page.waitForTimeout(400);
  }
  throw new Error(`Calendar cell not found: ${dateStr}`);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: 'en-US',
  timezoneId: 'America/New_York',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 900 },
});
const page = await context.newPage();

await page.goto('https://www.google.com/travel/flights', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2800);

await page.keyboard.type('PVG', { delay: 80 });
await page.waitForTimeout(1800);
await page.locator('[role="option"]').filter({ hasText: 'PVG' }).first().click();
await page.waitForTimeout(1200);

const origin = page.locator('[aria-label="Where from?"]').first();
await origin.click({ clickCount: 3 });
await page.keyboard.type('JFK', { delay: 80 });
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
await page.waitForTimeout(9000);

const reload = page.getByRole('button', { name: 'Reload' });
if (await reload.isVisible({ timeout: 2000 }).catch(() => false)) {
  await page.waitForTimeout(3000);
  await reload.click();
  await page.waitForTimeout(9000);
}

await page.screenshot({ path: 'data/debug-1-results.png', fullPage: false });
console.log('Screenshot 1: initial results');

// Count all flight rows
const allRows = await page.locator('li.pIav2d').count();
console.log(`Total li.pIav2d rows before filter: ${allRows}`);

// Check for "Other departing flights" before filter
const otherBefore = page.locator('button, [role="button"]').filter({ hasText: /Other departing flights/i }).first();
console.log(`"Other departing flights" visible before filter: ${await otherBefore.isVisible({ timeout: 1000 }).catch(() => false)}`);

// ── Apply Cathay filter ───────────────────────────────────────────────────────
const airlinesBtn = page.locator('button').filter({ hasText: /^Airlines/ }).first();
await airlinesBtn.click();
await page.waitForTimeout(1800);

await page.screenshot({ path: 'data/debug-2-dropdown-open.png', fullPage: false });
console.log('Screenshot 2: dropdown open');

// Wait for Cathay Pacific to be in DOM, then dump its parent chain
await page.waitForTimeout(1000);
const cathayStructure = await page.evaluate(() => {
  // Find the text node containing "Cathay Pacific"
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.textContent?.trim() === 'Cathay Pacific') {
      // Walk up 5 levels and record tag+class+role
      let el = node.parentElement;
      const chain = [];
      for (let i = 0; i < 6 && el; i++) {
        chain.push({
          tag: el.tagName,
          class: el.className?.slice(0, 40),
          role: el.getAttribute('role'),
          text: el.textContent?.trim().slice(0, 80),
          childCount: el.children.length,
        });
        el = el.parentElement;
      }
      return chain;
    }
  }
  return 'text node not found';
});
writeFileSync('data/debug-dropdown.html', JSON.stringify(cathayStructure, null, 2));
console.log('Cathay Pacific DOM chain saved → data/debug-dropdown.html');
console.log(JSON.stringify(cathayStructure, null, 2));

// Log what's visible in dropdown
const visibleAirlines = await page.evaluate(() =>
  [...document.querySelectorAll('li, div[role="listitem"]')]
    .map(el => el.textContent?.trim())
    .filter(t => t && t.length < 60 && /Air|Pacific|Korean|Asiana|Alaska|American/i.test(t))
    .slice(0, 20)
);
console.log('Visible in dropdown:', visibleAirlines);

// Scroll the panel to find Cathay Pacific
const panel = page.locator('div').filter({ hasText: /Select all airlines/ }).last();
let cathayFound = false;
for (let i = 0; i < 12; i++) {
  const cathayText = page.getByText('Cathay Pacific', { exact: true }).first();
  if (await cathayText.isVisible({ timeout: 600 }).catch(() => false)) {
    console.log(`Cathay Pacific found after ${i} scroll(s)`);
    cathayFound = true;
    await page.screenshot({ path: 'data/debug-3-cathay-visible.png', fullPage: false });

    await cathayText.hover({ force: true });
    await page.waitForTimeout(600);
    await page.screenshot({ path: 'data/debug-4-cathay-hover.png', fullPage: false });

    const cathayRow = page.locator('li, div').filter({ hasText: 'Cathay Pacific' }).first();
    const onlyBtn = cathayRow.getByText('Only', { exact: true }).first();
    if (await onlyBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await onlyBtn.click();
      console.log('Clicked "Only" for Cathay Pacific');
    } else {
      await cathayText.click();
      console.log('Clicked Cathay Pacific row (no "Only" button found)');
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2500);
    break;
  }
  const box = await panel.boundingBox().catch(() => null);
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 120);
  }
  await page.waitForTimeout(350);
}

if (!cathayFound) {
  console.log('Cathay Pacific NOT found in dropdown after 12 scrolls');
  await page.screenshot({ path: 'data/debug-3-cathay-not-found.png', fullPage: false });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
}

await page.screenshot({ path: 'data/debug-5-after-filter.png', fullPage: false });
console.log('Screenshot 5: after filter applied');

// Check what chips are showing (active filters)
const chips = await page.evaluate(() =>
  [...document.querySelectorAll('[aria-label*="Cathay"], [aria-label*="filter"], .chip, [data-filterid]')]
    .map(el => el.getAttribute('aria-label') || el.textContent?.trim())
    .filter(Boolean).slice(0, 10)
);
console.log('Active filter chips:', chips);

// Expand "Other departing flights"
const otherSection = page.locator('button, [role="button"]').filter({ hasText: /Other departing flights/i }).first();
const otherVisible = await otherSection.isVisible({ timeout: 2000 }).catch(() => false);
console.log(`"Other departing flights" visible after filter: ${otherVisible}`);
if (otherVisible) {
  await otherSection.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'data/debug-6-other-expanded.png', fullPage: false });
  console.log('Screenshot 6: Other departing flights expanded');
}

// Count and inspect Cathay rows
const cathayRows = page.locator('li.pIav2d').filter({ hasText: 'Cathay Pacific' });
const count = await cathayRows.count();
console.log(`\nCathay Pacific rows after filter: ${count}`);

for (let i = 0; i < count; i++) {
  const row = cathayRows.nth(i);
  const text = (await row.innerText().catch(() => '')).trim();
  const short = text.replace(/\n+/g, ' | ').slice(0, 200);
  console.log(`  Row ${i + 1} (${text.length} chars): ${short}`);

  // Expand to get flight numbers
  const btn = row.locator('button').last();
  await btn.click().catch(() => {});
  await page.waitForTimeout(1500);
  const expanded = await row.innerText().catch(() => '');
  const flightNums = [...new Set(expanded.match(/CX\s*\d{3,4}/g) || [])];
  console.log(`    Flight numbers: ${flightNums.join(', ') || 'none'}`);
  await btn.click().catch(() => {});
  await page.waitForTimeout(400);
}

// Also dump full page text around "1:55" to see if CX843 is anywhere
const pageText = await page.evaluate(() => document.body.innerText);
const cx843lines = pageText.split('\n').filter(l => /1:55|CX.?843|CX843/i.test(l));
console.log(`\nLines containing "1:55" or "CX843": ${cx843lines.length}`);
cx843lines.slice(0, 10).forEach(l => console.log(' ', l.trim()));

writeFileSync('data/debug-page-text.txt', pageText);
console.log('\nFull page text saved → data/debug-page-text.txt');

await browser.close();
