import { createHash, randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { AppError } from '../../shared/errors.js';

const imageTypes = new Map([
  ['.jpg', { mimeType: 'image/jpeg', extension: 'jpg' }],
  ['.jpeg', { mimeType: 'image/jpeg', extension: 'jpg' }],
  ['.png', { mimeType: 'image/png', extension: 'png' }],
  ['.webp', { mimeType: 'image/webp', extension: 'webp' }],
]);

const documentTypes = new Map([
  ...imageTypes,
  ['.pdf', { mimeType: 'application/pdf', extension: 'pdf' }],
]);

function safeOriginalName(originalName) {
  return [...basename(originalName.replaceAll('\\', '/'))]
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint > 0x1f && codePoint !== 0x7f;
    })
    .join('')
    .slice(0, 255);
}

export async function inspectVehicleUpload(file, kind) {
  if (!file?.buffer || !Buffer.isBuffer(file.buffer)) {
    throw new AppError(400, 'UPLOAD_REQUIRED', 'Select a file to upload.');
  }
  const supportedTypes = kind === 'image' ? imageTypes : documentTypes;
  const extension = extname(safeOriginalName(file.originalname)).toLowerCase();
  const expected = supportedTypes.get(extension);
  if (!expected) {
    throw new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'The selected file type is not supported.');
  }

  const detected = await fileTypeFromBuffer(file.buffer);
  if (
    !detected ||
    detected.mime !== expected.mimeType ||
    (file.mimetype && file.mimetype !== 'application/octet-stream' && file.mimetype !== detected.mime)
  ) {
    throw new AppError(415, 'INVALID_FILE_CONTENT', 'The file content does not match an approved type.');
  }
  const digest = createHash('sha256').update(file.buffer).digest('hex');
  return {
    buffer: file.buffer,
    storageKey: `${kind === 'image' ? 'vehicle-images' : 'vehicle-documents'}/${randomUUID()}.${expected.extension}`,
    mimeType: detected.mime,
    sizeBytes: BigInt(file.buffer.byteLength),
    sha256: digest,
    originalName: safeOriginalName(file.originalname),
  };
}
