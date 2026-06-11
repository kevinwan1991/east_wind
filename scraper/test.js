import 'dotenv/config';
import { chromium } from 'playwright';

const OUTBOUND = '2026-06-13'; // Saturday
const RETURN   = '2026-07-04'; // Saturday +21

const browser = await chromium.launch({ headless: false, slowMo: 150 });
const page    = await browser.newPage();
await page.setViewportSize({ width: 1280, height: 900 });

const snap = (name) => page.screenshot({ path: `data/snap-${name}.png` });

// Click a calendar day by date string (YYYY-MM-DD)
const clickCalendarDay = async (dateStr) => {
  // Google Flights calendar uses data-iso attribute on day cells
  const cell = page.locator(`[data-iso="${dateStr}"]`).first();
  if (await cell.isVisible({ timeout: 5000 }).catch(() => false)) {
    await cell.click();
    console.log(`  clicked calendar day ${dateStr}`);
    return;
  }
  // Fallback: aria-label like "Saturday, June 13, 2026"
  const d = new Date(dateStr + 'T12:00:00');
  const label = d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const fallback = page.locator(`[aria-label="${label}"]`).first();
  if (await fallback.isVisible({ timeout: 3000 }).catch(() => false)) {
    await fallback.click();
    console.log(`  clicked via aria-label: ${label}`);
    return;
  }
  throw new Error(`Could not find calendar cell for ${dateStr}`);
};

console.log('Opening Google Flights…');
await page.goto('https://www.google.com/travel/flights', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

// --- Destination PVG (already focused) ---
console.log('Setting destination: PVG');
await page.keyboard.type('PVG', { delay: 120 });
await page.waitForTimeout(2000);
await page.locator('[role="option"]').filter({ hasText: 'PVG' }).first().click();
await page.waitForTimeout(1500);

// --- Origin: JFK ---
console.log('Setting origin: JFK');
const origin = page.locator('[aria-label="Where from?"]').first();
await origin.click({ clickCount: 3 });
await page.keyboard.type('JFK', { delay: 120 });
await page.waitForTimeout(2000);
await page.locator('[role="option"]').filter({ hasText: 'JFK' }).first().click();
await page.waitForTimeout(1500);
await snap('01-airports-set');

// --- Open the date picker by clicking Departure ---
console.log('Opening date picker…');
for (const input of await page.locator('[aria-label="Departure"]').all()) {
  if (await input.isVisible()) {
    await input.click();
    break;
  }
}
await page.waitForTimeout(1500);
await snap('02-calendar-open');

// --- Click departure date in calendar ---
await clickCalendarDay(OUTBOUND);
await page.waitForTimeout(800);

// --- Click return date in calendar (calendar should still be open) ---
await clickCalendarDay(RETURN);
await page.waitForTimeout(800);
await snap('03-dates-selected');

// --- Click Done to close calendar ---
const done = page.getByRole('button', { name: 'Done' }).last();
if (await done.isVisible({ timeout: 3000 }).catch(() => false)) {
  await done.click();
  console.log('  clicked Done');
} else {
  await page.keyboard.press('Escape');
  console.log('  pressed Escape to close calendar');
}
await page.waitForTimeout(1500);

// --- Search ---
const searchBtn = page.locator('button[aria-label="Search"]').first();
await searchBtn.waitFor({ state: 'visible', timeout: 10000 });
await searchBtn.click();
console.log('Searching — waiting for results…');
await page.waitForTimeout(8000);

// If Google returns an error page, hit Reload
const reloadBtn = page.getByRole('button', { name: 'Reload' });
if (await reloadBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
  console.log('  got error page — clicking Reload');
  await reloadBtn.click();
  await page.waitForTimeout(10000);
}

await snap('04-results');

// --- Extract results ---
// Google Flights results are in <li> elements inside the results list
const flights = await page.evaluate(() => {
  const selectors = ['li.pIav2d', 'li[class*="flight"]', 'div[class*="result"] li', 'li'];
  for (const sel of selectors) {
    const items = [...document.querySelectorAll(sel)]
      .map(r => r.innerText.trim().replace(/\n+/g, ' | ').slice(0, 300))
      .filter(t => /\$\d/.test(t));
    if (items.length > 0) return { sel, items };
  }
  return { sel: 'none', items: [] };
});

console.log(`\nUsed selector: ${flights.sel}`);
console.log(`Found ${flights.items.length} priced result(s):\n`);
flights.items.slice(0, 15).forEach((f, i) => console.log(`[${i + 1}] ${f}`));

const cx = flights.items.filter(f => /843|cathay|cx\b/i.test(f));
console.log(`\nCX843 / Cathay matches: ${cx.length}`);
cx.forEach(f => console.log(' ->', f));

await browser.close();
