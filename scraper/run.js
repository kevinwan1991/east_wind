import 'dotenv/config';
import { chromium } from 'playwright';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const TRIP_DAYS = 22;

// ── Stealth helpers ───────────────────────────────────────────────────────────

// Random delay with ±40% jitter so timing is never mechanical
const jitter = (base) => base + (Math.random() * 2 - 1) * base * 0.4;
const wait   = (ms)   => new Promise(r => setTimeout(r, jitter(ms)));

// Move mouse to a random point inside an element before clicking
async function humanClick(page, locator) {
  const box = await locator.boundingBox({ timeout: 5000 }).catch(() => null);
  if (box) {
    await page.mouse.move(
      box.x + box.width  * (0.25 + Math.random() * 0.5),
      box.y + box.height * (0.25 + Math.random() * 0.5),
      { steps: 5 + Math.floor(Math.random() * 8) }
    );
    await wait(120);
  }
  await locator.click();
}

// Type with variable per-character delay like a real person
async function humanType(page, text) {
  for (const ch of text) {
    await page.keyboard.type(ch);
    await wait(60 + Math.random() * 80);
  }
}

// Scroll an element into view without using mouse.wheel
async function scrollInto(locator) {
  await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  await wait(300);
}

// ── Date pairs ────────────────────────────────────────────────────────────────

function getDatePairs(from = '2026-09-05', to = '2026-12-31') {
  const pairs  = [];
  const cursor = new Date(from + 'T12:00:00');
  const end    = new Date(to   + 'T12:00:00');
  while (cursor <= end) {
    const outbound = cursor.toISOString().slice(0, 10);
    const ret = new Date(cursor);
    ret.setDate(ret.getDate() + TRIP_DAYS);
    pairs.push({ outbound, return: ret.toISOString().slice(0, 10) });
    cursor.setDate(cursor.getDate() + 7);
  }
  return pairs;
}

function parsePrice(str) {
  const m = str.match(/\$([0-9,]+)/);
  return m ? parseInt(m[1].replace(',', '')) : null;
}

// ── Calendar ──────────────────────────────────────────────────────────────────

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

// ── Expand a row and read flight numbers from that row only ───────────────────

async function getFlightNumbers(page, row) {
  const btn = row.locator('button').last();
  await humanClick(page, btn);
  await wait(2000);
  const text = await row.innerText().catch(() => '');
  await row.locator('button').last().click().catch(() => {});
  await wait(400);
  return [...new Set(text.match(/CX\s*\d{3,4}/g) || [])];
}

// ── Apply Cathay Pacific "Only" filter ────────────────────────────────────────

async function applyCathayFilter(page) {
  const airlinesBtn = page.locator('button').filter({ hasText: /^Airlines/ }).first();
  await humanClick(page, airlinesBtn);
  await wait(1800);

  // ── Approach 1: type "Cathay" in the dropdown search box ─────────────────
  const searchInput = page.locator('input').filter({ hasText: '' }).first();
  const hasSearchBox = await searchInput.isVisible({ timeout: 800 }).catch(() => false);
  if (hasSearchBox) {
    console.log('  [filter] approach 1: typing in search box');
    await humanClick(page, searchInput);
    await humanType(page, 'Cathay');
    await wait(800);
  }

  // ── Approach 2: deselect all, then check only Cathay Pacific ─────────────
  const selectAll = page.getByText('Select all airlines', { exact: true }).first();
  if (await selectAll.isVisible({ timeout: 800 }).catch(() => false)) {
    console.log('  [filter] approach 2: deselect all → check Cathay Pacific');
    await humanClick(page, selectAll); // unchecks all
    await wait(500);
    const cathayCheck = page.getByText('Cathay Pacific', { exact: true }).first();
    if (await cathayCheck.isVisible({ timeout: 1000 }).catch(() => false)) {
      await humanClick(page, cathayCheck); // checks only Cathay
      await page.keyboard.press('Escape');
      await wait(2500);
      return true;
    }
    console.log('  [filter] approach 2: Cathay Pacific not visible after deselect-all');
  }

  // ── Approach 3: hover → click nearest "Only" by screen coordinates ───────
  const panel = page.locator('div').filter({ hasText: /Select all airlines/ }).last();
  for (let i = 0; i < 12; i++) {
    const cathayText = page.getByText('Cathay Pacific', { exact: true }).first();
    if (await cathayText.isVisible({ timeout: 600 }).catch(() => false)) {
      await cathayText.hover({ force: true });
      await wait(600);

      const coords = await page.evaluate(() => {
        const cathayEl = [...document.querySelectorAll('*')].find(
          el => el.childElementCount === 0 && el.textContent?.trim() === 'Cathay Pacific'
        );
        if (!cathayEl) return null;
        const cRect = cathayEl.getBoundingClientRect();
        const onlyEls = [...document.querySelectorAll('*')].filter(
          el => el.childElementCount === 0 && el.textContent?.trim() === 'Only'
        );
        let best = null, minDist = Infinity;
        for (const el of onlyEls) {
          const r = el.getBoundingClientRect();
          const d = Math.hypot(r.left - cRect.left, r.top - cRect.top);
          if (d < minDist && d < 400) { minDist = d; best = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
        }
        return best;
      });

      if (coords) {
        await page.mouse.move(coords.x, coords.y, { steps: 3 });
        await wait(100);
        await page.mouse.click(coords.x, coords.y);
        await page.keyboard.press('Escape');
        await wait(2500);
        return true;
      }
      await humanClick(page, cathayText);
      await page.keyboard.press('Escape');
      await wait(2500);
      return true;
    }
    const box = await panel.boundingBox().catch(() => null);
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, 120);
    }
    await wait(350);
  }
  await page.keyboard.press('Escape');
  return false;
}

