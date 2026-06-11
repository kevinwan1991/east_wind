import 'dotenv/config';

const TRIP_LENGTH_DAYS = 21;
const SATURDAY = 6;

export function generateDatePairs() {
  const end = new Date(process.env.TRAVEL_WINDOW_END ?? '2025-12-31');
  const pairs = [];

  // Find the next Saturday from today
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  const daysUntilSaturday = (SATURDAY - cursor.getDay() + 7) % 7 || 7;
  cursor.setDate(cursor.getDate() + daysUntilSaturday);

  while (cursor <= end) {
    const outbound = cursor.toISOString().slice(0, 10);

    const ret = new Date(cursor);
    ret.setDate(ret.getDate() + TRIP_LENGTH_DAYS);
    const returnDate = ret.toISOString().slice(0, 10);

    pairs.push({ outbound, return: returnDate });
    cursor.setDate(cursor.getDate() + 7);
  }

  return pairs;
}

// Print when run directly
const isMain = process.argv[1].endsWith('dates.js');
if (isMain) {
  const pairs = generateDatePairs();
  console.log(`Found ${pairs.length} Saturday departure(s):\n`);
  for (const p of pairs) {
    console.log(`  outbound: ${p.outbound}  →  return: ${p.return}`);
  }
}
