import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { createPool } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { makeTestApp } from './helpers.js';

const { app } = await makeTestApp();

// A second app whose pool points at a port where nothing listens: the DB is "down".
const config = loadConfig();
const downApp = await buildApp({
  config,
  pool: createPool({ ...config, databaseUrl: 'postgres://nobody:nothing@127.0.0.1:1/none' }),
});

afterAll(async () => {
  await app.close();
  await downApp.close();
});

describe('GET /health', () => {
  it('returns 200 ok when the database is reachable', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'ok' });
  });

  it('returns 503 degraded (not a crash) when the database is unreachable', async () => {
    const res = await downApp.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', db: 'error' });
  });
});
