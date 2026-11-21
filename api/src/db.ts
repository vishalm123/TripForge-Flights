import { Pool } from 'pg';
import type { AppConfig } from './config.js';  


export function createPool(config: AppConfig): Pool {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    connectionTimeoutMillis: 2000, 
    idleTimeoutMillis: 30000 ,
    statement_timeout: config.dbStatementTimeoutMs ,
    application_name: 'skymock-api',   // shows up in Postgres's pg_stat_activity: handy for debugging
  });

  // Trap #2: without this listener, an idle connection dying (e.g. Postgres restarts)
  // emits 'error' with no listener → Node crashes the whole process.
  pool.on("error", (err) => {
      console.error('pg pool error:', err.message)
  });

  return pool;
}