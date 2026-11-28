import { buildApp } from '../src/app.js';
import { createPool } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import type { Pool } from 'pg';

export const FIXTURES_SQL = `
  TRUNCATE booking_passengers, bookings, flights, airlines, airports RESTART IDENTITY CASCADE;
  INSERT INTO airports (code, city_code, city_name, name) VALUES
    ('JFK','NYC','New York','Test JFK'), ('LAX','LAX','Los Angeles','Test LAX');
  INSERT INTO airlines (code, name) VALUES ('DA','Demo Airways');
  INSERT INTO flights (flight_id, airline_code, flight_number, origin, destination,
                       departure_time, arrival_time, price_usd, total_seats, available_seats) VALUES
    ('FL-1','DA','DA1','JFK','LAX','2027-03-15T08:00:00Z','2027-03-15T14:00:00Z',100.00,150,150),
    ('FL-2','DA','DA2','JFK','LAX','2027-03-15T12:00:00Z','2027-03-15T18:00:00Z',250.50,150,150),
    ('FL-3','DA','DA3','JFK','LAX','2027-03-15T16:00:00Z','2027-03-15T22:00:00Z', 90.00,150,  0),
    ('FL-4','DA','DA4','JFK','LAX','2027-03-16T09:00:00Z','2027-03-16T15:00:00Z',199.99,150,150),
    ('FL-5','DA','DA5','LAX','JFK','2027-03-15T10:00:00Z','2027-03-15T16:00:00Z',120.00,  5,  5);
`;

export async function resetDb(pool: Pool): Promise<void> {
  await pool.query(FIXTURES_SQL);    // one call runs all the statements in the string
}

export async function makeTestApp() {
  const config = loadConfig();
  const pool = createPool(config);
  const app = await buildApp({ config, pool });
  return { app, pool };
}