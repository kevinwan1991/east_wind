# East Wind

A Node.js flight scraper and web portal for finding cheap Cathay Pacific round trips from JFK to PVG (Shanghai).

## What it does

Uses Playwright to scrape **Google Flights** (google.com/travel/flights) for Cathay Pacific round trips:
- **Outbound:** Flight **CX843** specifically (JFK → HKG → PVG), departing on a **Saturday (US time)**
- **Return:** Any Cathay Pacific flight, PVG → JFK, departing on a **Sunday (China time)**
- **Trip length:** Exactly **21 days**
- **Scan window:** All Saturdays from today through **Dec 31 2026**
- **Ranking:** Cheapest total round-trip price first
- Saves results to `data/flights.json`
- Serves results via an Express portal where the user can filter, sort, and click through to book

## Tech stack

- **Runtime:** Node.js with ES modules (`"type": "module"` in package.json)
- **Scraping:** Playwright (Chromium) against Google Flights
- **Server:** Express
- **Frontend:** Plain HTML + vanilla JS (no framework)
- **Config:** `.env` file (dotenv)
- **No TypeScript**

## Project structure

```
east-wind/
├── scraper/
│   ├── google.js       # Google Flights scraper (primary — confirms CX843 flight number)
│   └── cathay.js       # Cathay Pacific histogram API scraper (price-only fallback)
├── data/
│   └── flights.json    # Scraper output (17 Saturday date pairs, Sep–Dec 2026)
├── cookies/
│   └── google.json     # Google session cookies (not committed — export fresh before each run)
├── .env                # Config (not committed)
├── package.json
└── CLAUDE.md
```

## Key conventions

- **ES modules throughout** — always `import`/`export`, never `require()`
- **async/await** — no raw Promise chains
- **No TypeScript** — plain JS only
- **Trip length:** 22 days (depart Saturday, return 22 days later)
- **Date range:** All Saturdays Sep 5 – Dec 26 2026

## Running the scraper

```bash
# Full scan (all Saturdays)
HEADLESS=false node scraper/google.js

# Single date
HEADLESS=false FROM_DATE=2026-11-07 TO_DATE=2026-11-07 node scraper/google.js
```

`HEADLESS=false` is required — Google detects headless mode and blocks results.

## Google Flights bot detection — lessons learned

Google Flights has progressively tightened anti-bot measures. Here's what we know:

### What works
- **Cookie injection** is the most important technique. Google now requires sign-in to show flight results. Injecting a real logged-in Google session bypasses the sign-in wall entirely.
- **Cathay Pacific "Only" filter** applied before expanding rows reduces the scan set from ~22 rows to ~6, making CX843 detection much faster and less likely to trigger rate limits.
- **Real Chrome** (`channel: 'chrome'`) + stealth plugin + `navigator.webdriver` removal helps avoid fingerprinting.
- **Human-like behavior** — `humanClick()` (mouse.move before click), `humanType()` (char-by-char), randomized delays, warmup visit to google.com before flights.
- **Fresh browser context per search** — resets cookies/storage so Google can't track across searches.

### Cookie workflow
1. In your real Chrome (signed into Google), go to `google.com/travel/flights`
2. Click the **Cookie-Editor** extension → **Export** → **Export as JSON**
3. Save to `cookies/google.json` (already in `.gitignore`)
4. Run the scraper — it auto-loads cookies on startup

### Cookies rotate
Google refreshes session tokens (`__Secure-1PSIDTS`, `__Secure-3PSIDTS`, etc.) after scraping activity. If the Playwright browser appears signed out, re-export cookies and rerun. Takes ~30 seconds.

### Destination input selector
Google Flights uses `input[aria-label*="where to" i]` — not the exact string `"Where to?"`. The scraper tries multiple fallback selectors.

### What doesn't work
- Headless mode — blocked immediately
- `launchPersistentContext` with real Chrome profile — Chrome blocks CDP when using the default user data dir
- Automated Google sign-in — Google detects Playwright flags and shows "Couldn't sign you in"
- CDP remote debugging port — macOS sandbox prevents port binding when launched from a shell
