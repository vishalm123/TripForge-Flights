import type { Pool } from 'pg';

export interface FlightSearchFilters {
  origin: string;
  destination: string;
  date?: string;     // 'YYYY-MM-DD' or undefined
  limit: number;
  offset: number;
}

export interface FlightRow {
  flight_id: string;
  airline: string;
  airline_code: string;
  flight_number: string;
  origin: string;
  destination: string;
  departure_time: Date;      // pg turns TIMESTAMPTZ into a JS Date
  arrival_time: Date;
  duration_minutes: number;
  price_usd: string;         // pg returns NUMERIC as a STRING
  available_seats: number;
  is_synthetic: boolean;
}

const SEARCH_SQL = `
  SELECT f.flight_id,
         a.name AS airline,
         f.airline_code,
         f.flight_number,
         f.origin,
         f.destination,
         f.departure_time,
         f.arrival_time,
         (EXTRACT(EPOCH FROM (f.arrival_time - f.departure_time)) / 60)::int AS duration_minutes,
         f.price_usd,
         f.available_seats,
         f.is_synthetic
  FROM flights f
  JOIN airlines a ON a.code = f.airline_code
  WHERE f.origin = $1
    AND f.destination = $2
    AND f.available_seats > 0
    AND ($3::date IS NULL OR (
          f.departure_time >= ($3::date)::timestamp AT TIME ZONE 'UTC'
      AND f.departure_time <  ($3::date + 1)::timestamp AT TIME ZONE 'UTC'
    ))
  ORDER BY f.price_usd, f.departure_time, f.flight_id
  LIMIT $4 OFFSET $5
`;

export async function searchFlights(pool: Pool, filters: FlightSearchFilters): Promise<FlightRow[]>  {
  const result = await pool.query<FlightRow>(SEARCH_SQL, [
    filters.origin,
    filters.destination,
    filters.date ?? null,     // undefined → null, so `$3 IS NULL` works
    filters.limit,
    filters.offset,
  ]);
  return result.rows;
};