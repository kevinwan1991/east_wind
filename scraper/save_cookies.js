// Launches real Chrome with your existing profile (already signed in),
// navigates to Google, grabs all cookies, and saves them.
// Chrome must be fully quit before running this.

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import os from 'os';

const profileDir = `${os.homedir()}/Library/Application Support/Google/Chrome`;

console.log('Launching Chrome with your existing profile…');
const context = await chromium.launchPersistentContext(profileDir, {
  channel:    'chrome',
  headless:   false,
  args: ['--lang=en-US'],
});

const page = context.pages()[0] ?? await context.newPage();
await page.goto('https://www.google.com/travel/flights', { waitUntil: 'domcontentloaded' });

// Give Google a moment to set/refresh session cookies
await new Promise(r => setTimeout(r, 4000));

const cookies = await context.cookies(['https://www.google.com', 'https://google.com']);
mkdirSync('cookies', { recursive: true });
writeFileSync('cookies/google.json', JSON.stringify(cookies, null, 2));

console.log(`Saved ${cookies.length} cookies → cookies/google.json`);
console.log('You can now run: node scraper/google.js');

await context.close();
