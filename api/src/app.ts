import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { AppConfig } from './config.js';
import { healthRoutes } from './routes/health.js';
import { flightRoutes } from './routes/flights.js';
import { registerErrorHandlers } from './errors.js';



interface BuildAppOptions {
  config: AppConfig;
  pool: Pool;
}

export async function buildApp({ config, pool }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
  });

  // Register the health plugin and hand it the pool via plugin options
  registerErrorHandlers(app);
  await app.register( healthRoutes, { pool });
  await app.register( flightRoutes, { pool });
    
  // When the app closes (Ctrl+C in Step 7, or app.close() in tests), close the DB pool too
  app.addHook('onClose', async () => {
      await pool.end();
  });

  return app;   // NO app.listen() here
}