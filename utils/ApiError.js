export class ApiError extends Error {
  constructor(statusCode, message, errors = [], data = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.errors = errors;
    this.data = data;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = 'Invalid request', errors = []) {
    return new ApiError(400, message, errors);
  }
  /** 428 Precondition Required — the caller must do something (e.g. give
   * consent) before the request can be completed; `data` carries whatever
   * the client needs to retry without repeating work (e.g. the Google
   * profile already fetched, so it needn't redo the OAuth popup). */
  static preconditionRequired(message = 'A precondition is required', errors = [], data = undefined) {
    return new ApiError(428, message, errors, data);
  }
  static unauthorized(message = 'You need to sign in to continue') {
    return new ApiError(401, message);
  }
  static forbidden(message = 'You do not have access to this resource') {
    return new ApiError(403, message);
  }
  static notFound(message = 'Resource not found') {
    return new ApiError(404, message);
  }
  static conflict(message = 'Resource already exists') {
    return new ApiError(409, message);
  }
  static tooLarge(message = 'File is larger than the allowed limit') {
    return new ApiError(413, message);
  }
}
