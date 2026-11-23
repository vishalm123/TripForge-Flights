# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Repository skeleton, `.env.example`, dev Docker Compose (Postgres 17 on port 5433, dbmate).
- Migration `20261121000001_create_flights_schema`: airports, airlines, flights, bookings, booking_passengers, with constraints that prevent negative inventory.
- Deterministic synthetic data generator (`db/seed/generate.py`) and invariant checks (`db/seed/validate.sql`).
- OpenAPI 3.1 contract for `/health`, `/api/flights`, `/api/flights/{id}`, `/api/bookings`, `/api/bookings/{id}`.
- Fastify + TypeScript API skeleton (`api/`): validated env config, `pg` pool with connection and statement timeouts, `GET /health` (200 / 503), JSON request logging, graceful shutdown on SIGINT/SIGTERM.
- `GET /api/flights` search: query validation, parameterised SQL in a repository layer, UTC date filter (PR #2).
- Unified error responses `{error:{code,message,details?}}`; generic 500s that never leak internals (PRs #3, #4).
- Flight search sorting (`price`/`departure`), `include_full` and `max_price` filters, and a real `pagination.total` from a parallel count query.
- `GET /api/flights/{flight_id}`: flight details by ID (404 when missing; shows sold-out flights).