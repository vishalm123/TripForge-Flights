# SkyMock — tripforge-flights

Synthetic flight search and simulated booking website + REST API, part of **TripForge** (an AI group travel planner). All data is synthetic; nothing is real or purchasable.

| Layer | Tech |
|---|---|
| API | Node.js 22, Fastify, TypeScript (`api/`, *in progress*) |
| Web | React, TypeScript, Vite (`web/`, *in progress*) |
| DB | PostgreSQL 17, migrations with dbmate |

- API contract: [docs/openapi.yaml](docs/openapi.yaml)
- Database design: [docs/database.md](docs/database.md)

## Prerequisites

Docker Desktop, Node 22+, Python 3.10+ (only for the data generator).

## Local database setup (PowerShell)

```powershell
Copy-Item .env.example .env    # then set POSTGRES_PASSWORD (and the same value inside DATABASE_URL)
docker compose -f docker-compose.dev.yml up -d postgres
docker compose -f docker-compose.dev.yml run --rm dbmate up
python db/seed/generate.py      # add --full for 10k flights / 5k bookings
docker compose -f docker-compose.dev.yml exec -T postgres psql -q -U flights_svc -d tripforge_flights -f /db/seed/seed.sql
docker compose -f docker-compose.dev.yml exec -T postgres psql -U flights_svc -d tripforge_flights -f /db/seed/validate.sql
```

Postgres is published on host port **5433** (configurable with `POSTGRES_HOST_PORT`) so it does not clash with a native install on 5432.

Interactive SQL shell:

```powershell
docker compose -f docker-compose.dev.yml exec postgres psql -U flights_svc -d tripforge_flights
```

Reset everything (deletes the data volume):

```powershell
docker compose -f docker-compose.dev.yml down -v
```

## Environment variables

See [.env.example](.env.example). `.env` is git-ignored and must never be committed.

## Running the API

```powershell
cd api
npm install
npm run dev          # tsx watch, loads ../.env
npm run typecheck    # tsc --noEmit (strict)
```

```powershell
curl.exe -i http://localhost:3001/health   # 200 {"status":"ok","db":"ok"} or 503 when the DB is down
```

## Web / tests

*Coming in Week 2.*
