import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { makeTestApp, resetDb } from './helpers.js';

const { app, pool } = await makeTestApp();

beforeEach(async () => { await resetDb(pool); });   // every test starts from the same 5 flights
afterAll(async () => { await app.close(); });       // also closes the pool (onClose hook)

const ids = (body: { data: { flight_id: string }[] }) => body.data.map((f) => f.flight_id);

describe('GET /api/flights', () => {
  it('returns available flights cheapest first, with exact prices', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/flights?origin=JFK&destination=LAX' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(ids(body)).toEqual(['FL-1', 'FL-4', 'FL-2']);
    expect(body.data[2].price_usd).toBe(250.5);                       // a number, cents kept
    expect(body.pagination).toEqual({ limit: 20, offset: 0, total: 3 });
  });

  it('filters by departure date (UTC day)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/flights?origin=JFK&destination=LAX&date=2027-03-15' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(ids(body)).toEqual(['FL-1', 'FL-2']);
    expect(body.data[0].departure_time).toBe('2027-03-15T08:00:00.000Z');
    expect(body.pagination).toEqual({ limit: 20, offset: 0, total: 2 });
  });

  it('includes sold-out flights only when include_full=true', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/flights?origin=JFK&destination=LAX&include_full=true' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(ids(body)).toEqual(['FL-3', 'FL-1', 'FL-4', 'FL-2']);
    expect(body.data[0]).toMatchObject({ price_usd: 90, available_seats: 0 });
    expect(body.pagination).toEqual({ limit: 20, offset: 0, total: 4 });
  });

  it('filters by max_price (inclusive) and still hides sold-out flights', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/flights?origin=JFK&destination=LAX&max_price=150' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(ids(body)).toEqual(['FL-1']);
    expect(body.data[0].price_usd).toBe(100);
    expect(body.pagination).toEqual({ limit: 20, offset: 0, total: 1 });
  });

  it('sorts by departure time when sort=departure', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/flights?origin=JFK&destination=LAX&sort=departure' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(ids(body)).toEqual(['FL-1', 'FL-2', 'FL-4']);
    expect(body.pagination).toEqual({ limit: 20, offset: 0, total: 3 });
  });

  it('paginates: limit=1&offset=1 returns the second cheapest, total still 3', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/flights?origin=JFK&destination=LAX&limit=1&offset=1' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(ids(body)).toEqual(['FL-4']);
    expect(body.data[0].price_usd).toBe(199.99);
    expect(body.pagination).toEqual({ limit: 1, offset: 1, total: 3 });
  });

  it('rejects the same origin and destination with a contract-shaped 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/flights?origin=JFK&destination=JFK' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'origin and destination must differ',
        details: [{ field: 'destination', issue: 'must differ from origin' }],
      },
    });
  });

  it('rejects limit above 100 with a 400 naming the field', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/flights?origin=JFK&destination=LAX&limit=500' });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details[0].field).toBe('limit');
  });
});

describe('GET /api/flights/:flight_id', () => {
  it('returns one flight (no data wrapper) with exact price and ISO time', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/flights/FL-2' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.flight_id).toBe('FL-2');
    expect(body.price_usd).toBe(250.5);
    expect(body.departure_time).toBe('2027-03-15T12:00:00.000Z');
    expect(body).not.toHaveProperty('data');
  });

  it('returns 404 NOT_FOUND for an unknown flight', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/flights/FL-999' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Flight FL-999 not found' } });
  });
});

describe('unknown routes', () => {
  it('return a contract-shaped 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Route GET /api/nope not found' } });
  });
});
