import multer from 'multer';
import { AppError } from '../../shared/errors.js';

const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const documentExtensions = new Set([...imageExtensions, '.pdf']);

function createUpload({ extensions, fileSize, maxCount }) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize, files: maxCount, fields: 12, parts: maxCount + 12 },
    fileFilter(_req, file, callback) {
      const name = file.originalname.replaceAll('\\', '/');
      const extension = name.slice(name.lastIndexOf('.')).toLowerCase();
      if (!extensions.has(extension)) {
        callback(new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'The selected file type is not supported.'));
        return;
      }
      callback(null, true);
    },
  });
}

export function createRentalOperationsUploadMiddleware(config) {
  return {
    photos: createUpload({
      extensions: imageExtensions,
      fileSize: config.VEHICLE_IMAGE_MAX_BYTES,
      maxCount: 10,
    }).array('photos', 10),
    damageImages: createUpload({
      extensions: imageExtensions,
      fileSize: config.VEHICLE_IMAGE_MAX_BYTES,
      maxCount: 10,
    }).array('images', 10),
    receipt: createUpload({
      extensions: documentExtensions,
      fileSize: config.VEHICLE_DOCUMENT_MAX_BYTES,
      maxCount: 1,
    }).single('receipt'),
  };
}