// ── Per-search logic ──────────────────────────────────────────────────────────

async function runSearch(page, outbound, returnDate) {
  await page.goto('https://www.google.com/travel/flights', { waitUntil: 'domcontentloaded' });
  await wait(2800);

  // Destination PVG
  await humanType(page, 'PVG');
  await wait(1800);
  await humanClick(page, page.locator('[role="option"]').filter({ hasText: 'PVG' }).first());
  await wait(jitter(1300));

  // Origin JFK
  const originInput = page.locator('[aria-label="Where from?"]').first();
  await originInput.click({ clickCount: 3 });
  await humanType(page, 'JFK');
  await wait(1800);
  await humanClick(page, page.locator('[role="option"]').filter({ hasText: 'JFK' }).first());
  await wait(jitter(1300));

  // Open departure date picker
  for (const input of await page.locator('[aria-label="Departure"]').all()) {
    if (await input.isVisible()) { await humanClick(page, input); break; }
  }
  await wait(jitter(1100));

  await clickDay(page, outbound);
  await wait(jitter(600));
  await clickDay(page, returnDate);
  await wait(jitter(600));

  const done = page.getByRole('button', { name: 'Done' }).last();
  if (await done.isVisible({ timeout: 2000 }).catch(() => false)) await humanClick(page, done);
  else await page.keyboard.press('Escape');
  await wait(jitter(900));

  // Search
  await humanClick(page, page.locator('button[aria-label="Search"]').first());
  await wait(jitter(9000));

  // Handle error page with Reload
  const reload = page.getByRole('button', { name: 'Reload' });
  if (await reload.isVisible({ timeout: 2000 }).catch(() => false)) {
    await wait(jitter(3000)); // pause before retrying
    await humanClick(page, reload);
    await wait(jitter(9000));
  }

  // Record cheapest before applying filter
  const allRows = await page.evaluate(() =>
    [...document.querySelectorAll('li.pIav2d')]
      .map(r => r.innerText.trim().replace(/\n+/g, ' | ').slice(0, 300))
      .filter(t => /\$\d/.test(t) && t.length < 200)
  );
  const cheapest = allRows.reduce((min, r) => {
    const p = parsePrice(r);
    return (p && (!min || p < min.price)) ? { price: p, details: r } : min;
  }, null);

  // Try Cathay-only filter (best effort — wrong click just means more rows to scan)
  let cx843 = null;
  try { await applyCathayFilter(page); } catch (_) {}

  // Always expand "Other departing flights" — CX843 is often hidden there
  try {
    const otherSection = page.locator('button, [role="button"]').filter({ hasText: /Other departing flights/i }).first();
    if (await otherSection.isVisible({ timeout: 2000 }).catch(() => false)) {
      await humanClick(page, otherSection);
      await wait(2000);
    }
  } catch (_) {}

  // Scan all Cathay Pacific rows regardless of whether the filter was applied
  try {
    const cathayRows = page.locator('li.pIav2d').filter({ hasText: 'Cathay Pacific' });
    const count = await cathayRows.count();
    console.log(`  [scan] ${count} Cathay Pacific row(s) visible`);
    for (let i = 0; i < count; i++) {
      const row     = cathayRows.nth(i);
      const rowText = await row.innerText().catch(() => '');
      if (rowText.length > 300) continue;
      try {
        const nums = await getFlightNumbers(page, row);
        if (nums.some(n => n.replace(/\s/, '') === 'CX843')) {
          cx843 = {
            price:      parsePrice(rowText.replace(/\n+/g, ' | ')),
            details:    rowText.trim().replace(/\n+/g, ' | ').slice(0, 200),
            flightNums: nums,
          };
          break;
        }
      } catch (_) {}
    }
  } catch (_) {}

  return { cheapest, cx843 };
}

