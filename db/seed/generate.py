#!/usr/bin/env python3
"""Deterministic synthetic data generator for SkyMock (tripforge-flights).

Writes a single SQL file that TRUNCATEs the tables and bulk-loads them with
COPY. Uses only the Python standard library, so it runs anywhere Python 3.10+
is installed (it is NOT a runtime dependency of the Node service).

Same --seed + same sizes  ->  byte-identical output file.

Usage (from repo root):
    python db/seed/generate.py                      # dev size: 2,000 flights / 500 bookings
    python db/seed/generate.py --full               # target size: 10,000 / 5,000
    python db/seed/generate.py --flights 4000 --bookings 800 --seed 7
"""

from __future__ import annotations

import argparse
import hashlib
import random
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from itertools import permutations
from pathlib import Path

# ---------------------------------------------------------------------------
# Shared TripForge world. These values MUST match the cars/hotels generators
# (same city codes, same date window) so the agent can combine results.
# ---------------------------------------------------------------------------
WINDOW_START = date(2027, 3, 1)
WINDOW_DAYS = 92  # 2027-03-01 .. 2027-05-31 inclusive

# (airport, city_code, city_name, airport_name)
AIRPORTS = [
    ("JFK", "NYC", "New York", "New York Demo International"),
    ("LAX", "LAX", "Los Angeles", "Los Angeles Demo International"),
    ("SFO", "SFO", "San Francisco", "San Francisco Demo International"),
    ("MIA", "MIA", "Miami", "Miami Demo International"),
    ("ORD", "CHI", "Chicago", "Chicago Demo O'Hare"),
]

# Fictional airlines (synthetic names; codes chosen for readability only).
AIRLINES = [
    ("DA", "Demo Airways"),
    ("SK", "SkyMock Air"),
    ("NB", "Nimbus Lines"),
    ("CJ", "Coastal Jet"),
    ("PX", "Prairie Express"),
    ("AQ", "Aquila Air"),
]

# Approximate block times in minutes (symmetric).
DURATION_MIN = {
    frozenset({"JFK", "LAX"}): 345, frozenset({"JFK", "SFO"}): 360,
    frozenset({"JFK", "MIA"}): 185, frozenset({"JFK", "ORD"}): 150,
    frozenset({"LAX", "SFO"}): 85,  frozenset({"LAX", "MIA"}): 300,
    frozenset({"LAX", "ORD"}): 250, frozenset({"SFO", "MIA"}): 330,
    frozenset({"SFO", "ORD"}): 260, frozenset({"MIA", "ORD"}): 185,
}

SEAT_CAPACITIES = [120, 150, 180, 200]

FIRST_NAMES = ["Avery", "Jordan", "Riley", "Morgan", "Casey", "Taylor", "Quinn", "Rowan",
               "Sage", "Parker", "Emerson", "Hayden", "Kai", "Logan", "Reese", "Skyler"]
LAST_NAMES = ["Testwell", "Sampleton", "Mockford", "Demoson", "Fakeley", "Stubbs",
              "Fixture", "Seedman", "Placeholder", "Synthwood", "Draftly", "Pilotson"]

# Fixed "now" for generated booking timestamps -> output never depends on wall-clock time.
BOOKING_EPOCH = datetime(2026, 12, 1, tzinfo=timezone.utc)

FULL_FLIGHTS, FULL_BOOKINGS = 10_000, 5_000
DEV_FLIGHTS, DEV_BOOKINGS = 2_000, 500


@dataclass
class Flight:
    flight_id: str
    airline_code: str
    flight_number: str
    origin: str
    destination: str
    departure: datetime
    arrival: datetime
    price_cents: int
    total_seats: int
    available_seats: int


@dataclass
class Booking:
    booking_id: str
    flight_id: str
    seats: int
    total_cents: int
    contact_email: str
    status: str
    created_at: datetime
    passengers: list[str]


