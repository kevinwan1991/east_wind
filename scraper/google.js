import 'dotenv/config';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

// ── Cookie injection ──────────────────────────────────────────────────────────

const COOKIE_FILE = 'cookies/google.json';

function refreshCookies() {
  try {
    execSync('python3 scraper/refresh_cookies.py', { stdio: 'inherit' });
  } catch (e) {
    console.warn('  [cookies] auto-refresh failed:', e.message);
  }
}

function loadCookies() {
  if (!existsSync(COOKIE_FILE)) return [];
  try {
    const raw = JSON.parse(readFileSync(COOKIE_FILE, 'utf8'));
    const sameSiteMap = { no_restriction: 'None', lax: 'Lax', strict: 'Strict' };
    return raw
      .filter(c => c.name && c.value)
      .map(c => ({
        name:     c.name,
        value:    c.value,
        domain:   c.domain,
        path:     c.path || '/',
        expires:  c.expires ?? c.expirationDate ?? c.expiry ?? -1,
        httpOnly: c.httpOnly ?? false,
        secure:   c.secure ?? false,
        sameSite: sameSiteMap[(c.sameSite || '').toLowerCase()] ?? 'Lax',
      }));
  } catch (e) {
    console.warn(`  [cookies] failed to load ${COOKIE_FILE}:`, e.message);
    return [];
  }
}

refreshCookies();
const SAVED_COOKIES = loadCookies();
if (SAVED_COOKIES.length > 0) console.log(`[cookies] loaded ${SAVED_COOKIES.length} cookies from ${COOKIE_FILE}`);

chromium.use(StealthPlugin());

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

  // Hover over "Cathay Pacific" row to reveal its "Only" button, then click
  // the nearest "Only" by screen coordinates. This avoids clicking Air Canada's
  // "Only" (alphabetically first in the DOM) or accidentally deselecting Cathay.
  const cathayText = page.getByText('Cathay Pacific', { exact: true }).first();
  if (!await cathayText.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('  [filter] Cathay Pacific not visible in panel');
    await page.keyboard.press('Escape');
    return false;
  }

  await cathayText.hover({ force: true });
  await wait(700);

  const coords = await page.evaluate(() => {
    const cathayEl = [...document.querySelectorAll('*')].find(
      el => el.childElementCount === 0 && el.textContent?.trim() === 'Cathay Pacific'
    );
    if (!cathayEl) return null;
    const cRect = cathayEl.getBoundingClientRect();
    const onlyEls = [...document.querySelectorAll('*')].filter(
      el => el.childElementCount === 0 && el.textContent?.trim() === 'Only'
    );
    const candidates = onlyEls.map(el => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, dist: Math.hypot(r.left - cRect.left, r.top - cRect.top) };
    }).sort((a, b) => a.dist - b.dist);
    return candidates[0] ?? null;
  });

  if (!coords) {
    console.log('  [filter] "Only" button not found near Cathay Pacific');
    await page.keyboard.press('Escape');
    return false;
  }

  console.log(`  [filter] clicking "Only" at dist=${Math.round(coords.dist)}px`);
  await page.mouse.move(coords.x, coords.y, { steps: 4 });
  await wait(150);
  await page.mouse.click(coords.x, coords.y);
  await wait(600);  // let the filter register before closing the panel
  await page.keyboard.press('Escape');
  await wait(4000); // wait for filtered results to re-render
  return true;
}

// ── Per-search logic ──────────────────────────────────────────────────────────

