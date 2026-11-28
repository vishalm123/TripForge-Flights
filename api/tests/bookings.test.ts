import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { makeTestApp, resetDb } from './helpers.js';

const { app, pool } = await makeTestApp();

beforeEach(async () => { await resetDb(pool); });   // every test starts from the same 5 flights
afterAll(async () => { await app.close(); });       // also closes the pool (onClose hook)

describe('POST /api/bookings', () => {
  it('books 2 passengers: 201 + Location, exact total, and seats are taken', async () => {
    // Arrange
    const payload = {
      flight_id: 'FL-1',                              // $100.00, 150 seats in the fixtures
      contact_email: 'test@example.test',
      passengers: [{ full_name: 'Avery Testwell' }, { full_name: 'Jordan Mockford' }],
    };

    // Act
    const res = await app.inject({ method: 'POST', url: '/api/bookings', payload });

    // Assert: the response
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.booking_id).toMatch(/^BK-[0-9]+$/);
    expect(res.headers.location).toBe(`/api/bookings/${body.booking_id}`);
    expect(body).toMatchObject({
      flight_id: 'FL-1',
      seats: 2,
      total_price_usd: 200,                           // 2 × 100.00, computed by Postgres
      status: 'CONFIRMED',
      contact_email: 'test@example.test',
      passengers: payload.passengers,
      is_synthetic: true,
    });
    expect(body.created_at).toMatch(/Z$/);            // ISO 8601 in UTC

    // Assert: the side effect, seats really went down
    const flight = await app.inject({ method: 'GET', url: '/api/flights/FL-1' });
    expect(flight.json().available_seats).toBe(148);
  });

  it('returns 404 NOT_FOUND for an unknown flight and books nothing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      payload: { flight_id: 'FL-999', contact_email: 'test@example.test', passengers: [{ full_name: 'X' }] },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Flight FL-999 not found' } });
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM bookings');
    expect(rows[0].n).toBe(0);
  });

  it('returns 409 SOLD_OUT with the real seats left and changes nothing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      payload: { flight_id: 'FL-3', contact_email: 'test@example.test', passengers: [{ full_name: 'X' }] },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: { code: 'SOLD_OUT', message: 'Only 0 seat(s) left on FL-3' } });
    const flight = await app.inject({ method: 'GET', url: '/api/flights/FL-3' });
    expect(flight.json().available_seats).toBe(0);
  });

  it('reports the real number left when asking for more seats than remain', async () => {
    // FL-5 has 5 seats: book 4, then ask for 2 → only 1 left
    const book = (n: number) => app.inject({
      method: 'POST',
      url: '/api/bookings',
      payload: {
        flight_id: 'FL-5',
        contact_email: 'test@example.test',
        passengers: Array.from({ length: n }, (_, i) => ({ full_name: `P${i}` })),
      },
    });
    expect((await book(4)).statusCode).toBe(201);

    const res = await book(2);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toBe('Only 1 seat(s) left on FL-5');
  });

  it('rejects 10 passengers with a contract-shaped 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      payload: {
        flight_id: 'FL-1',
        contact_email: 'test@example.test',
        passengers: Array.from({ length: 10 }, (_, i) => ({ full_name: `P${i}` })),
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details[0].field).toBe('passengers');
  });

  it('rejects an invalid email with a contract-shaped 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      payload: { flight_id: 'FL-1', contact_email: 'not-an-email', passengers: [{ full_name: 'X' }] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.details[0].field).toBe('contact_email');
  });

  it('never overbooks: 20 concurrent bookings for 5 seats → exactly 5 succeed', async () => {
    // FL-5 has exactly 5 seats. Fire 20 one-passenger bookings at the same time.
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        app.inject({
          method: 'POST',
          url: '/api/bookings',
          payload: { flight_id: 'FL-5', contact_email: 'race@example.test', passengers: [{ full_name: `Racer ${i}` }] },
        }),
      ),
    );

    const created = results.filter((r) => r.statusCode === 201).length;
    const soldOut = results.filter((r) => r.statusCode === 409).length;
    expect(created).toBe(5);
    expect(soldOut).toBe(15);

    // Seats end at exactly 0 (never negative) …
    const flight = await app.inject({ method: 'GET', url: '/api/flights/FL-5' });
    expect(flight.json().available_seats).toBe(0);

    // … and the database agrees: 5 bookings, 5 passenger rows, nothing half-written.
    const { rows } = await pool.query(
      `SELECT (SELECT count(*)::int FROM bookings WHERE flight_id = 'FL-5') AS bookings,
              (SELECT count(*)::int FROM booking_passengers p JOIN bookings b USING (booking_id)
                WHERE b.flight_id = 'FL-5') AS passengers`,
    );
    expect(rows[0]).toEqual({ bookings: 5, passengers: 5 });
  });
});

describe('GET /api/bookings/:booking_id', () => {
  it('returns the booking created by POST, via its Location header', async () => {
    const passengers = [{ full_name: 'Avery Testwell' }, { full_name: 'Jordan Mockford' }];
    const created = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      payload: { flight_id: 'FL-2', contact_email: 'test@example.test', passengers },
    });
    const location = created.headers.location as string;

    const res = await app.inject({ method: 'GET', url: location });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      booking_id: created.json().booking_id,
      flight_id: 'FL-2',
      seats: 2,
      total_price_usd: 501,                           // 2 × 250.50: the cents add up exactly
      passengers,                                     // same names, same order
    });
  });

  it('returns 404 NOT_FOUND for an unknown booking', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bookings/BK-999999' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Booking BK-999999 not found' } });
  });

  it('returns 400 for a malformed booking id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/bookings/abc' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details[0].field).toBe('booking_id');
  });
});
