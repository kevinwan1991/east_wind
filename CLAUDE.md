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
│   ├── browser.js      # Playwright browser/context setup
│   ├── dates.js        # Saturday date generator
│   └── extractor.js    # Page scraping logic
├── server/
│   └── index.js        # Express API
├── portal/
│   ├── index.html
│   └── app.js          # Frontend filter/sort logic
├── data/
│   └── flights.json    # Scraper output
├── .env                # Config (not committed)
├── package.json
└── CLAUDE.md
```

## Key conventions

- **ES modules throughout** — always `import`/`export`, never `require()`
- **async/await** — no raw Promise chains
- **Modular scraper** — browser setup, date logic, and extraction live in separate files; `scraper/index.js` orchestrates them
- **No TypeScript** — plain JS only
- **Config via `.env`** — at minimum: `TRAVEL_WINDOW_START`, `TRAVEL_WINDOW_END`, `HEADLESS` (true/false), `PORT`

## .env shape

```
TRAVEL_WINDOW_END=2026-12-31
HEADLESS=true
PORT=3000
```

## Current status

Project not yet initialized — start from scratch. No `package.json`, no `node_modules`, no source files yet.

## Running the project

```bash
# Scrape flights
node scraper/index.js

# Start portal
node server/index.js
```