// ── Main ──────────────────────────────────────────────────────────────────────

// Accept optional date range from env: FROM_DATE / TO_DATE
const FROM = process.env.FROM_DATE ?? '2026-09-05';
const TO   = process.env.TO_DATE   ?? '2026-12-31';

const pairs = getDatePairs(FROM, TO);
console.log(`Scanning ${pairs.length} Saturday pairs ${FROM} → ${TO} (${TRIP_DAYS}-day trips)…\n`);

const browser = await chromium.launch({
  headless: true,
  args: ['--lang=en-US'],
});
const context = await browser.newContext({
  locale:    'en-US',
  timezoneId: 'America/New_York',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  viewport:  { width: 1280, height: 900 },
});
const page = await context.newPage();

// Load existing results if available, merge new ones in
const outFile = 'data/flights.json';
const results = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : [];

for (let i = 0; i < pairs.length; i++) {
  const { outbound, return: ret } = pairs[i];

  // Inter-search human pause (5–12 seconds)
  if (i > 0) await wait(7000 + Math.random() * 5000);

  try {
    const data = await runSearch(page, outbound, ret);
    const idx = results.findIndex(r => r.outbound === outbound);
    const prev = idx >= 0 ? results[idx] : null;
    const entry = {
      outbound, return: ret,
      cheapest: data.cheapest ?? prev?.cheapest ?? null,
      cx843:    data.cx843    ?? prev?.cx843    ?? null,
    };
    if (idx >= 0) results[idx] = entry; else results.push(entry);

    const cheapStr = entry.cheapest ? `$${entry.cheapest.price.toLocaleString()}` : 'n/a';
    const cx843Str = entry.cx843    ? `$${entry.cx843.price?.toLocaleString()}`   : '—';
    console.log(`[${i + 1}/${pairs.length}] ${outbound} → ${ret}   cheapest ${cheapStr}   CX843 ${cx843Str}`);
  } catch (err) {
    console.error(`[${i + 1}/${pairs.length}] ${outbound} ERROR: ${err.message.slice(0, 80)}`);
    const idx = results.findIndex(r => r.outbound === outbound);
    if (idx < 0) results.push({ outbound, return: ret, cheapest: null, cx843: null, error: err.message });
  }
  writeFileSync(outFile, JSON.stringify(results, null, 2));
}

await browser.close();

// ── Summary table ─────────────────────────────────────────────────────────────
const sorted = [...results].sort((a, b) => a.outbound.localeCompare(b.outbound));
console.log('\n' + '═'.repeat(82));
console.log('  DEPART        RETURN         CHEAPEST     AIRLINE              CX843');
console.log('─'.repeat(82));
for (const r of sorted) {
  if (r.error) { console.log(`  ${r.outbound}    ${r.return}     ERROR`); continue; }
  const cheapPrice = r.cheapest ? `$${r.cheapest.price.toLocaleString()}` : 'n/a';
  const cheapAir   = r.cheapest ? (r.cheapest.details.split('|')[3]?.trim() ?? '?').slice(0, 18) : '';
  const cx843Price = r.cx843    ? `$${r.cx843.price?.toLocaleString()}` : '—';
  const diff       = (r.cx843 && r.cheapest) ? ` (+$${(r.cx843.price - r.cheapest.price).toLocaleString()})` : '';
  console.log(`  ${r.outbound}    ${r.return}     ${cheapPrice.padEnd(8)}   ${cheapAir.padEnd(20)} ${cx843Price}${diff}`);
}
console.log('═'.repeat(82));
console.log(`\nSaved → ${outFile}`);
