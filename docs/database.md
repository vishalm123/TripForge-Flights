# SkyMock database (`tripforge_flights`)

Owned exclusively by this service. Other TripForge services must use the REST API, never this database.

## Tables

| Table | Purpose | Key constraints |
|---|---|---|
| `airports` | 5 airports, each mapped to a shared TripForge `city_code` (NYC, LAX, SFO, MIA, CHI) | PK `code` |
| `airlines` | 6 fictional airlines | PK `code`, unique `name` |
| `flights` | Inventory | PK `flight_id`; FKs to airports/airlines; `price_usd >= 0`; `arrival_time > departure_time`; `origin <> destination`; `available_seats BETWEEN 0 AND total_seats` |
| `bookings` | Simulated bookings | PK `booking_id` (`BK-` + sequence); FK `flight_id`; `seats 1..9`; status `CONFIRMED`/`CANCELLED` |
| `booking_passengers` | One row per seat | FK `booking_id` with `ON DELETE CASCADE` |

Index `flights_search_idx (origin, destination, departure_time)` serves the main search query. Verified with `EXPLAIN`: a route + day search is an Index Scan.

## Invariants (checked by `db/seed/validate.sql`)

1. `available_seats = total_seats - sum(seats of CONFIRMED bookings)` for every flight. This is the **overbooking check** for Locust Experiment 4.
2. `bookings.total_price_usd = seats * flights.price_usd`. Prices are static in the MVP.
3. Passenger rows per booking = `seats`.
4. Bookings are created before departure.
5. Every directed route (20) has at least one flight on every day from 2027-03-01 to 2027-05-31.
6. LAX is reachable from every other airport with seats left. This guarantees the demo path.

## How overbooking is prevented (for you to implement in `POST /api/bookings`)

The DB `CHECK (available_seats BETWEEN 0 AND total_seats)` is the safety net. The API should use one **conditional atomic update** inside a transaction:

```sql
UPDATE flights SET available_seats = available_seats - $2
WHERE flight_id = $1 AND available_seats >= $2
RETURNING price_usd;   -- 0 rows => SOLD_OUT (or not found)
```

…then `INSERT` the booking and passengers in the **same** transaction. You will reason about *why* "SELECT seats, check in JS, then UPDATE" is wrong under concurrency.

## Synthetic data

`db/seed/generate.py` is stdlib-only Python with a fixed `random.Random(seed)`. Same seed and sizes give a byte-identical `seed.sql` (verified by hashing two runs). Generated timestamps use a fixed epoch, never the wall clock.

| Preset | Flights | Bookings |
|---|---:|---:|
| default (dev) | 2,000 | 500 |
| `--full` | 10,000 | 5,000 |

Minimum flights = 1,840 (20 routes × 92 days) so every route has a flight every day.

Simplification: all times are UTC; airport time zones are ignored.

## Migrations

[dbmate](https://github.com/amacneil/dbmate), plain SQL files in `db/migrations/` with `-- migrate:up` / `-- migrate:down` sections, run through the `dbmate` compose service. Applied migrations are recorded in the `schema_migrations` table.
