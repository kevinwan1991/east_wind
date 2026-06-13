import 'dotenv/config';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { writeFileSync, readFileSync, existsSync } from 'fs';

chromium.use(StealthPlugin());

const TRIP_DAYS = 22;
const DATA_FILE = 'data/flights.json';

const wait = (ms) => new Promise(r => setTimeout(r, ms + (Math.random() * 2 - 1) * ms * 0.25));

// ── Date pairs ────────────────────────────────────────────────────────────────

function getDatePairs(from, to) {
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

// ── Helpers ───────────────────────────────────────────────────────────────────

async function humanClick(page, locator) {
  const box = await locator.boundingBox({ timeout: 5000 }).catch(() => null);
  if (box) {
    await page.mouse.move(
      box.x + box.width  * (0.3 + Math.random() * 0.4),
      box.y + box.height * (0.3 + Math.random() * 0.4),
      { steps: 5 + Math.floor(Math.random() * 6) }
    );
    await wait(100);
  }
  await locator.click({ force: true });
}

async function dismissOverlays(page) {
  for (const sel of [
    '[class*="signin-popup"] button[aria-label*="close" i]',
    '[class*="signin-popup"] button[class*="close"]',
    '[class*="modal"] button[aria-label*="close" i]',
    'button[aria-label="Close"]',
  ]) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
      await btn.click({ force: true }).catch(() => {});
      await wait(600);
      return;
    }
  }
}

// ── Fill origin or destination ────────────────────────────────────────────────

async function fillOD(page, attrValue, searchText, optionPattern) {
  const sel = `[aria-controls="${attrValue}"]`;

  const targetIdx = await page.evaluate((s) => {
    const all = [...document.querySelectorAll(s)];
    let best = 0, bestY = Infinity;
    all.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.y < bestY) { bestY = r.y; best = i; }
    });
    return best;
  }, sel);

  await page.locator(sel).nth(targetIdx).scrollIntoViewIfNeeded().catch(() => {});
  await wait(400);

  await page.evaluate(({ s, idx }) => {
    const inp = [...document.querySelectorAll(s)][idx];
    if (!inp) return;
    inp.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    inp.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true }));
    inp.dispatchEvent(new MouseEvent('click',     { bubbles: true }));
    inp.focus();
  }, { s: sel, idx: targetIdx });
  await wait(800);

  await page.keyboard.press('Control+a');
  for (const ch of searchText) {
    await page.keyboard.type(ch);
    await wait(60 + Math.random() * 60);
  }
  await wait(2000);

  const opt = page.locator(
    '[id*="ODOverlayList"] li, [class*="ODOverlay"] li, [class*="odOverlay"] li, [role="option"]'
  ).filter({ hasText: optionPattern }).first();

  if (await opt.isVisible({ timeout: 3000 }).catch(() => false)) {
    await humanClick(page, opt);
  } else {
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
  }
  await wait(800);
}

// ── Navigate calendar to a month and click a day ─────────────────────────────

async function pickDate(page, dateStr) {
  const target    = new Date(dateStr + 'T12:00:00');
  const monthName = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'][target.getMonth()];
  const yearStr   = String(target.getFullYear());
  const dayNum    = String(target.getDate());

  const cal     = page.locator('.c-calendar.-range').first();
  const nextBtn = page.locator('.c-calendar__next').first();

  for (let i = 0; i < 18; i++) {
    const calText = await cal.innerText().catch(() => '');
    if (calText.includes(monthName) && calText.includes(yearStr)) break;
    if (!await nextBtn.isVisible({ timeout: 800 }).catch(() => false)) break;
    await humanClick(page, nextBtn);
    await wait(700);
  }

  const dayEl = page.locator(`[aria-label*="${monthName} ${dayNum}, ${yearStr}"]`).first();
  if (await dayEl.count() === 0) throw new Error(`Calendar cell not found for ${dateStr}`);
  await dayEl.click({ force: true, timeout: 5000 });
  await wait(700);
}

// ── Core: navigate → queue → histogram API ────────────────────────────────────

