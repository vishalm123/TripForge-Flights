import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';

interface HealthOptions {
  pool: Pool;
}

export const healthRoutes: FastifyPluginAsync<HealthOptions> = async (app, opts) => {
  app.get('/health', async (request, reply) => {
    try {
        await opts.pool.query('SELECT 1');
        return {status: 'ok', db: 'ok'};
    } catch (err) {
      request.log.error({ err }, 'health check: database unreachable');
      return reply.code(503).send({status: 'degraded', db: 'error'});
    }
  });
};