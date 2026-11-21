-- migrate:up

-- Reference data -------------------------------------------------------------

CREATE TABLE airports (
    code       CHAR(3) PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
    city_code  CHAR(3) NOT NULL    CHECK (city_code ~ '^[A-Z]{3}$'),  -- shared TripForge city code (NYC, LAX, ...)
    city_name  TEXT    NOT NULL,
    name       TEXT    NOT NULL
);

CREATE TABLE airlines (
    code  CHAR(2) PRIMARY KEY CHECK (code ~ '^[A-Z0-9]{2}$'),
    name  TEXT    NOT NULL UNIQUE
);

-- Inventory ------------------------------------------------------------------

CREATE TABLE flights (
    flight_id        TEXT          PRIMARY KEY CHECK (flight_id ~ '^FL-[0-9]+$'),
    airline_code     CHAR(2)       NOT NULL REFERENCES airlines (code),
    flight_number    TEXT          NOT NULL,
    origin           CHAR(3)       NOT NULL REFERENCES airports (code),
    destination      CHAR(3)       NOT NULL REFERENCES airports (code),
    departure_time   TIMESTAMPTZ   NOT NULL,
    arrival_time     TIMESTAMPTZ   NOT NULL,
    price_usd        NUMERIC(10,2) NOT NULL CHECK (price_usd >= 0),
    total_seats      INTEGER       NOT NULL CHECK (total_seats > 0),
    available_seats  INTEGER       NOT NULL,
    is_synthetic     BOOLEAN       NOT NULL DEFAULT TRUE CHECK (is_synthetic),

    CONSTRAINT flights_route_differs     CHECK (origin <> destination),
    CONSTRAINT flights_arrival_after_dep CHECK (arrival_time > departure_time),
    -- Last line of defence against overbooking: the DB refuses negative inventory.
    CONSTRAINT flights_seats_in_range    CHECK (available_seats BETWEEN 0 AND total_seats),
    CONSTRAINT flights_number_unique_per_departure UNIQUE (airline_code, flight_number, departure_time)
);

-- The main search: WHERE origin = ? AND destination = ? AND departure_time in [day, day+1)
CREATE INDEX flights_search_idx ON flights (origin, destination, departure_time);

-- Simulated bookings ---------------------------------------------------------

CREATE SEQUENCE booking_number_seq START 100000;

CREATE TABLE bookings (
    booking_id       TEXT          PRIMARY KEY DEFAULT ('BK-' || nextval('booking_number_seq'))
                                   CHECK (booking_id ~ '^BK-[0-9]+$'),
    flight_id        TEXT          NOT NULL REFERENCES flights (flight_id),
    seats            INTEGER       NOT NULL CHECK (seats BETWEEN 1 AND 9),
    total_price_usd  NUMERIC(10,2) NOT NULL CHECK (total_price_usd >= 0),
    contact_email    TEXT          NOT NULL CHECK (length(contact_email) <= 254 AND contact_email LIKE '%_@_%'),
    status           TEXT          NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED', 'CANCELLED')),
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    is_synthetic     BOOLEAN       NOT NULL DEFAULT TRUE CHECK (is_synthetic)
);

ALTER SEQUENCE booking_number_seq OWNED BY bookings.booking_id;

CREATE INDEX bookings_flight_idx ON bookings (flight_id);

CREATE TABLE booking_passengers (
    passenger_id  BIGSERIAL PRIMARY KEY,
    booking_id    TEXT      NOT NULL REFERENCES bookings (booking_id) ON DELETE CASCADE,
    full_name     TEXT      NOT NULL CHECK (length(full_name) BETWEEN 1 AND 100)
);

CREATE INDEX booking_passengers_booking_idx ON booking_passengers (booking_id);

-- migrate:down

DROP TABLE booking_passengers;
DROP TABLE bookings;
DROP TABLE flights;
DROP TABLE airlines;
DROP TABLE airports;
