import type { Pool } from 'pg';

const ORDER_BY = {
  price:     'f.price_usd, f.departure_time, f.flight_id',
  departure: 'f.departure_time, f.price_usd, f.flight_id',
} as const;

const WHERE = `
  WHERE f.origin = $1
    AND f.destination = $2
    AND ($3::date IS NULL OR (
          f.departure_time >= ($3::date)::timestamp AT TIME ZONE 'UTC'
      AND f.departure_time <  ($3::date + 1)::timestamp AT TIME ZONE 'UTC'
    ))
    AND ($4::boolean OR f.available_seats > 0)
    AND ($5::numeric IS NULL OR f.price_usd <= $5)
`;

const SELECT_FROM = `
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
`;

// No JOIN / ORDER BY / LIMIT needed: counts every row matching the same filters.
const COUNT_SQL = `SELECT count(*) AS total FROM flights f ${WHERE}`;

export interface FlightSearchFilters {
  origin: string;
  destination: string;
  date?: string;                   // 'YYYY-MM-DD' or undefined
  sort: keyof typeof ORDER_BY;     // 'price' | 'departure', derived from the map
  include_full: boolean;
  max_price?: number;              // optional, like date
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

export async function searchFlights(pool: Pool, filters: FlightSearchFilters): Promise<{ rows: FlightRow[]; total: number }>  {
  // Built per request because ORDER BY depends on filters.sort. Only strings from the
  // ORDER_BY allow-list reach the SQL text; all user values go through $n placeholders.
  const orderBy = ORDER_BY[filters.sort];
  if (!orderBy) {
    throw new Error(`invalid sort: ${String(filters.sort)}`);   // defence in depth: schema already rejects this
  }
  const pageSql = `${SELECT_FROM} ${WHERE} ORDER BY ${orderBy} LIMIT $6 OFFSET $7`;

  const whereValues = [
    filters.origin,             // $1
    filters.destination,        // $2
    filters.date ?? null,       // $3
    filters.include_full,       // $4
    filters.max_price ?? null,  // $5
  ];

  const [pageResult, countResult] = await Promise.all([
    pool.query<FlightRow>(pageSql, [...whereValues, filters.limit, filters.offset]),  // $6, $7
    pool.query<{ total: string }>(COUNT_SQL, whereValues),
  ]);

  return {
    rows: pageResult.rows,
    // count(*) is bigint → pg returns a string. At most ~10k flights, so Number() is exact.
    total: Number(countResult.rows[0]?.total ?? 0),
  };
}

