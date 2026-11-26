import type { Pool } from 'pg';

export interface Customer {
  full_name: string;
}

// What the client sends. Seats = number of passengers, so the two can never disagree.
export interface NewBooking {
  flight_id: string;
  contact_email: string;
  passengers: Customer[];
}

// What the repository returns (database types, not yet API types).
export interface BookingRow {
  booking_id: string;
  flight_id: string;
  seats: number;
  total_price_usd: string;   // NUMERIC → string from pg
  status: string;
  contact_email: string;
  passengers: Customer[];
  created_at: Date;          // TIMESTAMPTZ → Date from pg
  is_synthetic: boolean;
}

// Check-and-decrement in ONE statement: the row lock makes concurrent bookings
// queue up and re-check `available_seats >= $2`, so seats can never go negative.
const bookSql = `
  UPDATE flights
  SET available_seats = available_seats - $2
  WHERE flight_id = $1 AND available_seats >= $2
  RETURNING price_usd
`;

// Money math happens in Postgres (NUMERIC), never in JavaScript floats.
// $2 is cast to int in both places: a parameter used in two contexts needs one explicit type.
const insertBookingSql = `
  INSERT INTO bookings (flight_id, seats, total_price_usd, contact_email)
  VALUES ($1, $2::int, $3::numeric * $2::int, $4)
  RETURNING booking_id, total_price_usd, status, created_at
`;

// One round trip for all passengers: unnest turns the text[] into rows.
const insertPassengersSql = `
  INSERT INTO booking_passengers (booking_id, full_name)
  SELECT $1, unnest($2::text[])
`;

export type CreateBookingResult =
  | { status: 'created'; booking: BookingRow }
  | { status: 'not_found' }
  | { status: 'sold_out'; seatsLeft: number };

const getBookingSql = `
  SELECT b.booking_id, b.flight_id, b.seats, b.total_price_usd, b.status,
         b.contact_email, b.created_at, b.is_synthetic,
         json_agg(json_build_object('full_name', p.full_name) ORDER BY p.passenger_id) AS passengers
  FROM bookings b
  JOIN booking_passengers p ON p.booking_id = b.booking_id
  WHERE b.booking_id = $1
  GROUP BY b.booking_id
`;

/**
 * Books seats in a single transaction.
 * Returns null when no seats were taken (flight missing or not enough seats left).
 */
export async function createBooking(pool: Pool, input: NewBooking): Promise<CreateBookingResult> {
  const seats = input.passengers.length;
  const client = await pool.connect();   // one connection for the whole transaction
  try {
    await client.query('BEGIN');

    // 1. Take the seats atomically.
    const seatResult = await client.query<{ price_usd: string }>(bookSql, [
      input.flight_id, // $1
      seats,           // $2
    ]);
      if (seatResult.rowCount === 0) {
        const check = await client.query<{ available_seats: number }>(
            'SELECT available_seats FROM flights WHERE flight_id = $1',
            [input.flight_id],
        );
        await client.query('ROLLBACK');
        const row = check.rows[0];
        if (!row) return { status: 'not_found' };
        return { status:'sold_out', seatsLeft: row.available_seats };
    }
    const price = seatResult.rows[0]!.price_usd;   // safe: rowCount > 0 checked above

    // 2. Insert the booking.
    const bookingResult = await client.query<{
      booking_id: string;
      total_price_usd: string;
      status: string;
      created_at: Date;
    }>(insertBookingSql, [
      input.flight_id,     // $1
      seats,               // $2
      price,               // $3 (string, cast to numeric in SQL)
      input.contact_email, // $4
    ]);
    const booking = bookingResult.rows[0]!;        // INSERT ... RETURNING always returns the row

    // 3. Insert all passengers.
    await client.query(insertPassengersSql, [
      booking.booking_id,                          // $1
      input.passengers.map((p) => p.full_name),    // $2
    ]);

    await client.query('COMMIT');

    return {
        status: 'created',
        booking: {
            booking_id: booking.booking_id,
            flight_id: input.flight_id,
            seats,
            total_price_usd: booking.total_price_usd,
            status: booking.status,
            contact_email: input.contact_email,
            passengers: input.passengers,
            created_at: booking.created_at,
            is_synthetic: true,
        }
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();                    // ALWAYS give the connection back
  }
}


export async function getBookingById(pool: Pool, bookingId: string): Promise<BookingRow | null> {
  const result = await pool.query<BookingRow>(getBookingSql, [bookingId]);
  return result.rows[0] ?? null;
}