import { config } from '../src/config/env.js';
import { logger } from '../src/config/logger.js';
import { prisma } from '../src/db/prisma.js';
import { createWhatsAppService } from '../src/modules/whatsapp/whatsapp.service.js';

try {
  if (!config.whatsappCloudConfigured) {
    logger.info('WhatsApp Cloud API is not configured; nothing to process.');
  } else {
    const processed = await createWhatsAppService({ prisma, config, logger }).processDue({ limit: 50 });
    logger.info({ processed }, 'WhatsApp outbox processed');
  }
} finally {
  await prisma.$disconnect();
}
