-- Data validation for tripforge_flights.
-- Run after seeding AND after load tests (it checks invariants the API must preserve).
--   docker compose -f docker-compose.dev.yml exec postgres \
--     psql -U flights_svc -d tripforge_flights -v ON_ERROR_STOP=1 -f /db/seed/validate.sql
-- Any failed check raises an exception -> psql exits non-zero (usable in CI).

\set ON_ERROR_STOP on

DO $$
DECLARE
    n BIGINT;
    missing TEXT;
BEGIN
    -- 1. Non-empty inventory
    SELECT count(*) INTO n FROM flights;
    IF n = 0 THEN RAISE EXCEPTION 'FAIL: flights table is empty'; END IF;

    -- 2. Seat invariant: available = total - seats held by CONFIRMED bookings.
    --    This is the overbooking check used after Locust Experiment 4.
    SELECT count(*) INTO n
    FROM flights f
    LEFT JOIN (SELECT flight_id, sum(seats) AS held
               FROM bookings WHERE status = 'CONFIRMED' GROUP BY flight_id) b USING (flight_id)
    WHERE f.available_seats <> f.total_seats - COALESCE(b.held, 0);
    IF n > 0 THEN RAISE EXCEPTION 'FAIL: % flights violate available_seats = total_seats - confirmed seats', n; END IF;

    -- 3. Booking price = seats x flight price (prices are static in the MVP)
    SELECT count(*) INTO n
    FROM bookings b JOIN flights f USING (flight_id)
    WHERE b.total_price_usd <> b.seats * f.price_usd;
    IF n > 0 THEN RAISE EXCEPTION 'FAIL: % bookings have total_price_usd <> seats * price_usd', n; END IF;

    -- 4. Passenger count matches seats
    SELECT count(*) INTO n
    FROM bookings b
    LEFT JOIN (SELECT booking_id, count(*) AS c FROM booking_passengers GROUP BY booking_id) p USING (booking_id)
    WHERE COALESCE(p.c, 0) <> b.seats;
    IF n > 0 THEN RAISE EXCEPTION 'FAIL: % bookings whose passenger count <> seats', n; END IF;

    -- 5. Bookings made before departure
    SELECT count(*) INTO n FROM bookings b JOIN flights f USING (flight_id) WHERE b.created_at >= f.departure_time;
    IF n > 0 THEN RAISE EXCEPTION 'FAIL: % bookings created after departure', n; END IF;

    -- 6. Coverage: every directed route has >= 1 flight on every day of the shared window.
    SELECT count(*) INTO n
    FROM airports o CROSS JOIN airports d
    CROSS JOIN generate_series(date '2027-03-01', date '2027-05-31', interval '1 day') AS day
    WHERE o.code <> d.code
      AND NOT EXISTS (
          SELECT 1 FROM flights f
          WHERE f.origin = o.code AND f.destination = d.code
            AND f.departure_time >= day AND f.departure_time < day + interval '1 day');
    IF n > 0 THEN RAISE EXCEPTION 'FAIL: % (route, day) combinations have no flights', n; END IF;

    -- 7. Demo path: LAX reachable from every other city with seats left
    SELECT string_agg(a.code, ',') INTO missing
    FROM airports a
    WHERE a.code <> 'LAX'
      AND NOT EXISTS (SELECT 1 FROM flights f WHERE f.origin = a.code AND f.destination = 'LAX' AND f.available_seats > 0);
    IF missing IS NOT NULL THEN RAISE EXCEPTION 'FAIL: no available flights to LAX from %', missing; END IF;

    -- 8. Durations plausible (sanity on generator)
    SELECT count(*) INTO n FROM flights
    WHERE arrival_time - departure_time NOT BETWEEN interval '30 minutes' AND interval '8 hours';
    IF n > 0 THEN RAISE EXCEPTION 'FAIL: % flights have implausible durations', n; END IF;

    RAISE NOTICE 'All flights data checks passed.';
END
$$;

-- Summary (informational)
SELECT
    (SELECT count(*) FROM airports)                                AS airports,
    (SELECT count(*) FROM airlines)                                AS airlines,
    (SELECT count(*) FROM flights)                                 AS flights,
    (SELECT count(*) FROM flights WHERE available_seats = 0)       AS sold_out_flights,
    (SELECT count(*) FROM bookings)                                AS bookings,
    (SELECT count(*) FROM bookings WHERE status = 'CANCELLED')     AS cancelled,
    (SELECT min(price_usd) FROM flights)                           AS min_price,
    (SELECT max(price_usd) FROM flights)                           AS max_price,
    (SELECT min(departure_time)::date FROM flights)                AS first_day,
    (SELECT max(departure_time)::date FROM flights)                AS last_day;
