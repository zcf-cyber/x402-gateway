import { loadConfig } from './config.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp(config);

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`x402 gateway listening on ${config.host}:${config.port}`);
  } catch (err) {
    app.log.fatal(err);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Received ${signal}, shutting down gracefully...`);
    await app.close();
    // TODO: Close Redis and PostgreSQL connections here
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server:', err);
  process.exit(1);
});
