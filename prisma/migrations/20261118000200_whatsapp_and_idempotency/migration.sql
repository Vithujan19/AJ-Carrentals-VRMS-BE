-- AlterTable
ALTER TABLE `Booking` ADD COLUMN `whatsappConsent` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `whatsappConsentAt` DATETIME(3) NULL,
    ADD COLUMN `whatsappConsentRevokedAt` DATETIME(3) NULL,
    ADD COLUMN `whatsappConsentSource` VARCHAR(40) NULL,
    ADD COLUMN `whatsappOpenedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `WhatsAppMessage` (
    `id` CHAR(36) NOT NULL,
    `bookingId` CHAR(36) NOT NULL,
    `category` VARCHAR(40) NOT NULL,
    `provider` VARCHAR(40) NOT NULL,
    `templateName` VARCHAR(120) NOT NULL,
    `recipient` VARCHAR(32) NOT NULL,
    `status` ENUM('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `providerMessageId` VARCHAR(191) NULL,
    `errorCode` VARCHAR(80) NULL,
    `errorMessage` VARCHAR(500) NULL,
    `retryCount` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NULL,
    `sentAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WhatsAppMessage_providerMessageId_key`(`providerMessageId`),
    INDEX `WhatsAppMessage_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    UNIQUE INDEX `WhatsAppMessage_bookingId_category_key`(`bookingId`, `category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IdempotencyKey` (
    `id` CHAR(36) NOT NULL,
    `scope` VARCHAR(40) NOT NULL,
    `keyHash` CHAR(64) NOT NULL,
    `requestHash` CHAR(64) NOT NULL,
    `bookingId` CHAR(36) NULL,
    `responseBody` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `IdempotencyKey_expiresAt_idx`(`expiresAt`),
    UNIQUE INDEX `IdempotencyKey_scope_keyHash_key`(`scope`, `keyHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `WhatsAppMessage` ADD CONSTRAINT `WhatsAppMessage_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

