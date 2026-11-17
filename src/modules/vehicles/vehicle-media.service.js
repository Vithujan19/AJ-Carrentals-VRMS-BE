import { writeAudit } from '../../shared/audit.js';
import { AppError } from '../../shared/errors.js';
import { inspectVehicleUpload } from './upload-validation.js';

function actorAuditFields(actor) {
  return {
    actorStaffUserId: actor.id,
    actorIdentifierSnapshot: actor.email,
  };
}

function publicImage(image) {
  return {
    id: image.id,
    mimeType: image.mimeType,
    sizeBytes: image.sizeBytes.toString(),
    caption: image.caption,
    sortOrder: image.sortOrder,
    isPrimary: image.isPrimary,
    isPublished: image.isPublished,
    createdAt: image.createdAt,
    publicUrl: image.isPublished
      ? `/api/v1/public/vehicles/${image.vehicleId}/images/${image.id}`
      : null,
    contentUrl: `/api/v1/vehicles/${image.vehicleId}/images/${image.id}/content`,
  };
}

async function assertNotArchivedVehicle(tx, vehicleId) {
  const vehicle = await tx.vehicle.findUnique({
    where: { id: vehicleId },
    select: { id: true, status: true, archivedAt: true },
  });
  if (!vehicle) {
    throw new AppError(404, 'VEHICLE_NOT_FOUND', 'Vehicle was not found.');
  }
  if (vehicle.archivedAt) {
    throw new AppError(409, 'VEHICLE_ARCHIVED', 'Archived vehicles cannot be changed.');
  }
  return vehicle;
}

async function assertCanViewVehicle(prisma, vehicleId, actor, permissions) {
  if (permissions.includes('vehicles.view')) {
    return;
  }
  if (!permissions.includes('vehicles.view.assigned')) {
    throw new AppError(403, 'PERMISSION_DENIED', 'You do not have permission to view vehicles.');
  }
  const assignment = await prisma.vehicleStaffAssignment.findFirst({
    where: {
      vehicleId,
      staffUserId: actor.id,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true },
  });
  if (!assignment) {
    throw new AppError(404, 'VEHICLE_NOT_FOUND', 'Vehicle was not found.');
  }
}

async function writeMediaAudit(tx, {
  actor,
  auditContext,
  action,
  entityType,
  entityId,
  beforeSnapshot,
  afterSnapshot,
}) {
  await writeAudit(tx, {
    ...actorAuditFields(actor),
    action,
    entityType,
    entityId,
    ...auditContext,
    ...(beforeSnapshot === undefined ? {} : { beforeSnapshot }),
    ...(afterSnapshot === undefined ? {} : { afterSnapshot }),
  });
}

async function storeAll(storage, uploads) {
  const stored = [];
  try {
    for (const upload of uploads) {
      stored.push(upload.storageKey);
      await storage.put(upload.storageKey, upload.buffer);
    }
    return stored;
  } catch (error) {
    await Promise.all(stored.map((key) => storage.delete(key)));
    throw error;
  }
}

async function removeStoredFiles(storage, keys, originalError) {
  try {
    await Promise.all(keys.map((key) => storage.delete(key)));
  } catch (cleanupError) {
    cleanupError.cause ??= originalError;
    throw cleanupError;
  }
}

