"""
Spike: fast-flights — all airlines meeting:
  1. Arrives PVG before 2 PM local time
  2. Total duration < 24h 15min  (keeps HKG layover under ~6h)

Run: python3 scraper/test_fast_flights.py [YYYY-MM-DD]
     (defaults to nearest upcoming Saturday if no date given)
"""

import json
import re
import sys
from datetime import date, timedelta, datetime
from fast_flights import FlightData, Passengers, get_flights


# ── Helpers ───────────────────────────────────────────────────────────────────

def next_saturday(from_date: date = None) -> date:
    d = from_date or date.today()
    days_ahead = (5 - d.weekday()) % 7
    if days_ahead == 0:
        days_ahead = 7
    return d + timedelta(days=days_ahead)


def parse_arrival_hour(arrival_str: str) -> float:
    """'11:05 AM on Sun, Jun 21' → 11.08  |  '1:15 PM ...' → 13.25"""
    m = re.search(r'(\d+):(\d+)\s*(AM|PM)', arrival_str, re.IGNORECASE)
    if not m:
        return 99.0
    h, mi, period = int(m.group(1)), int(m.group(2)), m.group(3).upper()
    if period == 'PM' and h != 12:
        h += 12
    if period == 'AM' and h == 12:
        h = 0
    return h + mi / 60


def parse_duration_minutes(duration_str: str) -> int:
    """'21 hr 10 min' → 1270  |  '22 hr' → 1320"""
    hours   = int(re.search(r'(\d+)\s*hr',  duration_str).group(1)) if 'hr'  in duration_str else 0
    minutes = int(re.search(r'(\d+)\s*min', duration_str).group(1)) if 'min' in duration_str else 0
    return hours * 60 + minutes


# ── Date ──────────────────────────────────────────────────────────────────────

if len(sys.argv) > 1:
    depart = date.fromisoformat(sys.argv[1])
else:
    depart = next_saturday()

ret = depart + timedelta(days=22)
print(f"Searching JFK → PVG  depart {depart}  return {ret}\n")

# ── Fetch ─────────────────────────────────────────────────────────────────────

result = get_flights(
    flight_data=[
        FlightData(date=depart.isoformat(), from_airport="JFK", to_airport="PVG"),
        FlightData(date=ret.isoformat(),    from_airport="PVG", to_airport="JFK"),
    ],
    trip="round-trip",
    seat="economy",
    passengers=Passengers(adults=1),
)

print(f"Price level : {result.current_price}")
print(f"Total rows  : {len(result.flights)}\n")

# ── Filter ────────────────────────────────────────────────────────────────────

MAX_ARRIVAL_HOUR  = 14.0        # before 2 PM Shanghai local time
MAX_DURATION_MINS = 24 * 60 + 15  # 24h 15min → HKG layover ≤ ~6h

qualifying = []
seen = set()

for f in result.flights:
    arr_hour = parse_arrival_hour(f.arrival)
    dur_mins = parse_duration_minutes(f.duration)

    if arr_hour >= MAX_ARRIVAL_HOUR:
        continue
    if dur_mins > MAX_DURATION_MINS:
        continue

    key = (f.departure, f.arrival, f.duration)
    if key in seen:
        continue
    seen.add(key)

    qualifying.append({
        "airline":   f.name,
        "departure": f.departure,
        "arrival":   f.arrival,
        "duration":  f.duration,
        "stops":     f.stops,
        "price":     f.price,
        "is_best":   f.is_best,
    })

qualifying.sort(key=lambda x: int(x["price"].replace("$", "").replace(",", "") or 0))

print(f"Qualifying flights (arrive <2PM, layover <6h): {len(qualifying)}\n")
print(json.dumps(qualifying, indent=2))