async function fetchPrice(page, outbound, returnDate) {
  await page.goto('https://www.cathaypacific.com/cx/en_US.html', { waitUntil: 'domcontentloaded' });
  await wait(4000);

  // Cookie banner
  const cookieBtn = page.locator('button').filter({ hasText: /accept all|accept cookies/i }).first();
  if (await cookieBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await humanClick(page, cookieBtn);
    await wait(800);
  }

  await dismissOverlays(page);
  await wait(500);
  await dismissOverlays(page);

  // Origin & destination
  await fillOD(page, 'bookTripPanel__origin__ODOverlayList',      'JFK',      /JFK|John F/i);
  await dismissOverlays(page);
  await fillOD(page, 'bookTripPanel__destination__ODOverlayList', 'Shanghai', /PVG|Pudong|Shanghai/i);

  // Open date picker
  const calBtn = page.locator('button[aria-label="Calendar"]').filter({ hasText: /Departing on/i }).first();
  const anyCalBtn = page.locator('button[aria-label="Calendar"][class*="range"]').first();
  const trigger = await calBtn.isVisible({ timeout: 2000 }).catch(() => false) ? calBtn : anyCalBtn;
  await humanClick(page, trigger);
  await wait(2500);

  // Pick departure and return dates
  await pickDate(page, outbound);
  await wait(800);
  await pickDate(page, returnDate);
  await wait(1000);

  // Confirm dates (Done button)
  const doneBtn = page.locator('button').filter({ hasText: /done/i }).last();
  if (await doneBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
    await humanClick(page, doneBtn);
  }
  await wait(600);
  await page.keyboard.press('Escape');
  await wait(400);

  // Search
  const searchBtn = page.locator('button').filter({ hasText: /search flights?/i }).first();
  await searchBtn.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  const clicked = await searchBtn.click({ force: true, timeout: 8000 }).then(() => true).catch(() => false);
  if (!clicked) {
    await page.evaluate(() => {
      [...document.querySelectorAll('button')]
        .find(b => /search flights?/i.test(b.textContent?.trim()))
        ?.click();
    });
  }

  // Wait for queue to clear and arrive at book.cathaypacific.com
  console.log('  waiting for queue…');
  for (let w = 0; w < 36; w++) {
    await wait(5000);
    const url = page.url();
    if (url.includes('queue.cathaypacific.com')) {
      const confirmBtn = page.locator('button, a').filter({ hasText: /confirm|proceed|continue|enter/i }).first();
      if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await humanClick(page, confirmBtn);
      } else {
        console.log(`  queue… ${w * 5}s`);
      }
    } else if (url.includes('book.cathaypacific.com') || url.includes('cathaypacific.com/wdsibe')) {
      await wait(2000);
      break;
    }
  }

  // Call histogram API from within the page context (uses queue session cookies)
  const dep = outbound.replace(/-/g, '');
  const ret = returnDate.replace(/-/g, '');

  const result = await page.evaluate(async ({ dep, ret }) => {
    const base = 'https://book.cathaypacific.com/CathayPacificV3/dyn/air/api/instant/histogram';

    // Primary: per-departure-date histogram
    const r1 = await fetch(
      `${base}?ORIGIN=NYC&DESTINATION=SHA&DEPT_DATE=${dep}&LANGUAGE=GB&TYPE=DEPT_DATE&SITE=CBEUCBEU&CABIN=Y`,
      { credentials: 'include' }
    );
    if (r1.ok) {
      const json = await r1.json();
      const entry = json.find(e => e.date_return === ret);
      return entry ? { price: Math.round(entry.total_fare), base_fare: entry.base_fare } : { error: 'return date not in response' };
    }

    // Fallback: monthly histogram (handles returns that cross into a new year)
    const month = parseInt(dep.slice(4, 6), 10);
    const r2 = await fetch(
      `${base}?ORIGIN=NYC&DESTINATION=SHA&LANGUAGE=GB&SITE=CBEUCBEU&TYPE=DAY&MONTH=${month}&CABIN=Y&TRIP_TYPE=R`,
      { credentials: 'include' }
    );
    if (!r2.ok) return { error: r2.status };
    const json2 = await r2.json();
    const entry2 = json2.find(e => e.date_departure === dep);
    return entry2 ? { price: Math.round(entry2.total_fare), base_fare: entry2.base_fare } : { error: 'departure date not in monthly response' };
  }, { dep, ret });

  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const FROM = process.env.FROM_DATE ?? '2026-09-05';
const TO   = process.env.TO_DATE   ?? '2026-12-31';

const pairs = getDatePairs(FROM, TO);
console.log(`Cathay scraper — ${pairs.length} pair(s)  ${FROM} → ${TO}\n`);

const browser = await chromium.launch({
  headless: false,
  args: ['--lang=en-US', '--disable-blink-features=AutomationControlled'],
});

const results = existsSync(DATA_FILE) ? JSON.parse(readFileSync(DATA_FILE, 'utf8')) : [];

for (let i = 0; i < pairs.length; i++) {
  const { outbound, return: ret } = pairs[i];

  if (i > 0) {
    const delay = 30000 + Math.random() * 30000;
    console.log(`  pausing ${Math.round(delay / 1000)}s…`);
    await wait(delay);
  }

  const context = await browser.newContext({
    locale:     'en-US',
    timezoneId: 'America/New_York',
    userAgent:  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport:   { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  console.log(`[${i + 1}/${pairs.length}] ${outbound} → ${ret}`);
  try {
    const result = await fetchPrice(page, outbound, ret);

    const idx  = results.findIndex(r => r.outbound === outbound);
    const prev = idx >= 0 ? results[idx] : null;

    if (result?.price) {
      console.log(`  → $${result.price}`);
      const cx843 = { price: result.price, details: `Cathay total_fare $${result.price} (base $${result.base_fare})` };
      const entry = { outbound, return: ret, cheapest: prev?.cheapest ?? null, cx843 };
      if (idx >= 0) results[idx] = entry; else results.push(entry);
    } else {
      console.log(`  → no price (${result?.error ?? 'unknown'})`);
      if (idx < 0) results.push({ outbound, return: ret, cheapest: null, cx843: null });
    }
  } catch (err) {
    console.error(`  ERROR: ${err.message.slice(0, 120)}`);
    if (results.findIndex(r => r.outbound === outbound) < 0) {
      results.push({ outbound, return: ret, cheapest: null, cx843: null });
    }
  }

  await context.close();
  writeFileSync(DATA_FILE, JSON.stringify(results, null, 2));
  console.log('');
}

await browser.close();

// ── Summary ───────────────────────────────────────────────────────────────────
const sorted = [...results].sort((a, b) => a.outbound.localeCompare(b.outbound));
const w = 82;
console.log('═'.repeat(w));
console.log('  DEPART        RETURN         CHEAPEST        CX843 (Cathay)');
console.log('─'.repeat(w));
for (const r of sorted) {
  const cheap = r.cheapest ? `$${r.cheapest.price}` : '—';
  const cx    = r.cx843    ? `$${r.cx843.price}`    : '—';
  console.log(`  ${r.outbound}    ${r.return}     ${cheap.padEnd(10)}      ${cx}`);
}
console.log('═'.repeat(w));
console.log(`\nSaved → ${DATA_FILE}`);
