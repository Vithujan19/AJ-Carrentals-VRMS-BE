-- CreateTable
CREATE TABLE `StaffUser` (
    `id` CHAR(36) NOT NULL,
    `emailNormalized` VARCHAR(254) NOT NULL,
    `displayName` VARCHAR(160) NOT NULL,
    `mobileNumber` VARCHAR(32) NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `failedLoginCount` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `lastFailedLoginAt` DATETIME(3) NULL,
    `passwordChangedAt` DATETIME(3) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `lockedUntil` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deactivatedAt` DATETIME(3) NULL,

    UNIQUE INDEX `StaffUser_emailNormalized_key`(`emailNormalized`),
    INDEX `StaffUser_status_deactivatedAt_idx`(`status`, `deactivatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Role` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(500) NULL,
    `isSystem` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Role_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Permission` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(100) NOT NULL,
    `description` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Permission_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StaffRole` (
    `staffUserId` CHAR(36) NOT NULL,
    `roleId` CHAR(36) NOT NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `StaffRole_roleId_staffUserId_idx`(`roleId`, `staffUserId`),
    PRIMARY KEY (`staffUserId`, `roleId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RolePermission` (
    `roleId` CHAR(36) NOT NULL,
    `permissionId` CHAR(36) NOT NULL,
    `grantedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RolePermission_permissionId_roleId_idx`(`permissionId`, `roleId`),
    PRIMARY KEY (`roleId`, `permissionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StaffSession` (
    `id` CHAR(36) NOT NULL,
    `staffUserId` CHAR(36) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastUsedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `ipAddress` VARCHAR(45) NULL,
    `userAgent` VARCHAR(512) NULL,

    UNIQUE INDEX `StaffSession_tokenHash_key`(`tokenHash`),
    INDEX `StaffSession_staffUserId_revokedAt_expiresAt_idx`(`staffUserId`, `revokedAt`, `expiresAt`),
    INDEX `StaffSession_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StaffPasswordResetToken` (
    `id` CHAR(36) NOT NULL,
    `staffUserId` CHAR(36) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `invalidatedAt` DATETIME(3) NULL,
    `requestedIp` VARCHAR(45) NULL,

    UNIQUE INDEX `StaffPasswordResetToken_tokenHash_key`(`tokenHash`),
    INDEX `StaffPasswordResetToken_staffUserId_usedAt_invalidatedAt_exp_idx`(`staffUserId`, `usedAt`, `invalidatedAt`, `expiresAt`),
    INDEX `StaffPasswordResetToken_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Vehicle` (
    `id` CHAR(36) NOT NULL,
    `registrationNumber` VARCHAR(24) NOT NULL,
    `vin` VARCHAR(64) NULL,
    `chassisNumber` VARCHAR(64) NULL,
    `engineNumber` VARCHAR(64) NULL,
    `acquisitionDate` DATE NULL,
    `currentOdometerKm` INTEGER UNSIGNED NULL,
    `description` TEXT NULL,
    `publicDescription` TEXT NULL,
    `internalNotes` TEXT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'RETIRED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `archivedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Vehicle_registrationNumber_key`(`registrationNumber`),
    UNIQUE INDEX `Vehicle_vin_key`(`vin`),
    UNIQUE INDEX `Vehicle_chassisNumber_key`(`chassisNumber`),
    UNIQUE INDEX `Vehicle_engineNumber_key`(`engineNumber`),
    INDEX `Vehicle_status_archivedAt_idx`(`status`, `archivedAt`),
    INDEX `Vehicle_status_currentOdometerKm_idx`(`status`, `currentOdometerKm`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VehicleStaffAssignment` (
    `id` CHAR(36) NOT NULL,
    `vehicleId` CHAR(36) NOT NULL,
    `staffUserId` CHAR(36) NOT NULL,
    `assignedByStaffId` CHAR(36) NULL,
    `revokedByStaffId` CHAR(36) NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,

    INDEX `VehicleStaffAssignment_staffUserId_revokedAt_expiresAt_idx`(`staffUserId`, `revokedAt`, `expiresAt`),
    INDEX `VehicleStaffAssignment_vehicleId_revokedAt_expiresAt_idx`(`vehicleId`, `revokedAt`, `expiresAt`),
    UNIQUE INDEX `VehicleStaffAssignment_vehicleId_staffUserId_assignedAt_key`(`vehicleId`, `staffUserId`, `assignedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VehicleSpecification` (
    `id` CHAR(36) NOT NULL,
    `vehicleId` CHAR(36) NOT NULL,
    `make` VARCHAR(80) NOT NULL,
    `model` VARCHAR(100) NOT NULL,
    `variant` VARCHAR(100) NULL,
    `category` ENUM('SEDAN', 'HATCHBACK', 'SUV', 'VAN', 'PICKUP', 'WAGON', 'COUPE', 'OTHER') NULL,
    `manufacturingYear` SMALLINT UNSIGNED NULL,
    `engineCapacityCc` SMALLINT UNSIGNED NULL,
    `fuelType` ENUM('PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC', 'LPG', 'OTHER') NOT NULL,
    `transmission` ENUM('MANUAL', 'AUTOMATIC', 'OTHER') NOT NULL,
    `colour` VARCHAR(50) NULL,
    `seatingCapacity` TINYINT UNSIGNED NULL,
    `numberOfDoors` TINYINT UNSIGNED NULL,
    `bodyType` VARCHAR(60) NULL,
    `driveType` ENUM('FWD', 'RWD', 'AWD', 'FOUR_WD', 'OTHER') NULL,
    `hasAirConditioning` BOOLEAN NULL,
    `features` JSON NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `VehicleSpecification_vehicleId_key`(`vehicleId`),
    INDEX `VehicleSpecification_make_model_manufacturingYear_idx`(`make`, `model`, `manufacturingYear`),
    INDEX `VehicleSpecification_fuelType_transmission_idx`(`fuelType`, `transmission`),
    INDEX `VehicleSpecification_category_make_model_idx`(`category`, `make`, `model`),
    INDEX `VehicleSpecification_engineCapacityCc_idx`(`engineCapacityCc`),
    INDEX `VehicleSpecification_seatingCapacity_idx`(`seatingCapacity`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VehicleStatusHistory` (
    `id` CHAR(36) NOT NULL,
    `vehicleId` CHAR(36) NOT NULL,
    `changedByStaffId` CHAR(36) NULL,
    `fromStatus` ENUM('ACTIVE', 'INACTIVE', 'RETIRED') NULL,
    `toStatus` ENUM('ACTIVE', 'INACTIVE', 'RETIRED') NOT NULL,
    `reason` VARCHAR(1000) NULL,
    `changedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `VehicleStatusHistory_vehicleId_changedAt_idx`(`vehicleId`, `changedAt`),
    INDEX `VehicleStatusHistory_changedByStaffId_changedAt_idx`(`changedByStaffId`, `changedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VehicleImage` (
    `id` CHAR(36) NOT NULL,
    `vehicleId` CHAR(36) NOT NULL,
    `uploadedByStaffId` CHAR(36) NULL,
    `storageKey` VARCHAR(512) NOT NULL,
    `mimeType` VARCHAR(100) NOT NULL DEFAULT 'image/jpeg',
    `sizeBytes` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `sha256` CHAR(64) NULL,
    `caption` VARCHAR(255) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    `isPublished` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `archivedAt` DATETIME(3) NULL,

    UNIQUE INDEX `VehicleImage_storageKey_key`(`storageKey`),
    INDEX `VehicleImage_vehicleId_isPublished_sortOrder_idx`(`vehicleId`, `isPublished`, `sortOrder`),
    INDEX `VehicleImage_vehicleId_isPrimary_archivedAt_idx`(`vehicleId`, `isPrimary`, `archivedAt`),
    INDEX `VehicleImage_uploadedByStaffId_createdAt_idx`(`uploadedByStaffId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VehicleDocument` (
    `id` CHAR(36) NOT NULL,
    `vehicleId` CHAR(36) NOT NULL,
    `uploadedByStaffId` CHAR(36) NULL,
    `documentType` ENUM('REGISTRATION', 'INSURANCE', 'REVENUE_LICENSE', 'EMISSION_CERTIFICATE', 'PURCHASE_DOCUMENT', 'SERVICE_RECORD', 'OTHER') NOT NULL,
    `storageKey` VARCHAR(512) NOT NULL,
    `originalName` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `sizeBytes` BIGINT UNSIGNED NOT NULL,
    `sha256` CHAR(64) NULL,
    `issueDate` DATE NULL,
    `expiresAt` DATE NULL,
    `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `archivedAt` DATETIME(3) NULL,

    UNIQUE INDEX `VehicleDocument_storageKey_key`(`storageKey`),
    INDEX `VehicleDocument_vehicleId_documentType_expiresAt_idx`(`vehicleId`, `documentType`, `expiresAt`),
    INDEX `VehicleDocument_vehicleId_archivedAt_expiresAt_idx`(`vehicleId`, `archivedAt`, `expiresAt`),
    INDEX `VehicleDocument_uploadedByStaffId_uploadedAt_idx`(`uploadedByStaffId`, `uploadedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VehicleMileageReading` (
    `id` CHAR(36) NOT NULL,
    `vehicleId` CHAR(36) NOT NULL,
    `recordedByStaffId` CHAR(36) NOT NULL,
    `readingKm` INTEGER UNSIGNED NOT NULL,
    `previousOdometerKm` INTEGER UNSIGNED NULL,
    `source` ENUM('MANUAL', 'CORRECTION') NOT NULL,
    `reason` VARCHAR(1000) NULL,
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `VehicleMileageReading_vehicleId_recordedAt_idx`(`vehicleId`, `recordedAt`),
    INDEX `VehicleMileageReading_recordedByStaffId_recordedAt_idx`(`recordedByStaffId`, `recordedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RentalPackage` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `rentalPeriod` ENUM('DAILY', 'WEEKLY', 'MONTHLY') NOT NULL,
    `durationCount` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    `conditions` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RentalPackage_code_key`(`code`),
    INDEX `RentalPackage_isActive_rentalPeriod_idx`(`isActive`, `rentalPeriod`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VehicleRate` (
    `id` CHAR(36) NOT NULL,
    `vehicleId` CHAR(36) NOT NULL,
    `rentalPackageId` CHAR(36) NOT NULL,
    `rentalPrice` DECIMAL(12, 2) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'LKR',
    `includedMileageKm` INTEGER UNSIGNED NOT NULL,
    `additionalKmRate` DECIMAL(12, 2) NOT NULL,
    `securityDeposit` DECIMAL(12, 2) NOT NULL,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `effectiveTo` DATETIME(3) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `VehicleRate_vehicleId_rentalPackageId_isActive_effectiveFrom_idx`(`vehicleId`, `rentalPackageId`, `isActive`, `effectiveFrom`),
    INDEX `VehicleRate_effectiveTo_idx`(`effectiveTo`),
    UNIQUE INDEX `VehicleRate_vehicleId_rentalPackageId_effectiveFrom_key`(`vehicleId`, `rentalPackageId`, `effectiveFrom`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PricingRule` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(60) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `ruleType` ENUM('FIXED_DISCOUNT', 'PERCENT_DISCOUNT', 'FIXED_SURCHARGE', 'PERCENT_SURCHARGE') NOT NULL,
    `value` DECIMAL(12, 2) NOT NULL,
    `vehicleId` CHAR(36) NULL,
    `rentalPackageId` CHAR(36) NULL,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `effectiveTo` DATETIME(3) NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PricingRule_code_key`(`code`),
    INDEX `PricingRule_isActive_effectiveFrom_effectiveTo_priority_idx`(`isActive`, `effectiveFrom`, `effectiveTo`, `priority`),
    INDEX `PricingRule_vehicleId_isActive_effectiveFrom_idx`(`vehicleId`, `isActive`, `effectiveFrom`),
    INDEX `PricingRule_rentalPackageId_isActive_effectiveFrom_idx`(`rentalPackageId`, `isActive`, `effectiveFrom`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Customer` (
    `id` CHAR(36) NOT NULL,
    `fullName` VARCHAR(160) NOT NULL,
    `mobileNumber` VARCHAR(32) NOT NULL,
    `whatsappNumber` VARCHAR(32) NULL,
    `email` VARCHAR(254) NULL,
    `addressLine1` VARCHAR(160) NULL,
    `addressLine2` VARCHAR(160) NULL,
    `city` VARCHAR(100) NULL,
    `nicCiphertext` VARCHAR(1024) NULL,
    `nicLookupHash` CHAR(64) NULL,
    `drivingLicenceCiphertext` VARCHAR(1024) NULL,
    `licenceLookupHash` CHAR(64) NULL,
    `licenceExpiryDate` DATE NULL,
    `internalNotes` TEXT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'FLAGGED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `archivedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Customer_nicLookupHash_key`(`nicLookupHash`),
    UNIQUE INDEX `Customer_licenceLookupHash_key`(`licenceLookupHash`),
    INDEX `Customer_mobileNumber_idx`(`mobileNumber`),
    INDEX `Customer_whatsappNumber_idx`(`whatsappNumber`),
    INDEX `Customer_email_idx`(`email`),
    INDEX `Customer_fullName_idx`(`fullName`),
    INDEX `Customer_status_archivedAt_idx`(`status`, `archivedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerContact` (
    `id` CHAR(36) NOT NULL,
    `customerId` CHAR(36) NOT NULL,
    `contactType` ENUM('EMERGENCY', 'ALTERNATE', 'OTHER') NOT NULL,
    `fullName` VARCHAR(160) NOT NULL,
    `relationship` VARCHAR(80) NULL,
    `phoneNumber` VARCHAR(32) NOT NULL,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `archivedAt` DATETIME(3) NULL,

    INDEX `CustomerContact_customerId_contactType_archivedAt_idx`(`customerId`, `contactType`, `archivedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerDocument` (
    `id` CHAR(36) NOT NULL,
    `customerId` CHAR(36) NOT NULL,
    `documentType` ENUM('NIC_FRONT', 'NIC_BACK', 'DRIVING_LICENCE_FRONT', 'DRIVING_LICENCE_BACK', 'OTHER') NOT NULL,
    `storageKey` VARCHAR(512) NOT NULL,
    `originalName` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `sizeBytes` BIGINT UNSIGNED NOT NULL,
    `sha256` CHAR(64) NULL,
    `expiresAt` DATE NULL,
    `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `archivedAt` DATETIME(3) NULL,

    UNIQUE INDEX `CustomerDocument_storageKey_key`(`storageKey`),
    INDEX `CustomerDocument_customerId_documentType_archivedAt_idx`(`customerId`, `documentType`, `archivedAt`),
    INDEX `CustomerDocument_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BookingReferenceCounter` (
    `year` SMALLINT UNSIGNED NOT NULL,
    `lastSequence` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`year`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Booking` (
    `id` CHAR(36) NOT NULL,
    `referenceYear` SMALLINT UNSIGNED NOT NULL,
    `referenceSequence` INTEGER UNSIGNED NOT NULL,
    `reference` VARCHAR(20) NOT NULL,
    `customerId` CHAR(36) NOT NULL,
    `vehicleId` CHAR(36) NOT NULL,
    `rentalPackageId` CHAR(36) NOT NULL,
    `vehicleRateId` CHAR(36) NULL,
    `rentalPolicyId` CHAR(36) NULL,
    `publicLookupTokenHash` CHAR(64) NULL,
    `createdByStaffId` CHAR(36) NULL,
    `confirmedByStaffId` CHAR(36) NULL,
    `rejectedByStaffId` CHAR(36) NULL,
    `cancelledByStaffId` CHAR(36) NULL,
    `source` ENUM('PUBLIC_WEBSITE', 'STAFF_PORTAL', 'PHONE', 'WHATSAPP', 'OTHER') NOT NULL DEFAULT 'PUBLIC_WEBSITE',
    `status` ENUM('PENDING', 'UNDER_REVIEW', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'NO_SHOW', 'HANDED_OVER', 'RETURNED', 'COMPLETED') NOT NULL DEFAULT 'PENDING',
    `pickupAt` DATETIME(3) NOT NULL,
    `returnAt` DATETIME(3) NOT NULL,
    `rentalDurationUnits` DECIMAL(8, 2) NOT NULL,
    `packageNameSnapshot` VARCHAR(120) NOT NULL,
    `rentalPeriodSnapshot` ENUM('DAILY', 'WEEKLY', 'MONTHLY') NOT NULL,
    `durationCountSnapshot` SMALLINT UNSIGNED NOT NULL,
    `packageConditionsSnapshot` TEXT NULL,
    `rentalPriceSnapshot` DECIMAL(12, 2) NOT NULL,
    `includedMileageKmSnapshot` INTEGER UNSIGNED NOT NULL,
    `additionalKmRateSnapshot` DECIMAL(12, 2) NOT NULL,
    `securityDepositSnapshot` DECIMAL(12, 2) NOT NULL,
    `estimatedTotal` DECIMAL(12, 2) NOT NULL,
    `confirmedTotal` DECIMAL(12, 2) NULL,
    `rentalPolicyVersionSnapshot` INTEGER UNSIGNED NULL,
    `rentalTermsSnapshot` LONGTEXT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'LKR',
    `customerNameSnapshot` VARCHAR(160) NOT NULL,
    `customerMobileSnapshot` VARCHAR(32) NOT NULL,
    `customerEmailSnapshot` VARCHAR(254) NULL,
    `registrationSnapshot` VARCHAR(24) NOT NULL,
    `pickupLocationSnapshot` VARCHAR(255) NULL,
    `returnLocationSnapshot` VARCHAR(255) NULL,
    `customerNotes` TEXT NULL,
    `internalNotes` TEXT NULL,
    `rejectionReason` VARCHAR(1000) NULL,
    `rejectedAt` DATETIME(3) NULL,
    `cancellationReason` VARCHAR(1000) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Booking_reference_key`(`reference`),
    UNIQUE INDEX `Booking_publicLookupTokenHash_key`(`publicLookupTokenHash`),
    INDEX `Booking_vehicleId_status_pickupAt_returnAt_idx`(`vehicleId`, `status`, `pickupAt`, `returnAt`),
    INDEX `Booking_customerId_createdAt_idx`(`customerId`, `createdAt`),
    INDEX `Booking_status_pickupAt_idx`(`status`, `pickupAt`),
    INDEX `Booking_createdAt_idx`(`createdAt`),
    UNIQUE INDEX `Booking_referenceYear_referenceSequence_key`(`referenceYear`, `referenceSequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BookingScheduleChange` (
    `id` CHAR(36) NOT NULL,
    `bookingId` CHAR(36) NOT NULL,
    `changedByStaffId` CHAR(36) NULL,
    `previousPickupAt` DATETIME(3) NOT NULL,
    `previousReturnAt` DATETIME(3) NOT NULL,
    `newPickupAt` DATETIME(3) NOT NULL,
    `newReturnAt` DATETIME(3) NOT NULL,
    `reason` VARCHAR(1000) NOT NULL,
    `changedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BookingScheduleChange_bookingId_changedAt_idx`(`bookingId`, `changedAt`),
    INDEX `BookingScheduleChange_changedByStaffId_changedAt_idx`(`changedByStaffId`, `changedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BookingStatusHistory` (
    `id` CHAR(36) NOT NULL,
    `bookingId` CHAR(36) NOT NULL,
    `changedByStaffId` CHAR(36) NULL,
    `fromStatus` ENUM('PENDING', 'UNDER_REVIEW', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'NO_SHOW', 'HANDED_OVER', 'RETURNED', 'COMPLETED') NULL,
    `toStatus` ENUM('PENDING', 'UNDER_REVIEW', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'NO_SHOW', 'HANDED_OVER', 'RETURNED', 'COMPLETED') NOT NULL,
    `reason` VARCHAR(1000) NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BookingStatusHistory_bookingId_occurredAt_idx`(`bookingId`, `occurredAt`),
    INDEX `BookingStatusHistory_changedByStaffId_occurredAt_idx`(`changedByStaffId`, `occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BookingCharge` (
    `id` CHAR(36) NOT NULL,
    `bookingId` CHAR(36) NOT NULL,
    `createdByStaffId` CHAR(36) NULL,
    `approvedByStaffId` CHAR(36) NULL,
    `damageReportId` CHAR(36) NULL,
    `idempotencyKey` VARCHAR(100) NULL,
    `pricingRuleId` CHAR(36) NULL,
    `chargeType` ENUM('RENTAL', 'DISCOUNT', 'EXTRA_KILOMETRE', 'LATE_RETURN', 'DAMAGE', 'CLEANING', 'DELIVERY', 'OTHER') NOT NULL,
    `direction` ENUM('DEBIT', 'CREDIT') NOT NULL,
    `quantity` DECIMAL(10, 2) NOT NULL DEFAULT 1.00,
    `unitPrice` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'LKR',
    `description` VARCHAR(1000) NOT NULL,
    `pricingRuleSnapshot` VARCHAR(100) NULL,
    `isInitialQuoteLine` BOOLEAN NOT NULL DEFAULT false,
    `approvalStatus` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'APPROVED',
    `approvedAt` DATETIME(3) NULL,
    `recognizedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `voidedAt` DATETIME(3) NULL,
    `voidReason` VARCHAR(1000) NULL,

    UNIQUE INDEX `BookingCharge_damageReportId_key`(`damageReportId`),
    UNIQUE INDEX `BookingCharge_idempotencyKey_key`(`idempotencyKey`),
    INDEX `BookingCharge_bookingId_createdAt_voidedAt_idx`(`bookingId`, `createdAt`, `voidedAt`),
    INDEX `BookingCharge_pricingRuleId_idx`(`pricingRuleId`),
    INDEX `BookingCharge_recognizedAt_idx`(`recognizedAt`),
    INDEX `BookingCharge_bookingId_approvalStatus_createdAt_idx`(`bookingId`, `approvalStatus`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BookingChargeApproval` (
    `id` CHAR(36) NOT NULL,
    `bookingChargeId` CHAR(36) NOT NULL,
    `actorStaffId` CHAR(36) NOT NULL,
    `decision` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL,
    `reason` VARCHAR(1000) NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BookingChargeApproval_bookingChargeId_occurredAt_idx`(`bookingChargeId`, `occurredAt`),
    INDEX `BookingChargeApproval_actorStaffId_occurredAt_idx`(`actorStaffId`, `occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VehicleAvailabilityBlock` (
    `id` CHAR(36) NOT NULL,
    `vehicleId` CHAR(36) NOT NULL,
    `maintenanceJobId` CHAR(36) NULL,
    `createdByStaffId` CHAR(36) NULL,
    `reason` ENUM('MAINTENANCE', 'REPAIR', 'LATE_RETURN', 'OPERATIONAL', 'ADMINISTRATIVE', 'OTHER') NOT NULL,
    `status` ENUM('ACTIVE', 'RELEASED', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NULL,
    `description` VARCHAR(1000) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `releasedAt` DATETIME(3) NULL,

    UNIQUE INDEX `VehicleAvailabilityBlock_maintenanceJobId_key`(`maintenanceJobId`),
    INDEX `VehicleAvailabilityBlock_vehicleId_status_startsAt_endsAt_idx`(`vehicleId`, `status`, `startsAt`, `endsAt`),
    INDEX `VehicleAvailabilityBlock_status_startsAt_endsAt_idx`(`status`, `startsAt`, `endsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AvailabilityBlockHistory` (
    `id` CHAR(36) NOT NULL,
    `availabilityBlockId` CHAR(36) NOT NULL,
    `changedByStaffId` CHAR(36) NULL,
    `fromStatus` ENUM('ACTIVE', 'RELEASED', 'CANCELLED') NULL,
    `toStatus` ENUM('ACTIVE', 'RELEASED', 'CANCELLED') NOT NULL,
    `reason` VARCHAR(1000) NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AvailabilityBlockHistory_availabilityBlockId_occurredAt_idx`(`availabilityBlockId`, `occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RentalHandover` (
    `id` CHAR(36) NOT NULL,
    `bookingId` CHAR(36) NOT NULL,
    `staffUserId` CHAR(36) NOT NULL,
    `customerRepresentativeSnapshot` VARCHAR(160) NULL,
    `notes` VARCHAR(2000) NULL,
    `handedOverAt` DATETIME(3) NOT NULL,
    `startingOdometerKm` INTEGER UNSIGNED NOT NULL,
    `startingFuelPercent` DECIMAL(5, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RentalHandover_bookingId_key`(`bookingId`),
    INDEX `RentalHandover_staffUserId_handedOverAt_idx`(`staffUserId`, `handedOverAt`),
    INDEX `RentalHandover_handedOverAt_idx`(`handedOverAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HandoverAccessory` (
    `id` CHAR(36) NOT NULL,
    `handoverId` CHAR(36) NOT NULL,
    `accessoryNameSnapshot` VARCHAR(120) NOT NULL,
    `wasSupplied` BOOLEAN NOT NULL DEFAULT true,
    `quantityIssued` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    `condition` ENUM('GOOD', 'MINOR_ISSUE', 'DAMAGED', 'NOT_APPLICABLE') NOT NULL DEFAULT 'GOOD',
    `notes` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `HandoverAccessory_handoverId_idx`(`handoverId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RentalReturn` (
    `id` CHAR(36) NOT NULL,
    `handoverId` CHAR(36) NOT NULL,
    `staffUserId` CHAR(36) NOT NULL,
    `returnLocationSnapshot` VARCHAR(255) NULL,
    `notes` VARCHAR(2000) NULL,
    `returnedAt` DATETIME(3) NOT NULL,
    `endingOdometerKm` INTEGER UNSIGNED NOT NULL,
    `distanceTravelledKm` INTEGER UNSIGNED NULL,
    `endingFuelPercent` DECIMAL(5, 2) NOT NULL,
    `fuelDifferencePercent` DECIMAL(5, 2) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RentalReturn_handoverId_key`(`handoverId`),
    INDEX `RentalReturn_staffUserId_returnedAt_idx`(`staffUserId`, `returnedAt`),
    INDEX `RentalReturn_returnedAt_idx`(`returnedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReturnAccessory` (
    `id` CHAR(36) NOT NULL,
    `rentalReturnId` CHAR(36) NOT NULL,
    `handoverAccessoryId` CHAR(36) NOT NULL,
    `quantityReturned` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `notes` VARCHAR(500) NULL,

    INDEX `ReturnAccessory_handoverAccessoryId_idx`(`handoverAccessoryId`),
    UNIQUE INDEX `ReturnAccessory_rentalReturnId_handoverAccessoryId_key`(`rentalReturnId`, `handoverAccessoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RentalInspection` (
    `id` CHAR(36) NOT NULL,
    `handoverId` CHAR(36) NULL,
    `rentalReturnId` CHAR(36) NULL,
    `inspectedByStaffId` CHAR(36) NOT NULL,
    `stage` ENUM('HANDOVER', 'RETURN', 'ADDITIONAL') NOT NULL,
    `inspectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `conditionSummary` TEXT NULL,
    `customerAcknowledgedAt` DATETIME(3) NULL,
    `acknowledgementMethod` ENUM('SIGNATURE', 'PIN', 'IN_PERSON', 'OTHER') NULL,
    `acknowledgementStorageKey` VARCHAR(512) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RentalInspection_handoverId_stage_inspectedAt_idx`(`handoverId`, `stage`, `inspectedAt`),
    INDEX `RentalInspection_rentalReturnId_stage_inspectedAt_idx`(`rentalReturnId`, `stage`, `inspectedAt`),
    INDEX `RentalInspection_inspectedByStaffId_inspectedAt_idx`(`inspectedByStaffId`, `inspectedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InspectionPhoto` (
    `id` CHAR(36) NOT NULL,
    `inspectionId` CHAR(36) NOT NULL,
    `uploadedByStaffId` CHAR(36) NULL,
    `storageKey` VARCHAR(512) NOT NULL,
    `caption` VARCHAR(255) NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `sizeBytes` BIGINT UNSIGNED NOT NULL,
    `sha256` CHAR(64) NULL,
    `capturedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `InspectionPhoto_storageKey_key`(`storageKey`),
    INDEX `InspectionPhoto_inspectionId_createdAt_idx`(`inspectionId`, `createdAt`),
    INDEX `InspectionPhoto_uploadedByStaffId_createdAt_idx`(`uploadedByStaffId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RentalInspectionItem` (
    `id` CHAR(36) NOT NULL,
    `inspectionId` CHAR(36) NOT NULL,
    `componentCode` VARCHAR(80) NOT NULL,
    `labelSnapshot` VARCHAR(120) NOT NULL,
    `condition` ENUM('GOOD', 'MINOR_ISSUE', 'DAMAGED', 'NOT_APPLICABLE') NOT NULL,
    `notes` VARCHAR(1000) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RentalInspectionItem_inspectionId_condition_idx`(`inspectionId`, `condition`),
    UNIQUE INDEX `RentalInspectionItem_inspectionId_componentCode_key`(`inspectionId`, `componentCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DamageReport` (
    `id` CHAR(36) NOT NULL,
    `inspectionId` CHAR(36) NOT NULL,
    `category` ENUM('BODY', 'GLASS', 'TYRE', 'INTERIOR', 'MECHANICAL', 'ACCESSORY', 'OTHER') NOT NULL,
    `severity` ENUM('LOW', 'MEDIUM', 'HIGH') NOT NULL,
    `origin` ENUM('PRE_EXISTING', 'NEW') NOT NULL,
    `status` ENUM('OPEN', 'ASSESSED', 'RESOLVED', 'WAIVED') NOT NULL DEFAULT 'OPEN',
    `chargeApprovalStatus` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `description` VARCHAR(2000) NOT NULL,
    `location` VARCHAR(160) NULL,
    `estimatedRepairCost` DECIMAL(12, 2) NULL,
    `approvedChargeAmount` DECIMAL(12, 2) NULL,
    `approvedByStaffId` CHAR(36) NULL,
    `approvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `resolvedAt` DATETIME(3) NULL,

    INDEX `DamageReport_inspectionId_origin_status_idx`(`inspectionId`, `origin`, `status`),
    INDEX `DamageReport_category_severity_status_idx`(`category`, `severity`, `status`),
    INDEX `DamageReport_chargeApprovalStatus_createdAt_idx`(`chargeApprovalStatus`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DamageImage` (
    `id` CHAR(36) NOT NULL,
    `damageReportId` CHAR(36) NOT NULL,
    `uploadedByStaffId` CHAR(36) NULL,
    `storageKey` VARCHAR(512) NOT NULL,
    `caption` VARCHAR(255) NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `sizeBytes` BIGINT UNSIGNED NOT NULL,
    `sha256` CHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DamageImage_storageKey_key`(`storageKey`),
    INDEX `DamageImage_damageReportId_createdAt_idx`(`damageReportId`, `createdAt`),
    INDEX `DamageImage_uploadedByStaffId_createdAt_idx`(`uploadedByStaffId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DamageApproval` (
    `id` CHAR(36) NOT NULL,
    `damageReportId` CHAR(36) NOT NULL,
    `actorStaffId` CHAR(36) NOT NULL,
    `decision` ENUM('APPROVED', 'REJECTED') NOT NULL,
    `chargeAmount` DECIMAL(12, 2) NULL,
    `reason` VARCHAR(1000) NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DamageApproval_damageReportId_occurredAt_idx`(`damageReportId`, `occurredAt`),
    INDEX `DamageApproval_actorStaffId_occurredAt_idx`(`actorStaffId`, `occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DamageResolution` (
    `id` CHAR(36) NOT NULL,
    `damageReportId` CHAR(36) NOT NULL,
    `maintenanceJobId` CHAR(36) NULL,
    `resolutionType` ENUM('REPAIRED', 'CUSTOMER_CHARGED', 'WAIVED', 'OTHER') NOT NULL,
    `notes` VARCHAR(2000) NULL,
    `resolvedByStaffId` CHAR(36) NULL,
    `resolvedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DamageResolution_damageReportId_resolvedAt_idx`(`damageReportId`, `resolvedAt`),
    INDEX `DamageResolution_maintenanceJobId_idx`(`maintenanceJobId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RentalCustomerVerification` (
    `id` CHAR(36) NOT NULL,
    `bookingId` CHAR(36) NOT NULL,
    `customerId` CHAR(36) NOT NULL,
    `reviewedByStaffId` CHAR(36) NOT NULL,
    `idempotencyKey` VARCHAR(100) NULL,
    `status` ENUM('NOT_VERIFIED', 'PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'EXPIRED') NOT NULL,
    `checks` JSON NOT NULL,
    `notes` VARCHAR(2000) NULL,
    `rejectionReason` VARCHAR(1000) NULL,
    `reviewedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RentalCustomerVerification_idempotencyKey_key`(`idempotencyKey`),
    INDEX `RentalCustomerVerification_bookingId_reviewedAt_idx`(`bookingId`, `reviewedAt`),
    INDEX `RentalCustomerVerification_customerId_status_reviewedAt_idx`(`customerId`, `status`, `reviewedAt`),
    INDEX `RentalCustomerVerification_reviewedByStaffId_reviewedAt_idx`(`reviewedByStaffId`, `reviewedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RentalOperationDraft` (
    `id` CHAR(36) NOT NULL,
    `bookingId` CHAR(36) NOT NULL,
    `operationType` ENUM('HANDOVER', 'RETURN') NOT NULL,
    `payload` JSON NOT NULL,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `createdByStaffId` CHAR(36) NOT NULL,
    `updatedByStaffId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RentalOperationDraft_operationType_updatedAt_idx`(`operationType`, `updatedAt`),
    INDEX `RentalOperationDraft_createdByStaffId_updatedAt_idx`(`createdByStaffId`, `updatedAt`),
    UNIQUE INDEX `RentalOperationDraft_bookingId_operationType_key`(`bookingId`, `operationType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RentalOperationDraftPhoto` (
    `id` CHAR(36) NOT NULL,
    `draftId` CHAR(36) NOT NULL,
    `uploadedByStaffId` CHAR(36) NOT NULL,
    `storageKey` VARCHAR(512) NOT NULL,
    `caption` VARCHAR(255) NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `sizeBytes` BIGINT UNSIGNED NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `capturedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RentalOperationDraftPhoto_storageKey_key`(`storageKey`),
    INDEX `RentalOperationDraftPhoto_draftId_createdAt_idx`(`draftId`, `createdAt`),
    INDEX `RentalOperationDraftPhoto_uploadedByStaffId_createdAt_idx`(`uploadedByStaffId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RentalFinalization` (
    `id` CHAR(36) NOT NULL,
    `bookingId` CHAR(36) NOT NULL,
    `finalizedByStaffId` CHAR(36) NOT NULL,
    `rentalChargeTotal` DECIMAL(12, 2) NOT NULL,
    `rentalPaymentsReceived` DECIMAL(12, 2) NOT NULL,
    `rentalOutstanding` DECIMAL(12, 2) NOT NULL,
    `securityDepositCollected` DECIMAL(12, 2) NOT NULL,
    `securityDepositApplied` DECIMAL(12, 2) NOT NULL,
    `securityDepositRefunded` DECIMAL(12, 2) NOT NULL,
    `remainingDeposit` DECIMAL(12, 2) NOT NULL,
    `outstandingBalanceAllowed` BOOLEAN NOT NULL DEFAULT false,
    `notes` VARCHAR(2000) NULL,
    `financialSnapshot` JSON NOT NULL,
    `finalizedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RentalFinalization_bookingId_key`(`bookingId`),
    INDEX `RentalFinalization_finalizedByStaffId_finalizedAt_idx`(`finalizedByStaffId`, `finalizedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Payment` (
    `id` CHAR(36) NOT NULL,
    `bookingId` CHAR(36) NOT NULL,
    `recordedByStaffId` CHAR(36) NOT NULL,
    `originalPaymentId` CHAR(36) NULL,
    `direction` ENUM('COLLECTION', 'REFUND') NOT NULL,
    `purpose` ENUM('ADVANCE', 'PARTIAL', 'FINAL', 'SECURITY_DEPOSIT', 'OTHER') NOT NULL,
    `status` ENUM('PENDING', 'COMPLETED', 'FAILED', 'VOIDED') NOT NULL DEFAULT 'PENDING',
    `method` ENUM('CASH', 'BANK_TRANSFER', 'CARD', 'OTHER') NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'LKR',
    `reference` VARCHAR(160) NULL,
    `idempotencyKey` VARCHAR(100) NULL,
    `notes` VARCHAR(1000) NULL,
    `transactionAt` DATETIME(3) NOT NULL,
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `settledAt` DATETIME(3) NULL,
    `voidedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Payment_idempotencyKey_key`(`idempotencyKey`),
    INDEX `Payment_bookingId_status_direction_transactionAt_idx`(`bookingId`, `status`, `direction`, `transactionAt`),
    INDEX `Payment_recordedByStaffId_recordedAt_idx`(`recordedByStaffId`, `recordedAt`),
    INDEX `Payment_reference_idx`(`reference`),
    INDEX `Payment_originalPaymentId_idx`(`originalPaymentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentCorrection` (
    `id` CHAR(36) NOT NULL,
    `paymentId` CHAR(36) NOT NULL,
    `actorStaffId` CHAR(36) NOT NULL,
    `previousStatus` ENUM('PENDING', 'COMPLETED', 'FAILED', 'VOIDED') NOT NULL,
    `newStatus` ENUM('PENDING', 'COMPLETED', 'FAILED', 'VOIDED') NOT NULL,
    `reason` VARCHAR(1000) NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PaymentCorrection_paymentId_occurredAt_idx`(`paymentId`, `occurredAt`),
    INDEX `PaymentCorrection_actorStaffId_occurredAt_idx`(`actorStaffId`, `occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentAllocation` (
    `id` CHAR(36) NOT NULL,
    `paymentId` CHAR(36) NOT NULL,
    `allocationType` ENUM('RENTAL', 'SECURITY_DEPOSIT', 'OTHER') NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PaymentAllocation_allocationType_createdAt_idx`(`allocationType`, `createdAt`),
    UNIQUE INDEX `PaymentAllocation_paymentId_allocationType_key`(`paymentId`, `allocationType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentReceipt` (
    `id` CHAR(36) NOT NULL,
    `paymentId` CHAR(36) NOT NULL,
    `storageKey` VARCHAR(512) NOT NULL,
    `originalName` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `sizeBytes` BIGINT UNSIGNED NOT NULL,
    `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PaymentReceipt_storageKey_key`(`storageKey`),
    INDEX `PaymentReceipt_paymentId_uploadedAt_idx`(`paymentId`, `uploadedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DepositApplication` (
    `id` CHAR(36) NOT NULL,
    `bookingId` CHAR(36) NOT NULL,
    `bookingChargeId` CHAR(36) NOT NULL,
    `createdByStaffId` CHAR(36) NOT NULL,
    `idempotencyKey` VARCHAR(100) NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `reason` VARCHAR(1000) NOT NULL,
    `appliedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DepositApplication_idempotencyKey_key`(`idempotencyKey`),
    INDEX `DepositApplication_bookingId_appliedAt_idx`(`bookingId`, `appliedAt`),
    INDEX `DepositApplication_bookingChargeId_idx`(`bookingChargeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MaintenanceCategory` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(60) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MaintenanceCategory_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MaintenanceJob` (
    `id` CHAR(36) NOT NULL,
    `vehicleId` CHAR(36) NOT NULL,
    `categoryId` CHAR(36) NOT NULL,
    `maintenanceScheduleId` CHAR(36) NULL,
    `createdByStaffId` CHAR(36) NOT NULL,
    `status` ENUM('PLANNED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PLANNED',
    `summary` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `serviceProvider` VARCHAR(160) NULL,
    `scheduledStartAt` DATETIME(3) NULL,
    `estimatedCompletionAt` DATETIME(3) NULL,
    `actualStartAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `odometerKm` INTEGER UNSIGNED NULL,
    `estimatedPartsCost` DECIMAL(12, 2) NULL,
    `estimatedLabourCost` DECIMAL(12, 2) NULL,
    `actualPartsCost` DECIMAL(12, 2) NULL,
    `actualLabourCost` DECIMAL(12, 2) NULL,
    `nextServiceAt` DATETIME(3) NULL,
    `nextServiceOdometerKm` INTEGER UNSIGNED NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `cancelledAt` DATETIME(3) NULL,

    INDEX `MaintenanceJob_vehicleId_status_scheduledStartAt_idx`(`vehicleId`, `status`, `scheduledStartAt`),
    INDEX `MaintenanceJob_categoryId_status_idx`(`categoryId`, `status`),
    INDEX `MaintenanceJob_status_nextServiceAt_idx`(`status`, `nextServiceAt`),
    INDEX `MaintenanceJob_status_nextServiceOdometerKm_idx`(`status`, `nextServiceOdometerKm`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MaintenanceSchedule` (
    `id` CHAR(36) NOT NULL,
    `vehicleId` CHAR(36) NOT NULL,
    `categoryId` CHAR(36) NOT NULL,
    `status` ENUM('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    `dueAt` DATETIME(3) NULL,
    `dueAtOdometerKm` INTEGER UNSIGNED NULL,
    `recurrenceDays` INTEGER UNSIGNED NULL,
    `recurrenceKilometres` INTEGER UNSIGNED NULL,
    `notes` VARCHAR(1000) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MaintenanceSchedule_vehicleId_status_dueAt_idx`(`vehicleId`, `status`, `dueAt`),
    INDEX `MaintenanceSchedule_status_dueAtOdometerKm_idx`(`status`, `dueAtOdometerKm`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MaintenanceDocument` (
    `id` CHAR(36) NOT NULL,
    `maintenanceJobId` CHAR(36) NOT NULL,
    `storageKey` VARCHAR(512) NOT NULL,
    `originalName` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `sizeBytes` BIGINT UNSIGNED NOT NULL,
    `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MaintenanceDocument_storageKey_key`(`storageKey`),
    INDEX `MaintenanceDocument_maintenanceJobId_uploadedAt_idx`(`maintenanceJobId`, `uploadedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExpenseCategory` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(60) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ExpenseCategory_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Expense` (
    `id` CHAR(36) NOT NULL,
    `categoryId` CHAR(36) NOT NULL,
    `vehicleId` CHAR(36) NULL,
    `maintenanceJobId` CHAR(36) NULL,
    `submittedByStaffId` CHAR(36) NOT NULL,
    `approvedByStaffId` CHAR(36) NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'LKR',
    `expenseDate` DATETIME(3) NOT NULL,
    `description` VARCHAR(1000) NOT NULL,
    `paymentMethod` ENUM('CASH', 'BANK_TRANSFER', 'CARD', 'OTHER') NULL,
    `vendorName` VARCHAR(160) NULL,
    `vendorInvoiceReference` VARCHAR(160) NULL,
    `deduplicationKey` CHAR(64) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'VOIDED') NOT NULL DEFAULT 'PENDING',
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `approvedAt` DATETIME(3) NULL,
    `rejectedAt` DATETIME(3) NULL,
    `approvalNote` VARCHAR(1000) NULL,

    UNIQUE INDEX `Expense_deduplicationKey_key`(`deduplicationKey`),
    INDEX `Expense_expenseDate_status_idx`(`expenseDate`, `status`),
    INDEX `Expense_categoryId_expenseDate_status_idx`(`categoryId`, `expenseDate`, `status`),
    INDEX `Expense_vehicleId_expenseDate_status_idx`(`vehicleId`, `expenseDate`, `status`),
    INDEX `Expense_maintenanceJobId_expenseDate_idx`(`maintenanceJobId`, `expenseDate`),
    INDEX `Expense_submittedByStaffId_submittedAt_idx`(`submittedByStaffId`, `submittedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExpenseApprovalHistory` (
    `id` CHAR(36) NOT NULL,
    `expenseId` CHAR(36) NOT NULL,
    `changedByStaffId` CHAR(36) NOT NULL,
    `fromStatus` ENUM('PENDING', 'APPROVED', 'REJECTED', 'VOIDED') NULL,
    `toStatus` ENUM('PENDING', 'APPROVED', 'REJECTED', 'VOIDED') NOT NULL,
    `note` VARCHAR(1000) NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ExpenseApprovalHistory_expenseId_occurredAt_idx`(`expenseId`, `occurredAt`),
    INDEX `ExpenseApprovalHistory_changedByStaffId_occurredAt_idx`(`changedByStaffId`, `occurredAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExpenseDocument` (
    `id` CHAR(36) NOT NULL,
    `expenseId` CHAR(36) NOT NULL,
    `storageKey` VARCHAR(512) NOT NULL,
    `originalName` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `sizeBytes` BIGINT UNSIGNED NOT NULL,
    `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ExpenseDocument_storageKey_key`(`storageKey`),
    INDEX `ExpenseDocument_expenseId_uploadedAt_idx`(`expenseId`, `uploadedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` CHAR(36) NOT NULL,
    `recipientStaffId` CHAR(36) NOT NULL,
    `type` ENUM('BOOKING_CREATED', 'BOOKING_STATUS_CHANGED', 'PAYMENT_RECORDED', 'PAYMENT_REFUNDED', 'HANDOVER_COMPLETED', 'RETURN_COMPLETED', 'MAINTENANCE_DUE', 'EXPENSE_SUBMITTED', 'OTHER') NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `body` VARCHAR(2000) NULL,
    `subjectType` VARCHAR(80) NULL,
    `subjectId` VARCHAR(64) NULL,
    `payload` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `readAt` DATETIME(3) NULL,

    INDEX `Notification_recipientStaffId_readAt_createdAt_idx`(`recipientStaffId`, `readAt`, `createdAt`),
    INDEX `Notification_type_createdAt_idx`(`type`, `createdAt`),
    INDEX `Notification_subjectType_subjectId_idx`(`subjectType`, `subjectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` CHAR(36) NOT NULL,
    `actorStaffUserId` CHAR(36) NULL,
    `actorIdentifierSnapshot` VARCHAR(254) NULL,
    `action` VARCHAR(100) NOT NULL,
    `entityType` VARCHAR(80) NOT NULL,
    `entityId` VARCHAR(64) NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `requestId` VARCHAR(100) NULL,
    `ipAddress` VARCHAR(45) NULL,
    `userAgent` VARCHAR(512) NULL,
    `beforeSnapshot` JSON NULL,
    `afterSnapshot` JSON NULL,

    INDEX `AuditLog_entityType_entityId_occurredAt_idx`(`entityType`, `entityId`, `occurredAt`),
    INDEX `AuditLog_actorStaffUserId_occurredAt_idx`(`actorStaffUserId`, `occurredAt`),
    INDEX `AuditLog_action_occurredAt_idx`(`action`, `occurredAt`),
    INDEX `AuditLog_requestId_idx`(`requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BusinessProfile` (
    `id` VARCHAR(16) NOT NULL DEFAULT 'default',
    `businessName` VARCHAR(160) NOT NULL,
    `legalName` VARCHAR(200) NULL,
    `registrationNumber` VARCHAR(100) NULL,
    `publicPhone` VARCHAR(32) NULL,
    `publicEmail` VARCHAR(254) NULL,
    `address` VARCHAR(500) NULL,
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Colombo',
    `reportingCurrency` CHAR(3) NOT NULL DEFAULT 'LKR',
    `updatedByStaffId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RentalPolicy` (
    `id` CHAR(36) NOT NULL,
    `version` INTEGER UNSIGNED NOT NULL,
    `createdByStaffId` CHAR(36) NULL,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `effectiveTo` DATETIME(3) NULL,
    `rentalTerms` LONGTEXT NOT NULL,
    `cancellationTerms` LONGTEXT NOT NULL,
    `minimumRentalHours` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    `maximumAdvanceDays` SMALLINT UNSIGNED NULL,
    `advancePaymentPercent` DECIMAL(5, 2) NULL,
    `lateReturnGraceMinutes` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RentalPolicy_version_key`(`version`),
    INDEX `RentalPolicy_effectiveFrom_effectiveTo_idx`(`effectiveFrom`, `effectiveTo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SystemSetting` (
    `key` VARCHAR(100) NOT NULL,
    `value` JSON NOT NULL,
    `description` VARCHAR(500) NULL,
    `updatedByStaffId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SystemSetting_updatedByStaffId_updatedAt_idx`(`updatedByStaffId`, `updatedAt`),
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `StaffRole` ADD CONSTRAINT `StaffRole_staffUserId_fkey` FOREIGN KEY (`staffUserId`) REFERENCES `StaffUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StaffRole` ADD CONSTRAINT `StaffRole_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RolePermission` ADD CONSTRAINT `RolePermission_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RolePermission` ADD CONSTRAINT `RolePermission_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `Permission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StaffSession` ADD CONSTRAINT `StaffSession_staffUserId_fkey` FOREIGN KEY (`staffUserId`) REFERENCES `StaffUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StaffPasswordResetToken` ADD CONSTRAINT `StaffPasswordResetToken_staffUserId_fkey` FOREIGN KEY (`staffUserId`) REFERENCES `StaffUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VehicleStaffAssignment` ADD CONSTRAINT `VehicleStaffAssignment_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VehicleStaffAssignment` ADD CONSTRAINT `VehicleStaffAssignment_staffUserId_fkey` FOREIGN KEY (`staffUserId`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VehicleStaffAssignment` ADD CONSTRAINT `VehicleStaffAssignment_assignedByStaffId_fkey` FOREIGN KEY (`assignedByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VehicleStaffAssignment` ADD CONSTRAINT `VehicleStaffAssignment_revokedByStaffId_fkey` FOREIGN KEY (`revokedByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VehicleSpecification` ADD CONSTRAINT `VehicleSpecification_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VehicleStatusHistory` ADD CONSTRAINT `VehicleStatusHistory_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VehicleStatusHistory` ADD CONSTRAINT `VehicleStatusHistory_changedByStaffId_fkey` FOREIGN KEY (`changedByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VehicleImage` ADD CONSTRAINT `VehicleImage_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VehicleImage` ADD CONSTRAINT `VehicleImage_uploadedByStaffId_fkey` FOREIGN KEY (`uploadedByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VehicleDocument` ADD CONSTRAINT `VehicleDocument_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VehicleDocument` ADD CONSTRAINT `VehicleDocument_uploadedByStaffId_fkey` FOREIGN KEY (`uploadedByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VehicleMileageReading` ADD CONSTRAINT `VehicleMileageReading_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VehicleMileageReading` ADD CONSTRAINT `VehicleMileageReading_recordedByStaffId_fkey` FOREIGN KEY (`recordedByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VehicleRate` ADD CONSTRAINT `VehicleRate_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VehicleRate` ADD CONSTRAINT `VehicleRate_rentalPackageId_fkey` FOREIGN KEY (`rentalPackageId`) REFERENCES `RentalPackage`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PricingRule` ADD CONSTRAINT `PricingRule_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PricingRule` ADD CONSTRAINT `PricingRule_rentalPackageId_fkey` FOREIGN KEY (`rentalPackageId`) REFERENCES `RentalPackage`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerContact` ADD CONSTRAINT `CustomerContact_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerDocument` ADD CONSTRAINT `CustomerDocument_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_rentalPackageId_fkey` FOREIGN KEY (`rentalPackageId`) REFERENCES `RentalPackage`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_vehicleRateId_fkey` FOREIGN KEY (`vehicleRateId`) REFERENCES `VehicleRate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_rentalPolicyId_fkey` FOREIGN KEY (`rentalPolicyId`) REFERENCES `RentalPolicy`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_referenceYear_fkey` FOREIGN KEY (`referenceYear`) REFERENCES `BookingReferenceCounter`(`year`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_createdByStaffId_fkey` FOREIGN KEY (`createdByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_confirmedByStaffId_fkey` FOREIGN KEY (`confirmedByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_rejectedByStaffId_fkey` FOREIGN KEY (`rejectedByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_cancelledByStaffId_fkey` FOREIGN KEY (`cancelledByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BookingScheduleChange` ADD CONSTRAINT `BookingScheduleChange_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BookingScheduleChange` ADD CONSTRAINT `BookingScheduleChange_changedByStaffId_fkey` FOREIGN KEY (`changedByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BookingStatusHistory` ADD CONSTRAINT `BookingStatusHistory_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BookingStatusHistory` ADD CONSTRAINT `BookingStatusHistory_changedByStaffId_fkey` FOREIGN KEY (`changedByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BookingCharge` ADD CONSTRAINT `BookingCharge_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BookingCharge` ADD CONSTRAINT `BookingCharge_createdByStaffId_fkey` FOREIGN KEY (`createdByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BookingCharge` ADD CONSTRAINT `BookingCharge_approvedByStaffId_fkey` FOREIGN KEY (`approvedByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BookingCharge` ADD CONSTRAINT `BookingCharge_damageReportId_fkey` FOREIGN KEY (`damageReportId`) REFERENCES `DamageReport`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BookingCharge` ADD CONSTRAINT `BookingCharge_pricingRuleId_fkey` FOREIGN KEY (`pricingRuleId`) REFERENCES `PricingRule`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BookingChargeApproval` ADD CONSTRAINT `BookingChargeApproval_bookingChargeId_fkey` FOREIGN KEY (`bookingChargeId`) REFERENCES `BookingCharge`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BookingChargeApproval` ADD CONSTRAINT `BookingChargeApproval_actorStaffId_fkey` FOREIGN KEY (`actorStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VehicleAvailabilityBlock` ADD CONSTRAINT `VehicleAvailabilityBlock_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VehicleAvailabilityBlock` ADD CONSTRAINT `VehicleAvailabilityBlock_maintenanceJobId_fkey` FOREIGN KEY (`maintenanceJobId`) REFERENCES `MaintenanceJob`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VehicleAvailabilityBlock` ADD CONSTRAINT `VehicleAvailabilityBlock_createdByStaffId_fkey` FOREIGN KEY (`createdByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AvailabilityBlockHistory` ADD CONSTRAINT `AvailabilityBlockHistory_availabilityBlockId_fkey` FOREIGN KEY (`availabilityBlockId`) REFERENCES `VehicleAvailabilityBlock`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AvailabilityBlockHistory` ADD CONSTRAINT `AvailabilityBlockHistory_changedByStaffId_fkey` FOREIGN KEY (`changedByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RentalHandover` ADD CONSTRAINT `RentalHandover_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RentalHandover` ADD CONSTRAINT `RentalHandover_staffUserId_fkey` FOREIGN KEY (`staffUserId`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HandoverAccessory` ADD CONSTRAINT `HandoverAccessory_handoverId_fkey` FOREIGN KEY (`handoverId`) REFERENCES `RentalHandover`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RentalReturn` ADD CONSTRAINT `RentalReturn_handoverId_fkey` FOREIGN KEY (`handoverId`) REFERENCES `RentalHandover`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RentalReturn` ADD CONSTRAINT `RentalReturn_staffUserId_fkey` FOREIGN KEY (`staffUserId`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnAccessory` ADD CONSTRAINT `ReturnAccessory_rentalReturnId_fkey` FOREIGN KEY (`rentalReturnId`) REFERENCES `RentalReturn`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReturnAccessory` ADD CONSTRAINT `ReturnAccessory_handoverAccessoryId_fkey` FOREIGN KEY (`handoverAccessoryId`) REFERENCES `HandoverAccessory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RentalInspection` ADD CONSTRAINT `RentalInspection_handoverId_fkey` FOREIGN KEY (`handoverId`) REFERENCES `RentalHandover`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RentalInspection` ADD CONSTRAINT `RentalInspection_rentalReturnId_fkey` FOREIGN KEY (`rentalReturnId`) REFERENCES `RentalReturn`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RentalInspection` ADD CONSTRAINT `RentalInspection_inspectedByStaffId_fkey` FOREIGN KEY (`inspectedByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InspectionPhoto` ADD CONSTRAINT `InspectionPhoto_inspectionId_fkey` FOREIGN KEY (`inspectionId`) REFERENCES `RentalInspection`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InspectionPhoto` ADD CONSTRAINT `InspectionPhoto_uploadedByStaffId_fkey` FOREIGN KEY (`uploadedByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RentalInspectionItem` ADD CONSTRAINT `RentalInspectionItem_inspectionId_fkey` FOREIGN KEY (`inspectionId`) REFERENCES `RentalInspection`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DamageReport` ADD CONSTRAINT `DamageReport_inspectionId_fkey` FOREIGN KEY (`inspectionId`) REFERENCES `RentalInspection`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DamageReport` ADD CONSTRAINT `DamageReport_approvedByStaffId_fkey` FOREIGN KEY (`approvedByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DamageImage` ADD CONSTRAINT `DamageImage_damageReportId_fkey` FOREIGN KEY (`damageReportId`) REFERENCES `DamageReport`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DamageImage` ADD CONSTRAINT `DamageImage_uploadedByStaffId_fkey` FOREIGN KEY (`uploadedByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DamageApproval` ADD CONSTRAINT `DamageApproval_damageReportId_fkey` FOREIGN KEY (`damageReportId`) REFERENCES `DamageReport`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DamageApproval` ADD CONSTRAINT `DamageApproval_actorStaffId_fkey` FOREIGN KEY (`actorStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DamageResolution` ADD CONSTRAINT `DamageResolution_damageReportId_fkey` FOREIGN KEY (`damageReportId`) REFERENCES `DamageReport`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DamageResolution` ADD CONSTRAINT `DamageResolution_maintenanceJobId_fkey` FOREIGN KEY (`maintenanceJobId`) REFERENCES `MaintenanceJob`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DamageResolution` ADD CONSTRAINT `DamageResolution_resolvedByStaffId_fkey` FOREIGN KEY (`resolvedByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RentalCustomerVerification` ADD CONSTRAINT `RentalCustomerVerification_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RentalCustomerVerification` ADD CONSTRAINT `RentalCustomerVerification_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RentalCustomerVerification` ADD CONSTRAINT `RentalCustomerVerification_reviewedByStaffId_fkey` FOREIGN KEY (`reviewedByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RentalOperationDraft` ADD CONSTRAINT `RentalOperationDraft_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RentalOperationDraft` ADD CONSTRAINT `RentalOperationDraft_createdByStaffId_fkey` FOREIGN KEY (`createdByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RentalOperationDraft` ADD CONSTRAINT `RentalOperationDraft_updatedByStaffId_fkey` FOREIGN KEY (`updatedByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RentalOperationDraftPhoto` ADD CONSTRAINT `RentalOperationDraftPhoto_draftId_fkey` FOREIGN KEY (`draftId`) REFERENCES `RentalOperationDraft`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RentalOperationDraftPhoto` ADD CONSTRAINT `RentalOperationDraftPhoto_uploadedByStaffId_fkey` FOREIGN KEY (`uploadedByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RentalFinalization` ADD CONSTRAINT `RentalFinalization_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RentalFinalization` ADD CONSTRAINT `RentalFinalization_finalizedByStaffId_fkey` FOREIGN KEY (`finalizedByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_recordedByStaffId_fkey` FOREIGN KEY (`recordedByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_originalPaymentId_fkey` FOREIGN KEY (`originalPaymentId`) REFERENCES `Payment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentCorrection` ADD CONSTRAINT `PaymentCorrection_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `Payment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentCorrection` ADD CONSTRAINT `PaymentCorrection_actorStaffId_fkey` FOREIGN KEY (`actorStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentAllocation` ADD CONSTRAINT `PaymentAllocation_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `Payment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentReceipt` ADD CONSTRAINT `PaymentReceipt_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `Payment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DepositApplication` ADD CONSTRAINT `DepositApplication_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DepositApplication` ADD CONSTRAINT `DepositApplication_bookingChargeId_fkey` FOREIGN KEY (`bookingChargeId`) REFERENCES `BookingCharge`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DepositApplication` ADD CONSTRAINT `DepositApplication_createdByStaffId_fkey` FOREIGN KEY (`createdByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MaintenanceJob` ADD CONSTRAINT `MaintenanceJob_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MaintenanceJob` ADD CONSTRAINT `MaintenanceJob_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `MaintenanceCategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MaintenanceJob` ADD CONSTRAINT `MaintenanceJob_maintenanceScheduleId_fkey` FOREIGN KEY (`maintenanceScheduleId`) REFERENCES `MaintenanceSchedule`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MaintenanceJob` ADD CONSTRAINT `MaintenanceJob_createdByStaffId_fkey` FOREIGN KEY (`createdByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MaintenanceSchedule` ADD CONSTRAINT `MaintenanceSchedule_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MaintenanceSchedule` ADD CONSTRAINT `MaintenanceSchedule_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `MaintenanceCategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MaintenanceDocument` ADD CONSTRAINT `MaintenanceDocument_maintenanceJobId_fkey` FOREIGN KEY (`maintenanceJobId`) REFERENCES `MaintenanceJob`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `ExpenseCategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_maintenanceJobId_fkey` FOREIGN KEY (`maintenanceJobId`) REFERENCES `MaintenanceJob`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_submittedByStaffId_fkey` FOREIGN KEY (`submittedByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_approvedByStaffId_fkey` FOREIGN KEY (`approvedByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExpenseApprovalHistory` ADD CONSTRAINT `ExpenseApprovalHistory_expenseId_fkey` FOREIGN KEY (`expenseId`) REFERENCES `Expense`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExpenseApprovalHistory` ADD CONSTRAINT `ExpenseApprovalHistory_changedByStaffId_fkey` FOREIGN KEY (`changedByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExpenseDocument` ADD CONSTRAINT `ExpenseDocument_expenseId_fkey` FOREIGN KEY (`expenseId`) REFERENCES `Expense`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_recipientStaffId_fkey` FOREIGN KEY (`recipientStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_actorStaffUserId_fkey` FOREIGN KEY (`actorStaffUserId`) REFERENCES `StaffUser`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BusinessProfile` ADD CONSTRAINT `BusinessProfile_updatedByStaffId_fkey` FOREIGN KEY (`updatedByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RentalPolicy` ADD CONSTRAINT `RentalPolicy_createdByStaffId_fkey` FOREIGN KEY (`createdByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SystemSetting` ADD CONSTRAINT `SystemSetting_updatedByStaffId_fkey` FOREIGN KEY (`updatedByStaffId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
