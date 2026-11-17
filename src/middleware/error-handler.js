import { AppError } from '../shared/errors.js';

export function notFoundHandler(req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', 'The requested resource was not found.'));
}

export function errorHandler(logger) {
  return function handleError(error, req, res, _next) {
    const isValidationError = error?.name === 'ZodError';
    const isMalformedJson = error?.type === 'entity.parse.failed';
    const isPayloadTooLarge = error?.type === 'entity.too.large';
    const isUploadTooLarge = error?.name === 'MulterError' && error.code === 'LIMIT_FILE_SIZE';
    const isUploadLimitError =
      error?.name === 'MulterError' && error.code !== 'LIMIT_FILE_SIZE';
    const status = error instanceof AppError
      ? error.status
      : isValidationError || isMalformedJson
        ? 400
        : isPayloadTooLarge || isUploadTooLarge
          ? 413
          : isUploadLimitError
            ? 400
          : 500;
    const code = error instanceof AppError
      ? error.code
      : isValidationError
        ? 'VALIDATION_ERROR'
        : isMalformedJson
          ? 'INVALID_JSON'
          : isUploadTooLarge
            ? 'UPLOAD_TOO_LARGE'
            : isUploadLimitError
              ? 'UPLOAD_LIMIT_EXCEEDED'
          : isPayloadTooLarge
            ? 'PAYLOAD_TOO_LARGE'
        : 'INTERNAL_SERVER_ERROR';
    const message = error instanceof AppError
      ? error.message
      : isValidationError
        ? 'Request validation failed.'
        : isMalformedJson
          ? 'Request body contains invalid JSON.'
          : isUploadTooLarge
            ? 'The uploaded file exceeds the configured size limit.'
            : isUploadLimitError
              ? 'The upload exceeds the configured file or form limits.'
          : isPayloadTooLarge
            ? 'Request body is too large.'
        : 'An unexpected error occurred.';

    logger.error({
      ...(isMalformedJson ? {} : { err: error }),
      requestId: req.id,
      status,
      code,
    });

    res.status(status).json({
      error: {
        code,
        message:
          process.env.NODE_ENV === 'production' && status >= 500
            ? 'An unexpected error occurred.'
            : message,
        requestId: req.id,
        ...(isValidationError
          ? {
              fields: error.issues.map(({ path, message: issueMessage }) => ({
                path: path.join('.'),
                message: issueMessage,
              })),
            }
          : {}),
      },
    });
  };
}
