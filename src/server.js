import { createApp } from './app.js';
import { config } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './db/prisma.js';

const app = createApp();

async function start() {
  try {
    await prisma.$connect();
    const server = app.listen(config.PORT, () => {
      logger.info({ event: 'server_started', port: config.PORT });
    });

    let shuttingDown = false;
    const shutdown = (signal) => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      logger.info({ event: 'server_shutdown_started', signal });
      server.close(async (error) => {
        if (error) {
          logger.error({ err: error, event: 'server_shutdown_failed' });
          process.exitCode = 1;
        }
        await prisma.$disconnect();
      });
    };
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    logger.fatal({ err: error, event: 'server_start_failed' });
    process.exitCode = 1;
    await prisma.$disconnect();
  }
}

start().catch((error) => {
  logger.error({ err: error, event: 'server_shutdown_failed' });
  process.exitCode = 1;
});
