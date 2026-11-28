# SkyMock: tripforge-flights

**Synthetic flight search and simulated booking service** for [TripForge](#part-of-tripforge), a collaborative AI travel planner. It provides a REST API (Fastify + TypeScript), a small React website, and its own PostgreSQL database.

> ⚠️ **Everything here is synthetic.** Airlines, flights, prices and bookings are generated test data. Nothing is real, purchasable or connected to any airline.

---

## Status

| Area | State |
|---|---|
| Database schema, migrations, synthetic data, validation | ✅ Done |
| OpenAPI 3.1 contract | ✅ Done (linted with Redocly) |
| API skeleton: config, DB pool, logging, `GET /health`, graceful shutdown | ✅ Done |
| `GET /api/flights` search with filters, sorting and pagination | ✅ Done |
| `GET /api/flights/{id}`, `POST /api/bookings`, `GET /api/bookings/{id}` | ✅ Done (no overbooking under concurrency) |
| Automated API tests (Vitest) | ✅ Done |
| React website (`web/`) | ⏳ Planned |
| Dockerfile, CI | ⏳ Planned |

## Part of TripForge

TripForge is made of four independent repositories:

| Repo | Role | Stack |
|---|---|---|
| **tripforge-flights** (this repo) | SkyMock: flights | TypeScript, Fastify, React |
| tripforge-cars | RentMock: rental cars | Python, Flask, Jinja |
| tripforge-hotels | StayMock: hotels | Go, React |
| tripforge-planner | Group chat + AI agent (Qwen via Ollama, MCP tools) | React, Python |

The planner's AI agent calls this service's **read-only search endpoints** through an MCP tool adapter. No other service reads this database directly; each service owns its own data.

```mermaid
flowchart LR
  P[tripforge-planner<br/>MCP tool: search_flights] -->|HTTP GET /api/flights| A
  W[SkyMock website<br/>React] -->|HTTP| A[Fastify API]
  A -->|pg Pool| D[(PostgreSQL<br/>tripforge_flights)]
```

## Tech stack

| Layer | Technology |
|---|---|
| API | Node.js 22, Fastify 5, TypeScript (strict mode), `pg` |
| Web | React, TypeScript, Vite *(planned)* |
| Database | PostgreSQL 17, migrations with [dbmate](https://github.com/amacneil/dbmate) |
| Data generation | Python, standard library only, fixed random seed |
| Local infrastructure | Docker Compose |

## Quick start (Windows PowerShell)

**Prerequisites:** Docker Desktop, Node.js 22+, Python 3.10+ (only for the data generator).

### 1. Configure

```powershell
Copy-Item .env.example .env
```

Edit `.env`: set `POSTGRES_PASSWORD`, and put the same password inside `DATABASE_URL`.

### 2. Start the database, migrate and seed

```powershell
docker compose -f docker-compose.dev.yml up -d postgres
```
```powershell
docker compose -f docker-compose.dev.yml run --rm dbmate up
```
```powershell
python db/seed/generate.py
```
```powershell
docker compose -f docker-compose.dev.yml exec -T postgres psql -q -U flights_svc -d tripforge_flights -f /db/seed/seed.sql
```
```powershell
docker compose -f docker-compose.dev.yml exec -T postgres psql -U flights_svc -d tripforge_flights -f /db/seed/validate.sql
```

The last command should print `All flights data checks passed.`

### 3. Run the API

```powershell
cd api
```
```powershell
npm install
```
```powershell
npm run dev
```

In another terminal:

```powershell
curl.exe -i http://localhost:3001/health
```

Expected: `200 {"status":"ok","db":"ok"}`. If the database is down, you get `503 {"status":"degraded","db":"error"}`.

## Running tests

The API tests (Vitest, in `api/tests/`) call the app through `app.inject()` without opening a port. They use their **own database**, `tripforge_flights_test`, and wipe and refill it before every test, so they never touch your dev data.

### One-time setup

With the dev Postgres container running, from the repo root:

```powershell
docker compose -f docker-compose.dev.yml exec -T postgres psql -U flights_svc -d postgres -c "CREATE DATABASE tripforge_flights_test OWNER flights_svc"
```

Migrate it (replace `YOUR_PASSWORD` with `POSTGRES_PASSWORD` from `.env`):

```powershell
docker compose -f docker-compose.dev.yml run --rm -e "DATABASE_URL=postgres://flights_svc:YOUR_PASSWORD@postgres:5432/tripforge_flights_test?sslmode=disable" dbmate up
```

Create `.env.test` in the repo root (git-ignored):

```dotenv
DATABASE_URL=postgres://flights_svc:YOUR_PASSWORD@localhost:5433/tripforge_flights_test
PORT=3099
LOG_LEVEL=error
DB_STATEMENT_TIMEOUT_MS=5000
```

After adding a new migration, run the `dbmate up` command above again so the test database stays in sync.

### Run

```powershell
cd api
```
```powershell
npm test
```

| File | Covers |
|---|---|
| `tests/flights.test.ts` | search filters, sorting, pagination `total`, exact prices, flight details, validation errors, unknown routes |
| `tests/bookings.test.ts` | bookings 201 / 404 / 409 / 400, side effects on seats, booking lookup, and a **race test** (20 concurrent bookings for 5 seats → exactly 5 succeed) |
| `tests/health.test.ts` | `/health` → 200, and 503 when the database is unreachable |

Tests use small hand-made fixtures (`tests/helpers.ts`) whose expected answers are known, instead of the generated seed data. Test files run one at a time (`fileParallelism: false`) because they share one database.

## API

Full contract: [docs/openapi.yaml](docs/openapi.yaml).

| Method | Path | Purpose | Status |
|---|---|---|---|
| GET | `/health` | Liveness + database check | ✅ |
| GET | `/api/flights?origin=JFK&destination=LAX&date=2027-03-15` | Search flights | ✅ |
| GET | `/api/flights/{flight_id}` | Flight details | ✅ |
| POST | `/api/bookings` | Create a simulated booking | ✅ |
| GET | `/api/bookings/{booking_id}` | Booking details | ✅ |

Conventions: JSON with `snake_case` keys, UTC timestamps (ISO 8601), money in USD with 2 decimals. Every error has the same shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "origin and destination must differ" } }
```

## Synthetic data

Generated by [`db/seed/generate.py`](db/seed/generate.py):

- **5 airports** (JFK, LAX, SFO, MIA, ORD), shared with the other TripForge services through city codes (NYC, LAX, SFO, MIA, CHI).
- **6 fictional airlines.**
- **Every route has at least one flight every day** from 2027-03-01 to 2027-05-31.
- **Deterministic:** the same seed and sizes produce a byte-identical SQL file.

| Preset | Flights | Bookings |
|---|---:|---:|
| default (development) | 2,000 | 500 |
| `--full` (load testing) | 10,000 | 5,000 |

[`db/seed/validate.sql`](db/seed/validate.sql) checks the invariants: no overbooking, correct booking totals, full route coverage, and plausible flight durations. See [docs/database.md](docs/database.md) for the schema.

## Design notes

- **The database prevents overbooking, not the application alone.** `CHECK (available_seats BETWEEN 0 AND total_seats)` plus a single conditional `UPDATE … WHERE available_seats >= n` means concurrent bookings can't oversell a flight.
- **Fail fast instead of hanging.** The connection pool has a 2-second connection timeout, and Postgres cancels any query that runs longer than `DB_STATEMENT_TIMEOUT_MS`. A hung database becomes a fast `503` rather than a frozen API.
- **Configuration is validated at startup.** A bad `PORT` or timeout stops the process with a clear message and exit code 1, instead of failing later on a request.
- **`buildApp()` is separate from `listen()`,** so tests can call the app with `app.inject()` without opening a network port.
- **Graceful shutdown.** On SIGINT/SIGTERM the server stops accepting requests and closes the database pool before exiting.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | none | Used by the dev Postgres container |
| `POSTGRES_HOST_PORT` | `5433` | Host port for dev Postgres (avoids clashing with a native install on 5432) |
| `DATABASE_URL` | **required** | Postgres connection string used by the API |
| `PORT` | `3001` | API port (1–65535) |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |
| `DB_STATEMENT_TIMEOUT_MS` | `5000` | Postgres statement timeout (1–60000 ms) |

`.env` is git-ignored. Never commit real credentials.

## Project structure

```text
tripforge-flights/
├── api/                    Fastify API (TypeScript)
│   └── src/
│       ├── config.ts       env parsing + validation
│       ├── db.ts           pg Pool with timeouts
│       ├── app.ts          buildApp(): plugins, hooks (no listen)
│       ├── server.ts       entry point: listen + graceful shutdown
│       └── routes/health.ts
├── db/
│   ├── migrations/         dbmate SQL migrations
│   └── seed/               generate.py, validate.sql
├── docs/                   openapi.yaml, database.md
├── docker-compose.dev.yml  dev Postgres + dbmate
└── .env.example
```

## Useful commands

| Task | Command |
|---|---|
| Type-check the API | `npm run typecheck` (in `api/`) |
| SQL shell | `docker compose -f docker-compose.dev.yml exec postgres psql -U flights_svc -d tripforge_flights` |
| Full-size dataset | `python db/seed/generate.py --full`, then re-run the seed command |
| Roll back the last migration | `docker compose -f docker-compose.dev.yml run --rm dbmate rollback` |
| Reset everything (**deletes data**) | `docker compose -f docker-compose.dev.yml down -v` |

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