export function createVehicleMediaService({ prisma, storage }) {
  return {
    async listImages({ vehicleId, actor, permissions }) {
      await assertCanViewVehicle(prisma, vehicleId, actor, permissions);
      const vehicle = await prisma.vehicle.findUnique({
        where: { id: vehicleId },
        select: { id: true },
      });
      if (!vehicle) {
        throw new AppError(404, 'VEHICLE_NOT_FOUND', 'Vehicle was not found.');
      }
      const images = await prisma.vehicleImage.findMany({
        where: { vehicleId, archivedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
      return images.map(publicImage);
    },

    async uploadImages({ vehicleId, files, actor, auditContext }) {
      if (!files?.length) {
        throw new AppError(400, 'UPLOAD_REQUIRED', 'Select at least one image to upload.');
      }
      const uploads = await Promise.all(files.map((file) => inspectVehicleUpload(file, 'image')));
      const storedKeys = await storeAll(storage, uploads);
      try {
        const images = await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM Vehicle WHERE id = ${vehicleId} FOR UPDATE`;
          await assertNotArchivedVehicle(tx, vehicleId);
          const currentCount = await tx.vehicleImage.count({
            where: { vehicleId, archivedAt: null },
          });
          if (currentCount + uploads.length > 50) {
            throw new AppError(409, 'VEHICLE_IMAGE_LIMIT', 'A vehicle can have at most 50 active images.');
          }
          const hasPrimary = await tx.vehicleImage.findFirst({
            where: { vehicleId, archivedAt: null, isPrimary: true },
            select: { id: true },
          });
          const records = [];
          for (const [index, upload] of uploads.entries()) {
            const image = await tx.vehicleImage.create({
              data: {
                vehicleId,
                uploadedByStaffId: actor.id,
                storageKey: upload.storageKey,
                mimeType: upload.mimeType,
                sizeBytes: upload.sizeBytes,
                sha256: upload.sha256,
                isPrimary: !hasPrimary && index === 0,
                sortOrder: currentCount + index,
              },
            });
            await writeMediaAudit(tx, {
              actor,
              auditContext,
              action: 'vehicle.image_uploaded',
              entityType: 'Vehicle',
              entityId: vehicleId,
              afterSnapshot: {
                imageId: image.id,
                mimeType: image.mimeType,
                sizeBytes: image.sizeBytes.toString(),
                sha256: image.sha256,
                isPrimary: image.isPrimary,
              },
            });
            records.push(publicImage(image));
          }
          return records;
        });
        return images;
      } catch (error) {
        await removeStoredFiles(storage, storedKeys, error);
        throw error;
      }
    },

    async updateImage({ vehicleId, imageId, input, actor, auditContext }) {
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM Vehicle WHERE id = ${vehicleId} FOR UPDATE`;
        const vehicle = await assertNotArchivedVehicle(tx, vehicleId);
        const current = await tx.vehicleImage.findFirst({
          where: { id: imageId, vehicleId, archivedAt: null },
        });
        if (!current) {
          throw new AppError(404, 'VEHICLE_IMAGE_NOT_FOUND', 'Vehicle image was not found.');
        }
        if (input.isPublished && vehicle.status !== 'ACTIVE') {
          throw new AppError(
            409,
            'INACTIVE_VEHICLE_IMAGE_CANNOT_BE_PUBLISHED',
            'Images can only be published for active vehicles.',
          );
        }
        let previousPrimaryImageId = null;
        if (input.isPrimary) {
          const previousPrimary = await tx.vehicleImage.findFirst({
            where: { vehicleId, archivedAt: null, isPrimary: true },
            select: { id: true },
          });
          previousPrimaryImageId = previousPrimary?.id ?? null;
          await tx.vehicleImage.updateMany({
            where: { vehicleId, archivedAt: null, isPrimary: true, id: { not: imageId } },
            data: { isPrimary: false },
          });
        }
        const updated = await tx.vehicleImage.update({
          where: { id: imageId },
          data: input,
        });
        await writeMediaAudit(tx, {
          actor,
          auditContext,
          action: 'vehicle.image_updated',
          entityType: 'Vehicle',
          entityId: vehicleId,
          beforeSnapshot: {
            imageId,
            caption: current.caption,
            sortOrder: current.sortOrder,
            isPrimary: current.isPrimary,
            isPublished: current.isPublished,
          },
          afterSnapshot: {
            imageId,
            caption: updated.caption,
            sortOrder: updated.sortOrder,
            isPrimary: updated.isPrimary,
            isPublished: updated.isPublished,
            previousPrimaryImageId:
              input.isPrimary && previousPrimaryImageId !== imageId
                ? previousPrimaryImageId
                : null,
          },
        });
        return publicImage(updated);
      });
    },

    async reorderImages({ vehicleId, imageIds, actor, auditContext }) {
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM Vehicle WHERE id = ${vehicleId} FOR UPDATE`;
        await assertNotArchivedVehicle(tx, vehicleId);
        const currentImages = await tx.vehicleImage.findMany({
          where: { vehicleId, archivedAt: null },
          select: { id: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        });
        const currentIds = new Set(currentImages.map(({ id }) => id));
        if (
          currentIds.size !== imageIds.length ||
          imageIds.some((imageId) => !currentIds.has(imageId))
        ) {
          throw new AppError(
            400,
            'INVALID_VEHICLE_IMAGE_ORDER',
            'Provide each active image for this vehicle exactly once.',
          );
        }
        for (const [sortOrder, imageId] of imageIds.entries()) {
          await tx.vehicleImage.update({ where: { id: imageId }, data: { sortOrder } });
        }
        await writeMediaAudit(tx, {
          actor,
          auditContext,
          action: 'vehicle.images_reordered',
          entityType: 'Vehicle',
          entityId: vehicleId,
          beforeSnapshot: { imageIds: currentImages.map(({ id }) => id) },
          afterSnapshot: { imageIds },
        });
        return { imageIds };
      });
    },

    async archiveImage({ vehicleId, imageId, actor, auditContext }) {
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM Vehicle WHERE id = ${vehicleId} FOR UPDATE`;
        await assertNotArchivedVehicle(tx, vehicleId);
        const current = await tx.vehicleImage.findFirst({
          where: { id: imageId, vehicleId, archivedAt: null },
        });
        if (!current) {
          throw new AppError(404, 'VEHICLE_IMAGE_NOT_FOUND', 'Vehicle image was not found.');
        }
        const archivedAt = new Date();
        let replacementImageId = null;
        await tx.vehicleImage.update({
          where: { id: imageId },
          data: { archivedAt, isPublished: false },
        });
        if (current.isPrimary) {
          const replacement = await tx.vehicleImage.findFirst({
            where: { vehicleId, archivedAt: null, id: { not: imageId } },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          });
          if (replacement) {
            replacementImageId = replacement.id;
            await tx.vehicleImage.update({
              where: { id: replacement.id },
              data: { isPrimary: true },
            });
          }
        }
        await writeMediaAudit(tx, {
          actor,
          auditContext,
          action: 'vehicle.image_archived',
          entityType: 'Vehicle',
          entityId: vehicleId,
          beforeSnapshot: { imageId, isPrimary: current.isPrimary, isPublished: current.isPublished },
          afterSnapshot: { imageId, archivedAt, replacementImageId },
        });
        return { id: imageId, archivedAt };
      });
    },

    async downloadImage({ vehicleId, imageId, actor, permissions }) {
      await assertCanViewVehicle(prisma, vehicleId, actor, permissions);
      const image = await prisma.vehicleImage.findFirst({
        where: {
          id: imageId,
          vehicleId,
          archivedAt: null,
        },
        select: { storageKey: true, mimeType: true, sha256: true },
      });
      if (!image) {
        throw new AppError(404, 'VEHICLE_IMAGE_NOT_FOUND', 'Vehicle image was not found.');
      }
      return { ...image, buffer: await storage.get(image.storageKey) };
    },

    async listDocuments(vehicleId) {
      const vehicle = await prisma.vehicle.findUnique({
        where: { id: vehicleId },
        select: { id: true, archivedAt: true },
      });
      if (!vehicle) {
        throw new AppError(404, 'VEHICLE_NOT_FOUND', 'Vehicle was not found.');
      }
      const documents = await prisma.vehicleDocument.findMany({
        where: { vehicleId, archivedAt: null },
        orderBy: [{ documentType: 'asc' }, { uploadedAt: 'desc' }],
        select: {
          id: true,
          documentType: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
          issueDate: true,
          expiresAt: true,
          uploadedAt: true,
        },
      });
      return documents.map((document) => ({
        ...document,
        sizeBytes: document.sizeBytes.toString(),
      }));
    },

    async uploadDocument({ vehicleId, file, input, actor, auditContext }) {
      const upload = await inspectVehicleUpload(file, 'document');
      await storage.put(upload.storageKey, upload.buffer);
      try {
        return await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM Vehicle WHERE id = ${vehicleId} FOR UPDATE`;
          await assertNotArchivedVehicle(tx, vehicleId);
          const now = new Date();
          const oldDocuments = await tx.vehicleDocument.findMany({
            where: { vehicleId, documentType: input.documentType, archivedAt: null },
          });
          if (oldDocuments.length) {
            await tx.vehicleDocument.updateMany({
              where: { id: { in: oldDocuments.map(({ id }) => id) } },
              data: { archivedAt: now },
            });
          }
          const document = await tx.vehicleDocument.create({
            data: {
              vehicleId,
              uploadedByStaffId: actor.id,
              documentType: input.documentType,
              storageKey: upload.storageKey,
              originalName: upload.originalName,
              mimeType: upload.mimeType,
              sizeBytes: upload.sizeBytes,
              sha256: upload.sha256,
              issueDate: input.issueDate ? new Date(`${input.issueDate}T00:00:00.000Z`) : null,
              expiresAt: input.expiresAt ? new Date(`${input.expiresAt}T00:00:00.000Z`) : null,
            },
          });
          await writeMediaAudit(tx, {
            actor,
            auditContext,
            action: oldDocuments.length ? 'vehicle.document_replaced' : 'vehicle.document_uploaded',
            entityType: 'Vehicle',
            entityId: vehicleId,
            beforeSnapshot: oldDocuments.map(({ id, documentType, expiresAt }) => ({
              id,
              documentType,
              expiresAt,
            })),
            afterSnapshot: {
              documentId: document.id,
              documentType: document.documentType,
              originalName: document.originalName,
              mimeType: document.mimeType,
              sizeBytes: document.sizeBytes.toString(),
              expiresAt: document.expiresAt,
            },
          });
          return {
            id: document.id,
            documentType: document.documentType,
            originalName: document.originalName,
            mimeType: document.mimeType,
            sizeBytes: document.sizeBytes.toString(),
            issueDate: document.issueDate,
            expiresAt: document.expiresAt,
            uploadedAt: document.uploadedAt,
          };
        });
      } catch (error) {
        await removeStoredFiles(storage, [upload.storageKey], error);
        throw error;
      }
    },

    async updateDocument({ vehicleId, documentId, input, actor, auditContext }) {
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM Vehicle WHERE id = ${vehicleId} FOR UPDATE`;
        await assertNotArchivedVehicle(tx, vehicleId);
        const current = await tx.vehicleDocument.findFirst({
          where: { id: documentId, vehicleId, archivedAt: null },
        });
        if (!current) {
          throw new AppError(404, 'VEHICLE_DOCUMENT_NOT_FOUND', 'Vehicle document was not found.');
        }
        const issueDate =
          input.issueDate === undefined
            ? current.issueDate
            : input.issueDate === null
              ? null
              : new Date(`${input.issueDate}T00:00:00.000Z`);
        const expiresAt =
          input.expiresAt === undefined
            ? current.expiresAt
            : input.expiresAt === null
              ? null
              : new Date(`${input.expiresAt}T00:00:00.000Z`);
        if (issueDate && expiresAt && expiresAt < issueDate) {
          throw new AppError(400, 'INVALID_DOCUMENT_DATES', 'Expiry date cannot precede issue date.');
        }
        const updated = await tx.vehicleDocument.update({
          where: { id: documentId },
          data: { issueDate, expiresAt },
        });
        await writeMediaAudit(tx, {
          actor,
          auditContext,
          action: 'vehicle.document_metadata_updated',
          entityType: 'Vehicle',
          entityId: vehicleId,
          beforeSnapshot: { documentId, issueDate: current.issueDate, expiresAt: current.expiresAt },
          afterSnapshot: { documentId, issueDate: updated.issueDate, expiresAt: updated.expiresAt },
        });
        return {
          id: updated.id,
          documentType: updated.documentType,
          issueDate: updated.issueDate,
          expiresAt: updated.expiresAt,
        };
      });
    },

    async archiveDocument({ vehicleId, documentId, actor, auditContext }) {
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM Vehicle WHERE id = ${vehicleId} FOR UPDATE`;
        await assertNotArchivedVehicle(tx, vehicleId);
        const document = await tx.vehicleDocument.findFirst({
          where: { id: documentId, vehicleId, archivedAt: null },
          select: { id: true, documentType: true, expiresAt: true },
        });
        if (!document) {
          throw new AppError(404, 'VEHICLE_DOCUMENT_NOT_FOUND', 'Vehicle document was not found.');
        }
        const archivedAt = new Date();
        await tx.vehicleDocument.update({ where: { id: documentId }, data: { archivedAt } });
        await writeMediaAudit(tx, {
          actor,
          auditContext,
          action: 'vehicle.document_archived',
          entityType: 'Vehicle',
          entityId: vehicleId,
          beforeSnapshot: { documentId, ...document },
          afterSnapshot: { documentId, archivedAt },
        });
        return { id: documentId, archivedAt };
      });
    },

    async downloadDocument({ vehicleId, documentId }) {
      const document = await prisma.vehicleDocument.findFirst({
        where: { id: documentId, vehicleId, archivedAt: null },
        select: {
          storageKey: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
          sha256: true,
        },
      });
      if (!document) {
        throw new AppError(404, 'VEHICLE_DOCUMENT_NOT_FOUND', 'Vehicle document was not found.');
      }
      return { ...document, buffer: await storage.get(document.storageKey) };
    },
  };
}
