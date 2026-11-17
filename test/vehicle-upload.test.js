import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalFileStorage } from '../src/shared/storage/local-file-storage.js';
import { inspectVehicleUpload } from '../src/modules/vehicles/upload-validation.js';

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/S2cAAAAASUVORK5CYII=',
  'base64',
);

let storageRoot;

afterEach(async () => {
  if (storageRoot) {
    await rm(storageRoot, { recursive: true, force: true });
    storageRoot = undefined;
  }
});

describe('vehicle file upload validation', () => {
  it('accepts an image only when its extension and detected content agree', async () => {
    const upload = await inspectVehicleUpload({
      originalname: 'fleet-photo.png',
      mimetype: 'image/png',
      buffer: onePixelPng,
    }, 'image');

    expect(upload.mimeType).toBe('image/png');
    expect(upload.storageKey).toMatch(/^vehicle-images\/[0-9a-f-]+\.png$/);
    expect(upload.sizeBytes).toBe(BigInt(onePixelPng.byteLength));
    expect(upload.sha256).toMatch(/^[a-f0-9]{64}$/);

    await expect(inspectVehicleUpload({
      originalname: 'fleet-photo.jpg',
      mimetype: 'image/jpeg',
      buffer: onePixelPng,
    }, 'image')).rejects.toMatchObject({
      status: 415,
      code: 'INVALID_FILE_CONTENT',
    });
  });

  it('rejects MIME-type spoofing even when the file extension is approved', async () => {
    await expect(inspectVehicleUpload({
      originalname: 'fleet-photo.png',
      mimetype: 'image/jpeg',
      buffer: onePixelPng,
    }, 'image')).rejects.toMatchObject({
      status: 415,
      code: 'INVALID_FILE_CONTENT',
    });
  });
});

describe('private local file storage', () => {
  it('round-trips an object and rejects traversal storage keys', async () => {
    storageRoot = await mkdtemp(join(tmpdir(), 'ajvrms-storage-'));
    const storage = createLocalFileStorage(storageRoot);
    const object = Buffer.from('private vehicle record');

    await storage.put('vehicle-documents/example.pdf', object);
    await expect(storage.get('vehicle-documents/example.pdf')).resolves.toEqual(object);
    await expect(storage.get('../outside.txt')).rejects.toThrow('Invalid storage key.');
  });
});
