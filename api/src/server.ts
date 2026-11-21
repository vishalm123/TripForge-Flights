import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config);
  const app = await buildApp({ config, pool });

  // Graceful shutdown: Ctrl+C sends SIGINT; Docker/Kubernetes send SIGTERM
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      app.log.info({ signal }, 'shutting down');
      await app.close();
      process.exit(0);
    });
  }

    await app.listen({ port: config.port, host: "0.0.0.0" } );
}

main().catch((err) => {
  console.error('fatal startup error:', err);
  process.exit(1);
});