async function runSearch(page, outbound, returnDate) {
  // Land on google.com first — looks like a natural visit, not a direct bot jump
  await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded' });
  await wait(jitter(2200));

  await page.goto('https://www.google.com/travel/flights', { waitUntil: 'domcontentloaded' });
  await wait(2800);

  // Destination — try several possible aria-labels Google Flights uses
  let destInput = null;
  for (const sel of [
    '[aria-label="Where to?"]',
    '[aria-label="Destination"]',
    'input[aria-label*="where to" i]',
    'input[aria-label*="destination" i]',
    'input[placeholder*="where to" i]',
    'input[placeholder*="destination" i]',
  ]) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
      destInput = loc;
      console.log(`  [dest] found with selector: ${sel}`);
      break;
    }
  }
  if (!destInput) {
    await page.screenshot({ path: `data/diag_noinput_${outbound}.png` }).catch(() => {});
    throw new Error('Could not find destination input — screenshot saved');
  }
  await humanClick(page, destInput);
  await wait(jitter(600));
  await humanType(page, 'Shanghai');
  await wait(2000);
  await humanClick(page, page.locator('[role="option"]').filter({ hasText: /PVG|Pudong|Shanghai/i }).first());
  await wait(jitter(1300));

  // Origin JFK
  let originInput = null;
  for (const sel of [
    '[aria-label="Where from?"]',
    '[aria-label="Origin"]',
    'input[aria-label*="where from" i]',
    'input[aria-label*="origin" i]',
  ]) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
      originInput = loc;
      console.log(`  [orig] found with selector: ${sel}`);
      break;
    }
  }
  if (!originInput) throw new Error('Could not find origin input');
  await humanClick(page, originInput);
  await wait(jitter(400));
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
  await wait(jitter(12000));

  // Handle error page with Reload
  const reload = page.getByRole('button', { name: 'Reload' });
  if (await reload.isVisible({ timeout: 2000 }).catch(() => false)) {
    await wait(jitter(3000));
    await humanClick(page, reload);
    await wait(jitter(12000));
  }

  // Dismiss sign-in overlay if present (press Escape or click close button)
  for (const sel of [
    'button[aria-label*="close" i]',
    'button[aria-label*="dismiss" i]',
    'button[aria-label*="no thanks" i]',
  ]) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await btn.click({ force: true }).catch(() => {});
      console.log(`  [overlay] dismissed via ${sel}`);
      await wait(1500);
      break;
    }
  }
  await page.keyboard.press('Escape');
  await wait(2000);

  // Diagnostic: screenshot + URL if still 0 rows
  const _diagCount = await page.locator('li.pIav2d').count().catch(() => -1);
  console.log(`  [diag] rows=${_diagCount}  url=${page.url().slice(0, 80)}`);
  if (_diagCount === 0) {
    await page.screenshot({ path: `data/diag_${outbound}.png`, fullPage: false }).catch(() => {});
    console.log(`  [diag] screenshot saved to data/diag_${outbound}.png`);
  }

  // Scroll down naturally before reading results
  await page.mouse.wheel(0, 300 + Math.random() * 300);
  await wait(jitter(900));
  await page.mouse.wheel(0, 200 + Math.random() * 200);
  await wait(jitter(600));

  // Snapshot cheapest from current DOM — do this before any further page interactions
  const rawRows = await page.evaluate(() =>
    [...document.querySelectorAll('li.pIav2d')]
      .map(r => r.innerText.trim().replace(/\n+/g, ' | ').slice(0, 300))
      .filter(t => /\$\d/.test(t) && t.length < 200)
  );
  const cheapest = rawRows.reduce((min, r) => {
    const p = parsePrice(r);
    return (p && (!min || p < min.price)) ? { price: p, details: r } : min;
  }, null);

  // Apply Cathay Pacific "Only" filter to reduce rows before expanding
  const filtered = await applyCathayFilter(page);
  if (!filtered) console.log('  [filter] skipped — scanning all rows');

  // Scan every compact row for CX843
  let cx843 = null;
  try {
    const allRowLocators = page.locator('li.pIav2d');
    const total = await allRowLocators.count();
    console.log(`  [scan] ${total} total row(s)`);
    for (let i = 0; i < total; i++) {
      const row     = allRowLocators.nth(i);
      const rowText = await row.innerText().catch(() => '');
      if (rowText.length > 300) continue; // skip already-expanded duplicates
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

const HEADLESS = process.env.HEADLESS !== 'false' ? true : false;
const browser = await chromium.launch({
  channel:  'chrome',   // real Chrome, not bundled Chromium
  headless: HEADLESS,
  args: [
    '--lang=en-US',
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--no-default-browser-check',
  ],
});

// Viewport sizes to rotate through so each session looks slightly different
const VIEWPORTS = [
  { width: 1280, height: 900 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 800 },
];

// Load existing results if available, merge new ones in
const outFile = 'data/flights.json';
const results = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : [];

for (let i = 0; i < pairs.length; i++) {
  const { outbound, return: ret } = pairs[i];

  // Fresh context + page for every search — resets cookies, session storage,
  // and browser fingerprint so Google can't track across searches
  const context = await browser.newContext({
    locale:     'en-US',
    timezoneId: 'America/New_York',
    userAgent:  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport:   VIEWPORTS[i % VIEWPORTS.length],
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    },
  });

  // Remove navigator.webdriver explicitly (stealth also does this, belt-and-suspenders)
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  if (SAVED_COOKIES.length > 0) {
    await context.addCookies(SAVED_COOKIES);
  }

  const page = await context.newPage();

  // Human-paced inter-search pause (45–90 seconds) after the first search
  if (i > 0) {
    const delay = 45000 + Math.random() * 45000;
    console.log(`  [pause] waiting ${Math.round(delay / 1000)}s before next search…`);
    await wait(delay);
  }

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

  await context.close();
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