def ts(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S+00:00")


def money(cents: int) -> str:
    return f"{cents // 100}.{cents % 100:02d}"


def price_cents(rng: random.Random, duration: int, dep: datetime) -> int:
    """Price depends on distance, weekday and time of day, plus noise. Never negative."""
    base = 49 + duration * 0.55
    weekday_factor = 1.15 if dep.weekday() in (4, 6) else 1.0      # Fri / Sun
    hour = dep.hour
    tod_factor = 0.9 if hour < 9 else (1.1 if 17 <= hour <= 20 else 1.0)
    noise = rng.uniform(0.8, 1.35)
    dollars = max(29, round(base * weekday_factor * tod_factor * noise))
    return dollars * 100 - 1  # e.g. 289 -> 288.99


def generate_flights(rng: random.Random, n_flights: int) -> list[Flight]:
    airports = [a[0] for a in AIRPORTS]
    routes = sorted(permutations(airports, 2))              # 20 directed routes, stable order
    days = [WINDOW_START + timedelta(days=i) for i in range(WINDOW_DAYS)]
    slots = len(routes) * len(days)
    if n_flights < slots:
        raise SystemExit(
            f"--flights must be >= {slots} so every route has at least one flight per day "
            f"({len(routes)} routes x {len(days)} days)."
        )

    # Every (day, route) gets `per` flights; the remainder is spread randomly.
    per, extra = divmod(n_flights, slots)
    counts = [per] * slots
    for idx in rng.sample(range(slots), extra):
        counts[idx] += 1
    if max(counts) > 20:
        raise SystemExit("Too many flights per route/day for the flight-number scheme (max 20).")

    flights: list[Flight] = []
    seq = 1000
    for d_idx, day in enumerate(days):
        for r_idx, (origin, dest) in enumerate(routes):
            k_count = counts[d_idx * len(routes) + r_idx]
            # Distinct departure minutes within the day, 06:00..21:55 in 5-minute steps.
            minutes = sorted(rng.sample(range(6 * 60, 22 * 60, 5), k_count))
            duration = DURATION_MIN[frozenset({origin, dest})]
            for k, minute in enumerate(minutes):
                airline_code = rng.choice(AIRLINES)[0]
                dep = datetime(day.year, day.month, day.day, tzinfo=timezone.utc) + timedelta(minutes=minute)
                arr = dep + timedelta(minutes=duration + rng.randint(-15, 20))
                seats = rng.choice(SEAT_CAPACITIES)
                flights.append(Flight(
                    flight_id=f"FL-{seq}",
                    airline_code=airline_code,
                    flight_number=f"{airline_code}{100 + r_idx * 20 + k}",
                    origin=origin,
                    destination=dest,
                    departure=dep,
                    arrival=arr,
                    price_cents=price_cents(rng, duration, dep),
                    total_seats=seats,
                    available_seats=seats,
                ))
                seq += 1
    return flights


def generate_bookings(rng: random.Random, flights: list[Flight], n_bookings: int) -> list[Booking]:
    bookings: list[Booking] = []
    number = 100000
    for i in range(n_bookings):
        status = "CANCELLED" if rng.random() < 0.05 else "CONFIRMED"
        wanted = rng.choices([1, 2, 3, 4], weights=[50, 30, 12, 8])[0]
        # Find a flight that can take the booking (bounded attempts keeps this deterministic + fast).
        for _ in range(50):
            flight = rng.choice(flights)
            if status == "CANCELLED" or flight.available_seats >= wanted:
                break
        else:
            continue  # extremely unlikely; skip rather than overbook
        if status == "CONFIRMED":
            flight.available_seats -= wanted
        lead = flight.departure - BOOKING_EPOCH
        created = BOOKING_EPOCH + timedelta(minutes=rng.randint(0, int(lead.total_seconds() // 60) - 60))
        bookings.append(Booking(
            booking_id=f"BK-{number}",
            flight_id=flight.flight_id,
            seats=wanted,
            total_cents=wanted * flight.price_cents,
            contact_email=f"traveler{i + 1}@example.test",
            status=status,
            created_at=created,
            passengers=[f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}" for _ in range(wanted)],
        ))
        number += 1
    return bookings


def copy_block(table: str, columns: list[str], rows: list[list[str]]) -> str:
    # Values never contain tabs, newlines or backslashes, so no COPY escaping is needed.
    lines = [f"COPY {table} ({', '.join(columns)}) FROM stdin;"]
    lines += ["\t".join(r) for r in rows]
    lines.append("\\.")
    return "\n".join(lines) + "\n"


def render_sql(seed: int, flights: list[Flight], bookings: list[Booking]) -> str:
    out = [
        "-- GENERATED FILE. Do not edit. Re-create with: python db/seed/generate.py",
        f"-- seed={seed} flights={len(flights)} bookings={len(bookings)}",
        "\\set ON_ERROR_STOP on",
        "BEGIN;",
        "TRUNCATE booking_passengers, bookings, flights, airlines, airports RESTART IDENTITY CASCADE;",
        copy_block("airports", ["code", "city_code", "city_name", "name"], [list(a) for a in AIRPORTS]),
        copy_block("airlines", ["code", "name"], [list(a) for a in AIRLINES]),
        copy_block(
            "flights",
            ["flight_id", "airline_code", "flight_number", "origin", "destination",
             "departure_time", "arrival_time", "price_usd", "total_seats", "available_seats"],
            [[f.flight_id, f.airline_code, f.flight_number, f.origin, f.destination,
              ts(f.departure), ts(f.arrival), money(f.price_cents), str(f.total_seats),
              str(f.available_seats)] for f in flights],
        ),
        copy_block(
            "bookings",
            ["booking_id", "flight_id", "seats", "total_price_usd", "contact_email", "status", "created_at"],
            [[b.booking_id, b.flight_id, str(b.seats), money(b.total_cents), b.contact_email,
              b.status, ts(b.created_at)] for b in bookings],
        ),
        copy_block(
            "booking_passengers",
            ["booking_id", "full_name"],
            [[b.booking_id, name] for b in bookings for name in b.passengers],
        ),
        # New API bookings continue after the seeded ones.
        "SELECT setval('booking_number_seq', "
        "COALESCE((SELECT max(substring(booking_id FROM 4)::bigint) FROM bookings), 100000), true);",
        "COMMIT;",
        "ANALYZE;",
    ]
    return "\n".join(out) + "\n"


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--flights", type=int, default=DEV_FLIGHTS)
    p.add_argument("--bookings", type=int, default=DEV_BOOKINGS)
    p.add_argument("--full", action="store_true", help=f"use target sizes ({FULL_FLIGHTS}/{FULL_BOOKINGS})")
    p.add_argument("--out", type=Path, default=Path(__file__).with_name("seed.sql"))
    args = p.parse_args()
    if args.full:
        args.flights, args.bookings = FULL_FLIGHTS, FULL_BOOKINGS

    rng = random.Random(args.seed)
    flights = generate_flights(rng, args.flights)
    bookings = generate_bookings(rng, flights, args.bookings)
    sql = render_sql(args.seed, flights, bookings)

    args.out.write_bytes(sql.encode("utf-8"))  # bytes -> identical LF output on every OS
    digest = hashlib.sha256(sql.encode("utf-8")).hexdigest()[:16]
    print(f"wrote {args.out} flights={len(flights)} bookings={len(bookings)} sha256[:16]={digest}")


if __name__ == "__main__":
    main()
